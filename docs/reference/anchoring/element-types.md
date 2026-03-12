---
title: Anchor Element Types
id: 4dfcf2c4852ac9fe53c7c07558152291
---

# Anchor Element Types

When a comment is created, it is anchored to a specific HTML element in the rendered document. The element type is stored as an HTML tag name string.

## Supported element types

| Tag | Markdown source | Notes |
|---|---|---|
| `h1` | `# Heading` | ATX or setext style |
| `h2` | `## Heading` | |
| `h3` | `### Heading` | |
| `h4` | `#### Heading` | |
| `h5` | `##### Heading` | |
| `h6` | `###### Heading` | |
| `p` | Plain paragraph text | Most common anchor type |
| `li` | `- item` or `1. item` | Anchors to the `<li>`, not its parent `<ul>`/`<ol>` |
| `blockquote` | `> quoted text` | Outer `<blockquote>` element |
| `pre` | ` ``` ` code fences | The `<pre>` wrapper, not the inner `<code>` |
| `table` | Pipe-table syntax | Entire `<table>` element |
| `hr` | `---` or `***` | Rarely useful to comment on |

## How element index is calculated

The index is the zero-based position among **all elements of the same type** in the document, in document order.

Example document:

```markdown
# Introduction        ← h1, index 0

First paragraph.      ← p, index 0

## Details            ← h2, index 0

Second paragraph.     ← p, index 1

Third paragraph.      ← p, index 2

## Summary            ← h2, index 1
```

A comment on "Second paragraph." is stored as `{ elementType: "p", elementIndex: 1 }`.

## Inline vs block anchoring

The anchor is always a **block-level element**. If a user selects text that spans an inline element (bold, link, code span), the anchor is the containing block element.

If a selection spans multiple block elements, the anchor is the **first** block element the selection touches.

## Element types not supported

Some rendered elements aren't addressable as anchors:

- `<td>`, `<th>` — table cells (the whole `<table>` is the anchor instead)
- `<code>` — inline code spans (the containing `<p>` is the anchor)
- `<a>` — links (the containing `<p>` is the anchor)
- `<strong>`, `<em>` — emphasis (the containing `<p>` is the anchor)

## How the frontend determines the element

When a user makes a selection, the frontend walks up the DOM from the selection's anchor node until it finds a recognized block element. The element type and its index (counted by `querySelectorAll(type)`) are sent to the server.

See `getElementAnchor()` in `public/app.js` for the implementation.
