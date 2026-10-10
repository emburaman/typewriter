#!/bin/sh
# Dev container entrypoint (docker-compose.yml).
#
# node_modules lives in a Docker volume so the host's copy never shadows the container's.
# Compose keeps that volume when the container is recreated — even after `up --build` — so
# a newly added dependency would be missing. Re-install whenever package-lock.json changes.
set -e

STAMP=node_modules/.package-lock.sha256
CURRENT=$(sha256sum package-lock.json | cut -d' ' -f1)

if [ "$(cat "$STAMP" 2>/dev/null)" != "$CURRENT" ]; then
  echo "[dev] package-lock.json changed — installing dependencies…"
  # `npm install` (not `npm ci`): ci tries to delete node_modules itself, which fails on a mount point.
  npm install --no-audit --no-fund
  echo "$CURRENT" > "$STAMP"
fi

exec npm run dev
