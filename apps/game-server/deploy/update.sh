#!/usr/bin/env bash
# Actualiza el servidor de juego en la instancia (guía: docs/despliegue-aws.md).
# Uso, en la instancia: bash ~/payload/apps/game-server/deploy/update.sh
set -euo pipefail
cd "$(dirname "$0")/../../.."
source ~/.nvm/nvm.sh
nvm use --silent "$(cat .nvmrc)"
git pull --ff-only
corepack enable
pnpm install --frozen-lockfile --filter @payload/game-server...
pnpm --filter @payload/game-server build
sudo systemctl restart payload-game
sleep 2
systemctl --no-pager --lines=5 status payload-game
