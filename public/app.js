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
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─── Rendering ────────────────────────────────────────────────────────────────

async function load() {
  if (window.SIDECAR_CONFIG && window.SIDECAR_CONFIG.markdown) {
    state.markdown = window.SIDECAR_CONFIG.markdown;
    state.html = window.SIDECAR_CONFIG.html || '';
  } else {
    const res = await fetch(apiUrl(`/api/document?documentId=${encodeURIComponent(config.documentId)}`));
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load document');
    state.markdown = data.markdown;
    state.html = data.html;
  }

  renderView();
  renderSidebar();

  try {
    const threadsRes = await fetch(apiUrl(`/api/threads?documentId=${encodeURIComponent(config.documentId)}`));
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
    commentsList.appendChild(buildThreadCard(thread));
  }
}

function buildMessageBubble(msg) {
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
  return bubble;
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
      card.appendChild(buildMessageBubble(msg));
    }

    if (!thread.resolved) {
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

    if (!thread.resolved) {
      const delBtn = document.createElement('button');
      delBtn.className = 'btn-delete-thread';
      delBtn.textContent = 'Delete thread';
      delBtn.onclick = (e) => { e.stopPropagation(); deleteThread(thread.id); };
      footer.appendChild(delBtn);
    }

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
    const authorStr = first.author ? `${first.author} · ` : '';
    authorDateEl.textContent = authorStr + new Date(first.created_at || first.createdAt).toLocaleString();
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
    } else if (thread.resolved) {
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, author: getAuthor() }),
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
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ comment }),
  });
  state.activeThreadId = null;
  state.sidebarMode = 'list';
  state.expandedThreadIds.delete(threadId);
  await load();
}

async function deleteThread(id) {
  await fetch(apiUrl(`/api/thread/${id}`), { method: 'DELETE' });
  state.activeThreadId = null;
  state.sidebarMode = 'list';
  state.expandedThreadIds.delete(id);
  await load();
}

// ─── Selection handling ───────────────────────────────────────────────────────

document.addEventListener('mouseup', (e) => {
  if (e.target === addBtn || modal.contains(e.target) || nameModal.contains(e.target)) return;

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

  state.selection = {
    elementType: blockEl.tagName.toLowerCase(),
    elementIndex: getElementIndex(blockEl),
    elementText: blockEl.textContent.trim().slice(0, 80),
    selectedText: selectedText.length <= 200 ? selectedText : selectedText.slice(0, 200) + '…',
  };

  const rect = range.getBoundingClientRect();
  addBtn.style.display = 'block';
  addBtn.style.left = `${rect.left + rect.width / 2 + window.scrollX}px`;
  addBtn.style.top = `${rect.top + window.scrollY - 36}px`;
});

addBtn.addEventListener('click', () => {
  if (!state.selection) return;
  addBtn.style.display = 'none';

  if (!getAuthor()) {
    showNameModal(() => openCommentModal());
    return;
  }

  openCommentModal();
});

function openCommentModal() {
  // Show the selected words as context in the modal
  modalSelectedText.textContent = state.selection.selectedText || state.selection.elementText;
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
  const { elementType, elementIndex, elementText, selectedText } = state.selection;

  modalSubmit.disabled = true;
  try {
    const res = await fetch(apiUrl('/api/comment'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        documentId: config.documentId,
        text,
        author,
        elementType,
        elementIndex,
        elementText,
        selectedText,
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
