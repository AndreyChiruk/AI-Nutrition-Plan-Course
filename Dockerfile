FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund --loglevel=error && npm cache clean --force
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/database ./database
EXPOSE 3000
CMD ["node", "dist/main.js"]
