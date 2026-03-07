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

function loadComments() {
  if (!fs.existsSync(COMMENTS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(COMMENTS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveComments(comments) {
  fs.writeFileSync(COMMENTS_FILE, JSON.stringify(comments, null, 2));
}

function reAnchor(markdown, comment) {
  const dmp = new DiffMatchPatch();
  const { anchor } = comment;
  const searchStr = anchor.prefix + anchor.context + anchor.suffix;

  if (searchStr.length > dmp.Match_MaxBits) {
    // Pattern too long for bitap fuzzy match — fall back to indexOf
    const start = Math.max(0, anchor.offset_guess - anchor.context.length);
    let idx = markdown.indexOf(anchor.context, start);
    if (idx === -1) idx = markdown.indexOf(anchor.context);
    if (idx === -1) return { ...comment, currentOffset: -1, orphaned: true };
    return { ...comment, currentOffset: idx, orphaned: false };
  }

  const idx = dmp.match_main(markdown, searchStr, anchor.offset_guess);
  if (idx === -1) return { ...comment, currentOffset: -1, orphaned: true };
  return { ...comment, currentOffset: idx + anchor.prefix.length, orphaned: false };
}

// GET /api/document
app.get('/api/document', (req, res) => {
  try {
    const markdown = fs.readFileSync(SAMPLE_MD, 'utf8');
    const html = marked.parse(markdown);
    const comments = loadComments();
    const reAnchored = comments.map(c => reAnchor(markdown, c));

    res.json({
      html,
      markdown,
      comments: reAnchored.map(c => ({
        id: c.id,
        text: c.text,
        currentOffset: c.currentOffset,
        anchor: c.anchor,
        orphaned: c.orphaned,
        createdAt: c.createdAt,
      })),
    });
  } catch (err) {
    console.error('GET /api/document error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/comment
app.post('/api/comment', (req, res) => {
  const { text, selectedText, offset } = req.body;
  if (!text || !selectedText || offset == null) {
    return res.status(400).json({ error: 'text, selectedText, and offset are required' });
  }

  const markdown = fs.readFileSync(SAMPLE_MD, 'utf8');
  const CONTEXT_LEN = 20;
  const prefix = markdown.slice(Math.max(0, offset - CONTEXT_LEN), offset);
  const suffix = markdown.slice(offset + selectedText.length, offset + selectedText.length + CONTEXT_LEN);

  const comment = {
    id: `cmt_${Date.now()}`,
    text,
    anchor: {
      context: selectedText,
      prefix,
      suffix,
      offset_guess: offset,
    },
    createdAt: new Date().toISOString(),
  };

  const comments = loadComments();
  comments.push(comment);
  saveComments(comments);

  res.json({ success: true, comment });
});

// DELETE /api/comment/:id
app.delete('/api/comment/:id', (req, res) => {
  const { id } = req.params;
  const comments = loadComments();
  const filtered = comments.filter(c => c.id !== id);

  if (filtered.length === comments.length) {
    return res.status(404).json({ error: 'Comment not found' });
  }

  saveComments(filtered);
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
