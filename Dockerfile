# syntax=docker/dockerfile:1
# Multi-stage image for the Typewriter app (Express + Next.js on port 4000).
#   target "dev"  → hot-reloading development server (used by docker-compose.yml)
#   target "prod" → minimal production runtime (used by docker-compose.prod.yml)

FROM node:22-alpine AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ---- dependencies (cached unless the lockfile changes) ----
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# ---- development ----
FROM deps AS dev
ENV NODE_ENV=development \
    PORT=4000 \
    WATCHPACK_POLLING=true
COPY . .
EXPOSE 4000
CMD ["npm", "run", "dev"]

# ---- build ----
FROM deps AS build
ENV NODE_ENV=production
COPY . .
RUN npm run build && npm prune --omit=dev

# ---- production runtime ----
FROM base AS prod
ENV NODE_ENV=production \
    PORT=4000
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/next.config.mjs ./next.config.mjs
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/db ./db
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/api/health >/dev/null || exit 1
CMD ["node", "dist/server/index.js"]
