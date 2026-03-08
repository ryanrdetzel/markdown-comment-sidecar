// Configure marked to escape raw HTML blocks so injected HTML can't execute scripts.
const { marked } = require('marked');

marked.use({
  renderer: {
    html({ raw }) {
      return raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    },
  },
});

module.exports = { marked };
