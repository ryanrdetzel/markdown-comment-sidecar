---
title: CLI Reference
---

# CLI Reference

## build.js

Generates a static HTML site from a directory of markdown files.

```
node build.js [options]
```

### Options

```
--input  <dir>     Source directory of .md files (default: ./docs)
--output <dir>     Destination directory for HTML output (default: ./dist)
--server <url>     Comment server base URL (required)
--site-id <tok>    Stable secret salt for document IDs (required)
--assets-url <url> Base URL for sidecar.css and app.js (required)
--watch            Watch for file changes and rebuild automatically
```

### Example

```bash
node build.js \
  --input ./docs \
  --output ./dist \
  --server https://comments.example.com \
  --site-id $(cat .site-id) \
  --assets-url https://cdn.example.com/sidecar
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

## server.js

Starts the Express comment server.

```
node server.js
```

The server reads `PORT`, `DB_PATH`, and `CORS_ORIGIN` from the environment (see [Configuration](configuration.html)).

## sync.js

Pulls comment threads from the server and writes them as sidecar `.comments.json` files alongside the source markdown files.

```
node sync.js [options]
```

### Options

```
--input  <dir>  Source directory of .md files (default: ./docs)
--server <url>  Comment server base URL (required)
--site-id <tok> Stable secret salt for document IDs (required)
```

### Example

```bash
node sync.js \
  --input ./docs \
  --server https://comments.example.com \
  --site-id $(cat .site-id)
```

Each markdown file with at least one thread gets a `<filename>.md.comments.json` written next to it. Files with no threads have their sidecar file removed.
