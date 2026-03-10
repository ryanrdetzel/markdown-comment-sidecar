---
title: markdown-comment-sidecar
---

# markdown-comment-sidecar

A proof-of-concept for annotating markdown files with threaded comments — without ever modifying the source file.

Comments are stored in a SQLite database and anchored to document elements (headings, paragraphs, list items) rather than character offsets. This means comments survive minor edits to the surrounding text.

## What it looks like

Select any text in this document and click **+ Add Comment** to try it. Comments appear in the sidebar. You can reply, resolve, or delete them.

The document itself is never touched. All comment data lives in a separate database on the comment server.

## Key ideas

**Element-based anchoring** — each comment is attached to a specific element by type, index, and a text snapshot. A comment on "the third paragraph" stays attached even if the text around it changes slightly.

**Sidecar storage** — comments live outside the document in a flat SQLite file. You can delete the database and start fresh without touching your markdown files.

**Static site friendly** — the `build.js` script generates plain HTML files from your `docs/` directory. Host them anywhere (GitHub Pages, Netlify, S3). The only dynamic piece is the comment server.

**No framework** — the frontend is vanilla JS. The server is plain Express. No build pipeline required to run or modify it.

## Docs in this site

- [Getting Started](getting-started.html) — run it locally in under five minutes
- [How It Works](how-it-works.html) — anchoring, document IDs, the data model
- [API Reference](api.html) — all endpoints documented
- [Deployment](deployment.html) — self-host the comment server, deploy docs to GitHub Pages

## Reference

- [Reference](reference/index.html) — configuration options and CLI reference

## Guides

- [Guides](guides/index.html) — step-by-step guides for Docker and GitHub Pages deployment


---
Ignore this line, it's for tests