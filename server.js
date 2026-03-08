const express = require('express');
const fs = require('fs');
const path = require('path');
const { marked } = require('marked');
const cors = require('cors');
const store = require('./lib/sidecar-store').init(
  process.env.DATA_DIR || path.join(__dirname, 'data')
);

const app = express();
const PORT = process.env.PORT || 3000;
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS || '*';

// In-memory index: threadId → documentId (populated when threads are read)
const threadIndex = new Map();

function indexThreads(documentId, threads) {
  for (const t of threads) threadIndex.set(t.id, documentId);
}

// ─── Middleware ────────────────────────────────────────────────────────────────

const corsOptions = ALLOWED_ORIGINS === '*'
  ? { origin: '*' }
  : { origin: ALLOWED_ORIGINS.split(',').map(s => s.trim()) };

app.use(cors(corsOptions));
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  }
});

// POST /api/comment — creates a new thread
app.post('/api/comment', (req, res) => {
  const { documentId, text, author, elementType, elementIndex, elementText, selectedText } = req.body;

  if (!documentId || !text || !elementType || elementIndex == null) {
    return res.status(400).json({ error: 'documentId, text, elementType, and elementIndex are required' });
  }

  const now = new Date().toISOString();
  const threadId = `thread_${Date.now()}`;
  const messageId = `${threadId}_m0`;

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
  res.json({ success: true, thread });
});

// POST /api/thread/:id/reply
app.post('/api/thread/:id/reply', (req, res) => {
  const { id } = req.params;
  const { text, author } = req.body;
  if (!text) return res.status(400).json({ error: 'text is required' });

  const documentId = threadIndex.get(id);
  if (!documentId) return res.status(404).json({ error: 'Thread not found' });

  const threads = store.getThreads(documentId);
  const thread = threads.find(t => t.id === id);
  if (!thread) return res.status(404).json({ error: 'Thread not found' });

  const messageId = `${id}_m${thread.messages.length}`;
  const now = new Date().toISOString();
  const message = { id: messageId, text, author: author || null, createdAt: now };

  store.addReply(documentId, id, message);
  res.json({ success: true, message });
});

// POST /api/thread/:id/resolve
app.post('/api/thread/:id/resolve', (req, res) => {
  const { id } = req.params;
  const { comment } = req.body;

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

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`CORS: ${ALLOWED_ORIGINS}`);
  console.log(`Data: ${path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'))}`);
});
