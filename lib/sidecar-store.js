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
}

module.exports = { init };
