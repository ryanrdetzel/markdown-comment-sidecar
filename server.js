const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { marked } = require('marked');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const store = require('./lib/sidecar-store').init(
  process.env.DATA_DIR || path.join(__dirname, 'data')
);

// Escape raw HTML blocks in markdown so injected HTML can't execute scripts.
marked.use({
  renderer: {
    html({ raw }) {
      return raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    },
  },
});

const app = express();
const PORT = process.env.PORT || 3000;
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS || '*';

if (process.env.NODE_ENV === 'production' && ALLOWED_ORIGINS === '*') {
  console.error('FATAL: ALLOWED_ORIGINS must be set in production. Refusing to start.');
  process.exit(1);
}
if (ALLOWED_ORIGINS === '*') {
  console.warn('WARNING: ALLOWED_ORIGINS is not set — CORS is open to all origins. Set ALLOWED_ORIGINS in production.');
}

// In-memory indexes (populated when threads are read)
const threadIndex = new Map();  // threadId → documentId
const messageIndex = new Map(); // messageId → { documentId, threadId }

function indexThreads(documentId, threads) {
  for (const t of threads) {
    threadIndex.set(t.id, documentId);
    for (const m of t.messages) {
      messageIndex.set(m.id, { documentId, threadId: t.id });
    }
  }
}

// ─── Middleware ────────────────────────────────────────────────────────────────

const corsOptions = ALLOWED_ORIGINS === '*'
  ? { origin: '*' }
  : { origin: ALLOWED_ORIGINS.split(',').map(s => s.trim()) };

const commentLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

app.use(cors(corsOptions));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /api/document?documentId=xxx  (dev mode convenience — serves sample.md)
app.get('/api/document', (req, res) => {
  const documentId = req.query.documentId || 'local';
  const mdPath = path.join(__dirname, 'sample.md');

  try {
    const markdown = fs.readFileSync(mdPath, 'utf8');
    const html = marked.parse(markdown);
    const threads = store.getThreads(documentId);
    indexThreads(documentId, threads);
    res.json({ html, markdown, threads });
  } catch (err) {
    console.error('GET /api/document error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/threads?documentId=xxx
app.get('/api/threads', (req, res) => {
  const { documentId } = req.query;
  if (!documentId) return res.status(400).json({ error: 'documentId is required' });

  try {
    const threads = store.getThreads(documentId);
    indexThreads(documentId, threads);
    res.json({ threads });
  } catch (err) {
    console.error('GET /api/threads error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/comment — creates a new thread
app.post('/api/comment', commentLimiter, (req, res) => {
  const { documentId, text, author, elementType, elementIndex, elementText, selectedText } = req.body;

  const VALID_ELEMENT_TYPES = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'li', 'blockquote', 'td', 'th']);

  if (!documentId || !text || !elementType || elementIndex == null) {
    return res.status(400).json({ error: 'documentId, text, elementType, and elementIndex are required' });
  }
  if (!VALID_ELEMENT_TYPES.has(elementType)) {
    return res.status(400).json({ error: 'Invalid elementType' });
  }
  if (!Number.isInteger(elementIndex) || elementIndex < 0) {
    return res.status(400).json({ error: 'elementIndex must be a non-negative integer' });
  }

  if (typeof text !== 'string' || text.length > 5000) {
    return res.status(400).json({ error: 'text must be a string under 5000 characters' });
  }
  if (author != null && (typeof author !== 'string' || author.length > 60)) {
    return res.status(400).json({ error: 'author must be a string under 60 characters' });
  }
  if (elementText != null && (typeof elementText !== 'string' || elementText.length > 200)) {
    return res.status(400).json({ error: 'elementText must be a string under 200 characters' });
  }
  if (selectedText != null && (typeof selectedText !== 'string' || selectedText.length > 500)) {
    return res.status(400).json({ error: 'selectedText must be a string under 500 characters' });
  }

  const now = new Date().toISOString();
  const threadId = crypto.randomUUID();
  const messageId = crypto.randomUUID();

  const thread = {
    id: threadId,
    anchor: {
      elementType,
      elementIndex,
      elementText: elementText || '',
      selectedText: selectedText || null,
    },
    resolved: false,
    resolvedAt: null,
    resolvedComment: null,
    createdAt: now,
    messages: [
      { id: messageId, text, author: author || null, createdAt: now },
    ],
  };

  store.addThread(documentId, thread);
  threadIndex.set(threadId, documentId);
  messageIndex.set(messageId, { documentId, threadId });
  res.json({ success: true, thread });
});

// POST /api/thread/:id/reply
app.post('/api/thread/:id/reply', commentLimiter, (req, res) => {
  const { id } = req.params;
  const { text, author } = req.body;
  if (!text) return res.status(400).json({ error: 'text is required' });

  if (typeof text !== 'string' || text.length > 5000) {
    return res.status(400).json({ error: 'text must be a string under 5000 characters' });
  }
  if (author != null && (typeof author !== 'string' || author.length > 60)) {
    return res.status(400).json({ error: 'author must be a string under 60 characters' });
  }

  const documentId = threadIndex.get(id);
  if (!documentId) return res.status(404).json({ error: 'Thread not found' });

  const threads = store.getThreads(documentId);
  const thread = threads.find(t => t.id === id);
  if (!thread) return res.status(404).json({ error: 'Thread not found' });

  const messageId = crypto.randomUUID();
  const now = new Date().toISOString();
  const message = { id: messageId, text, author: author || null, createdAt: now };

  store.addReply(documentId, id, message);
  messageIndex.set(message.id, { documentId, threadId: id });
  res.json({ success: true, message });
});

// POST /api/thread/:id/resolve
app.post('/api/thread/:id/resolve', (req, res) => {
  const { id } = req.params;
  const { comment } = req.body;

  if (comment != null && (typeof comment !== 'string' || comment.length > 500)) {
    return res.status(400).json({ error: 'comment must be a string under 500 characters' });
  }

  const documentId = threadIndex.get(id);
  if (!documentId) return res.status(404).json({ error: 'Thread not found' });

  if (!store.resolveThread(documentId, id, comment)) {
    return res.status(404).json({ error: 'Thread not found' });
  }
  res.json({ success: true });
});

// DELETE /api/thread/:id
app.delete('/api/thread/:id', (req, res) => {
  const { id } = req.params;

  const documentId = threadIndex.get(id);
  if (!documentId) return res.status(404).json({ error: 'Thread not found' });

  if (!store.deleteThread(documentId, id)) {
    return res.status(404).json({ error: 'Thread not found' });
  }
  threadIndex.delete(id);
  res.json({ success: true });
});

// PUT /api/message/:id — edit a message's text (author check is client-side)
app.put('/api/message/:id', (req, res) => {
  const { id } = req.params;
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'text is required' });
  if (typeof text !== 'string' || text.length > 5000) {
    return res.status(400).json({ error: 'text must be a string under 5000 characters' });
  }

  const entry = messageIndex.get(id);
  if (!entry) return res.status(404).json({ error: 'Message not found' });

  if (!store.editMessage(entry.documentId, entry.threadId, id, text)) {
    return res.status(404).json({ error: 'Message not found' });
  }
  res.json({ success: true });
});

// DELETE /api/message/:id — delete a single message (deletes thread if last message)
app.delete('/api/message/:id', (req, res) => {
  const { id } = req.params;

  const entry = messageIndex.get(id);
  if (!entry) return res.status(404).json({ error: 'Message not found' });

  const result = store.deleteMessage(entry.documentId, entry.threadId, id);
  if (!result) return res.status(404).json({ error: 'Message not found' });

  messageIndex.delete(id);
  if (result === 'thread-deleted') threadIndex.delete(entry.threadId);
  res.json({ success: true, threadDeleted: result === 'thread-deleted' });
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`CORS: ${ALLOWED_ORIGINS}`);
  console.log(`Data: ${path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'))}`);
});
