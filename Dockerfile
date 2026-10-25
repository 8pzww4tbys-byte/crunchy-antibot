FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    DATA_DIR=/app/server/data

COPY package.json ./
COPY server ./server
COPY assets ./assets
COPY examples ./examples
COPY index.html register.html login.html dashboard.html admin.html support.html ./
COPY README.md SECURITY.md LICENSE ./
COPY bin ./bin

RUN mkdir -p /app/server/data && chown -R node:node /app

USER node

EXPOSE 8787
VOLUME ["/app/server/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.mjs"]
