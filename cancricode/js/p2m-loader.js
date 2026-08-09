/* p2m-loader.js — hide the loading overlay once the page has finished loading */
(function () {
  function hideLoader() {
    var loader = document.getElementById('p2m-loader');
    if (!loader || loader.dataset.p2mReady) return;
    loader.dataset.p2mReady = '1';
    loader.classList.add('p2m-fade-out');
    setTimeout(function () {
      if (loader.parentNode) loader.parentNode.removeChild(loader);
    }, 500);
  }

  if (document.readyState === 'complete') {
    hideLoader();
  } else {
    window.addEventListener('load', hideLoader);
  }
})();
