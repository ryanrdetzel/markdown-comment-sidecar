const express = require('express');
const fs = require('fs');
const path = require('path');
const { marked } = require('marked');
const cors = require('cors');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS || '*';

// ─── Database setup ────────────────────────────────────────────────────────────

const DB_PATH = path.join(__dirname, 'comments.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Detect old schema and migrate if needed (element-level anchoring replaces text-offset anchoring)
try {
  db.prepare('SELECT anchor_element_type FROM threads LIMIT 1').get();
} catch {
  db.exec('DROP TABLE IF EXISTS messages; DROP TABLE IF EXISTS threads;');
}

db.exec(`
  CREATE TABLE IF NOT EXISTS threads (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    anchor_element_type TEXT NOT NULL DEFAULT 'p',
    anchor_element_index INTEGER NOT NULL DEFAULT 0,
    anchor_element_text TEXT NOT NULL DEFAULT '',
    anchor_selected_text TEXT,
    resolved INTEGER NOT NULL DEFAULT 0,
    resolved_at TEXT,
    resolved_comment TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_threads_document ON threads(document_id);

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    author TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id);
`);

// ─── Middleware ────────────────────────────────────────────────────────────────

const corsOptions = ALLOWED_ORIGINS === '*'
  ? { origin: '*' }
  : { origin: ALLOWED_ORIGINS.split(',').map(s => s.trim()) };

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getThreadsForDocument(documentId) {
  const threads = db.prepare(`
    SELECT id, document_id, anchor_element_type, anchor_element_index,
           anchor_element_text, anchor_selected_text,
           resolved, resolved_at, resolved_comment, created_at
    FROM threads WHERE document_id = ? ORDER BY created_at ASC
  `).all(documentId);

  return threads.map(t => {
    const messages = db.prepare(`
      SELECT id, text, author, created_at FROM messages
      WHERE thread_id = ? ORDER BY created_at ASC
    `).all(t.id);

    return {
      id: t.id,
      documentId: t.document_id,
      anchor: {
        elementType: t.anchor_element_type,
        elementIndex: t.anchor_element_index,
        elementText: t.anchor_element_text,
        selectedText: t.anchor_selected_text,
      },
      messages,
      resolved: t.resolved === 1,
      resolvedAt: t.resolved_at,
      resolvedComment: t.resolved_comment,
      createdAt: t.created_at,
    };
  });
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /api/document?documentId=xxx
app.get('/api/document', (req, res) => {
  const documentId = req.query.documentId || 'local';
  const mdPath = path.join(__dirname, 'sample.md');

  try {
    const markdown = fs.readFileSync(mdPath, 'utf8');
    const html = marked.parse(markdown);
    const threads = getThreadsForDocument(documentId);
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
    res.json({ threads: getThreadsForDocument(documentId) });
  } catch (err) {
    console.error('GET /api/threads error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/comment — creates a new thread
// Body: { documentId, text, author, elementType, elementIndex, elementText, selectedText }
app.post('/api/comment', (req, res) => {
  const { documentId, text, author, elementType, elementIndex, elementText, selectedText } = req.body;

  if (!documentId || !text || !elementType || elementIndex == null) {
    return res.status(400).json({ error: 'documentId, text, elementType, and elementIndex are required' });
  }

  const now = new Date().toISOString();
  const threadId = `thread_${Date.now()}`;
  const messageId = `${threadId}_m0`;

  db.prepare(`
    INSERT INTO threads (id, document_id, anchor_element_type, anchor_element_index,
                         anchor_element_text, anchor_selected_text, resolved, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?)
  `).run(threadId, documentId, elementType, elementIndex, elementText || '', selectedText || null, now);

  db.prepare(`
    INSERT INTO messages (id, thread_id, text, author, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(messageId, threadId, text, author || null, now);

  const thread = getThreadsForDocument(documentId).find(t => t.id === threadId);
  res.json({ success: true, thread });
});

// POST /api/thread/:id/reply
// Body: { text, author }
app.post('/api/thread/:id/reply', (req, res) => {
  const { id } = req.params;
  const { text, author } = req.body;
  if (!text) return res.status(400).json({ error: 'text is required' });

  const thread = db.prepare('SELECT id FROM threads WHERE id = ?').get(id);
  if (!thread) return res.status(404).json({ error: 'Thread not found' });

  const msgCount = db.prepare('SELECT COUNT(*) as n FROM messages WHERE thread_id = ?').get(id).n;
  const messageId = `${id}_m${msgCount}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO messages (id, thread_id, text, author, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(messageId, id, text, author || null, now);

  const message = db.prepare('SELECT id, text, author, created_at FROM messages WHERE id = ?').get(messageId);
  res.json({ success: true, message });
});

// POST /api/thread/:id/resolve
// Body: { comment? }
app.post('/api/thread/:id/resolve', (req, res) => {
  const { id } = req.params;
  const { comment } = req.body;

  const thread = db.prepare('SELECT id FROM threads WHERE id = ?').get(id);
  if (!thread) return res.status(404).json({ error: 'Thread not found' });

  db.prepare(`
    UPDATE threads SET resolved = 1, resolved_at = ?, resolved_comment = ? WHERE id = ?
  `).run(new Date().toISOString(), comment || null, id);

  res.json({ success: true });
});

// DELETE /api/thread/:id
app.delete('/api/thread/:id', (req, res) => {
  const { id } = req.params;

  const thread = db.prepare('SELECT id FROM threads WHERE id = ?').get(id);
  if (!thread) return res.status(404).json({ error: 'Thread not found' });

  db.prepare('DELETE FROM threads WHERE id = ?').run(id);
  res.json({ success: true });
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`CORS: ${ALLOWED_ORIGINS}`);
  console.log(`DB: ${DB_PATH}`);
});
