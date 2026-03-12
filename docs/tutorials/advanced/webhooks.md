---
title: Webhooks
id: c2359f6141145f16259cc12ef5fb9e56
---

# Webhooks

markdown-comment-sidecar doesn't ship with a webhook system, but adding one is straightforward. This tutorial shows how to emit events when threads are created, replied to, or resolved — and how to connect them to Slack, GitHub, or any HTTP endpoint.

## Why webhooks?

The comment server is the source of truth for all discussion. Without notifications, your team has to manually check the docs to see new comments. Webhooks let you push those events to wherever your team already pays attention.

Common uses:
- Post new comment threads to a Slack channel
- Open a GitHub Issue when a comment is created
- Notify the page author when someone comments on their section
- Trigger a CI job when a thread is resolved (e.g. to verify a fix)

## Adding webhook support to server.js

Define a webhook registry at the top of `server.js`:

```js
const WEBHOOK_URL = process.env.WEBHOOK_URL; // single URL for simplicity
```

Write a helper to fire the webhook:

```js
async function fireWebhook(event, payload) {
  if (!WEBHOOK_URL) return;
  try {
    await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, ...payload, ts: new Date().toISOString() }),
    });
  } catch (err) {
    console.error('Webhook delivery failed:', err.message);
  }
}
```

Call it after each mutating operation:

```js
// After creating a thread
app.post('/api/comment', (req, res) => {
  // ... existing logic ...
  const thread = createThread(/* ... */);
  res.json({ thread });

  fireWebhook('thread.created', {
    threadId: thread.id,
    documentId: thread.document_id,
    selectedText: thread.anchor_selected_text,
    firstMessage: req.body.text,
  });
});

// After a reply
app.post('/api/thread/:id/reply', (req, res) => {
  // ... existing logic ...
  fireWebhook('thread.replied', {
    threadId: req.params.id,
    message: req.body.text,
  });
});

// After resolve
app.post('/api/thread/:id/resolve', (req, res) => {
  // ... existing logic ...
  fireWebhook('thread.resolved', {
    threadId: req.params.id,
    resolvedComment: req.body.comment,
  });
});
```

## Connecting to Slack

Create a Slack incoming webhook URL from your workspace's app settings. Set it as the environment variable:

```bash
WEBHOOK_URL=https://hooks.slack.com/services/T.../B.../... node server.js
```

Slack expects a specific payload shape. Wrap `fireWebhook` in a Slack-specific formatter:

```js
async function fireSlackWebhook(event, payload) {
  if (!SLACK_WEBHOOK_URL) return;

  const messages = {
    'thread.created': `New comment on *${payload.documentId}*: "${payload.selectedText}"\n> ${payload.firstMessage}`,
    'thread.replied': `Reply on thread ${payload.threadId}: ${payload.message}`,
    'thread.resolved': `Thread ${payload.threadId} resolved. ${payload.resolvedComment || ''}`,
  };

  await fetch(SLACK_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: messages[event] || event }),
  });
}
```

## Connecting to GitHub Issues

Use the GitHub REST API to create an issue when a new thread is started:

```js
async function createGitHubIssue(payload) {
  const { GITHUB_TOKEN, GITHUB_REPO } = process.env;
  if (!GITHUB_TOKEN || !GITHUB_REPO) return;

  await fetch(`https://api.github.com/repos/${GITHUB_REPO}/issues`, {
    method: 'POST',
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: `Doc comment: "${payload.selectedText}"`,
      body: `**Document**: ${payload.documentId}\n**Thread**: ${payload.threadId}\n\n${payload.firstMessage}`,
      labels: ['docs-comment'],
    }),
  });
}
```

## Securing webhooks

If your webhook receiver needs to verify that events came from your comment server, add an HMAC signature:

```js
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

async function fireWebhook(event, payload) {
  if (!WEBHOOK_URL) return;
  const body = JSON.stringify({ event, ...payload });
  const sig = WEBHOOK_SECRET
    ? require('crypto').createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex')
    : undefined;

  await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(sig ? { 'X-Sidecar-Signature': sig } : {}),
    },
    body,
  });
}
```

The receiver verifies `X-Sidecar-Signature` against its own HMAC computation using the shared secret.

## Multiple webhook targets

For multiple targets (Slack + GitHub + custom), use an array:

```js
const WEBHOOK_URLS = (process.env.WEBHOOK_URLS || '').split(',').filter(Boolean);

async function fireWebhook(event, payload) {
  await Promise.allSettled(
    WEBHOOK_URLS.map(url =>
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event, ...payload }),
      })
    )
  );
}
```

`Promise.allSettled` ensures one failing target doesn't prevent others from receiving the event.
