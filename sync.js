#!/usr/bin/env node
// sync.js — Pull comments from the server and store as sidecar JSON files
//
// Usage:
//   node sync.js --server https://comments.example.com --site-id <secret> --input ./docs

const fs = require('fs');
const path = require('path');
const { parseFrontmatter, makeDocumentId, findMarkdownFiles } = require('./lib/document-id');

function parseArgs() {
  const args = process.argv.slice(2);
  const result = { input: './docs', server: null, siteId: null };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input')   result.input   = args[++i];
    if (args[i] === '--server')  result.server  = args[++i];
    if (args[i] === '--site-id') result.siteId  = args[++i];
  }

  const missing = [];
  if (!result.server) missing.push('--server <url>');
  if (!result.siteId) missing.push('--site-id <token>');

  if (missing.length) {
    console.error('Error: missing required flags: ' + missing.join(', '));
    console.error('');
    console.error('Usage:');
    console.error('  node sync.js --server https://comments.example.com --site-id <secret> --input ./docs');
    process.exit(1);
  }

  return result;
}

async function syncFile(filePath, inputDir, serverUrl, siteId) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const { data } = parseFrontmatter(raw);
  const documentId = makeDocumentId(filePath, inputDir, siteId, data.id || null);
  const sidecarFile = filePath + '.comments.json';

  const res = await fetch(`${serverUrl}/api/threads?documentId=${encodeURIComponent(documentId)}`);
  if (!res.ok) {
    const err = await res.text();
    console.error(`  ✗ ${path.relative(process.cwd(), filePath)} — ${res.status}: ${err}`);
    return { filePath, synced: false };
  }

  const { threads } = await res.json();

  if (threads.length === 0) {
    // Remove stale sidecar file if no threads exist
    if (fs.existsSync(sidecarFile)) {
      fs.unlinkSync(sidecarFile);
      console.log(`  - ${path.relative(process.cwd(), sidecarFile)} (removed, no threads)`);
    }
    return { filePath, synced: true, threads: 0 };
  }

  fs.writeFileSync(sidecarFile, JSON.stringify({ threads }, null, 2) + '\n');
  console.log(`  ${path.relative(process.cwd(), sidecarFile)} (${threads.length} thread${threads.length === 1 ? '' : 's'})`);
  return { filePath, synced: true, threads: threads.length };
}

async function main() {
  const { input, server, siteId } = parseArgs();
  const inputDir = path.resolve(input);

  if (!fs.existsSync(inputDir)) {
    console.error(`Input directory not found: ${inputDir}`);
    process.exit(1);
  }

  const files = findMarkdownFiles(inputDir);
  if (files.length === 0) {
    console.warn(`No .md files found in ${inputDir}`);
    return;
  }

  console.log(`Syncing comments for ${files.length} file(s) from ${server}...\n`);

  const results = [];
  for (const f of files) {
    results.push(await syncFile(f, inputDir, server, siteId));
  }

  const synced = results.filter(r => r.synced);
  const withThreads = results.filter(r => r.threads > 0);
  console.log(`\nDone. ${withThreads.length}/${synced.length} file(s) have comments.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
