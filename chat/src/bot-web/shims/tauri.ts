/** 网页端替身：@tauri-apps/plugin-opener 与 @tauri-apps/api/core */
export async function openUrl(url: string): Promise<void> {
  window.open(url, "_blank", "noopener,noreferrer");
}
export async function revealItemInDir(): Promise<void> {}
export async function invoke<T>(cmd: string): Promise<T> {
  throw new Error(`网页端没有本机命令 ${cmd}`);
}
export function convertFileSrc(p: string): string {
  return p;
}
