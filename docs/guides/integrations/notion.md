---
title: Notion Export Integration
id: 9a4a9eeda2f83a870453826443032845
---

# Notion Export Integration

Notion can export pages as markdown. With some light post-processing, you can feed that output into `build.js` and add a threaded comment layer on top.

## Export from Notion

1. Open the page or workspace you want to export
2. Click **···** (top-right) → **Export**
3. Choose **Markdown & CSV**, include subpages
4. Download and unzip the archive

The archive structure looks like:

```
My Workspace/
  Page Title abc123/
    index.md
    Subpage def456.md
    Subpage def456/
      ...
  Another Page ghi789.md
```

Notion appends a UUID to every file and directory name. You'll want to strip those before building.

## Clean up the export

A small script to rename files and remove Notion UUIDs:

```bash
#!/bin/bash
# strip-notion-ids.sh
find "$1" -name "*.md" | while read f; do
  dir=$(dirname "$f")
  base=$(basename "$f" .md)
  clean=$(echo "$base" | sed 's/ [a-f0-9]\{32\}$//')
  if [ "$base" != "$clean" ]; then
    mv "$f" "$dir/$clean.md"
  fi
done

find "$1" -type d | sort -r | while read d; do
  parent=$(dirname "$d")
  base=$(basename "$d")
  clean=$(echo "$base" | sed 's/ [a-f0-9]\{32\}$//')
  if [ "$base" != "$clean" ]; then
    mv "$d" "$parent/$clean"
  fi
done
```

Run it:

```bash
chmod +x strip-notion-ids.sh
./strip-notion-ids.sh "./My Workspace"
```

## Known issues with Notion markdown exports

| Issue | Notes |
|---|---|
| Images use Notion CDN URLs | URLs expire — download and re-host images |
| Inline databases | Export as CSV files, not rendered in markdown |
| Callout blocks | Export as blockquotes, lose icon/color |
| Synced blocks | Only the instance in the export is included |
| Formulas | Exported as plain text, not rendered as math |

For documentation pages (prose, headings, lists, code blocks), exports are generally clean.

## Stable document IDs after re-export

Each Notion export creates a fresh directory. If you re-export and rebuild, document IDs will be the same *as long as file paths are the same* after cleanup.

If a page is renamed in Notion, the file name changes → the document ID changes → comments are orphaned.

To prevent this, pin the document ID using frontmatter before the first export:

```yaml
---
title: My Page
id: a3f1c9e08b2d47e6f001234567890abc
---
```

Generate a 32-char hex ID with:

```bash
node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
```

## Workflow

```
Notion → Export → Unzip → Clean UUIDs → node build.js → Deploy
```

A GitHub Action can automate all steps except the Notion export itself (Notion's API can export pages programmatically with the right credentials).
