# Soundprint web application.
#
# Node 22+ is required for the built-in `node:sqlite`, which replaced the
# better-sqlite3 native addon. That choice is what keeps this image free of a
# compiler toolchain — there is nothing to build from source.
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev

FROM node:22-slim AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci 2>/dev/null || npm install
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    SOUNDPRINT_DATA_DIR=/data \
    AUDIO_SERVICE_URL=http://audio-service:8000

# Standalone output carries only the traced dependencies, so the runtime image
# stays small without a separate prune step.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public 2>/dev/null || true

# Mount point for user data and the world baseline. Both live outside the
# image so the baseline can be swapped without a rebuild.
VOLUME ["/data"]

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
