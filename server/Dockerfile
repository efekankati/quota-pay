# =============================================================================
# Stage 1: Multi-Stage Builder (Expo Web Bundle + TypeScript Server Compilation)
# =============================================================================
FROM node:22-alpine AS builder

WORKDIR /build

# Install build dependencies
COPY package.json package-lock.json* ./
RUN npm install --legacy-peer-deps

# Copy project source and compile Expo Web Bundle + TypeScript Backend
COPY . .

# Export static production web application into /build/dist with NODE_ENV=production
# and strip any source maps so no .map files or inline source maps ship to clients
ENV NODE_ENV=production
RUN npx expo export --platform web --output-dir dist --no-source-maps || npx expo export --platform web --output-dir dist
RUN find dist -name "*.map" -type f -delete

# Compile Node.js/TypeScript backend into /build/server/dist
RUN npx tsc -p server/tsconfig.json

# Install minimal production dependencies for the server runtime
WORKDIR /build/server
RUN npm install --omit=dev --no-audit --no-fund

# =============================================================================
# Stage 2: Minimal Node 22 Alpine Production Runner
# =============================================================================
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=512"
ENV PORT=3000
ENV STATIC_WEB_DIR=/app/dist
ENV AWS_REGION=eu-south-1

# Copy compiled Expo Web static bundle
COPY --from=builder /build/dist ./dist

# Copy compiled Node.js/TypeScript backend and its minimal production node_modules
COPY --from=builder /build/server/package.json ./server/package.json
COPY --from=builder /build/server/node_modules ./server/node_modules
COPY --from=builder /build/server/dist ./server/dist

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "--max-old-space-size=512", "server/dist/index.js"]
