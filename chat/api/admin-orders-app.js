// admin-orders-app.js — 管理台「卡密运营」页
//
// 2026-09-09 本页从「付费订单审核」整体改造而来（approve/reject + 5 秒撤销 +
// 激活码赠送 + 9 张表的风控聚合全部下线）。
//
// 2026-09-18 收款从 16688 换到链动小铺（wzyp.cn）。差别不是换了个链接，是**换了个模型**：
//   16688 有 API  → 网关自己铸码、自己上架、自己按卡号回查平台授权兑换，本页只是看板。
//   链动小铺无 API → 铸码、上架、发现退款**全部由人在这一页完成**，本页是操作台。
//
// 由此本页多了两个此前不存在、且都很危险的动作：
//
//  🔴 1. **铸码会把卡密明文显示出来**（`admin_card_mint` 的响应里带 codes）。
//        那是明文唯一一次出现 —— 不落库、不进日志、没有「再看一次」的接口。
//        所以 doMint 成功后必须把它渲染到面板里交给人复制；渲染完**不要**再存到
//        任何地方（localStorage / STATE / URL 都不行），关掉面板就该彻底消失。
//
//  🔴 2. **粘错商品系统完全无法察觉。** 没有平台回查了，一张卡发什么货只由库里那行决定。
//        所以铸码面板必须把「该粘到哪个商品」写在明文旁边，确认框里也要再说一遍。
//        这是这条链路上唯一的防呆，别为了「少点一次」把它省掉。
//
// ⛔ 本页仍然**没有**「铸一张码直接送人」的功能，这是设计约束不是遗漏：
//    铸码是给货架补货的。要给用户送额度，用「用户管理」页的「钱包 ±¥」——
//    那条路直接改余额、有独立审计，本来就为此存在。
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

    // ⚠️ STATE 里**没有也不许有**卡密明文。明文从 doMint 的响应直接进 DOM，
    //    关闭面板即清空。存进 STATE 只会让它多活一会儿、并跟着别的渲染到处跑。
    //    activeMintBatch 只记批次号（不是明文），用它挡住「上一批没处理就再铸」。
    var STATE = { skus: [], batches: [], activeMintBatch: null, mintBusy: false, refundRows: [] };

    // ── 渲染 ────────────────────────────────────────────────────────────────

    function renderTotals(t, redeemEnabled) {
        t = t || {};
        var s = $("stat-stock");
        if (s) s.textContent = t.in_stock == null ? "—" : String(t.in_stock);
        var r = $("stat-redeemed");
        if (r) r.textContent = t.redeemed == null ? "—" : String(t.redeemed);
        // 「收款估算」不是回单：小铺没有 API，我方无从得知买家实付多少，
        // 这里是「已兑张数 × 我们自己填的建议售价」。促销 / 挂牌价漂了都会让它对不上。
        var g = $("stat-gross");
        if (g) g.textContent = fmtCny(t.revenue_est_cny);
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
        tbody.innerHTML = STATE.skus
            .map(function (s) {
                // ⚠️ 「本地可兑」是 state=issued 的行数，**不等于**小铺货架上的数量：
                //    已卖出但买家还没回来兑的卡仍算在内。小铺没有 API，真实货架数只能去后台看。
                //    所以水位只能拿它当近似，标红的含义是「该去补货了」而不是「已经断货」。
                var inStock = Number(s.in_stock) || 0;
                var enabled = s.enabled !== false;
                var low = enabled && inStock < Number(s.min_stock);
                // mintBusy / activeMintBatch 双闸：铸码请求在飞、或上一批明文还在面板上
                // 没交代（上架/作废），都不许再铸 —— 否则两批明文前后脚弹出来，
                // 粘到哪一批全靠记忆。
                var canMint = enabled && !!s.code_token && !!s.shop_item_url && !STATE.mintBusy && !STATE.activeMintBatch;
                var shopCell = s.shop_item_url
                    ? '<a href="' + esc(s.shop_item_url) + '" target="_blank" rel="noopener">' +
                      esc(s.shop_item_name || "商品") + "</a>"
                    : '<span class="stock-warn">未配置</span>';
                return (
                    '<tr class="' + (low ? "low-stock" : "") + '">' +
                    "<td>" + esc(s.display_name || s.sku) +
                    '<div class="sub">' + esc(s.sku) +
                    (enabled ? "" : " · 已停用") + "</div></td>" +
                    '<td><span class="mono">' + esc(s.code_token || "—") + "</span>" +
                    '<div class="sub">' + (s.kind === "plan" ? "套餐卡" : "充值卡") + "</div></td>" +
                    "<td>" + shopCell + "</td>" +
                    '<td class="num">' + fmtCny(s.face_cny) + "</td>" +
                    '<td class="num">' + fmtCny(s.list_price_cny) + "</td>" +
                    '<td class="num' + (low ? " stock-warn" : "") + '">' + inStock + "</td>" +
                    '<td class="num">' + (Number(s.redeemed) || 0) + "</td>" +
                    '<td class="num">' + (Number(s.voided) || 0) + "</td>" +
                    '<td class="num">' + fmtCny(s.revenue_est_cny) + "</td>" +
                    '<td class="num">' + esc(s.min_stock) + "</td>" +
                    '<td><div class="mint-cell">' +
                    '<input type="number" min="1" max="100" step="1" value="' +
                    esc(Math.min(Number(s.restock_batch) || 50, 100)) +
                    '" data-mint-count="' + esc(s.sku) + '"' + (canMint ? "" : " disabled") + " />" +
                    '<button class="btn-tiny approve" type="button" data-mint="' + esc(s.sku) + '"' +
                    (canMint ? "" : " disabled") + ">铸码</button></div></td>" +
                    "</tr>"
                );
            })
            .join("");

        Array.prototype.forEach.call(tbody.querySelectorAll("button[data-mint]"), function (btn) {
            btn.addEventListener("click", function () {
                doMint(btn);
            });
        });
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
                          "<td>" + esc(c.email || c.user_id || "—") + "</td>" +
                          '<td class="mono">' + esc(c.batch_no || "—") + "</td>" +
                          "</tr>"
                      );
                  })
                  .join("")
            : '<tr><td colspan="5" class="empty">暂无</td></tr>';
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
                // ⚠️ 结论选项按卡种收窄：套餐卡没有「钱包扣回」—— 扣余额冒充不了
                //    撤销套餐；钱包卡没有「套餐调整」。选错了会写出一条
                //    「看起来处理了、实际什么都没做」的结案记录。
                var isPlan = c.kind === "plan";
                var opts =
                    '<option value="">选择结论…</option>' +
                    (isPlan
                        ? '<option value="plan_adjusted">已人工调整套餐</option>'
                        : '<option value="wallet_adjusted">已钱包扣回</option>') +
                    '<option value="waived">放弃追回</option>' +
                    '<option value="account_restricted">已限制账号</option>' +
                    '<option value="external_refund_reversed">外部退款已冲正</option>';
                return (
                    "<tr>" +
                    "<td>" + esc(fmtTime(c.refund_flagged_at)) + "</td>" +
                    "<td>" + esc(c.display_name || c.sku) + "</td>" +
                    "<td>" + (isPlan ? "套餐卡" : "钱包卡") + "</td>" +
                    '<td class="num">' + fmtCny(c.face_cny) + "</td>" +
                    "<td>" + esc(c.email || c.user_id || "—") + "</td>" +
                    "<td>" + esc(fmtTime(c.redeemed_at)) + "</td>" +
                    "<td>" + esc(c.void_reason || "—") + "</td>" +
                    '<td><div class="refund-resolve">' +
                    '<select data-refund-resolution="' + esc(c.id) + '">' + opts + "</select>" +
                    '<input type="text" data-refund-note="' + esc(c.id) +
                    '" placeholder="备注（必填）" maxlength="1000" autocomplete="off" />' +
                    '<button class="btn-tiny approve" type="button" data-refund-resolve="' + esc(c.id) +
                    '">记录结案</button>' +
                    "</div></td>" +
                    "</tr>"
                );
            })
            .join("");
        Array.prototype.forEach.call(
            tbody.querySelectorAll("button[data-refund-resolve]"),
            function (btn) {
                btn.addEventListener("click", function () {
                    doResolveRefund(btn);
                });
            },
        );
    }

    function renderResolvedRefunds(rows) {
        var panel = $("resolved-refund-panel");
        var tbody = $("resolved-refund-rows");
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
                    "<td>" + esc(fmtTime(c.resolved_at)) + "</td>" +
                    "<td>" + esc(c.display_name || c.sku) + "</td>" +
                    "<td>" + (c.kind === "plan" ? "套餐卡" : "钱包卡") + "</td>" +
                    "<td>" + esc(c.email || c.user_id || "—") + "</td>" +
                    "<td>" + esc(c.resolution || "—") + "</td>" +
                    "<td>" + esc(c.resolution_note || "—") + "</td>" +
                    "</tr>"
                );
            })
            .join("");
    }

    function renderBatches() {
        var tbody = $("batch-rows");
        if (!tbody) return;
        var rows = STATE.batches || [];
        if (!rows.length) {
            tbody.innerHTML = '<tr><td colspan="9" class="empty">还没有批次</td></tr>';
            return;
        }
        tbody.innerHTML = rows
            .map(function (b) {
                var state = String(b.state || "");
                var stateText =
                    state === "published" ? "已确认上架" :
                    state === "void" ? "已整批作废" :
                    "待确认上架";
                var actions = "";
                if (state === "pending") {
                    actions =
                        '<button class="btn-tiny approve" type="button" data-batch-publish="' + esc(b.batch_no) + '">确认已上架</button>' +
                        '<button class="btn-tiny reject" type="button" data-batch-void="' + esc(b.batch_no) + '" data-state="pending">整批作废</button>';
                } else if (state === "published") {
                    actions =
                        '<button class="btn-tiny reject" type="button" data-batch-void="' + esc(b.batch_no) + '" data-state="published">停售未兑</button>';
                }
                return (
                    "<tr>" +
                    "<td>" + esc(fmtTime(b.created_at)) + "</td>" +
                    "<td>" + esc(b.display_name || b.sku) +
                    '<div class="sub mono">' + esc(b.code_token || "") + "</div></td>" +
                    '<td class="mono">' + esc(b.batch_no) + "</td>" +
                    "<td>" + stateText + "</td>" +
                    '<td class="num">' + esc(b.code_count) + "</td>" +
                    '<td class="num">' + (Number(b.issued) || 0) + "</td>" +
                    '<td class="num">' + (Number(b.redeemed) || 0) + "</td>" +
                    '<td class="num">' + (Number(b.voided) || 0) + "</td>" +
                    "<td>" + actions + "</td>" +
                    "</tr>"
                );
            })
            .join("");
        Array.prototype.forEach.call(
            tbody.querySelectorAll("button[data-batch-publish]"),
            function (btn) {
                btn.addEventListener("click", function () {
                    doBatchPublish(btn.getAttribute("data-batch-publish"));
                });
            },
        );
        Array.prototype.forEach.call(
            tbody.querySelectorAll("button[data-batch-void]"),
            function (btn) {
                btn.addEventListener("click", function () {
                    doBatchVoid(btn.getAttribute("data-batch-void"), btn.getAttribute("data-state"));
                });
            },
        );
    }

    // ── 动作 ────────────────────────────────────────────────────────────────

    async function loadOverview() {
        try {
            var r = await callGateway("admin_card_overview", {});
            STATE.skus = r.skus || [];
            STATE.batches = r.batches || [];
            STATE.refundRows = r.refund_queue || [];
            renderTotals(r.totals, r.redeem_enabled === true);
            renderSkus();
            renderBatches();
            renderRecent(r.recent);
            renderRefundQueue(STATE.refundRows);
            renderResolvedRefunds(r.resolved_refunds || []);
        } catch (err) {
            showToast("❌ " + errText(err), "err");
            var tbody = $("sku-rows");
            if (tbody) tbody.innerHTML = '<tr><td colspan="11" class="empty">加载失败，点右上角刷新重试</td></tr>';
            throw err;
        }
    }

    // 铸码明文面板。⛔ 明文只经过这里的 DOM，不写 STATE、不写 localStorage、不进 URL。
    function showMintResult(r) {
        var panel = $("mint-panel");
        var box = $("mint-codes");
        var target = $("mint-target");
        var open = $("mint-open-shop");
        if (!panel || !box) return;
        // 先记下「面板上是哪一批」再放明文：之后所有铸码入口都被这批锁住，
        // 直到人明确说「已上架」或「整批作废」。
        STATE.activeMintBatch = r.batch_no || null;
        renderSkus();
        box.value = (r.codes || []).join("\n");
        if (target) {
            target.innerHTML =
                "把下面 <b>" + esc(r.count) + "</b> 张卡密粘贴到小铺商品：<b>" +
                esc(r.shop_item_name || r.sku) + "</b>" +
                '<div class="sub">卡定位 <span class="mono">' + esc(r.code_token) +
                "</span> · 批次 <span class=\"mono\">" + esc(r.batch_no) + "</span></div>";
        }
        if (open) {
            open.href = r.shop_item_url || "#";
            open.style.display = r.shop_item_url ? "" : "none";
        }
        var note = $("mint-copy-note");
        if (note) note.textContent = "";
        panel.style.display = "";
        panel.scrollIntoView({ behavior: "smooth", block: "start" });
        box.focus();
        box.select();
    }

    // ⛔ 明文面板没有「关闭」按钮 —— 能随便关就等于能随手丢。唯一的退出路径是
    //    publishActiveMint / abandonActiveMint 成功后的这个 clear。
    function clearMintResult() {
        var panel = $("mint-panel");
        var box = $("mint-codes");
        // 先清空再隐藏：隐藏的 textarea 里留着明文没有任何好处。
        if (box) box.value = "";
        var target = $("mint-target");
        if (target) target.innerHTML = "";
        var open = $("mint-open-shop");
        if (open) {
            open.href = "#";
            open.style.display = "none";
        }
        STATE.activeMintBatch = null;
        if (panel) panel.style.display = "none";
        renderSkus();
    }

    async function publishActiveMint() {
        var batchNo = STATE.activeMintBatch;
        if (!batchNo) return;
        var btn = $("mint-publish");
        if (!window.confirm(
            "确认这批卡密已经粘贴到小铺商品的库存里了？\n\n批次 " + batchNo + "\n\n" +
            "⚠️ 「已上架」只是人工声明 —— 小铺没有 API，本站无法核验你真的粘了。" +
            "没粘就点上架，这批卡在库里可兑、货架上却没有，买家会付款拿不到卡。"
        )) return;
        if (btn) btn.disabled = true;
        try {
            var r = await callGateway("admin_card_batch_publish", { batch_no: batchNo });
            showToast("✅ " + (r.message || "已上架"), "ok");
            clearMintResult();
            await loadOverview();
        } catch (err) {
            showToast("❌ " + errText(err), "err");
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    async function abandonActiveMint() {
        var batchNo = STATE.activeMintBatch;
        if (!batchNo) return;
        var btn = $("mint-abandon");
        if (!window.confirm(
            "放弃这批卡密并整批作废？\n\n批次 " + batchNo + "\n\n" +
            "⚠️ 若已经粘进小铺，先从小铺库存删除；本站只作废未兑卡，" +
            "留在小铺货架上的死卡本站够不着。"
        )) return;
        if (btn) btn.disabled = true;
        try {
            var r = await callGateway("admin_card_batch_void", {
                batch_no: batchNo,
                reason: "mint_abandoned",
            });
            showToast("✅ " + (r.message || "已整批作废"), "ok");
            clearMintResult();
            await loadOverview();
        } catch (err) {
            showToast("❌ " + errText(err), "err");
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    // 只从 textarea 当前值生成本地文件 —— 不过网络、不进 STATE/localStorage。
    // 这是粘进小铺前的备份，不是第二个明文出口（提示里已写明上架后要删文件）。
    function downloadMintCodes() {
        var box = $("mint-codes");
        if (!box || !box.value) return;
        var name = String(STATE.activeMintBatch || "card-batch").replace(/[^0-9A-Za-z._-]+/g, "_");
        var blob = new Blob([box.value], { type: "text/plain;charset=utf-8" });
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = name + ".txt";
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }

    async function copyMintCodes() {
        var box = $("mint-codes");
        var note = $("mint-copy-note");
        if (!box || !box.value) return;
        try {
            await navigator.clipboard.writeText(box.value);
            if (note) note.textContent = "✅ 已复制，去小铺粘贴";
        } catch (e) {
            // 剪贴板 API 在非安全上下文/无权限时会抛。选中交给人自己按 Ctrl+C，
            // 别把「复制失败」说成「铸码失败」—— 卡已经铸出来了。
            box.focus();
            box.select();
            if (note) note.textContent = "⚠️ 自动复制失败，已全选，请按 Ctrl+C";
        }
    }

    async function doMint(btn) {
        // 防重入：上一批明文还摊在面板上、或上一个铸码请求还在飞，都不许再铸 ——
        // 两批明文前后脚出现，往哪个商品粘哪一批就全靠记忆了。
        var pendingBox = $("mint-codes");
        if (STATE.mintBusy || STATE.activeMintBatch || (pendingBox && pendingBox.value)) {
            showToast("❌ 上一批卡密还没交代：先「已粘贴，确认上架」或「放弃并整批作废」，再铸下一批", "err");
            return;
        }
        var sku = btn.getAttribute("data-mint");
        var row = null;
        STATE.skus.forEach(function (s) { if (s.sku === sku) row = s; });
        var input = document.querySelector('input[data-mint-count="' + sku + '"]');
        var count = input ? Math.floor(Number(input.value)) : 0;
        if (!Number.isFinite(count) || count < 1 || count > 100) {
            showToast("❌ 数量需在 1 - 100 之间", "err");
            return;
        }
        // 确认框里必须写清「要粘到哪个商品」—— 粘错商品是本通道唯一一种
        // 系统察觉不到的资金事故，而它发生在这一步之后、无人可挡。
        var targetName = (row && (row.shop_item_name || row.display_name)) || sku;
        if (!window.confirm(
            "为「" + ((row && row.display_name) || sku) + "」铸 " + count + " 张卡密？\n\n" +
            "铸完需要你手动把明文粘贴到小铺商品：\n  " + targetName + "\n\n" +
            "⚠️ 明文只显示这一次，粘错商品系统无法察觉。"
        )) return;
        STATE.mintBusy = true;
        renderSkus();
        btn.disabled = true;
        var label = btn.textContent;
        btn.textContent = "铸码中…";
        try {
            var r = await callGateway("admin_card_mint", { sku: sku, count: count });
            showMintResult(r);
            showToast("✅ " + (r.message || "已铸码"), "ok");
            await loadOverview();
        } catch (err) {
            showToast("❌ " + errText(err), "err");
        } finally {
            STATE.mintBusy = false;
            renderSkus();
            // ⚠️ 无论成败都要恢复按钮：loadOverview() 会重渲染整张表，
            //    但失败路径不走那里，按钮会永远停在「铸码中…」。
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

    async function doVoidBulk() {
        var codesEl = $("bulk-codes");
        var btn = $("bulk-btn");
        if (!codesEl || !btn) return;
        var codes = codesEl.value.trim();
        if (!codes) {
            showToast("❌ 请粘贴要作废的卡密", "err");
            codesEl.focus();
            return;
        }
        if (!window.confirm(
            "确认批量作废？\n\n未兑现的卡会立刻失效；已兑现的只会挂进人工队列，" +
            "钱不会自动扣回。"
        )) return;
        btn.disabled = true;
        try {
            var r = await callGateway("admin_card_void_bulk", {
                codes: codes,
                reason: ($("bulk-reason") || {}).value || "",
                order_ref: ($("bulk-order") || {}).value || "",
            });
            // 有已兑现的卡被挂进队列时用 err 配色：那是需要人接着处理的，不是「做完了」。
            showToast((r.flagged > 0 ? "⚠️ " : "✅ ") + (r.message || "已处理"), r.flagged > 0 ? "err" : "ok");
            // 🔴 unresolved>0（坏行 / 库里查不到的卡）时**不清空**：服务端不会
            //    回传那批卡的身份，清掉输入就再也追不回是哪几张没处理。
            if (Number(r.unresolved) === 0) {
                codesEl.value = "";
                var bulkReason = $("bulk-reason");
                if (bulkReason) bulkReason.value = "";
                var bulkOrder = $("bulk-order");
                if (bulkOrder) bulkOrder.value = "";
            }
            await loadOverview();
        } catch (err) {
            showToast("❌ " + errText(err), "err");
        } finally {
            btn.disabled = false;
        }
    }

    async function doBatchPublish(batchNo) {
        if (!batchNo) return;
        if (!window.confirm(
            "确认批次 " + batchNo + " 的卡密已经粘贴到小铺商品的库存里？\n\n" +
            "⚠️ 「已上架」只是人工声明：小铺没有 API，系统无法从链动核验你真的粘了。" +
            "没粘就标上架 = 库里可兑、货架无货，买家会付款拿不到卡。"
        )) return;
        try {
            var r = await callGateway("admin_card_batch_publish", { batch_no: batchNo });
            showToast("✅ " + (r.message || "已上架"), "ok");
            await loadOverview();
        } catch (err) {
            showToast("❌ " + errText(err), "err");
        }
    }

    async function doBatchVoid(batchNo, state) {
        if (!batchNo) return;
        var warn = state === "published"
            ? "⚠️ 这批已标记上架：先从小铺库存删除这些卡密，否则买家会买到死卡。"
            : "⚠️ 若这批已经粘进小铺，先从小铺库存删除；本站只作废未兑卡。";
        if (!window.confirm(
            "整批作废 " + batchNo + "？\n\n" + warn +
            "\n已兑换的卡不会自动追回，需走退款人工队列。"
        )) return;
        try {
            var r = await callGateway("admin_card_batch_void", {
                batch_no: batchNo,
                reason: "batch_abandoned",
            });
            showToast("✅ " + (r.message || "已整批作废"), "ok");
            await loadOverview();
        } catch (err) {
            showToast("❌ " + errText(err), "err");
        }
    }

    async function doResolveRefund(btn) {
        var cardId = btn.getAttribute("data-refund-resolve");
        var sel = document.querySelector('select[data-refund-resolution="' + cardId + '"]');
        var noteEl = document.querySelector('input[data-refund-note="' + cardId + '"]');
        var resolution = sel ? sel.value : "";
        var note = noteEl ? noteEl.value.trim() : "";
        if (!resolution || !note) {
            showToast("❌ 请选择处理结论并填写备注", "err");
            return;
        }
        if (!window.confirm(
            "记录这条退款的人工处理结论？\n\n" +
            "⚠️ 这一步只记录处理结论，不自动改钱包或套餐 —— " +
            "扣款/调套餐必须先在对应页面做完，这里只是留档。"
        )) return;
        btn.disabled = true;
        try {
            var r = await callGateway("admin_card_refund_resolve", {
                card_id: Number(cardId),
                resolution: resolution,
                note: note,
            });
            showToast("✅ " + (r.message || "已结案"), "ok");
            await loadOverview();
        } catch (err) {
            showToast("❌ " + errText(err), "err");
        } finally {
            btn.disabled = false;
        }
    }

    // 明文还摊在面板上时不许静默离开 —— 刷新/关页先弹浏览器确认。
    window.addEventListener("beforeunload", function (ev) {
        var box = $("mint-codes");
        if (box && box.value) {
            ev.preventDefault();
            ev.returnValue = "";
        }
    });

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
        var bulkBtn = $("bulk-btn");
        if (bulkBtn) bulkBtn.addEventListener("click", doVoidBulk);
        var mintCopy = $("mint-copy");
        if (mintCopy) mintCopy.addEventListener("click", copyMintCodes);
        var mintDownload = $("mint-download");
        if (mintDownload) mintDownload.addEventListener("click", downloadMintCodes);
        var mintPublish = $("mint-publish");
        if (mintPublish) mintPublish.addEventListener("click", publishActiveMint);
        var mintAbandon = $("mint-abandon");
        if (mintAbandon) mintAbandon.addEventListener("click", abandonActiveMint);
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
