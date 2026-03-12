#!/usr/bin/env node
// add-ids.js — scan a directory of markdown files and add `id:` to frontmatter
// if the file doesn't already have one. A random 32-character hex string is
// generated for each file — never a guessable slug.
//
// Usage:
//   node scripts/add-ids.js --input ./docs [--dry-run]

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parseFrontmatter, findMarkdownFiles } = require('../lib/document-id');

// Common repo/meta markdown files that are not documentation pages and
// should never receive a sidecar document ID.
const BLOCKLIST = new Set([
  'README',
  'CHANGELOG',
  'CHANGES',
  'HISTORY',
  'CONTRIBUTING',
  'CONTRIBUTORS',
  'LICENSE',
  'CODE_OF_CONDUCT',
  'SECURITY',
  'SUPPORT',
  'AUTHORS',
  'MAINTAINERS',
  'CODEOWNERS',
  'CLAUDE',
  'AGENTS',
  'SKILLS',
  'ROADMAP',
  'TODO',
  'PULL_REQUEST_TEMPLATE',
  'ISSUE_TEMPLATE',
  'BUG_REPORT',
  'FEATURE_REQUEST',
]);

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--input') args.input = argv[++i];
    else if (argv[i] === '--dry-run') args.dryRun = true;
    else if (argv[i] === '--help') args.help = true;
  }
  return args;
}

function addIdToFrontmatter(raw, slug) {
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (fmMatch) {
    // Insert id: after the opening ---
    const fmBlock = fmMatch[1];
    const rest = raw.slice(fmMatch[0].length);
    return `---\n${fmBlock}\nid: ${slug}\n---\n${rest}`;
  } else {
    // No frontmatter — prepend one
    return `---\nid: ${slug}\n---\n${raw}`;
  }
}

function main() {
  const args = parseArgs(process.argv);

  if (args.help || !args.input) {
    console.log('Usage: node scripts/add-ids.js --input <dir> [--dry-run]');
    console.log('');
    console.log('  --input    Directory to scan for markdown files (required)');
    console.log('  --dry-run  Print what would change without writing files');
    process.exit(args.help ? 0 : 1);
  }

  const inputDir = path.resolve(args.input);
  if (!fs.existsSync(inputDir)) {
    console.error(`Error: input directory not found: ${inputDir}`);
    process.exit(1);
  }

  const files = findMarkdownFiles(inputDir);
  let updated = 0;
  let skipped = 0;

  for (const filePath of files) {
    const raw = fs.readFileSync(filePath, 'utf8');
    const { data } = parseFrontmatter(raw);

    if (data.id) {
      skipped++;
      continue;
    }

    const relPath = path.relative(inputDir, filePath).replace(/\\/g, '/').replace(/\.md$/, '');
    const basename = path.basename(relPath);

    if (BLOCKLIST.has(basename.toUpperCase())) {
      console.log(`Skipped (blocklist): ${relPath}.md`);
      skipped++;
      continue;
    }

    const hexId = crypto.randomBytes(16).toString('hex');

    if (args.dryRun) {
      console.log(`[dry-run] Would add id: ${hexId} to ${relPath}.md`);
    } else {
      const updated_content = addIdToFrontmatter(raw, hexId);
      fs.writeFileSync(filePath, updated_content, 'utf8');
      console.log(`Added id: ${hexId} → ${relPath}.md`);
    }
    updated++;
  }

  console.log('');
  console.log(`Done. ${updated} file(s) updated, ${skipped} already had an id.`);
}

main();
