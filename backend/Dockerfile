FROM node:20-bullseye-slim

WORKDIR /app

# Use Tsinghua Debian mirror for fast apt installs in CN deployments.
# (Original deb.debian.org pulls at ~50KB/s from CN, killing first build.)
RUN sed -i 's|deb.debian.org|mirrors.tuna.tsinghua.edu.cn|g; s|security.debian.org|mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list

# System dependencies for native modules (bcrypt, mysql2)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy package manifests first for layer caching
COPY package*.json ./

# Use NPM mirror for faster installs in CN deployments
RUN npm config set registry https://registry.npmmirror.com && \
    npm ci --omit=dev --no-audit --no-fund

# Copy application source
COPY src ./src

# Storage / log directories
RUN mkdir -p /app/logs

EXPOSE 3001

# Healthcheck — backend exposes /health
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD curl -fsS http://localhost:3001/health || exit 1

CMD ["node", "src/index.js"]
