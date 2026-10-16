FROM node:22-alpine
WORKDIR /app
COPY deploy/package.json deploy/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --ignore-scripts
COPY deploy/push/policy.mjs deploy/push/delivery.mjs deploy/push/worker.mjs deploy/push/keys.mjs ./
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD node -e "const fs=require('node:fs'); process.exit(Date.now()-fs.statSync('/tmp/forkcast-push-heartbeat').mtimeMs<120000?0:1)"
CMD ["node", "worker.mjs"]
