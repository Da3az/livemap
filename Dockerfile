# livemap server for the shared platform box. Runs scripts/serve.mjs
# from source through tsx (the repo's own `npm run serve`), serving web/dist at
# / and the API at /api/v1 on one origin.
FROM node:24.22.2-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/api/package.json packages/api/
COPY web/package.json web/
RUN npm ci --ignore-scripts
COPY packages packages
COPY web web
COPY scripts scripts
COPY migrations migrations
RUN npm run build

FROM node:24.22.2-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/*
# tsx is a devDependency but serve.mjs runs through it, so node_modules ships whole.
COPY --from=build /app /app
USER node
EXPOSE 8787
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--max-old-space-size=384", "--conditions=livemap-source", "--import", "tsx", "scripts/serve.mjs"]
