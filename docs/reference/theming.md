---
title: Theming
id: ebfce9bf26fa9f201d560a00978195e6
---

# Theming

All colors and visual variables are defined in `public/theme.css` using CSS custom properties. To apply a custom brand, copy that file, edit the variables, and load your version instead.

No other files need to change.

## How to create a custom theme

1. Copy `public/theme.css` to a new file (e.g. `my-team-theme.css`).
2. Edit the CSS variables to match your brand.
3. In `public/index.html`, replace the `theme.css` link with your file:

```html
<link rel="stylesheet" href="/my-team-theme.css">
<link rel="stylesheet" href="/sidecar.css">
```

For built sites, place your theme file in `public/` — it will be copied and cache-busted automatically by `build.js`.

---

## Variable reference

### Header

| Variable | Default | Description |
|----------|---------|-------------|
| `--hdr-bg` | `#1f2937` | Page header background |
| `--hdr-color` | `#f9fafb` | Page header text and icon color |

### Page & document

| Variable | Default | Description |
|----------|---------|-------------|
| `--page-bg` | `#f3f4f6` | Outer page background (behind the document) |
| `--doc-bg` | `#ffffff` | Document pane background |
| `--doc-color` | `#1f2937` | Body text color |
| `--heading-color` | `#111827` | H1 color |
| `--heading-color-2` | `#374151` | H2–H6 color |

### Sidebar

| Variable | Default | Description |
|----------|---------|-------------|
| `--sidebar-bg` | `#f9fafb` | Sidebar background |
| `--sidebar-border` | `#e5e7eb` | Sidebar left border |

### Accent (interactive elements)

| Variable | Default | Description |
|----------|---------|-------------|
| `--accent` | `#2563eb` | Primary color — buttons, active tabs, links |
| `--accent-hover` | `#1d4ed8` | Hover state for accent elements |
| `--accent-light` | `#dbeafe` | Focus rings, active tab background |
| `--accent-text` | `#1d4ed8` | Accent-colored text (card titles, breadcrumbs) |

### Borders & text

| Variable | Default | Description |
|----------|---------|-------------|
| `--border` | `#e5e7eb` | General border color |
| `--input-border` | `#d1d5db` | Form input border |
| `--text-muted` | `#6b7280` | Secondary text, labels |
| `--text-dim` | `#d1d5db` | Timestamps, faded UI text |

### Cards

| Variable | Default | Description |
|----------|---------|-------------|
| `--card-bg` | `#ffffff` | Comment card and message bubble background |
| `--card-border` | `#e5e7eb` | Comment card border |

### Comment highlights

These control the amber tint used to mark commented text and the gutter bars in the document.

| Variable | Default | Description |
|----------|---------|-------------|
| `--mark-bg` | `#fef3c7` | Highlighted text background (markdown view) |
| `--mark-border` | `#d97706` | Highlight underline and gutter bar color |
| `--mark-hover-bg` | `#fde68a` | Hovered highlight background |
| `--mark-active-shadow` | `#d97706` | Focus ring on active highlight |
| `--mark-block-hover-bg` | `rgba(217,119,6,0.08)` | Block element hover tint (preview mode) |
| `--mark-block-active-bg` | `rgba(217,119,6,0.13)` | Block element active tint (preview mode) |

### Thread anchor & quote strips

| Variable | Default | Description |
|----------|---------|-------------|
| `--thread-anchor-bg` | `#fef3c7` | Background of quoted text in thread view |
| `--thread-anchor-border` | `#d97706` | Left border of quoted text in thread view |
| `--thread-anchor-color` | `#92400e` | Text color of quoted text in thread view |
| `--modal-selected-bg` | `#fef3c7` | Selected-text quote in new-comment form |
| `--modal-selected-border` | `#d97706` | Border of selected-text quote |
| `--modal-selected-color` | `#92400e` | Text color of selected-text quote |

### Miscellaneous

| Variable | Default | Description |
|----------|---------|-------------|
| `--author-bar-bg` | `#f0f9ff` | Resolved thread banner background |
| `--author-bar-border` | `#e5e7eb` | Resolved thread banner border |
| `--resizer-hover` | `#93c5fd` | Sidebar resize handle hover color |

### Secondary / resolve button

| Variable | Default | Description |
|----------|---------|-------------|
| `--secondary` | `#f1f5f9` | Resolve button background |
| `--secondary-hover` | `#e2e8f0` | Resolve button hover background |
| `--secondary-border` | `#cbd5e1` | Resolve button border |
| `--secondary-text` | `#475569` | Resolve button text color |
| `--secondary-light` | `#f8fafc` | Resolve-with-comment textarea background |

---

## Example: dark theme

```css
:root {
  --hdr-bg:          #0f172a;
  --hdr-color:       #f1f5f9;
  --page-bg:         #1e293b;
  --doc-bg:          #0f172a;
  --doc-color:       #e2e8f0;
  --heading-color:   #f1f5f9;
  --heading-color-2: #cbd5e1;
  --sidebar-bg:      #1e293b;
  --sidebar-border:  #334155;
  --accent:          #38bdf8;
  --accent-hover:    #7dd3fc;
  --accent-light:    #082f49;
  --accent-text:     #38bdf8;
  --border:          #334155;
  --input-border:    #475569;
  --text-muted:      #94a3b8;
  --text-dim:        #475569;
  --card-bg:         #1e293b;
  --card-border:     #334155;
  --mark-bg:              #451a03;
  --mark-border:          #ea580c;
  --mark-hover-bg:        #7c2d12;
  --mark-active-shadow:   #ea580c;
  --mark-block-hover-bg:  rgba(234, 88, 12, 0.12);
  --mark-block-active-bg: rgba(234, 88, 12, 0.20);
  --thread-anchor-bg:     #451a03;
  --thread-anchor-border: #ea580c;
  --thread-anchor-color:  #fed7aa;
  --modal-selected-bg:     #451a03;
  --modal-selected-border: #ea580c;
  --modal-selected-color:  #fed7aa;
  --author-bar-bg:     #1e293b;
  --author-bar-border: #334155;
  --resizer-hover:     #38bdf8;
  --secondary:        #1e293b;
  --secondary-hover:  #334155;
  --secondary-border: #475569;
  --secondary-text:   #94a3b8;
  --secondary-light:  #0f172a;
}
```
