---
title: Your First Comment
id: 0d01f241b712c6ebffc2448f409437a8
---

# Your First Comment

This tutorial walks through creating a comment thread from scratch — from selecting text to resolving the discussion.

## Before you start

Make sure the dev server is running:

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000). You should see `sample.md` rendered with a sidebar on the right labeled **Comments**.

## Step 1: Select text

Click and drag to highlight any text in the document. For example, highlight the phrase *"Element-based anchoring"* in the first section.

When you release the mouse, a small **+ Add Comment** button appears near the selection.

> **Tip**: You can select text that spans multiple words or an entire sentence. The selection is stored as `anchor_selected_text` and shown in the thread card later.

## Step 2: Click "+ Add Comment"

The sidebar switches to a new comment form. The selected text is shown at the top of the form as context.

## Step 3: Write your comment

Type a message in the text area. For example:

> *"Should we add a diagram here to illustrate how anchoring works?"*

Press **Submit** (or Cmd/Ctrl+Enter).

## Step 4: View the thread

The sidebar switches to the thread view. Your message appears as the first entry. The selected text in the document is now highlighted in yellow.

You can:
- **Reply** — type in the reply box at the bottom and press Submit
- **Resolve** — click the **Resolve** button to close the discussion
- **Resolve with comment** — click the dropdown arrow next to Resolve to leave a closing note
- **Delete** — click the trash icon (removes the thread and all messages)

## Step 5: Reply to your thread

Type a reply in the box at the bottom of the thread view:

> *"Added to backlog — see issue #42."*

Submit it. The thread now has two messages.

## Step 6: Resolve the thread

Click **Resolve**. The thread moves to the **Resolved** tab in the sidebar. The yellow highlight disappears from the document.

Click **Resolved** in the sidebar tab bar to see it. You can click a resolved thread to read the full conversation. Clicking it again closes it and removes the highlight.

## What just happened

Behind the scenes, the comment was stored in `data/local.json` as:

```json
{
  "thread": {
    "id": "...",
    "document_id": "local",
    "anchor_element_type": "p",
    "anchor_element_index": 2,
    "anchor_element_text": "Element-based anchoring — each comment...",
    "anchor_selected_text": "Element-based anchoring",
    "resolved": 1
  },
  "messages": [
    { "text": "Should we add a diagram here...", "author": "you" },
    { "text": "Added to backlog — see issue #42.", "author": "you" }
  ]
}
```

The anchor remembers which paragraph the comment belongs to. If the document is edited slightly, the comment can still find its home.

## Next steps

- [Team Setup](team-setup.html) — share comments with collaborators
- [How It Works](../how-it-works.html) — deep dive into anchoring and document IDs
