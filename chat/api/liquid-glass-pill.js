/**
 * liquid-glass-pure 液态玻璃胶囊（api/index + api_docs 共用）
 * Canvas SDF 位移图 + SVG 色差折射；可选长按原地撕扯。
 */
(function () {
    "use strict";

    function generateLiquidGlassDisplacementMap(width, height, pullX, pullY) {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        const img = ctx.createImageData(width, height);
        const data = img.data;

        const smoothStep = (a, b, t) => {
            t = Math.max(0, Math.min(1, (t - a) / (b - a)));
            return t * t * (3 - 2 * t);
        };
        const len = (x, y) => Math.sqrt(x * x + y * y);
        const sdfRoundedRect = (x, y, w, h, r) => {
            const qx = Math.abs(x) - w + r;
            const qy = Math.abs(y) - h + r;
            return (
                Math.min(Math.max(qx, qy), 0) +
                len(Math.max(qx, 0), Math.max(qy, 0)) -
                r
            );
        };

        const pullLen = Math.hypot(pullX, pullY);
        const pullMag = Math.min(1, pullLen / 88);
        const pux = pullLen > 0.5 ? pullX / pullLen : 0;
        const puy = pullLen > 0.5 ? pullY / pullLen : 0;

        const raw = new Float32Array(width * height * 2);
        let maxScale = 0;
        let i = 0;
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const u = x / width;
                const v = y / height;
                const ix = u - 0.5;
                const iy = v - 0.5;
                const d = sdfRoundedRect(ix, iy, 0.3, 0.2, 0.6);
                const bulge = smoothStep(0.8, 0, d - 0.15);
                const k = smoothStep(0, 1, bulge);
                const align = ix * pux + iy * puy;
                const stretch = 1 + Math.max(0, align) * pullMag * 1.45;
                const tear = 1 + pullMag * 0.35 * (1 - Math.abs(align));
                const shearX = pux * pullMag * k * 1.05;
                const shearY = puy * pullMag * k * 1.05;
                const dx = (ix * k * stretch * tear + shearX) * width;
                const dy = (iy * k * stretch * tear + shearY) * height;
                maxScale = Math.max(maxScale, Math.abs(dx), Math.abs(dy));
                raw[i++] = dx;
                raw[i++] = dy;
            }
        }
        if (maxScale === 0) maxScale = 1;
        maxScale = Math.max(maxScale, 1);

        let p = 0;
        let j = 0;
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const dx = raw[p++];
                const dy = raw[p++];
                const edgeDist = Math.min(x, y, width - 1 - x, height - 1 - y);
                const edgeFactor = Math.min(1, edgeDist / 2);
                const r = (dx * edgeFactor) / maxScale * 0.5 + 0.5;
                const g = (dy * edgeFactor) / maxScale * 0.5 + 0.5;
                data[j++] = Math.max(0, Math.min(255, r * 255));
                data[j++] = Math.max(0, Math.min(255, g * 255));
                data[j++] = Math.max(0, Math.min(255, g * 255));
                data[j++] = 255;
            }
        }
        ctx.putImageData(img, 0, 0);
        return canvas.toDataURL();
    }

    function initLiquidGlassPill(pill) {
        const filterId = pill.dataset.lgFilter;
        const feImage = document.getElementById(pill.dataset.lgFeimage || "");
        const dispR = document.getElementById(pill.dataset.lgDispR || "");
        const dispG = document.getElementById(pill.dataset.lgDispG || "");
        const dispB = document.getElementById(pill.dataset.lgDispB || "");
        const warp = pill.querySelector("[class*='__warp']");
        const content = pill.querySelector("[class*='__content']");
        if (!filterId || !warp || !feImage || !dispR || !dispG || !dispB) return;

        const params = { disp: 70, ab: 3, blur: 2, sat: 140 };
        const stretchEnabled = pill.dataset.lgStretch === "true";
        const longPressMs = Number(pill.dataset.lgLongPress) || 280;
        const baseTransform = pill.dataset.lgBaseTransform || "";

        let pull = { x: 0, y: 0 };
        let lastMapKey = "";
        let stretchActive = false;
        let blockNavClick = false;
        let longPressTimer = 0;
        let pointerId = null;
        let originX = 0;
        let originY = 0;
        let springFrame = 0;

        function applyTransform() {
            if (
                !stretchActive &&
                Math.abs(pull.x) < 0.5 &&
                Math.abs(pull.y) < 0.5
            ) {
                pill.style.transform = "";
                if (content) content.style.transform = "";
                return;
            }
            const tugX = pull.x * 0.07;
            const tugY = pull.y * 0.07;
            const skewX = pull.x * 0.018;
            const skewY = pull.y * 0.018;
            const scaleX = 1 + Math.min(0.08, Math.abs(pull.x) / 900);
            const scaleY = 1 + Math.min(0.08, Math.abs(pull.y) / 900);
            const extra =
                " translate(" +
                tugX +
                "px," +
                tugY +
                "px) skew(" +
                skewX +
                "deg," +
                skewY +
                "deg) scale(" +
                scaleX +
                "," +
                scaleY +
                ")";
            pill.style.transform = baseTransform
                ? baseTransform + extra
                : extra.trim();
            if (content) {
                content.style.transform =
                    "translate(" +
                    pull.x * 0.04 +
                    "px," +
                    pull.y * 0.04 +
                    "px)";
            }
        }

        function refresh() {
            const rect = pill.getBoundingClientRect();
            const w = Math.max(1, Math.round(rect.width));
            const h = Math.max(1, Math.round(rect.height));
            const key =
                w +
                "x" +
                h +
                ":" +
                Math.round(pull.x) +
                ":" +
                Math.round(pull.y);
            if (key !== lastMapKey) {
                const mapUrl = generateLiquidGlassDisplacementMap(
                    w,
                    h,
                    pull.x,
                    pull.y,
                );
                feImage.setAttribute("href", mapUrl);
                feImage.setAttribute("xlink:href", mapUrl);
                lastMapKey = key;
            }
            const pullBoost = Math.min(52, Math.hypot(pull.x, pull.y) * 0.5);
            const d = params.disp + pullBoost;
            dispR.setAttribute("scale", String(d + params.ab));
            dispG.setAttribute("scale", String(d));
            dispB.setAttribute("scale", String(d - params.ab));
            const bf =
                "url(#" +
                filterId +
                ") blur(" +
                params.blur +
                "px) saturate(" +
                params.sat +
                "%) brightness(1.05)";
            warp.style.backdropFilter = bf;
            warp.style.webkitBackdropFilter = bf;
            applyTransform();
        }

        function animatePullBack() {
            if (springFrame) cancelAnimationFrame(springFrame);
            const start = { x: pull.x, y: pull.y };
            const t0 = performance.now();
            const duration = 340;

            function frame(now) {
                const t = Math.min(1, (now - t0) / duration);
                const ease = 1 - Math.pow(1 - t, 3);
                pull.x = start.x * (1 - ease);
                pull.y = start.y * (1 - ease);
                refresh();
                if (t < 1) {
                    springFrame = requestAnimationFrame(frame);
                } else {
                    springFrame = 0;
                    pull.x = 0;
                    pull.y = 0;
                    refresh();
                    pill.classList.remove("is-stretching");
                    setTimeout(() => {
                        blockNavClick = false;
                    }, 80);
                }
            }
            springFrame = requestAnimationFrame(frame);
        }

        function clearLongPress() {
            if (longPressTimer) {
                clearTimeout(longPressTimer);
                longPressTimer = 0;
            }
        }

        function onPointerDown(e) {
            if (!stretchEnabled || e.button > 0) return;
            clearLongPress();
            originX = e.clientX;
            originY = e.clientY;
            pointerId = e.pointerId;
            longPressTimer = window.setTimeout(() => {
                longPressTimer = 0;
                stretchActive = true;
                blockNavClick = true;
                pill.classList.add("is-stretching");
                try {
                    pill.setPointerCapture(pointerId);
                } catch {
                    /* ignore */
                }
            }, longPressMs);
        }

        function onPointerMove(e) {
            if (!stretchActive) return;
            e.preventDefault();
            pull.x = e.clientX - originX;
            pull.y = e.clientY - originY;
            const max = 96;
            const mag = Math.hypot(pull.x, pull.y);
            if (mag > max) {
                pull.x = (pull.x / mag) * max;
                pull.y = (pull.y / mag) * max;
            }
            refresh();
        }

        function onPointerUp(e) {
            clearLongPress();
            if (stretchActive) {
                e.preventDefault();
                stretchActive = false;
                try {
                    pill.releasePointerCapture(e.pointerId);
                } catch {
                    /* ignore */
                }
                animatePullBack();
                return;
            }
            const moved = Math.hypot(e.clientX - originX, e.clientY - originY);
            if (moved > 8) blockNavClick = true;
        }

        function onClick(e) {
            if (blockNavClick || stretchActive) {
                e.preventDefault();
            }
        }

        refresh();
        window.addEventListener("resize", refresh);
        if (document.fonts?.ready) {
            document.fonts.ready.then(refresh).catch(() => {});
        }
        if (typeof ResizeObserver !== "undefined") {
            new ResizeObserver(refresh).observe(pill);
        }

        if (stretchEnabled) {
            pill.addEventListener("pointerdown", onPointerDown);
            pill.addEventListener("pointermove", onPointerMove);
            pill.addEventListener("pointerup", onPointerUp);
            pill.addEventListener("pointercancel", onPointerUp);
            pill.addEventListener("click", onClick);
        }
    }

    function boot() {
        document
            .querySelectorAll("[data-liquid-glass]")
            .forEach(initLiquidGlassPill);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", boot);
    } else {
        boot();
    }
})();
