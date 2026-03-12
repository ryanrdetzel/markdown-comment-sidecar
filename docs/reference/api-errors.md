---
title: API Errors
id: api-errors
---

# API Error Reference

All error responses from the comment server follow this shape:

```json
{
  "error": "Human-readable description"
}
```

HTTP status codes follow standard conventions.

---

## 400 Bad Request

Returned when required parameters are missing or invalid.

### Missing `documentId`

```
GET /api/document
→ 400 { "error": "documentId is required" }
```

### Missing body fields on POST

```
POST /api/comment
Body: { "documentId": "abc" }
→ 400 { "error": "text is required" }
```

Required fields for `POST /api/comment`:

| Field | Type | Notes |
|---|---|---|
| `documentId` | string | Required |
| `text` | string | Required, first message in the thread |
| `elementType` | string | Required, e.g. `"p"`, `"h2"` |
| `elementIndex` | number | Required, 0-based index within the document |
| `elementText` | string | Required, text snapshot of the anchor element |
| `selectedText` | string | Optional, the highlighted passage |

---

## 404 Not Found

Returned when the requested resource doesn't exist.

### Thread not found

```
POST /api/thread/nonexistent-id/reply
→ 404 { "error": "Thread not found" }
```

This can happen if:
- The thread ID is incorrect
- The thread was deleted before the reply was submitted

---

## 409 Conflict

Returned when the action conflicts with current state.

### Thread already resolved

```
POST /api/thread/abc123/resolve
→ 409 { "error": "Thread is already resolved" }
```

Re-resolving a resolved thread is a no-op by design. Check `resolved` on the thread object before calling this endpoint.

---

## 500 Internal Server Error

Returned when an unexpected error occurs on the server, usually a database error.

```json
{
  "error": "Internal server error"
}
```

Check the server logs for the underlying exception. Common causes:

- `data/` directory is read-only (permissions issue)
- Disk full — cannot write JSON files
- File system errors (corrupted JSON, missing directory)

---

## CORS errors

CORS errors appear in the browser console, not as JSON responses from the server. They happen when the comment server doesn't allow the origin of your docs site.

**Symptom**: Browser shows `Access to fetch at 'http://...' from origin 'https://...' has been blocked by CORS policy`

**Fix**: Set `ALLOWED_ORIGINS` on the server to include your docs origin:

```bash
ALLOWED_ORIGINS=https://docs.example.com node server.js
```

Multiple origins are comma-separated:

```bash
ALLOWED_ORIGINS=https://docs.example.com,https://staging.example.com node server.js
```
