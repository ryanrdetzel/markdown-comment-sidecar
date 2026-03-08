// sidecar-store.js — JSON-based comment storage
//
// Each document's threads are stored in a single JSON file:
//   <dataDir>/<documentId>.json  →  { threads: [...] }
//
// Usage:
//   const store = require('./lib/sidecar-store').init('./data');
//   store.getThreads(documentId);

const fs = require('fs');
const path = require('path');

function init(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  return new Store(dataDir);
}

class Store {
  constructor(dataDir) {
    this.dataDir = dataDir;
  }

  _path(documentId) {
    return path.join(this.dataDir, documentId + '.json');
  }

  getThreads(documentId) {
    const p = this._path(documentId);
    if (!fs.existsSync(p)) return [];
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8')).threads || [];
    } catch {
      return [];
    }
  }

  _write(documentId, threads) {
    fs.writeFileSync(this._path(documentId), JSON.stringify({ threads }, null, 2) + '\n');
  }

  addThread(documentId, thread) {
    const threads = this.getThreads(documentId);
    threads.push(thread);
    this._write(documentId, threads);
    return thread;
  }

  _findThread(documentId, threadId) {
    const threads = this.getThreads(documentId);
    const idx = threads.findIndex(t => t.id === threadId);
    return idx >= 0 ? { threads, idx } : null;
  }

  addReply(documentId, threadId, message) {
    const result = this._findThread(documentId, threadId);
    if (!result) return null;
    result.threads[result.idx].messages.push(message);
    this._write(documentId, result.threads);
    return message;
  }

  resolveThread(documentId, threadId, comment) {
    const result = this._findThread(documentId, threadId);
    if (!result) return false;
    const thread = result.threads[result.idx];
    thread.resolved = true;
    thread.resolvedAt = new Date().toISOString();
    thread.resolvedComment = comment || null;
    this._write(documentId, result.threads);
    return true;
  }

  deleteThread(documentId, threadId) {
    const result = this._findThread(documentId, threadId);
    if (!result) return false;
    result.threads.splice(result.idx, 1);
    this._write(documentId, result.threads);
    return true;
  }

  editMessage(documentId, threadId, messageId, newText) {
    const result = this._findThread(documentId, threadId);
    if (!result) return false;
    const msg = result.threads[result.idx].messages.find(m => m.id === messageId);
    if (!msg) return false;
    msg.text = newText;
    msg.editedAt = new Date().toISOString();
    this._write(documentId, result.threads);
    return true;
  }

  // Returns 'message-deleted', 'thread-deleted', or null if not found
  deleteMessage(documentId, threadId, messageId) {
    const result = this._findThread(documentId, threadId);
    if (!result) return null;
    const thread = result.threads[result.idx];
    const msgIdx = thread.messages.findIndex(m => m.id === messageId);
    if (msgIdx < 0) return null;
    thread.messages.splice(msgIdx, 1);
    if (thread.messages.length === 0) {
      result.threads.splice(result.idx, 1);
      this._write(documentId, result.threads);
      return 'thread-deleted';
    }
    this._write(documentId, result.threads);
    return 'message-deleted';
  }
}

module.exports = { init };
