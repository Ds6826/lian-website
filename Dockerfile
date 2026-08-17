FROM node:26-alpine@sha256:aadf416b2cdce311a8811ba3f0608a61b77dbf997500e2eafe781b51f6a0b019 AS dependencies

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
    && npm cache clean --force

FROM node:26-alpine@sha256:aadf416b2cdce311a8811ba3f0608a61b77dbf997500e2eafe781b51f6a0b019 AS runtime

ARG VCS_REF=unknown
LABEL org.opencontainers.image.source="https://github.com/Ds6826/lian-website" \
      org.opencontainers.image.revision="${VCS_REF}"

ENV NODE_ENV=production \
    PORT=8000

WORKDIR /app
RUN addgroup --system --gid 10001 lians \
    && adduser --system --uid 10001 --ingroup lians --home /home/lians lians \
    && mkdir -p /app/data \
    && chown -R 10001:10001 /app /home/lians

COPY --from=dependencies --chown=10001:10001 /app/node_modules ./node_modules
COPY --chown=10001:10001 . .

USER 10001:10001
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('node:http').get('http://127.0.0.1:8000/api/health?format=json',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "server.js"]
