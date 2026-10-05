# syntax=docker/dockerfile:1

# ---- Build: compile the server and bundle the web app ----
FROM node:24-alpine AS build
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
# su-exec: the entrypoint drops from root to the app user after preparing the backup folder.
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
# Commit and date, filled in by `git archive` (scripts/deploy.sh); "dev" otherwise.
COPY VERSION ./

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

WORKDIR /app/server
ENV PORT=8080 \
    WEB_DIST=/app/web/dist \
    BACKUP_DIR=/backups
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/api/health > /dev/null || exit 1
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
