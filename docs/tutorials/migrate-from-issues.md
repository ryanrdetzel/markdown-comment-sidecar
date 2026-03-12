---
title: Migrate from GitHub Issues
id: migrate-from-issues
---

# Migrate from GitHub Issues

If your team uses GitHub Issues (or Notion comments, Linear, etc.) to track feedback on documentation, you can migrate open items to markdown-comment-sidecar and anchor them to the relevant passages.

This is a manual process — there's no automated migration script. This tutorial shows how to do it systematically.

## Before you start

You'll need:
- The comment server running and the `data/` directory initialized
- The docs built with a stable site ID
- The `documentId` for each page you're migrating

### Getting a document ID

If your docs are already built, you can find the document ID by opening the page in a browser and checking the API request in DevTools:

```
GET /api/document?documentId=<your-id-is-here>
```

Or compute it directly:

```bash
node -e "
const crypto = require('crypto');
const siteId = process.argv[1];
const filePath = process.argv[2];
console.log(crypto.createHash('sha256').update(siteId + ':' + filePath).digest('hex').slice(0, 32));
" your-site-id docs/getting-started.md
```

## Step 1: Identify issues to migrate

Go through your open GitHub Issues (or wherever feedback lives) and pick the ones that are document-specific — "this section is confusing", "this example is wrong", "can we add X here".

Group them by document.

## Step 2: Find the anchor element

For each issue, decide which passage in the document it refers to. Open the built docs page and identify:

- What element type is it? (paragraph, heading, list item?)
- What is its index? (count from the top, starting at 0, among elements of the same type)

You can use browser DevTools to inspect the element and find its position:

```js
// Paste in DevTools console
// Replace 'p' with the element type you're looking for
const els = document.querySelectorAll('.content p');
Array.from(els).forEach((el, i) => console.log(i, el.textContent.slice(0, 60)));
```

This logs each paragraph with its index. Find the one matching your issue.

## Step 3: Create the thread via API

Use `curl` or any HTTP client to create the thread directly:

```bash
curl -X POST https://comments.example.com/api/comment \
  -H "Content-Type: application/json" \
  -d '{
    "documentId": "<document-id>",
    "text": "From GitHub Issue #42: This example is broken on Windows because of path separators. See https://github.com/org/repo/issues/42",
    "author": "migration-script",
    "elementType": "p",
    "elementIndex": 3,
    "elementText": "Run the following command to install...",
    "selectedText": ""
  }'
```

The `text` field of the first message is a good place to include the original issue link.

## Step 4: Add replies for context

If the issue has existing discussion worth preserving, add it as replies:

```bash
THREAD_ID="<id from step 3 response>"

curl -X POST https://comments.example.com/api/thread/$THREAD_ID/reply \
  -H "Content-Type: application/json" \
  -d '{
    "text": "@alice: Can confirm, reproducible on Windows 11. The fix should be to use path.join() instead of string concatenation.",
    "author": "migration-script"
  }'
```

## Step 5: Resolve migrated threads

Once you've migrated an issue and closed it on GitHub, you can resolve the thread in the sidecar with a closing note:

```bash
curl -X POST https://comments.example.com/api/thread/$THREAD_ID/resolve \
  -H "Content-Type: application/json" \
  -d '{
    "comment": "Fixed in commit abc1234. Updated example to use path.join()."
  }'
```

## Batch migration script

For larger migrations, write a script that reads from your issue tracker's API and calls the sidecar API for each one. Pseudocode:

```js
const issues = await fetchGitHubIssues({ label: 'docs', state: 'open' });

for (const issue of issues) {
  const { documentId, elementType, elementIndex, elementText } = lookupAnchor(issue);

  const { threadId } = await createThread({
    documentId,
    text: `[Migrated from #${issue.number}] ${issue.body}`,
    author: issue.user.login,
    elementType,
    elementIndex,
    elementText,
  });

  for (const comment of issue.comments) {
    await addReply(threadId, comment.body, comment.user.login);
  }

  await closeGitHubIssue(issue.number);
}
```

The `lookupAnchor()` function is the hard part — it requires a mapping from issue → document passage, which you'll likely have to build manually or infer from issue labels/links.
