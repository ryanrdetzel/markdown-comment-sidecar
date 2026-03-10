// Configure marked to escape raw HTML blocks so injected HTML can't execute scripts.
const { marked } = require('marked');

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

marked.use({
  renderer: {
    // marked v9 may pass `text` instead of `raw` in certain rendering paths
    html({ raw, text }) {
      const content = raw || text || '';
      return content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    },
    // text = rendered inline HTML, depth = heading level, raw = plain text
    heading(text, depth, raw) {
      const id = slugify(raw);
      return `<h${depth} id="${id}"><a class="heading-anchor" href="#${id}" aria-hidden="true" tabindex="-1">#</a>${text}</h${depth}>\n`;
    },
  },
});

module.exports = { marked, slugify };
