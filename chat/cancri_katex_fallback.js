(function() {
  window.__katexRender = window.renderMathInElement;
  if (typeof katex !== 'undefined' && typeof renderMathInElement === 'function') {
    console.log('KaTeX loaded locally');
    return;
  }
  console.warn('Local KaTeX not found, trying CDNs...');
  var cdns = [
    'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/'
  ];
  var i = 0;
  function tryNext() {
    if (i >= cdns.length) {
      console.warn('All KaTeX CDNs failed, using fallback renderer');
      window.__KATEX_FAILED__ = true;
      return;
    }
    var url = cdns[i++];
    var advanced = false;
    var advance = function() { if (advanced) return; advanced = true; tryNext(); };
    var css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = url + 'katex.min.css';
    css.onerror = advance;
    document.head.appendChild(css);
    var s1 = document.createElement('script');
    s1.src = url + 'katex.min.js';
    s1.onerror = advance;
    s1.onload = function() {
      var s2 = document.createElement('script');
      s2.src = url + 'contrib/auto-render.min.js';
      s2.onerror = advance;
      s2.onload = function() {
        window.__katexRender = window.renderMathInElement;
        console.log('KaTeX loaded from CDN:', url);
      };
      document.head.appendChild(s2);
    };
    document.head.appendChild(s1);
  }
  tryNext();
})();
