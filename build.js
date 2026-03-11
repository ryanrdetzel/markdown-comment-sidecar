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

const fs = require("fs");
const path = require("path");
const { marked } = require("./lib/marked-config");

const {
  parseFrontmatter,
  makeDocumentId,
  findMarkdownFiles,
} = require("./lib/document-id");

// ─── Args ─────────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {
    input: "./docs",
    output: "./dist",
    server: null,
    siteId: null,
    assetsUrl: null,
    watch: false,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--input") result.input = args[++i];
    if (args[i] === "--output") result.output = args[++i];
    if (args[i] === "--server") result.server = args[++i];
    if (args[i] === "--site-id") result.siteId = args[++i];
    if (args[i] === "--assets-url") result.assetsUrl = args[++i];
    if (args[i] === "--watch") result.watch = true;
  }

  const missing = [];
  if (!result.server) missing.push("--server <url>");
  if (!result.siteId) missing.push("--site-id <token>");
  if (!result.assetsUrl) missing.push("--assets-url <url>");

  if (missing.length) {
    console.error("Error: missing required flags: " + missing.join(", "));
    console.error("");
    console.error("Example:");
    console.error("  node build.js --input ./docs --output ./dist \\");
    console.error("    --server https://comments.example.com \\");
    console.error("    --site-id $(cat .site-id) \\");
    console.error("    --assets-url https://cdn.example.com/sidecar");
    console.error("");
    console.error("Generate a site ID once and commit it:");
    console.error(
      "  node -e \"console.log(require('crypto').randomUUID())\" > .site-id",
    );
    process.exit(1);
  }

  return result;
}

// ─── HTML template ────────────────────────────────────────────────────────────

// Escape </script> sequences so embedded content can't break out of a script tag.
function escapeScriptContent(str) {
  return str.replace(/<\/script/gi, '<\\/script');
}

function generateHtml({
  title,
  documentId,
  serverUrl,
  assetsUrl,
  markdown,
  html,
  breadcrumbs,
}) {
  const configJson = escapeScriptContent(JSON.stringify({ serverUrl, documentId }));
  const breadcrumbHtml = renderBreadcrumbs(breadcrumbs || []);

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
    <div class="header-controls">
      <span id="author-display"></span>
      <span> &#x2022; </span>
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


  <div class="layout">
    <div class="doc-pane">
      <div class="doc-content" id="doc-content">
        ${breadcrumbHtml}
${html}
      </div>
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

  <!-- Raw markdown source for the markdown view toggle -->
  <script type="text/plain" id="markdown-source">${escapeScriptContent(markdown)}</script>

  <script>window.SIDECAR_CONFIG = ${configJson};</script>
  <script src="${assetsUrl}/app.js"></script>
</body>
</html>`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Extract first paragraph of plain text from markdown (skip headings, code, frontmatter)
function extractDescription(content) {
  const lines = content.split("\n");
  let inCode = false;
  let paragraph = [];

  for (const line of lines) {
    if (line.startsWith("```")) { inCode = !inCode; continue; }
    if (inCode) continue;
    if (/^#+\s/.test(line)) continue;    // headings
    if (/^---/.test(line)) continue;     // frontmatter delimiter
    if (/^\s*$/.test(line)) {
      if (paragraph.length > 0) break;   // end of first paragraph
      continue;
    }
    paragraph.push(line.trim());
  }

  const text = paragraph.join(" ").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").trim();
  return text.length > 160 ? text.slice(0, 157) + "…" : text;
}

// Convert a directory name (slug) to a human-readable title
function slugToTitle(slug) {
  return slug
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Build breadcrumb segments from outputDir to the parent of currentPath.
// For doc pages (isIndex=false): shows path up to (not including) the file.
// For index pages (isIndex=true): shows path up to (not including) this dir.
// Returns [{label, href}] using relative hrefs from the current page's location.
// Build breadcrumb links from root down to the parent of currentPath.
// All returned items are ancestor links (the current page is not included).
// Returns [] only for the root index itself.
function buildBreadcrumbs(outputDir, currentPath) {
  const rel = path.relative(outputDir, currentPath);
  if (!rel) return [];

  const parts = rel.split(path.sep).filter(Boolean);
  // Pop the last segment (filename or dir name) — we only want ancestors
  parts.pop();

  const depth = parts.length;
  const crumbs = [{ label: "Index", href: "../".repeat(depth) + "index.html" }];
  for (let i = 0; i < parts.length; i++) {
    const remaining = depth - 1 - i;
    crumbs.push({
      label: slugToTitle(parts[i]),
      href: remaining > 0 ? "../".repeat(remaining) + "index.html" : "index.html",
    });
  }
  return crumbs;
}

function renderBreadcrumbs(crumbs) {
  if (!crumbs.length) return "";
  const items = crumbs.map((c) => `<a href="${escapeHtml(c.href)}">${escapeHtml(c.label)}</a>`);
  return `<nav class="breadcrumbs">${items.join(" <span class=\"breadcrumb-sep\">/</span> ")}</nav>`;
}

// ─── Index page ───────────────────────────────────────────────────────────────

function generateIndexHtml({ title, entries, assetsUrl, breadcrumbs }) {
  const dirCards = entries.filter((e) => e.type === "dir").map((e) => `
        <a class="index-card index-card--dir" href="${escapeHtml(e.href)}">
          <div class="index-card__icon">&#x1F4C2;</div>
          <div class="index-card__body">
            <div class="index-card__title">${escapeHtml(e.label)}</div>
            ${e.description ? `<div class="index-card__desc">${escapeHtml(e.description)}</div>` : ""}
          </div>
          <div class="index-card__arrow">&#x2192;</div>
        </a>`).join("");

  const fileCards = entries.filter((e) => e.type === "file").map((e) => `
        <a class="index-card index-card--file" href="${escapeHtml(e.href)}">
          <div class="index-card__icon">&#x1F4C4;</div>
          <div class="index-card__body">
            <div class="index-card__title">${escapeHtml(e.label)}</div>
            ${e.description ? `<div class="index-card__desc">${escapeHtml(e.description)}</div>` : ""}
          </div>
          <div class="index-card__arrow">&#x2192;</div>
        </a>`).join("");

  const breadcrumbHtml = renderBreadcrumbs(breadcrumbs);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="${assetsUrl}/sidecar.css">
</head>
<body>
  <div class="index-page">
    <div class="index-container">
      ${breadcrumbHtml}
      <h1 class="index-title">${escapeHtml(title)}</h1>
      ${dirCards || fileCards ? `<div class="index-grid">${dirCards}${fileCards}</div>` : "<p>No pages found.</p>"}
    </div>
  </div>
</body>
</html>`;
}

function generateIndexPages(outputDir, builtFiles, assetsUrl) {
  // Map from dirPath → [{ name, title, description }]
  const dirFiles = new Map();

  for (const { outPath, title, description } of builtFiles) {
    const dir = path.dirname(outPath);
    const name = path.basename(outPath);
    if (name === "index.html") continue;
    if (!dirFiles.has(dir)) dirFiles.set(dir, []);
    dirFiles.get(dir).push({ name, title, description });
  }

  // Collect all directories that contain built files, plus their ancestors
  const allDirs = new Set();
  for (const dir of dirFiles.keys()) {
    let d = dir;
    while (d.startsWith(outputDir)) {
      allDirs.add(d);
      if (d === outputDir) break;
      d = path.dirname(d);
    }
  }

  for (const dirPath of allDirs) {
    const indexPath = path.join(dirPath, "index.html");
    if (fs.existsSync(indexPath)) continue;

    const files = dirFiles.get(dirPath) || [];

    // Find direct subdirectories within this dir, with a description from their first child
    const subdirs = [];
    for (const d of allDirs) {
      if (path.dirname(d) === dirPath && d !== dirPath) {
        const subdirName = path.basename(d);
        const subdirFiles = dirFiles.get(d) || [];
        const firstDesc = subdirFiles[0]?.description || "";
        subdirs.push({ name: subdirName, description: firstDesc });
      }
    }

    const entries = [
      ...subdirs.map(({ name, description }) => ({
        type: "dir",
        href: name + "/index.html",
        label: slugToTitle(name),
        description,
      })),
      ...files.map(({ name, title, description }) => ({
        type: "file",
        href: name,
        label: title,
        description,
      })),
    ];

    const isRoot = dirPath === outputDir;
    const dirName = isRoot ? "Documentation" : slugToTitle(path.basename(dirPath));
    const breadcrumbs = buildBreadcrumbs(outputDir, dirPath);

    const indexHtml = generateIndexHtml({ title: dirName, entries, assetsUrl, breadcrumbs });
    fs.writeFileSync(indexPath, indexHtml);

    const relOut = path.relative(process.cwd(), indexPath);
    console.log(`  [index] → ${relOut}`);
  }
}

// ─── Build ────────────────────────────────────────────────────────────────────

function buildFile(filePath, opts) {
  if (!filePath.endsWith(".md")) {
    return null;
  }
  const { inputDir, outputDir, serverUrl, siteId, assetsUrl } = opts;
  const raw = fs.readFileSync(filePath, "utf8");
  const { data, content } = parseFrontmatter(raw);

  const documentId = makeDocumentId(
    filePath,
    inputDir,
    siteId,
    data.id || null,
  );
  const html = marked.parse(content);

  // Title: frontmatter title, first H1 in markdown, or filename
  let title = data.title;
  if (!title) {
    const h1 = content.match(/^#\s+(.+)/m);
    title = h1 ? h1[1] : path.basename(filePath, ".md");
  }

  const description = data.description || extractDescription(content);

  // Output path mirrors input directory structure, .md → .html
  const rel = path.relative(path.resolve(inputDir), filePath);
  const outPath = path.join(outputDir, rel.replace(/\.md$/, ".html"));

  const breadcrumbs = buildBreadcrumbs(outputDir, outPath);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(
    outPath,
    generateHtml({
      title,
      documentId,
      serverUrl,
      assetsUrl,
      markdown: content,
      html,
      breadcrumbs,
    }),
  );

  return { filePath, outPath, documentId, title, description };
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
  const built = [];
  for (const f of files) {
    const result = buildFile(f, opts);
    if (!result) continue;
    built.push(result);
    const relOut = path.relative(process.cwd(), result.outPath);
    console.log(
      `  ${path.relative(process.cwd(), f)} → ${relOut}  [${result.documentId}]`,
    );
  }

  generateIndexPages(outputDir, built, assetsUrl);

  console.log(`\nDone. Output: ${outputDir}`);
  console.log(
    `Site ID: ${siteId} (keep this stable — changing it reassigns all document IDs)`,
  );
}

// ─── Watch mode ───────────────────────────────────────────────────────────────

function watch(args) {
  build(args);
  console.log("\nWatching for changes...");

  const inputDir = path.resolve(args.input);
  fs.watch(inputDir, { recursive: true }, (_event, filename) => {
    if (!filename || !filename.endsWith(".md")) return;
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
      console.log(
        `[${new Date().toLocaleTimeString()}] rebuilt ${path.relative(process.cwd(), result.outPath)}`,
      );
    } catch (err) {
      console.error(
        `[${new Date().toLocaleTimeString()}] error building ${filename}:`,
        err.message,
      );
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
