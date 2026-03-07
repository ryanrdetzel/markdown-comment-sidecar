// State
let state = {
  markdown: '',
  comments: [],
  selection: null, // { text, offset }
  activeCommentId: null,
};

// DOM refs
const docContent = document.getElementById('doc-content');
const commentsList = document.getElementById('comments-list');
const commentCount = document.getElementById('comment-count');
const addBtn = document.getElementById('add-comment-btn');
const modal = document.getElementById('comment-modal');
const modalSelectedText = document.getElementById('modal-selected-text');
const commentInput = document.getElementById('comment-input');
const modalCancel = document.getElementById('modal-cancel');
const modalSubmit = document.getElementById('modal-submit');

// ─── Offset mapping ───────────────────────────────────────────────────────────
//
// The server sends raw markdown and rendered HTML. To highlight comments, we
// need to map a character offset in the markdown to a position in the DOM.
//
// Strategy: walk the rendered DOM text nodes in order. Build a parallel
// plain-text string by concatenating text node values. A markdown offset maps
// approximately to the same offset in the concatenated plain text (headings and
// paragraphs are rendered without their # markers, so there's drift, but DMP's
// fuzzy matching already handled drift on the server side — the `currentOffset`
// we receive is the offset of the selected text within the *markdown* source).
//
// We use a simpler approach: search for the anchor context string directly
// inside the DOM text nodes sequentially.

function findTextInDOM(root, searchText) {
  // Returns { startNode, startOffset, endNode, endOffset } or null
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let node;
  while ((node = walker.nextNode())) nodes.push(node);

  // Concatenate all text node content with per-node tracking
  let combined = '';
  const positions = []; // { node, start (in combined), length }
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

function wrapRange(startNode, startOffset, endNode, endOffset, commentId, orphaned) {
  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);

  const mark = document.createElement('mark');
  mark.className = 'cmt-highlight' + (orphaned ? ' orphaned' : '');
  mark.dataset.cmtId = commentId;
  mark.addEventListener('click', () => activateComment(commentId));

  try {
    range.surroundContents(mark);
  } catch {
    // Range spans multiple nodes — use extractContents + insertNode
    const fragment = range.extractContents();
    mark.appendChild(fragment);
    range.insertNode(mark);
  }
}

// ─── Rendering ────────────────────────────────────────────────────────────────

async function load() {
  const res = await fetch('/api/document');
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to load document');
  state.markdown = data.markdown;
  state.comments = data.comments;

  docContent.innerHTML = data.html;
  highlightComments();
  renderSidebar();
}

function highlightComments() {
  // Remove existing marks first (re-render case)
  docContent.querySelectorAll('mark.cmt-highlight').forEach(m => {
    const parent = m.parentNode;
    while (m.firstChild) parent.insertBefore(m.firstChild, m);
    parent.removeChild(m);
  });
  // Normalize to merge adjacent text nodes
  docContent.normalize();

  for (const cmt of state.comments) {
    if (cmt.orphaned) continue;
    const result = findTextInDOM(docContent, cmt.anchor.context);
    if (result) {
      wrapRange(result.startNode, result.startOffset, result.endNode, result.endOffset, cmt.id, false);
    }
  }
}

function renderSidebar() {
  commentCount.textContent = state.comments.length;

  if (state.comments.length === 0) {
    commentsList.innerHTML = '<div class="empty-state">Select text in the document to add a comment.</div>';
    return;
  }

  commentsList.innerHTML = '';
  for (const cmt of state.comments) {
    const card = document.createElement('div');
    card.className = 'comment-card' + (cmt.orphaned ? ' orphaned' : '') + (cmt.id === state.activeCommentId ? ' active' : '');
    card.dataset.id = cmt.id;

    const anchor = document.createElement('div');
    anchor.className = 'comment-anchor' + (cmt.orphaned ? ' orphaned-label' : '');
    anchor.textContent = cmt.orphaned
      ? '⚠ Orphaned — anchor text was removed'
      : `"${cmt.anchor.context.slice(0, 60)}${cmt.anchor.context.length > 60 ? '…' : ''}"`;

    const text = document.createElement('div');
    text.className = 'comment-text';
    text.textContent = cmt.text;

    const meta = document.createElement('div');
    meta.className = 'comment-meta';

    const date = document.createElement('span');
    date.className = 'comment-date';
    date.textContent = new Date(cmt.createdAt).toLocaleString();

    const del = document.createElement('button');
    del.className = 'delete-btn';
    del.title = 'Delete comment';
    del.textContent = '✕';
    del.addEventListener('click', e => {
      e.stopPropagation();
      deleteComment(cmt.id);
    });

    meta.appendChild(date);
    meta.appendChild(del);
    card.appendChild(anchor);
    card.appendChild(text);
    card.appendChild(meta);

    card.addEventListener('click', () => activateComment(cmt.id));
    commentsList.appendChild(card);
  }
}

function activateComment(id) {
  state.activeCommentId = id;

  // Update sidebar active state
  document.querySelectorAll('.comment-card').forEach(c => {
    c.classList.toggle('active', c.dataset.id === id);
  });

  // Update mark active state
  document.querySelectorAll('mark.cmt-highlight').forEach(m => {
    m.classList.toggle('active', m.dataset.cmtId === id);
  });

  // Scroll sidebar card into view
  const card = document.querySelector(`.comment-card[data-id="${id}"]`);
  if (card) card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ─── Selection handling ───────────────────────────────────────────────────────

function getMarkdownOffset(selectedText) {
  // Find the selected text in the markdown source
  return state.markdown.indexOf(selectedText);
}

document.addEventListener('mouseup', (e) => {
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

  // Ensure selection is within the document content
  const range = sel.getRangeAt(0);
  if (!docContent.contains(range.commonAncestorContainer)) {
    addBtn.style.display = 'none';
    state.selection = null;
    return;
  }

  const offset = getMarkdownOffset(text);
  if (offset === -1) {
    // Selection may span rendered elements, try trimmed version
    addBtn.style.display = 'none';
    state.selection = null;
    return;
  }

  state.selection = { text, offset };

  // Position the button near the selection
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
    closeModal();
    state.selection = null;
    await load();
  } finally {
    modalSubmit.disabled = false;
  }
}

// ─── Delete ───────────────────────────────────────────────────────────────────

async function deleteComment(id) {
  await fetch(`/api/comment/${id}`, { method: 'DELETE' });
  if (state.activeCommentId === id) state.activeCommentId = null;
  await load();
}

// ─── Init ─────────────────────────────────────────────────────────────────────

load();
