FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first (layer cache)
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Copy application code
COPY . .

# Run as non-root
RUN chown -R node:node /app
USER node

EXPOSE 3445

CMD ["node", "server.js"]
