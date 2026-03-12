---
title: VS Code Integration
id: dc861eecd1a9b6a7682337ab1f9287f9
---

# VS Code Integration

You can use markdown-comment-sidecar alongside VS Code for a local review workflow — edit markdown in VS Code, view comments in the browser.

## Setup

Run the dev server in watch mode while editing:

```bash
node build.js \
  --input ./docs \
  --output ./dist \
  --server http://localhost:3000 \
  --site-id local-dev \
  --assets-url http://localhost:3000 \
  --watch
```

Open `dist/index.html` in a browser. As you save files in VS Code, the build output updates automatically. Refresh the browser to see the latest render.

## Recommended extensions

**Live Server** — auto-refreshes the browser when `dist/` files change. Install it from the Extensions panel, then right-click `dist/index.html` and choose *Open with Live Server*.

Combined with `--watch`, you get a near-instant feedback loop: save a markdown file in VS Code → build runs → browser refreshes → comments still attached.

## Tasks integration

Add a task to `.vscode/tasks.json` to start the build watcher with one command:

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "Sidecar: start dev",
      "type": "shell",
      "command": "npm start & node build.js --input ./docs --output ./dist --server http://localhost:3000 --site-id local-dev --assets-url http://localhost:3000 --watch",
      "isBackground": true,
      "problemMatcher": []
    }
  ]
}
```

Run it from the Command Palette: **Tasks: Run Task → Sidecar: start dev**.

## Workspace settings

If you use the Markdown Preview extension, you may want to exclude `dist/` from file watching to avoid noise:

```json
{
  "files.watcherExclude": {
    "**/dist/**": true
  }
}
```

## Limitations

The VS Code Markdown Preview pane renders markdown directly — it won't show the comment sidecar. All commenting happens in the browser preview of the built `dist/` files, not inside VS Code itself.
