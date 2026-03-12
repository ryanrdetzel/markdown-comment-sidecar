---
title: API Reference
id: 165528475cfb599e7fea93dedb1ae270
author: Ryan Detzel
updated: 2025-03-01
tags: [api, reference]
---

# API Reference

The comment server exposes a small REST API. All endpoints accept and return JSON.

## Base URL

In development: `http://localhost:3000`

For this demo: `https://comments.detz.dev`

## Endpoints

### GET /api/document

Fetch a document's rendered HTML, raw markdown, and all comment threads in one request.

**Query parameters**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `documentId` | yes | 32-character document identifier |

**Response**

```json
{
  "html": "<h1>...</h1>",
  "markdown": "# ...",
  "threads": [
    {
      "id": "abc123",
      "document_id": "def456",
      "anchor_element_type": "p",
      "anchor_element_index": 2,
      "anchor_element_text": "first 60 chars of paragraph text",
      "anchor_selected_text": "highlighted passage",
      "resolved": 0,
      "resolved_at": null,
      "resolved_comment": null,
      "created_at": "2024-01-15T10:30:00Z",
      "messages": [
        {
          "id": "msg1",
          "thread_id": "abc123",
          "text": "This needs clarification.",
          "author": "Ryan",
          "created_at": "2024-01-15T10:30:00Z"
        }
      ]
    }
  ]
}
```

---

### GET /api/threads

Fetch only the comment threads for a document.

**Query parameters**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `documentId` | yes | 32-character document identifier |

**Response**

```json
{ "threads": [ ... ] }
```

---

### POST /api/comment

Create a new comment thread.

**Request body**

```json
{
  "documentId": "abc123",
  "text": "This needs clarification.",
  "author": "Ryan",
  "elementType": "p",
  "elementIndex": 2,
  "elementText": "first 60 chars of the paragraph",
  "selectedText": "the highlighted passage"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `documentId` | yes | Document to attach the thread to |
| `text` | yes | Comment message text |
| `author` | no | Author name (stored as-is, no auth) |
| `elementType` | yes | HTML element type (`p`, `h1`, `li`, etc.) |
| `elementIndex` | yes | Zero-based index of this element type in the document |
| `elementText` | yes | Text snapshot of the element (first ~60 chars) |
| `selectedText` | no | The highlighted text selection |

**Response** — `201 Created`

```json
{ "id": "new-thread-id" }
```

---

### POST /api/thread/:id/reply

Add a reply to an existing thread.

**URL parameter**: `:id` — thread ID

**Request body**

```json
{
  "text": "Reply message.",
  "author": "Alex"
}
```

**Response** — `200 OK`

```json
{ "id": "new-message-id" }
```

---

### POST /api/thread/:id/resolve

Mark a thread as resolved.

**URL parameter**: `:id` — thread ID

**Request body** (optional)

```json
{
  "comment": "Fixed in commit abc123."
}
```

**Response** — `200 OK`

```json
{ "ok": true }
```

---

### DELETE /api/thread/:id

Delete a thread and all its messages.

**URL parameter**: `:id` — thread ID

**Response** — `200 OK`

```json
{ "ok": true }
```

---

## Error responses

All errors return a JSON object with an `error` field:

```json
{ "error": "documentId is required" }
```

Common status codes:

| Code | Meaning |
|------|---------|
| 400 | Missing or invalid request parameter |
| 404 | Thread not found |
| 500 | Unexpected server error |
