# markdown-comment-sidecar

A proof-of-concept for adding threaded comments to markdown documents without touching the source files. Comments are stored as JSON sidecar files and anchored to document elements, so they survive edits to the surrounding text.

## Features

- **Non-destructive** — markdown source is never modified
- **Threaded conversations** — each annotation is a thread; anyone can reply
- **Element-based anchoring** — comments anchor to heading/paragraph elements, not character offsets
- **Resolve workflow** — resolve threads with an optional closure comment; resolved threads move to a separate tab
- **Two views** — toggle between rendered preview and raw markdown source; highlights appear in both
- **Orphan detection** — if anchor text is deleted, the comment is flagged as orphaned rather than silently lost
- **Multi-document** — one server handles many documents, each scoped by a stable document ID
- **Static site build** — generate self-contained HTML pages from a directory of markdown files
- **Sync** — pull comment data from the server into local `.comments.json` sidecar files

## Quick start (dev)

```bash
npm install
npm start
# open http://localhost:3000
```

In dev mode, all comments are scoped to document ID `local`.

## Static site build

Use `build.js` to generate annotated HTML pages from a directory of `.md` files.

```bash
node build.js \
  --input ./docs \
  --output ./dist \
  --server http://localhost:3000 \
  --site-id demo \
  --assets-url http://localhost:3000
```

The `--site-id` is a secret salt used to generate stable, non-guessable document IDs. Generate one for production and keep it stable:

```bash
node -e "console.log(require('crypto').randomUUID())" > .site-id
node build.js \
  --input ./docs \
  --output ./dist \
  --server https://comments.example.com \
  --site-id $(cat .site-id) \
  --assets-url https://cdn.example.com/sidecar
```

> **Important:** changing the site ID reassigns all document IDs, orphaning existing comments.

### Watch mode

Add `--watch` to rebuild automatically when source files change:

```bash
node build.js --input ./docs --output ./dist --server ... --site-id ... --assets-url ... --watch
```

## Sync

Pull comment data from the server into local sidecar files (useful for offline reading or backup):

```bash
node sync.js --server https://comments.example.com --site-id $(cat .site-id) --input ./docs
```

This writes `<file>.md.comments.json` alongside each markdown file.

### Document IDs

Each document gets a stable ID computed as:

```
sha256(siteId + ':' + relativeFilePath).slice(0, 32)
```

You can override this by adding an `id` field to a document's frontmatter:

```yaml
---
id: my-doc-slug
---
```

Or pin it to a specific hash (e.g. to preserve existing comments after a file rename):

```yaml
---
id: 203c2041d628f30e008ce7c34f35c4e1
---
```

A 32-char hex `id` is used as-is. Any other string is scoped to the file's directory and hashed with the site ID.

## Docker

```bash
docker build -t sidecar .
docker run -p 3000:3000 -v $(pwd)/data:/app/data sidecar
```

Comment data is persisted in the `/app/data` volume.

## Project structure

```
server.js          Express server + REST API
build.js           Static site generator
sync.js            Pull comments from server to local sidecar files
lib/
  document-id.js   Document ID generation and frontmatter parsing
  sidecar-store.js JSON-based comment storage
public/
  index.html       HTML shell (dev mode)
  app.js           All frontend logic (vanilla JS, no framework)
  sidecar.css      Stylesheet
sample.md          Document used in dev mode
docs/              Example markdown files for the static build
data/              Comment storage, one JSON file per document (gitignored)
dist/              Build output (gitignored)
```

## API

| Endpoint | Method | Body | Description |
|---|---|---|---|
| `/api/document?documentId=` | GET | — | Rendered HTML, markdown source, and threads |
| `/api/threads?documentId=` | GET | — | Threads only |
| `/api/comment` | POST | `{ documentId, text, author?, elementType, elementIndex, elementText, selectedText }` | Create a new thread |
| `/api/thread/:id/reply` | POST | `{ text, author? }` | Add a reply to a thread |
| `/api/thread/:id/resolve` | POST | `{ comment? }` | Resolve a thread |
| `/api/thread/:id` | DELETE | — | Delete a thread |
| `/api/message/:id` | PUT | `{ text }` | Edit a message |
| `/api/message/:id` | DELETE | — | Delete a message (deletes the thread if it was the last message) |

## Dependencies

| Package | Purpose |
|---|---|
| `express` | HTTP server |
| `marked` | Markdown → HTML rendering |
| `cors` | Cross-origin request handling |
