// 移植自 cancri-code/src/bot/bot-device-types.ts（scripts/sync-bot-port.mjs 原样拷贝，勿手改）
/**
 * 电脑接入（pc_* 设备通道）里各端共用的类型 —— 只有类型，没有任何运行时依赖。
 *
 * bot-view.ts 只从这里拿类型：网页端移植（chat 的 sync-bot）顺着 import 拷文件时只会带上这一个，
 * 真正干活、要 invoke Rust 的 bot-device.ts / bot-device-link.ts 只留在桌面端。
 */

/** 六个能力；顺序 / 取值与 bot-device.ts 的 DEVICE_TOOL_NAMES、cf-gateway bot-hub 的 PC_TOOLS 一致 */
export type DeviceToolName = "pc_status" | "pc_files" | "pc_screenshot" | "pc_screen_record" | "pc_send_file" | "pc_notify";

export interface DeviceMedia {
  kind: "image" | "video" | "file";
  mime: string;
  name: string;
  bytes: Uint8Array;
  width?: number;
  height?: number;
  durationMs?: number;
}

export interface DeviceOutcome {
  ok: boolean;
  /** 给模型看的结果（成功 / 失败原因都是中文） */
  text: string;
  media?: DeviceMedia;
}

export type DevicePhase = "off" | "connecting" | "online" | "error";

/** bot-view 用到的那一面（网页端没有，传 undefined） */
export interface BotDeviceHandle {
  readonly phase: DevicePhase;
  readonly error?: string;
  enabled(): boolean;
  setEnabled(on: boolean): void;
  onChange(fn: () => void): () => void;
  /** 本地跑的 Bot 用 pc_* 工具（不受开关限制：确认卡在本机弹） */
  run(tool: DeviceToolName, args: Record<string, unknown>, signal: AbortSignal): Promise<DeviceOutcome>;
}
