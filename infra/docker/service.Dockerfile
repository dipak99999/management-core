# Generic Dockerfile for any @lumaara/<service> in services/.
# Pass SERVICE build arg to select which one to build.
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml turbo.json ./
COPY packages ./packages
COPY services ./services
RUN pnpm install --frozen-lockfile=false

FROM deps AS build
ARG SERVICE
RUN pnpm --filter @lumaara/db db:generate
RUN pnpm --filter @lumaara/${SERVICE} build

FROM base AS runner
ARG SERVICE
ENV NODE_ENV=production

# Non-root user for the runtime (Alpine ships without one). Matches the uid/gid
# used by web.Dockerfile so bind-mounted volumes have consistent ownership.
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nodeapp && \
    mkdir -p /var/lumaara/backups && \
    chown -R nodeapp:nodejs /var/lumaara

COPY --from=build --chown=nodeapp:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=nodeapp:nodejs /app/packages ./packages
COPY --from=build --chown=nodeapp:nodejs /app/services/${SERVICE} ./services/${SERVICE}
WORKDIR /app/services/${SERVICE}
USER nodeapp
# Workspace packages ship source TS as their "main" entry (see
# packages/*/package.json → main: "./src/index.ts"). tsc compiling a service
# then produces dist/services/<name>/src/index.js AND resolves the imports
# to the source TS files at runtime — which Node can't load. So prod uses
# tsx (fast on-the-fly TS transform, no cold-start cost after first request)
# instead of the compiled dist. `pnpm start` handles this.
CMD ["pnpm", "start"]
