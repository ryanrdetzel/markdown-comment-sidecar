// State
let state = {
  markdown: '',
  html: '',
  threads: [],
  selection: null,
  view: 'preview',       // 'preview' | 'markdown'
  sidebarMode: 'list',   // 'list' | 'thread'
  activeThreadId: null,
};

// DOM refs
const docContent = document.getElementById('doc-content');
const commentsList = document.getElementById('comments-list');
const commentCount = document.getElementById('comment-count');
const sidebarHeader = document.getElementById('sidebar-header');
const addBtn = document.getElementById('add-comment-btn');
const replyArea = document.getElementById('reply-area');
const replyInput = document.getElementById('reply-input');
const btnReply = document.getElementById('btn-reply');
const btnDeleteThread = document.getElementById('btn-delete-thread');
const modal = document.getElementById('comment-modal');
const modalSelectedText = document.getElementById('modal-selected-text');
const commentInput = document.getElementById('comment-input');
const modalCancel = document.getElementById('modal-cancel');
const modalSubmit = document.getElementById('modal-submit');
const btnPreview = document.getElementById('btn-preview');
const btnMarkdown = document.getElementById('btn-markdown');

// ─── Offset mapping ────────────────────────────────────────────────────────────

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

function wrapRange(startNode, startOffset, endNode, endOffset, threadId, orphaned) {
  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);

  const mark = document.createElement('mark');
  mark.className = 'cmt-highlight' + (orphaned ? ' orphaned' : '');
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
  const res = await fetch('/api/document');
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to load document');
  state.markdown = data.markdown;
  state.html = data.html;
  state.threads = data.threads;

  renderView();
  renderSidebar();
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
    const result = findTextInDOM(docContent, t.anchor.context);
    if (result) {
      wrapRange(result.startNode, result.startOffset, result.endNode, result.endOffset, t.id, false);
    }
  }

  // Re-apply active state if a thread is open
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
    .filter(t => !t.orphaned && t.currentOffset >= 0)
    .map(t => ({ start: t.currentOffset, end: t.currentOffset + t.anchor.context.length, id: t.id }))
    .sort((a, b) => a.start - b.start);

  let html = '';
  let pos = 0;
  for (const t of active) {
    if (t.start < pos) continue;
    html += escapeHtml(md.slice(pos, t.start));
    const isActive = t.id === state.activeThreadId ? ' active' : '';
    html += `<mark class="cmt-highlight${isActive}" data-cmt-id="${t.id}">${escapeHtml(md.slice(t.start, t.end))}</mark>`;
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

  // Header
  sidebarHeader.innerHTML = `Comments <span id="comment-count">${state.threads.length}</span>`;

  if (state.threads.length === 0) {
    commentsList.innerHTML = '<div class="empty-state">Select text in the document to add a comment.</div>';
    return;
  }

  commentsList.innerHTML = '';
  for (const thread of state.threads) {
    const first = thread.messages[0];
    const last = thread.messages[thread.messages.length - 1];
    const count = thread.messages.length;
    const isActive = thread.id === state.activeThreadId;

    const card = document.createElement('div');
    card.className = 'comment-card' + (thread.orphaned ? ' orphaned' : '') + (isActive ? ' active' : '');
    card.dataset.id = thread.id;

    // Anchor line
    const anchor = document.createElement('div');
    anchor.className = 'comment-anchor' + (thread.orphaned ? ' orphaned-label' : '');
    const ctx = thread.anchor.context;
    anchor.textContent = thread.orphaned
      ? '⚠ Orphaned — anchor text was removed'
      : `"${ctx.slice(0, 55)}${ctx.length > 55 ? '…' : ''}"`;

    // First message
    const firstEl = document.createElement('div');
    firstEl.className = 'comment-text';
    firstEl.textContent = first.text.length > 80 ? first.text.slice(0, 80) + '…' : first.text;

    card.appendChild(anchor);
    card.appendChild(firstEl);

    // If multiple messages, show separator + last
    if (count > 1) {
      const sep = document.createElement('div');
      sep.className = 'thread-sep';
      sep.textContent = '···';

      const lastEl = document.createElement('div');
      lastEl.className = 'comment-text last';
      lastEl.textContent = last.text.length > 80 ? last.text.slice(0, 80) + '…' : last.text;

      card.appendChild(sep);
      card.appendChild(lastEl);
    }

    // Meta row: date + reply count + delete
    const meta = document.createElement('div');
    meta.className = 'comment-meta';

    const date = document.createElement('span');
    date.className = 'comment-date';
    date.textContent = new Date(first.createdAt).toLocaleString();

    meta.appendChild(date);

    if (count > 1) {
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

  // Header with back button
  sidebarHeader.innerHTML = '';
  const back = document.createElement('button');
  back.className = 'thread-back';
  back.innerHTML = '&#8592; All comments';
  back.addEventListener('click', closeThread);
  sidebarHeader.appendChild(back);

  // Anchor quote
  const anchorEl = document.createElement('div');
  anchorEl.className = 'thread-anchor';
  const ctx = thread.anchor.context;
  anchorEl.textContent = `"${ctx.slice(0, 80)}${ctx.length > 80 ? '…' : ''}"`;

  // Messages
  commentsList.innerHTML = '';
  commentsList.appendChild(anchorEl);

  for (const msg of thread.messages) {
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';

    const text = document.createElement('div');
    text.className = 'message-text';
    text.textContent = msg.text;

    const meta = document.createElement('div');
    meta.className = 'message-meta';

    const date = document.createElement('span');
    date.className = 'message-date';
    date.textContent = new Date(msg.createdAt).toLocaleString();

    meta.appendChild(date);
    bubble.appendChild(text);
    bubble.appendChild(meta);
    commentsList.appendChild(bubble);
  }

  // Reply area
  replyArea.style.display = 'flex';
  replyInput.value = '';

  btnReply.onclick = () => submitReply(thread.id);
  btnDeleteThread.onclick = () => deleteThread(thread.id);

  replyInput.onkeydown = e => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitReply(thread.id);
  };
}

// ─── Thread actions ───────────────────────────────────────────────────────────

function openThread(id) {
  state.activeThreadId = id;
  state.sidebarMode = 'thread';

  // Activate highlight in document
  document.querySelectorAll('mark.cmt-highlight').forEach(m => {
    m.classList.toggle('active', m.dataset.cmtId === id);
  });
  const activeMark = document.querySelector(`mark.cmt-highlight[data-cmt-id="${id}"]`);
  if (activeMark) activeMark.scrollIntoView({ behavior: 'smooth', block: 'center' });

  renderSidebar();
}

function closeThread() {
  state.activeThreadId = null;
  state.sidebarMode = 'list';

  // Clear active highlight
  document.querySelectorAll('mark.cmt-highlight').forEach(m => m.classList.remove('active'));

  renderSidebar();
}

async function submitReply(threadId) {
  const text = replyInput.value.trim();
  if (!text) return;

  btnReply.disabled = true;
  try {
    const res = await fetch(`/api/thread/${threadId}/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error('Failed to post reply');
    await load();
    // Re-open the thread view after reload
    openThread(threadId);
  } finally {
    btnReply.disabled = false;
  }
}

async function deleteThread(id) {
  await fetch(`/api/thread/${id}`, { method: 'DELETE' });
  state.activeThreadId = null;
  state.sidebarMode = 'list';
  await load();
}

// ─── Selection handling ───────────────────────────────────────────────────────

document.addEventListener('mouseup', (e) => {
  if (state.view === 'markdown') return;
  if (e.target === addBtn || modal.contains(e.target)) return;

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

  state.selection = { text, offset };

  const rect = range.getBoundingClientRect();
  addBtn.style.display = 'block';
  addBtn.style.left = `${rect.left + window.scrollX}px`;
  addBtn.style.top = `${rect.top + window.scrollY - 36}px`;
});

addBtn.addEventListener('click', () => {
  if (!state.selection) return;
  addBtn.style.display = 'none';
  modalSelectedText.textContent = state.selection.text;
  commentInput.value = '';
  modal.classList.add('open');
  commentInput.focus();
});

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

  modalSubmit.disabled = true;
  try {
    const res = await fetch('/api/comment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        selectedText: state.selection.text,
        offset: state.selection.offset,
      }),
    });
    if (!res.ok) throw new Error('Failed to save comment');
    const data = await res.json();
    closeModal();
    state.selection = null;
    await load();
    // Open the new thread immediately
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

// ─── Init ─────────────────────────────────────────────────────────────────────

load();
