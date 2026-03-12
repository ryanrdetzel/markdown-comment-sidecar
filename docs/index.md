---
title: markdown-comment-sidecar
id: 7832454ca986d4925298c1b46e6bc208
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
- [FAQ](faq.html) — common questions answered
- [Changelog](changelog.html) — what's changed in each release

## Tutorials

Step-by-step walkthroughs for common tasks:

- [Your First Comment](tutorials/first-comment.html) — create, reply, and resolve a thread
- [Team Setup](tutorials/team-setup.html) — shared comment server, stable IDs, static docs
- [Migrate from GitHub Issues](tutorials/migrate-from-issues.html) — move existing feedback into the sidecar
- [Custom Anchoring Strategies](tutorials/advanced/custom-anchoring.html) — section-level, ID-based, and line-number anchoring
- [Webhooks](tutorials/advanced/webhooks.html) — notify Slack or GitHub when comments are created

## Reference

Detailed technical documentation:

- [Configuration](reference/configuration.html) — all server and build options
- [CLI](reference/cli.html) — build script flags
- [Data Model](reference/data-model.html) — schema, fields, and SQLite tips
- [API Errors](reference/api-errors.html) — error codes and CORS troubleshooting
- [Anchor Element Types](reference/anchoring/element-types.html) — what elements can be anchored
- [Drift Detection](reference/anchoring/drift-detection.html) — what happens when documents change

## Guides

Platform-specific deployment guides:

- [Docker](guides/docker.html) — containerize the comment server
- [GitHub Pages](guides/github-pages.html) — deploy docs to GitHub Pages via Actions
- [Self-Hosting](guides/self-hosting.html) — VPS, Railway, Render, and other options
- [VS Code](guides/integrations/vscode.html) — local editing workflow
- [Obsidian](guides/integrations/obsidian.html) — publish your vault with comments
- [Notion Exports](guides/integrations/notion.html) — add comments to exported Notion pages


---
Ignore this line, it's for tests