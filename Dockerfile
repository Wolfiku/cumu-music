# ── cumu Dockerfile ─────────────────────────────────────────────────────────
# Multi-stage build: deps → production image
# Usage:
#   docker build -t cumu .
#   docker run -p 3000:3000 -v /your/music:/music -v cumu_data:/app/data cumu
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: install dependencies ────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# ── Stage 2: production image ────────────────────────────────────────────────
FROM node:20-alpine AS runner

# Install ffprobe (optional, for audio duration fallback)
RUN apk add --no-cache ffmpeg tini

WORKDIR /app

# Copy deps from stage 1
COPY --from=deps /app/node_modules ./node_modules

# Copy application source
COPY src ./src
COPY public ./public
COPY package.json ./

# Create directories that will be bind-mounted
RUN mkdir -p /app/data /music

# Non-root user for security
RUN addgroup -S cumu && adduser -S cumu -G cumu
RUN chown -R cumu:cumu /app /music
USER cumu

EXPOSE 3000

# Volumes
# /app/data  — SQLite DB + sessions
# /music     — music library
VOLUME ["/app/data", "/music"]

# Use tini as init process for correct signal handling
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/server.js"]
