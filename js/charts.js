(function() {
    'use strict';

    var trainingData = null;
    var chartInstances = {};
    var modalChartInstance = null;
    var chartLibraryPromise = null;

    function getCurrentLang() {
        return localStorage.getItem('lang') || 'zh';
    }

    function getThemeColors() {
        var isBlue = document.documentElement.classList.contains('blue-theme');
        var isLight = document.documentElement.classList.contains('light-theme');
        if (isBlue) {
            return { textColor: '#dce8ff', gridColor: '#29405f', bgColor: '#121c2f' };
        }
        if (isLight) {
            return { textColor: '#333', gridColor: '#eee', bgColor: '#ffffff' };
        }
        return { textColor: '#e0e0e0', gridColor: '#444', bgColor: '#2a2a2a' };
    }

    function getChartTitles() {
        var lang = getCurrentLang();
        if (lang === 'zh') {
            return { lossCurve: 'Loss 曲线', loss: '损失', ppl: '困惑度', lr: '学习率', tokS: '吞吐量', step: '步骤' };
        }
        return { lossCurve: 'Loss Curve', loss: 'Loss', ppl: 'Perplexity', lr: 'Learning Rate', tokS: 'Throughput', step: 'Step' };
    }

    function openChartModal(chartType) {
        var modal = document.getElementById('chartModal');
        var modalCanvas = document.getElementById('modalChart');
        if (!trainingData || !modal) return;

        if (modalChartInstance) modalChartInstance.destroy();

        var colors = getThemeColors();
        var titles = getChartTitles();

        var config = {
            type: 'line',
            data: { labels: trainingData.steps, datasets: [] },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { intersect: false, mode: 'index' },
                plugins: { legend: { display: false }, title: { display: true, text: '', color: colors.textColor, font: { size: 18 } } },
                scales: {
                    x: { title: { display: true, text: titles.step, color: colors.textColor }, ticks: { color: colors.textColor, maxTicksLimit: 15 }, grid: { color: colors.gridColor } },
                    y: { title: { display: true, text: '', color: colors.textColor }, ticks: { color: colors.textColor }, grid: { color: colors.gridColor } }
                }
            }
        };

        var datasetMap = {
            loss: { label: titles.loss, data: trainingData.losses, borderColor: '#0066cc', backgroundColor: 'rgba(0,102,204,0.1)', title: titles.loss, yAxis: titles.loss },
            lossDetail: { label: titles.loss, data: trainingData.losses, borderColor: '#0066cc', backgroundColor: 'rgba(0,102,204,0.1)', title: titles.loss, yAxis: titles.loss },
            ppl: { label: titles.ppl, data: trainingData.ppls, borderColor: '#e74c3c', backgroundColor: 'rgba(231,76,60,0.1)', title: titles.ppl, yAxis: titles.ppl },
            lr: { label: titles.lr, data: trainingData.lrs, borderColor: '#27ae60', backgroundColor: 'rgba(39,174,96,0.1)', title: titles.lr, yAxis: titles.lr },
            toks: { label: titles.tokS, data: trainingData.tokss, borderColor: '#f39c12', backgroundColor: 'rgba(243,156,18,0.1)', title: titles.tokS, yAxis: 'tok/s' }
        };

        var ds = datasetMap[chartType];
        if (ds) {
            config.data.datasets = [{ label: ds.label, data: ds.data, borderColor: ds.borderColor, backgroundColor: ds.backgroundColor, fill: true, tension: 0.1, pointRadius: 0, pointHoverRadius: 5 }];
            config.options.plugins.title.text = ds.title;
            config.options.scales.y.title.text = ds.yAxis;
        }

        modalChartInstance = new Chart(modalCanvas, config);
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function closeChartModal() {
        var modal = document.getElementById('chartModal');
        if (modal) {
            modal.classList.remove('active');
            document.body.style.overflow = '';
        }
        if (modalChartInstance) {
            modalChartInstance.destroy();
            modalChartInstance = null;
        }
    }

    function loadChartLibrary() {
        if (typeof Chart !== 'undefined') return Promise.resolve();
        if (chartLibraryPromise) return chartLibraryPromise;

        chartLibraryPromise = new Promise(function(resolve, reject) {
            var existingScript = Array.from(document.scripts).find(function(script) {
                var src = script.getAttribute('src') || '';
                return src.indexOf('chart.umd.min.js') !== -1;
            });

            var finish = function() {
                if (typeof Chart !== 'undefined') {
                    resolve();
                } else {
                    reject(new Error('Chart.js unavailable'));
                }
            };

            if (existingScript) {
                if (existingScript.dataset.loaded === '1') {
                    finish();
                    return;
                }
                existingScript.addEventListener('load', function() {
                    existingScript.dataset.loaded = '1';
                    finish();
                }, { once: true });
                existingScript.addEventListener('error', function() {
                    reject(new Error('Failed to load Chart.js'));
                }, { once: true });
                return;
            }

            var script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js';
            script.async = true;
            script.addEventListener('load', function() {
                script.dataset.loaded = '1';
                finish();
            }, { once: true });
            script.addEventListener('error', function() {
                reject(new Error('Failed to load Chart.js'));
            }, { once: true });
            document.head.appendChild(script);
        });

        return chartLibraryPromise;
    }

    async function initTrainingCharts() {
        if (!document.getElementById('lossChart')) return;

        try {
            await loadChartLibrary();
        } catch (error) {
            console.error('Failed to load chart library:', error);
            return;
        }

        Object.values(chartInstances).forEach(function(chart) { if (chart) chart.destroy(); });
        chartInstances = {};

        try {
            if (!trainingData) {
                var response = await fetch('training_metrics_clean.csv');
                var text = await response.text();
                var lines = text.trim().split('\n');
                var headers = lines[0].split(',');
                var stepIdx = headers.indexOf('step');
                var lossIdx = headers.indexOf('loss');
                var pplIdx = headers.indexOf('ppl');
                var lrIdx = headers.indexOf('lr');
                var toksIdx = headers.indexOf('tok_s');

                var steps = [], losses = [], ppls = [], lrs = [], tokss = [];
                for (var i = 1; i < lines.length; i++) {
                    var cols = lines[i].split(',');
                    if (cols.length >= 5) {
                        steps.push(cols[stepIdx]);
                        losses.push(parseFloat(cols[lossIdx]));
                        ppls.push(parseFloat(cols[pplIdx]));
                        lrs.push(parseFloat(cols[lrIdx]));
                        tokss.push(parseFloat(cols[toksIdx]));
                    }
                }
                trainingData = { steps: steps, losses: losses, ppls: ppls, lrs: lrs, tokss: tokss };
            }

            var colors = getThemeColors();
            var titles = getChartTitles();

            function createChartConfig(label, data, color, titleText, yAxisText) {
                return {
                    type: 'line',
                    data: { labels: trainingData.steps, datasets: [{ label: label, data: data, borderColor: color, backgroundColor: color.replace(')', ',0.1)').replace('rgb', 'rgba'), fill: true, tension: 0.1, pointRadius: 0, pointHoverRadius: 4 }] },
                    options: {
                        responsive: true,
                        interaction: { intersect: false, mode: 'index' },
                        plugins: { legend: { display: false }, title: { display: true, text: titleText, color: colors.textColor } },
                        scales: {
                            x: { title: { display: true, text: titles.step, color: colors.textColor }, ticks: { color: colors.textColor, maxTicksLimit: 10 }, grid: { color: colors.gridColor } },
                            y: { title: { display: true, text: yAxisText, color: colors.textColor }, ticks: { color: colors.textColor }, grid: { color: colors.gridColor } }
                        }
                    }
                };
            }

            var lossCtx = document.getElementById('lossChart');
            if (lossCtx) {
                chartInstances.loss = new Chart(lossCtx, createChartConfig(titles.loss, trainingData.losses, '#0066cc', titles.lossCurve, titles.loss));
                lossCtx.closest('.chart-container').onclick = function() { openChartModal('loss'); };
            }

            var lossDetailCtx = document.getElementById('lossDetailChart');
            if (lossDetailCtx) {
                var cfg = createChartConfig(titles.loss, trainingData.losses, '#0066cc', titles.loss, titles.loss);
                cfg.options.scales.x.ticks.maxTicksLimit = 6;
                chartInstances.lossDetail = new Chart(lossDetailCtx, cfg);
                lossDetailCtx.closest('.chart-item').onclick = function() { openChartModal('lossDetail'); };
            }

            var pplCtx = document.getElementById('pplChart');
            if (pplCtx) {
                var cfg2 = createChartConfig(titles.ppl, trainingData.ppls, '#e74c3c', titles.ppl, titles.ppl);
                cfg2.options.scales.x.ticks.maxTicksLimit = 6;
                chartInstances.ppl = new Chart(pplCtx, cfg2);
                pplCtx.closest('.chart-item').onclick = function() { openChartModal('ppl'); };
            }

            var lrCtx = document.getElementById('lrChart');
            if (lrCtx) {
                var cfg3 = createChartConfig(titles.lr, trainingData.lrs, '#27ae60', titles.lr, titles.lr);
                cfg3.options.scales.x.ticks.maxTicksLimit = 6;
                chartInstances.lr = new Chart(lrCtx, cfg3);
                lrCtx.closest('.chart-item').onclick = function() { openChartModal('lr'); };
            }

            var toksCtx = document.getElementById('toksChart');
            if (toksCtx) {
                var cfg4 = createChartConfig('tok/s', trainingData.tokss, '#f39c12', titles.tokS, 'tok/s');
                cfg4.options.scales.x.ticks.maxTicksLimit = 6;
                chartInstances.toks = new Chart(toksCtx, cfg4);
                toksCtx.closest('.chart-item').onclick = function() { openChartModal('toks'); };
            }

        } catch (e) {
            console.error('Failed to load training metrics:', e);
        }
    }

    // Modal event listeners
    document.addEventListener('click', function(e) {
        if (e.target === document.getElementById('chartModal')) closeChartModal();
    });
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') closeChartModal();
    });

    // Init on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initTrainingCharts);
    } else {
        initTrainingCharts();
    }

    // Re-init on language/theme change
    window.addEventListener('languageChanged', function() { setTimeout(initTrainingCharts, 100); });
    var observer = new MutationObserver(function(mutations) {
        mutations.forEach(function(mutation) {
            if (mutation.attributeName === 'class') setTimeout(initTrainingCharts, 100);
        });
    });
    observer.observe(document.documentElement, { attributes: true });

    // Expose for inline onclick
    window.openChartModal = openChartModal;
    window.closeChartModal = closeChartModal;
    window.initTrainingCharts = initTrainingCharts;
})();
