---
title: Configuration
---

# Configuration

## Server environment variables

The comment server reads these environment variables at startup.

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Port the Express server listens on |
| `DB_PATH` | `./comments.db` | Path to the SQLite database file |
| `CORS_ORIGIN` | `*` | Allowed CORS origin (set to your site's domain in production) |

### Example

```bash
PORT=8080 DB_PATH=/data/comments.db CORS_ORIGIN=https://docs.example.com node server.js
```

## Build options

All options are passed as command-line flags to `build.js`.

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--input` | no | `./docs` | Directory of `.md` files to process |
| `--output` | no | `./dist` | Output directory for generated HTML |
| `--server` | **yes** | — | Comment server base URL |
| `--site-id` | **yes** | — | Stable secret salt for document IDs |
| `--assets-url` | **yes** | — | Base URL for `sidecar.css` and `app.js` |
| `--watch` | no | false | Re-build when input files change |

## Document ID frontmatter

Add an `id` field to any document's frontmatter to override the derived document ID.

```yaml
---
title: My Document
id: my-custom-slug
---
```

Short slugs are hashed with `--site-id`. A 32-character hex string is used as-is, letting you pin an ID after a file rename.
