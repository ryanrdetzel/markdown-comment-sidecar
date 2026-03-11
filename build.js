#!/usr/bin/env node
// build.js — Static site generator for markdown-comment-sidecar
//
// Usage:
//   node build.js --input ./docs --output ./dist --server https://comments.example.com \
//     --site-id <secret>
//
// Options:
//   --input      DIR    Directory of .md files to process (default: ./docs)
//   --output     DIR    Output directory for generated HTML (default: ./dist)
//   --server     URL    Comment server base URL (required)
//   --site-id    TOKEN  Stable salt for document IDs (required)
//   --base-path  PATH   URL path prefix for the site root (e.g. /docs). Default: ""
//   --logo       TEXT   Optional branding label shown top-left of every page
//   --watch             Re-build when input files change

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { marked } = require("./lib/marked-config");

const {
  parseFrontmatter,
  makeDocumentId,
  findMarkdownFiles,
} = require("./lib/document-id");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function contentHash(filePath) {
  const data = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(data).digest("hex").slice(0, 8);
}

function hashedAssetName(name, hash) {
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  return `${base}.${hash}${ext}`;
}

// ─── Args ─────────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {
    input: "./docs",
    output: "./dist",
    server: null,
    siteId: null,
    basePath: "",
    logo: null,
    watch: false,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--input") result.input = args[++i];
    if (args[i] === "--output") result.output = args[++i];
    if (args[i] === "--server") result.server = args[++i];
    if (args[i] === "--site-id") result.siteId = args[++i];
    if (args[i] === "--assets-url") { i++; /* ignored, assets are now bundled into output */ }
    if (args[i] === "--base-path") result.basePath = args[++i];
    if (args[i] === "--logo") result.logo = args[++i];
    if (args[i] === "--watch") result.watch = true;
  }

  const missing = [];
  if (!result.server) missing.push("--server <url>");
  if (!result.siteId) missing.push("--site-id <token>");

  // Normalize basePath: ensure leading slash, no trailing slash (e.g. "" or "/docs")
  if (result.basePath) {
    result.basePath = '/' + result.basePath.replace(/^\//, '').replace(/\/$/, '');
  }

  if (missing.length) {
    console.error("Error: missing required flags: " + missing.join(", "));
    console.error("");
    console.error("Example:");
    console.error("  node build.js --input ./docs --output ./dist \\");
    console.error("    --server https://comments.example.com \\");
    console.error("    --site-id $(cat .site-id)");
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

// Strip markdown syntax to get plain searchable text
function extractPlainText(markdown) {
  return markdown
    .replace(/^---[\s\S]*?^---\s*/m, '')        // frontmatter
    .replace(/```[\s\S]*?```/g, '')               // code fences
    .replace(/`[^`]+`/g, '')                      // inline code
    .replace(/^#+\s+/gm, '')                      // heading markers
    .replace(/\*\*([^*]+)\*\*/g, '$1')            // bold
    .replace(/\*([^*]+)\*/g, '$1')                // italic
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')      // links
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')         // images
    .replace(/^\s*[-*+]\s+/gm, '')                // list markers
    .replace(/^\s*\d+\.\s+/gm, '')                // ordered list
    .replace(/^\s*>/gm, '')                       // blockquotes
    .replace(/\s+/g, ' ')
    .trim();
}

function generateHtml({
  title,
  documentId,
  serverUrl,
  basePath,
  markdown,
  html,
  breadcrumbs,
  logo,
  searchIndexUrl,
  assets,
}) {
  const configJson = escapeScriptContent(JSON.stringify({ serverUrl, documentId }));
  const breadcrumbHtml = renderBreadcrumbs(breadcrumbs || []);
  // breadcrumbs includes "Index" as the first entry, so depth = length - 1
  const logoHref = "../".repeat(breadcrumbs ? Math.max(0, breadcrumbs.length - 1) : 0) + "index.html";
  const logoHtml = logo ? `<span class="site-logo"><a href="${escapeHtml(logoHref)}">${escapeHtml(logo)}</a></span>` : "";
  const assetsBase = basePath || "";
  const cssFile = (assets && assets["sidecar.css"]) || "sidecar.css";
  const appJsFile = (assets && assets["app.js"]) || "app.js";
  const searchJsFile = (assets && assets["search.js"]) || "search.js";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="${assetsBase}/${cssFile}">
  <script>(function(){var s=localStorage.getItem('sidecar_theme')||'classic';document.documentElement.setAttribute('data-theme',s);})();</script>
</head>
<body>
  <header>
    ${logoHtml}<div class="search-wrapper">
      <input type="search" id="search-input" placeholder="Search docs..." autocomplete="off">
      <div id="search-results" class="search-results" hidden></div>
    </div>
    <div class="header-controls">
      <a href="https://github.com/ryanrdetzel/markdown-comment-sidecar" target="_blank" rel="noopener" class="github-link" title="View source on GitHub">
        <svg height="20" width="20" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
      </a>
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

  <script>window.SIDECAR_CONFIG = ${configJson};window.SEARCH_INDEX_URL = '${searchIndexUrl}';</script>
  <script src="https://cdn.jsdelivr.net/npm/fuse.js@7/dist/fuse.min.js"></script>
  <script src="${assetsBase}/${appJsFile}"></script>
  <script src="${assetsBase}/${searchJsFile}"></script>
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
  if (!rel || rel === 'index.html') return [];

  const parts = rel.split(path.sep).filter(Boolean);
  // Pop the last segment (filename or dir name) — we only want ancestors
  parts.pop();

  const depth = parts.length;
  const crumbs = [{ label: "Home", href: "../".repeat(depth) + "index.html" }];
  for (let i = 0; i < parts.length; i++) {
    const remaining = depth - 1 - i;
    crumbs.push({
      label: slugToTitle(parts[i]),
      href: remaining > 0 ? "../".repeat(remaining) + "index.html" : "index.html",
    });
  }
  return crumbs;
}

function renderBreadcrumbs(crumbs, selfHref) {
  if (!crumbs.length) return "";
  const items = crumbs.map((c) =>
    c.href === selfHref
      ? `<span>${escapeHtml(c.label)}</span>`
      : `<a href="${escapeHtml(c.href)}">${escapeHtml(c.label)}</a>`
  );
  return `<nav class="breadcrumbs">${items.join(" <span class=\"breadcrumb-sep\">/</span> ")}</nav>`;
}

// ─── Index page ───────────────────────────────────────────────────────────────

function generateIndexHtml({ title, entries, basePath, breadcrumbs, logo, searchIndexUrl, assets }) {
  const assetsBase = basePath || "";
  const cssFile = (assets && assets["sidecar.css"]) || "sidecar.css";
  const searchJsFile = (assets && assets["search.js"]) || "search.js";
  const iconFolder = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;
  const iconFile = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`;

  const dirCards = entries.filter((e) => e.type === "dir").map((e) => `
        <a class="index-card index-card--dir" href="${escapeHtml(e.href)}">
          <div class="index-card__icon">${iconFolder}</div>
          <div class="index-card__body">
            <div class="index-card__title">${escapeHtml(e.label)}</div>
          </div>
          <div class="index-card__arrow">&#x2192;</div>
        </a>`).join("");

  const fileCards = entries.filter((e) => e.type === "file").map((e) => `
        <a class="index-card index-card--file" href="${escapeHtml(e.href)}">
          <div class="index-card__icon">${iconFile}</div>
          <div class="index-card__body">
            <div class="index-card__title">${escapeHtml(e.label)}</div>
          </div>
          <div class="index-card__arrow">&#x2192;</div>
        </a>`).join("");

  const breadcrumbHtml = renderBreadcrumbs(breadcrumbs, "index.html");
  const indexLogoHref = "../".repeat(breadcrumbs ? breadcrumbs.length : 0) + "index.html";
  const logoHtml = logo ? `<span class="site-logo"><a href="${escapeHtml(indexLogoHref)}">${escapeHtml(logo)}</a></span>` : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="${assetsBase}/${cssFile}">
  <script>(function(){var s=localStorage.getItem('sidecar_theme')||'classic';document.documentElement.setAttribute('data-theme',s);})();</script>
</head>
<body>
  <header class="index-header">
    ${logoHtml}<div class="search-wrapper">
      <input type="search" id="search-input" placeholder="Search docs..." autocomplete="off">
      <div id="search-results" class="search-results" hidden></div>
    </div>
    <div class="header-controls">
      <a href="https://github.com/ryanrdetzel/markdown-comment-sidecar" target="_blank" rel="noopener" class="github-link" title="View source on GitHub"><svg height="20" width="20" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg></a>
      <select id="theme-select" class="theme-select" title="Change theme">
        <option value="classic">Classic</option>
        <option value="dark">Dark</option>
        <option value="sepia">Sepia</option>
        <option value="ocean">Ocean</option>
        <option value="forest">Forest</option>
      </select>
    </div>
  </header>
  <div class="index-page">
    <div class="index-container">
      ${breadcrumbHtml}
      <h1 class="index-title">${escapeHtml(title)}</h1>
      ${dirCards || fileCards ? `<div class="index-grid">${dirCards}${fileCards}</div>` : "<p>No pages found.</p>"}
    </div>
  </div>
  <script>window.SEARCH_INDEX_URL = '${searchIndexUrl}';</script>
  <script src="https://cdn.jsdelivr.net/npm/fuse.js@7/dist/fuse.min.js"></script>
  <script src="${assetsBase}/${searchJsFile}"></script>
  <script>(function(){var el=document.getElementById('theme-select');if(el){el.value=localStorage.getItem('sidecar_theme')||'classic';el.addEventListener('change',function(){document.documentElement.setAttribute('data-theme',el.value);localStorage.setItem('sidecar_theme',el.value);});}})();</script>
</body>
</html>`;
}

function generateIndexPages(outputDir, builtFiles, basePath, logo, assets) {
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
    const breadcrumbs = buildBreadcrumbs(outputDir, path.join(dirPath, 'index.html'));

    const idepth = path.relative(outputDir, dirPath).split(path.sep).filter(Boolean).length;
    const searchIndexUrl = (idepth > 0 ? "../".repeat(idepth) : "") + "search-index.json";

    const indexHtml = generateIndexHtml({ title: dirName, entries, basePath, breadcrumbs, logo, searchIndexUrl, assets });
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
  const { inputDir, outputDir, serverUrl, siteId, basePath, logo, assets } = opts;
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

  const depth = path.relative(outputDir, path.dirname(outPath)).split(path.sep).filter(Boolean).length;
  const searchIndexUrl = (depth > 0 ? "../".repeat(depth) : "") + "search-index.json";

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(
    outPath,
    generateHtml({
      title,
      documentId,
      serverUrl,
      basePath,
      markdown: content,
      html,
      breadcrumbs,
      logo,
      searchIndexUrl,
      assets,
    }),
  );

  const plainText = extractPlainText(content).slice(0, 5000);
  return { filePath, outPath, documentId, title, description, plainText };
}

function build(args) {
  const { input, output, server, siteId, basePath, logo } = args;
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

  // Copy static assets into output with content-hashed filenames for cache busting
  const staticAssets = ['app.js', 'search.js', 'sidecar.css'];
  const publicDir = path.join(__dirname, 'public');
  const assets = {};
  for (const asset of staticAssets) {
    const src = path.join(publicDir, asset);
    if (fs.existsSync(src)) {
      const hash = contentHash(src);
      const destName = hashedAssetName(asset, hash);
      fs.copyFileSync(src, path.join(outputDir, destName));
      assets[asset] = destName;
      console.log(`  [asset]  → ${path.relative(process.cwd(), path.join(outputDir, destName))}`);
    }
  }

  const opts = { inputDir, outputDir, serverUrl: server, siteId, basePath, logo, assets };
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

  generateIndexPages(outputDir, built, basePath, logo, assets);

  // Generate search index
  const searchIndex = built.map(({ outPath, title, description, plainText }) => ({
    title,
    description: description || '',
    content: plainText || '',
    url: basePath + '/' + path.relative(outputDir, outPath).split(path.sep).join('/'),
  }));
  fs.writeFileSync(
    path.join(outputDir, 'search-index.json'),
    JSON.stringify(searchIndex),
  );
  console.log(`  [search] → ${path.relative(process.cwd(), path.join(outputDir, 'search-index.json'))} (${searchIndex.length} entries)`);

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
      basePath: args.basePath,
      logo: args.logo,
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
