---
title: Obsidian Integration
id: 9ae86364a1e9156b46f76014f856553e
---

# Obsidian Integration

If your documentation lives in an Obsidian vault, you can point `build.js` at the vault directory and get a comment-enabled web view of your notes.

## Caveats

Obsidian markdown is mostly standard CommonMark, but there are some Obsidian-specific features that `marked` won't render correctly:

| Feature | Status |
|---|---|
| Standard markdown (headings, lists, code blocks, links) | Works |
| Wikilinks `[[Note Name]]` | Rendered as broken links |
| Embeds `![[Note Name]]` | Rendered as raw text |
| Dataview queries | Rendered as code blocks |
| Callouts `> [!NOTE]` | Rendered as plain blockquotes |

For plain prose notes, the output is clean. For heavily Obsidian-specific vaults, expect rough edges.

## Setup

Point the build at your vault:

```bash
node build.js \
  --input /path/to/your/vault \
  --output ./dist \
  --server http://localhost:3000 \
  --site-id obsidian-vault \
  --assets-url http://localhost:3000
```

Files in `.obsidian/` (settings, plugins, themes) are ignored by default because `build.js` only processes `.md` files.

## Excluding files

If your vault has files you don't want published, use a separate `docs/` subdirectory within the vault and point `--input` at that:

```
vault/
  docs/         ← build from here
    index.md
    notes/
  private/      ← excluded
  .obsidian/    ← excluded (not .md)
```

## Frontmatter compatibility

Obsidian frontmatter (YAML between `---` delimiters) is parsed by `build.js`. The `title` and `id` fields are recognized:

```yaml
---
title: My Note
id: a3f1c9e08b2d47e6f001234567890abc
tags: [documentation, example]
---
```

Unknown fields like `tags` are ignored by the sidecar but don't cause errors.

## Watch mode with Obsidian

Run `--watch` while Obsidian is open. The build watcher detects saves from Obsidian and regenerates the affected page. Open the `dist/` output in a browser (with Live Server or similar) for a live web view of your vault with comments.
