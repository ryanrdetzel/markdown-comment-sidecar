---
title: Team Setup
id: team-setup
---

# Team Setup

This tutorial walks through setting up markdown-comment-sidecar for a team — shared comment server, static docs, stable document IDs.

## Architecture

```
                  ┌──────────────────────┐
                  │   Comment Server     │
                  │   (always running)   │
                  │   + data/ (JSON)     │
                  └──────────┬───────────┘
                             │ API calls at runtime
              ┌──────────────┴──────────────┐
              │                             │
   ┌──────────▼──────────┐      ┌──────────▼──────────┐
   │  Alice's browser    │      │   Bob's browser      │
   │  docs.example.com   │      │  docs.example.com    │
   └─────────────────────┘      └──────────────────────┘
```

The docs site is static. The comment server is the only piece that runs continuously.

## Step 1: Deploy the comment server

Pick a host and deploy. See the [Self-Hosting guide](../guides/self-hosting.html) for platform-specific instructions.

You'll need:
- HTTPS (required for browsers to load comments from a static `https://` page)
- Persistent disk for the `data/` directory
- `ALLOWED_ORIGINS` set to your docs URL

Example environment:

```bash
ALLOWED_ORIGINS=https://docs.example.com
DATA_DIR=/data
PORT=3000
```

Note the public URL of the comment server. You'll need it in the next step.

## Step 2: Generate a stable site ID

The site ID is a secret salt used to derive stable document IDs. Generate it once:

```bash
node -e "console.log(require('crypto').randomUUID())"
# e.g. f47ac10b-58cc-4372-a567-0e02b2c3d479
```

Store it in your CI secret store (GitHub Actions Secrets, Doppler, AWS Secrets Manager, etc.). Every team member and every CI run must use the **same** site ID. Changing it orphans all existing comments.

## Step 3: Build the docs

Add the build command to your CI workflow or `Makefile`:

```bash
node build.js \
  --input ./docs \
  --output ./dist \
  --server https://comments.example.com \
  --site-id $SITE_ID \
  --assets-url https://comments.example.com \
  --logo "My Project"
```

The `--logo` flag adds a branding label to the top-left of every page, linking back to the root index.

## Step 4: Deploy the docs

Upload `dist/` to your static host:

```bash
# GitHub Pages (via Actions)
# Netlify
# S3 + CloudFront
# Cloudflare Pages
```

The docs have no server-side logic. Any static host works.

## Step 5: Share with the team

Send team members the URL of the deployed docs. Anyone who can access the page can read and leave comments.

> **Note**: There is no authentication in the POC. If your docs are public, so are the comments. For internal docs, put the static site and/or comment server behind an access control layer (Cloudflare Access, nginx basic auth, VPN-only routing).

## Keeping comments across rebuilds

Document IDs are derived from `siteId + filePath`. As long as:

1. The site ID stays the same
2. The file path (relative to `--input`) stays the same

...the document ID stays the same and comments survive rebuilds, deploys, and content edits.

If you rename a file, you can pin the old document ID in frontmatter:

```yaml
---
title: Renamed Page
id: <old-32-char-hex-id>
---
```

## Adding collaborators to the comment server

No user management is built in. For now, access = ability to reach the URL. To add structure:

- Use `ALLOWED_ORIGINS` to limit which sites can call the API
- Add an nginx `auth_basic` block in front of the API for simple password protection
- Implement a custom `requireAuth` middleware in `server.js` using a shared secret header

See the [FAQ](../faq.html) for more on auth limitations.
