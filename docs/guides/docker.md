---
title: Deploying with Docker
---

# Deploying with Docker

This guide walks through running the comment server with Docker.

## Dockerfile

The repository includes a `Dockerfile` for the comment server:

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

## Build the image

```bash
docker build -t comment-server .
```

## Run the container

```bash
docker run -d \
  --name comment-server \
  -p 3000:3000 \
  -v /data/comments:/data \
  -e DB_PATH=/data/comments.db \
  -e CORS_ORIGIN=https://docs.example.com \
  comment-server
```

The `-v` flag mounts a host directory so the database file persists across container restarts.

## Docker Compose

For a more complete setup with automatic restarts:

```yaml
version: "3.9"
services:
  comment-server:
    build: .
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      - comments-data:/data
    environment:
      DB_PATH: /data/comments.db
      CORS_ORIGIN: https://docs.example.com

volumes:
  comments-data:
```

Start with:

```bash
docker compose up -d
```

## Health check

The server does not currently expose a dedicated `/health` endpoint. A simple check:

```bash
curl http://localhost:3000/api/threads?documentId=test
```

A `200 OK` response with `{"threads":[]}` confirms the server is up.
