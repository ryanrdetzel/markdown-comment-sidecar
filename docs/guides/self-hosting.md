---
title: Self-Hosting
id: self-hosting
---

# Self-Hosting the Comment Server

This guide covers deploying the comment server on your own infrastructure — a VPS, a container platform, or a managed PaaS like Railway or Render.

## What you're deploying

The comment server is a plain Node.js/Express app. It:

- Serves the comment API (`/api/*`)
- Serves static assets (`sidecar.css`, `app.js`) for the built docs
- Writes JSON comment files to the `data/` directory

Your static docs (the `dist/` output) can be hosted anywhere — GitHub Pages, S3, Netlify, Cloudflare Pages. Only the comment server needs to be running continuously.

## Requirements

- Node.js 18+
- Persistent disk for the `data/` directory
- HTTPS (browsers block mixed-content requests from `https://` pages to `http://` comment servers)

---

## Option 1: Plain VPS (nginx + pm2)

Install dependencies and start the server:

```bash
git clone https://github.com/ryanrdetzel/markdown-comment-sidecar
cd markdown-comment-sidecar
npm install --production
pm2 start server.js --name sidecar
pm2 save
```

Configure nginx to proxy the comment server:

```nginx
server {
    listen 443 ssl;
    server_name comments.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

Set environment variables before starting:

```bash
ALLOWED_ORIGINS=https://docs.example.com pm2 restart sidecar
```

---

## Option 2: Docker

See the [Docker guide](docker.html) for the full walkthrough. The short version:

```bash
docker run -d \
  -p 3000:3000 \
  -v $(pwd)/data:/app/data \
  -e ALLOWED_ORIGINS=https://docs.example.com \
  --name sidecar \
  ghcr.io/ryanrdetzel/markdown-comment-sidecar:latest
```

---

## Option 3: Railway

1. Fork or clone the repo, push to GitHub
2. Create a new Railway project from your GitHub repo
3. Add a **Volume** mounted at `/app/data` (so comment data survives deploys)
4. Set the environment variable `ALLOWED_ORIGINS` to your docs URL
5. Railway auto-detects `npm start` from `package.json`

Railway provides a `*.railway.app` domain with HTTPS automatically.

---

## Option 4: Render

1. Create a new **Web Service** from your GitHub repo
2. Build command: `npm install`
3. Start command: `node server.js`
4. Add a **Disk** mounted at `/opt/render/project/src/data` (where JSON files are written)
5. Set environment variable `ALLOWED_ORIGINS`

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Port the server listens on |
| `ALLOWED_ORIGINS` | *(none)* | Comma-separated list of allowed CORS origins. Required in production. |
| `DATA_DIR` | `./data` | Directory where JSON comment files are written |

Example:

```bash
PORT=8080 \
ALLOWED_ORIGINS=https://docs.example.com,https://www.example.com \
DATA_DIR=/data \
node server.js
```

---

## Verifying the deployment

Once running, check the health endpoint:

```bash
curl https://comments.example.com/api/threads?documentId=test
# Should return: {"threads":[]}
```

Then rebuild your docs pointing at the new server:

```bash
node build.js \
  --input ./docs \
  --output ./dist \
  --server https://comments.example.com \
  --site-id $(cat .site-id) \
  --assets-url https://comments.example.com
```

Deploy `dist/` to your static host. Comments should load from the live server.
