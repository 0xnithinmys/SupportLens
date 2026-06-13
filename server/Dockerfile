FROM node:20-bookworm-slim AS builder

# Build tools needed for mediasoup native compilation
RUN apt-get update && apt-get install -y \
    python3 python3-pip make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./

# Tell mediasoup to skip native build and use prebuilt binary
ENV MEDIASOUP_SKIP_WORKER_PREBUILT_DOWNLOAD=false
RUN npm install

COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM node:20-bookworm-slim

# Install FFmpeg for recording composition
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# Create recordings directory
RUN mkdir -p recordings

ENV NODE_ENV=production

EXPOSE 4000
CMD ["node", "dist/index.js"]
