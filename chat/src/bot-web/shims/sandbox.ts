/** 网页端替身：cancri-code/src/sandbox/backend.ts 与 tools/builtin/sandbox-cloud.ts（网页不直连云沙箱） */
export interface SandboxTrialQuota {
  [k: string]: unknown;
}
export class SandboxBackendError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}
export const sandboxBackend = (): null => null;
export function setSandboxBackend(): void {}
export const cloudSandboxDriver = (): null => null;
export function _resetCloudSandboxDriver(): void {}
