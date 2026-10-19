// 移植自 cancri-code/src/bot/bot-device-types.ts（scripts/sync-bot-port.mjs 原样拷贝，勿手改）
/**
 * 电脑接入（pc_* 设备通道）里各端共用的类型 —— 只有类型，没有任何运行时依赖。
 *
 * bot-view.ts 只从这里拿类型：网页端移植（chat 的 sync-bot）顺着 import 拷文件时只会带上这一个，
 * 真正干活、要 invoke Rust 的 bot-device.ts / bot-device-link.ts 只留在桌面端。
 */

/**
 * 设备通道认得的能力；顺序 / 取值与 bot-device.ts 的 DEVICE_TOOL_NAMES 一致。
 * 除 pc_save_file 外 = cf-gateway bot-hub 的 PC_TOOLS（模型直接看到）；pc_save_file 是 computer_to_pc（云电脑 → 用户电脑）
 * 的最后一步，只由程序内部调用（云端经设备通道 / 桌面端 bot-transfer-tools.ts），模型看不到。
 */
export type DeviceToolName =
  | "pc_status"
  | "pc_files"
  | "pc_screenshot"
  | "pc_screen_record"
  | "pc_send_file"
  | "pc_notify"
  | "pc_save_file"
  | "pc_open"
  | "pc_windows"
  | "pc_inspect"
  | "pc_action";

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
  run(tool: DeviceToolName, args: Record<string, unknown>, signal: AbortSignal, exposure?: (reason: string) => void): Promise<DeviceOutcome>;
  /** 桌面端跑的 Bot 的 computer_to_pc：把手上的字节存进这台电脑（folder 只能是下载 / 桌面 / 文档…；同内容跳过、同名不覆盖） */
  save(bytes: Uint8Array, name: string, folder: string | undefined, signal: AbortSignal): Promise<DeviceOutcome>;
}
