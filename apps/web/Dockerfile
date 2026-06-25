# syntax=docker/dockerfile:1.7
# ColdChain web — Next.js 14, standalone output (small self-contained server).
#
# Build from the REPO ROOT:
#   docker build -f apps/web/Dockerfile -t coldchain-web .
#
# NEXT_PUBLIC_* values are inlined at BUILD time. We default the API base to "" so the
# browser calls the SAME ORIGIN it was served from — Caddy proxies /v1, /docs, /health
# to the API. This keeps one image portable to any facility (works with any LAN IP or
# hostname, no rebuild).

############################################################
# base
############################################################
FROM node:20-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV PUPPETEER_SKIP_DOWNLOAD=true
# pnpm via npm (npm retries flaky downloads; corepack does a single-shot fetch that
# times out on slow links). Pinned to the version in package.json's packageManager.
RUN npm config set fetch-retries 5 \
 && npm config set fetch-retry-maxtimeout 120000 \
 && npm install -g pnpm@10.33.0
WORKDIR /app

############################################################
# deps — full workspace install
############################################################
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
 && pnpm config set fetch-retries 5 \
 && pnpm config set fetch-retry-maxtimeout 120000 \
 && pnpm install --frozen-lockfile

############################################################
# build — produce apps/web/.next/standalone
############################################################
FROM deps AS build
ARG NEXT_PUBLIC_API_URL=""
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
COPY . .
# db:generate first so any @coldchain/db type imports resolve during the web build.
RUN pnpm --filter @coldchain/db run db:generate \
 && pnpm --filter "@coldchain/web..." build

############################################################
# runtime — minimal standalone server
############################################################
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
WORKDIR /app
# Standalone bundle (monorepo layout: server lives at apps/web/server.js).
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
# (apps/web has no public/ dir, so nothing to copy there.)
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
