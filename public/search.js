(function () {
  var input = document.getElementById('search-input');
  var results = document.getElementById('search-results');
  if (!input || !results) return;

  var fuse = null;
  var loadPromise = null;

  function getSearchIndexUrl() {
    return window.SEARCH_INDEX_URL || 'search-index.json';
  }

  function loadIndex() {
    if (loadPromise) return loadPromise;
    loadPromise = fetch(getSearchIndexUrl())
      .then(function (r) { return r.json(); })
      .then(function (data) {
        fuse = new Fuse(data, {
          keys: ['title', 'description', 'content'],
          threshold: 0.35,
          ignoreLocation: true,
        });
        return fuse;
      })
      .catch(function () { return null; });
    return loadPromise;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function highlight(text, query) {
    var escaped = escapeHtml(text);
    if (!query) return escaped;
    var escapedQuery = escapeHtml(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try {
      var re = new RegExp('(' + escapedQuery + ')', 'gi');
      return escaped.replace(re, '<mark>$1</mark>');
    } catch (e) {
      return escaped;
    }
  }

  function renderResults(items, query) {
    if (!items || items.length === 0) {
      results.innerHTML = '<div class="search-no-results">No results found</div>';
      results.hidden = false;
      return;
    }
    results.innerHTML = items.slice(0, 8).map(function (item) {
      return '<a class="search-result-item" href="' + escapeHtml(item.url) + '">' +
        '<div class="search-result-title">' + highlight(item.title, query) + '</div>' +
        (item.description ? '<div class="search-result-desc">' + highlight(item.description, query) + '</div>' : '') +
        '</a>';
    }).join('');
    results.hidden = false;
  }

  function close() {
    results.hidden = true;
    results.innerHTML = '';
  }

  function getItems() {
    return results.querySelectorAll('.search-result-item');
  }

  function setActive(index) {
    var items = getItems();
    items.forEach(function (el, i) {
      el.classList.toggle('search-result-active', i === index);
    });
  }

  var debounceTimer;
  input.addEventListener('input', function () {
    clearTimeout(debounceTimer);
    var q = input.value.trim();
    if (!q) { close(); return; }
    debounceTimer = setTimeout(function () {
      loadIndex().then(function () {
        if (!fuse) {
          results.innerHTML = '<div class="search-no-results">Search index not available</div>';
          results.hidden = false;
          return;
        }
        var matches = fuse.search(q).map(function (r) { return r.item; });
        renderResults(matches, q);
      });
    }, 150);
  });

  input.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { close(); input.blur(); return; }

    var items = getItems();
    if (!items.length) return;

    var current = Array.prototype.indexOf.call(items, results.querySelector('.search-result-active'));

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(current < items.length - 1 ? current + 1 : 0);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(current > 0 ? current - 1 : items.length - 1);
    } else if (e.key === 'Enter') {
      var active = results.querySelector('.search-result-active');
      if (active) { e.preventDefault(); window.location.href = active.href; }
    }
  });

  input.addEventListener('focus', function () {
    if (input.value.trim() && !results.hidden) {
      results.hidden = false;
    }
  });

  document.addEventListener('click', function (e) {
    if (!input.contains(e.target) && !results.contains(e.target)) {
      close();
    }
  });
})();
