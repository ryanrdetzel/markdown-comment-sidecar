const crypto = require('crypto');
const path = require('path');

function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) return { data: {}, content: raw };

  const data = {};
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const val = line.slice(colonIdx + 1).trim();
    if (key) data[key] = val;
  }

  return { data, content: raw.slice(match[0].length) };
}

function makeDocumentId(filePath, inputDir, siteId, frontmatterId) {
  if (frontmatterId && /^[0-9a-f]{32}$/.test(frontmatterId)) {
    return frontmatterId;
  }

  const relPath = path.relative(path.resolve(inputDir), filePath).replace(/\\/g, '/').replace(/\.md$/, '');
  const docPath = frontmatterId
    ? path.dirname(relPath).replace(/\\/g, '/') + '/' + frontmatterId
    : relPath;

  return crypto
    .createHash('sha256')
    .update(siteId + ':' + docPath)
    .digest('hex')
    .slice(0, 32);
}

function findMarkdownFiles(dir, base) {
  const fs = require('fs');
  base = base || dir;
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findMarkdownFiles(full, base));
    } else if (entry.name.endsWith('.md')) {
      results.push(full);
    }
  }
  return results;
}

module.exports = { parseFrontmatter, makeDocumentId, findMarkdownFiles };
