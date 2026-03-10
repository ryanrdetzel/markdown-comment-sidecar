---
title: GitHub Pages
---

# Deploying to GitHub Pages

This guide shows how to host your built docs on GitHub Pages while keeping comments on a separate server.

## Overview

The static HTML files live in the `dist/` directory after a build. GitHub Pages hosts these files. The comment server runs elsewhere (a VPS, Railway, Fly.io, etc.) and is referenced at build time via `--server`.

## Repository setup

1. Add a `.site-id` file (gitignored) containing your stable site ID. Any random string works — a UUID is a convenient way to generate one:

   ```bash
   node -e "console.log(require('crypto').randomUUID())" > .site-id
   ```

2. Store the site ID as a GitHub Actions secret named `SITE_ID`.

3. Store your comment server URL as a secret named `COMMENT_SERVER_URL`.

## GitHub Actions workflow

Create `.github/workflows/docs.yml`:

```yaml
name: Build and deploy docs

on:
  push:
    branches: [main]
    paths: [docs/**]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 18

      - run: npm ci

      - name: Build docs
        run: |
          node build.js \
            --input ./docs \
            --output ./dist \
            --server ${{ secrets.COMMENT_SERVER_URL }} \
            --site-id ${{ secrets.SITE_ID }} \
            --assets-url ${{ secrets.COMMENT_SERVER_URL }}

      - name: Deploy to GitHub Pages
        uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./dist
```

## Custom domain

To use a custom domain, add a `CNAME` file to your `docs/` directory:

```
docs.example.com
```

The build copies all non-`.md` files from the input directory to the output directory, so `CNAME` will appear in `dist/`.

## CORS

Make sure the comment server's `CORS_ORIGIN` is set to your GitHub Pages domain:

```bash
CORS_ORIGIN=https://your-org.github.io node server.js
```
