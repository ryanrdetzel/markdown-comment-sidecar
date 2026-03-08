---
id: 203c2041d628f30e008ce7c34f35c4e1
title: API Design Guidelines
---

# API Design Guidelines

## 1. Overview

This document outlines conventions and best practices for designing consistent, predictable APIs across the platform. Following these guidelines ensures a coherent developer experience and reduces integration friction.

---

## 2. URL Structure

### 2.1 Resource Naming

Use nouns, not verbs. URLs identify resources — actions are expressed through HTTP methods.

```
# Good
GET /api/documents
POST /api/documents
DELETE /api/documents/:id

# Avoid
GET /api/getDocuments
POST /api/createDocument
```

### 2.2 Nesting

Limit nesting to two levels. Deeper nesting becomes unwieldy and couples clients tightly to resource structure.

```
# Acceptable
GET /api/documents/:id/comments

# Avoid
GET /api/users/:userId/documents/:docId/sections/:sectionId/comments
```

### 2.3 Versioning

Version APIs at the URL prefix rather than via headers or query parameters. Explicit URL versioning is easier to route, cache, and document.

```
/api/v1/documents
/api/v2/documents
```

---

## 3. HTTP Methods

| Method | Purpose | Idempotent |
|--------|---------|------------|
| GET | Retrieve a resource | Yes |
| POST | Create a new resource | No |
| PUT | Replace a resource entirely | Yes |
| PATCH | Partially update a resource | No |
| DELETE | Remove a resource | Yes |

Use the correct method for the operation. A `GET` request must never modify state.

---

## 4. Request & Response Format

### 4.1 Content Type

All endpoints accept and return `application/json` unless handling binary uploads.

### 4.2 Request Bodies

Use camelCase for all JSON field names.

```json
{
  "documentId": "abc123",
  "selectedText": "the highlighted passage",
  "commentText": "This needs clarification."
}
```

### 4.3 Response Envelope

Successful responses return the resource directly, not wrapped in a generic envelope:

```json
{
  "id": "thread_001",
  "documentId": "abc123",
  "resolved": false,
  "messages": []
}
```

Error responses use a consistent shape:

```json
{
  "error": "documentId is required"
}
```

---

## 5. Status Codes

Use standard HTTP status codes accurately:

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created |
| 400 | Bad request — client error, validation failure |
| 401 | Unauthenticated |
| 403 | Unauthorized |
| 404 | Resource not found |
| 409 | Conflict |
| 500 | Server error |

Do not return `200` for errors. Do not return `500` for client mistakes.

---

## 6. Pagination

For collections that may grow large, support cursor-based pagination:

```
GET /api/documents?after=cursor_xyz&limit=20
```

Response includes pagination metadata:

```json
{
  "items": [...],
  "nextCursor": "cursor_abc",
  "hasMore": true
}
```

Avoid offset-based pagination for real-time data — inserts and deletes during pagination cause items to be skipped or duplicated.

---

## 7. Error Handling

### 7.1 Validation Errors

Return a 400 with a descriptive message pointing to the offending field:

```json
{
  "error": "Missing required field: elementType"
}
```

For multiple validation errors, return them all at once rather than forcing clients to fix issues one at a time.

### 7.2 Server Errors

Log the full error server-side. Return a generic message to clients — do not leak stack traces or internal state:

```json
{
  "error": "An unexpected error occurred. Please try again."
}
```

---

## 8. Security Considerations

- Validate and sanitize all input
- Never expose internal identifiers that reveal implementation details
- Set appropriate CORS origins — avoid `*` in production
- Rate-limit write endpoints
- Log access to sensitive resources for auditability
