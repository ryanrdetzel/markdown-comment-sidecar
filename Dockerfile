FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY server.js ./
COPY lib/ ./lib/
COPY public/ ./public/

# Persistent comment storage
VOLUME /app/data
ENV DATA_DIR=/app/data

EXPOSE 3000

CMD ["node", "server.js"]
