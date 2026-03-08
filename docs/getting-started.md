---
title: Getting Started
---

# Getting Started

Get markdown-comment-sidecar running locally in a few minutes.

## Prerequisites

- Node.js 18 or later
- npm

## Install

```bash
git clone https://github.com/ryanrdetzel/markdown-comment-sidecar
cd markdown-comment-sidecar
npm install
```

## Run the dev server

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000). You'll see `sample.md` rendered with the comment sidebar on the right.

Select any text and click **+ Add Comment** to create your first comment thread.

## Try the build

The `build.js` script generates static HTML from a directory of markdown files. The generated pages load comments from a live comment server at runtime.

```bash
node build.js \
  --input ./docs \
  --output ./dist \
  --server http://localhost:3000 \
  --site-id my-local-site \
  --assets-url http://localhost:3000
```

Then open `./dist/index.html` in a browser (with the dev server still running).

## Generate a stable site ID

The `--site-id` is a secret salt used to derive document IDs. Generate it once and keep it stable — changing it reassigns all document IDs and orphans existing comments.

```bash
node -e "console.log(require('crypto').randomUUID())" > .site-id
```

Use it in your build command:

```bash
node build.js \
  --input ./docs \
  --output ./dist \
  --server http://localhost:3000 \
  --site-id $(cat .site-id) \
  --assets-url http://localhost:3000
```

The `.site-id` file is gitignored by default. Store it somewhere safe (a secrets manager, or a CI secret).

## What's in the repo

```
server.js          — Express API and comment storage logic
build.js           — Static site generator
public/
  index.html       — Dev-mode shell (CSS + HTML)
  app.js           — All frontend logic (vanilla JS, no modules)
  sidecar.css      — Stylesheet (served as static assets)
sample.md          — Document shown in dev mode (npm start)
docs/              — Markdown source for this documentation site
lib/
  document-id.js   — Document ID derivation and frontmatter parsing
comments.db        — Created at runtime, gitignored
```
