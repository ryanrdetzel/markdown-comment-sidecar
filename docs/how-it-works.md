---
title: How It Works
---

# How It Works

## Element-based anchoring

Most annotation systems anchor to character offsets in the raw text. This works well until the document changes — a single insertion or deletion shifts every offset that comes after it, breaking all existing annotations.

This system anchors to document *elements* instead:

- **Element type** — `h1`, `p`, `li`, `blockquote`, etc.
- **Element index** — the nth element of that type in the document
- **Text snapshot** — a short text fingerprint stored at comment creation time

When the document is rendered, the frontend walks the DOM to find the matching element by type and index, then uses the text snapshot to detect if the element has drifted. Comments anchor to structure, not position.

This is less precise than character-offset anchoring (you can't highlight half a sentence across multiple elements), but it survives typical document edits with no migration step.

## Document IDs

Every document gets a stable identifier used to namespace its comments in the database.

For built documents:

```
documentId = sha256(siteId + ':' + relativeFilePath).slice(0, 32)
```

The `siteId` is a secret you supply at build time with `--site-id`. It scopes all IDs to your deployment so two sites with the same file paths don't share comments.

Frontmatter can override the derived ID:

```yaml
---
id: my-custom-slug
---
```

A short slug is hashed with the site ID. A 32-character hex string is used as-is, which lets you pin an ID across file renames.

In dev mode (`npm start`), all documents use the ID `local`.

## Data model

Two tables in `comments.db`:

```sql
threads (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  anchor_element_type TEXT,   -- 'h1', 'p', etc.
  anchor_element_index INT,   -- nth element of that type
  anchor_element_text TEXT,   -- text snapshot for drift detection
  anchor_selected_text TEXT,  -- the highlighted passage
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

Each thread has one or more messages. The first message is the original comment. Subsequent messages are replies.

## Static build + live server

The architecture separates static content from dynamic comments:

```
GitHub Pages (static)          Comment server (dynamic)
─────────────────────          ──────────────────────────
dist/index.html                GET /api/document?documentId=…
dist/getting-started.html  ←→  POST /api/comment
dist/how-it-works.html         POST /api/thread/:id/reply
…                              POST /api/thread/:id/resolve
                               DELETE /api/thread/:id
```

When a reader opens a page, the browser fetches the current comment threads from the comment server and renders them into the sidebar. Comments are stored only on the server — the static HTML files contain no comment data.

## Frontend state

The app is a small state machine in `public/app.js`:

```js
state = {
  markdown: '',        // raw source (embedded in <script type="text/plain">)
  html: '',            // rendered HTML fetched from server
  threads: [],         // threads from GET /api/document
  selection: null,     // current text selection
  view: 'preview',     // 'preview' | 'markdown'
  sidebarMode: 'list', // 'list' | 'thread'
  sidebarTab: 'active',// 'active' | 'resolved'
  activeThreadId: null,
}
```

State changes call `renderView()` which reconciles the DOM. Comment highlights are injected via the DOM Range API in preview mode, or as `<mark>` spans in markdown mode.
