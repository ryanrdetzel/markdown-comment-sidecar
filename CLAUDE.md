# CLAUDE.md — markdown-comment-sidecar

## What this is

A proof-of-concept for annotating markdown files with threaded comments without modifying the source file. Comments are stored in a SQLite database (`comments.db`) and anchored to document elements (headings, paragraphs) rather than character offsets.

## Stack

- **Server**: Node.js + Express, no build step
- **Rendering**: `marked` converts markdown to HTML server-side
- **Anchoring**: Element-based (type + index + text snapshot), not text-offset fuzzy matching
- **Frontend**: Vanilla JS + HTML/CSS, no framework, no bundler
- **Storage**: `better-sqlite3` — `comments.db` flat file
- **Build**: `build.js` generates static HTML from a `docs/` directory

Run with `npm start` — server on port 3000.

## File layout

```
server.js          — Express API + anchoring logic
build.js           — Static site generator
public/
  index.html       — All CSS + HTML shell
  app.js           — All frontend logic (no modules)
sample.md          — The document used in dev mode
docs/              — Source markdown files for the build
dist/              — Build output (gitignored)
comments.db        — Thread storage (gitignored)
```

## Data model

Threads in `comments.db`:

```sql
threads (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  anchor_element_type TEXT,   -- 'h1', 'p', etc.
  anchor_element_index INT,   -- nth element of that type in the document
  anchor_element_text TEXT,   -- text snapshot for drift detection
  anchor_selected_text TEXT,  -- the highlighted selection
  resolved INT DEFAULT 0,
  resolved_at TEXT,
  resolved_comment TEXT,
  created_at TEXT
)

messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT REFERENCES threads(id) ON DELETE CASCADE,
  text TEXT,
  author TEXT,
  created_at TEXT
)
```

## Document IDs

Each document gets a stable ID: `sha256(siteId + ':' + relativeFilePath).slice(0, 32)`

Frontmatter can override this:
- `id: my-slug` — scoped to the file's directory, then hashed with siteId
- `id: 203c2041d628f30e008ce7c34f35c4e1` — 32-char hex used as-is (pins the ID, e.g. after a file rename)

In dev mode (`npm start`), document ID defaults to `'local'`.

## Build

```bash
node build.js --input ./docs --output ./dist --server http://localhost:3000 --site-id demo
```

Flags:
- `--input` — source markdown directory (default: `./docs`)
- `--output` — output directory (default: `./dist`)
- `--server` — comment server base URL (required)
- `--site-id` — stable salt for document IDs (required)
- `--assets-url` — base URL for `sidecar.css` and `app.js` (required)
- `--logo` — optional branding label shown top-left of every page (links to root index)
- `--watch` — rebuild on file changes

`--site-id` is a secret salt. Keep it stable — changing it reassigns all document IDs and orphans existing comments.

## Frontend state

```js
state = {
  markdown: '',        // raw source
  html: '',            // rendered HTML from server
  threads: [],         // threads from GET /api/document
  selection: null,     // current text selection
  view: 'preview',     // 'preview' | 'markdown'
  sidebarMode: 'list', // 'list' | 'thread'
  sidebarTab: 'active',// 'active' | 'resolved'
  activeThreadId: null,
}
```

## API

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/document?documentId=` | Returns `{ html, markdown, threads[] }` |
| GET | `/api/threads?documentId=` | Returns `{ threads[] }` |
| POST | `/api/comment` | Create new thread `{ documentId, text, elementType, elementIndex, elementText, selectedText }` |
| POST | `/api/thread/:id/reply` | Add reply `{ text }` |
| POST | `/api/thread/:id/resolve` | Resolve thread `{ comment? }` |
| DELETE | `/api/thread/:id` | Delete thread |

## Sidebar behaviour

- **List view**: shows open threads (Active tab) or resolved threads (Resolved tab). Each card shows first message, separator + last message if >1, reply count badge or "Resolved" badge.
- **Thread view**: full conversation, reply input at bottom, split Resolve button (Resolve / Resolve with comment dropdown).
- Resolved threads have no document highlight unless they are `activeThreadId`. Opening a resolved thread triggers a full `renderView()` to inject the highlight; closing it removes it.
- Non-resolved thread open/close only updates CSS classes (no re-render).

## Views

- **Preview**: rendered HTML, `mark.cmt-highlight` elements injected via DOM Range API
- **Markdown**: raw `<pre>` with `<mark>` spans injected via string escaping. Comments can be created in both views.

## Known limitations (POC scope)

- No auth — document ID is the only gate; anyone who knows it can read/write comments
- No multi-user locking on `comments.db`
- No persistence beyond the flat file
