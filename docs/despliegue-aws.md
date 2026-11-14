# Despliegue en AWS

Payload tiene dos piezas que se publican por separado:

| Pieza | Qué es | Dónde va |
| --- | --- | --- |
| **Cliente** (`apps/client`) | Sitio estático: Vite genera `apps/client/dist` (HTML, JS y los `.glb` de `assets/web`) | **AWS Amplify Hosting**: construye desde GitHub y publica cada push a `main`, con HTTPS y CDN |
| **Servidor de juego** (`apps/game-server`) | Colyseus por WebSocket, siempre encendido. Solo lo usa el **cooperativo** | **Una instancia de AWS Lightsail** con Caddy delante para el HTTPS (ver [Servidor del cooperativo](#servidor-del-cooperativo-lightsail)) |

Sin el servidor, el solitario funciona igual, pero «Cooperativo» da **timeout**: el cliente busca el servidor en
`wss://<la página>:2567` y Amplify no tiene nada en ese puerto.

## Archivos del repo

| Archivo | Qué hace |
| --- | --- |
| `amplify.yml` | Build: Node de `.nvmrc`, pnpm de `packageManager` (corepack), `pnpm install --frozen-lockfile`, `pnpm --filter @payload/client build` (incluye `tsc --noEmit`) y publica `apps/client/dist` |
| `customHttp.yml` | Cabeceras: `assets/**` (con hash) un año e `immutable`; `models/**` (sin hash) una semana; `index.html` `no-cache`; `nosniff` y `Referrer-Policy` |
| `.gitignore` | Ignora `.pnpm-store/`, la caché de pnpm que usa el build de Amplify |

El build no ejecuta los tests: `pnpm validate` debe estar en verde antes de fusionar a `main` (regla 9).

## Primera vez (consola de AWS, ~10 min)

Lo hace una persona con cuenta de AWS y permiso sobre el repo de GitHub.

1. Consola de AWS → **AWS Amplify**, región `us-east-1` o `us-east-2`.
2. **Create new app** → **GitHub** → autorizar → repo `katsevi/payload` (antes `LeoDanielChan/payload`) → rama **`main`**.
3. Amplify detecta `amplify.yml`. Si pregunta por monorepo, la carpeta raíz es `/` (el `amplify.yml` ya construye solo el cliente).
4. **Save and deploy**. El primer build tarda unos 5-8 minutos. La URL queda como `https://main.<id>.amplifyapp.com`.
5. Recomendado: **Billing → Budgets** con un presupuesto mensual pequeño (5-10 USD) que avise por correo.

Desde entonces, cada fusión a `main` se publica sola. Una rama más (por ejemplo, de pruebas) se añade en
**App settings → Branch settings**.

## Dominio propio (opcional)

Amplify → **Hosting → Custom domains** → añadir el dominio (de Route 53 o de otro proveedor, siguiendo los
registros DNS que indica). El certificado HTTPS es automático.

## Comprobar en local antes de publicar

```bash
pnpm install --frozen-lockfile
pnpm --filter @payload/client build
pnpm --filter @payload/client preview   # http://localhost:4173
```

Los atajos de desarrollo (`?design=1`, `?play=1`…) no funcionan en el build de producción: se entra por el menú.

## Problemas típicos

- **Falla `pnpm install --frozen-lockfile`:** `pnpm-lock.yaml` no está al día; ejecuta `pnpm install` en local y sube el lockfile.
- **Falla el build por tipos:** es `tsc --noEmit`; reprodúcelo con `pnpm typecheck`.
- **Un modelo cambiado no se ve:** los `.glb` se cachean una semana. Cambia el nombre del archivo o invalida desde Amplify volviendo a desplegar y forzando recarga.
- **Coste:** casi todo es transferencia; cada jugador nuevo descarga unos 17 MB (JS + modelos).

## Licencias

`programme_erizon.glb` es **CC-BY-NC-ND**: sin uso comercial. Publicar el juego gratis y sin anuncios (concurso,
demo) está bien; si el juego cobra o lleva anuncios, hay que sustituirlo antes (ver `assets/CREDITS.md`).

## Servidor del cooperativo (Lightsail)

El servidor de juego (Colyseus) necesita estar **siempre encendido** y aceptar **WebSocket**, así que no va en
Amplify. Para el concurso basta una instancia pequeña de **Lightsail** (un solo proceso; las salas viven en memoria,
ADR 0010). La página va por `https://`, así que el servidor **tiene** que ir por `wss://` (con certificado): el
navegador bloquea `ws://` desde una página segura. De eso se encarga **Caddy**, que pide el certificado solo.

```text
navegador ──https──▶ Amplify (cliente)
    └──wss://juego.tudominio.com──▶ Lightsail: Caddy :443 ──▶ node dist/index.js :2567 (solo local)
```

Archivos del repo (`apps/game-server/deploy/`):

| Archivo | Qué hace |
| --- | --- |
| `payload-game.service` | Servicio systemd: arranca `node dist/index.js` con `PORT=2567` y `HOST=127.0.0.1`, y lo reinicia si se cae |
| `Caddyfile` | HTTPS automático (Let's Encrypt) y proxy de HTTP y WebSocket hacia `127.0.0.1:2567` |
| `update.sh` | Actualizar: `git pull`, instalar, construir y reiniciar el servicio |

### 1. Crear la instancia (consola de AWS)

1. **Lightsail → Create instance**, región `us-east-1` (o la misma que Amplify), **Linux → OS Only → Ubuntu 24.04 LTS**.
2. Plan: el más pequeño con **1 GB de RAM** basta para unas pocas salas.
3. Ya creada: **Networking → Create static IP** y asígnala a la instancia (si no, la IP cambia al reiniciar).
4. **Networking → IPv4 Firewall:** deja `SSH 22` y añade **`HTTP 80`** y **`HTTPS 443`** (80 lo usa Caddy para el
   certificado). **No** abras el 2567: el servidor solo escucha en local.

### 2. Dominio

El certificado necesita un **nombre**, no una IP. Crea un registro DNS **A** `juego.tudominio.com` → la IP estática
(en Route 53 o en tu proveedor de dominio). Comprueba que resuelve antes de seguir (`nslookup juego.tudominio.com`).

### 3. Instalar (por SSH, botón «Connect» de Lightsail)

```bash
sudo apt update && sudo apt install -y git debian-keyring debian-archive-keyring apt-transport-https curl
# Node con nvm (la versión de .nvmrc)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
source ~/.nvm/nvm.sh
git clone https://github.com/katsevi/payload.git ~/payload
cd ~/payload && nvm install "$(cat .nvmrc)" && corepack enable
pnpm install --frozen-lockfile --filter @payload/game-server...
pnpm --filter @payload/game-server build
# Servicio
sudo cp apps/game-server/deploy/payload-game.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now payload-game
systemctl status payload-game        # debe decir active (running)
curl -s -o /dev/null -w "%{http_code}
" http://127.0.0.1:2567/   # 200
```

Si el repo es privado, `git clone` pedirá credenciales: usa una *deploy key* de solo lectura o un token de GitHub
(no lo guardes en el repo).

### 4. Caddy (HTTPS)

Instálalo siguiendo la guía oficial de Caddy para Ubuntu (repositorio apt de `caddyserver.com/docs/install`). Luego:

```bash
sudo cp ~/payload/apps/game-server/deploy/Caddyfile /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile      # cambia juego.tudominio.com por tu dominio
sudo systemctl reload caddy
curl -s -o /dev/null -w "%{http_code}
" https://juego.tudominio.com/   # 200 con certificado válido
```

### 5. Decirle al cliente dónde está el servidor

1. **Amplify → Hosting → Environment variables → Manage variables** → añade
   `VITE_GAME_SERVER_URL` = `wss://juego.tudominio.com` (sin puerto y sin barra final).
2. **Vuelve a desplegar** la rama `main` (Redeploy this version). La variable se mete en el build: cambiarla sin
   reconstruir no hace nada.
3. Prueba: abre el juego en dos navegadores → **Cooperativo → Crear sala** → en el otro, escribe el código.

### Actualizar el servidor

Cada vez que se fusione algo que toque `apps/game-server` o `packages/shared`:

```bash
bash ~/payload/apps/game-server/deploy/update.sh
```

Ojo: el cliente (Amplify) se publica solo al fusionar, pero el servidor no. Si el contrato de red
(`packages/shared/src/net.ts`) cambia, actualiza el servidor **a la vez** o las salas fallarán.

### Problemas típicos del cooperativo

| Síntoma | Causa probable |
| --- | --- |
| Timeout al crear o entrar en una sala | Falta `VITE_GAME_SERVER_URL` en Amplify, o se añadió sin volver a desplegar |
| Error de conexión inmediato | El servidor está caído (`systemctl status payload-game`, `journalctl -u payload-game -n 50`) o Caddy no tiene certificado (`journalctl -u caddy -n 50`) |
| Caddy no consigue certificado | El DNS aún no apunta a la IP estática, o el puerto 80/443 está cerrado en el firewall de Lightsail |
| Funciona en local pero no publicado | La página va por `https://` y el servidor por `ws://`: tiene que ser `wss://` |
| Se cortan las salas al actualizar | Normal: reiniciar el servicio cierra las salas en memoria. Actualiza cuando no haya partidas |

**Coste aproximado:** el plan más pequeño de Lightsail es de pocos USD al mes con IP estática incluida mientras
esté asignada. Añádelo a la alarma de presupuesto.
