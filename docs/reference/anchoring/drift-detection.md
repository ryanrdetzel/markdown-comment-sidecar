---
title: Drift Detection
id: 4b8799b5e84d6d706a9db7a62fd394f0
---

# Drift Detection

When a document is edited after comments are added, anchors can shift. Drift detection identifies anchors that no longer point to the right content.

## What is drift?

Drift occurs when the element at the stored `(elementType, elementIndex)` position no longer contains the expected text (`anchor_element_text`).

Example:

1. User comments on the second paragraph (`p` index `1`), which reads *"The server handles routing."*
2. A writer inserts a new paragraph above it
3. Now `p` index `1` reads *"Install dependencies first."* — the original paragraph shifted to index `2`
4. The comment appears on the wrong paragraph. This is drift.

## How it's detected

Each thread stores `anchor_element_text` — a snapshot of the full text content of the anchor element at comment creation time.

At render time, the frontend can compare the stored snapshot against the current element text. If they don't match, the anchor has drifted.

**Current behavior**: drift is detected but not surfaced to the user. The comment still renders at the stored index position, which may be wrong.

**Planned behavior**: drifted comments show a warning badge ("anchor may have moved") and are visually distinct from well-anchored comments.

## Drift tolerance

Minor edits to the anchor element itself don't cause indexing drift (the element is still at the same index), but they do cause snapshot mismatch:

| Change | Index drift | Snapshot mismatch |
|---|---|---|
| Edit text within the anchor element | No | Yes |
| Add element *before* the anchor | Yes | Yes |
| Add element *after* the anchor | No | No |
| Delete the anchor element | Yes | Yes |
| Reorder elements around the anchor | Yes | Yes |

## Automatic re-anchoring

Re-anchoring is not yet implemented. The planned approach:

1. When the stored index position doesn't match `anchor_element_text`...
2. Search other elements of the same type for a text match
3. If a unique match is found, update `anchor_element_index` to the new position
4. If no match or ambiguous match, mark the thread as drifted

This would recover from insertions and deletions cleanly, as long as the anchor element itself wasn't edited.

## Fuzzy matching

For resilience against minor edits to the anchor element, approximate string matching (e.g. Levenshtein distance) could be used instead of exact equality. This is not implemented — the POC uses exact text comparison.

## Checking drift manually

```bash
# Find threads whose anchor text doesn't match current document content
# (Requires a rebuild and a custom script — not built-in)
node scripts/check-drift.js --input ./docs --site-id $(cat .site-id)
```

The `check-drift.js` script doesn't ship with the repo; this is a sketch of what it would look like.
