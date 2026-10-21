FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY backend-monytix/api/package.json backend-monytix/api/package-lock.json ./
RUN npm ci

COPY backend-monytix/api/tsconfig.json ./
COPY backend-monytix/api/src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim

WORKDIR /app

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

ENV NODE_ENV=production
ENV PORT=8090
EXPOSE 8090

CMD ["node", "dist/main.js"]
