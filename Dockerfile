# Elevyn brain — hosted deployment (Railway / Render / Fly).
# Includes Python so edge-tts neural voices work off the Mac.
FROM node:22-slim

ENV ELEVYN_HOSTED=1 \
    NODE_ENV=production \
    ELEVYN_PYTHON=python3

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip ca-certificates \
  && pip3 install --no-cache-dir --break-system-packages edge-tts \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.server.json ./
COPY server ./server
COPY src/types ./src/types

RUN npm run build:brain && npm prune --omit=dev

EXPOSE 8787
CMD ["node", "dist-server/server/index.js"]
