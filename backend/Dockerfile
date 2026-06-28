# ── Stage 1: builder ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install deps first (layer cache)
COPY package*.json ./
RUN npm install --ignore-scripts

# Copy source and compile
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ── Stage 2: runner ───────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Production deps only
COPY package*.json ./
RUN npm install --omit=dev --ignore-scripts && npm cache clean --force

# Compiled output from builder
COPY --from=builder /app/dist ./dist

EXPOSE 3000

# All secrets injected at runtime via environment variables — nothing baked in
CMD ["node", "dist/index.js"]
