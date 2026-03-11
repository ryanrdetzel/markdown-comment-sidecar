// ─── Config ───────────────────────────────────────────────────────────────────
// In static-site mode, window.SIDECAR_CONFIG carries only serverUrl + documentId.
// HTML is rendered directly in #doc-content; markdown is in #markdown-source.
// In local dev mode, we fall back to same-origin with documentId 'local'.

const config = window.SIDECAR_CONFIG || {
  serverUrl: '',          // empty = same origin
  documentId: 'local',
};

function apiUrl(path) {
  return config.serverUrl + path;
}

// ─── Auth / identity ──────────────────────────────────────────────────────────

let currentUser = null;  // { name, email, picture }
let authToken = null;    // short-lived JWT, in memory only

function getAuthHeader() {
  return authToken ? { Authorization: `Bearer ${authToken}` } : {};
}

async function initAuth() {
  try {
    const res = await fetch(apiUrl('/auth/me'), { credentials: 'include' });
    if (!res.ok) { currentUser = null; authToken = null; return; }
    const data = await res.json();
    currentUser = data.user;
    authToken = data.token;
  } catch {
    currentUser = null;
    authToken = null;
  }
}

async function logout() {
  await fetch(apiUrl('/auth/logout'), { method: 'POST', credentials: 'include' });
  currentUser = null;
  authToken = null;
  updateAuthorDisplay();
}

// ─── State ────────────────────────────────────────────────────────────────────

let state = {
  markdown: '',
  html: '',
  threads: [],
  selection: null,       // { elementType, elementIndex, elementText, selectedText }
  view: 'preview',       // 'preview' | 'markdown'
  sidebarMode: 'list',   // 'list' | 'block'
  sidebarTab: 'active',  // 'active' | 'resolved'
  activeThreadId: null,
  expandedThreadIds: new Set(), // threads with expanded conversation visible
};

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const docContent = document.getElementById('doc-content');
const commentsList = document.getElementById('comments-list');
const commentCount = document.getElementById('comment-count');
const sidebarHeader = document.getElementById('sidebar-header');
const addBtn = document.getElementById('add-comment-btn');
const replyArea = document.getElementById('reply-area');
const replyInput = document.getElementById('reply-input');
const btnPreview = document.getElementById('btn-preview');
const btnMarkdown = document.getElementById('btn-markdown');
const authorDisplay = document.getElementById('author-display');

// ─── Author UI ────────────────────────────────────────────────────────────────

function updateAuthorDisplay() {
  if (currentUser) {
    authorDisplay.innerHTML = `Commenting as <strong>${escapeHtml(currentUser.name)}</strong> · <button id="logout-btn">sign out</button>`;
    document.getElementById('logout-btn').addEventListener('click', logout);
  } else {
    const isHttp = window.location.protocol === 'http:' || window.location.protocol === 'https:';
    const returnTo = isHttp ? encodeURIComponent(window.location.origin + window.location.pathname + window.location.search) : null;
    const signInUrl = apiUrl('/auth/google') + (returnTo ? `?return_to=${returnTo}` : '');
    authorDisplay.innerHTML = `<a href="${signInUrl}" id="signin-btn">Sign in with Google</a>`;
  }
}

// ─── Element-level anchoring helpers ──────────────────────────────────────────

const BLOCK_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'PRE', 'BLOCKQUOTE', 'TD', 'TH']);

// Walk up the DOM from a node to find the nearest block-level element.
function getBlockElement(node) {
  let el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  while (el && el !== docContent) {
    if (BLOCK_TAGS.has(el.tagName)) return el;
    el = el.parentElement;
  }
  return null;
}

// 0-based index of el among all elements of the same tag in docContent.
function getElementIndex(el) {
  return Array.from(docContent.querySelectorAll(el.tagName.toLowerCase())).indexOf(el);
}

// Find a block element by stored anchor. Tries by index first, falls back to text match.
function findElementByAnchor(anchor) {
  const els = docContent.querySelectorAll(anchor.elementType);
  if (anchor.elementIndex < els.length) return els[anchor.elementIndex];
  // Fallback: match by first 30 chars of stored element text
  const search = (anchor.elementText || '').slice(0, 30);
  if (!search) return null;
  for (const el of els) {
    if (el.textContent.trim().startsWith(search)) return el;
  }
  return null;
}

// Parse the raw markdown into a typed block index: [{ type, index, start, end }].
// Types map to HTML element tag names (p, h1-h6, pre, li, blockquote).
// Index is the 0-based count among blocks of the same type, matching getElementIndex().
function buildMarkdownBlockIndex(markdown) {
  const blocks = [];
  const counters = {};
  const lines = markdown.split('\n');
  let i = 0;
  let charPos = 0;

  function nextIndex(type) {
    counters[type] = (counters[type] || 0);
    return counters[type]++;
  }

  while (i < lines.length) {
    const line = lines[i];
    const lineLen = line.length + 1;

    // Blank line
    if (line.trim() === '') { charPos += lineLen; i++; continue; }

    // Thematic break
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { charPos += lineLen; i++; continue; }

    // ATX heading (# through ######)
    const headingMatch = line.match(/^(#{1,6})\s/);
    if (headingMatch) {
      const type = `h${headingMatch[1].length}`;
      blocks.push({ type, index: nextIndex(type), start: charPos, end: charPos + line.length });
      charPos += lineLen; i++;
      continue;
    }

    // Fenced code block (``` or ~~~)
    const fenceMatch = line.match(/^(`{3,}|~{3,})/);
    if (fenceMatch) {
      const fence = fenceMatch[1];
      const start = charPos;
      charPos += lineLen; i++;
      while (i < lines.length && !lines[i].startsWith(fence)) { charPos += lines[i].length + 1; i++; }
      if (i < lines.length) { charPos += lines[i].length + 1; i++; } // closing fence
      blocks.push({ type: 'pre', index: nextIndex('pre'), start, end: charPos });
      continue;
    }

    // Blockquote
    if (line.startsWith('>')) {
      const start = charPos;
      while (i < lines.length && lines[i].startsWith('>')) { charPos += lines[i].length + 1; i++; }
      blocks.push({ type: 'blockquote', index: nextIndex('blockquote'), start, end: charPos });
      continue;
    }

    // List item (-, *, +, or 1.)
    if (/^(\*|-|\+|\d+\.)\s/.test(line)) {
      const start = charPos;
      charPos += lineLen; i++;
      while (i < lines.length && /^\s+\S/.test(lines[i])) { charPos += lines[i].length + 1; i++; }
      blocks.push({ type: 'li', index: nextIndex('li'), start, end: charPos });
      continue;
    }

    // Table row (skip — td/th mapping is too complex for this POC)
    if (line.includes('|') && line.trim().startsWith('|')) {
      while (i < lines.length && lines[i].trim() !== '' && lines[i].includes('|')) {
        charPos += lines[i].length + 1; i++;
      }
      continue;
    }

    // Paragraph: consume until a blank line or block-level marker
    const start = charPos;
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].match(/^#{1,6}\s|^(`{3,}|~{3,})|^>|^(\*|-|\+|\d+\.)\s|^(-{3,}|\*{3,}|_{3,})\s*$/)
    ) {
      charPos += lines[i].length + 1; i++;
    }
    if (charPos > start) {
      blocks.push({ type: 'p', index: nextIndex('p'), start, end: charPos });
    }
  }

  return blocks;
}

// Find the markdown source range for a thread's anchor using type+index (no text search).
function findMarkdownBlockRange(anchor) {
  const blocks = buildMarkdownBlockIndex(state.markdown);
  const block = blocks.find(b => b.type === anchor.elementType && b.index === anchor.elementIndex);
  return block ? { start: block.start, end: block.end } : null;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#39;').replace(/"/g, '&quot;');
}

function authorColor(name) {
  if (!name) return 'var(--accent)';
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i);
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 65%, 42%)`;
}

// ─── Rendering ────────────────────────────────────────────────────────────────

async function load() {
  const markdownEl = document.getElementById('markdown-source');
  if (markdownEl) {
    // Static build: markdown is embedded in the page, HTML is already in the DOM
    state.markdown = markdownEl.textContent;
    state.html = docContent.innerHTML;
  } else {
    const res = await fetch(apiUrl(`/api/document?documentId=${encodeURIComponent(config.documentId)}`), { credentials: 'include' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load document');
    state.markdown = data.markdown;
    state.html = data.html;
  }

  renderView();
  renderSidebar();

  try {
    const threadsRes = await fetch(apiUrl(`/api/threads?documentId=${encodeURIComponent(config.documentId)}`), { credentials: 'include' });
    const threadsData = await threadsRes.json();
    if (!threadsRes.ok) throw new Error(threadsData.error || 'Failed to load threads');
    state.threads = threadsData.threads;
    renderView();
    renderSidebar();
  } catch (err) {
    console.warn('Could not load threads:', err.message);
  }
}

function renderView() {
  if (state.view === 'markdown') {
    renderMarkdownView();
  } else {
    renderPreviewView();
  }
}

function renderPreviewView() {
  docContent.innerHTML = state.html;
  highlightThreads();
  addBtn.style.display = 'none';
}

// Apply block-level highlights to the rendered preview.
// Adds CSS classes to the block element — no DOM Range manipulation needed.
function highlightThreads() {
  // Clear previous highlights
  docContent.querySelectorAll('.cmt-block-highlight').forEach(el => {
    el.classList.remove('cmt-block-highlight', 'cmt-block-active', 'cmt-block-resolved');
    delete el.dataset.cmtIds;
    delete el.dataset.cmtCount;
    if (el._cmtHandler) {
      el.removeEventListener('click', el._cmtHandler);
      delete el._cmtHandler;
    }
  });

  for (const t of state.threads) {
    if (t.resolved && t.id !== state.activeThreadId) continue;
    const el = findElementByAnchor(t.anchor);
    if (!el) { t.orphaned = true; continue; }
    t.orphaned = false;

    // Track multiple thread IDs on the same element (e.g. two comments on same paragraph)
    const ids = el.dataset.cmtIds ? el.dataset.cmtIds.split(',') : [];
    if (!ids.includes(t.id)) ids.push(t.id);
    el.dataset.cmtIds = ids.join(',');

    el.classList.add('cmt-block-highlight');
    if (t.resolved) el.classList.add('cmt-block-resolved');
    if (t.id === state.activeThreadId) el.classList.add('cmt-block-active');

    // Accumulate message count across multiple threads on the same element
    const prev = parseInt(el.dataset.cmtCount || '0');
    el.dataset.cmtCount = String(prev + t.messages.length);

    if (!el._cmtHandler) {
      el._cmtHandler = () => {
        const ids = el.dataset.cmtIds.split(',');
        if (ids.length === 1) {
          openThread(ids[0]);
        } else {
          openBlockThreads(ids);
        }
      };
      el.addEventListener('click', el._cmtHandler);
    }
  }
}

function renderMarkdownView() {
  addBtn.style.display = 'none';

  const md = state.markdown;
  const blocks = state.threads
    .filter(t => !t.orphaned && (!t.resolved || t.id === state.activeThreadId))
    .map(t => {
      const range = findMarkdownBlockRange(t.anchor);
      return range ? { ...range, id: t.id, resolved: t.resolved } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);

  let html = '';
  let pos = 0;
  for (const b of blocks) {
    if (b.start < pos) continue; // skip overlapping ranges
    html += escapeHtml(md.slice(pos, b.start));
    const isActive = b.id === state.activeThreadId ? ' active' : '';
    const isResolved = b.resolved ? ' resolved' : '';
    html += `<mark class="cmt-highlight${isActive}${isResolved}" data-cmt-id="${b.id}">${escapeHtml(md.slice(b.start, b.end))}</mark>`;
    pos = b.end;
  }
  html += escapeHtml(md.slice(pos));

  docContent.innerHTML = `<pre class="md-source">${html}</pre>`;
  docContent.querySelectorAll('mark.cmt-highlight').forEach(m => {
    m.addEventListener('click', () => openThread(m.dataset.cmtId));
  });
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function renderSidebar() {
  renderThreadList();
}

function renderThreadList() {
  state.sidebarMode = 'list';
  replyArea.style.display = 'none';

  sidebarHeader.innerHTML = '';

  const allEls = Array.from(docContent.querySelectorAll('*'));
  const domOrder = t => {
    const el = findElementByAnchor(t.anchor);
    return el ? allEls.indexOf(el) : Infinity;
  };
  const active = state.threads.filter(t => !t.resolved).sort((a, b) => domOrder(a) - domOrder(b));
  const resolved = state.threads.filter(t => t.resolved).sort((a, b) => domOrder(a) - domOrder(b));
  const shown = state.sidebarTab === 'resolved' ? resolved : active;

  const tabs = document.createElement('div');
  tabs.className = 'sidebar-tabs';

  for (const [key, label, count] of [['active', 'Open', active.length], ['resolved', 'Resolved', resolved.length]]) {
    const btn = document.createElement('button');
    btn.className = 'sidebar-tab' + (state.sidebarTab === key ? ' active' : '');
    btn.innerHTML = `${label} <span class="tab-count">${count}</span>`;
    btn.addEventListener('click', () => {
      state.sidebarTab = key;
      renderThreadList();
    });
    tabs.appendChild(btn);
  }
  sidebarHeader.appendChild(tabs);

  // Preserve the new-comment form if it's open
  const existingForm = commentsList.querySelector('.new-comment-form');

  if (shown.length === 0) {
    commentsList.innerHTML = `<div class="empty-state">${
      state.sidebarTab === 'resolved'
        ? 'No resolved threads yet.'
        : 'Select text in the document to add a comment.'
    }</div>`;
    if (existingForm) {
      commentsList.innerHTML = '';
      commentsList.appendChild(existingForm);
    }
    return;
  }

  commentsList.innerHTML = '';
  for (const thread of shown) {
    commentsList.appendChild(buildThreadCard(thread));
  }

  if (existingForm && state.selection) {
    // Insert form at the position matching where the new thread will land in doc order
    const allEls = Array.from(docContent.querySelectorAll('*'));
    const selEl = docContent.querySelectorAll(state.selection.elementType)[state.selection.elementIndex];
    const selPos = selEl ? allEls.indexOf(selEl) : -1;
    const cards = Array.from(commentsList.children);
    const insertBefore = cards.find(card => {
      const threadId = card.dataset.id;
      const thread = shown.find(t => t.id === threadId);
      if (!thread) return false;
      const el = findElementByAnchor(thread.anchor);
      return el && allEls.indexOf(el) > selPos;
    });
    commentsList.insertBefore(existingForm, insertBefore || null);
  }
}

function buildMessageBubble(msg, threadId) {
  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';

  const text = document.createElement('div');
  text.className = 'message-text';
  text.textContent = msg.text;

  const meta = document.createElement('div');
  meta.className = 'message-meta';

  const metaLeft = document.createElement('span');
  metaLeft.className = 'message-meta-left';

  if (msg.author) {
    const authorEl = document.createElement('span');
    authorEl.className = 'message-author';
    authorEl.textContent = msg.author;
    authorEl.style.color = authorColor(msg.author);
    metaLeft.appendChild(authorEl);
  }

  const date = document.createElement('span');
  date.className = 'message-date';
  date.textContent = new Date(msg.created_at || msg.createdAt).toLocaleString();
  if (msg.editedAt) date.title = 'Edited ' + new Date(msg.editedAt).toLocaleString();
  metaLeft.appendChild(date);
  meta.appendChild(metaLeft);

  if (currentUser && msg.author_id === currentUser.sub && threadId) {
    const actions = document.createElement('span');
    actions.className = 'message-actions';

    const editBtn = document.createElement('button');
    editBtn.className = 'msg-action-link';
    editBtn.textContent = 'edit';
    editBtn.onclick = (e) => {
      e.stopPropagation();
      showMessageEditForm(msg, threadId, bubble, text);
    };

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'msg-action-link msg-delete-link';
    deleteBtn.textContent = 'delete';
    deleteBtn.onclick = (e) => {
      e.stopPropagation();
      showMessageDeleteConfirm(msg, threadId, bubble, deleteBtn);
    };

    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);
    meta.appendChild(actions);
  }

  bubble.appendChild(text);
  bubble.appendChild(meta);
  return bubble;
}

function showMessageEditForm(msg, _threadId, bubble, textEl) {
  if (bubble.querySelector('.msg-edit-form')) return;

  const form = document.createElement('div');
  form.className = 'msg-edit-form';

  const ta = document.createElement('textarea');
  ta.value = msg.text;
  ta.rows = 3;

  const formActions = document.createElement('div');
  formActions.className = 'msg-edit-actions';

  const cancel = document.createElement('button');
  cancel.className = 'btn-cancel';
  cancel.textContent = 'Cancel';
  cancel.onclick = () => form.remove();

  const save = document.createElement('button');
  save.className = 'btn-save';
  save.textContent = 'Save';
  save.onclick = async () => {
    const newText = ta.value.trim();
    if (!newText || newText === msg.text) { form.remove(); return; }
    save.disabled = true;
    try {
      const res = await fetch(apiUrl(`/api/message/${msg.id}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        credentials: 'include',
        body: JSON.stringify({ text: newText }),
      });
      if (!res.ok) throw new Error('Failed to save');
      msg.text = newText;
      textEl.textContent = newText;
      form.remove();
    } finally {
      save.disabled = false;
    }
  };

  ta.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save.click();
    if (e.key === 'Escape') form.remove();
    if (e.key === 'Tab') { e.preventDefault(); save.focus(); }
  });

  formActions.appendChild(cancel);
  formActions.appendChild(save);
  form.appendChild(ta);
  form.appendChild(formActions);
  bubble.appendChild(form);
  ta.focus();
  ta.select();
}

function showMessageDeleteConfirm(msg, _threadId, bubble, _deleteBtn) {
  if (bubble.querySelector('.msg-delete-confirm')) return;

  const confirm = document.createElement('div');
  confirm.className = 'msg-delete-confirm';

  const label = document.createElement('span');
  label.textContent = 'Delete this message?';

  const yes = document.createElement('button');
  yes.className = 'msg-action-link msg-delete-link';
  yes.textContent = 'yes';
  yes.onclick = async () => {
    yes.disabled = true;
    try {
      const res = await fetch(apiUrl(`/api/message/${msg.id}`), {
        method: 'DELETE',
        headers: { ...getAuthHeader() },
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to delete');
      const data = await res.json();
      if (data.threadDeleted) {
        state.activeThreadId = null;
        state.expandedThreadIds.clear();
      }
      await load();
    } finally {
      yes.disabled = false;
    }
  };

  const no = document.createElement('button');
  no.className = 'msg-action-link';
  no.textContent = 'no';
  no.onclick = () => confirm.remove();

  confirm.appendChild(label);
  confirm.appendChild(yes);
  confirm.appendChild(no);
  bubble.appendChild(confirm);
}

function buildThreadCard(thread) {
  const first = thread.messages[0];
  const last = thread.messages[thread.messages.length - 1];
  const count = thread.messages.length;
  const isActive = thread.id === state.activeThreadId;
  const isExpanded = state.expandedThreadIds.has(thread.id);

  const card = document.createElement('div');
  card.className = 'comment-card'
    + (thread.orphaned ? ' orphaned' : '')
    + (thread.resolved ? ' resolved' : '')
    + (isActive ? ' active' : '')
    + (isExpanded ? ' expanded' : '');
  card.dataset.id = thread.id;

  // Anchor quote — always visible
  const anchor = document.createElement('div');
  anchor.className = 'comment-anchor' + (thread.orphaned ? ' orphaned-label' : '');
  const ctx = thread.anchor.selectedText || thread.anchor.elementText || '';
  anchor.textContent = thread.orphaned
    ? '⚠ Orphaned — element was removed'
    : `"${ctx.slice(0, 55)}${ctx.length > 55 ? '…' : ''}"`;
  card.appendChild(anchor);

  if (isExpanded) {
    // ── Expanded: all messages + reply form ──────────────────────────────────

    if (thread.resolved) {
      const banner = document.createElement('div');
      banner.className = 'resolved-banner inline-resolved';
      const resolvedDate = new Date(thread.resolvedAt).toLocaleString();
      banner.innerHTML = `<strong>Resolved</strong>${resolvedDate}`;
      if (thread.resolvedComment) {
        const note = document.createElement('div');
        note.style.cssText = 'margin-top:4px; font-style:italic;';
        note.textContent = `"${thread.resolvedComment}"`;
        banner.appendChild(note);
      }
      card.appendChild(banner);
    }

    for (const msg of thread.messages) {
      card.appendChild(buildMessageBubble(msg, thread.id));
    }

    if (!thread.resolved && currentUser) {
      card.appendChild(buildInlineReplyForm(thread));
    }

    // Footer: collapse + delete
    const footer = document.createElement('div');
    footer.className = 'card-footer';

    const collapseBtn = document.createElement('button');
    collapseBtn.className = 'collapse-thread-btn';
    collapseBtn.textContent = '▴ Collapse';
    collapseBtn.onclick = (e) => {
      e.stopPropagation();
      state.expandedThreadIds.delete(thread.id);
      renderThreadList();
    };
    footer.appendChild(collapseBtn);

    card.appendChild(footer);

  } else {
    // ── Collapsed: first + last preview ──────────────────────────────────────

    const firstEl = document.createElement('div');
    firstEl.className = 'comment-text';
    firstEl.textContent = first.text.length > 80 ? first.text.slice(0, 80) + '…' : first.text;
    card.appendChild(firstEl);

    const lastText = thread.resolvedComment || (count > 1 ? last.text : null);
    if (lastText) {
      const sep = document.createElement('div');
      sep.className = 'thread-sep';
      sep.textContent = '···';

      const lastEl = document.createElement('div');
      lastEl.className = 'comment-text last';
      lastEl.textContent = lastText.length > 80 ? lastText.slice(0, 80) + '…' : lastText;

      card.appendChild(sep);
      card.appendChild(lastEl);
    }

    const meta = document.createElement('div');
    meta.className = 'comment-meta';

    const authorDateEl = document.createElement('span');
    authorDateEl.className = 'comment-date';
    if (first.author) {
      const authorSpan = document.createElement('span');
      authorSpan.textContent = first.author;
      authorSpan.style.color = authorColor(first.author);
      authorDateEl.appendChild(authorSpan);
      authorDateEl.appendChild(document.createTextNode(' · '));
    }
    authorDateEl.appendChild(document.createTextNode(new Date(first.created_at || first.createdAt).toLocaleString()));
    meta.appendChild(authorDateEl);

    if (thread.resolved) {
      const badge = document.createElement('span');
      badge.className = 'resolved-badge';
      badge.textContent = 'Resolved';
      meta.appendChild(badge);
    }

    const expandBtn = document.createElement('button');
    expandBtn.className = 'expand-thread-btn';
    if (count > 1) {
      expandBtn.textContent = `${count - 1} repl${count - 1 === 1 ? 'y' : 'ies'} ▾`;
    } else if (thread.resolved || !currentUser) {
      expandBtn.textContent = 'View ▾';
    } else {
      expandBtn.textContent = 'Reply ▾';
    }
    expandBtn.onclick = (e) => {
      e.stopPropagation();
      state.expandedThreadIds.add(thread.id);
      setActiveThread(thread.id);
      renderThreadList();
      // scroll the card into view after render
      requestAnimationFrame(() => {
        const el = commentsList.querySelector(`.comment-card[data-id="${thread.id}"]`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    };
    meta.appendChild(expandBtn);
    card.appendChild(meta);

    // Clicking the card expands and highlights the doc element
    card.addEventListener('click', () => openThread(thread.id));
  }

  return card;
}

function buildInlineReplyForm(thread) {
  const form = document.createElement('div');
  form.className = 'inline-reply-form';

  const ta = document.createElement('textarea');
  ta.placeholder = 'Reply…';
  ta.rows = 2;

  const actions = document.createElement('div');
  actions.className = 'inline-reply-actions';

  // Split resolve button
  const resolveGroup = document.createElement('div');
  resolveGroup.className = 'resolve-btn-group';

  const resolveMain = document.createElement('button');
  resolveMain.className = 'btn-resolve-main';
  resolveMain.textContent = 'Resolve';
  resolveMain.onclick = () => resolveThread(thread.id, null);

  const resolveArrow = document.createElement('button');
  resolveArrow.className = 'btn-resolve-arrow';
  resolveArrow.textContent = '▾';

  const dropdown = document.createElement('div');
  dropdown.className = 'resolve-dropdown';
  dropdown.hidden = true;

  const withComment = document.createElement('button');
  withComment.textContent = 'Resolve with comment';
  withComment.onclick = () => {
    dropdown.hidden = true;
    showInlineResolveForm(thread.id, form);
  };
  dropdown.appendChild(withComment);

  resolveArrow.onclick = (e) => {
    e.stopPropagation();
    dropdown.hidden = !dropdown.hidden;
  };
  document.addEventListener('click', () => { dropdown.hidden = true; }, { once: true });

  resolveGroup.appendChild(resolveMain);
  resolveGroup.appendChild(resolveArrow);
  resolveGroup.appendChild(dropdown);

  const replyBtn = document.createElement('button');
  replyBtn.className = 'btn-reply';
  replyBtn.textContent = 'Reply';
  replyBtn.onclick = async () => {
    const text = ta.value.trim();
    if (!text) return;
    replyBtn.disabled = true;
    try {
      const res = await fetch(apiUrl(`/api/thread/${thread.id}/reply`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        credentials: 'include',
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error('Failed to post reply');
      state.expandedThreadIds.add(thread.id);
      state.activeThreadId = thread.id;
      await load();
    } finally {
      replyBtn.disabled = false;
    }
  };

  ta.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) replyBtn.click();
    if (e.key === 'Tab') { e.preventDefault(); replyBtn.focus(); }
  });

  actions.appendChild(resolveGroup);
  actions.appendChild(replyBtn);
  form.appendChild(ta);
  form.appendChild(actions);
  return form;
}

function showInlineResolveForm(threadId, container) {
  container.querySelector('.inline-resolve-form')?.remove();

  const form = document.createElement('div');
  form.className = 'inline-resolve-form resolve-form';

  const ta = document.createElement('textarea');
  ta.placeholder = 'Why is this being resolved? (optional)';
  ta.rows = 2;

  const formActions = document.createElement('div');
  formActions.className = 'resolve-form-actions';

  const cancel = document.createElement('button');
  cancel.className = 'btn-resolve-cancel';
  cancel.textContent = 'Cancel';
  cancel.onclick = () => form.remove();

  const confirm = document.createElement('button');
  confirm.className = 'btn-resolve-confirm';
  confirm.textContent = 'Resolve & Close';
  confirm.onclick = () => resolveThread(threadId, ta.value.trim() || null);

  ta.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) resolveThread(threadId, ta.value.trim() || null);
    if (e.key === 'Tab') { e.preventDefault(); confirm.focus(); }
  });

  formActions.appendChild(cancel);
  formActions.appendChild(confirm);
  form.appendChild(ta);
  form.appendChild(formActions);
  container.appendChild(form);
  ta.focus();
}


// ─── Thread actions ───────────────────────────────────────────────────────────

function openBlockThreads(ids) {
  // Expand all threads on this block, set first as active
  state.expandedThreadIds.clear();
  ids.forEach(id => state.expandedThreadIds.add(id));
  state.activeThreadId = ids[0];
  state.sidebarMode = 'list';
  state.blockFilterIds = null;

  if (sidebar && sidebar.classList.contains('collapsed')) {
    sidebar.classList.remove('collapsed');
    sidebarResizer.classList.remove('hidden');
    btnSidebarToggle.innerHTML = '&#x00BB;';
    btnSidebarToggle.title = 'Hide sidebar';
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, 'false');
  }
  updateMobileBackdrop();

  // Mark all threads on this block as active in the doc
  docContent.querySelectorAll('.cmt-block-highlight').forEach(el => {
    const elIds = el.dataset.cmtIds ? el.dataset.cmtIds.split(',') : [];
    el.classList.toggle('cmt-block-active', ids.some(id => elIds.includes(id)));
  });

  renderSidebar();

  // Scroll sidebar to the first thread
  requestAnimationFrame(() => {
    const el = commentsList.querySelector(`.comment-card[data-id="${ids[0]}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
}

// setActiveThread: update doc highlights without changing sidebar mode or expansion
function setActiveThread(id) {
  if (sidebar && sidebar.classList.contains('collapsed')) {
    sidebar.classList.remove('collapsed');
    sidebarResizer.classList.remove('hidden');
    btnSidebarToggle.innerHTML = '&#x00BB;';
    btnSidebarToggle.title = 'Hide sidebar';
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, 'false');
  }
  updateMobileBackdrop();

  const prevResolved = state.activeThreadId
    ? state.threads.find(t => t.id === state.activeThreadId)?.resolved
    : false;
  const nextResolved = state.threads.find(t => t.id === id)?.resolved;

  state.activeThreadId = id;

  if (prevResolved || nextResolved) {
    renderView();
  } else {
    docContent.querySelectorAll('.cmt-block-highlight').forEach(el => {
      const ids = el.dataset.cmtIds ? el.dataset.cmtIds.split(',') : [];
      el.classList.toggle('cmt-block-active', ids.includes(id));
    });
    docContent.querySelectorAll('mark.cmt-highlight').forEach(m => {
      m.classList.toggle('active', m.dataset.cmtId === id);
    });
  }

  // Scroll doc to the highlighted element
  const thread = state.threads.find(t => t.id === id);
  if (thread) {
    const el = state.view === 'preview'
      ? findElementByAnchor(thread.anchor)
      : docContent.querySelector(`mark.cmt-highlight[data-cmt-id="${id}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

// openThread: expand + activate (called from doc clicks and after new comment)
function openThread(id) {
  state.expandedThreadIds.clear();
  state.expandedThreadIds.add(id);
  state.sidebarMode = 'list';
  setActiveThread(id);
  renderSidebar();
  requestAnimationFrame(() => {
    const el = commentsList.querySelector(`.comment-card[data-id="${id}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
}

function closeThread() {
  const wasResolved = state.activeThreadId
    ? state.threads.find(t => t.id === state.activeThreadId)?.resolved
    : false;

  if (state.activeThreadId) state.expandedThreadIds.delete(state.activeThreadId);
  state.activeThreadId = null;
  state.sidebarMode = 'list';

  if (wasResolved) {
    renderView();
  } else {
    docContent.querySelectorAll('.cmt-block-active').forEach(el => el.classList.remove('cmt-block-active'));
    docContent.querySelectorAll('mark.cmt-highlight.active').forEach(m => m.classList.remove('active'));
  }

  renderSidebar();
}

async function resolveThread(threadId, comment) {
  await fetch(apiUrl(`/api/thread/${threadId}/resolve`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    credentials: 'include',
    body: JSON.stringify({ comment }),
  });
  state.activeThreadId = null;
  state.sidebarMode = 'list';
  state.expandedThreadIds.delete(threadId);
  await load();
}

async function deleteThread(id) {
  await fetch(apiUrl(`/api/thread/${id}`), {
    method: 'DELETE',
    headers: { ...getAuthHeader() },
    credentials: 'include',
  });
  state.activeThreadId = null;
  state.sidebarMode = 'list';
  state.expandedThreadIds.delete(id);
  await load();
}

// ─── Selection handling ───────────────────────────────────────────────────────

document.addEventListener('mouseup', (e) => {
  if (e.target === addBtn || commentsList.querySelector('.new-comment-form')?.contains(e.target)) return;

  // Comment creation is only supported in preview view.
  // Markdown view is read-only for annotations — switch to preview to comment.
  if (state.view !== 'preview') {
    addBtn.style.display = 'none';
    state.selection = null;
    return;
  }

  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
    addBtn.style.display = 'none';
    state.selection = null;
    return;
  }

  const selectedText = sel.toString().trim();
  if (!selectedText || selectedText.length < 2) {
    addBtn.style.display = 'none';
    state.selection = null;
    return;
  }

  const range = sel.getRangeAt(0);
  if (!docContent.contains(range.commonAncestorContainer)) {
    addBtn.style.display = 'none';
    state.selection = null;
    return;
  }

  // Find the block element the selection starts in
  const blockEl = getBlockElement(range.startContainer);
  if (!blockEl) {
    addBtn.style.display = 'none';
    state.selection = null;
    return;
  }

  // If the selection spans multiple blocks, collapse it to end at the first block boundary
  const endBlockEl = getBlockElement(range.endContainer);
  let crossBlock = false;
  if (endBlockEl && endBlockEl !== blockEl) {
    crossBlock = true;
    range.setEndAfter(blockEl);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  const trimmedText = sel.toString().trim();

  state.selection = {
    elementType: blockEl.tagName.toLowerCase(),
    elementIndex: getElementIndex(blockEl),
    elementText: blockEl.textContent.trim().slice(0, 80),
    selectedText: trimmedText.length <= 200 ? trimmedText : trimmedText.slice(0, 200) + '…',
    crossBlock,
  };

  if (!currentUser) return;

  const rect = range.getBoundingClientRect();
  addBtn.style.display = 'block';
  addBtn.style.left = `${rect.left + rect.width / 2 + window.scrollX}px`;
  addBtn.style.top = `${rect.top + window.scrollY - 36}px`;
  addBtn.title = crossBlock ? 'Selection trimmed to one section' : '';
});

addBtn.addEventListener('click', () => {
  if (!state.selection) return;
  addBtn.style.display = 'none';
  openNewCommentForm();
});

function openNewCommentForm() {
  // Ensure sidebar is visible
  if (sidebar && sidebar.classList.contains('collapsed')) {
    sidebar.classList.remove('collapsed');
    sidebarResizer.classList.remove('hidden');
    btnSidebarToggle.innerHTML = '&#x00BB;';
    btnSidebarToggle.title = 'Hide sidebar';
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, 'false');
  }
  updateMobileBackdrop();

  // Remove any existing new-comment form
  commentsList.querySelector('.new-comment-form')?.remove();

  const form = document.createElement('div');
  form.className = 'new-comment-form';

  // Selected text context
  const quote = document.createElement('div');
  quote.className = 'new-comment-quote';
  quote.textContent = state.selection.selectedText || state.selection.elementText;
  form.appendChild(quote);

  if (state.selection.crossBlock) {
    const note = document.createElement('div');
    note.className = 'cross-block-note';
    note.textContent = 'Selection trimmed to one section — comments are per block.';
    form.appendChild(note);
  }

  const ta = document.createElement('textarea');
  ta.placeholder = 'Add a comment…';
  ta.rows = 3;
  form.appendChild(ta);

  const actions = document.createElement('div');
  actions.className = 'new-comment-actions';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn-cancel';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.onclick = () => closeNewCommentForm();

  const submitBtn = document.createElement('button');
  submitBtn.className = 'btn-submit';
  submitBtn.textContent = 'Comment';
  submitBtn.onclick = () => submitNewComment(ta, submitBtn);

  ta.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitNewComment(ta, submitBtn);
    if (e.key === 'Escape') closeNewCommentForm();
    if (e.key === 'Tab') { e.preventDefault(); submitBtn.focus(); }
  });

  actions.appendChild(cancelBtn);
  actions.appendChild(submitBtn);
  form.appendChild(actions);

  // Temporarily append so renderThreadList can find and position it correctly
  commentsList.appendChild(form);
  renderThreadList();
  ta.focus();
}

function closeNewCommentForm() {
  commentsList.querySelector('.new-comment-form')?.remove();
  state.selection = null;
  window.getSelection()?.removeAllRanges();
}

async function submitNewComment(ta, submitBtn) {
  const text = ta.value.trim();
  if (!text || !state.selection) return;

  const { elementType, elementIndex, elementText, selectedText } = state.selection;

  submitBtn.disabled = true;
  try {
    const res = await fetch(apiUrl('/api/comment'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      credentials: 'include',
      body: JSON.stringify({
        documentId: config.documentId,
        text,
        elementType,
        elementIndex,
        elementText,
        selectedText,
      }),
    });
    if (!res.ok) throw new Error('Failed to save comment');
    const data = await res.json();
    closeNewCommentForm();
    await load();
    openThread(data.thread.id);
  } finally {
    submitBtn.disabled = false;
  }
}

// ─── Heading anchor clicks (copy link + smooth scroll) ────────────────────────

docContent.addEventListener('click', (e) => {
  const anchor = e.target.closest('a.heading-anchor');
  if (!anchor) return;
  e.preventDefault();
  const id = anchor.getAttribute('href').slice(1);
  const url = window.location.origin + window.location.pathname + window.location.search + '#' + id;
  history.pushState(null, '', '#' + id);
  navigator.clipboard?.writeText(url);
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// ─── View toggle ──────────────────────────────────────────────────────────────

btnPreview.addEventListener('click', () => {
  if (state.view === 'preview') return;
  state.view = 'preview';
  btnPreview.classList.add('active');
  btnMarkdown.classList.remove('active');
  renderView();
});

btnMarkdown.addEventListener('click', () => {
  if (state.view === 'markdown') return;
  state.view = 'markdown';
  btnMarkdown.classList.add('active');
  btnPreview.classList.remove('active');
  renderView();
});

// ─── Sidebar resize / collapse ────────────────────────────────────────────────

const sidebar = document.getElementById('sidebar');
const sidebarResizer = document.getElementById('sidebar-resizer');
const btnSidebarToggle = document.getElementById('btn-sidebar-toggle');

const SIDEBAR_WIDTH_KEY = 'sidecar_sidebar_width';
const SIDEBAR_COLLAPSED_KEY = 'sidecar_sidebar_collapsed';

function updateMobileBackdrop() {
  const backdrop = document.getElementById('sidebar-backdrop');
  if (!backdrop) return;
  if (window.innerWidth <= 768 && !sidebar.classList.contains('collapsed')) {
    backdrop.classList.add('visible');
  } else {
    backdrop.classList.remove('visible');
  }
}

function closeSidebarMobile() {
  sidebar.classList.add('collapsed');
  document.getElementById('sidebar-backdrop')?.classList.remove('visible');
  if (btnSidebarToggle) btnSidebarToggle.innerHTML = '&#x00AB;';
  localStorage.setItem(SIDEBAR_COLLAPSED_KEY, 'true');
}

function initSidebar() {
  if (!sidebar || !sidebarResizer || !btnSidebarToggle) return;
  const collapsed = localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
  const savedWidth = parseInt(localStorage.getItem(SIDEBAR_WIDTH_KEY)) || 320;
  sidebar.style.width = savedWidth + 'px';
  if (collapsed) {
    sidebar.classList.add('collapsed');
    sidebarResizer.classList.add('hidden');
    btnSidebarToggle.innerHTML = '&#x00AB;';
    btnSidebarToggle.title = 'Show sidebar';
  }

  const backdrop = document.getElementById('sidebar-backdrop');
  backdrop?.addEventListener('click', () => {
    if (window.innerWidth <= 768) closeSidebarMobile();
  });

  document.getElementById('doc-content')?.addEventListener('click', () => {
    if (window.innerWidth <= 768 && !sidebar.classList.contains('collapsed')) {
      closeSidebarMobile();
    }
  });
}

if (btnSidebarToggle) {
  btnSidebarToggle.addEventListener('click', () => {
    const isCollapsed = sidebar.classList.contains('collapsed');
    if (isCollapsed) {
      sidebar.classList.remove('collapsed');
      sidebarResizer.classList.remove('hidden');
      btnSidebarToggle.innerHTML = '&#x00BB;';
      btnSidebarToggle.title = 'Hide sidebar';
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, 'false');
    } else {
      sidebar.classList.add('collapsed');
      sidebarResizer.classList.add('hidden');
      btnSidebarToggle.innerHTML = '&#x00AB;';
      btnSidebarToggle.title = 'Show sidebar';
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, 'true');
    }
    updateMobileBackdrop();
  });
}

let _isResizing = false;

if (sidebarResizer) {
  sidebarResizer.addEventListener('mousedown', (e) => {
    _isResizing = true;
    sidebarResizer.classList.add('dragging');
    sidebar.style.transition = 'none';
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });
}

document.addEventListener('mousemove', (e) => {
  if (!_isResizing) return;
  const layoutRect = document.querySelector('.layout').getBoundingClientRect();
  const newWidth = Math.max(200, Math.min(600, layoutRect.right - e.clientX));
  sidebar.style.width = newWidth + 'px';
  localStorage.setItem(SIDEBAR_WIDTH_KEY, newWidth);
});

document.addEventListener('mouseup', () => {
  if (!_isResizing) return;
  _isResizing = false;
  sidebarResizer.classList.remove('dragging');
  sidebar.style.transition = '';
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
});

// ─── Init ─────────────────────────────────────────────────────────────────────

function renderNoIdWarning() {
  const existing = document.getElementById('no-id-warning');
  if (config.hasExplicitId === false) {
    if (!existing) {
      const banner = document.createElement('div');
      banner.id = 'no-id-warning';
      banner.className = 'no-id-warning';

      const heading = document.createElement('strong');
      heading.textContent = '⚠ No stable document ID';
      banner.appendChild(heading);

      banner.appendChild(document.createTextNode(' This file does not have an '));

      const code1 = document.createElement('code');
      code1.textContent = 'id:';
      banner.appendChild(code1);

      banner.appendChild(document.createTextNode(' field in its frontmatter. If the file is renamed or moved, existing comments will be lost. Add '));

      const code2 = document.createElement('code');
      code2.textContent = 'id: <slug>';
      banner.appendChild(code2);

      banner.appendChild(document.createTextNode(' to the frontmatter to pin its ID.'));

      const docPane = document.querySelector('.doc-pane');
      if (docPane) docPane.insertBefore(banner, docContent);
    }
  } else {
    if (existing) existing.remove();
  }
}

initSidebar();
renderNoIdWarning();
initAuth().then(() => {
  updateAuthorDisplay();
  load().then(() => {
    if (window.location.hash) {
      const target = document.getElementById(window.location.hash.slice(1));
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
});
