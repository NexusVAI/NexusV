/**
 * 网页端替身：cancri-code/src/auth.ts（桌面走 Tauri 回环登录）。
 * 网页直接复用 Chat 站点的登录态：同一个 supabase-js 存储键 `cancri_supabase_auth`（见 src/main.js getSupabaseClient），
 * SDK 负责跨标签页刷新 token；没装上 SDK 时退回直接读 localStorage。
 * 只实现 Bot 界面用到的那几个：getState / getUserId / ensureAccessToken / onAuthChange。
 */
export interface StoredSession {
  access_token: string;
  refresh_token: string;
  expires_at_ms: number;
  user_email: string;
  user_id: string;
}
export type AuthState =
  | { kind: "unknown" }
  | { kind: "signed-out" }
  | { kind: "signed-in"; session: StoredSession }
  | { kind: "error"; message: string };
type Listener = (state: AuthState) => void;

const STORAGE_KEY = "cancri_supabase_auth";

interface SbSession {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  user?: { id: string; email?: string };
}
interface SbClient {
  auth: {
    getSession(): Promise<{ data: { session: SbSession | null } }>;
    refreshSession(): Promise<{ data: { session: SbSession | null }; error: unknown }>;
    onAuthStateChange(cb: (ev: string, s: SbSession | null) => void): unknown;
  };
}

function toStored(s: SbSession | null | undefined): StoredSession | null {
  if (!s?.access_token || !s.user?.id) return null;
  return {
    access_token: s.access_token,
    refresh_token: s.refresh_token,
    expires_at_ms: (Number(s.expires_at) || 0) * 1000,
    user_email: s.user.email ?? "",
    user_id: s.user.id,
  };
}

function readStorage(): SbSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SbSession) : null;
  } catch {
    return null;
  }
}

class WebAuth {
  private state: AuthState = { kind: "unknown" };
  private listeners = new Set<Listener>();
  private client: SbClient | null = null;
  private ready: Promise<void> | null = null;

  init(): Promise<void> {
    this.ready ??= (async () => {
      const w = window as unknown as { supabase?: { createClient(u: string, k: string, o: unknown): SbClient }; __SUPABASE_URL__?: string; __SUPABASE_ANON_KEY__?: string };
      try {
        if (w.supabase?.createClient && w.__SUPABASE_URL__ && w.__SUPABASE_ANON_KEY__) {
          this.client = w.supabase.createClient(w.__SUPABASE_URL__, w.__SUPABASE_ANON_KEY__, {
            auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: STORAGE_KEY },
          });
          this.client.auth.onAuthStateChange((_ev, s) => this.set(toStored(s)));
          const { data } = await this.client.auth.getSession();
          this.set(toStored(data.session));
          return;
        }
      } catch {
        /* SDK 坏了：退回直接读存储 */
      }
      this.set(toStored(readStorage()));
      // 别的标签页（Chat）登录 / 退出 / 刷新了 token
      window.addEventListener("storage", (e) => {
        if (e.key === STORAGE_KEY) this.set(toStored(readStorage()));
      });
    })();
    return this.ready;
  }

  private set(s: StoredSession | null): void {
    const prev = this.getUserId();
    this.state = s ? { kind: "signed-in", session: s } : { kind: "signed-out" };
    if (prev !== this.getUserId() || s) for (const l of this.listeners) l(this.state);
  }

  getState(): AuthState {
    return this.state;
  }

  getUserId(): string | null {
    return this.state.kind === "signed-in" ? this.state.session.user_id : null;
  }

  onAuthChange(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  /** 快过期（< 60 秒）先刷新；拿不到返回 null（界面会提示登录） */
  async ensureAccessToken(): Promise<string | null> {
    await this.init();
    if (this.state.kind !== "signed-in") return null;
    const s = this.state.session;
    if (s.expires_at_ms && s.expires_at_ms - Date.now() > 60_000) return s.access_token;
    if (this.client) {
      try {
        const { data } = await this.client.auth.refreshSession();
        const next = toStored(data.session);
        if (next) {
          this.set(next);
          return next.access_token;
        }
      } catch {
        /* 刷新失败：用旧的试一次，服务端 401 再说 */
      }
    }
    return s.access_token;
  }
}

export const auth = new WebAuth();

/** 桌面端的登录页链接；网页回 Chat 首页登录 */
export function buildDesktopLoginUrl(): string {
  return "./index.html";
}
