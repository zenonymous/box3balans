# syntax=docker/dockerfile:1

# ---- Build: compile the server and bundle the web app ----
# Runs on the build machine's own platform: the output is plain JavaScript, so building it once
# serves every target platform (and avoids emulating ARM for the heavy part).
FROM --platform=$BUILDPLATFORM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --no-audit --no-fund
COPY server server
COPY web web
RUN npm run build

# ---- Runtime: production dependencies + build output only ----
FROM node:24-alpine
# su-exec: the entrypoint drops from root to the app user after preparing its folders.
RUN apk add --no-cache su-exec
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev --workspace server --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/server/drizzle server/drizzle
COPY --from=build /app/web/dist web/dist

# Which build this is, shown in the app. `git archive` (scripts/deploy.sh) fills in VERSION; the
# GitHub workflow passes it as a build argument instead.
COPY VERSION ./
ARG VERSION=""
RUN if [ -n "$VERSION" ]; then printf '%s\n' "$VERSION" > VERSION; fi
# Where the source of this build is (the AGPL asks a network service to offer it).
ARG SOURCE_URL="https://github.com/OWNER/box3balans"

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

LABEL org.opencontainers.image.title="Box3balans" \
      org.opencontainers.image.description="Zelf te hosten overzicht van je beleggingen, crypto en edelmetaal, met box 3" \
      org.opencontainers.image.licenses="AGPL-3.0-only"

WORKDIR /app/server
# /data holds what the app creates itself: generated secrets and, without PostgreSQL, the database.
ENV PORT=8080 \
    WEB_DIST=/app/web/dist \
    BACKUP_DIR=/backups \
    DATA_DIR=/data \
    PGLITE_DIR=/data/pglite \
    APP_SECRET_FILE=/data/app-secret \
    PGPASSWORD_FILE=/data/db-password \
    SOURCE_URL=$SOURCE_URL
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/api/health > /dev/null || exit 1
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
