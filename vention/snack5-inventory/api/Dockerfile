# Node 22.18+ runs TypeScript directly (type stripping), so there's no build stage:
# the image holds the production dependencies and the .ts sources.
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY src ./src
COPY tests ./tests
# Don't run as root.
USER node
EXPOSE 8080
CMD ["node", "src/server.ts"]
