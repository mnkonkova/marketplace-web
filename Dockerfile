# Сборка Tailwind → web/styles.css и упаковка статики в caddy-образ.
# В рантайме нужны env: DOMAIN (домен фронта), API_UPSTREAM (host:port
# или https://api.example.com — куда проксировать /api/*).

FROM node:20-alpine AS css
WORKDIR /src
COPY package.json package-lock.json tailwind.config.js ./
RUN npm ci
COPY web ./web
RUN npm run build:css

FROM caddy:2-alpine
COPY --from=css /src/web /srv
COPY Caddyfile /etc/caddy/Caddyfile
