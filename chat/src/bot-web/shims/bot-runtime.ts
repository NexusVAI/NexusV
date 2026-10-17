/**
 * 网页端替身：cancri-code/src/bot/bot-runtime.ts。
 * 网页 / 手机不跑 agent loop：createBotView(..., { remote: true }) 把消息交给云端 `/send`，
 * 回复、正在输入、已读都从 BotHub 事件回来。这里只留 bot-view 用到的形状，任何一处真去跑都会明确报错。
 */
import type { BotComputer } from "./bot-computer";

export const BOT_SYSTEM_PROMPT = "";

export function groupSessionKey(groupId: string, botId: string): string {
  return `group:${groupId}:${botId}`;
}

const NOT_HERE = "网页端由云端 Bot 回复，本地不运行 agent";

export class BotRuntime {
  constructor(private readonly deps: { computer: BotComputer }) {}
  computerOf(): BotComputer {
    return this.deps.computer;
  }
  controllerFor(): { approveCall(id: string): void; denyCall(id: string, why?: string): void } {
    return { approveCall() {}, denyCall() {} };
  }
  forget(_key: string): void {}
  forgetGroup(_id: string): void {}
  forgetBot(_id: string): void {}
  forgetAll(): void {}
  isRunning(_key: string): boolean {
    return false;
  }
  // eslint-disable-next-line require-yield
  async *run(): AsyncIterable<never> {
    throw new Error(NOT_HERE);
  }
  abort(_key: string): void {}
}
