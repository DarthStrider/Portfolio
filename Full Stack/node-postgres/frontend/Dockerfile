# ---- build stage: compile the React app to static files ----
FROM node:25-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
# npm ci installs exactly what package-lock.json records.
RUN npm ci
COPY . .
RUN npm run build

# ---- runtime stage: tiny nginx image serving the static files ----
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
