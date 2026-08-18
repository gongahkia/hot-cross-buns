FROM node:22-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . ./
ARG VITE_HCB_SELF_HOSTED_RELIABILITY_ENABLED=true
ENV VITE_HCB_SELF_HOSTED_RELIABILITY_ENABLED=$VITE_HCB_SELF_HOSTED_RELIABILITY_ENABLED
RUN npm run build

FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
