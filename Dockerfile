# wswb.fyi: one small Node process serves the page and the API.
# No npm install: the server only uses Node built-ins (node:sqlite needs 22.13+).
FROM node:22-alpine3.23

ENV NODE_ENV=production \
    PORT=8000 \
    DATABASE_PATH=/data/wswb.db

WORKDIR /app

# Only the public page files and the server. Nothing else in the repo ships.
COPY index.html styles.css app.js data.js demo-data.js config.js transitions.js ./
COPY server ./server

# /data is the Disco volume holding the SQLite database.
RUN mkdir -p /data && chown node:node /data
USER node

EXPOSE 8000
CMD ["node", "--disable-warning=ExperimentalWarning", "server/server.js"]
