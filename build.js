#!/usr/bin/env node
// build.js — Static site generator for markdown-comment-sidecar
//
// Usage:
//   node build.js --input ./docs --output ./dist --server https://comments.example.com \
//     --site-id <secret> --assets-url https://cdn.example.com/sidecar
//
// Options:
//   --input      DIR    Directory of .md files to process (default: ./docs)
//   --output     DIR    Output directory for generated HTML (default: ./dist)
//   --server     URL    Comment server base URL (required)
//   --site-id    TOKEN  Stable salt for document IDs (required)
//   --assets-url URL    Base URL for sidecar.css and app.js (required)
//   --watch             Re-build when input files change

const fs = require('fs');
const path = require('path');
const { marked } = require('marked');
const { parseFrontmatter, makeDocumentId, findMarkdownFiles } = require('./lib/document-id');

// ─── Args ─────────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const result = { input: './docs', output: './dist', server: null, siteId: null, assetsUrl: null, watch: false };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input')      result.input     = args[++i];
    if (args[i] === '--output')     result.output    = args[++i];
    if (args[i] === '--server')     result.server    = args[++i];
    if (args[i] === '--site-id')    result.siteId    = args[++i];
    if (args[i] === '--assets-url') result.assetsUrl = args[++i];
    if (args[i] === '--watch')      result.watch     = true;
  }

  const missing = [];
  if (!result.server) missing.push('--server <url>');
  if (!result.siteId) missing.push('--site-id <token>');
  if (!result.assetsUrl) missing.push('--assets-url <url>');

  if (missing.length) {
    console.error('Error: missing required flags: ' + missing.join(', '));
    console.error('');
    console.error('Example:');
    console.error('  node build.js --input ./docs --output ./dist \\');
    console.error('    --server https://comments.example.com \\');
    console.error('    --site-id $(cat .site-id) \\');
    console.error('    --assets-url https://cdn.example.com/sidecar');
    console.error('');
    console.error('Generate a site ID once and commit it:');
    console.error('  node -e "console.log(require(\'crypto\').randomUUID())" > .site-id');
    process.exit(1);
  }

  return result;
}

// ─── HTML template ────────────────────────────────────────────────────────────

function generateHtml({ title, documentId, serverUrl, assetsUrl, markdown, html }) {
  const configJson = JSON.stringify({ serverUrl, documentId, markdown, html });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="${assetsUrl}/sidecar.css">
</head>
<body>
  <header>
    ${escapeHtml(title)} <span>· comments</span>
    <div class="header-controls">
      <select id="theme-select" class="theme-select" title="Change theme">
        <option value="classic">Classic</option>
        <option value="dark">Dark</option>
        <option value="sepia">Sepia</option>
        <option value="ocean">Ocean</option>
        <option value="forest">Forest</option>
      </select>
      <div class="view-toggle">
        <button id="btn-preview" class="active">Preview</button>
        <button id="btn-markdown">Markdown</button>
      </div>
      <button class="btn-sidebar-toggle" id="btn-sidebar-toggle" title="Hide sidebar">&#x00BB;</button>
    </div>
  </header>

  <div class="author-bar">
    <span id="author-display"></span>
  </div>

  <div class="layout">
    <div class="doc-pane">
      <div class="doc-content" id="doc-content">Loading...</div>
    </div>

    <div class="sidebar-resizer" id="sidebar-resizer"></div>

    <aside class="sidebar" id="sidebar">
      <div class="sidebar-header" id="sidebar-header">
        Comments <span id="comment-count">0</span>
      </div>
      <div class="comments-list" id="comments-list">
        <div class="empty-state">Select text in the document to add a comment.</div>
      </div>
      <div class="reply-area" id="reply-area" style="display:none">
        <textarea id="reply-input" placeholder="Reply to this thread..." rows="3"></textarea>
        <div class="reply-actions"></div>
      </div>
    </aside>
  </div>

  <button id="add-comment-btn">+ Add Comment</button>

  <!-- Comment modal -->
  <div id="comment-modal">
    <div class="modal-box">
      <h3>Add Comment</h3>
      <div class="modal-selected-text" id="modal-selected-text"></div>
      <textarea id="comment-input" placeholder="Write your comment..." rows="4"></textarea>
      <div class="modal-actions">
        <button class="btn-cancel" id="modal-cancel">Cancel</button>
        <button class="btn-submit" id="modal-submit">Add Comment</button>
      </div>
    </div>
  </div>

  <!-- Name prompt modal -->
  <div id="name-modal">
    <div class="modal-box">
      <h3>What's your name?</h3>
      <p>Your name will appear on comments you write. It's saved in your browser.</p>
      <input type="text" id="name-input" placeholder="e.g. Ryan" maxlength="60" />
      <div class="modal-actions">
        <button class="btn-submit" id="name-submit">Save &amp; Continue</button>
      </div>
    </div>
  </div>

  <script>window.SIDECAR_CONFIG = ${configJson};</script>
  <script src="${assetsUrl}/app.js"></script>
</body>
</html>`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Build ────────────────────────────────────────────────────────────────────

function buildFile(filePath, opts) {
  const { inputDir, outputDir, serverUrl, siteId, assetsUrl } = opts;
  const raw = fs.readFileSync(filePath, 'utf8');
  const { data, content } = parseFrontmatter(raw);

  const documentId = makeDocumentId(filePath, inputDir, siteId, data.id || null);
  const html = marked.parse(content);

  // Title: frontmatter title, first H1 in markdown, or filename
  let title = data.title;
  if (!title) {
    const h1 = content.match(/^#\s+(.+)/m);
    title = h1 ? h1[1] : path.basename(filePath, '.md');
  }

  // Output path mirrors input directory structure, .md → .html
  const rel = path.relative(path.resolve(inputDir), filePath);
  const outPath = path.join(outputDir, rel.replace(/\.md$/, '.html'));

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, generateHtml({ title, documentId, serverUrl, assetsUrl, markdown: content, html }));

  return { filePath, outPath, documentId };
}

function build(args) {
  const { input, output, server, siteId, assetsUrl } = args;
  const inputDir = path.resolve(input);
  const outputDir = path.resolve(output);

  if (!fs.existsSync(inputDir)) {
    console.error(`Input directory not found: ${inputDir}`);
    process.exit(1);
  }

  fs.mkdirSync(outputDir, { recursive: true });

  const files = findMarkdownFiles(inputDir);
  if (files.length === 0) {
    console.warn(`No .md files found in ${inputDir}`);
    return;
  }

  console.log(`Building ${files.length} file(s)...`);

  const opts = { inputDir, outputDir, serverUrl: server, siteId, assetsUrl };
  for (const f of files) {
    const result = buildFile(f, opts);
    const relOut = path.relative(process.cwd(), result.outPath);
    console.log(`  ${path.relative(process.cwd(), f)} → ${relOut}  [${result.documentId}]`);
  }

  console.log(`\nDone. Output: ${outputDir}`);
  console.log(`Site ID: ${siteId} (keep this stable — changing it reassigns all document IDs)`);
}

// ─── Watch mode ───────────────────────────────────────────────────────────────

function watch(args) {
  build(args);
  console.log('\nWatching for changes...');

  const inputDir = path.resolve(args.input);
  fs.watch(inputDir, { recursive: true }, (event, filename) => {
    if (!filename || !filename.endsWith('.md')) return;
    const filePath = path.join(inputDir, filename);
    if (!fs.existsSync(filePath)) return;

    const opts = {
      inputDir,
      outputDir: path.resolve(args.output),
      serverUrl: args.server,
      siteId: args.siteId,
      assetsUrl: args.assetsUrl,
    };

    try {
      const result = buildFile(filePath, opts);
      console.log(`[${new Date().toLocaleTimeString()}] rebuilt ${path.relative(process.cwd(), result.outPath)}`);
    } catch (err) {
      console.error(`[${new Date().toLocaleTimeString()}] error building ${filename}:`, err.message);
    }
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const args = parseArgs();
if (args.watch) {
  watch(args);
} else {
  build(args);
}
