const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { marked } = require('./lib/marked-config');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const store = require('./lib/sidecar-store').init(
  process.env.DATA_DIR || path.join(__dirname, 'data')
);

const app = express();
const PORT = process.env.PORT || 3000;
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS || '*';

// Google OAuth + JWT config
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const JWT_SECRET = process.env.JWT_SECRET;
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;
const SERVER_URL = process.env.SERVER_URL || `http://localhost:${PORT}`;

if (ALLOWED_ORIGINS === '*') {
  console.log('CORS: open to all origins (ALLOWED_ORIGINS=*)');
}
if (!JWT_SECRET) {
  console.warn('WARNING: JWT_SECRET is not set — Google OAuth will not work. Set JWT_SECRET to enable auth.');
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
  ? { origin: true, credentials: true }   // reflect requesting origin — required when credentials: 'include' is used
  : {
      origin: ALLOWED_ORIGINS.split(',').map(s => s.trim()),
      credentials: true,
    };

const commentLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

app.use(cors(corsOptions));
app.use(cookieParser());
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Auth middleware ───────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  if (!JWT_SECRET) return res.status(503).json({ error: 'Auth not configured (JWT_SECRET missing)' });
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ─── Auth routes ──────────────────────────────────────────────────────────────

// Validate a return URL against the allowed origins list.
// Returns the URL if valid, APP_URL fallback if not.
function resolveReturnUrl(candidate) {
  if (!candidate) return APP_URL;
  try {
    const { origin } = new URL(candidate);
    if (ALLOWED_ORIGINS === '*') return candidate; // open — trust anything
    const allowed = ALLOWED_ORIGINS.split(',').map(s => s.trim());
    return allowed.includes(origin) ? candidate : APP_URL;
  } catch {
    return APP_URL;
  }
}

// GET /auth/google — redirect to Google consent
app.get('/auth/google', (req, res) => {
  if (!GOOGLE_CLIENT_ID || !JWT_SECRET) {
    return res.status(503).send('Google OAuth not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and JWT_SECRET.');
  }
  const returnTo = resolveReturnUrl(req.query.return_to);
  const redirectUri = `${SERVER_URL}/auth/google/callback`;
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state: returnTo,
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

// GET /auth/google/callback — exchange code, set session cookie, redirect to frontend
app.get('/auth/google/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code) return res.status(400).send('Missing authorization code');

  const redirectUri = `${SERVER_URL}/auth/google/callback`;
  try {
    // Exchange code for Google tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      console.error('OAuth token exchange failed:', tokenData);
      return res.status(502).send('Failed to obtain access token from Google');
    }

    // Fetch user info
    const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const user = await userRes.json();
    if (!user.sub) {
      return res.status(502).send('Failed to fetch user info from Google');
    }

    // Sign long-lived session cookie
    const sessionPayload = { sub: user.sub, email: user.email, name: user.name, picture: user.picture };
    const sessionToken = jwt.sign(sessionPayload, JWT_SECRET, { expiresIn: '30d' });

    const isHttps = SERVER_URL.startsWith('https://');
    res.cookie('sidecar_session', sessionToken, {
      httpOnly: true,
      secure: isHttps,
      sameSite: isHttps ? 'None' : 'Lax',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });

    const redirectTo = resolveReturnUrl(state);
    res.redirect(redirectTo);
  } catch (err) {
    console.error('OAuth callback error:', err);
    res.status(500).send('Authentication failed');
  }
});

// GET /auth/me — verify session cookie, return user + short-lived JWT
app.get('/auth/me', (req, res) => {
  if (!JWT_SECRET) return res.status(503).json({ error: 'Auth not configured' });
  const sessionToken = req.cookies.sidecar_session;
  if (!sessionToken) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const session = jwt.verify(sessionToken, JWT_SECRET);
    const token = jwt.sign(
      { sub: session.sub, email: session.email, name: session.name },
      JWT_SECRET,
      { expiresIn: '1h' }
    );
    res.json({ user: { name: session.name, email: session.email, picture: session.picture }, token });
  } catch {
    res.clearCookie('sidecar_session');
    res.status(401).json({ error: 'Session expired' });
  }
});

// POST /auth/logout — clear session cookie
app.post('/auth/logout', (req, res) => {
  res.clearCookie('sidecar_session');
  res.json({ success: true });
});

// ─── API routes ───────────────────────────────────────────────────────────────

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

const VALID_ELEMENT_TYPES = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'li', 'blockquote', 'td', 'th']);

// POST /api/comment — creates a new thread
app.post('/api/comment', commentLimiter, requireAuth, (req, res) => {
  const { documentId, text, elementType, elementIndex, elementText, selectedText } = req.body;

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
      { id: messageId, text, author: req.user.name, author_id: req.user.sub, createdAt: now },
    ],
  };

  store.addThread(documentId, thread);
  threadIndex.set(threadId, documentId);
  messageIndex.set(messageId, { documentId, threadId });
  res.json({ success: true, thread });
});

// POST /api/thread/:id/reply
app.post('/api/thread/:id/reply', commentLimiter, requireAuth, (req, res) => {
  const { id } = req.params;
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'text is required' });

  if (typeof text !== 'string' || text.length > 5000) {
    return res.status(400).json({ error: 'text must be a string under 5000 characters' });
  }

  const documentId = threadIndex.get(id);
  if (!documentId) return res.status(404).json({ error: 'Thread not found' });

  const messageId = crypto.randomUUID();
  const now = new Date().toISOString();
  const message = { id: messageId, text, author: req.user.name, author_id: req.user.sub, createdAt: now };

  if (!store.addReply(documentId, id, message)) {
    return res.status(404).json({ error: 'Thread not found' });
  }
  messageIndex.set(message.id, { documentId, threadId: id });
  res.json({ success: true, message });
});

// POST /api/thread/:id/resolve
app.post('/api/thread/:id/resolve', requireAuth, (req, res) => {
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
app.delete('/api/thread/:id', requireAuth, (req, res) => {
  const { id } = req.params;

  const documentId = threadIndex.get(id);
  if (!documentId) return res.status(404).json({ error: 'Thread not found' });

  if (!store.deleteThread(documentId, id)) {
    return res.status(404).json({ error: 'Thread not found' });
  }
  threadIndex.delete(id);
  res.json({ success: true });
});

// PUT /api/message/:id — edit a message's text
app.put('/api/message/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'text is required' });
  if (typeof text !== 'string' || text.length > 5000) {
    return res.status(400).json({ error: 'text must be a string under 5000 characters' });
  }

  const entry = messageIndex.get(id);
  if (!entry) return res.status(404).json({ error: 'Message not found' });

  const thread = store.getThread(entry.documentId, entry.threadId);
  const msg = thread?.messages.find(m => m.id === id);
  if (!msg) return res.status(404).json({ error: 'Message not found' });
  if (msg.author_id && msg.author_id !== req.user.sub) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (!store.editMessage(entry.documentId, entry.threadId, id, text)) {
    return res.status(404).json({ error: 'Message not found' });
  }
  res.json({ success: true });
});

// DELETE /api/message/:id — delete a single message (deletes thread if last message)
app.delete('/api/message/:id', requireAuth, (req, res) => {
  const { id } = req.params;

  const entry = messageIndex.get(id);
  if (!entry) return res.status(404).json({ error: 'Message not found' });

  const thread = store.getThread(entry.documentId, entry.threadId);
  const msg = thread?.messages.find(m => m.id === id);
  if (!msg) return res.status(404).json({ error: 'Message not found' });
  if (msg.author_id && msg.author_id !== req.user.sub) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const result = store.deleteMessage(entry.documentId, entry.threadId, id);
  if (!result) return res.status(404).json({ error: 'Message not found' });

  messageIndex.delete(id);
  if (result === 'thread-deleted') threadIndex.delete(entry.threadId);
  res.json({ success: true, threadDeleted: result === 'thread-deleted' });
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`CORS: ${ALLOWED_ORIGINS === '*' ? 'open (all origins)' : ALLOWED_ORIGINS}`);
  console.log(`Auth: ${GOOGLE_CLIENT_ID ? 'Google OAuth enabled' : 'No auth (GOOGLE_CLIENT_ID not set)'}`);
  console.log(`Data: ${path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'))}`);
});
