// Configure marked to escape raw HTML blocks so injected HTML can't execute scripts.
const { marked } = require('marked');

marked.use({
  renderer: {
    // marked v9 may pass `text` instead of `raw` in certain rendering paths
    html({ raw, text }) {
      const content = raw || text || '';
      return content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    },
  },
});

module.exports = { marked };
