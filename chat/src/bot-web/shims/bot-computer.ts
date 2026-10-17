/**
 * 网页端替身：cancri-code/src/bot/bot-computer.ts（桌面直接开云沙箱、连 CDP 画面）。
 * 网页端不碰云电脑：Bot 需要电脑时由云端（BotHub）自己开机，截图作为消息发回来。
 * 面板「电脑」页显示一句说明；上传 / 开关机按钮给出同样的提示。
 */
export type ComputerPhase = "off" | "starting" | "running" | "paused" | "unavailable";
export interface ComputerView {
  phase: ComputerPhase;
  hasBrowser: boolean;
  billedSeconds: number;
  lastStopReason: string | null;
  error: string | null;
  userControl: boolean;
}
export type ComputerKey = `bot:${string}` | `group:${string}`;
export type ScreenState = "connecting" | "live" | "waiting" | "error";
export type ActiveComputer = { backend: unknown; sessionId: string; hasBrowser: boolean; browserUnknown: boolean };

export const LEGACY_COMPUTER = "@legacy";
export const UPLOAD_MAX_BYTES = 25 * 1024 * 1024;
export const WEB_COMPUTER_HINT = "网页端不直接操作云电脑：Bot 需要时会在云端自己开机，截图发到聊天里。要看实时画面请用 Cancri Code 桌面端。";

export class BotComputerError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "BotComputerError";
  }
}

export const TERMINAL_COMPUTER_CODES = new Set(["web_unsupported"]);

export function computerErrorMessage(e: unknown): { code: string; message: string } {
  if (e instanceof BotComputerError) return { code: e.code, message: e.message };
  return { code: "computer_error", message: e instanceof Error ? e.message : String(e) };
}

const unsupported = (): never => {
  throw new BotComputerError("web_unsupported", WEB_COMPUTER_HINT);
};

export async function uploadBytes(): Promise<void> {
  unsupported();
}

export class BotComputer {
  readonly sessionId: string | null = null;
  readonly userControl = false;
  setUserControl(_on: boolean): void {}
  noteUserInput(): void {}
  subscribe(_fn: (v: ComputerView) => void): () => void {
    return () => {};
  }
  view(): ComputerView {
    return { phase: "unavailable", hasBrowser: false, billedSeconds: 0, lastStopReason: null, error: WEB_COMPUTER_HINT, userControl: false };
  }
  describe(): string {
    return WEB_COMPUTER_HINT;
  }
  async ensure(): Promise<ActiveComputer> {
    return unsupported();
  }
  async use<T>(): Promise<T> {
    return unsupported();
  }
  async quota(): Promise<null> {
    return null;
  }
  async wake(): Promise<void> {
    unsupported();
  }
  async sleep(): Promise<void> {
    unsupported();
  }
  async shutdown(): Promise<void> {
    unsupported();
  }
}

let shared: BotComputer | null = null;
export function botComputer(): BotComputer {
  return (shared ??= new BotComputer());
}

/** 网页端不建电脑池（createBotView 传了 computer 就不会用到） */
export class ComputerPool {
  get(_key: ComputerKey): BotComputer {
    return botComputer();
  }
  drop(_key: ComputerKey): void {}
  dispose(): void {}
}

/** 实时画面：网页端没有，只报一次状态 */
export class ScreenStream {
  constructor(_canvas: HTMLCanvasElement, onState: (s: ScreenState, detail?: string) => void) {
    queueMicrotask(() => onState("error", WEB_COMPUTER_HINT));
  }
  setInteractive(_on: boolean): void {}
  resize(): void {}
  dispose(): void {}
}
