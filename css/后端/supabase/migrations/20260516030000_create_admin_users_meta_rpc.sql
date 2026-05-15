-- ─────────────────────────────────────────────────────────────────
-- Migration: create cancri_admin_get_users_meta RPC
-- Purpose  : 给 admin_list_orders enrichment 提供 created_at 信息。
--            cancri_admin_get_users_by_ids（已有）只返回 id + email + is_anonymous，
--            缺 created_at — 想知道"账号注册多久"必须直查 auth.users。
--            这个 RPC 用 SECURITY DEFINER 让 service_role 安全访问 auth schema。
-- ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.cancri_admin_get_users_meta(p_ids UUID[])
RETURNS TABLE(
  id UUID,
  email TEXT,
  created_at TIMESTAMPTZ,
  is_anonymous BOOLEAN
) AS $$
  SELECT
    u.id,
    u.email,
    u.created_at,
    COALESCE(u.is_anonymous, false) AS is_anonymous
  FROM auth.users u
  WHERE u.id = ANY(p_ids);
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth;

REVOKE ALL ON FUNCTION public.cancri_admin_get_users_meta(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancri_admin_get_users_meta(UUID[]) TO service_role;
