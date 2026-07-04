// 模块化拆分自 cancri_chat.js：OpenAI Images b64_json -> data URL（按 magic 选 MIME，纯函数）。
export function openAiB64JsonToDataUrl(b64Json) {
  const b64 = String(b64Json || "").trim();
  if (!b64) return "";
  if (b64.startsWith("/9j/") || b64.startsWith("9j/")) {
    return `data:image/jpeg;base64,${b64}`;
  }
  if (b64.startsWith("iVBORw0KG")) {
    return `data:image/png;base64,${b64}`;
  }
  if (b64.startsWith("UklGR")) {
    return `data:image/webp;base64,${b64}`;
  }
  return `data:image/jpeg;base64,${b64}`;
}
