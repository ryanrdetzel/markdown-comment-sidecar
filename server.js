const express = require('express');
const fs = require('fs');
const path = require('path');
const { marked } = require('marked');
const DiffMatchPatch = require('diff-match-patch');

const app = express();
const PORT = 3000;

const SAMPLE_MD = path.join(__dirname, 'sample.md');
const COMMENTS_FILE = path.join(__dirname, 'comments.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function loadThreads() {
  if (!fs.existsSync(COMMENTS_FILE)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(COMMENTS_FILE, 'utf8'));
    // Migrate old single-comment format to thread format
    return raw.map(item => {
      if (!item.messages) {
        return {
          id: item.id,
          anchor: item.anchor,
          messages: [{ id: item.id + '_m0', text: item.text, createdAt: item.createdAt }],
        };
      }
      return item;
    });
  } catch {
    return [];
  }
}

function saveThreads(threads) {
  fs.writeFileSync(COMMENTS_FILE, JSON.stringify(threads, null, 2));
}

function reAnchor(markdown, thread) {
  const dmp = new DiffMatchPatch();
  const { anchor } = thread;
  const searchStr = anchor.prefix + anchor.context + anchor.suffix;

  if (searchStr.length > dmp.Match_MaxBits) {
    const start = Math.max(0, anchor.offset_guess - anchor.context.length);
    let idx = markdown.indexOf(anchor.context, start);
    if (idx === -1) idx = markdown.indexOf(anchor.context);
    if (idx === -1) return { ...thread, currentOffset: -1, orphaned: true };
    return { ...thread, currentOffset: idx, orphaned: false };
  }

  const idx = dmp.match_main(markdown, searchStr, anchor.offset_guess);
  if (idx === -1) return { ...thread, currentOffset: -1, orphaned: true };
  return { ...thread, currentOffset: idx + anchor.prefix.length, orphaned: false };
}

// GET /api/document
app.get('/api/document', (req, res) => {
  try {
    const markdown = fs.readFileSync(SAMPLE_MD, 'utf8');
    const html = marked.parse(markdown);
    const threads = loadThreads();
    const reAnchored = threads.map(t => reAnchor(markdown, t));

    res.json({
      html,
      markdown,
      threads: reAnchored.map(t => ({
        id: t.id,
        currentOffset: t.currentOffset,
        anchor: t.anchor,
        orphaned: t.orphaned,
        messages: t.messages,
      })),
    });
  } catch (err) {
    console.error('GET /api/document error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/comment — creates a new thread
app.post('/api/comment', (req, res) => {
  const { text, selectedText, offset } = req.body;
  if (!text || !selectedText || offset == null) {
    return res.status(400).json({ error: 'text, selectedText, and offset are required' });
  }

  const markdown = fs.readFileSync(SAMPLE_MD, 'utf8');
  const CONTEXT_LEN = 20;
  const prefix = markdown.slice(Math.max(0, offset - CONTEXT_LEN), offset);
  const suffix = markdown.slice(offset + selectedText.length, offset + selectedText.length + CONTEXT_LEN);
  const now = new Date().toISOString();
  const threadId = `thread_${Date.now()}`;

  const thread = {
    id: threadId,
    anchor: { context: selectedText, prefix, suffix, offset_guess: offset },
    messages: [{ id: `${threadId}_m0`, text, createdAt: now }],
  };

  const threads = loadThreads();
  threads.push(thread);
  saveThreads(threads);

  res.json({ success: true, thread });
});

// POST /api/thread/:id/reply — adds a reply to an existing thread
app.post('/api/thread/:id/reply', (req, res) => {
  const { id } = req.params;
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'text is required' });

  const threads = loadThreads();
  const thread = threads.find(t => t.id === id);
  if (!thread) return res.status(404).json({ error: 'Thread not found' });

  const msg = { id: `${id}_m${thread.messages.length}`, text, createdAt: new Date().toISOString() };
  thread.messages.push(msg);
  saveThreads(threads);

  res.json({ success: true, message: msg });
});

// DELETE /api/thread/:id — removes an entire thread
app.delete('/api/thread/:id', (req, res) => {
  const { id } = req.params;
  const threads = loadThreads();
  const filtered = threads.filter(t => t.id !== id);

  if (filtered.length === threads.length) {
    return res.status(404).json({ error: 'Thread not found' });
  }

  saveThreads(filtered);
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
