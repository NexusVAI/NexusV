// admin-orders-app.js — 管理台「卡密运营」页
//
// 2026-09-09 本页从「付费订单审核」整体改造而来。收款切到 16688 发卡店后，
// 到账链路是「平台成交 → 用户兑换 → 后端回查授权 → 自动入账」，中间**没有人工审核**，
// 原来那套 approve/reject + 5 秒撤销 + 激活码赠送 + 9 张表的风控聚合全部下线。
//
// 现在的职责只有五件：看库存 / 手动铸码上架 / 作废未兑卡 / 看兑换流水 / 处理退款人工队列。
//
// ⛔ 本页**没有**「铸一张码直接送人」的功能，这是设计约束不是遗漏：
//    卡密的授权判据是「平台上确实卖出过这张卡」（order/list?card_no= 回查），
//    没走过平台成交的码永远兑不掉。要给用户送额度，用「用户管理」页的「钱包 ±¥」。
(function () {
    "use strict";

    var sb = window.supabase.createClient(
        window.__SUPABASE_URL__,
        window.__SUPABASE_ANON_KEY__,
        {
            auth: {
                persistSession: true,
                autoRefreshToken: true,
                detectSessionInUrl: false,
                // 与全站一致，管理员在 chat 页的登录态才在本页可见
                storageKey: "cancri_supabase_auth",
            },
        },
    );
    var GW = window.__SUPABASE_URL__ + "/functions/v1/chat-gateway";

    function $(id) {
        return document.getElementById(id);
    }
    function esc(s) {
        var d = document.createElement("div");
        d.textContent = String(s == null ? "" : s);
        return d.innerHTML;
    }
    function fmtCny(n) {
        var v = Number(n);
        return Number.isFinite(v) ? "¥" + v.toFixed(2) : "—";
    }
    function fmtTime(iso) {
        if (!iso) return "—";
        var d = new Date(iso);
        if (isNaN(d.getTime())) return String(iso);
        return d.toLocaleString("zh-CN", { hour12: false });
    }

    // api-platform.css 的 .toast 用 opacity + .show，不是 display —— 直接设
    // display:block 不会显示（历史踩过）。
    function showToast(text, kind) {
        var t = $("toast");
        if (!t) return;
        t.textContent = text;
        t.className = "toast" + (kind ? " " + kind : "");
        requestAnimationFrame(function () {
            t.classList.add("show");
        });
        setTimeout(function () {
            t.classList.remove("show");
        }, 4000);
    }

    async function getSession() {
        var r = await sb.auth.getSession();
        return r && r.data ? r.data.session : null;
    }

    async function callGateway(endpoint, payload) {
        var session = await getSession();
        if (!session) throw new Error("not_logged_in");
        var resp = await fetch(GW, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                apikey: window.__SUPABASE_ANON_KEY__,
            },
            body: JSON.stringify(
                Object.assign({ endpoint: endpoint }, payload || {}, {
                    __auth_token: session.access_token,
                }),
            ),
        });
        var data = await resp.json().catch(function () {
            return {};
        });
        if (!resp.ok) {
            throw Object.assign(new Error(data.message || data.error || resp.statusText), {
                status: resp.status,
                body: data,
            });
        }
        return data;
    }

    function errText(err) {
        return (
            (err && err.body && (err.body.message || err.body.error)) ||
            (err && err.message) ||
            "操作失败"
        );
    }

    var STATE = { skus: [], platform: null };

    // ── 渲染 ────────────────────────────────────────────────────────────────

    function renderTotals(t, redeemEnabled) {
        t = t || {};
        var s = $("stat-stock");
        if (s) s.textContent = t.in_stock == null ? "—" : String(t.in_stock);
        var r = $("stat-redeemed");
        if (r) r.textContent = t.redeemed == null ? "—" : String(t.redeemed);
        var g = $("stat-gross");
        if (g) g.textContent = fmtCny(t.gross_cny);
        var f = $("stat-refund");
        if (f) f.textContent = t.refund_pending == null ? "—" : String(t.refund_pending);

        var sw = $("redeem-state");
        if (sw) {
            sw.dataset.on = redeemEnabled ? "1" : "0";
            sw.textContent = redeemEnabled ? "已开启" : "已关闭";
        }
    }

    function renderSkus() {
        var tbody = $("sku-rows");
        if (!tbody) return;
        if (!STATE.skus.length) {
            tbody.innerHTML = '<tr><td colspan="11" class="empty">还没有卡种</td></tr>';
            return;
        }
        var platform = STATE.platform;
        tbody.innerHTML = STATE.skus
            .map(function (s) {
                var pStock = platform && s.goods_no ? platform[s.goods_no] : null;
                var pText = platform == null ? "—" : pStock == null ? "无商品" : String(pStock);
                var uploaded = Number(s.uploaded) || 0;
                // 水位判定用平台库存（那才是买家能买到的数）；拿不到就退回本地数
                var effective = pStock == null ? uploaded : pStock;
                var low = effective < Number(s.min_stock);
                var drift = platform != null && pStock != null && pStock !== uploaded;
                return (
                    '<tr class="' + (low ? "low-stock" : "") + '">' +
                    "<td>" + esc(s.display_name || s.sku) +
                    '<div class="sub">' + esc(s.sku) + (s.goods_no ? " · " + esc(s.goods_no) : " · 未建商品") + "</div></td>" +
                    '<td><span class="badge-kind" data-k="' + esc(s.kind) + '">' +
                    (s.kind === "plan" ? "套餐卡" : "充值卡") + "</span></td>" +
                    '<td class="num">' + fmtCny(s.face_cny) + "</td>" +
                    '<td class="num">' + fmtCny(s.list_price_cny) + "</td>" +
                    '<td class="num' + (low ? " stock-warn" : "") + '">' + esc(pText) + "</td>" +
                    '<td class="num">' + uploaded +
                    (drift ? '<div class="sub stock-warn">与平台不一致</div>' : "") + "</td>" +
                    '<td class="num">' + (Number(s.redeemed) || 0) + "</td>" +
                    '<td class="num">' + (Number(s.voided) || 0) + "</td>" +
                    '<td class="num">' + fmtCny(s.revenue_cny) + "</td>" +
                    '<td class="num">' + esc(s.min_stock) + "</td>" +
                    '<td><div class="mint-cell">' +
                    '<input type="number" min="1" max="500" step="1" value="' +
                    esc(s.restock_batch || 50) + '" data-mint-count="' + esc(s.sku) + '" />' +
                    '<button class="btn-tiny approve" type="button" data-mint="' + esc(s.sku) +
                    '" data-goods="' + esc(s.goods_no || "") + '"' + (s.goods_no ? "" : " disabled") +
                    ">铸码</button></div></td>" +
                    "</tr>"
                );
            })
            .join("");

        Array.prototype.forEach.call(tbody.querySelectorAll("button[data-mint]"), function (btn) {
            btn.addEventListener("click", function () {
                doMint(btn);
            });
        });

        var note = $("platform-note");
        if (note) {
            note.innerHTML = platform == null
                ? '<span class="stock-warn">平台库存暂时取不到（发卡平台没答复），上面「平台库存」一列为空。本地计数仍然准确。</span>'
                : "";
        }
    }

    function renderRecent(rows) {
        var tbody = $("recent-rows");
        var meta = $("recent-meta");
        if (!tbody) return;
        rows = rows || [];
        if (meta) meta.textContent = rows.length ? "最近 " + rows.length + " 笔" : "还没有兑换记录";
        tbody.innerHTML = rows.length
            ? rows
                  .map(function (c) {
                      return (
                          "<tr" + (c.refund_flagged_at ? ' class="refund-row"' : "") + ">" +
                          "<td>" + esc(fmtTime(c.redeemed_at)) + "</td>" +
                          "<td>" + esc(c.display_name || c.sku) + "</td>" +
                          '<td class="num">' + fmtCny(c.face_cny) + "</td>" +
                          '<td class="num">' + fmtCny(c.paid_cny) + "</td>" +
                          "<td>" + esc(c.email || c.user_id || "—") + "</td>" +
                          '<td class="mono">' + esc(c.trade_no || "—") + "</td>" +
                          "</tr>"
                      );
                  })
                  .join("")
            : '<tr><td colspan="6" class="empty">暂无</td></tr>';
    }

    function renderRefundQueue(rows) {
        var panel = $("refund-panel");
        var tbody = $("refund-rows");
        if (!panel || !tbody) return;
        rows = rows || [];
        if (!rows.length) {
            panel.style.display = "none";
            tbody.innerHTML = "";
            return;
        }
        panel.style.display = "";
        tbody.innerHTML = rows
            .map(function (c) {
                return (
                    "<tr>" +
                    "<td>" + esc(fmtTime(c.refund_flagged_at)) + "</td>" +
                    "<td>" + esc(c.sku) + "</td>" +
                    '<td class="num">' + fmtCny(c.face_cny) + "</td>" +
                    '<td class="num">' + fmtCny(c.paid_cny) + "</td>" +
                    "<td>" + esc(c.email || c.user_id || "—") + "</td>" +
                    '<td class="mono">' + esc(c.trade_no || "—") + "</td>" +
                    "<td>" + esc(c.void_reason || "—") + "</td>" +
                    "</tr>"
                );
            })
            .join("");
    }

    // ── 动作 ────────────────────────────────────────────────────────────────

    async function loadOverview() {
        try {
            var r = await callGateway("admin_card_overview", {});
            STATE.skus = r.skus || [];
            STATE.platform = r.platform_stock || null;
            renderTotals(r.totals, r.redeem_enabled === true);
            renderSkus();
            renderRecent(r.recent);
            renderRefundQueue(r.refund_queue);
            if (r.platform_error) {
                showToast("⚠️ 平台库存取不到：" + r.platform_error, "err");
            }
        } catch (err) {
            showToast("❌ " + errText(err), "err");
            var tbody = $("sku-rows");
            if (tbody) tbody.innerHTML = '<tr><td colspan="11" class="empty">加载失败，点右上角刷新重试</td></tr>';
            throw err;
        }
    }

    async function doMint(btn) {
        var sku = btn.getAttribute("data-mint");
        var goodsNo = btn.getAttribute("data-goods");
        var input = document.querySelector('input[data-mint-count="' + sku + '"]');
        var count = input ? Math.floor(Number(input.value)) : 0;
        if (!Number.isFinite(count) || count < 1 || count > 500) {
            showToast("❌ 数量需在 1 - 500 之间", "err");
            return;
        }
        if (!window.confirm("确认为 " + sku + " 铸 " + count + " 张卡并上架到发卡店？")) return;
        btn.disabled = true;
        var label = btn.textContent;
        btn.textContent = "铸码中…";
        try {
            var r = await callGateway("admin_card_mint", {
                sku: sku,
                goods_no: goodsNo,
                count: count,
            });
            showToast((r.mismatch ? "⚠️ " : "✅ ") + (r.message || "已铸码"), r.mismatch ? "err" : "ok");
            await loadOverview();
        } catch (err) {
            showToast("❌ " + errText(err), "err");
            btn.disabled = false;
            btn.textContent = label;
        }
    }

    async function doVoid() {
        var codeEl = $("void-code");
        var reasonEl = $("void-reason");
        var btn = $("void-btn");
        if (!codeEl || !btn) return;
        var code = codeEl.value.trim();
        if (!code) {
            showToast("❌ 请粘贴卡密", "err");
            codeEl.focus();
            return;
        }
        if (!window.confirm("确认作废这张卡密？作废后它永远无法兑换。")) return;
        btn.disabled = true;
        try {
            var r = await callGateway("admin_card_void", {
                code: code,
                reason: reasonEl ? reasonEl.value.trim() : "",
            });
            showToast("✅ " + (r.message || "已作废") + (r.sku ? "（" + r.sku + "）" : ""), "ok");
            codeEl.value = "";
            if (reasonEl) reasonEl.value = "";
            await loadOverview();
        } catch (err) {
            showToast("❌ " + errText(err), "err");
        } finally {
            btn.disabled = false;
        }
    }

    async function setRedeemEnabled(enabled) {
        if (!enabled && !window.confirm("确认关闭卡密兑换？用户会收到「暂时关闭，稍后再试」的提示（卡密不会失效）。")) return;
        try {
            var r = await callGateway("admin_card_set_redeem_enabled", { enabled: enabled });
            showToast("✅ " + (r.message || "已更新"), "ok");
            await loadOverview();
        } catch (err) {
            showToast("❌ " + errText(err), "err");
        }
    }

    var legacyLoaded = false;
    async function loadLegacyOrders() {
        var btn = $("legacy-btn");
        var wrap = $("legacy-wrap");
        var tbody = $("legacy-rows");
        if (!btn || !wrap || !tbody) return;
        if (legacyLoaded) {
            wrap.style.display = wrap.style.display === "none" ? "" : "none";
            btn.textContent = wrap.style.display === "none" ? "加载历史订单" : "收起历史订单";
            return;
        }
        btn.disabled = true;
        btn.textContent = "加载中…";
        try {
            var r = await callGateway("admin_list_orders", {});
            var orders = r.orders || [];
            tbody.innerHTML = orders.length
                ? orders
                      .slice(0, 300)
                      .map(function (o) {
                          return (
                              "<tr>" +
                              "<td>" + esc(fmtTime(o.created_at)) + "</td>" +
                              "<td>" + esc(o.order_kind || "—") + "</td>" +
                              '<td class="num">' + fmtCny(o.amount_cny) + "</td>" +
                              "<td>" + esc(o.status || "—") + "</td>" +
                              "<td>" + esc(o.email || "—") + "</td>" +
                              "<td>" + esc(o.admin_note || "—") + "</td>" +
                              "</tr>"
                          );
                      })
                      .join("")
                : '<tr><td colspan="6" class="empty">没有历史订单</td></tr>';
            wrap.style.display = "";
            legacyLoaded = true;
            btn.textContent = "收起历史订单";
        } catch (err) {
            showToast("❌ " + errText(err), "err");
            btn.textContent = "加载历史订单";
        } finally {
            btn.disabled = false;
        }
    }

    // ── 引导 ────────────────────────────────────────────────────────────────
    //
    // ⚠️ admin-nav.js 的黑幕只在 `#main` 的**计算样式**变为可见时才掀开，
    //    所以这里必须真的把 #main 显示出来，否则整页永远黑屏（2026-08-30 申诉页事故）。
    async function init() {
        var loading = $("loading");
        var loginGate = $("login-gate");
        var denyGate = $("deny-gate");
        var main = $("main");

        var u = await sb.auth.getUser();
        var user = u && u.data ? u.data.user : null;
        if (!user || user.is_anonymous) {
            if (loading) loading.style.display = "none";
            if (loginGate) loginGate.style.display = "block";
            return;
        }
        try {
            // 非管理员时后端返回 403（刻意不回显 is_admin:false，防账号枚举），
            // 所以 callGateway 会抛 —— catch 才是真正的拒绝路径。
            var chk = await callGateway("admin_check", {});
            if (loading) loading.style.display = "none";
            if (!chk || chk.is_admin !== true) {
                if (denyGate) denyGate.style.display = "block";
                return;
            }
            if (main) main.style.display = "block";
        } catch (err) {
            if (loading) loading.style.display = "none";
            if (denyGate) denyGate.style.display = "block";
            return;
        }

        var onBtn = $("btn-redeem-on");
        if (onBtn) onBtn.addEventListener("click", function () { setRedeemEnabled(true); });
        var offBtn = $("btn-redeem-off");
        if (offBtn) offBtn.addEventListener("click", function () { setRedeemEnabled(false); });
        var reload = $("reload-btn");
        if (reload) reload.addEventListener("click", function () { loadOverview().catch(function () {}); });
        var voidBtn = $("void-btn");
        if (voidBtn) voidBtn.addEventListener("click", doVoid);
        var voidCode = $("void-code");
        if (voidCode) {
            voidCode.addEventListener("keydown", function (ev) {
                if (ev.key === "Enter") { ev.preventDefault(); doVoid(); }
            });
        }
        var legacyBtn = $("legacy-btn");
        if (legacyBtn) legacyBtn.addEventListener("click", loadLegacyOrders);

        await loadOverview().catch(function () {});
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
