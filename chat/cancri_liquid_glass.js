/*
 * Cancri Liquid Glass — runtime that boots the shared SVG displacement
 * filter referenced by `[data-glass]` elements in cancri_liquid_glass.css.
 *
 * The filter is a single SVG <filter> living in a hidden defs SVG at the
 * top of <body>. Every glass element on the page chains the SAME filter
 * via `backdrop-filter: url(#cancri-liquid-glass)`. Sharing one filter
 * keeps compositing cheap; a generic round bulge displacement map
 * + xMidYMid slice preserveAspectRatio takes care of fitting to any box.
 *
 * The displacement map itself is a 256×256 canvas computed at script
 * load. We encode horizontal offset in the R channel and vertical offset
 * in G (also mirrored to B for SVG filter compatibility). The shape is
 * a rounded-rectangle SDF turned into a smooth bulge — the same recipe
 * used by Apple's reference liquid-glass demos.
 *
 * Browsers without backdrop-filter: url() support (Safari, Firefox) fall
 * back to plain backdrop-blur via the CSS @supports block.
 */

(function () {
    "use strict";

    // Defensive: don't double-install if this script is loaded twice.
    if (document.getElementById("cancri-liquid-glass-defs")) return;

    /* ── displacement map generation ────────────────────────────────
     *
     * Port of liquid-glass-react's shader-utils.ts fragmentShaders.liquidGlass.
     * Returns a data URL PNG containing the displacement map.
     *
     * @param {number} size  Square size in pixels (256 is a good default —
     *                       big enough to look smooth at any glass size,
     *                       small enough to compute on script load).
     */
    function generateDisplacementMap(size) {
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        const imageData = ctx.createImageData(size, size);
        const data = imageData.data;

        const smoothStep = (a, b, t) => {
            t = Math.max(0, Math.min(1, (t - a) / (b - a)));
            return t * t * (3 - 2 * t);
        };
        const len = (x, y) => Math.sqrt(x * x + y * y);
        const roundedRectSDF = (x, y, w, h, r) => {
            const qx = Math.abs(x) - w + r;
            const qy = Math.abs(y) - h + r;
            return (
                Math.min(Math.max(qx, qy), 0) +
                len(Math.max(qx, 0), Math.max(qy, 0)) -
                r
            );
        };

        // Pass 1: compute raw dx/dy, track max so we can normalize.
        const raw = new Float32Array(size * size * 2);
        let maxScale = 0;
        let idx = 0;
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const u = x / size;
                const v = y / size;
                const ix = u - 0.5;
                const iy = v - 0.5;
                const d = roundedRectSDF(ix, iy, 0.3, 0.2, 0.6);
                const bulge = smoothStep(0.8, 0, d - 0.15);
                const k = smoothStep(0, 1, bulge);
                const dx = ix * k * size;
                const dy = iy * k * size;
                if (Math.abs(dx) > maxScale) maxScale = Math.abs(dx);
                if (Math.abs(dy) > maxScale) maxScale = Math.abs(dy);
                raw[idx++] = dx;
                raw[idx++] = dy;
            }
        }
        if (maxScale < 1) maxScale = 1;

        // Pass 2: encode into RGBA bytes. R = dx, G = dy, B mirrors G for
        // tolerance against SVG xChannelSelector=R yChannelSelector=B
        // configurations. Feather the outermost 2-px ring so the filter
        // has a clean tail-off at the displacement map edge.
        let p = 0;
        let w = 0;
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const dx = raw[p++];
                const dy = raw[p++];
                const edgeDist = Math.min(x, y, size - 1 - x, size - 1 - y);
                const edgeFactor = Math.min(1, edgeDist / 2);
                const r = ((dx * edgeFactor) / maxScale) * 0.5 + 0.5;
                const g = ((dy * edgeFactor) / maxScale) * 0.5 + 0.5;
                data[w++] = Math.max(0, Math.min(255, r * 255));
                data[w++] = Math.max(0, Math.min(255, g * 255));
                data[w++] = Math.max(0, Math.min(255, g * 255));
                data[w++] = 255;
            }
        }

        ctx.putImageData(imageData, 0, 0);
        return canvas.toDataURL();
    }

    /* ── inject the SVG defs ─────────────────────────────────────── */

    function install() {
        if (document.getElementById("cancri-liquid-glass-defs")) return;
        // Need a body to attach to. If the script ran in <head> before
        // body exists, defer to DOMContentLoaded.
        if (!document.body) {
            document.addEventListener("DOMContentLoaded", install, { once: true });
            return;
        }

        const mapUrl = generateDisplacementMap(256);

        const svgNs = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(svgNs, "svg");
        svg.id = "cancri-liquid-glass-defs";
        svg.setAttribute("width", "0");
        svg.setAttribute("height", "0");
        svg.setAttribute("aria-hidden", "true");
        svg.style.cssText =
            "position:absolute;width:0;height:0;pointer-events:none;visibility:hidden;";

        // The filter pipeline:
        //   1. Pull in the displacement map
        //   2. Build an edge-only alpha mask from it (so chromatic
        //      aberration only shows on the rim, not all over the face)
        //   3. Three feDisplacementMap passes (R, G, B) with slightly
        //      different scales → per-channel refraction
        //   4. Screen-blend the three channels back together
        //   5. Composite: rim shows chromatic, center shows clean green
        //      reference, so we don't get fringing on the body of the glass
        //   6. Tiny gaussian blur to soften sub-pixel aliasing.
        svg.innerHTML = `
<defs>
    <filter
        id="cancri-liquid-glass"
        x="0" y="0" width="100%" height="100%"
        filterUnits="objectBoundingBox"
        primitiveUnits="userSpaceOnUse"
        color-interpolation-filters="sRGB">

        <feImage id="cancri-lg-feimage"
            href="${mapUrl}"
            preserveAspectRatio="xMidYMid slice"
            result="MAP" />

        <feColorMatrix in="MAP" type="matrix" result="EDGE_GREY"
            values="0.3 0.3 0.3 0 0
                    0.3 0.3 0.3 0 0
                    0.3 0.3 0.3 0 0
                    0   0   0   1 0" />
        <feComponentTransfer in="EDGE_GREY" result="EDGE_MASK">
            <feFuncA type="discrete" tableValues="0 0.15 1" />
        </feComponentTransfer>

        <feDisplacementMap in="SourceGraphic" in2="MAP"
            scale="42" xChannelSelector="R" yChannelSelector="G"
            result="DISP_R" />
        <feColorMatrix in="DISP_R" type="matrix" result="CH_R"
            values="1 0 0 0 0
                    0 0 0 0 0
                    0 0 0 0 0
                    0 0 0 1 0" />

        <feDisplacementMap in="SourceGraphic" in2="MAP"
            scale="40" xChannelSelector="R" yChannelSelector="G"
            result="DISP_G" />
        <feColorMatrix in="DISP_G" type="matrix" result="CH_G"
            values="0 0 0 0 0
                    0 1 0 0 0
                    0 0 0 0 0
                    0 0 0 1 0" />

        <feDisplacementMap in="SourceGraphic" in2="MAP"
            scale="38" xChannelSelector="R" yChannelSelector="G"
            result="DISP_B" />
        <feColorMatrix in="DISP_B" type="matrix" result="CH_B"
            values="0 0 0 0 0
                    0 0 0 0 0
                    0 0 1 0 0
                    0 0 0 1 0" />

        <feBlend in="CH_G" in2="CH_B" mode="screen" result="GB" />
        <feBlend in="CH_R" in2="GB" mode="screen" result="ABERRATED" />

        <feComposite in="ABERRATED" in2="EDGE_MASK"
            operator="in" result="RIM_CHROMA" />
        <feComponentTransfer in="EDGE_MASK" result="INV_MASK">
            <feFuncA type="table" tableValues="1 0" />
        </feComponentTransfer>
        <feComposite in="DISP_G" in2="INV_MASK"
            operator="in" result="CENTER_CLEAN" />
        <feComposite in="RIM_CHROMA" in2="CENTER_CLEAN"
            operator="over" result="COMBINED" />

        <feGaussianBlur in="COMBINED" stdDeviation="0.4" />
    </filter>
</defs>
        `;

        // Insert at the very start of <body> so the filter is defined
        // before any element that references it via backdrop-filter:url()
        // tries to paint.
        document.body.insertBefore(svg, document.body.firstChild);
    }

    install();
})();
