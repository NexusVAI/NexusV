/** 网页端替身：cancri-code/src/tools/builtin/websearch.ts / webfetch.ts（工具在云端跑，网页只需要形状） */
const offline = { needsApproval: () => "auto", availableIn: "both", shouldDefer: false, schema: { type: "object", properties: {} }, execute: async () => ({ ok: false, content: "网页端不运行工具", error: "web" }) };
export const webSearchTool = { name: "web_search", description: "", ...offline };
export const webFetchTool = { name: "web_fetch", description: "", ...offline };
export function extractPageImages(): string[] {
  return [];
}
