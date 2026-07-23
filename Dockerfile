FROM node:22.22.1-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22.22.1-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S sentinel && adduser -S sentinel -G sentinel
COPY --from=build --chown=sentinel:sentinel /app/node_modules ./node_modules
COPY --from=build --chown=sentinel:sentinel /app/dist ./dist
COPY --from=build --chown=sentinel:sentinel /app/public ./public
COPY --from=build --chown=sentinel:sentinel /app/package.json ./package.json
USER sentinel
EXPOSE 4021
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD wget -qO- http://127.0.0.1:4021/api/health >/dev/null || exit 1
CMD ["node", "dist/src/server/index.js"]
