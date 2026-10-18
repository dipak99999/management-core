# Generic Dockerfile for any @lumaara/<app>-web Next.js frontend.
# Pass APP build arg to select which one to build.
#
#   docker build -f infra/docker/web.Dockerfile --build-arg APP=accounting-web -t lumaara/accounting-web .
#
# Relies on Next.js `output: "standalone"` in the app's next.config.js — the
# runner stage copies the tiny standalone bundle instead of node_modules.

FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

FROM base AS deps
COPY package.json /app/
COPY pnpm-lock.yaml /app/
COPY pnpm-workspace.yaml /app/
COPY turbo.json /app/
COPY packages /app/packages
COPY apps /app/apps
RUN pnpm install --frozen-lockfile=false

FROM deps AS build
ARG APP
# Build only the target app; turbo pulls its workspace deps transitively.
RUN pnpm --filter @lumaara/${APP} build

FROM base AS runner
ARG APP
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0

# Non-root user for the runtime (Alpine ships without one).
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

WORKDIR /app

# Next.js standalone bundle: server + minimal runtime deps.
COPY --from=build --chown=nextjs:nodejs /app/apps/${APP}/.next/standalone ./
# Static assets live outside standalone/ — copy them into the expected path.
COPY --from=build --chown=nextjs:nodejs /app/apps/${APP}/.next/static ./apps/${APP}/.next/static
# None of the apps currently ship a public/ dir; if one does later, add:
#   COPY --from=build --chown=nextjs:nodejs /app/apps/${APP}/public ./apps/${APP}/public

USER nextjs
# PORT is injected via compose per-service. Default matches the app's dev port.
ENV PORT=3000

# Next.js standalone entrypoint lives at apps/<APP>/server.js in the copied tree.
CMD node apps/${APP}/server.js
