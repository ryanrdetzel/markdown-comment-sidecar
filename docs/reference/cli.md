---
title: CLI Reference
id: 9391162c98ed0147abf91781187e6676
---

# CLI Reference

## npm scripts

The three npm scripts are the main entry points.

| Script | Command | Description |
|--------|---------|-------------|
| `npm start` | `node server.js` | Start the comment server (default port 3000) |
| `npm run build` | `node build.js` | Build static HTML from `./docs` into `./dist` |
| `npm run sync` | `node sync.js` | Pull threads from the server into `.comments.json` sidecar files |

Pass additional flags directly to the underlying scripts (see below).

---

## build.js

Generates a static HTML site from a directory of markdown files.

```
node build.js [options]
```

### Options

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--input <dir>` | no | `./docs` | Source directory of `.md` files |
| `--output <dir>` | no | `./dist` | Destination directory for HTML output |
| `--server <url>` | **yes** | — | Comment server base URL |
| `--site-id <token>` | **yes** | — | Stable secret salt for document IDs |
| `--base-path <path>` | no | `""` | URL path prefix if the site is not at the root (e.g. `/docs`) |
| `--logo <text>` | no | — | Branding label shown top-left of every page, links to root index |
| `--watch` | no | — | Re-build when input files change |

### Example

```bash
node build.js \
  --input ./docs \
  --output ./dist \
  --server https://comments.example.com \
  --site-id $(cat .site-id) \
  --logo "Acme Docs"
```

### Output structure

The output mirrors the input directory structure, with `.md` files converted to `.html`:

```
docs/index.md            → dist/index.html
docs/getting-started.md  → dist/getting-started.html
docs/reference/index.md  → dist/reference/index.html
docs/guides/docker.md    → dist/guides/docker.html
```

For any directory that doesn't already contain an `index.md`, the build generates an `index.html` listing all files and subdirectories in that directory.

Static assets (`app.js`, `search.js`, `sidecar.css`, `theme.css`) are copied into the output directory with content-hashed filenames for cache busting.

---

## server.js

Starts the Express comment server.

```
node server.js
```

The server reads `PORT`, `DB_PATH`, and `CORS_ORIGIN` from the environment (see [Configuration](configuration.html)).

---

## sync.js

Pulls comment threads from the server and writes them as sidecar `.comments.json` files alongside the source markdown files.

```
node sync.js [options]
```

### Options

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--input <dir>` | no | `./docs` | Source directory of `.md` files |
| `--server <url>` | **yes** | — | Comment server base URL |
| `--site-id <token>` | **yes** | — | Stable secret salt for document IDs |

### Example

```bash
node sync.js \
  --input ./docs \
  --server https://comments.example.com \
  --site-id $(cat .site-id)
```

Each markdown file with at least one thread gets a `<filename>.md.comments.json` written next to it. Files with no threads have their sidecar file removed.
