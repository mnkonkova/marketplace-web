# Сборка Angular-фронта → статика, отдаётся через Caddy.
# В рантайме нужны env: DOMAIN (домен фронта), API_UPSTREAM (host:port,
# куда Caddy проксирует /api/*).

FROM node:20-alpine AS build
WORKDIR /src
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web ./
RUN npm run build

FROM caddy:2-alpine
COPY --from=build /src/dist/frontend/browser /srv
COPY Caddyfile /etc/caddy/Caddyfile
