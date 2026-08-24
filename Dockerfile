# QuRelay — see docs/rewrite-plan.md for the architecture. Plain ES
# modules, no bundler/build step, so this Dockerfile is just "install the
# npm workspace, then run node directly" — no compile stage needed.
#
# Two consumers of this file, matching docker-compose.yml's two services:
#   - `deps` stage: full source + all workspace dependencies (including
#     devDependencies, since those are just other @qu/* workspace
#     packages needed by tests, not a separate package set) — used by the
#     `test` service to run the whole suite inside a container.
#   - `runtime` stage: the same install, plus a non-root user, a declared
#     data volume, and a healthcheck — the actual deployable image, run by
#     the `relay` service (and whatever hosts it in production).

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
RUN npm ci

FROM deps AS runtime
ENV NODE_ENV=production \
    QU_PORT=3000 \
    QU_DATA_DIR=/data
RUN addgroup -S qu && adduser -S qu -G qu \
 && mkdir -p /data && chown -R qu:qu /data /app
USER qu
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.QU_PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "packages/relay/src/serve.js"]
