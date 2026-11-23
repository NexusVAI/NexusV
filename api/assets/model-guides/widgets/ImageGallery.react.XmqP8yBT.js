import { t as runtime } from "./jsx-runtime.CWLBoBiw.js";
import { t as Gallery } from "./Gallery.react.wuwb2_9O.js?v=20261123b";

const { jsx } = runtime();
const image = (filename) => `/api/assets/model-guides/img/${filename}`;

// Keep only previews that are already available locally; prompts are illustrative.
const examples = [
  {
    id: "indoor-pool",
    title: "阳光下的室内泳池",
    poster: image("f964ffd18d535bef0131.png"),
    prompt: "生成一张杂志风格的室内建筑图。暖米色墙面和藤椅围绕浅水泳池，阳光透过高窗，在墙面和地板投下长影。画面中不要出现人物和文字。",
  },
  {
    id: "bath-bomb",
    title: "泡澡球产品图",
    poster: image("b553f0dc85050f0bf0b3.png"),
    prompt: "拍摄一张泡澡球的产品特写，保留表面的细微纹理。主体居中，用柔和侧光突显轮廓，背景简洁，不加文字。",
  },
];

export function t() {
  return jsx(Gallery, { examples, type: "image" });
}
