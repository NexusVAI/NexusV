(async function () {
const widgets={"CodeGallery": ["CodeGallery.react.5W_qk2nf.js", "CodeGallery", "client.CZmKDkdW.js"], "ImageTokenCalculator": ["ImageTokenCalculator.react.BsMSxXvw.js", "default", "client.CZmKDkdW.js"], "GptImageTokenCalculator": ["GptImageTokenCalculator.react.DY63GmLk.js", "default", "client.CZmKDkdW.js"], "ImageGallery": ["ImageGallery.react.B9yz12N0.js", "ImageGallery", "client.CZmKDkdW.js"]};
const roots=[...document.querySelectorAll("[data-guide-widget]")];
await Promise.all(roots.map(async el=>{
  el.inert=true; el.setAttribute("aria-busy","true");
  const [file, name, renderer] = widgets[el.dataset.guideWidget];
  const [component, client] = await Promise.all([import("./"+file),import("./"+renderer)]);
  const mounted=new MutationObserver(()=>{mounted.disconnect();el.inert=false;el.removeAttribute("aria-busy");el.dataset.guideReady="true";});
  mounted.observe(el,{childList:true});
  client.default(el)(component[name], JSON.parse(el.dataset.props), {}, {client:"only"});
}));
})();