# Document Anchoring Model

## Overview

Comments in this system are anchored to document **elements** rather than character offsets. This makes annotations resilient to minor edits — adding a sentence before a comment won't orphan it.

---

## How Anchoring Works

Each thread stores three pieces of information about where it lives in the document:

| Field | Description |
|-------|-------------|
| `elementType` | The HTML tag of the element (`h1`, `h2`, `p`, `li`, etc.) |
| `elementIndex` | The nth element of that type in the document (zero-based) |
| `elementText` | A text snapshot taken at the time the comment was created |

### Example

If a user highlights text inside the third paragraph of a document:

```json
{
  "elementType": "p",
  "elementIndex": 2,
  "elementText": "This is the paragraph the user commented on.",
  "selectedText": "the user commented on"
}
```

When the document is rendered, the system walks all `<p>` elements, finds index 2, and injects the highlight there.

---

## Drift Detection

If the element at the stored index no longer matches `elementText`, the thread is flagged as **orphaned**. Orphaned threads still appear in the sidebar but are not highlighted in the document.

This can happen when:
- The paragraph a comment was anchored to is deleted
- The order of elements changes significantly

---

## Trade-offs

Element-based anchoring is simpler and more robust than character-offset approaches for most use cases. The main limitation is granularity — you can anchor to a paragraph, but not to an arbitrary character range within it.

For document review workflows where comments are tied to specific words or phrases, the `selectedText` field preserves the user's selection for display purposes, even though the actual anchor is at the element level.
