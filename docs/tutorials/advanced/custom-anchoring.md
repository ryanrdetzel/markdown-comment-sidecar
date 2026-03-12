---
title: Custom Anchoring Strategies
id: 3b608d7df578a892c54f7e1c23111d8f
---

# Custom Anchoring Strategies

The default anchoring system attaches comments to block elements by type and index. This works well for most documentation, but you can extend or replace it for specialized use cases.

## How the default strategy works

1. User makes a selection
2. Frontend walks up the DOM to find the nearest block element
3. Counts elements of that type to get the index
4. Sends `{ elementType, elementIndex, elementText }` to the server
5. Server stores them; client uses them to inject highlights on load

All of this lives in `public/app.js` in the `getElementAnchor()` and `injectHighlights()` functions.

## Custom strategy: anchor to heading sections

Instead of anchoring to a specific paragraph, you might want to anchor comments to the *section* defined by the nearest preceding heading — so a comment on any paragraph in the "Installation" section is anchored to the section, not to a specific paragraph.

Override `getElementAnchor()`:

```js
function getElementAnchor(node) {
  // Walk up to the content container
  let el = node;
  while (el && !el.classList.contains('content')) {
    el = el.parentElement;
  }

  // Find the nearest preceding heading
  const allBlocks = Array.from(el.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li'));
  const nodeIndex = allBlocks.indexOf(getContainingBlock(node));

  // Walk backwards to find the heading
  for (let i = nodeIndex; i >= 0; i--) {
    if (/^H[1-6]$/.test(allBlocks[i].tagName)) {
      const heading = allBlocks[i];
      const tag = heading.tagName.toLowerCase();
      const headings = Array.from(el.querySelectorAll(tag));
      return {
        elementType: tag,
        elementIndex: headings.indexOf(heading),
        elementText: heading.textContent.trim(),
      };
    }
  }

  // Fall back to default behavior
  return defaultGetElementAnchor(node);
}
```

This changes the UX: all comments on a section collapse to the section heading. The comment sidebar would show section-level threads rather than paragraph-level threads.

## Custom strategy: anchor by ID attribute

If your markdown generates elements with stable `id` attributes (headings always get IDs from `marked`), you can anchor to those instead of using positional indexes:

```js
function getElementAnchor(node) {
  let el = getContainingBlock(node);

  // Walk up to find an element with an id
  let target = el;
  while (target && !target.id) {
    target = target.parentElement;
  }

  if (target && target.id) {
    return {
      elementType: 'id',
      elementIndex: 0,        // unused
      elementText: target.id, // store the ID instead of text snapshot
    };
  }

  return defaultGetElementAnchor(node);
}
```

Server-side, when re-injecting highlights, look up `document.getElementById(thread.anchor_element_text)` instead of using the positional query.

**Pros**: Immune to element reordering as long as heading text (and thus slug) doesn't change.
**Cons**: Only works for elements that have IDs. Headings do; paragraphs don't.

## Custom strategy: line-number anchoring

For code documentation where files have stable line numbers, you could anchor to line ranges within a `<pre>` block. This requires:

1. Rendering code blocks with per-line `<span>` wrappers (modify the `marked` renderer in `server.js`)
2. Changing `getElementAnchor()` to capture the line range
3. Changing `injectHighlights()` to highlight specific lines rather than using the Range API

This is the approach taken by GitHub's PR review comments and Gerrit's inline code review.

## Modifying the server

If your anchor strategy stores data in a non-standard way, you may need to extend the `threads` schema. Add a migration in `server.js` alongside the existing `CREATE TABLE` statements:

```js
db.exec(`
  ALTER TABLE threads ADD COLUMN anchor_section_id TEXT;
`);
```

SQLite supports `ADD COLUMN` without a full table rebuild.

## Testing your anchoring strategy

Use the `POST /api/comment` endpoint directly to create threads with your custom anchor data, then verify that highlight injection (`injectHighlights()`) correctly locates and marks the target elements:

```bash
curl -X POST http://localhost:3000/api/comment \
  -H "Content-Type: application/json" \
  -d '{
    "documentId": "local",
    "text": "Testing custom anchor",
    "elementType": "id",
    "elementIndex": 0,
    "elementText": "installation",
    "selectedText": "Install dependencies"
  }'
```

Open the dev server and verify the highlight appears on the correct element.
