---
title: Configuration
id: configuration
---

# Configuration

## Server environment variables

The comment server reads these environment variables at startup.

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Port the Express server listens on |
| `DATA_DIR` | `./data` | Directory where JSON comment files are stored |
| `ALLOWED_ORIGINS` | `*` | Allowed CORS origin (set to your site's domain in production) |

### Example

```bash
PORT=8080 DATA_DIR=/data ALLOWED_ORIGINS=https://docs.example.com node server.js
```

---

## Build options

All options are passed as command-line flags to `build.js`.

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--input <dir>` | no | `./docs` | Directory of `.md` files to process |
| `--output <dir>` | no | `./dist` | Output directory for generated HTML |
| `--server <url>` | **yes** | — | Comment server base URL |
| `--site-id <token>` | **yes** | — | Stable secret salt for document IDs |
| `--base-path <path>` | no | `""` | URL path prefix if the site is not hosted at the root (e.g. `/docs`) |
| `--logo <text>` | no | — | Branding label shown top-left of every page; links to root index |
| `--watch` | no | — | Re-build automatically when input files change |

---

## Document ID frontmatter

Every document gets a stable ID derived from the `--site-id` and the file's relative path:

```
sha256(siteId + ':' + relativeFilePath).slice(0, 32)
```

You can override this with an `id` field in the document's YAML frontmatter.

```yaml
---
title: My Document
id: my-custom-slug
---
```

Short slugs are hashed with `--site-id`. A 32-character hex string is used as-is, which lets you pin an ID after renaming a file so existing comments are not orphaned.

See [Document IDs](document-ids.html) for the full reference.

---

## Theming

The visual appearance is controlled entirely by CSS custom properties defined in `public/theme.css`. Teams can copy and edit that file to apply their own branding without touching any other file.

See [Theming](theming.html) for the full variable reference and instructions.
