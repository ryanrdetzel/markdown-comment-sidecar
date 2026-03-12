---
title: FAQ
id: faq
---

# Frequently Asked Questions

Common questions about markdown-comment-sidecar.

## General

### What problem does this solve?

Most documentation platforms bolt comments onto the publishing layer — you get Disqus at the bottom of the page, or GitHub Discussions linked from a sidebar. Neither anchors comments to a specific passage in the document.

markdown-comment-sidecar lets readers highlight *any* text and attach a threaded discussion to it. The comment lives next to the passage, not at the bottom of the page.

### Does it modify my markdown files?

No. Your source files are never touched. All comment data lives in JSON files in the `data/` directory on the comment server.

### Is it production-ready?

It's a proof of concept. The API has no authentication by default, which means anyone who knows a document's ID can read and write comments on it. See [Deployment](deployment.html) for hardening advice before exposing it publicly.

### What happens if I edit the document after comments are added?

Comments are anchored to *elements* (the nth heading, the nth paragraph) rather than character offsets. Minor edits to surrounding text usually don't break anchors. If you add or remove elements before the anchor, the comment may shift to the wrong element. A text snapshot (`anchor_element_text`) is stored so drift can be detected — though automatic re-anchoring is not yet implemented.

### Can I use it with non-markdown documents?

The server stores comments against any `documentId` string. The rendering pipeline is markdown-specific, but you could adapt `build.js` to inject the sidecar into HTML pages generated from any source.

---

## Setup

### What are the minimum requirements?

- Node.js 18 or later
- npm

No database server. No external dependencies beyond Node.js itself.

### How do I generate a site ID?

```bash
node -e "console.log(require('crypto').randomUUID())"
```

Store the result somewhere safe. Changing it orphans all existing comments.

### Can I run the comment server on a different host than the docs?

Yes. Set `--server` to the full URL of your comment server when building:

```bash
node build.js \
  --input ./docs \
  --output ./dist \
  --server https://comments.example.com \
  --site-id <your-site-id> \
  --assets-url https://comments.example.com
```

Configure `ALLOWED_ORIGINS` on the server to allow the docs origin.

---

## Comments

### Who can leave comments?

By default, anyone who can reach the comment server. There is no auth layer in the POC. You can add middleware to `server.js` to gate on a session cookie or API key.

### Can I export comments?

Each document's comments are stored as a JSON file in the `data/` directory. Copy the files directly or extract specific fields with `jq`:

```bash
# Pretty-print all threads for a document
cat data/<document-id>.json | python3 -m json.tool

# Extract thread IDs and selected text with jq
jq -r '.threads[] | [.id, .anchor_selected_text] | @csv' data/<document-id>.json
```

### Can I delete a comment thread?

Yes. `DELETE /api/thread/:id` removes the thread and all its messages (cascade delete).

### What is "resolve with comment"?

When resolving a thread you can optionally leave a closing note — useful for explaining why an issue was closed or what action was taken. The note is stored in `resolved_comment` on the thread record.

---

## Deployment

### Can I host the docs on GitHub Pages?

Yes. See the [GitHub Pages guide](guides/github-pages.html).

### Does the comment server need a persistent disk?

Yes — the `data/` directory must survive restarts. On container platforms, mount a persistent volume at the path where `DATA_DIR` points. On Railway, Render, or Fly.io, use a volume attachment. On a plain VPS, the directory is already persistent.
