-- ─────────────────────────────────────────────────────────────────
-- Migration: create_ip_geo_cache
-- Purpose  : 缓存 IP 地理位置反查结果，避免重复调用 ip-api.com（45 req/min/IP）。
--            chat-gateway 在 admin_list_orders 等管理员端点 enrichment 时
--            优先查这张表，未命中再异步调外部 API 填充。
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ip_geo_cache (
  ip          TEXT          PRIMARY KEY,
  country     TEXT,         -- ISO 国家码 "CN" / "US"
  country_name TEXT,        -- "China" / "United States"
  region      TEXT,         -- 省/州 "Shanghai"
  city        TEXT,         -- 市 "Shanghai"
  isp         TEXT,         -- ISP 名 "China Telecom"
  org         TEXT,         -- ASN 组织 "CHINANET-BACKBONE"
  asn         TEXT,         -- ASN 编号 "AS4134"
  lat         REAL,
  lon         REAL,
  proxy       BOOLEAN,      -- 是否疑似代理 / VPN
  hosting     BOOLEAN,      -- 是否为机房 IP
  raw         JSONB,        -- 原始返回 payload，便于排查 / 加新字段不用改表
  lookup_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ   NOT NULL DEFAULT (NOW() + INTERVAL '24 hours')
);

CREATE INDEX IF NOT EXISTS idx_ip_geo_cache_expires ON public.ip_geo_cache(expires_at);

-- service_role only：浏览器不该读地理库，避免 leak 已查过的 IP 列表
ALTER TABLE public.ip_geo_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ip_geo_cache FROM anon, authenticated;
GRANT  ALL ON public.ip_geo_cache TO service_role;
