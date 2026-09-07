# syntax=docker/dockerfile:1

# ---------- base ----------
FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /repo
RUN apk add --no-cache git openssl

# ---------- deps ----------
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages ./packages
COPY apps ./apps
COPY services ./services
RUN pnpm install --frozen-lockfile --ignore-scripts

# ---------- build all packages ----------
FROM deps AS build
RUN pnpm -r build

# ---------- web runtime ----------
FROM node:20-alpine AS web
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]

# ---------- worker runtime ----------
FROM node:20-alpine AS worker
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages ./packages
COPY --from=build /repo/services/worker/dist ./services/worker/dist
COPY --from=build /repo/services/worker/package.json ./services/worker/package.json
CMD ["node", "services/worker/dist/index.js"]

# ---------- outbox relay runtime (standalone poller, C-1) ----------
FROM node:20-alpine AS relay
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages ./packages
COPY --from=build /repo/services/outbox-relay/dist ./services/outbox-relay/dist
COPY --from=build /repo/services/outbox-relay/package.json ./services/outbox-relay/package.json
CMD ["node", "services/outbox-relay/dist/index.js"]
