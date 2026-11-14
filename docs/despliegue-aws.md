# Despliegue en AWS (Amplify Hosting)

Payload hoy es un **sitio estático**: Vite genera `apps/client/dist` (HTML, JS y los `.glb` de `assets/web`).
Se publica con **AWS Amplify Hosting**, que construye desde GitHub y publica cada push a `main`, con HTTPS y CDN.
El servidor del cooperativo (fase 6) irá aparte (ver el final).

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
2. **Create new app** → **GitHub** → autorizar → repo `LeoDanielChan/payload` → rama **`main`**.
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

## Servidor del cooperativo (fase 6, pendiente)

Colyseus usa **WebSockets** y debe estar siempre encendido, así que no va en Amplify. Opciones: Lightsail o EC2
(lo más simple) o ECS Fargate con un Application Load Balancer con *stickiness*. El cliente seguirá en Amplify y
se conectará por `wss://`. Decisión pendiente: ADR en la fase 6.
