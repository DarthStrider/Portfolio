# ---- build stage: compile TypeScript ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# ---- runtime stage: production dependencies + compiled JS only ----
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# Don't run as root.
USER node
EXPOSE 8080
CMD ["node", "dist/index.js"]
