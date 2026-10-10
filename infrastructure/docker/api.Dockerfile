FROM node:24-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
COPY services/api/package.json services/api/package.json

RUN npm ci --workspace services/api

COPY services/api services/api

WORKDIR /app/services/api

RUN npx tsc -p tsconfig.json

ENV PORT=3000
EXPOSE 3000

CMD ["node", "dist/main.js"]
