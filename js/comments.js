// Comments Toggle Functionality for NexusV
(function() {
    'use strict';

    function initCommentsUi() {
        initCommentsToggle();
        initCusdisThemeSync();
        initModalClose();
    }

    document.addEventListener('DOMContentLoaded', initCommentsUi);
    window.addEventListener('nexus:components-injected', initCommentsUi);

    /**
     * Initialize the comments toggle button functionality
     */
    function initCommentsToggle() {
        const toggleBtn = document.getElementById('comments-toggle-btn');
        const commentsOverlay = document.getElementById('comments-overlay');

        if (!toggleBtn || !commentsOverlay) return;
        if (toggleBtn.dataset.commentsToggleBound === '1') return;
        toggleBtn.dataset.commentsToggleBound = '1';

        toggleBtn.addEventListener('click', function() {
            const isShowing = commentsOverlay.classList.contains('show');

            if (isShowing) {
                // Hide comments
                closeCommentsModal();
            } else {
                // Show comments
                openCommentsModal();
            }
        });
    }


    function initRefractionFilter() {
        const toggleBtn = document.getElementById('comments-toggle-btn');
        if (!toggleBtn) return;

        const filterId = ensureRefractionFilter();
        const layer = ensureRefractionLayer(toggleBtn);
        layer.style.filter = `url(#${filterId})`;
        layer.style.backdropFilter = 'blur(6px) saturate(170%)';
        layer.style.webkitBackdropFilter = 'blur(6px) saturate(170%)';
    }

    function ensureRefractionLayer(toggleBtn) {
        const existing = toggleBtn.querySelector('.comments-refraction-layer');
        if (existing) return existing;
        const layer = document.createElement('span');
        layer.className = 'comments-refraction-layer';
        toggleBtn.insertBefore(layer, toggleBtn.firstChild);
        return layer;
    }

    function initGlassMotion() {
        const fab = document.querySelector('.comments-fab');
        const toggleBtn = document.getElementById('comments-toggle-btn');
        if (!fab || !toggleBtn) return;

        const state = {
            elasticity: 0.3,
            isActive: false,
            globalMousePos: { x: 0, y: 0 }
        };

        const updateTransform = function() {
            const rect = toggleBtn.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            const pillWidth = rect.width;
            const pillHeight = rect.height;

            const edgeDistanceX = Math.max(0, Math.abs(state.globalMousePos.x - centerX) - pillWidth / 2);
            const edgeDistanceY = Math.max(0, Math.abs(state.globalMousePos.y - centerY) - pillHeight / 2);
            const edgeDistance = Math.sqrt(edgeDistanceX * edgeDistanceX + edgeDistanceY * edgeDistanceY);
            const activationZone = 200;
            const fadeInFactor = edgeDistance > activationZone ? 0 : 1 - edgeDistance / activationZone;

            const deltaX = state.globalMousePos.x - centerX;
            const deltaY = state.globalMousePos.y - centerY;
            const centerDistance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

            let directionalScale = 'scale(1)';
            if (centerDistance > 0 && fadeInFactor > 0) {
                const normalizedX = deltaX / centerDistance;
                const normalizedY = deltaY / centerDistance;
                const stretchIntensity = Math.min(centerDistance / 300, 1) * state.elasticity * fadeInFactor;
                const scaleX = 1 + Math.abs(normalizedX) * stretchIntensity * 0.3 - Math.abs(normalizedY) * stretchIntensity * 0.15;
                const scaleY = 1 + Math.abs(normalizedY) * stretchIntensity * 0.3 - Math.abs(normalizedX) * stretchIntensity * 0.15;
                directionalScale = `scaleX(${Math.max(0.8, scaleX)}) scaleY(${Math.max(0.8, scaleY)})`;
            }

            const translateX = deltaX * state.elasticity * 0.1 * fadeInFactor;
            const translateY = deltaY * state.elasticity * 0.1 * fadeInFactor;
            const activeScale = state.isActive ? 'scale(0.96)' : directionalScale;
            fab.style.transform = `translateX(-50%) translate(${translateX}px, ${translateY}px) ${activeScale}`;
        };

        document.addEventListener('mousemove', function(e) {
            state.globalMousePos = { x: e.clientX, y: e.clientY };
            updateTransform();
        });

        toggleBtn.addEventListener('mousedown', function() {
            state.isActive = true;
            updateTransform();
        });

        toggleBtn.addEventListener('mouseup', function() {
            state.isActive = false;
            updateTransform();
        });

        toggleBtn.addEventListener('mouseleave', function() {
            state.isActive = false;
            updateTransform();
        });

        updateTransform();
    }

    function ensureRefractionFilter() {
        const existing = document.getElementById('comments-refraction-filter');
        if (existing) return 'comments-refraction-filter';

        const mapUrl = generateDisplacementMap(128, 128);
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('aria-hidden', 'true');
        svg.style.position = 'absolute';
        svg.style.width = '1px';
        svg.style.height = '1px';
        svg.style.overflow = 'hidden';
        svg.style.opacity = '0';
        svg.style.pointerEvents = 'none';
        svg.innerHTML = `
            <defs>
                <filter id="comments-refraction-filter" x="-35%" y="-35%" width="170%" height="170%" color-interpolation-filters="sRGB">
                    <feImage x="0" y="0" width="100%" height="100%" result="DISPLACEMENT_MAP" href="${mapUrl}" preserveAspectRatio="xMidYMid slice"></feImage>
                    <feColorMatrix in="DISPLACEMENT_MAP" type="matrix" values="0.3 0.3 0.3 0 0 0.3 0.3 0.3 0 0 0.3 0.3 0.3 0 0 0 0 0 1 0" result="EDGE_INTENSITY"></feColorMatrix>
                    <feComponentTransfer in="EDGE_INTENSITY" result="EDGE_MASK">
                        <feFuncA type="discrete" tableValues="0 0.1 1"></feFuncA>
                    </feComponentTransfer>
                    <feOffset in="SourceGraphic" dx="0" dy="0" result="CENTER_ORIGINAL"></feOffset>
                    <feDisplacementMap in="SourceGraphic" in2="DISPLACEMENT_MAP" scale="-70" xChannelSelector="R" yChannelSelector="B" result="RED_DISPLACED"></feDisplacementMap>
                    <feColorMatrix in="RED_DISPLACED" type="matrix" values="1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0" result="RED_CHANNEL"></feColorMatrix>
                    <feDisplacementMap in="SourceGraphic" in2="DISPLACEMENT_MAP" scale="-63" xChannelSelector="R" yChannelSelector="B" result="GREEN_DISPLACED"></feDisplacementMap>
                    <feColorMatrix in="GREEN_DISPLACED" type="matrix" values="0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0" result="GREEN_CHANNEL"></feColorMatrix>
                    <feDisplacementMap in="SourceGraphic" in2="DISPLACEMENT_MAP" scale="-56" xChannelSelector="R" yChannelSelector="B" result="BLUE_DISPLACED"></feDisplacementMap>
                    <feColorMatrix in="BLUE_DISPLACED" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0" result="BLUE_CHANNEL"></feColorMatrix>
                    <feBlend in="GREEN_CHANNEL" in2="BLUE_CHANNEL" mode="screen" result="GB_COMBINED"></feBlend>
                    <feBlend in="RED_CHANNEL" in2="GB_COMBINED" mode="screen" result="RGB_COMBINED"></feBlend>
                    <feGaussianBlur in="RGB_COMBINED" stdDeviation="0.12" result="ABERRATED_SOFT"></feGaussianBlur>
                    <feComposite in="ABERRATED_SOFT" in2="EDGE_MASK" operator="in" result="EDGE_ABERRATION"></feComposite>
                    <feComponentTransfer in="EDGE_MASK" result="INVERTED_MASK">
                        <feFuncA type="table" tableValues="1 0"></feFuncA>
                    </feComponentTransfer>
                    <feComposite in="CENTER_ORIGINAL" in2="INVERTED_MASK" operator="in" result="CENTER_CLEAN"></feComposite>
                    <feComposite in="EDGE_ABERRATION" in2="CENTER_CLEAN" operator="over"></feComposite>
                </filter>
            </defs>
        `;
        document.body.appendChild(svg);
        return 'comments-refraction-filter';
    }

    function generateDisplacementMap(width, height) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) return '';

        const smoothStep = function(a, b, t) {
            const x = Math.max(0, Math.min(1, (t - a) / (b - a)));
            return x * x * (3 - 2 * x);
        };

        const length2d = function(x, y) {
            return Math.sqrt(x * x + y * y);
        };

        const roundedRectSDF = function(x, y, w, h, radius) {
            const qx = Math.abs(x) - w + radius;
            const qy = Math.abs(y) - h + radius;
            return Math.min(Math.max(qx, qy), 0) + length2d(Math.max(qx, 0), Math.max(qy, 0)) - radius;
        };

        let maxScale = 0;
        const rawValues = [];
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const uvx = x / width;
                const uvy = y / height;
                const ix = uvx - 0.5;
                const iy = uvy - 0.5;
                const distanceToEdge = roundedRectSDF(ix, iy, 0.3, 0.2, 0.6);
                const displacement = smoothStep(0.8, 0, distanceToEdge - 0.15);
                const scaled = smoothStep(0, 1, displacement);
                const posX = ix * scaled + 0.5;
                const posY = iy * scaled + 0.5;
                const dx = posX * width - x;
                const dy = posY * height - y;
                maxScale = Math.max(maxScale, Math.abs(dx), Math.abs(dy));
                rawValues.push(dx, dy);
            }
        }

        maxScale = maxScale > 0 ? Math.max(maxScale, 1) : 1;
        const imageData = context.createImageData(width, height);
        const data = imageData.data;
        let rawIndex = 0;
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const dx = rawValues[rawIndex++];
                const dy = rawValues[rawIndex++];
                const edgeDistance = Math.min(x, y, width - x - 1, height - y - 1);
                const edgeFactor = Math.min(1, edgeDistance / 2);
                const smoothedDx = dx * edgeFactor;
                const smoothedDy = dy * edgeFactor;
                const r = smoothedDx / maxScale + 0.5;
                const g = smoothedDy / maxScale + 0.5;
                const pixelIndex = (y * width + x) * 4;
                data[pixelIndex] = Math.max(0, Math.min(255, r * 255));
                data[pixelIndex + 1] = Math.max(0, Math.min(255, g * 255));
                data[pixelIndex + 2] = Math.max(0, Math.min(255, g * 255));
                data[pixelIndex + 3] = 255;
            }
        }

        context.putImageData(imageData, 0, 0);
        return canvas.toDataURL();
    }

    /**
     * Open comments modal
     */
    function openCommentsModal() {
        const toggleBtn = document.getElementById('comments-toggle-btn');
        const commentsOverlay = document.getElementById('comments-overlay');

        if (commentsOverlay) {
            commentsOverlay.classList.add('show');
            // Use padding-right to prevent layout shift instead of overflow:hidden
            preventBodyScroll();
        }

        if (toggleBtn) {
            toggleBtn.classList.add('active');
        }

        // Load Cusdis if not already loaded
        loadCusdisScript();
    }

    /**
     * Close comments modal
     */
    function closeCommentsModal() {
        const toggleBtn = document.getElementById('comments-toggle-btn');
        const commentsOverlay = document.getElementById('comments-overlay');

        if (commentsOverlay) {
            commentsOverlay.classList.remove('show');
            restoreBodyScroll();
        }

        if (toggleBtn) {
            toggleBtn.classList.remove('active');
        }
    }

    let scrollY = 0;

    /**
     * Prevent body scroll without layout shift
     */
    function preventBodyScroll() {
        scrollY = window.scrollY;
        const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
        document.body.style.position = 'fixed';
        document.body.style.top = `-${scrollY}px`;
        document.body.style.left = '0';
        document.body.style.right = '0';
        document.body.style.paddingRight = `${scrollbarWidth}px`;
    }

    /**
     * Restore body scroll
     */
    function restoreBodyScroll() {
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.left = '';
        document.body.style.right = '';
        document.body.style.paddingRight = '';
        window.scrollTo(0, scrollY);
    }

    /**
     * Initialize modal close functionality
     */
    function initModalClose() {
        const commentsOverlay = document.getElementById('comments-overlay');
        const closeBtn = document.getElementById('comments-modal-close');

        // Close on backdrop click
        if (commentsOverlay) {
            if (commentsOverlay.dataset.commentsOverlayBound !== '1') {
                commentsOverlay.dataset.commentsOverlayBound = '1';
                commentsOverlay.addEventListener('click', function(e) {
                    if (e.target === commentsOverlay) {
                        closeCommentsModal();
                    }
                });
            }
        }

        // Close on close button click
        if (closeBtn) {
            if (closeBtn.dataset.commentsCloseBound !== '1') {
                closeBtn.dataset.commentsCloseBound = '1';
                closeBtn.addEventListener('click', closeCommentsModal);
            }
        }

        // Close on Escape key
        if (document.body.dataset.commentsEscapeBound !== '1') {
            document.body.dataset.commentsEscapeBound = '1';
            document.addEventListener('keydown', function(e) {
                if (e.key === 'Escape') {
                    closeCommentsModal();
                }
            });
        }
    }

    /**
     * Load Cusdis script dynamically
     */
    function loadCusdisScript() {
        // Check if script is already loaded
        if (document.querySelector('script[src="https://cusdis.com/js/cusdis.es.js"]')) {
            return;
        }

        const script = document.createElement('script');
        script.async = true;
        script.defer = true;
        script.src = 'https://cusdis.com/js/cusdis.es.js';
        document.body.appendChild(script);
    }

    /**
     * Sync Cusdis theme with current page theme
     */
    function initCusdisThemeSync() {
        // Listen for theme changes
        const themeToggle = document.getElementById('theme-toggle');
        if (themeToggle) {
            if (themeToggle.dataset.commentsThemeBound !== '1') {
                themeToggle.dataset.commentsThemeBound = '1';
                themeToggle.addEventListener('click', function() {
                    // Small delay to allow theme class to be applied
                    setTimeout(updateCusdisTheme, 100);
                });
            }
        }

        // Initial theme sync
        updateCusdisTheme();
    }

    /**
     * Update Cusdis iframe theme based on current page theme
     */
    function updateCusdisTheme() {
        const cusdisThread = document.getElementById('cusdis_thread');
        if (!cusdisThread) return;

        const isLightTheme = document.body.classList.contains('light-theme');

        // Set theme attribute for Cusdis
        if (isLightTheme) {
            cusdisThread.setAttribute('data-theme', 'light');
        } else {
            cusdisThread.setAttribute('data-theme', 'dark');
        }

        // Try to update iframe if it exists
        const iframe = cusdisThread.querySelector('iframe');
        if (iframe && iframe.contentWindow) {
            try {
                iframe.contentWindow.postMessage({
                    from: 'cusdis',
                    event: 'setTheme',
                    data: isLightTheme ? 'light' : 'dark'
                }, '*');
            } catch (e) {
                // Silent fail if iframe not accessible
            }
        }
    }

    // Expose functions globally
    window.updateCusdisTheme = updateCusdisTheme;
    window.openCommentsModal = openCommentsModal;
    window.closeCommentsModal = closeCommentsModal;
})();
