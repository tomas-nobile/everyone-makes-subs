# Everyone Makes Subs · one container: Fastify + pipeline + built web.
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts=false
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
# Standalone yt-dlp (no python needed), pinned. Bump when YouTube breaks it.
ARG YTDLP_VERSION=2026.08.19
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && \
    curl -fsSL -o /usr/local/bin/yt-dlp \
      "https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/yt-dlp_linux$( [ "$(uname -m)" = aarch64 ] && echo _aarch64 )" && \
    chmod +x /usr/local/bin/yt-dlp && \
    apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/dist ./dist
COPY --from=build /app/samples ./samples
ENV DATA_DIR=/data NODE_ENV=production PORT=8080
EXPOSE 8080
VOLUME /data
CMD ["node", "server/dist/index.js"]
