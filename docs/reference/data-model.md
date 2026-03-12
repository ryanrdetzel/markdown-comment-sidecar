---
title: Data Model
id: e7dcd79e492571073812f7f19031aac5
---

# Data Model

markdown-comment-sidecar stores all comment data as JSON files in the `data/` directory. Each document gets its own file: `data/<documentId>.json`.

## Schema

```json
{
  "threads": [
    {
      "id": "uuid",
      "document_id": "32-char-hex",
      "anchor_element_type": "p",
      "anchor_element_index": 2,
      "anchor_element_text": "Text snapshot of the anchored element",
      "anchor_selected_text": "The highlighted passage",
      "resolved": false,
      "resolvedAt": null,
      "resolvedComment": null,
      "created_at": "2024-01-01T00:00:00.000Z",
      "messages": [
        {
          "id": "uuid",
          "thread_id": "uuid",
          "text": "Message body",
          "author": "Display name",
          "author_id": "oauth-sub",
          "created_at": "2024-01-01T00:00:00.000Z"
        }
      ]
    }
  ]
}
```

---

## Threads

### `id`

UUID generated server-side. Stable for the lifetime of the thread.

### `document_id`

32-character hex string identifying the document. Derived from:

```
sha256(siteId + ':' + relativeFilePath).slice(0, 32)
```

In dev mode (`npm start`), this is always `'local'`.

### `anchor_element_type`

The HTML tag of the anchored element — `h1`, `h2`, `h3`, `p`, `li`, `blockquote`, etc. Corresponds to the element types produced by `marked` when rendering the source markdown.

### `anchor_element_index`

Zero-based index of the anchored element among all elements of the same type in the document. For example, `anchor_element_type: "p", anchor_element_index: 2` means the third paragraph.

### `anchor_element_text`

Text content of the anchor element at the time the comment was created. Used to detect drift — if the element at the stored index no longer has this text, the anchor has shifted.

### `anchor_selected_text`

The exact text that was highlighted when the comment was created. Stored for display purposes (shown in thread cards) and for future re-anchoring logic.

### `resolved` / `resolved_at` / `resolved_comment`

`resolved` is `0` or `1`. When a thread is resolved, `resolved_at` is set to an ISO 8601 timestamp and `resolved_comment` stores an optional closing note.

Resolved threads are excluded from highlight injection unless they are the currently active thread.

---

## Messages

### `id`

UUID generated server-side.

### `thread_id`

Foreign key to `threads.id`. Cascade-deletes with the thread.

### `text`

Raw message content. No sanitization is applied server-side — the frontend escapes it when rendering.

### `author`

Display name string. In the POC this comes from the request body; in a production deployment it would come from a verified session.

### `created_at`

ISO 8601 timestamp string. Set server-side at insert time.

---

## Inspecting the data

```bash
# Pretty-print all threads for a document
cat data/<document-id>.json | python3 -m json.tool

# List thread IDs and selected text with jq
jq '.threads[] | {id, anchor_selected_text, resolved}' data/<document-id>.json

# Show all messages in a specific thread
jq '.threads[] | select(.id == "<thread-id>") | .messages' data/<document-id>.json
```
