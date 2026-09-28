FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build:backend && npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 DOCUMENT_PYTHON_PATH=/opt/miriam-python/bin/python
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates python3 python3-venv ffmpeg \
    && rm -rf /var/lib/apt/lists/*
COPY requirements-documents.txt ./
RUN python3 -m venv /opt/miriam-python \
    && /opt/miriam-python/bin/pip install --no-cache-dir -r requirements-documents.txt
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/dist/backend ./dist/backend
COPY --chown=node:node migrations ./migrations
COPY --chown=node:node public ./public
COPY --chown=node:node next.config.ts ./next.config.ts
COPY --chown=node:node scripts/render-web.sh scripts/render-worker.sh ./scripts/
RUN chmod 755 ./scripts/render-web.sh ./scripts/render-worker.sh
USER node
CMD ["/app/scripts/render-web.sh"]
