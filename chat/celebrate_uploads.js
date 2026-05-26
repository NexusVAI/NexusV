/* ============================================================
 * Cancri 满月 · 故事墙图片上传
 * 2026-05-28 · Phase 5
 *
 * 行为：
 *   • 文件选择 → 客户端压缩到 ≤ 500KB（长边 ≤ 1600px，从 q=0.85 起降）
 *   • 上传到 Supabase Storage bucket `celebrate-uploads`，路径 wall/{user_id}/{ts}_{rand}.jpg
 *   • 返回 public URL 数组，最多 3 张
 *   • 暴露 window.__CELEBRATE_UPLOADS__ = { collect: () => Promise<string[]>, reset: () => void }
 *     供 celebrate.js 在提交故事时取已上传 URL 列表
 *
 * 安全：
 *   • Storage RLS：只允许 authenticated 用户写入 wall/{auth.uid()}/
 *   • Edge function 二次校验 URL 必须以 storage public 路径前缀开头
 * ============================================================ */
(function () {
    "use strict";

    var MAX_IMAGES = 3;
    var TARGET_BYTES = 500 * 1024;
    var MAX_LONG_EDGE = 1600;
    var ACCEPTED_MIME = ["image/jpeg", "image/png", "image/webp"];

    var state = {
        // 已上传：{ name, url, sizeBytes }
        uploaded: [],
        // 正在处理的 File 对象数量，用于 UI 提示
        pending: 0,
    };

    function $(id) { return document.getElementById(id); }

    // ---------- supabase ----------
    var _sb = null;
    function getSupabase() {
        if (_sb) return _sb;
        if (!window.supabase || !window.supabase.createClient) return null;
        var url = window.__SUPABASE_URL__, key = window.__SUPABASE_ANON_KEY__;
        if (!url || !key) return null;
        _sb = window.supabase.createClient(url, key, {
            auth: {
                persistSession: true,
                autoRefreshToken: true,
                detectSessionInUrl: false,
                storageKey: "cancri_supabase_auth",
            },
        });
        return _sb;
    }

    function toast(msg) {
        // 复用 celebrate.js 的 toast 如果暴露了；否则简单 alert
        if (typeof window.__cancriToast === "function") {
            window.__cancriToast(msg);
            return;
        }
        var t = document.createElement("div");
        t.textContent = msg;
        t.style.cssText = "position:fixed;left:50%;bottom:32px;transform:translateX(-50%);" +
            "background:rgba(20,20,20,0.92);color:#fff;padding:12px 20px;" +
            "border-radius:999px;font-size:14px;z-index:10000;max-width:88vw;" +
            "text-align:center;box-shadow:0 8px 24px rgba(0,0,0,0.25);";
        document.body.appendChild(t);
        setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 3200);
    }

    // ---------- 压缩 ----------
    // 输入 File，输出 Blob（JPEG）。从 q=0.85 起逐步降到 0.5；若仍超 → 缩尺寸再来一轮。
    function compressImage(file) {
        return new Promise(function (resolve, reject) {
            var img = new Image();
            var url = URL.createObjectURL(file);
            img.onload = function () {
                try {
                    var w = img.naturalWidth, h = img.naturalHeight;
                    var scale = 1;
                    if (Math.max(w, h) > MAX_LONG_EDGE) {
                        scale = MAX_LONG_EDGE / Math.max(w, h);
                    }
                    tryEncode(img, w * scale, h * scale, 0.85, 0)
                        .then(function (blob) {
                            URL.revokeObjectURL(url);
                            resolve(blob);
                        })
                        .catch(function (e) {
                            URL.revokeObjectURL(url);
                            reject(e);
                        });
                } catch (e) {
                    URL.revokeObjectURL(url);
                    reject(e);
                }
            };
            img.onerror = function () {
                URL.revokeObjectURL(url);
                reject(new Error("无法读取图片"));
            };
            img.src = url;
        });
    }

    function tryEncode(img, targetW, targetH, quality, attempt) {
        return new Promise(function (resolve, reject) {
            if (attempt > 6) {
                reject(new Error("图片压缩失败：尺寸过大"));
                return;
            }
            var canvas = document.createElement("canvas");
            canvas.width = Math.max(1, Math.round(targetW));
            canvas.height = Math.max(1, Math.round(targetH));
            var ctx = canvas.getContext("2d");
            if (!ctx) { reject(new Error("canvas 不可用")); return; }
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            canvas.toBlob(function (blob) {
                if (!blob) { reject(new Error("toBlob 失败")); return; }
                if (blob.size <= TARGET_BYTES || (quality <= 0.55 && targetW <= 800)) {
                    resolve(blob);
                    return;
                }
                // 先降 quality；quality 已经低再降尺寸
                if (quality > 0.55) {
                    tryEncode(img, targetW, targetH, Math.max(0.55, quality - 0.1), attempt + 1)
                        .then(resolve, reject);
                } else {
                    tryEncode(img, targetW * 0.8, targetH * 0.8, quality, attempt + 1)
                        .then(resolve, reject);
                }
            }, "image/jpeg", quality);
        });
    }

    // ---------- 上传 ----------
    function uniqueName(ext) {
        var rand = Math.random().toString(36).slice(2, 10);
        return Date.now() + "_" + rand + "." + ext;
    }

    function uploadOne(file) {
        var sb = getSupabase();
        if (!sb) return Promise.reject(new Error("Supabase 客户端未就绪"));
        return sb.auth.getUser().then(function (resp) {
            var user = resp && resp.data && resp.data.user;
            if (!user) throw new Error("请先登录后再上传图片");
            return compressImage(file).then(function (blob) {
                var path = "wall/" + user.id + "/" + uniqueName("jpg");
                return sb.storage.from("celebrate-uploads")
                    .upload(path, blob, {
                        cacheControl: "31536000",
                        upsert: false,
                        contentType: "image/jpeg",
                    })
                    .then(function (up) {
                        if (up.error) throw up.error;
                        var pub = sb.storage.from("celebrate-uploads").getPublicUrl(path);
                        var url = pub && pub.data && pub.data.publicUrl;
                        if (!url) throw new Error("获取 public URL 失败");
                        return { name: path, url: url, sizeBytes: blob.size };
                    });
            });
        });
    }

    // ---------- UI ----------
    function escapeHtml(s) {
        return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
        });
    }

    function renderThumbs() {
        var box = $("wallUploadsThumbs");
        if (!box) return;
        box.innerHTML = state.uploaded.map(function (it, idx) {
            return '<div class="celebrate-wall-upload-thumb" data-idx="' + idx + '">' +
                '<img src="' + escapeHtml(it.url) + '" alt="上传图片 ' + (idx + 1) + '" />' +
                '<button class="celebrate-wall-upload-remove" type="button" aria-label="移除" data-idx="' + idx + '">×</button>' +
            '</div>';
        }).join("");
        // 移除按钮
        Array.prototype.forEach.call(box.querySelectorAll(".celebrate-wall-upload-remove"), function (btn) {
            btn.addEventListener("click", function (e) {
                e.stopPropagation();
                var i = Number(btn.getAttribute("data-idx"));
                state.uploaded.splice(i, 1);
                renderThumbs();
                updateAddBtnState();
            });
        });
    }

    function updateAddBtnState() {
        var add = $("wallUploadsAdd");
        if (!add) return;
        var full = (state.uploaded.length + state.pending) >= MAX_IMAGES;
        add.classList.toggle("is-disabled", full);
        var input = $("wallUploadsInput");
        if (input) input.disabled = full;
    }

    function processFile(file) {
        if (ACCEPTED_MIME.indexOf(file.type) < 0) {
            toast("仅支持 JPG / PNG / WEBP");
            return Promise.resolve(null);
        }
        if ((state.uploaded.length + state.pending) >= MAX_IMAGES) {
            toast("最多 " + MAX_IMAGES + " 张图片");
            return Promise.resolve(null);
        }
        state.pending += 1;
        updateAddBtnState();
        return uploadOne(file).then(function (item) {
            state.uploaded.push(item);
            return item;
        }).catch(function (err) {
            console.warn("[uploads] upload failed", err);
            toast((err && err.message) || "上传失败，请稍后重试");
            return null;
        }).then(function (item) {
            state.pending -= 1;
            renderThumbs();
            updateAddBtnState();
            return item;
        });
    }

    function bindUi() {
        var input = $("wallUploadsInput");
        var add = $("wallUploadsAdd");
        if (!input || !add) return;
        add.addEventListener("click", function (e) {
            if (add.classList.contains("is-disabled")) {
                e.preventDefault();
                toast("最多 " + MAX_IMAGES + " 张图片");
                return;
            }
            input.click();
        });
        // 键盘 enter 触发
        add.addEventListener("keydown", function (e) {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                if (!add.classList.contains("is-disabled")) input.click();
            }
        });
        input.addEventListener("change", function () {
            var files = Array.prototype.slice.call(input.files || []);
            input.value = ""; // 允许重复选同一文件
            if (!files.length) return;
            // 顺序上传，避免一次性占满网络 / Supabase 限流
            (function next(i) {
                if (i >= files.length) return;
                processFile(files[i]).then(function () { next(i + 1); });
            })(0);
        });
    }

    function init() {
        bindUi();
        renderThumbs();
        updateAddBtnState();
        // 暴露 collect / reset 给 celebrate.js
        window.__CELEBRATE_UPLOADS__ = {
            collect: function () {
                if (state.pending > 0) {
                    return Promise.reject(new Error("图片还在上传，稍等一秒再提交"));
                }
                return Promise.resolve(state.uploaded.map(function (it) { return it.url; }));
            },
            reset: function () {
                state.uploaded = [];
                renderThumbs();
                updateAddBtnState();
            },
            count: function () { return state.uploaded.length; },
        };
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init, { once: true });
    } else {
        init();
    }
})();
