// Configure marked to escape raw HTML blocks so injected HTML can't execute scripts.
const { marked } = require('marked');

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-');
}

marked.use({
  renderer: {
    // marked v9 may pass `text` instead of `raw` in certain rendering paths
    html({ raw, text }) {
      const content = raw || text || '';
      return content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    },
    heading(text, depth, raw) {
      const id = slugify(raw);
      const svg = `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M7.775 3.275a.75.75 0 0 0 1.06 1.06l1.25-1.25a2 2 0 1 1 2.83 2.83l-2.5 2.5a2 2 0 0 1-2.83 0 .75.75 0 0 0-1.06 1.06 3.5 3.5 0 0 0 4.95 0l2.5-2.5a3.5 3.5 0 0 0-4.95-4.95l-1.25 1.25zm-4.69 9.64a2 2 0 0 1 0-2.83l2.5-2.5a2 2 0 0 1 2.83 0 .75.75 0 0 0 1.06-1.06 3.5 3.5 0 0 0-4.95 0l-2.5 2.5a3.5 3.5 0 0 0 4.95 4.95l1.25-1.25a.75.75 0 0 0-1.06-1.06l-1.25 1.25a2 2 0 0 1-2.83 0z"/></svg>`;
      return `<h${depth} id="${id}">${text}<a class="heading-anchor" href="#${id}" title="Copy link to this section" aria-label="Link to this section">${svg}</a></h${depth}>\n`;
    },
  },
});

module.exports = { marked };
