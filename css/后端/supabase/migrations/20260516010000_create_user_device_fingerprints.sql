-- ─────────────────────────────────────────────────────────────────
-- Migration: create_user_device_fingerprints
-- Purpose  : Track browser + device fingerprints per (user, anon) for
--            anti-multi-account detection.
--
-- Inspired by Google's anti-abuse signals:
--   1. WebRTC IPs (leak真实本地 IP，VPN 改不了)
--   2. Canvas / WebGL / Audio fingerprints (硬件层差异)
--   3. Server-side IP + cf-ipcountry vs client timezone (粗判 VPN)
--   4. navigator.* 全家桶 (UA / platform / languages / hardware)
--
-- 100% bullet-proof 是不可能的（用户可以同时换设备 + 浏览器
-- + VPN），但综合这些信号可以有效识别 80%+ 的"一人多号"。
--
-- Inserts happen via chat-gateway service-role; browsers cannot
-- write directly (RLS denies all but service_role).
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.user_device_fingerprints (
  id              BIGSERIAL    PRIMARY KEY,
  user_id         UUID         REFERENCES auth.users(id) ON DELETE SET NULL,
  anon_id         TEXT,
  visitor_id      TEXT         NOT NULL,

  -- 服务端拿到的真实 IP（cf-connecting-ip）+ Cloudflare IP 国家
  server_ip       TEXT         NOT NULL,
  server_country  TEXT,

  -- WebRTC 泄露：本地 IP 是 VPN 之内的（关键反 VPN 信号）
  webrtc_local_ips  JSONB,
  webrtc_public_ips JSONB,

  -- 浏览器自报地理 / 时区
  timezone          TEXT,
  timezone_offset   INTEGER,
  languages         JSONB,

  -- 设备 / 浏览器属性
  ua                  TEXT,
  platform            TEXT,
  vendor              TEXT,
  user_agent_data     JSONB,
  hardware_concurrency INTEGER,
  device_memory       REAL,
  max_touch_points    INTEGER,

  -- 屏幕
  screen              JSONB,

  -- 真·指纹（hash 后存储）
  canvas_fp           TEXT,
  webgl_fp            TEXT,
  webgl_vendor        TEXT,
  webgl_renderer      TEXT,
  audio_fp            TEXT,
  fonts               JSONB,

  -- 其他信号
  cookie_enabled      BOOLEAN,
  do_not_track        TEXT,
  plugins             JSONB,
  storage_quota       BIGINT,
  connection          JSONB,

  -- 服务端计算的异常标记
  vpn_suspected         BOOLEAN  DEFAULT false,
  webrtc_leak_detected  BOOLEAN  DEFAULT false,

  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- 查询主路径：visitor_id 出现在多少 user_id
CREATE INDEX IF NOT EXISTS idx_fp_visitor_id  ON public.user_device_fingerprints(visitor_id);
CREATE INDEX IF NOT EXISTS idx_fp_user_id     ON public.user_device_fingerprints(user_id);
-- 单指纹维度去重（找 canvas/webgl/audio 完全一致的多账号）
CREATE INDEX IF NOT EXISTS idx_fp_canvas      ON public.user_device_fingerprints(canvas_fp);
CREATE INDEX IF NOT EXISTS idx_fp_webgl       ON public.user_device_fingerprints(webgl_fp);
CREATE INDEX IF NOT EXISTS idx_fp_audio       ON public.user_device_fingerprints(audio_fp);
-- IP 维度
CREATE INDEX IF NOT EXISTS idx_fp_server_ip   ON public.user_device_fingerprints(server_ip);
-- 时间窗口扫描
CREATE INDEX IF NOT EXISTS idx_fp_created_at  ON public.user_device_fingerprints(created_at DESC);

-- ── RLS ────────────────────────────────────────────────────────────
-- 只有 service_role 能读写。chat-gateway 用 SUPABASE_SERVICE_ROLE_KEY
-- 创建客户端 → RLS-exempt，正常 INSERT。浏览器没办法直接读/写。
ALTER TABLE public.user_device_fingerprints ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.user_device_fingerprints FROM anon, authenticated;
GRANT  ALL ON public.user_device_fingerprints TO service_role;
GRANT USAGE, SELECT ON SEQUENCE user_device_fingerprints_id_seq TO service_role;

-- ── 视图：多账号嫌疑（visitor_id 跨 ≥2 个 user_id）──────────────────
-- 直接 SELECT 可以一眼看出风险。例：
--   SELECT * FROM public.v_suspect_multi_accounts
--   WHERE distinct_users >= 2
--   ORDER BY distinct_users DESC, last_seen DESC;
CREATE OR REPLACE VIEW public.v_suspect_multi_accounts AS
  SELECT
    visitor_id,
    COUNT(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL) AS distinct_users,
    ARRAY_AGG(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL) AS user_ids,
    ARRAY_AGG(DISTINCT server_ip) AS server_ips,
    MIN(created_at) AS first_seen,
    MAX(created_at) AS last_seen,
    COUNT(*)        AS event_count
  FROM public.user_device_fingerprints
  GROUP BY visitor_id
  HAVING COUNT(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL) >= 2;

GRANT SELECT ON public.v_suspect_multi_accounts TO service_role;

-- ── 视图：canvas/webgl/audio 单指纹维度去重 ────────────────────────
-- visitor_id 是综合 hash，任一字段变 → visitor_id 变。
-- 这里按单一字段聚合，能识破"换 UA 但硬件没变"的伪装。
CREATE OR REPLACE VIEW public.v_suspect_by_canvas AS
  SELECT
    canvas_fp,
    COUNT(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL) AS distinct_users,
    ARRAY_AGG(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL) AS user_ids,
    COUNT(*) AS event_count,
    MAX(created_at) AS last_seen
  FROM public.user_device_fingerprints
  WHERE canvas_fp IS NOT NULL AND canvas_fp <> ''
  GROUP BY canvas_fp
  HAVING COUNT(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL) >= 2;

CREATE OR REPLACE VIEW public.v_suspect_by_webgl AS
  SELECT
    webgl_fp,
    COUNT(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL) AS distinct_users,
    ARRAY_AGG(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL) AS user_ids,
    COUNT(*) AS event_count,
    MAX(created_at) AS last_seen
  FROM public.user_device_fingerprints
  WHERE webgl_fp IS NOT NULL AND webgl_fp <> ''
  GROUP BY webgl_fp
  HAVING COUNT(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL) >= 2;

CREATE OR REPLACE VIEW public.v_suspect_by_audio AS
  SELECT
    audio_fp,
    COUNT(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL) AS distinct_users,
    ARRAY_AGG(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL) AS user_ids,
    COUNT(*) AS event_count,
    MAX(created_at) AS last_seen
  FROM public.user_device_fingerprints
  WHERE audio_fp IS NOT NULL AND audio_fp <> ''
  GROUP BY audio_fp
  HAVING COUNT(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL) >= 2;

GRANT SELECT ON public.v_suspect_by_canvas TO service_role;
GRANT SELECT ON public.v_suspect_by_webgl  TO service_role;
GRANT SELECT ON public.v_suspect_by_audio  TO service_role;
