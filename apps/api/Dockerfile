# syntax=docker/dockerfile:1.7
# ColdChain API — Fastify + Prisma + Puppeteer/Chromium (bilingual EN/Urdu PDFs).
#
# Multi-stage: base -> deps -> build -> runtime.
# The `runtime` stage is ALSO what the compose `migrate` one-shot service runs, because
# line ~83 copies the whole built workspace across — so it retains the Prisma CLI (a
# devDependency), the schema, and the migrations. It likewise carries the deploy files
# (docker-compose.yml, Caddyfile, scripts/app-role.sql, update.ps1), which the updaters
# extract with `docker cp` so a release can change them without shipping a new folder.
# Both facts constrain the "slim it with pnpm deploy" note further down.
#
# Build from the REPO ROOT (the monorepo), not from apps/api:
#   docker build -f apps/api/Dockerfile -t coldchain-api .

############################################################
# base — Node 20 + pnpm (via corepack)
############################################################
FROM node:20-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# Puppeteer must NOT download its own Chromium; the runtime stage installs the system one.
ENV PUPPETEER_SKIP_DOWNLOAD=true
# pnpm via npm (npm retries flaky downloads; corepack does a single-shot fetch that
# times out on slow links). Pinned to the version in package.json's packageManager.
RUN npm config set fetch-retries 5 \
 && npm config set fetch-retry-maxtimeout 120000 \
 && npm install -g pnpm@10.33.0
WORKDIR /app

############################################################
# deps — full workspace install (incl. dev deps: needed to build and to run Prisma)
############################################################
FROM base AS deps
# Copy only manifests first so this layer is cached until dependencies change.
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
# build — generate Prisma client + compile the API and its workspace deps
############################################################
FROM deps AS build
COPY . .
# `@coldchain/api...` = the API plus its workspace dependencies (shared, db).
RUN pnpm --filter @coldchain/db run db:generate \
 && pnpm --filter "@coldchain/api..." build

############################################################
# runtime — slim image + system Chromium + Urdu/Latin fonts
############################################################
FROM base AS runtime
ENV NODE_ENV=production
# Puppeteer picks this up automatically (launch() passes no executablePath).
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
# System Chromium + Urdu/Latin fonts for PDF rendering. apt cache mounts + retries make
# this resilient to flaky networks: downloaded .debs persist across build attempts and
# are not baked into the final image (cache mounts are excluded from image layers).
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    rm -f /etc/apt/apt.conf.d/docker-clean \
 && apt-get -o Acquire::Retries=5 update \
 && apt-get install -y --no-install-recommends -o Acquire::Retries=5 \
      chromium \
      fonts-noto-core \
      fonts-nafees \
      fontconfig \
      ca-certificates \
      openssl \
      curl

# Offline Urdu: map the templates' (formerly web-fetched) font names to the bundled
# Nafees Urdu font so PDFs render Urdu without any network access.
COPY apps/api/docker/fontconfig-urdu.conf /etc/fonts/conf.d/99-coldchain-urdu.conf
RUN fc-cache -f

# Bring the fully-installed & built workspace across. The absolute path /app is
# identical to the build stage, so pnpm's node_modules symlinks remain valid.
# NOTE: this is reliability-first; later we can slim it with `pnpm deploy --filter @coldchain/api`.
COPY --from=build /app /app

WORKDIR /app/apps/api
EXPOSE 3001
# Compose runs this with `init: true` so Chromium's child processes are reaped.
CMD ["node", "dist/server.js"]
