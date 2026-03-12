---
title: Document IDs
id: 8fca286e7550e18cb80f27dc590b476f
---

# Document IDs

Every document needs a stable identifier so its comment threads survive file renames and URL changes. This page explains how IDs are derived and how to control them.

## Default derivation

When no `id` is set in frontmatter, the document ID is:

```
sha256(siteId + ':' + relativeFilePath).slice(0, 32)
```

Where:
- `siteId` is the value passed as `--site-id` to `build.js`
- `relativeFilePath` is the file's path relative to the `--input` directory (e.g. `guides/setup.md`)

The result is a 32-character hex string, e.g. `a3f1c9e08b2d47e6f001234567890abc`.

In dev mode (`npm start`), document ID is always `'local'` — all threads visible in dev mode share a single namespace.

## Frontmatter override

Add an `id` field to a document's YAML frontmatter to pin the ID explicitly. The value must be a 32-character hex string:

```yaml
---
title: Getting Started
id: a3f1c9e08b2d47e6f001234567890abc
---
```

A 32-character hex ID is used as-is, bypassing the hash. Use this to pin a document's ID after renaming it — existing threads stay attached.

> **Always use hex IDs.** Plain word slugs like `id: getting-started` are guessable — anyone who knows or can guess the slug and your site ID can compute the document ID and access its comments. A random hex string is unguessable.

## Keeping IDs stable

IDs are the only link between a document and its threads. If an ID changes, threads become orphaned and invisible.

Causes of ID change:
- **File renamed or moved** — the path component changes, so the derived ID changes. Fix: pin the ID with a 32-char hex value in frontmatter before renaming.
- **`--site-id` changed** — all IDs in the site change. Treat `--site-id` like a secret key: generate it once and never rotate it.

## Generating a site ID

```bash
node -e "console.log(require('crypto').randomUUID())" > .site-id
```

Store the value in a secrets manager or CI secret. The `.site-id` file is gitignored by default.

## Inspecting a document ID

To find the ID the build would assign to a specific file:

```bash
node -e "
  const { makeDocumentId } = require('./lib/document-id');
  const siteId = require('fs').readFileSync('.site-id', 'utf8').trim();
  console.log(makeDocumentId(siteId, 'docs/my-file.md'));
"
```

## Warning: no frontmatter ID

If a document is built without an `id` in its frontmatter, the build injects a yellow warning banner into the page reminding you to add one. The document still works, but a rename will orphan its threads.
