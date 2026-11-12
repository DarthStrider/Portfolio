# ---- build stage: compile TypeScript ----
FROM node:25-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
# npm ci installs exactly what package-lock.json records (and fails if it disagrees with package.json).
RUN npm ci
COPY . .
RUN npm run build

# ---- runtime stage: production dependencies + compiled JS only ----
FROM node:25-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# Don't run as root.
USER node
EXPOSE 8080
CMD ["node", "dist/index.js"]
