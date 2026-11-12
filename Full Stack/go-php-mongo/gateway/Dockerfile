# Builds the React app, then serves it from nginx alongside the API routes.
# Build context is the project root, so this file can reach web/.
FROM node:25-alpine AS web
WORKDIR /web
# npm ci installs exactly what package-lock.json says, and fails if it no longer
# matches package.json, instead of quietly updating it the way npm install would.
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
# Type errors are reported by `npm run typecheck`; the image build only needs the bundle.
RUN npx vite build

FROM nginx:1.27-alpine
COPY gateway/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web /web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=10s --timeout=3s CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
