FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY scripts/copy-map-worker.mjs scripts/copy-map-worker.mjs
# Deno is a developer-only dependency whose installer does not support Alpine.
# The web build needs only our asset-copy postinstall, not dependency install scripts.
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts && npm run postinstall
COPY App.tsx app.config.ts index.ts tsconfig.json LICENSE THIRD_PARTY_NOTICES.md ./
COPY src src
COPY assets assets
COPY public public
COPY supabase/functions/_shared supabase/functions/_shared
COPY supabase/templates supabase/templates
COPY scripts/prepare-web.mjs scripts/prepare-web.mjs
RUN npm run build:web

FROM nginx:1.28-alpine
RUN apk add --no-cache nodejs
COPY --from=build /app/dist /usr/share/nginx/html
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY deploy/write-runtime-config.mjs /opt/forkcast/write-runtime-config.mjs
COPY deploy/40-forkcast-config.sh /docker-entrypoint.d/40-forkcast-config.sh
RUN chmod +x /docker-entrypoint.d/40-forkcast-config.sh
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
