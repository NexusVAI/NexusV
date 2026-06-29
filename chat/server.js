/* Local dev server: serves chat/ statically AND mocks the cf-gateway routes
 * (chat-gateway + cancri-market) so the crab-market frontend can run fully
 * end-to-end in the browser for UI verification. In-memory state only. */
const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");

const ROOT = path.join(__dirname, "chat_new", "chat");
const PORT = 8099;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".json": "application/json; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

// ── in-memory market state ───────────────────────────────────────────
let nextListingId = 3;
let nextTicketId = 2;
const listings = [
  {
    id: 1, platform: "openai", base_url: "https://api.stepfun.com/v1",
    // 故意用 JSON 字符串模拟 RPC 直出，验证前端 normalizeModels 容错（用户反馈：支持模型不显示）
    model_whitelist: '["step-3.7-flash"]', rate_multiplier: 1.0,
    display_name: "step-3.7-flash", description: "阶跃 step 系列，余额充足",
    status: "active", status_detail: null,
    input_price_per_m: 0.1, output_price_per_m: 0.5, cached_input_factor: 0.1,
    seller_email: "3573799137@qq.com",
    created_at: new Date(Date.now() - 86400000 * 3).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 2, platform: "openai", base_url: "https://api.stepfun.com/v1",
    model_whitelist: ["step-3.7-flash", "step-2-16k"], rate_multiplier: 1.0,
    display_name: "step-3.7-flash 备用", description: "",
    status: "disabled", status_detail: "卖家手动禁用",
    input_price_per_m: 0.01, output_price_per_m: 0.02, cached_input_factor: 0.1,
    seller_email: "3573799137@qq.com",
    created_at: new Date(Date.now() - 86400000 * 7).toISOString(),
    updated_at: new Date().toISOString(),
  },
];
const calls = [
  { tx_id: 1, listing_id: 1, call_id: "c1", model_id: "step-3.7-flash", buyer_email: "buyer1@x.com", tokens_in: 1200, tokens_out: 800, buyer_charged_micro: 660000, seller_credit_micro: 627000, created_at: new Date(Date.now() - 3600000).toISOString() },
  { tx_id: 2, listing_id: 1, call_id: "c2", model_id: "step-3.7-flash", buyer_email: "buyer2@x.com", tokens_in: 5000, tokens_out: 2000, buyer_charged_micro: 1950000, seller_credit_micro: 1852500, created_at: new Date(Date.now() - 7200000).toISOString() },
  { tx_id: 3, listing_id: 2, call_id: "c3", model_id: "step-2-16k", buyer_email: "buyer3@x.com", tokens_in: 3200, tokens_out: 1500, buyer_charged_micro: 90000, seller_credit_micro: 85500, created_at: new Date(Date.now() - 90000000).toISOString() },
];

// 每个挂单的运营统计（浏览/卖出 token/请求/收益 + 近 14 天每日收益）
function buildDaily(seed) {
  const out = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - 86400000 * i);
    const day = d.toISOString().slice(0, 10);
    // 伪随机但稳定：用 seed + 日序生成
    const v = Math.max(0, Math.round((Math.sin(seed * 3.1 + i) * 0.5 + 0.5) * 800000));
    out.push({ date: day, credit_micro: i % 5 === 0 ? 0 : v });
  }
  return out;
}
const listingStats = {
  1: { views: 1284, tokens_sold: 4481068, requests: 365, earnings_credit_micro: 2479500, daily: buildDaily(1) },
  2: { views: 96, tokens_sold: 4700, requests: 1, earnings_credit_micro: 85500, daily: buildDaily(2) },
};
function statsFor(id) { return listingStats[id] || { views: 0, tokens_sold: 0, requests: 0, earnings_credit_micro: 0, daily: buildDaily(id) }; }
const tickets = [
  { id: 1, seller_id: "me", seller_email: "seller@nexusvai.xyz", channel: "wechat", amount_micro: 5000000, wechat_id: "wx_seller_888", status: "pending", review_note: null, created_at: new Date(Date.now() - 1800000).toISOString(), reviewed_at: null },
];
const balance = { available_micro: 2479500, frozen_micro: 5000000, withdrawn_micro: 12000000 };

function summary() {
  const total_credit = calls.reduce((s, c) => s + c.seller_credit_micro, 0);
  const total_fee = calls.reduce((s, c) => s + (c.buyer_charged_micro - c.seller_credit_micro), 0);
  const total_tokens = calls.reduce((s, c) => s + (c.tokens_in || 0) + (c.tokens_out || 0), 0)
    + Object.values(listingStats).reduce((s, st) => s + (st.tokens_sold || 0), 0);
  const total_requests = Object.values(listingStats).reduce((s, st) => s + (st.requests || 0), 0);
  // 汇总每日收益（各挂单 daily 相加）
  const dmap = {};
  Object.values(listingStats).forEach((st) => (st.daily || []).forEach((d) => { dmap[d.date] = (dmap[d.date] || 0) + d.credit_micro; }));
  const daily = Object.keys(dmap).sort().map((k) => ({ date: k, credit_micro: dmap[k] }));
  return { total_credit_micro: total_credit, total_fee_micro: total_fee, total_tx: calls.length, total_tokens, total_requests, daily };
}

// 调价公示期到期：自动把 pending 价切为正式价并恢复上架。每次 overview 时惰性结算。
function applyDuePricing() {
  const now = Date.now();
  listings.forEach((l) => {
    if (l.status === "pricing_cooldown" && l.pricing_effective_at && new Date(l.pricing_effective_at).getTime() <= now) {
      if (l.pending_input_price_per_m != null) l.input_price_per_m = l.pending_input_price_per_m;
      if (l.pending_output_price_per_m != null) l.output_price_per_m = l.pending_output_price_per_m;
      l.pending_input_price_per_m = null; l.pending_output_price_per_m = null;
      l.pricing_effective_at = null; l.status = "active"; l.status_detail = null;
      l.updated_at = new Date().toISOString();
    }
  });
}
function meListing(l) {
  const st = statsFor(l.id);
  return { ...l, views: st.views, tokens_sold: st.tokens_sold, requests: st.requests, earnings_credit_micro: st.earnings_credit_micro, daily: st.daily };
}
function publicListing(l) {
  return {
    listing_id: l.id, id: l.id, seller_email: l.seller_email, platform: l.platform,
    base_url: l.base_url, model_whitelist: l.model_whitelist, rate_multiplier: l.rate_multiplier,
    display_name: l.display_name, description: l.description,
    input_price_per_m: l.input_price_per_m, output_price_per_m: l.output_price_per_m,
    cached_input_factor: l.cached_input_factor, created_at: l.created_at,
  };
}

function send(res, code, body, type) {
  res.writeHead(code, {
    "Content-Type": type || "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Cache-Control": "no-store",
  });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => { try { resolve(d ? JSON.parse(d) : {}); } catch { resolve({}); } });
  });
}

const server = http.createServer(async (req, res) => {
  const u = url.parse(req.url, true);
  const p = u.pathname;
  if (req.method === "OPTIONS") return send(res, 204, "");

  // ── chat-gateway (POST {endpoint}) ──
  if (p === "/functions/v1/chat-gateway") {
    const body = await readBody(req);
    if (body.endpoint === "api_my_keys") return send(res, 200, { applications: [{ status: "approved" }] });
    if (body.endpoint === "model_public_catalog") return send(res, 200, { models: [], multiplier_legend: {} });
    return send(res, 200, {});
  }

  // ── cancri-market ──
  if (p.startsWith("/functions/v1/cancri-market")) {
    const sub = p.replace("/functions/v1/cancri-market", "") || "/";
    if (req.method === "GET" && sub === "/listings") {
      applyDuePricing();
      // 仅展示 active（公示期 pricing_cooldown / disabled / depleted 不对买家可见）
      return send(res, 200, { listings: listings.filter((l) => l.status === "active").map(publicListing) });
    }
    if (req.method === "GET" && sub === "/me/overview") {
      applyDuePricing();
      return send(res, 200, { balance, listings: listings.map(meListing), summary: summary(), recent_tickets: tickets.slice(0, 4) });
    }
    if (req.method === "GET" && sub === "/me/calls")
      return send(res, 200, { calls });
    if (req.method === "GET" && sub === "/me/tickets")
      return send(res, 200, { tickets });
    if (req.method === "GET" && sub === "/admin/tickets")
      return send(res, 200, { tickets: tickets.filter((t) => t.status === "pending") });

    if (req.method === "POST" && sub === "/listings") {
      const b = await readBody(req);
      const l = {
        id: nextListingId++, platform: b.platform || "openai", base_url: b.base_url,
        model_whitelist: b.model_whitelist || [], rate_multiplier: b.rate_multiplier || 1.0,
        display_name: b.display_name || "", description: b.description || "",
        status: "active", status_detail: null,
        input_price_per_m: b.input_price_per_m, output_price_per_m: b.output_price_per_m,
        cached_input_factor: b.cached_input_factor || 0.1, seller_email: "seller@nexusvai.xyz",
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      };
      listings.unshift(l);
      return send(res, 200, { listing_id: l.id });
    }
    // edit / set status: PATCH /listings/:id
    const mId = sub.match(/^\/listings\/(\d+)$/);
    if (mId) {
      const id = Number(mId[1]);
      const idx = listings.findIndex((l) => l.id === id);
      if (idx < 0) return send(res, 404, { error: "not_found" });
      if (req.method === "PATCH" || req.method === "PUT") {
        const b = await readBody(req);
        const l = listings[idx];
        // 调价：进入 1 天公示期（此模型暂不可用），到期自动切新价
        if (b.action === "adjust_price") {
          if (l.status === "pricing_cooldown") return send(res, 400, { error: "该模型正在调价公示期内，暂不能再次调价" });
          l.pending_input_price_per_m = b.input_price_per_m;
          l.pending_output_price_per_m = b.output_price_per_m;
          l.pricing_effective_at = new Date(Date.now() + 86400000).toISOString();
          l.status = "pricing_cooldown"; l.status_detail = "定价调整公示中，暂不可用";
          l.updated_at = new Date().toISOString();
          return send(res, 200, { ok: true, pricing_effective_at: l.pricing_effective_at });
        }
        if (b.status) l.status = b.status;
        ["display_name", "description", "model_whitelist", "input_price_per_m", "output_price_per_m", "cached_input_factor", "base_url"].forEach((k) => {
          if (b[k] !== undefined && b[k] !== null && b[k] !== "") l[k] = b[k];
        });
        l.updated_at = new Date().toISOString();
        return send(res, 200, { ok: true });
      }
      if (req.method === "DELETE") {
        listings.splice(idx, 1);
        return send(res, 200, { ok: true });
      }
    }
    if (req.method === "POST" && sub === "/me/withdraw") {
      const b = await readBody(req);
      if ((b.amount_micro || 0) > balance.available_micro) return send(res, 400, { error: "余额不足" });
      const t = { id: nextTicketId++, seller_id: "me", seller_email: "seller@nexusvai.xyz", channel: b.channel, amount_micro: b.amount_micro, wechat_id: b.wechat_id || null, status: b.channel === "site" ? "done" : "pending", review_note: null, created_at: new Date().toISOString(), reviewed_at: null };
      tickets.unshift(t);
      if (b.channel === "site") { balance.available_micro -= b.amount_micro; balance.withdrawn_micro += b.amount_micro; }
      else { balance.available_micro -= b.amount_micro; balance.frozen_micro += b.amount_micro; }
      return send(res, 200, { ticket_id: t.id });
    }
    if (req.method === "POST" && sub === "/admin/review") {
      const b = await readBody(req);
      const t = tickets.find((x) => x.id === Number(b.ticket_id));
      if (!t) return send(res, 404, { error: "工单不存在" });
      t.status = b.approve ? "approved" : "rejected";
      t.review_note = b.note || null;
      t.reviewed_at = new Date().toISOString();
      if (b.approve) { balance.frozen_micro -= t.amount_micro; balance.withdrawn_micro += t.amount_micro; }
      else { balance.frozen_micro -= t.amount_micro; balance.available_micro += t.amount_micro; }
      return send(res, 200, { ok: true });
    }
    return send(res, 404, { error: "unknown_market_route", sub });
  }

  // ── static files ──
  let fp = decodeURIComponent(p);
  if (fp === "/") fp = "/market.html";
  let full = path.join(ROOT, fp);
  if (!full.startsWith(ROOT)) return send(res, 403, "forbidden", "text/plain");
  const imgExt = [".png", ".jpg", ".jpeg", ".webp", ".svg", ".ico"];
  function placeholderImg() {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#3a3a4a"/><circle cx="100" cy="100" r="46" fill="#5b6bff"/></svg>';
    res.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "no-store" });
    res.end(svg);
  }
  fs.stat(full, (err, st) => {
    if (err) {
      if (imgExt.includes(path.extname(fp).toLowerCase())) return placeholderImg();
      return send(res, 404, "not found: " + fp, "text/plain");
    }
    if (st.isDirectory()) full = path.join(full, "index.html");
    fs.readFile(full, (e, data) => {
      if (e) return send(res, 404, "not found", "text/plain");
      const ext = path.extname(full).toLowerCase();
      if (ext === ".html") {
        let html = data.toString("utf8");
        // Dev bootstrap: point frontend at this origin + seed a fake logged-in
        // session so the crab-market pages run end-to-end locally. Injected
        // right after cancri_config.js so it overrides __SUPABASE_URL__.
        const dev =
          '<script>(function(){window.__SUPABASE_URL__=window.location.origin;' +
          'try{var s={access_token:"dev-token",token_type:"bearer",expires_in:100000,' +
          'expires_at:Math.floor(Date.now()/1000)+100000,refresh_token:"dev-refresh",' +
          'user:{id:"00000000-0000-0000-0000-000000000001",email:"seller@nexusvai.xyz",' +
          'is_anonymous:false,aud:"authenticated",role:"authenticated",user_metadata:{},app_metadata:{}}};' +
          'localStorage.setItem("cancri_supabase_auth",JSON.stringify(s));}catch(e){}})();<\/script>';
        // Drop the CSP meta locally so the injected inline dev script + same-origin
        // mock fetches are allowed (production CSP stays intact in the real files).
        html = html.replace(/<meta[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/i, "");
        html = html.replace(/(<script[^>]*cancri_config\.js[^>]*><\/script>)/i, "$1" + dev);
        res.writeHead(200, { "Content-Type": MIME[ext], "Cache-Control": "no-store" });
        return res.end(html);
      }
      res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream", "Cache-Control": "no-store" });
      res.end(data);
    });
  });
});
server.listen(PORT, () => console.log("mock+static server on http://localhost:" + PORT));
