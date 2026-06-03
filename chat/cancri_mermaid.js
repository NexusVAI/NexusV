(function () {
  const MERMAID_CDN =
    "https://cdn.jsdelivr.net/npm/mermaid@10.9.3/dist/mermaid.min.js";
  let loadPromise = null;
  let initDone = false;

  function getMermaidTheme() {
    const theme =
      document.documentElement.getAttribute("data-theme") || "light";
    return theme === "dark" || theme === "black" ? "dark" : "default";
  }

  function isInlineMermaidEnabled() {
    const st = window.CancriApp && window.CancriApp.state;
    return !st || st.inlineMermaidEnabled !== false;
  }

  function ensureMermaid() {
    if (window.__MERMAID_FAILED__) {
      return Promise.reject(new Error("mermaid unavailable"));
    }
    if (window.mermaid) return Promise.resolve(window.mermaid);
    if (loadPromise) return loadPromise;
    loadPromise = new Promise(function (resolve, reject) {
      const script = document.createElement("script");
      script.src = MERMAID_CDN;
      script.async = true;
      script.onload = function () {
        if (window.mermaid) resolve(window.mermaid);
        else reject(new Error("mermaid global missing"));
      };
      script.onerror = function () {
        window.__MERMAID_FAILED__ = true;
        reject(new Error("mermaid script load failed"));
      };
      document.head.appendChild(script);
    });
    return loadPromise;
  }

  function initMermaid() {
    return ensureMermaid().then(function (mermaid) {
      if (initDone) {
        mermaid.initialize({ theme: getMermaidTheme() });
        return mermaid;
      }
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: getMermaidTheme(),
      });
      initDone = true;
      return mermaid;
    });
  }

  function markMermaidError(block, message) {
    block.classList.add("mermaid-error");
    block.removeAttribute("data-mermaid-pending");
    const diagramHost = block.querySelector(".mermaid-diagram");
    if (diagramHost) diagramHost.hidden = true;
    const hint = block.querySelector(".mermaid-error-hint");
    if (hint) {
      hint.hidden = false;
      hint.textContent = message || "图表无法渲染，已显示源码。";
    }
  }

  async function renderMermaidInElement(root) {
    if (!root || !isInlineMermaidEnabled() || window.__MERMAID_FAILED__) {
      return;
    }
    const blocks = root.querySelectorAll(
      '.mermaid-block[data-mermaid-pending="1"]',
    );
    if (!blocks.length) return;

    let mermaid;
    try {
      mermaid = await initMermaid();
    } catch (error) {
      console.warn("Mermaid init failed:", error);
      blocks.forEach(function (block) {
        markMermaidError(block, "Mermaid 加载失败");
      });
      return;
    }

    mermaid.initialize({ theme: getMermaidTheme() });

    for (const block of blocks) {
      const codeEl = block.querySelector(".mermaid-source code");
      const source = codeEl ? codeEl.textContent || "" : "";
      if (!source.trim()) {
        block.removeAttribute("data-mermaid-pending");
        continue;
      }

      let diagramHost = block.querySelector(".mermaid-diagram");
      if (!diagramHost) {
        diagramHost = document.createElement("div");
        diagramHost.className = "mermaid-diagram";
        block.appendChild(diagramHost);
      }
      diagramHost.hidden = false;
      diagramHost.innerHTML = "";
      block.classList.remove("mermaid-error");

      const diagram = document.createElement("pre");
      diagram.className = "mermaid";
      diagram.textContent = source;
      diagramHost.appendChild(diagram);

      try {
        await mermaid.run({ nodes: [diagram] });
        block.setAttribute("data-mermaid-done", "1");
        block.removeAttribute("data-mermaid-pending");
      } catch (error) {
        console.warn("Mermaid render error:", error);
        markMermaidError(block, "图表语法有误");
      }
    }
  }

  window.CancriMermaid = {
    renderMermaidInElement: renderMermaidInElement,
  };
})();
