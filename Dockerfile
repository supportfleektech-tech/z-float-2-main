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

# ---------- build packages in dependency order ----------
FROM deps AS build
# Build independent packages first (no internal deps)
RUN pnpm --filter @zfloat/config build
RUN pnpm --filter @zfloat/money build
RUN pnpm --filter @zfloat/observability build
RUN pnpm --filter @zfloat/secrets build
RUN pnpm --filter @zfloat/validation build
# Build providers, queue, storage (depend on config/money/observability)
RUN pnpm --filter @zfloat/providers build
RUN pnpm --filter @zfloat/queue build
RUN pnpm --filter @zfloat/storage build
# Build database, ledger, auth, kyc (depend on above)
RUN pnpm --filter @zfloat/database build
RUN pnpm --filter @zfloat/ledger build
RUN pnpm --filter @zfloat/auth build
RUN pnpm --filter @zfloat/kyc build
# Build notifications, audit, approvals (depend on database/ledger)
RUN pnpm --filter @zfloat/notifications build
RUN pnpm --filter @zfloat/audit build
RUN pnpm --filter @zfloat/approvals build
# Build payments-core last (depends on approvals, database, etc)
RUN pnpm --filter @zfloat/payments-core build
# Build services
RUN pnpm --filter @zfloat/worker build
RUN pnpm --filter @zfloat/outbox-relay build
# Build web last
RUN pnpm --filter @zfloat/web build

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