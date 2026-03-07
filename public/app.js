// ─── Config ───────────────────────────────────────────────────────────────────
// In static-site mode, window.SIDECAR_CONFIG is injected by the build step.
// In local dev mode, we fall back to same-origin with documentId 'local'.

const config = window.SIDECAR_CONFIG || {
  serverUrl: '',          // empty = same origin
  documentId: 'local',
};

function apiUrl(path) {
  return config.serverUrl + path;
}

// ─── Author / identity ────────────────────────────────────────────────────────

const AUTHOR_KEY = 'sidecar_author';
const THEME_KEY = 'sidecar_theme';

function getAuthor() {
  return localStorage.getItem(AUTHOR_KEY) || null;
}

function setAuthor(name) {
  localStorage.setItem(AUTHOR_KEY, name.trim());
}

// ─── Theme ────────────────────────────────────────────────────────────────────

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(THEME_KEY, theme);
}

function initTheme() {
  const themeSelect = document.getElementById('theme-select');
  const saved = localStorage.getItem(THEME_KEY) || 'classic';
  themeSelect.value = saved;
  applyTheme(saved);
  themeSelect.addEventListener('change', () => applyTheme(themeSelect.value));
}

// ─── State ────────────────────────────────────────────────────────────────────

let state = {
  markdown: '',
  html: '',
  threads: [],
  selection: null,
  view: 'preview',       // 'preview' | 'markdown'
  sidebarMode: 'list',   // 'list' | 'thread'
  sidebarTab: 'active',  // 'active' | 'resolved'
  activeThreadId: null,
};

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const docContent = document.getElementById('doc-content');
const commentsList = document.getElementById('comments-list');
const commentCount = document.getElementById('comment-count');
const sidebarHeader = document.getElementById('sidebar-header');
const addBtn = document.getElementById('add-comment-btn');
const replyArea = document.getElementById('reply-area');
const replyInput = document.getElementById('reply-input');
const modal = document.getElementById('comment-modal');
const modalSelectedText = document.getElementById('modal-selected-text');
const commentInput = document.getElementById('comment-input');
const modalCancel = document.getElementById('modal-cancel');
const modalSubmit = document.getElementById('modal-submit');
const btnPreview = document.getElementById('btn-preview');
const btnMarkdown = document.getElementById('btn-markdown');
const authorDisplay = document.getElementById('author-display');
const nameModal = document.getElementById('name-modal');
const nameInput = document.getElementById('name-input');
const nameSubmit = document.getElementById('name-submit');

// ─── Author UI ────────────────────────────────────────────────────────────────

function updateAuthorDisplay() {
  const name = getAuthor();
  if (name) {
    authorDisplay.innerHTML = `Commenting as <strong>${escapeHtml(name)}</strong> · <button id="change-name-btn">change</button>`;
    document.getElementById('change-name-btn').addEventListener('click', showNameModal);
  } else {
    authorDisplay.innerHTML = `<button id="set-name-btn">Set your name to comment</button>`;
    document.getElementById('set-name-btn').addEventListener('click', showNameModal);
  }
}

function showNameModal(onComplete) {
  nameInput.value = getAuthor() || '';
  nameModal.classList.add('open');
  nameInput.focus();
  nameSubmit._onComplete = typeof onComplete === 'function' ? onComplete : null;
}

function closeNameModal() {
  nameModal.classList.remove('open');
}

nameSubmit.addEventListener('click', () => {
  const name = nameInput.value.trim();
  if (!name) return;
  setAuthor(name);
  closeNameModal();
  updateAuthorDisplay();
  if (nameSubmit._onComplete) nameSubmit._onComplete();
});

nameInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') nameSubmit.click();
  if (e.key === 'Escape') closeNameModal();
});

nameModal.addEventListener('click', e => { if (e.target === nameModal) closeNameModal(); });

// ─── Re-anchoring (client-side) ───────────────────────────────────────────────
// The server stores raw anchor data; the client resolves current positions
// against the markdown it has in memory.

function reAnchor(thread) {
  const { anchor } = thread;
  const markdown = state.markdown;

  // Try near the original offset first (handles minor edits),
  // then fall back to a full scan.
  const start = Math.max(0, anchor.offset_guess - anchor.context.length);
  let idx = markdown.indexOf(anchor.context, start);
  if (idx === -1) idx = markdown.indexOf(anchor.context);

  if (idx === -1) return { ...thread, currentOffset: -1, orphaned: true };
  return { ...thread, currentOffset: idx, orphaned: false };
}

// ─── Offset mapping ───────────────────────────────────────────────────────────

function findTextInDOM(root, searchText) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let node;
  while ((node = walker.nextNode())) nodes.push(node);

  let combined = '';
  const positions = [];
  for (const n of nodes) {
    positions.push({ node: n, start: combined.length, length: n.nodeValue.length });
    combined += n.nodeValue;
  }

  const idx = combined.indexOf(searchText);
  if (idx === -1) return null;

  const endIdx = idx + searchText.length;

  function nodeAt(offset, allowAtEnd = false) {
    for (const p of positions) {
      const inRange = allowAtEnd
        ? (offset >= p.start && offset <= p.start + p.length)
        : (offset >= p.start && offset < p.start + p.length);
      if (inRange) return { node: p.node, offset: offset - p.start };
    }
    const last = positions[positions.length - 1];
    return { node: last.node, offset: last.length };
  }

  const startPos = nodeAt(idx);
  const endPos = nodeAt(endIdx, true);
  return {
    startNode: startPos.node,
    startOffset: startPos.offset,
    endNode: endPos.node,
    endOffset: endPos.offset,
  };
}

function wrapRange(startNode, startOffset, endNode, endOffset, threadId, orphaned, resolved = false) {
  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);

  const mark = document.createElement('mark');
  mark.className = 'cmt-highlight' + (orphaned ? ' orphaned' : '') + (resolved ? ' resolved' : '');
  mark.dataset.cmtId = threadId;
  mark.addEventListener('click', () => openThread(threadId));

  try {
    range.surroundContents(mark);
  } catch {
    const fragment = range.extractContents();
    mark.appendChild(fragment);
    range.insertNode(mark);
  }
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─── Rendering ────────────────────────────────────────────────────────────────

async function load() {
  // For static sites, HTML is pre-rendered and markdown is embedded in the page.
  // For local dev, we fetch both from the server.
  if (window.SIDECAR_CONFIG && window.SIDECAR_CONFIG.markdown) {
    // Static site mode: markdown embedded at build time
    state.markdown = window.SIDECAR_CONFIG.markdown;
    state.html = window.SIDECAR_CONFIG.html || '';
  } else {
    // Local dev mode: fetch document from server
    const res = await fetch(apiUrl(`/api/document?documentId=${encodeURIComponent(config.documentId)}`));
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load document');
    state.markdown = data.markdown;
    state.html = data.html;
  }

  // Render document immediately so the page isn't stuck on "Loading..."
  // even if the thread server is unreachable.
  renderView();
  renderSidebar();

  // Fetch threads separately — fail gracefully if server is down or unreachable.
  try {
    const threadsRes = await fetch(apiUrl(`/api/threads?documentId=${encodeURIComponent(config.documentId)}`));
    const threadsData = await threadsRes.json();
    if (!threadsRes.ok) throw new Error(threadsData.error || 'Failed to load threads');
    state.threads = threadsData.threads.map(reAnchor);
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

function highlightThreads() {
  docContent.querySelectorAll('mark.cmt-highlight').forEach(m => {
    const parent = m.parentNode;
    while (m.firstChild) parent.insertBefore(m.firstChild, m);
    parent.removeChild(m);
  });
  docContent.normalize();

  for (const t of state.threads) {
    if (t.orphaned) continue;
    if (t.resolved && t.id !== state.activeThreadId) continue;
    const result = findTextInDOM(docContent, t.anchor.context);
    if (result) {
      wrapRange(result.startNode, result.startOffset, result.endNode, result.endOffset, t.id, false, t.resolved);
    }
  }

  if (state.activeThreadId) {
    document.querySelectorAll('mark.cmt-highlight').forEach(m => {
      m.classList.toggle('active', m.dataset.cmtId === state.activeThreadId);
    });
  }
}

function renderMarkdownView() {
  addBtn.style.display = 'none';

  const md = state.markdown;
  const active = state.threads
    .filter(t => !t.orphaned && t.currentOffset >= 0 && (!t.resolved || t.id === state.activeThreadId))
    .map(t => ({ start: t.currentOffset, end: t.currentOffset + t.anchor.context.length, id: t.id }))
    .sort((a, b) => a.start - b.start);

  let html = '';
  let pos = 0;
  for (const t of active) {
    if (t.start < pos) continue;
    html += escapeHtml(md.slice(pos, t.start));
    const thread = state.threads.find(th => th.id === t.id);
    const isActive = t.id === state.activeThreadId ? ' active' : '';
    const isResolved = thread && thread.resolved ? ' resolved' : '';
    html += `<mark class="cmt-highlight${isActive}${isResolved}" data-cmt-id="${t.id}">${escapeHtml(md.slice(t.start, t.end))}</mark>`;
    pos = t.end;
  }
  html += escapeHtml(md.slice(pos));

  docContent.innerHTML = `<pre class="md-source">${html}</pre>`;
  docContent.querySelectorAll('mark.cmt-highlight').forEach(m => {
    m.addEventListener('click', () => openThread(m.dataset.cmtId));
  });
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function renderSidebar() {
  if (state.sidebarMode === 'thread' && state.activeThreadId) {
    const thread = state.threads.find(t => t.id === state.activeThreadId);
    if (thread) { renderThreadView(thread); return; }
  }
  renderThreadList();
}

function renderThreadList() {
  state.sidebarMode = 'list';
  replyArea.style.display = 'none';

  const active = state.threads.filter(t => !t.resolved);
  const resolved = state.threads.filter(t => t.resolved);
  const shown = state.sidebarTab === 'resolved' ? resolved : active;

  sidebarHeader.innerHTML = '';
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

  if (shown.length === 0) {
    commentsList.innerHTML = `<div class="empty-state">${
      state.sidebarTab === 'resolved'
        ? 'No resolved threads yet.'
        : 'Select text in the document to add a comment.'
    }</div>`;
    return;
  }

  commentsList.innerHTML = '';
  for (const thread of shown) {
    const first = thread.messages[0];
    const last = thread.messages[thread.messages.length - 1];
    const count = thread.messages.length;
    const isActive = thread.id === state.activeThreadId;

    const card = document.createElement('div');
    card.className = 'comment-card'
      + (thread.orphaned ? ' orphaned' : '')
      + (thread.resolved ? ' resolved' : '')
      + (isActive ? ' active' : '');
    card.dataset.id = thread.id;

    const anchor = document.createElement('div');
    anchor.className = 'comment-anchor' + (thread.orphaned ? ' orphaned-label' : '');
    const ctx = thread.anchor.context;
    anchor.textContent = thread.orphaned
      ? '⚠ Orphaned — anchor text was removed'
      : `"${ctx.slice(0, 55)}${ctx.length > 55 ? '…' : ''}"`;

    const firstEl = document.createElement('div');
    firstEl.className = 'comment-text';
    firstEl.textContent = first.text.length > 80 ? first.text.slice(0, 80) + '…' : first.text;

    card.appendChild(anchor);
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
    const authorStr = first.author ? `${first.author} · ` : '';
    authorDateEl.textContent = authorStr + new Date(first.created_at || first.createdAt).toLocaleString();
    meta.appendChild(authorDateEl);

    if (thread.resolved) {
      const badge = document.createElement('span');
      badge.className = 'resolved-badge';
      badge.textContent = 'Resolved';
      meta.appendChild(badge);
    } else if (count > 1) {
      const badge = document.createElement('span');
      badge.className = 'reply-count';
      badge.textContent = `${count - 1} repl${count - 1 === 1 ? 'y' : 'ies'}`;
      meta.appendChild(badge);
    }

    card.appendChild(meta);
    card.addEventListener('click', () => openThread(thread.id));
    commentsList.appendChild(card);
  }
}

function renderThreadView(thread) {
  state.sidebarMode = 'thread';

  sidebarHeader.innerHTML = '';
  const back = document.createElement('button');
  back.className = 'thread-back';
  back.innerHTML = '&#8592; All comments';
  back.addEventListener('click', closeThread);
  sidebarHeader.appendChild(back);

  const anchorEl = document.createElement('div');
  anchorEl.className = 'thread-anchor';
  const ctx = thread.anchor.context;
  anchorEl.textContent = `"${ctx.slice(0, 80)}${ctx.length > 80 ? '…' : ''}"`;

  commentsList.innerHTML = '';
  commentsList.appendChild(anchorEl);

  if (thread.resolved) {
    const banner = document.createElement('div');
    banner.className = 'resolved-banner';
    const resolvedDate = new Date(thread.resolvedAt).toLocaleString();
    banner.innerHTML = `<strong>Resolved</strong>${resolvedDate}`;
    if (thread.resolvedComment) {
      const note = document.createElement('div');
      note.style.cssText = 'margin-top:6px; font-style:italic;';
      note.textContent = `"${thread.resolvedComment}"`;
      banner.appendChild(note);
    }
    commentsList.appendChild(banner);
  }

  for (const msg of thread.messages) {
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';

    const text = document.createElement('div');
    text.className = 'message-text';
    text.textContent = msg.text;

    const meta = document.createElement('div');
    meta.className = 'message-meta';

    if (msg.author) {
      const authorEl = document.createElement('span');
      authorEl.className = 'message-author';
      authorEl.textContent = msg.author;
      meta.appendChild(authorEl);
    }

    const date = document.createElement('span');
    date.className = 'message-date';
    date.textContent = new Date(msg.created_at || msg.createdAt).toLocaleString();
    meta.appendChild(date);

    bubble.appendChild(text);
    bubble.appendChild(meta);
    commentsList.appendChild(bubble);
  }

  if (thread.resolved) {
    replyArea.style.display = 'none';
    return;
  }

  replyArea.style.display = 'flex';
  replyInput.value = '';

  const actionsRow = replyArea.querySelector('.reply-actions');
  actionsRow.innerHTML = '';

  const delBtn = document.createElement('button');
  delBtn.className = 'btn-delete-thread';
  delBtn.textContent = 'Delete thread';
  delBtn.onclick = () => deleteThread(thread.id);
  actionsRow.appendChild(delBtn);

  const rightBtns = document.createElement('div');
  rightBtns.style.cssText = 'display:flex; gap:6px; align-items:center;';

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
    showResolveForm(thread.id);
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
  replyBtn.onclick = () => submitReply(thread.id);

  rightBtns.appendChild(resolveGroup);
  rightBtns.appendChild(replyBtn);
  actionsRow.appendChild(rightBtns);

  replyInput.onkeydown = e => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitReply(thread.id);
  };

  replyArea.querySelector('.resolve-form')?.remove();
}

function showResolveForm(threadId) {
  replyArea.querySelector('.resolve-form')?.remove();

  const form = document.createElement('div');
  form.className = 'resolve-form';

  const ta = document.createElement('textarea');
  ta.placeholder = 'Why is this being resolved? (optional)';
  ta.rows = 3;

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
  });

  formActions.appendChild(cancel);
  formActions.appendChild(confirm);
  form.appendChild(ta);
  form.appendChild(formActions);
  replyArea.appendChild(form);
  ta.focus();
}

// ─── Thread actions ───────────────────────────────────────────────────────────

function openThread(id) {
  if (sidebar && sidebar.classList.contains('collapsed')) {
    sidebar.classList.remove('collapsed');
    sidebarResizer.classList.remove('hidden');
    btnSidebarToggle.innerHTML = '&#x00BB;';
    btnSidebarToggle.title = 'Hide sidebar';
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, 'false');
  }

  const prevResolved = state.activeThreadId
    ? state.threads.find(t => t.id === state.activeThreadId)?.resolved
    : false;
  const nextResolved = state.threads.find(t => t.id === id)?.resolved;

  state.activeThreadId = id;
  state.sidebarMode = 'thread';

  if (prevResolved || nextResolved) {
    renderView();
  } else {
    document.querySelectorAll('mark.cmt-highlight').forEach(m => {
      m.classList.toggle('active', m.dataset.cmtId === id);
    });
  }

  const activeMark = document.querySelector(`mark.cmt-highlight[data-cmt-id="${id}"]`);
  if (activeMark) activeMark.scrollIntoView({ behavior: 'smooth', block: 'center' });

  renderSidebar();
}

function closeThread() {
  const wasResolved = state.activeThreadId
    ? state.threads.find(t => t.id === state.activeThreadId)?.resolved
    : false;

  state.activeThreadId = null;
  state.sidebarMode = 'list';

  if (wasResolved) {
    renderView();
  } else {
    document.querySelectorAll('mark.cmt-highlight').forEach(m => m.classList.remove('active'));
  }

  renderSidebar();
}

async function submitReply(threadId) {
  const text = replyInput.value.trim();
  if (!text) return;

  const author = getAuthor();

  const btn = replyArea.querySelector('.btn-reply');
  if (btn) btn.disabled = true;
  try {
    const res = await fetch(apiUrl(`/api/thread/${threadId}/reply`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, author }),
    });
    if (!res.ok) throw new Error('Failed to post reply');
    await load();
    openThread(threadId);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function resolveThread(threadId, comment) {
  await fetch(apiUrl(`/api/thread/${threadId}/resolve`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ comment }),
  });
  state.activeThreadId = null;
  state.sidebarMode = 'list';
  state.sidebarTab = 'resolved';
  await load();
}

async function deleteThread(id) {
  await fetch(apiUrl(`/api/thread/${id}`), { method: 'DELETE' });
  state.activeThreadId = null;
  state.sidebarMode = 'list';
  await load();
}

// ─── Selection handling ───────────────────────────────────────────────────────

document.addEventListener('mouseup', (e) => {
  if (e.target === addBtn || modal.contains(e.target) || nameModal.contains(e.target)) return;

  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
    addBtn.style.display = 'none';
    state.selection = null;
    return;
  }

  const text = sel.toString().trim();
  if (!text || text.length < 2) {
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

  const offset = state.markdown.indexOf(text);
  if (offset === -1) {
    addBtn.style.display = 'none';
    state.selection = null;
    return;
  }

  const CONTEXT_LEN = 20;
  const prefix = state.markdown.slice(Math.max(0, offset - CONTEXT_LEN), offset);
  const suffix = state.markdown.slice(offset + text.length, offset + text.length + CONTEXT_LEN);

  state.selection = { text, offset, prefix, suffix };

  const rect = range.getBoundingClientRect();
  addBtn.style.display = 'block';
  addBtn.style.left = `${rect.left + rect.width / 2 + window.scrollX}px`;
  addBtn.style.top = `${rect.top + window.scrollY - 36}px`;
});

addBtn.addEventListener('click', () => {
  if (!state.selection) return;
  addBtn.style.display = 'none';

  // If no author set, prompt for name first, then open comment modal
  if (!getAuthor()) {
    showNameModal(() => openCommentModal());
    return;
  }

  openCommentModal();
});

function openCommentModal() {
  modalSelectedText.textContent = state.selection.text;
  commentInput.value = '';
  modal.classList.add('open');
  commentInput.focus();
}

// ─── Modal ────────────────────────────────────────────────────────────────────

modalCancel.addEventListener('click', closeModal);
modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

function closeModal() {
  modal.classList.remove('open');
  commentInput.value = '';
  window.getSelection()?.removeAllRanges();
}

commentInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitComment();
});

modalSubmit.addEventListener('click', submitComment);

async function submitComment() {
  const text = commentInput.value.trim();
  if (!text || !state.selection) return;

  const author = getAuthor();

  modalSubmit.disabled = true;
  try {
    const res = await fetch(apiUrl('/api/comment'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        documentId: config.documentId,
        text,
        author,
        selectedText: state.selection.text,
        offset: state.selection.offset,
        prefix: state.selection.prefix,
        suffix: state.selection.suffix,
      }),
    });
    if (!res.ok) throw new Error('Failed to save comment');
    const data = await res.json();
    closeModal();
    state.selection = null;
    await load();
    openThread(data.thread.id);
  } finally {
    modalSubmit.disabled = false;
  }
}

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

initTheme();
initSidebar();
updateAuthorDisplay();
load();
