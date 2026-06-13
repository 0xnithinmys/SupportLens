FROM node:20-bookworm-slim AS builder

WORKDIR /app
COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

FROM node:20-bookworm-slim

# Install FFmpeg for recording composition
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
# Install only production dependencies
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist

# Create recordings directory
RUN mkdir -p recordings

EXPOSE 4000
CMD ["node", "dist/index.js"]
