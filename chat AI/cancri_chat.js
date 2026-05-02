    const state = {
      theme: 'light',
      contrast: '系统',
      accentName: '绿色',
      accentValue: '#10a37f',
      language: '自动检测',
      speech: '自动检测',
      currentView: 'home',
      modal: null,
      popover: null,
      mfaVisible: true,
      isStreaming: false,
      isImageGenerating: false,
      activeRequestController: null,
      recentProjectName: '',
      homeMode: 'chat',
    };

    const root = document.documentElement;
    const sidebar = document.getElementById('sidebar');
    const scrim = document.getElementById('scrim');
    const toast = document.getElementById('toast');
    const pageWatermarkGrid = document.getElementById('pageWatermarkGrid');
    const customContextMenu = document.getElementById('customContextMenu');
    const devtoolsShield = document.getElementById('devtoolsShield');
    const homeView = document.getElementById('homeView');
    const imagesView = document.getElementById('imagesView');
    const heroTitle = document.getElementById('heroTitle');
    const homeInput = document.getElementById('homeInput');
    const sendChatBtn = document.getElementById('sendChatBtn');
    const chatMessages = document.getElementById('chatMessages');
    const homeCenter = document.getElementById('homeCenter');
    const imagePromptInput = document.getElementById('imagePromptInput');
    const sendImagePromptBtn = document.getElementById('sendImagePromptBtn');
    const generatedImageGrid = document.getElementById('generatedImageGrid');
    const imageGenerationStatus = document.getElementById('imageGenerationStatus');
    const attachBtn = document.getElementById('attachBtn');
    const attachmentInput = document.getElementById('attachmentInput');
    const modelSelector = document.getElementById('modelSelector');
    const modelCurrentBtn = document.getElementById('modelCurrentBtn');
    const modelDropdown = document.getElementById('modelDropdown');
    const currentModelName = document.getElementById('currentModelName');
    const fileInput = document.getElementById('fileInput');
    const fileUploadBtn = document.getElementById('fileUploadBtn');
    const attachmentPreview = document.getElementById('attachmentPreview');
    const voiceInputBtn = document.getElementById('voiceToastBtn');
    const contextMeter = document.getElementById('contextMeter');
    const contextMeterValue = document.getElementById('contextMeterValue');
    const contextMeterText = document.getElementById('contextMeterText');
    const projectNameInput = document.getElementById('projectNameInput');
    const plusPopover = document.getElementById('plusPopover');
    const morePopover = document.getElementById('morePopover');
    const accountPopover = document.getElementById('accountPopover');
    const settingsModal = document.getElementById('settingsModal');
    const tempChatModal = document.getElementById('tempChatModal');
    const projectModal = document.getElementById('projectModal');
    const privacyPolicyModal = document.getElementById('privacyPolicyModal');
    const appearanceValue = document.getElementById('appearanceValue');
    const contrastValue = document.getElementById('contrastValue');
    const accentValueEl = document.getElementById('accentValue');
    const accentDot = document.getElementById('accentDot');
    const languageValue = document.getElementById('languageValue');
    const speechValue = document.getElementById('speechValue');
    const dismissMfaBtn = document.getElementById('dismissMfaBtn');
    const tokenExpiryNote = document.getElementById('tokenExpiryNote');
    const tokenRemainingText = document.getElementById('tokenRemainingText');
    const rateLimitNote = document.getElementById('rateLimitNote');
    const rateLimitUpdateTime = document.getElementById('rateLimitUpdateTime');
    const userRateLimit = document.getElementById('userRateLimit');
    const modelRateLimit = document.getElementById('modelRateLimit');
    const nexusvFooter = document.querySelector('.nexusv-footer');

    const navRows = Array.from(document.querySelectorAll('.nav-row[data-view-target]'));
    const settingTabs = Array.from(document.querySelectorAll('.settings-nav-item'));
    const settingPanels = Array.from(document.querySelectorAll('.settings-panel'));

    let conversationHistory = [];
    const CONTEXT_TOKEN_LIMIT = 128 * 1024;
    const CONTEXT_COMPRESSION_TRIGGER = Math.floor(CONTEXT_TOKEN_LIMIT * 0.92);
    const MAX_ATTACHMENT_COUNT = 4;
    const MAX_ATTACHMENT_SIZE = 8 * 1024 * 1024;
    const UI_PREFS_STORAGE_KEY = 'cancri_ui_prefs';
    const MODEL_TELEMETRY_STORAGE_KEY = 'cancri_model_telemetry';
    const MODEL_TELEMETRY_CACHE_VERSION = 6;

    // ModelScope API 额度信息
    let rateLimitInfo = {
      userLimit: null,
      userRemaining: null,
      userLockedUntil: null,
      userLockReason: null,
      modelLimit: null,
      modelRemaining: null,
      modelId: null,
      lastUpdateTime: null
    };
    const MODEL_LOCK_DURATION_MS = 60 * 60 * 1000;
    const MODELSCOPE_QUOTA_REFRESH_INTERVAL_MS = 60 * 60 * 1000; // 魔塔额度页面打开探测一次，后续主要跟随真实请求头更新
    const NON_MODELSCOPE_PING_INTERVAL_MS = 60 * 60 * 1000; // 非魔塔模型1小时ping一次
    const MODEL_STATUS_REFRESH_INTERVAL_MS = NON_MODELSCOPE_PING_INTERVAL_MS;
    const RATE_LIMIT_UPDATE_INTERVAL_MS = MODELSCOPE_QUOTA_REFRESH_INTERVAL_MS;
    const RATE_LIMIT_PROBE_MODEL_ID = 'deepseek-v4-flash';
    const NON_MODELSCOPE_MODEL_IDS = new Set(['kimi-k2.6', 'kimi-k2.6-moonshot', 'glm-5', 'glm-5.1-dashscope', 'glm-5.1-siliconflow', 'glm-4.7', 'qwen3.6-plus', 'qwen3.6-max-preview', 'dall-e-3', 'deepseek-v4-flash-dashscope', 'deepseek-v4-pro-dashscope', 'deepseek-v4-flash-siliconflow', 'step-3.5-flash', 'hy3-preview', 'gpt-oss-120b', 'nemotron-3-super', 'ling-2.6-1t', 'spark-x2', 'deepseek-r1', 'qwen3.6-flash', 'kimi-k2.5-dashscope', 'deepseek-v3.2', 'deepseek-v3.2-exp', 'glm-4.5-air', 'minimax-m2.5-dashscope', 'deepseek-v3.1', 'qwen3-coder-plus', 'qwen3-max', 'kimi-k2-instruct', 'qwen3.6-plus-20260402', 'deepseek-r1-0528',
      // MiMo 模型
      'mimo-v2.5-pro', 'mimo-v2.5-tts', 'mimo-v2.5-tts-voicedesign'
    ]);
    let rateLimitRefreshToken = 0;
    let nonModelscopePingTimer = null;
    let modelTelemetryLastRefreshedAt = 0;

    // 模型状态：额度和速度
    const modelStatus = new Map(); // modelId -> { quotaRemaining, quotaLimit, speedMs, speedLevel, lastChecked, error }
    const SPEED_TEST_INTERVAL_MS = NON_MODELSCOPE_PING_INTERVAL_MS;
    const QUOTA_PROBE_INTERVAL_MS = MODELSCOPE_QUOTA_REFRESH_INTERVAL_MS;

    function getModelSpeedLevel(speedMs) {
      if (speedMs === null || speedMs === undefined) return 'unknown';
      if (speedMs < 1500) return 'fast';
      if (speedMs < 4000) return 'medium';
      return 'slow';
    }

    function getFriendlyHttpStatusMessage(status) {
      switch (Number(status)) {
        case 400:
          return '这次请求模型没接住，请换个模型再试。';
        case 401:
          return '当前模型暂时无法访问，请切换其他模型再试。';
        case 403:
          return '请求触发安全风控，请放慢速度后重试。';
        case 409:
          return '当前模型有点忙，请切换其他模型再试。';
        case 429:
          return '当前模型额度已用完，请切换其他模型再试。';
        default:
          return '当前模型暂时不可用，请切换其他模型再试。';
      }
    }

    function parseBackendErrorPayload(errorText) {
      const raw = String(errorText || '').trim();
      if (!raw) return { message: '', code: '' };
      try {
        const parsed = JSON.parse(raw);
        const parsedError = parsed?.error;
        const message = typeof parsedError === 'string'
          ? parsedError
          : parsedError?.message || parsed?.message || parsed?.detail || raw;
        return {
          message,
          code: String(parsed?.code || parsedError?.code || parsed?.error || '').trim(),
          retryAfter: parsed?.retry_after_seconds,
          provider: parsed?.provider,
          missing: parsed?.missing,
        };
      } catch {
        return { message: raw, code: '' };
      }
    }

    function formatSecurityGuardMessage(payload, fallback = '请求触发安全风控，请放慢速度后重试。') {
      const code = String(payload?.code || '').trim();
      const message = String(payload?.message || '').trim();
      const retryAfter = Number(payload?.retryAfter);
      if (code === 'access_blocked') {
        return message || '检测到异常高频请求，已暂时停止为此 IP 提供服务。';
      }
      if (code === 'challenge_required') {
        const suffix = Number.isFinite(retryAfter) && retryAfter > 0 ? `（建议 ${retryAfter} 秒后重试）` : '';
        return `${message || fallback}${suffix}`;
      }
      return message || fallback;
    }

    function applyBackendModelBlock(payload, modelId = currentModel) {
      if (!payload || payload.code !== 'model_temporarily_unavailable') return false;
      const retryAfter = Number(payload.retryAfter);
      const until = Date.now() + (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : MODEL_LOCK_DURATION_MS);
      setModelQuotaLock(modelId, until, 'unavailable');
      updateModelDropdownIndicators();
      persistModelTelemetryCache();
      return true;
    }

    function getModelStatus(modelId) {
      return modelStatus.get(modelId) || { quotaRemaining: null, quotaLimit: null, speedMs: null, speedLevel: 'unknown', lastChecked: 0, error: null, lockedUntil: null, lockReason: null };
    }

    function formatModelUnavailableDebug(modelId, status = getModelStatus(modelId)) {
      const lockedUntilText = Number.isFinite(status.lockedUntil)
        ? new Date(status.lockedUntil).toLocaleString()
        : 'none';
      const lastCheckedText = Number.isFinite(status.lastChecked) && status.lastChecked > 0
        ? new Date(status.lastChecked).toLocaleString()
        : 'never';
      return `\n\n诊断: model=${modelId}; lockReason=${status.lockReason || 'none'}; lockedUntil=${lockedUntilText}; quotaRemaining=${status.quotaRemaining ?? 'unknown'}; userRemaining=${rateLimitInfo.userRemaining ?? 'unknown'}; lastChecked=${lastCheckedText}; error=${status.error || 'none'}`;
    }

    function formatBackendErrorDebug(status, detail) {
      const text = String(detail || '').replace(/\s+/g, ' ').trim().slice(0, 300);
      return `后端返回 HTTP ${status}${text ? `：${text}` : ''}`;
    }

    function parseHeaderInteger(value) {
      if (value === null || value === undefined || value === '') return null;
      const parsed = Number.parseInt(String(value), 10);
      return Number.isFinite(parsed) ? parsed : null;
    }

    function getNextLocalMidnightTimestamp(referenceTime = Date.now()) {
      const nextMidnight = new Date(referenceTime);
      nextMidnight.setHours(24, 0, 0, 0);
      return nextMidnight.getTime();
    }

    function clearExpiredQuotaLocks(now = Date.now()) {
      if (Number.isFinite(rateLimitInfo.userLockedUntil) && rateLimitInfo.userLockedUntil <= now) {
        rateLimitInfo.userLockedUntil = null;
        rateLimitInfo.userLockReason = null;
      }

      for (const [modelId, status] of modelStatus.entries()) {
        if (Number.isFinite(status.lockedUntil) && status.lockedUntil <= now) {
          status.lockedUntil = null;
          status.lockReason = null;
          status.error = null;
          modelStatus.set(modelId, status);
        }
      }
    }

    function setUserQuotaLock(untilTs, reason = 'quota') {
      rateLimitInfo.userLockedUntil = Number.isFinite(untilTs) ? untilTs : null;
      rateLimitInfo.userLockReason = reason || null;
    }

    function setModelQuotaLock(modelId, untilTs, reason = 'quota') {
      if (!modelId) return;
      const status = getModelStatus(modelId);
      status.lockedUntil = Number.isFinite(untilTs) ? untilTs : null;
      status.lockReason = reason || null;
      status.error = reason === 'quota' ? '额度已用完' : (reason || null);
      status.lastChecked = Date.now();
      modelStatus.set(modelId, normalizeModelStatusSnapshot(status));
    }

    function getQuotaLockMessage(modelId = currentModel) {
      const now = Date.now();
      if (isModelScopeModel(modelId) && Number.isFinite(rateLimitInfo.userLockedUntil) && rateLimitInfo.userLockedUntil > now) {
        return '今日魔塔用户额度已用完，请明天 0 点后再试，或先切换非魔塔模型。';
      }

      const status = getModelStatus(modelId);
      if (Number.isFinite(status.lockedUntil) && status.lockedUntil > now) {
        if (status.lockReason === 'quota') {
          return '模型额度已超，请切换模型重试。';
        }
        return '当前模型暂时不可用，请切换其他模型重试。';
      }

      return '';
    }

    function applyQuotaSnapshotFromHeaders(modelId, headers, { responseStatus = 200, errorText = '', updateCurrentRateLimitInfo = false } = {}) {
      if (!headers) return;

      clearExpiredQuotaLocks();
      const now = Date.now();
      const targetModelId = modelId || currentModel;
      const targetStatus = getModelStatus(targetModelId);
      const isScopeModel = isModelScopeModel(targetModelId);

      const userLimit = parseHeaderInteger(headers.get('modelscope-ratelimit-requests-limit') || headers.get('ModelScope-Ratelimit-Requests-Limit'));
      const userRemaining = parseHeaderInteger(headers.get('modelscope-ratelimit-requests-remaining') || headers.get('ModelScope-Ratelimit-Requests-Remaining'));
      const modelLimit = parseHeaderInteger(headers.get('modelscope-ratelimit-model-requests-limit') || headers.get('ModelScope-Ratelimit-Model-Requests-Limit'));
      const modelRemaining = parseHeaderInteger(headers.get('modelscope-ratelimit-model-requests-remaining') || headers.get('ModelScope-Ratelimit-Model-Requests-Remaining'));

      if (Number.isFinite(userLimit)) {
        rateLimitInfo.userLimit = userLimit;
      }
      if (Number.isFinite(userRemaining)) {
        rateLimitInfo.userRemaining = userRemaining;
      }

      if (updateCurrentRateLimitInfo && targetModelId === currentModel) {
        rateLimitInfo.modelId = targetModelId;
        if (Number.isFinite(modelLimit)) {
          rateLimitInfo.modelLimit = modelLimit;
        }
        if (Number.isFinite(modelRemaining)) {
          rateLimitInfo.modelRemaining = modelRemaining;
        }
      }

      if (isScopeModel) {
        if (Number.isFinite(userRemaining)) {
          if (userRemaining <= 0) {
            const until = getNextLocalMidnightTimestamp(now);
            setUserQuotaLock(until, 'quota');
            for (const scopeModelId of Object.keys(MODEL_IDS).filter(isModelScopeModel)) {
              const scopeStatus = getModelStatus(scopeModelId);
              scopeStatus.lockedUntil = until;
              scopeStatus.lockReason = 'quota';
              scopeStatus.error = '额度已用完';
              scopeStatus.lastChecked = now;
              modelStatus.set(scopeModelId, normalizeModelStatusSnapshot(scopeStatus));
            }
          } else if (Number.isFinite(rateLimitInfo.userLockedUntil) && rateLimitInfo.userLockedUntil > now) {
            rateLimitInfo.userLockedUntil = null;
            rateLimitInfo.userLockReason = null;
          }
        }

        if (Number.isFinite(modelRemaining)) {
          if (modelRemaining <= 0) {
            const until = getNextLocalMidnightTimestamp(now);
            targetStatus.lockedUntil = until;
            targetStatus.lockReason = 'quota';
            targetStatus.error = '额度已用完';
          } else if (Number.isFinite(targetStatus.lockedUntil) && targetStatus.lockedUntil > now && targetStatus.lockReason === 'quota') {
            targetStatus.lockedUntil = null;
            targetStatus.lockReason = null;
            targetStatus.error = null;
          }
          targetStatus.quotaLimit = Number.isFinite(modelLimit) ? modelLimit : targetStatus.quotaLimit;
          targetStatus.quotaRemaining = modelRemaining;
        } else if (responseStatus === 429 || /额度|quota|limit/i.test(errorText)) {
          const until = getNextLocalMidnightTimestamp(now);
          targetStatus.lockedUntil = until;
          targetStatus.lockReason = 'quota';
          targetStatus.error = '额度已用完';
        } else if (responseStatus === 401 || responseStatus === 409) {
          targetStatus.error = getFriendlyHttpStatusMessage(responseStatus);
        } else if (responseStatus >= 200 && responseStatus < 300 && !targetStatus.lockReason) {
          targetStatus.error = null;
        }
      } else {
        if (targetModelId === currentModel) {
          rateLimitInfo.modelLimit = null;
          rateLimitInfo.modelRemaining = null;
          rateLimitInfo.modelId = null;
        }

        if (responseStatus === 429 || /额度|quota|limit/i.test(errorText)) {
          const until = Date.now() + MODEL_LOCK_DURATION_MS;
          targetStatus.lockedUntil = until;
          targetStatus.lockReason = 'quota';
          targetStatus.error = '额度已用完';
        } else if (responseStatus === 401 || responseStatus === 409) {
          targetStatus.error = getFriendlyHttpStatusMessage(responseStatus);
        } else if (responseStatus >= 200 && responseStatus < 300 && !targetStatus.lockReason) {
          targetStatus.error = null;
        }
      }

      targetStatus.lastChecked = now;
      modelStatus.set(targetModelId, normalizeModelStatusSnapshot(targetStatus));
      rateLimitInfo.lastUpdateTime = now;

      if (targetModelId === currentModel) {
        updateRateLimitNote();
      }
    }

    function isTelemetryFresh(lastChecked) {
      return Number.isFinite(lastChecked) && (Date.now() - lastChecked) < MODEL_STATUS_REFRESH_INTERVAL_MS;
    }

    function normalizeModelStatusSnapshot(status = {}) {
      const quotaRemaining = Number.isFinite(status.quotaRemaining) ? status.quotaRemaining : null;
      const quotaLimit = Number.isFinite(status.quotaLimit) ? status.quotaLimit : null;
      const speedMs = Number.isFinite(status.speedMs) ? status.speedMs : null;
      const speedLevel = typeof status.speedLevel === 'string' && status.speedLevel ? status.speedLevel : getModelSpeedLevel(speedMs);
      const lastChecked = Number.isFinite(status.lastChecked) ? status.lastChecked : 0;
      const error = status.error ? String(status.error) : null;
      const lockedUntil = Number.isFinite(status.lockedUntil) ? status.lockedUntil : null;
      const lockReason = typeof status.lockReason === 'string' && status.lockReason ? status.lockReason : null;
      return { quotaRemaining, quotaLimit, speedMs, speedLevel, lastChecked, error, lockedUntil, lockReason };
    }

    function readModelTelemetryCache() {
      try {
        const raw = localStorage.getItem(MODEL_TELEMETRY_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;
        if (parsed.version !== MODEL_TELEMETRY_CACHE_VERSION) {
          localStorage.removeItem(MODEL_TELEMETRY_STORAGE_KEY);
          return null;
        }
        return parsed;
      } catch (error) {
        return null;
      }
    }

    function persistModelTelemetryCache() {
      try {
        const snapshot = {
          version: MODEL_TELEMETRY_CACHE_VERSION,
          refreshedAt: modelTelemetryLastRefreshedAt || 0,
          persistedAt: Date.now(),
          rateLimitInfo: { ...rateLimitInfo },
          modelStatus: Array.from(modelStatus.entries())
            .filter(([modelId]) => Boolean(MODEL_IDS[modelId]))
            .map(([modelId, status]) => [modelId, normalizeModelStatusSnapshot(status)]),
        };
        localStorage.setItem(MODEL_TELEMETRY_STORAGE_KEY, JSON.stringify(snapshot));
      } catch (error) {
        // 本地缓存失败不影响主流程
      }
    }

    function applyModelTelemetryCache(cache) {
      if (!cache || typeof cache !== 'object') return false;
      if (cache.version !== MODEL_TELEMETRY_CACHE_VERSION) return false;

      const nextRateLimitInfo = cache.rateLimitInfo && typeof cache.rateLimitInfo === 'object' ? cache.rateLimitInfo : {};
      rateLimitInfo.userLimit = Number.isFinite(nextRateLimitInfo.userLimit) ? nextRateLimitInfo.userLimit : null;
      rateLimitInfo.userRemaining = Number.isFinite(nextRateLimitInfo.userRemaining) ? nextRateLimitInfo.userRemaining : null;
      rateLimitInfo.userLockedUntil = Number.isFinite(nextRateLimitInfo.userLockedUntil) ? nextRateLimitInfo.userLockedUntil : null;
      rateLimitInfo.userLockReason = typeof nextRateLimitInfo.userLockReason === 'string' ? nextRateLimitInfo.userLockReason : null;
      rateLimitInfo.modelLimit = Number.isFinite(nextRateLimitInfo.modelLimit) ? nextRateLimitInfo.modelLimit : null;
      rateLimitInfo.modelRemaining = Number.isFinite(nextRateLimitInfo.modelRemaining) ? nextRateLimitInfo.modelRemaining : null;
      rateLimitInfo.modelId = typeof nextRateLimitInfo.modelId === 'string' ? nextRateLimitInfo.modelId : null;
      rateLimitInfo.lastUpdateTime = Number.isFinite(nextRateLimitInfo.lastUpdateTime) ? nextRateLimitInfo.lastUpdateTime : null;

      modelStatus.clear();
      if (Array.isArray(cache.modelStatus)) {
        for (const entry of cache.modelStatus) {
          const [modelId, status] = Array.isArray(entry) ? entry : [];
          if (!modelId || !MODEL_IDS[modelId]) continue;
          const snapshot = normalizeModelStatusSnapshot(status);
          if (!isModelScopeModel(modelId)) {
            snapshot.error = null;
            snapshot.lockedUntil = null;
            snapshot.lockReason = null;
          }
          modelStatus.set(modelId, snapshot);
        }
      }

      updateRateLimitNote();
      updateModelDropdownIndicators();
      return true;
    }

    function scheduleNonModelscopePingRefresh(delayMs) {
      if (nonModelscopePingTimer) {
        clearTimeout(nonModelscopePingTimer);
        nonModelscopePingTimer = null;
      }

      nonModelscopePingTimer = setTimeout(() => {
        refreshNonModelscopePing()
          .catch(() => {})
          .finally(() => {
            scheduleNonModelscopePingRefresh(NON_MODELSCOPE_PING_INTERVAL_MS);
          });
      }, Math.max(0, delayMs));
    }

    async function refreshModelscopeQuota() {
      await refreshRateLimitForCurrentModel(true);
      modelTelemetryLastRefreshedAt = Date.now();
      persistModelTelemetryCache();
    }

    async function refreshNonModelscopePing() {
      const nonModelscopeIds = Object.keys(MODEL_IDS).filter(id => !isModelScopeModel(id));
      const promises = nonModelscopeIds.map(async (modelId) => {
        const result = await pingModel(modelId);
        const status = getModelStatus(modelId);
        status.speedMs = result.speedMs;
        status.speedLevel = result.ok ? getModelSpeedLevel(result.speedMs) : 'error';
        if (!result.ok) {
          status.error = result.error;
          if (result.shouldLock) {
            status.lockedUntil = Date.now() + MODEL_LOCK_DURATION_MS;
            status.lockReason = 'unavailable';
          } else {
            status.lockedUntil = null;
            status.lockReason = null;
          }
        } else {
          status.error = null;
          status.lockedUntil = null;
          status.lockReason = null;
        }
        status.lastChecked = Date.now();
        modelStatus.set(modelId, normalizeModelStatusSnapshot(status));
      });
      await Promise.allSettled(promises);
      updateModelDropdownIndicators();
      updateRateLimitNote();
      persistModelTelemetryCache();
    }

    async function bootstrapModelTelemetry() {
      const cache = readModelTelemetryCache();
      if (cache) {
        modelTelemetryLastRefreshedAt = Number.isFinite(cache.refreshedAt) ? cache.refreshedAt : 0;
        applyModelTelemetryCache(cache);
      } else {
        updateRateLimitNote();
        updateModelDropdownIndicators();
      }

      // 页面打开时刷新一次，后续主要跟随真实请求头更新
      await Promise.allSettled([
        refreshModelscopeQuota(),
        refreshNonModelscopePing(),
      ]);
      autoSwitchIfCurrentModelUnavailable();
      scheduleNonModelscopePingRefresh(NON_MODELSCOPE_PING_INTERVAL_MS);
    }

    function isModelAvailable(modelId) {
      clearExpiredQuotaLocks();
      const now = Date.now();

      if (isModelScopeModel(modelId)) {
        if (Number.isFinite(rateLimitInfo.userLockedUntil) && rateLimitInfo.userLockedUntil > now) {
          return false;
        }
        const status = getModelStatus(modelId);
        if (Number.isFinite(status.lockedUntil) && status.lockedUntil > now) return false;
        if (!isTelemetryFresh(status.lastChecked)) return true;
        if (status.quotaRemaining !== null && status.quotaRemaining <= 0) return false;
        return true;
      }

      // 非魔塔模型：看锁定状态，未锁定则可用
      const status = getModelStatus(modelId);
      if (Number.isFinite(status.lockedUntil) && status.lockedUntil > now) return false;
      return true;
    }

    async function pingModel(modelId) {
      const start = performance.now();
      try {
        const probeModel = MODEL_IDS[modelId] || modelId;
        const probeEndpoint = getModelProbeEndpoint(modelId);

        const response = await fetch(EDGE_FUNCTION_URL, {
          method: 'POST',
          headers: proxyHeaders(),
          body: JSON.stringify({
            endpoint: 'ping',
            model: probeModel,
            probe_endpoint: probeEndpoint,
          })
        });

        const payload = await response.json().catch(() => null);
        const latencyMs = Number.isFinite(payload?.latencyMs)
          ? Number(payload.latencyMs)
          : performance.now() - start;

        if (!response.ok) {
          const errText = String(payload?.error || payload?.message || '').trim();
          const friendly = getFriendlyHttpStatusMessage(payload?.status || response.status);
          return { ok: false, speedMs: latencyMs, error: errText ? `${friendly}（${errText.slice(0, 80)}）` : friendly, shouldLock: false };
        }

        if (payload?.ok === false) {
          const errText = String(payload?.error || payload?.message || '').trim();
          const friendly = getFriendlyHttpStatusMessage(payload?.status || response.status);
          return { ok: false, speedMs: latencyMs, error: errText ? `${friendly}（${errText.slice(0, 80)}）` : friendly, shouldLock: true };
        }

        return { ok: true, speedMs: latencyMs, shouldLock: false };
      } catch (error) {
        return { ok: false, speedMs: performance.now() - start, error: error.name === 'AbortError' ? '超时' : String(error.message || error).slice(0, 80), shouldLock: false };
      }
    }



    function autoSwitchIfCurrentModelUnavailable() {
      if (isModelAvailable(currentModel)) return;
      const availableModels = Object.keys(MODEL_IDS).filter(id => id !== currentModel && isModelAvailable(id));
      if (availableModels.length === 0) {
        showToast('当前模型额度已用完，且暂无其他可用模型，请稍后重试。');
        return;
      }
      // 优先选择速度快的模型
      const sorted = availableModels.sort((a, b) => {
        const sa = getModelStatus(a).speedMs ?? Infinity;
        const sb = getModelStatus(b).speedMs ?? Infinity;
        return sa - sb;
      });
      const fallback = sorted[0];
      showToast(`${getModelDisplayName(currentModel)} 额度已用完，已自动切换至 ${getModelDisplayName(fallback)}`);
      setModel(fallback);
    }

    function updateModelDropdownIndicators() {
      if (!modelDropdown) return;
      clearExpiredQuotaLocks();
      modelDropdown.querySelectorAll('.model-option').forEach(opt => {
        const modelId = opt.dataset.model;
        const status = getModelStatus(modelId);

        // 速度指示器
        let speedDot = opt.querySelector('.model-speed-dot');
        if (!speedDot) {
          speedDot = document.createElement('span');
          speedDot.className = 'model-speed-dot';
          opt.insertBefore(speedDot, opt.firstChild);
        }
        speedDot.className = 'model-speed-dot speed-' + (status.speedLevel || 'unknown');
        if (status.speedLevel === 'fast') speedDot.title = `速度快 (${Math.round(status.speedMs)}ms)`;
        else if (status.speedLevel === 'medium') speedDot.title = `速度中等 (${Math.round(status.speedMs)}ms)`;
        else if (status.speedLevel === 'slow') speedDot.title = `速度较慢 (${Math.round(status.speedMs)}ms)`;
        else speedDot.title = '速度未测试';

        // 禁用状态
        if (!isModelAvailable(modelId)) {
          opt.classList.add('disabled');
          opt.title = getQuotaLockMessage(modelId) || status.error || '该模型当前不可用（额度已用完或请求失败）';
        } else {
          opt.classList.remove('disabled');
          opt.title = status.error && status.error !== '额度已用完' ? status.error : '';
        }
      });
    }

    function isModelScopeModel(modelId = currentModel) {
      return !NON_MODELSCOPE_MODEL_IDS.has(modelId);
    }

    function getRateLimitRequestModelId(modelId = currentModel) {
      if (modelId === 'kimi-k2.6-moonshot') {
        return MODEL_IDS[modelId] || modelId;
      }
      if (isModelScopeModel(modelId)) {
        return MODEL_IDS[modelId] || modelId;
      }
      return MODEL_IDS[RATE_LIMIT_PROBE_MODEL_ID] || RATE_LIMIT_PROBE_MODEL_ID;
    }

    function getModelProbeEndpoint(modelId = currentModel) {
      return modelId === 'dall-e-3' ? 'image' : 'chat';
    }

    // 全局错误捕获
    window.addEventListener('error', event => {
      console.error('[Global Error]', event.error || event.message);
    });
    window.addEventListener('unhandledrejection', event => {
      console.error('[Unhandled Promise Rejection]', event.reason);
    });

    // 安全事件绑定函数
    function on(id, event, handler) {
      const el = document.getElementById(id);
      if (!el) {
        console.warn(`[missing element] #${id}`);
        return;
      }
      el.addEventListener(event, handler);
    }

    const MODEL_SELECTION_MIGRATIONS = {
      'deepseek-v4-flash-dashscope': 'deepseek-v4-flash',
    };
    const savedModelSelection = localStorage.getItem('cancri_current_model') || 'deepseek-v4-flash';
    let currentModel = MODEL_SELECTION_MIGRATIONS[savedModelSelection] || savedModelSelection;
    if (currentModel !== savedModelSelection) {
      localStorage.setItem('cancri_current_model', currentModel);
    }
    const MULTIMODAL_MODEL_IDS = new Set(['qwen3.5', 'kimi-k2.5', 'qwen3.6-plus', 'qwen3-coder', 'kimi-k2.6', 'kimi-k2.6-moonshot', 'qwen3.6-flash', 'kimi-k2.5-dashscope', 'qwen3-coder-plus', 'qwen3-max', 'kimi-k2-instruct', 'qwen3.6-plus-20260402']);

    function isMultimodalModel(modelId) {
      return MULTIMODAL_MODEL_IDS.has(modelId);
    }

    let isMultimodal = isMultimodalModel(currentModel);

    const MODEL_IDS = {
      'deepseek-v4-flash': 'deepseek-ai/DeepSeek-V4-Flash',
      'deepseek-v4-flash-dashscope': 'deepseek-v4-flash',
      'deepseek-v4-flash-siliconflow': 'deepseek-ai/DeepSeek-V4-Flash',
      'deepseek-v4-pro': 'deepseek-ai/DeepSeek-V4-Pro',
      'deepseek-v4-pro-dashscope': 'deepseek-v4-pro-dashscope',
      'step-3.5-flash': 'stepfun-ai/Step-3.5-Flash',
      'hy3-preview': 'tencent/hy3-preview:free',
      'gpt-oss-120b': 'openai/gpt-oss-120b:free',
      'gpt-5.4': 'gpt-5.4',
      'claude-opus-4.6': 'claude-opus-4.6',
      'claude-sonnet-4.6': 'claude-sonnet-4.6',
      'gemini-2.5-pro': 'gemini-2.5-pro',
      'nemotron-3-super': 'nvidia/nemotron-3-super-120b-a12b:free',
      'ling-2.6-1t': 'inclusionai/ling-2.6-1t:free',
      'ling-2.6-1t-modelscope': 'inclusionAI/Ling-2.6-1T',
      'spark-x2': 'spark-x',
      'qwen3.5': 'Qwen/Qwen3.5-397B-A17B',
      'qwen3-coder': 'Qwen/Qwen3-Coder-480B-A35B-Instruct',
      'kimi-k2.5': 'moonshotai/Kimi-K2.5',
      'kimi-k2.6': 'kimi-k2.6',
      'kimi-k2.6-moonshot': 'kimi-k2.6',
      'glm-5': 'glm-5',
      'glm-5.1': 'ZhipuAI/GLM-5.1',
      'glm-5.1-dashscope': 'glm-5.1',
      'glm-5.1-siliconflow': 'zai-org/GLM-5.1',
      'glm-4.7': 'ZhipuAI/glm-4.7',
      'deepseek-r1': 'deepseek-ai/DeepSeek-R1-0528',
      'minimax-m2.5': 'MiniMax/MiniMax-M2.5',
      'qwen3.6-max-preview': 'qwen3.6-max-preview',
      'qwen3.6-plus': 'qwen3.6-plus',
      // 百炼新增模型
      'deepseek-r1': 'deepseek-r1',
      'qwen3.6-flash': 'qwen3.6-flash',
      'kimi-k2.5-dashscope': 'kimi-k2.5',
      'deepseek-v3.2': 'deepseek-v3.2',
      'deepseek-v3.2-exp': 'deepseek-v3.2-exp',
      'glm-4.5-air': 'glm-4.5-air',
      'minimax-m2.5-dashscope': 'minimax-m2.5',
      'deepseek-v3.1': 'deepseek-v3.1',
      'qwen3-coder-plus': 'qwen3-coder-plus',
      'qwen3-max': 'qwen3-max',
      'kimi-k2-instruct': 'kimi-k2-instruct',
      'qwen3.6-plus-20260402': 'qwen3.6-plus-20260402',
      'deepseek-r1-0528': 'deepseek-r1-0528',
      // MiMo 模型
      'mimo-v2.5-pro': 'mimo-v2.5-pro',
      'mimo-v2.5-tts': 'mimo-v2.5-tts',
      'mimo-v2.5-tts-voicedesign': 'mimo-v2.5-tts-voicedesign'
    };

    function getModelDisplayName(modelId) {
      const modelLabels = {
        'deepseek-v4-flash': 'DeepSeek-V4-Flash',
        'deepseek-v4-flash-dashscope': 'DeepSeek-V4-Flash',
        'deepseek-v4-flash-siliconflow': 'DeepSeek-V4-Flash · 线路三',
        'deepseek-v4-pro': 'DeepSeek-V4-Pro',
        'deepseek-v4-pro-dashscope': 'DeepSeek-V4-Pro · 线路二',
        'step-3.5-flash': 'Step-3.5',
        'hy3-preview': '混元3',
        'gpt-oss-120b': 'chatGPT-OSS',
        'gpt-5.4': 'GPT-5.4',
        'claude-opus-4.6': 'Claude Opus 4.6',
        'claude-sonnet-4.6': 'Claude Sonnet 4.6',
        'gemini-2.5-pro': 'Gemini 2.5 Pro',
        'nemotron-3-super': 'Nemotron-3-super',
        'ling-2.6-1t': 'ling-2.6',
        'ling-2.6-1t-modelscope': 'ling-2.6 · 线路二',
        'spark-x2': 'spark-x2',
        'qwen3.5': 'Qwen 3.5',
        'qwen3-coder': 'Qwen3-Coder',
        'kimi-k2.5': 'Kimi K2.5',
        'kimi-k2.6': 'Kimi K2.6',
        'kimi-k2.6-moonshot': 'Kimi K2.6 · 线路二',
        'glm-5': 'GLM-5',
        'glm-5.1': 'GLM-5.1',
        'glm-5.1-dashscope': 'GLM-5.1',
        'glm-5.1-siliconflow': 'GLM-5.1 Pro · 线路三',
        'glm-4.7': 'GLM-4.7',
        'deepseek-r1': 'DeepSeek-R1',
        'minimax-m2.5': 'MiniMax-M2.5',
        'qwen3.6-max-preview': 'qwen3.6-max-preview',
        'qwen3.6-plus': 'qwen3.6-plus',
        // 百炼新增模型
        'deepseek-r1': 'DeepSeek-R1',
        'qwen3.6-flash': 'Qwen3.6-Flash',
        'kimi-k2.5-dashscope': 'Kimi K2.5 · 线路二',
        'deepseek-v3.2': 'DeepSeek-V3.2',
        'deepseek-v3.2-exp': 'DeepSeek-V3.2-Exp',
        'glm-4.5-air': 'GLM-4.5-Air',
        'minimax-m2.5-dashscope': 'MiniMax-M2.5 · 线路二',
        'deepseek-v3.1': 'DeepSeek-V3.1',
        'qwen3-coder-plus': 'Qwen3-Coder-Plus',
        'qwen3-max': 'Qwen3-Max',
        'kimi-k2-instruct': 'Kimi-K2-Instruct',
        'qwen3.6-plus-20260402': 'Qwen3.6-Plus · 线路三',
        'deepseek-r1-0528': 'DeepSeek-R1-0528 · 线路三',
        // MiMo 模型
        'mimo-v2.5-pro': 'MiMo-V2.5-Pro',
        'mimo-v2.5-tts': 'MiMo-TTS',
        'mimo-v2.5-tts-voicedesign': 'MiMo-TTS- VoiceDesign'
      };
      return modelLabels[modelId] || modelId;
    }

    function getModelRequestOptions(modelId) {
      if (modelId === 'glm-5' || modelId === 'glm-5.1-dashscope' || modelId === 'glm-4.7' || modelId === 'qwen3.6-plus' || modelId === 'qwen3.6-max-preview' || modelId === 'kimi-k2.6' || modelId === 'kimi-k2.6-moonshot' || modelId === 'deepseek-v4-pro' || modelId === 'deepseek-v4-pro-dashscope' || modelId === 'deepseek-r1' || modelId === 'deepseek-v3.2' || modelId === 'deepseek-v3.2-exp' || modelId === 'deepseek-v3.1' || modelId === 'deepseek-r1-0528') {
        return { enable_thinking: true };
      }
      return {};
    }

    // 速率限制：每分钟100次，每5秒5次
    const RATE_LIMIT_PER_MINUTE = 100;
    const RATE_LIMIT_PER_5SEC = 5;
    const requestTimestamps = [];
    const RATE_LIMIT_EXCEEDED_MESSAGE = '您已超额，请不要刷量！';

    let pendingAttachments = [];
    const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition || null;
    let voiceRecognition = null;
    let voiceListening = false;
    let voiceBaseText = '';

    const themeCycle = [
      { value: 'light', label: '浅色' },
      { value: 'dark', label: '深色' },
      { value: 'yellow', label: '暖黄' },
      { value: 'blue', label: '淡蓝' },
    ];
    let themeIndex = 0;

    const contrastCycle = ['系统', '标准', '高对比'];
    let contrastIndex = 0;

    const accentCycle = [
      { name: '绿色', value: '#10a37f' },
      { name: '琥珀', value: '#f59e0b' },
      { name: '珊瑚', value: '#ef4444' },
      { name: '石墨', value: '#6b7280' }
    ];
    let accentIndex = 0;

    function restoreUiPreferences() {
      try {
        const raw = localStorage.getItem(UI_PREFS_STORAGE_KEY);
        if (!raw) return;
        const prefs = JSON.parse(raw);
        const nextThemeIndex = themeCycle.findIndex(item => item.value === prefs.theme);
        if (nextThemeIndex >= 0) {
          themeIndex = nextThemeIndex;
          state.theme = themeCycle[nextThemeIndex].value;
        }
        const nextContrastIndex = contrastCycle.indexOf(prefs.contrast);
        if (nextContrastIndex >= 0) {
          contrastIndex = nextContrastIndex;
          state.contrast = contrastCycle[nextContrastIndex];
        }
        const nextAccentIndex = accentCycle.findIndex(item => item.name === prefs.accentName || item.value === prefs.accentValue);
        if (nextAccentIndex >= 0) {
          accentIndex = nextAccentIndex;
          state.accentName = accentCycle[nextAccentIndex].name;
          state.accentValue = accentCycle[nextAccentIndex].value;
        }
      } catch (error) {
        console.warn('恢复主题偏好失败:', error);
      }
    }

    function persistUiPreferences() {
      try {
        localStorage.setItem(UI_PREFS_STORAGE_KEY, JSON.stringify({
          theme: state.theme,
          contrast: state.contrast,
          accentName: state.accentName,
          accentValue: state.accentValue,
        }));
      } catch (error) {
        console.warn('保存主题偏好失败:', error);
      }
    }

    const RATE_LIMIT_MESSAGE = '模型服务暂时繁忙，请稍后再试。';

    // 速率限制检查函数
    function checkRateLimit() {
      const now = Date.now();
      // 清理超过1分钟的记录
      const oneMinuteAgo = now - 60000;
      const fiveSecondsAgo = now - 5000;

      // 保留最近1分钟内的请求记录
      while (requestTimestamps.length > 0 && requestTimestamps[0] < oneMinuteAgo) {
        requestTimestamps.shift();
      }

      // 检查每分钟限制
      if (requestTimestamps.length >= RATE_LIMIT_PER_MINUTE) {
        return { allowed: false, message: RATE_LIMIT_EXCEEDED_MESSAGE };
      }

      // 检查5秒内限制
      const recentRequests = requestTimestamps.filter(t => t >= fiveSecondsAgo);
      if (recentRequests.length >= RATE_LIMIT_PER_5SEC) {
        return { allowed: false, message: RATE_LIMIT_EXCEEDED_MESSAGE };
      }

      // 记录本次请求
      requestTimestamps.push(now);
      return { allowed: true, message: '' };
    }

    function decodeBase64Secret(encoded) {
      try {
        return atob(encoded);
      } catch (error) {
        return '';
      }
    }

    function updateAttachmentPreview() {
      if (!attachmentPreview) return;
      attachmentPreview.innerHTML = '';

      if (!pendingAttachments.length) {
        attachmentPreview.hidden = true;
        return;
      }

      attachmentPreview.hidden = false;

      pendingAttachments.forEach((attachment, index) => {
        const item = document.createElement('div');
        item.className = 'attachment-item';

        if (attachment.isTextFile) {
          // 文本文件显示文件图标
          const icon = document.createElement('div');
          icon.className = 'attachment-file-icon';
          icon.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>`;
          item.appendChild(icon);
        } else {
          // 图片文件显示图片预览
          const img = document.createElement('img');
          img.src = attachment.previewUrl || attachment.dataUrl || attachment.url;
          img.alt = attachment.name;
          item.appendChild(img);
        }

        const label = document.createElement('div');
        label.className = 'attachment-label';
        label.textContent = attachment.name;

        const removeBtn = document.createElement('button');
        removeBtn.className = 'attachment-remove';
        removeBtn.type = 'button';
        removeBtn.setAttribute('aria-label', `移除 ${attachment.name}`);
        removeBtn.textContent = '×';
        removeBtn.addEventListener('click', event => {
          event.stopPropagation();
          removePendingAttachment(index);
        });

        item.appendChild(label);
        item.appendChild(removeBtn);
        item.addEventListener('click', () => {
          if (attachment.isTextFile) {
            // 文本文件不打开新窗口，只显示已上传
            showToast(`已上传文件：${attachment.name}`);
          } else {
            window.open(attachment.previewUrl || attachment.dataUrl || attachment.url, '_blank', 'noopener,noreferrer');
          }
        });
        attachmentPreview.appendChild(item);
      });
    }

    function removePendingAttachment(index) {
      const item = pendingAttachments[index];
      if (item?.previewUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(item.previewUrl);
      }
      pendingAttachments.splice(index, 1);
      updateAttachmentPreview();
      setComposerBusy(state.isStreaming);
    }

    function estimateTokensFromText(value) {
      const text = String(value || '').trim();
      if (!text) return 0;
      const cjkCount = (text.match(/[\u3400-\u9fff]/g) || []).length;
      const otherCount = Math.max(0, text.length - cjkCount);
      return Math.max(1, Math.ceil(cjkCount * 1.15 + otherCount / 3.6));
    }

    function estimateTokensFromContent(content) {
      if (Array.isArray(content)) {
        return content.reduce((sum, part) => {
          if (!part) return sum;
          if (part.type === 'text') return sum + estimateTokensFromText(part.text || '');
          if (part.type === 'image_url') return sum + 1024;
          if (part.type === 'input_file') return sum + 768;
          return sum + estimateTokensFromText(JSON.stringify(part));
        }, 0);
      }
      if (content && typeof content === 'object') {
        return estimateTokensFromText(JSON.stringify(content));
      }
      return estimateTokensFromText(content);
    }

    function estimateMessageTokens(message) {
      if (!message || typeof message !== 'object') return 0;
      const toolCallOverhead = Array.isArray(message.tool_calls) ? message.tool_calls.length * 80 : 0;
      return 12 + toolCallOverhead + estimateTokensFromContent(message.content);
    }

    function estimateConversationTokens(history = conversationHistory) {
      return history.reduce((sum, message) => sum + estimateMessageTokens(message), 256);
    }

    function formatTokenCount(value) {
      if (value >= 1000) {
        return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}K`;
      }
      return String(value);
    }

    function updateContextMeter() {
      if (!contextMeter) return;
      const usedTokens = estimateConversationTokens();
      const ratio = CONTEXT_TOKEN_LIMIT > 0 ? Math.min(1, usedTokens / CONTEXT_TOKEN_LIMIT) : 0;
      contextMeter.style.setProperty('--meter-angle', `${ratio * 360}deg`);
      contextMeter.setAttribute('aria-label', `上下文额度 ${usedTokens} / ${CONTEXT_TOKEN_LIMIT} tokens`);
      if (contextMeterValue) {
        contextMeterValue.textContent = String(Math.round(ratio * 100));
      }
      if (contextMeterText) {
        contextMeterText.textContent = `当前会话上下文约使用 ${formatTokenCount(usedTokens)} / ${formatTokenCount(CONTEXT_TOKEN_LIMIT)} tokens，剩余 ${formatTokenCount(Math.max(0, CONTEXT_TOKEN_LIMIT - usedTokens))}。超限前会自动压缩为摘要并切到新对话继续。`;
      }
    }

    function clearPendingAttachments() {
      pendingAttachments.forEach(item => {
        if (item?.previewUrl?.startsWith('blob:')) {
          URL.revokeObjectURL(item.previewUrl);
        }
      });
      pendingAttachments = [];
      updateAttachmentPreview();
    }

    function updateVoiceButtonState() {
      if (!voiceInputBtn) return;
      voiceInputBtn.classList.toggle('listening', voiceListening);
      voiceInputBtn.setAttribute('aria-pressed', String(voiceListening));
      voiceInputBtn.setAttribute('aria-label', voiceListening ? '停止语音输入' : '语音输入');
      voiceInputBtn.title = !SpeechRecognitionCtor
        ? '当前浏览器不支持语音输入'
        : (voiceListening ? '停止语音输入' : '语音输入');
    }

    function ensureVoiceRecognition() {
      if (!SpeechRecognitionCtor) return null;
      if (voiceRecognition) return voiceRecognition;

      voiceRecognition = new SpeechRecognitionCtor();
      voiceRecognition.lang = 'zh-CN';
      voiceRecognition.continuous = false;
      voiceRecognition.interimResults = true;
      voiceRecognition.maxAlternatives = 1;

      voiceRecognition.onstart = () => {
        voiceListening = true;
        voiceBaseText = homeInput.value;
        updateVoiceButtonState();
        showToast('开始语音输入');
      };

      voiceRecognition.onresult = event => {
        const transcript = Array.from(event.results)
          .map(result => String(result?.[0]?.transcript || ''))
          .join('')
          .trim();
        const nextText = `${voiceBaseText}${voiceBaseText && transcript ? ' ' : ''}${transcript}`.trim();
        if (nextText) {
          homeInput.value = nextText;
          homeInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
      };

      voiceRecognition.onend = () => {
        voiceListening = false;
        updateVoiceButtonState();
      };

      voiceRecognition.onerror = event => {
        voiceListening = false;
        updateVoiceButtonState();
        if (event.error !== 'aborted') {
          showToast(`语音输入失败：${event.error}`);
        }
      };

      return voiceRecognition;
    }

    function toggleVoiceInput() {
      if (!voiceInputBtn) return;

      if (state.isStreaming) {
        showToast('正在发送消息，稍后再试语音输入');
        return;
      }

      if (!SpeechRecognitionCtor) {
        showToast('当前浏览器不支持语音输入');
        return;
      }

      const recognition = ensureVoiceRecognition();
      if (!recognition) {
        showToast('无法初始化语音输入');
        return;
      }

      if (voiceListening) {
        recognition.stop();
        return;
      }

      try {
        recognition.start();
      } catch (error) {
        showToast('语音输入已在运行');
      }
    }

    function stopVoiceRecognition() {
      if (!voiceRecognition || !voiceListening) return;
      try {
        voiceRecognition.stop();
      } catch {
        voiceListening = false;
        updateVoiceButtonState();
      }
    }

    function readFileAsDataUrl(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('读取图片失败'));
        reader.readAsDataURL(file);
      });
    }

    async function filesToAttachments(files) {
      const accepted = [];
      const fileList = Array.from(files || []);
      const remainingSlots = Math.max(0, MAX_ATTACHMENT_COUNT - pendingAttachments.length);

      if (!remainingSlots) {
        showToast(`最多只能上传 ${MAX_ATTACHMENT_COUNT} 个文件`);
        return accepted;
      }

      if (fileList.length > remainingSlots) {
        showToast(`最多只能再上传 ${remainingSlots} 个文件`);
      }

      for (const file of fileList.slice(0, remainingSlots)) {
        const isImage = file.type.startsWith('image/');
        const isTextFile = file.name.match(/\.(pdf|txt|doc|docx|md|json|csv)$/i);

        if (!isImage && !isTextFile) {
          showToast(`已忽略不支持的文件：${file.name}`);
          continue;
        }

        if (file.size > MAX_ATTACHMENT_SIZE) {
          showToast(`文件过大，已忽略：${file.name}`);
          continue;
        }

        let previewUrl = null;
        let dataUrl = null;
        let textContent = null;

        if (isImage) {
          previewUrl = URL.createObjectURL(file);
          dataUrl = await readFileAsDataUrl(file).catch(() => '');
        } else if (isTextFile) {
          // 读取文本文件内容
          textContent = await readFileAsText(file).catch(() => null);
          if (!textContent) {
            showToast(`无法读取文件内容：${file.name}`);
            continue;
          }
          // 对于文本文件，使用文件图标作为预览
          previewUrl = null;
          dataUrl = null;
        }

        accepted.push({
          name: file.name,
          type: file.type,
          size: file.size,
          previewUrl,
          dataUrl,
          textContent,
          file,
          isTextFile: !!isTextFile,
        });
      }

      return accepted;
    }

    async function readFileAsText(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsText(file);
      });
    }

    function isRenderableAttachmentUrl(url) {
      return typeof url === 'string' && (url.startsWith('data:') || /^https?:\/\//i.test(url));
    }

    function extractUserMessageParts(content) {
      if (!Array.isArray(content)) {
        return { text: String(content || '').trim(), attachments: [] };
      }

      const textParts = [];
      const attachments = [];
      let imageIndex = 0;

      content.forEach(part => {
        if (!part) return;

        if (part.type === 'text' && typeof part.text === 'string') {
          const trimmed = part.text.trim();
          if (trimmed) textParts.push(trimmed);
          return;
        }

        if (part.type === 'image_url' && part.image_url?.url) {
          const url = part.image_url.url;
          if (!isRenderableAttachmentUrl(url)) return;
          imageIndex += 1;
          attachments.push({
            name: part.image_url?.name || `图片 ${imageIndex}`,
            type: part.image_url?.mime_type || 'image/*',
            previewUrl: url,
            dataUrl: url,
            url,
            file: null,
            isTextFile: false,
          });
        }
      });

      return {
        text: textParts.join('\n\n').trim(),
        attachments,
      };
    }

    function attachmentToUserContent(query, attachments) {
      const textPart = String(query || '').trim();
      const content = [];
      const hasImageAttachment = attachments.some(item => !item?.isTextFile);

      attachments.forEach(item => {
        // 处理文本文件：将文件内容注入到对话中
        if (item?.isTextFile && item?.textContent) {
          const fileIntro = `\n\n--- 附件：${item.name} ---\n${item.textContent}\n--- 附件结束 ---\n`;
          content.push({ type: 'text', text: fileIntro });
          return;
        }

        // 处理图片文件
        const url = item?.dataUrl || item?.url;
        if (!isRenderableAttachmentUrl(url)) return;
        content.push({
          type: 'image_url',
          image_url: { url, detail: 'auto' },
        });
      });

      if (textPart) {
        content.push({ type: 'text', text: textPart });
      } else if (hasImageAttachment) {
        content.push({ type: 'text', text: '请先仔细查看我上传的图片，再结合问题回答。' });
      }

      return content;
    }

    const SUPABASE_URL = (window.__SUPABASE_URL__ || '').trim() || `${window.location.origin}/api/supabase`;
    const PROXY_TOKEN = (window.__PROXY_TOKEN__ || '').trim();
    const EDGE_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/modelscope-proxy`;
    const CHAT_HISTORY_URL = `${SUPABASE_URL}/functions/v1/chat-history`;
    const WEB_SEARCH_URL = `${SUPABASE_URL}/functions/v1/web-search`;
    const MODELSCOPE_IMAGE_MODEL = 'Tongyi-MAI/Z-Image-Turbo';
    const OPENAI_IMAGE_MODEL = 'dall-e-3';
    const MODELSCOPE_CHAT_MODEL = 'deepseek-ai/DeepSeek-V4-Flash';
    const MAX_REPEATED_TOOL_CALLS = 3;
    const FETCH_TIMEOUT_MS = 20000;
    const CHAT_REQUEST_TIMEOUT_MS = 25000;
    const CHAT_TURN_TIMEOUT_MS = 90000;

    function proxyHeaders(extra = {}) {
      const h = { 'Content-Type': 'application/json', ...extra };
      if (PROXY_TOKEN) h['x-proxy-token'] = PROXY_TOKEN;
      return h;
    }

    function createChatTurnId() {
      return `turn_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    }

    // 获取用户标识（基于 API key 或生成随机 ID）
    let userId = localStorage.getItem('cancri_user_id');
    if (!userId) {
      userId = 'user_' + Math.random().toString(36).substr(2, 9);
      localStorage.setItem('cancri_user_id', userId);
    }

    // 聊天记录管理
    let currentChatId = null;
    let chatHistoryList = [];

    function getPinnedChats() {
      try { return JSON.parse(localStorage.getItem('cancri_pinned_chats') || '[]'); }
      catch { return []; }
    }
    function savePinnedChats(ids) {
      localStorage.setItem('cancri_pinned_chats', JSON.stringify(ids));
    }

    function closeChatItemMenu() {
      const menu = document.getElementById('chatItemMenu');
      if (menu) menu.classList.remove('show');
    }

    function showChatItemMenu(x, y, chatId, title) {
      let menu = document.getElementById('chatItemMenu');
      if (!menu) {
        menu = document.createElement('div');
        menu.id = 'chatItemMenu';
        menu.className = 'chat-item-menu';
        menu.innerHTML = `
          <button class="chat-item-menu-btn" data-action="rename"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"></path></svg>修改名称</button>
          <button class="chat-item-menu-btn" data-action="pin"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z"></path></svg><span class="pin-label">置顶对话</span></button>
          <div class="chat-item-menu-sep"></div>
          <button class="chat-item-menu-btn danger" data-action="delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>删除对话</button>
        `;
        document.body.appendChild(menu);
        menu.addEventListener('click', async e => {
          const btn = e.target.closest('.chat-item-menu-btn');
          if (!btn) return;
          const action = btn.dataset.action;
          const targetId = menu.dataset.chatId;
          const targetTitle = menu.dataset.chatTitle;
          closeChatItemMenu();
          if (action === 'rename') {
            const newTitle = window.prompt('修改对话名称:', targetTitle || '新对话');
            if (newTitle && newTitle.trim()) {
              await renameChatHistory(targetId, newTitle.trim());
            }
          } else if (action === 'pin' || action === 'unpin') {
            const pinned = getPinnedChats();
            const idx = pinned.indexOf(targetId);
            if (idx >= 0) { pinned.splice(idx, 1); }
            else { pinned.unshift(targetId); }
            savePinnedChats(pinned);
            renderChatHistoryList();
          } else if (action === 'delete') {
            if (window.confirm('确定要删除这条对话记录吗？')) {
              const result = await deleteChatHistory(targetId);
              if (!result.success) {
                showToast(result.message || '删除失败，请检查网络或刷新重试');
                return;
              }
              const pinned = getPinnedChats();
              const idx2 = pinned.indexOf(targetId);
              if (idx2 >= 0) { pinned.splice(idx2, 1); savePinnedChats(pinned); }
              if (currentChatId === targetId) newChat();
              renderChatHistoryList();
            }
          }
        });
      }
      // 切换逻辑：点同一个且已开 → 关；点不同或已关 → 开
      const isShowing = menu.classList.contains('show');
      const sameChat = menu.dataset.chatId === chatId;
      if (isShowing && sameChat) {
        closeChatItemMenu();
        return;
      }
      const pinned = getPinnedChats();
      const isPinned = pinned.includes(chatId);
      menu.querySelector('[data-action="pin"] .pin-label').textContent = isPinned ? '取消置顶' : '置顶对话';
      menu.querySelector('[data-action="pin"]').dataset.action = isPinned ? 'unpin' : 'pin';
      menu.dataset.chatId = chatId;
      menu.dataset.chatTitle = title || '';
      menu.style.left = Math.min(x, window.innerWidth - 160) + 'px';
      menu.style.top = Math.min(y, window.innerHeight - 140) + 'px';
      menu.classList.add('show');
    }

    document.addEventListener('click', e => {
      const menu = document.getElementById('chatItemMenu');
      if (menu && !menu.contains(e.target) && !e.target.closest('.recent-item-actions')) {
        closeChatItemMenu();
      }
    });

    async function renameChatHistory(chatId, newTitle) {
      try {
        const chat = await loadChatHistory(chatId);
        if (!chat) return;
        const response = await fetch(CHAT_HISTORY_URL, {
          method: 'PUT',
          headers: proxyHeaders({ 'x-user-id': userId }),
          body: JSON.stringify({ id: chatId, messages: chat.messages || [], title: newTitle })
        });
        if (!response.ok) throw new Error('重命名失败');
        if (currentChatId === chatId) {
          const msg = chat.messages?.[0];
          if (msg) msg.content = newTitle;
        }
        renderChatHistoryList();
        showToast('已重命名');
      } catch (err) {
        console.error('重命名失败:', err);
        showToast('重命名失败');
      }
    }

    // 加载并显示聊天记录列表
    async function renderChatHistoryList() {
      const listContainer = document.getElementById('chatHistoryList');
      if (!listContainer) return;

      try {
        const chats = await loadChatHistoryList();
        listContainer.innerHTML = '';

        if (chats.length === 0) {
          listContainer.innerHTML = '<div style="padding:12px 8px;font-size:13px;color:var(--text-dim);">暂无聊天记录</div>';
          return;
        }

        const pinned = getPinnedChats();
        const sorted = [...chats].sort((a, b) => {
          const ap = pinned.includes(a.id);
          const bp = pinned.includes(b.id);
          if (ap !== bp) return ap ? -1 : 1;
          return 0;
        });

        sorted.forEach(chat => {
          const isPinned = pinned.includes(chat.id);
          const item = document.createElement('div');
          item.className = 'recent-item' + (isPinned ? ' recent-item-pinned' : '');

          const titleSpan = document.createElement('span');
          titleSpan.className = 'recent-item-title';
          titleSpan.textContent = chat.title || '新对话';
          titleSpan.title = chat.title || '新对话';

          const actionsBtn = document.createElement('button');
          actionsBtn.className = 'recent-item-actions';
          actionsBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="5" r="1.5"></circle><circle cx="12" cy="12" r="1.5"></circle><circle cx="12" cy="19" r="1.5"></circle></svg>`;
          actionsBtn.title = '更多操作';
          actionsBtn.addEventListener('click', e => {
            e.stopPropagation();
            showChatItemMenu(e.clientX, e.clientY, chat.id, chat.title);
          });

          item.appendChild(titleSpan);
          item.appendChild(actionsBtn);
          item.addEventListener('click', () => loadChat(chat.id));
          listContainer.appendChild(item);
        });
      } catch (error) {
        console.error('加载聊天记录列表失败:', error);
        listContainer.innerHTML = '<div style="padding:12px 8px;font-size:13px;color:var(--text-dim);">加载失败</div>';
      }
    }

    // 加载特定聊天记录
    async function loadChat(chatId) {
      try {
        const chat = await loadChatHistory(chatId);
        if (chat && chat.messages) {
          currentChatId = chatId;
          conversationHistory = chat.messages;
          setActiveView('home');
          homeView.classList.add('chatting');
          chatMessages.classList.add('active');
          renderMessages();
          updateContextMeter();
          setComposerBusy(false);
          showToast('已加载聊天记录');
        }
      } catch (error) {
        console.error('加载聊天记录失败:', error);
        showToast('加载失败');
      }
    }

    // 新建聊天
    function newChat() {
      currentChatId = null;
      conversationHistory = [];
      chatMessages.innerHTML = '';
      homeCenter.style.display = 'flex';
      chatMessages.classList.remove('active');
      homeView.classList.remove('chatting');
      updateContextMeter();
      updateHomeHeroText();
      showToast('已创建新对话');
    }

    // 渲染消息
    function renderMessages() {
      if (!chatMessages) return;
      chatMessages.innerHTML = '';

      conversationHistory.forEach(message => {
        if (message.role === 'user') {
          createUserMessage(message.content);
        } else if (message.role === 'assistant') {
          const content = typeof message.content === 'string' ? message.content : '';
          const id = createAssistantMessage();
          updateAssistantMessage(id, { answer: content, thinking: false });
        }
      });
    }

    async function saveChatHistory(messages) {
      try {
        const response = await fetch(CHAT_HISTORY_URL, {
          method: 'POST',
          headers: proxyHeaders({ 'x-user-id': userId }),
          body: JSON.stringify({
            title: generateChatTitle(messages),
            messages: messages,
            model: currentModel
          })
        });

        if (!response.ok) throw new Error('保存聊天记录失败');

        const { data } = await response.json();
        currentChatId = data.id;
        return data;
      } catch (error) {
        console.error('保存聊天记录失败:', error);
      }
    }

    async function updateChatHistory(chatId, messages) {
      try {
        const response = await fetch(CHAT_HISTORY_URL, {
          method: 'PUT',
          headers: proxyHeaders({ 'x-user-id': userId }),
          body: JSON.stringify({
            id: chatId,
            messages: messages,
            title: generateChatTitle(messages)
          })
        });

        if (!response.ok) throw new Error('更新聊天记录失败');

        const { data } = await response.json();
        return data;
      } catch (error) {
        console.error('更新聊天记录失败:', error);
      }
    }

    async function loadChatHistoryList() {
      try {
        const response = await fetch(CHAT_HISTORY_URL, {
          method: 'GET',
          headers: proxyHeaders({ 'x-user-id': userId })
        });

        if (!response.ok) throw new Error('加载聊天记录列表失败');

        const { data } = await response.json();
        chatHistoryList = data || [];
        return chatHistoryList;
      } catch (error) {
        console.error('加载聊天记录列表失败:', error);
        return [];
      }
    }

    async function loadChatHistory(chatId) {
      try {
        const response = await fetch(`${CHAT_HISTORY_URL}?id=${chatId}`, {
          method: 'GET',
          headers: proxyHeaders({ 'x-user-id': userId })
        });

        if (!response.ok) throw new Error('加载聊天记录失败');

        const { data } = await response.json();
        return data;
      } catch (error) {
        console.error('加载聊天记录失败:', error);
        return null;
      }
    }

    async function deleteChatHistory(chatId) {
      try {
        const response = await fetch(`${CHAT_HISTORY_URL}?id=${chatId}`, {
          method: 'DELETE',
          headers: proxyHeaders({ 'x-user-id': userId })
        });

        const rawText = await response.text().catch(() => '');
        let detail = rawText.trim();
        if (detail) {
          try {
            const parsed = JSON.parse(detail);
            detail = parsed?.error || parsed?.message || detail;
          } catch (parseError) {
            // keep raw text
          }
        }

        if (!response.ok) {
          return { success: false, message: detail || '删除聊天记录失败' };
        }

        return { success: true, message: detail || '已删除' };
      } catch (error) {
        console.error('删除聊天记录失败:', error);
        return { success: false, message: error.message || '删除聊天记录失败' };
      }
    }

    function generateChatTitle(messages) {
      if (!messages || messages.length === 0) return '新对话';
      const firstUserMessage = messages.find(m => m.role === 'user');
      if (firstUserMessage) {
        const content = typeof firstUserMessage.content === 'string'
          ? firstUserMessage.content
          : (Array.isArray(firstUserMessage.content)
            ? firstUserMessage.content.find(c => c.type === 'text')?.text || ''
            : '');
        return content.slice(0, 20) || '新对话';
      }
      return '新对话';
    }
    const ARTICLE_TOOL_DEFINITIONS = [
      {
        type: 'function',
        function: {
          name: 'get_article_list',
          description: '获取站内文章列表，可选按关键词或分类筛选。当用户询问网站有哪些文章、最近更新或某类主题文章时使用。',
          parameters: {
            type: 'object',
            properties: {
              keyword: {
                type: 'string',
                description: '用于筛选文章的关键词，可为空。',
              },
              category: {
                type: 'string',
                description: '文章分类，可为空。',
              },
              lang: {
                type: 'string',
                enum: ['zh', 'en'],
                description: '返回内容语言，默认跟随用户问题。',
              },
            },
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_article_content',
          description: '获取指定文章的正文内容。当已知文章 ID 或标题，或想深入阅读某篇文章时使用。',
          parameters: {
            type: 'object',
            properties: {
              article_id: {
                type: 'string',
                description: '文章 ID。',
              },
              article_title: {
                type: 'string',
                description: '文章标题，可用于按标题匹配文章。',
              },
              lang: {
                type: 'string',
                enum: ['zh', 'en'],
                description: '返回内容语言，默认跟随用户问题。',
              },
            },
            additionalProperties: false,
          },
        },
      },
    ];

    const WEB_SEARCH_TOOL_DEFINITION = {
      type: 'function',
      function: {
        name: 'web_search',
        description: '联网搜索公开网页内容，适合查找最新信息、站外教程、新闻、网页资料或外部文档。',
        parameters: {
          type: 'object',
          properties: {
            search_query: {
              type: 'string',
              description: '用于联网搜索的搜索词或问题。',
            },
            lang: {
              type: 'string',
              enum: ['zh', 'en'],
              description: '返回内容语言，默认跟随用户问题。',
            },
            limit: {
              type: 'integer',
              minimum: 1,
              maximum: 10,
              description: '返回结果数量，默认 5。',
            },
          },
          required: ['search_query'],
          additionalProperties: false,
        },
      },
    };

    const FETCH_WEB_PAGE_TOOL_DEFINITION = {
      type: 'function',
      function: {
        name: 'fetch_web_page',
        description: '获取指定网页的完整内容，用于深入阅读网页文章或页面内容。',
        parameters: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: '要获取内容的网页 URL。',
            },
          },
          required: ['url'],
          additionalProperties: false,
        },
      },
    };

    // Token expiration settings
    const TOKEN_START_DATE = new Date('2026-04-28T22:52:10+08:00');
    const TOKEN_END_DATE = new Date('2026-05-28T22:52:10+08:00');

    const ARTICLE_SCRIPT_SRC = '../js/article.js';
    const ARTICLE_INDEX_LIMIT = 24;
    const ARTICLE_DETAIL_LIMIT = 5000;
    let articleDataPromise = null;
    let articleIndexPromise = null;
    let articleIndexCache = null;

    function normalizeArticleText(input) {
      return String(input || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
    }

    function stripArticleHtml(input) {
      return String(input || '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    function detectArticleLang(query) {
      const value = String(query || '');
      if (!value) return 'zh';
      return /[\u4e00-\u9fff]/.test(value) ? 'zh' : 'en';
    }

    function getPreferredArticleLang(query) {
      if (state.language === 'English') return 'en';
      if (state.language === '简体中文') return 'zh';
      return detectArticleLang(query);
    }

    function getArticleFirstParagraph(paragraphs) {
      if (!Array.isArray(paragraphs)) return '';
      const paragraph = paragraphs.find(item => typeof item === 'string' && item.trim());
      return paragraph ? stripArticleHtml(paragraph) : '';
    }

    function isSiteArticleQuery(query) {
      const normalized = normalizeArticleText(query);
      if (!normalized) return false;
      return /tactfr|sentience|nexusv|cancri|文章|站内|知识源|目录|列表|article|site/.test(normalized)
        || /有哪些文章|文章列表|文章目录|站内文章|文章清单|全部文章|都有什么文章|列出.*文章|list.*article|read.*article/.test(normalized);
    }

    function getArticlePayload(item, lang, fallback) {
      const data = (item && item[lang]) || fallback || {};
      const paragraphs = Array.isArray(data.paragraphs) ? data.paragraphs.map(stripArticleHtml).filter(Boolean) : [];
      const excerpt = getArticleFirstParagraph(data.paragraphs) || paragraphs[0] || '';
      return {
        title: String(data.title || ''),
        category: String(data.category || ''),
        date: String(data.date || ''),
        readTime: String(data.readTime || ''),
        excerpt,
        paragraphs,
      };
    }

    function buildArticleIndex(articleData) {
      return Object.entries(articleData || {})
        .map(([id, item]) => {
          const zh = getArticlePayload(item, 'zh');
          const en = getArticlePayload(item, 'en', zh);
          const aggregate = normalizeArticleText([
            id,
            item && item.overlay ? item.overlay : '',
            zh.title, zh.category, zh.date, zh.readTime, zh.excerpt,
            en.title, en.category, en.date, en.readTime, en.excerpt,
            zh.paragraphs.join(' '),
            en.paragraphs.join(' ')
          ].join(' '));

          return {
            id,
            overlay: String(item && item.overlay ? item.overlay : ''),
            zh,
            en,
            aggregate,
          };
        })
        .filter(item => item.zh.title || item.en.title);
    }

    function resolveArticleView(candidate, lang, { includeFullText = false, maxChars = ARTICLE_DETAIL_LIMIT } = {}) {
      if (!candidate) return null;
      const primary = lang === 'en' ? candidate.en : candidate.zh;
      const fallback = candidate.zh.title ? candidate.zh : candidate.en;
      const localized = primary && primary.title ? primary : fallback;
      const paragraphs = Array.isArray(localized.paragraphs) ? localized.paragraphs : [];
      const fullText = includeFullText
        ? truncateArticleText(paragraphs.join('\n\n'), maxChars)
        : '';

      return {
        id: candidate.id,
        overlay: String(candidate.overlay || ''),
        title: String(localized.title || candidate.id),
        category: String(localized.category || ''),
        date: String(localized.date || ''),
        readTime: String(localized.readTime || ''),
        excerpt: String(localized.excerpt || ''),
        paragraphs,
        fullText,
      };
    }

    function truncateArticleText(text, maxChars = ARTICLE_DETAIL_LIMIT) {
      const value = String(text || '').trim();
      if (!value || value.length <= maxChars) return value;
      return `${value.slice(0, maxChars)}\n\n[内容已截断，若需要更细节可继续按文章 ID 读取。]`;
    }

    function loadArticleData() {
      if (window.articleData && typeof window.articleData === 'object') {
        return Promise.resolve(window.articleData);
      }
      if (articleDataPromise) return articleDataPromise;

      articleDataPromise = new Promise((resolve, reject) => {
        const existingScript = Array.from(document.scripts).find(script => {
          const src = (script.getAttribute('src') || '').split('?')[0];
          return src.endsWith('article.js');
        });

        const finish = () => {
          if (window.articleData && typeof window.articleData === 'object') {
            resolve(window.articleData);
          } else {
            reject(new Error('articleData unavailable'));
          }
        };

        if (existingScript) {
          if (window.articleData) {
            finish();
          } else {
            existingScript.addEventListener('load', finish, { once: true });
            existingScript.addEventListener('error', () => reject(new Error('Failed to load article.js')), { once: true });
          }
          return;
        }

        const script = document.createElement('script');
        script.src = ARTICLE_SCRIPT_SRC;
        script.async = true;
        script.onload = finish;
        script.onerror = () => reject(new Error('Failed to load article.js'));
        document.head.appendChild(script);
      });

      return articleDataPromise;
    }

    function getArticleIndex() {
      if (articleIndexCache) return Promise.resolve(articleIndexCache);
      if (articleIndexPromise) return articleIndexPromise;

      articleIndexPromise = loadArticleData()
        .then(articleData => {
          articleIndexCache = buildArticleIndex(articleData);
          return articleIndexCache;
        })
        .catch(() => {
          articleIndexCache = [];
          return articleIndexCache;
        });

      return articleIndexPromise;
    }

    function scoreArticleCandidate(candidate, query, lang) {
      const normalizedQuery = normalizeArticleText(query);
      if (!normalizedQuery) return 0;

      const primaryCandidate = lang === 'en' ? candidate.en : candidate.zh;
      const localized = (primaryCandidate && primaryCandidate.title)
        ? primaryCandidate
        : (candidate.zh.title ? candidate.zh : candidate.en);

      const title = normalizeArticleText(localized.title);
      const category = normalizeArticleText(localized.category);
      const excerpt = normalizeArticleText(localized.excerpt);
      const aggregate = candidate.aggregate;
      const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
      let score = 0;
      let matched = 0;

      for (const token of tokens) {
        let tokenScore = 0;
        if (title.startsWith(token)) tokenScore = Math.max(tokenScore, 120);
        if (title.includes(token)) tokenScore = Math.max(tokenScore, 95);
        if (category.includes(token)) tokenScore = Math.max(tokenScore, 55);
        if (excerpt.includes(token)) tokenScore = Math.max(tokenScore, 35);
        if (aggregate.includes(token)) tokenScore = Math.max(tokenScore, 20);
        if (tokenScore > 0) {
          score += tokenScore;
          matched += 1;
        }
      }

      if (tokens.length > 1 && matched === tokens.length) score += 30;
      return score;
    }

    async function listArticles(lang = getPreferredArticleLang('')) {
      const index = await getArticleIndex();
      return index.slice(0, ARTICLE_INDEX_LIMIT).map(candidate => resolveArticleView(candidate, lang));
    }

    async function searchArticles(query, lang = getPreferredArticleLang(query)) {
      const index = await getArticleIndex();
      const trimmed = String(query || '').trim();
      if (!trimmed) return [];

      const scored = [];
      for (const candidate of index) {
        const score = scoreArticleCandidate(candidate, trimmed, lang);
        if (score > 0) scored.push({ score, candidate });
      }

      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, ARTICLE_INDEX_LIMIT).map(item => ({
        ...resolveArticleView(item.candidate, lang),
        score: item.score,
      }));
    }

    async function readArticle(articleId, lang = getPreferredArticleLang(articleId)) {
      const index = await getArticleIndex();
      const needle = normalizeArticleText(articleId);
      const candidate = index.find(item => {
        const values = [item.id, item.zh.title, item.en.title, item.overlay];
        return values.some(value => normalizeArticleText(value) === needle)
          || values.some(value => normalizeArticleText(value).includes(needle));
      });

      return candidate ? resolveArticleView(candidate, lang, { includeFullText: true }) : null;
    }

    async function buildArticleToolContext(query) {
      const lang = getPreferredArticleLang(query);
      try {
        if (!isSiteArticleQuery(query)) {
          return {
            lang,
            catalogText: '（本次问题与站内文章无关，未附加文章目录）',
            searchText: '（未检索）',
            detailText: '（未读取）',
          };
        }

        const index = await getArticleIndex();
        const normalizedQuery = normalizeArticleText(query);
        const catalogText = index.slice(0, ARTICLE_INDEX_LIMIT).map(candidate => {
          const view = resolveArticleView(candidate, lang);
          const compactExcerpt = view.excerpt
            ? (view.excerpt.length > 140 ? `${view.excerpt.slice(0, 140)}…` : view.excerpt)
            : '';
          const parts = [
            `[${view.id}] ${view.title}`,
            view.overlay,
            view.category,
            view.date,
            view.readTime,
            compactExcerpt,
          ].filter(Boolean);
          return `- ${parts.join(' ｜ ')}`;
        }).join('\n') || '（暂无文章）';

        const searchResults = await searchArticles(query, lang);
        const searchText = searchResults.length
          ? searchResults.map((view, idx) => {
              const parts = [
                `${idx + 1}. [${view.id}] ${view.title}`,
                view.category,
                view.date,
              ].filter(Boolean);
              return `- ${parts.join(' ｜ ')}`;
            }).join('\n')
          : '（未命中）';

        const isCatalogRequest = /有哪些文章|文章列表|文章目录|站内文章|文章清单|全部文章|都有什么文章|列出.*文章|list.*article/i.test(normalizeArticleText(query));
        const isDetailRequest = !isCatalogRequest && /了解|阅读|全文|详细|内容|讲什么|介绍|说明|怎么/.test(normalizedQuery);
        const detailViews = isDetailRequest
          ? await Promise.all(searchResults.slice(0, 2).map(item => readArticle(item.id, lang)))
          : [];

        const detailText = detailViews
          .filter(Boolean)
          .map((view, idx) => {
            const meta = [
              `【${idx + 1}｜${view.id}】${view.title}`,
              view.overlay ? `系列：${view.overlay}` : '',
              view.category ? `分类：${view.category}` : '',
              view.date ? `日期：${view.date}` : '',
              view.readTime ? `阅读时长：${view.readTime}` : '',
            ].filter(Boolean).join('\n');
            return `${meta}\n\n${view.fullText || '（无正文）'}`;
          })
          .join('\n\n---\n\n') || '（未读取）';

        return { lang, catalogText, searchText, detailText };
      } catch (error) {
        const fallbackCatalogText = [
          '- TACTFR V5：核心是更真实的执法闭环、嫌疑人概率行为、搜索范围圈、直升机勘探和评分系统。',
          '- TACTFR 6.0.0 Beta.2：新增故事任务框架、七阶段逮捕序列、双嫌疑人执法链路和终端 UI 自定义。',
          '- TACTFR × Sentience：把 Sentience 语音与自然语言能力接入 TACTFR，让对话驱动案件逻辑和追捕 AI。',
          '- SentienceV4.1 Omni：多服务商 API、本地与云端切换、DeepSeek/OpenAI 兼容接口、TTS/STT 和启动器体验。',
          '- Sentience V4C：具身 NPC、长期社会记忆、邻域 gossip 传播与情绪压力下的行为切换。',
          '- NexusV V5：UI 重构、内置 Rockstar Editor、200+ 信息菜单、创意模块。',
          '- Cancri：跨检查点隐状态接力机制，降低多专家协作的内存开销。',
        ].join('\n');

        return {
          lang,
          catalogText: fallbackCatalogText,
          searchText: '（文章搜索暂不可用）',
          detailText: '',
        };
      }
    }

    window.CancriArticleTool = {
      load: loadArticleData,
      listArticles,
      searchArticles,
      readArticle,
      buildContext: buildArticleToolContext,
    };

    loadArticleData().catch(() => null);

    const langCycle = ['自动检测', '简体中文', 'English', '日本語'];
    let langIndex = 0;

    const speechCycle = ['自动检测', '普通话', 'English', '粤语'];
    let speechIndex = 0;

    function applyTheme() {
      const nextThemeIndex = themeCycle.findIndex(item => item.value === state.theme);
      if (nextThemeIndex >= 0) {
        themeIndex = nextThemeIndex;
      }
      root.setAttribute('data-theme', state.theme);
      root.style.setProperty('--accent', state.accentValue);
      appearanceValue.textContent = themeCycle[themeIndex].label;
      contrastValue.textContent = state.contrast;
      accentValueEl.textContent = state.accentName;
      accentDot.style.background = state.accentValue;
      languageValue.textContent = state.language;
      speechValue.textContent = state.speech;
      persistUiPreferences();
    }

    function showToast(message) {
      toast.textContent = message;
      toast.classList.add('show');
      clearTimeout(showToast._timer);
      showToast._timer = setTimeout(() => toast.classList.remove('show'), 2200);
    }

    function renderWatermark() {
      if (!pageWatermarkGrid) return;
      pageWatermarkGrid.innerHTML = Array.from({ length: 24 }, () => '<div class="page-watermark-item">NexusV</div>').join('');
    }

    let customContextMenuTarget = null;

    function closeCustomContextMenu() {
      if (!customContextMenu) return;
      customContextMenu.classList.remove('show');
      customContextMenu.setAttribute('aria-hidden', 'true');
      customContextMenuTarget = null;
    }

    function getEditableElement(node) {
      if (!(node instanceof Element)) return null;
      return node.closest('input, textarea, [contenteditable="true"]');
    }

    function getCopiedText(source) {
      if (source instanceof HTMLInputElement || source instanceof HTMLTextAreaElement) {
        const start = source.selectionStart;
        const end = source.selectionEnd;
        if (typeof start === 'number' && typeof end === 'number' && end > start) {
          return source.value.slice(start, end);
        }
        return source.value || '';
      }

      const selection = window.getSelection ? String(window.getSelection().toString() || '') : '';
      return selection.trim();
    }

    async function writeTextToClipboard(text) {
      if (!text) return false;

      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
          return true;
        }
      } catch {
        // fall through to the fallback below
      }

      try {
        const temp = document.createElement('textarea');
        temp.value = text;
        temp.setAttribute('readonly', 'readonly');
        temp.style.position = 'fixed';
        temp.style.left = '-9999px';
        temp.style.top = '0';
        document.body.appendChild(temp);
        temp.select();
        const ok = document.execCommand('copy');
        temp.remove();
        return ok;
      } catch {
        return false;
      }
    }

    async function readClipboardText() {
      try {
        if (!navigator.clipboard?.readText) return '';
        return await navigator.clipboard.readText();
      } catch {
        return '';
      }
    }

    // MiMo TTS 朗读功能
    async function speakTextWithMimo(text) {
      if (!text || text.trim().length === 0) {
        showToast('没有可朗读的内容');
        return;
      }

      showToast('正在生成语音...');

      try {
        const response = await fetch(EDGE_FUNCTION_URL, {
          method: 'POST',
          headers: proxyHeaders(),
          body: JSON.stringify({
            model: 'mimo-v2.5-tts',
            messages: [
              {
                role: 'user',
                content: '用自然的声音朗读以下内容'
              },
              {
                role: 'assistant',
                content: text.slice(0, 2000) // 限制长度
              }
            ],
            audio: {
              format: 'wav',
              voice: 'Chloe'
            }
          })
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || `HTTP ${response.status}`);
        }

        const data = await response.json();

        if (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.audio) {
          const audioBase64 = data.choices[0].message.audio.data;
          if (audioBase64) {
            const audioBlob = base64ToBlob(audioBase64, 'audio/wav');
            const audioUrl = URL.createObjectURL(audioBlob);
            const audio = new Audio(audioUrl);
            audio.play();
            showToast('开始朗读');
            audio.onended = () => {
              URL.revokeObjectURL(audioUrl);
            };
          } else {
            throw new Error('无法获取音频数据');
          }
        } else {
          throw new Error('响应格式不正确');
        }
      } catch (error) {
        console.error('TTS 错误:', error);
        showToast('朗读失败: ' + (error.message || '未知错误'));
        // 降级到浏览器原生语音合成
        if ('speechSynthesis' in window) {
          showToast('使用系统语音...');
          const utterance = new SpeechSynthesisUtterance(text.slice(0, 200));
          utterance.lang = 'zh-CN';
          speechSynthesis.speak(utterance);
        }
      }
    }

    // Base64 转 Blob
    function base64ToBlob(base64, mimeType) {
      const byteCharacters = atob(base64);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      return new Blob([byteArray], { type: mimeType });
    }

    function insertTextIntoEditable(target, text) {
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        const start = typeof target.selectionStart === 'number' ? target.selectionStart : target.value.length;
        const end = typeof target.selectionEnd === 'number' ? target.selectionEnd : target.value.length;
        const nextValue = `${target.value.slice(0, start)}${text}${target.value.slice(end)}`;
        target.value = nextValue;
        const caret = start + text.length;
        target.setSelectionRange(caret, caret);
        target.dispatchEvent(new Event('input', { bubbles: true }));
        target.focus();
        return true;
      }

      if (target instanceof HTMLElement && target.isContentEditable) {
        target.focus();
        return document.execCommand('insertText', false, text);
      }

      return false;
    }

    function openCustomContextMenu(x, y, target) {
      if (!customContextMenu) return;
      customContextMenuTarget = target || document.activeElement || null;
      customContextMenu.classList.add('show');
      customContextMenu.setAttribute('aria-hidden', 'false');

      const menuWidth = customContextMenu.offsetWidth || 180;
      const menuHeight = customContextMenu.offsetHeight || 110;
      const maxLeft = Math.max(8, window.innerWidth - menuWidth - 8);
      const maxTop = Math.max(8, window.innerHeight - menuHeight - 8);
      customContextMenu.style.left = `${Math.min(Math.max(8, x), maxLeft)}px`;
      customContextMenu.style.top = `${Math.min(Math.max(8, y), maxTop)}px`;
    }

    async function handleContextMenuAction(action) {
      const source = customContextMenuTarget || document.activeElement || null;

      if (action === 'copy') {
        const text = getCopiedText(source) || getCopiedText(document.activeElement);
        if (!text) {
          showToast('没有可复制的内容');
          return;
        }

        const ok = await writeTextToClipboard(text);
        showToast(ok ? '已复制' : '复制失败');
        return;
      }

      if (action === 'paste') {
        const editable = getEditableElement(source) || getEditableElement(document.activeElement);
        if (!editable) {
          showToast('请先把光标放到输入框里再粘贴');
          return;
        }

        const text = await readClipboardText();
        if (!text) {
          showToast('剪贴板里没有可粘贴内容');
          return;
        }

        const ok = insertTextIntoEditable(editable, text);
        showToast(ok ? '已粘贴' : '粘贴失败');
      }
    }

    let devtoolsLastVisible = false;

    function showDevtoolsShield() {
      if (!devtoolsShield) return;
      closeCustomContextMenu();
      devtoolsLastVisible = true;
      devtoolsShield.classList.add('show');
    }

    function hideDevtoolsShield() {
      if (!devtoolsShield) return;
      devtoolsLastVisible = false;
      devtoolsShield.classList.remove('show');
    }

    function detectDevtools() {
      const widthGap = Math.abs(window.outerWidth - window.innerWidth);
      const heightGap = Math.abs(window.outerHeight - window.innerHeight);
      const isOpen = widthGap > 160 || heightGap > 160;
      if (isOpen) {
        showDevtoolsShield();
      } else if (devtoolsLastVisible) {
        hideDevtoolsShield();
      }
    }

    function setActiveView(view) {
      state.currentView = view;
      homeView.classList.toggle('active', view === 'home');
      imagesView.classList.toggle('active', view === 'images');
      navRows.forEach(row => row.classList.toggle('active', row.dataset.viewTarget === view));
      closePopover();
      closeModal();
      if (view === 'home') {
        updateHomeHeroText();
      }
    }

    function getTodayText() {
      const now = new Date();
      return `${now.getMonth() + 1}月${now.getDate()}日`;
    }

    function formatCountdownDuration(ms) {
      const totalSeconds = Math.max(0, Math.floor(ms / 1000));
      const days = Math.floor(totalSeconds / 86400);
      const hours = Math.floor((totalSeconds % 86400) / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;
      return `${days}天${String(hours).padStart(2, '0')}时${String(minutes).padStart(2, '0')}分${String(seconds).padStart(2, '0')}秒`;
    }

    function updateTokenExpiryNote() {
      if (!tokenExpiryNote || !tokenRemainingText) return;
      const remainingMs = TOKEN_END_DATE.getTime() - Date.now();
      if (remainingMs <= 0) {
        tokenExpiryNote.dataset.expired = 'true';
        tokenRemainingText.textContent = '· 已过期';
        return;
      }

      tokenExpiryNote.removeAttribute('data-expired');
      tokenRemainingText.textContent = `· 剩余 ${formatCountdownDuration(remainingMs)}`;
    }

    function updateRateLimitNote() {
      if (!rateLimitNote || !rateLimitUpdateTime || !userRateLimit || !modelRateLimit) return;
      clearExpiredQuotaLocks();

      const showModelQuota = isModelScopeModel(currentModel);
      const modelRateLimitItem = modelRateLimit.closest('.rate-limit-item');

      if (modelRateLimitItem) {
        modelRateLimitItem.style.display = showModelQuota ? '' : 'none';
      }

      if (rateLimitInfo.userLimit === null || rateLimitInfo.userRemaining === null) {
        userRateLimit.textContent = '暂无数据';
      } else {
        userRateLimit.textContent = `${rateLimitInfo.userRemaining}/${rateLimitInfo.userLimit}`;
      }

      if (showModelQuota) {
        const currentModelStatus = getModelStatus(currentModel);
        const modelLimit = currentModelStatus.quotaLimit ?? (rateLimitInfo.modelId === currentModel ? rateLimitInfo.modelLimit : null);
        const modelRemaining = currentModelStatus.quotaRemaining ?? (rateLimitInfo.modelId === currentModel ? rateLimitInfo.modelRemaining : null);
        if (modelLimit === null || modelRemaining === null) {
          modelRateLimit.textContent = '暂无数据';
        } else {
          modelRateLimit.textContent = `${modelRemaining}/${modelLimit}`;
        }
      } else {
        rateLimitInfo.modelLimit = null;
        rateLimitInfo.modelRemaining = null;
        rateLimitInfo.modelId = null;
      }

      if (rateLimitInfo.lastUpdateTime) {
        const updateTime = new Date(rateLimitInfo.lastUpdateTime);
        const timeStr = updateTime.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        rateLimitUpdateTime.textContent = `更新于 ${timeStr} · 部分火热模型共享池，部分模型不受此约束`;
      } else {
        rateLimitUpdateTime.textContent = '等待数据...';
      }
    }

    function getToolCallSignature(toolCall) {
      const args = parseToolArguments(toolCall?.arguments);
      return `${String(toolCall?.name || '').trim()}::${JSON.stringify(args)}`;
    }

    function updateRateLimitFromHeaders(headers, showModelQuota = isModelScopeModel(currentModel), responseStatus = 200, errorText = '') {
      applyQuotaSnapshotFromHeaders(currentModel, headers, {
        responseStatus,
        errorText,
        updateCurrentRateLimitInfo: showModelQuota,
      });
      persistModelTelemetryCache();
    }

    async function refreshRateLimitForCurrentModel(resetModelQuota = false) {
      const refreshToken = ++rateLimitRefreshToken;
      const targetModelId = currentModel;
      const showModelQuota = isModelScopeModel(targetModelId);

      if (!showModelQuota) {
        rateLimitInfo.modelLimit = null;
        rateLimitInfo.modelRemaining = null;
        rateLimitInfo.modelId = null;
        updateRateLimitNote();
      }

      try {
        const probeModel = getRateLimitRequestModelId(targetModelId);
        const probeEndpoint = getModelProbeEndpoint(targetModelId);
        const response = await fetch(EDGE_FUNCTION_URL, {
          method: 'POST',
          headers: proxyHeaders(),
          body: JSON.stringify({
            endpoint: 'ping',
            model: probeModel,
            probe_endpoint: probeEndpoint,
          })
        });

        if (refreshToken !== rateLimitRefreshToken || targetModelId !== currentModel) {
          return;
        }

        const payload = await response.json().catch(() => null);
        applyQuotaSnapshotFromHeaders(targetModelId, response.headers, {
          responseStatus: payload?.status || response.status,
          errorText: String(payload?.error || ''),
          updateCurrentRateLimitInfo: showModelQuota,
        });
        const latencyMs = Number.isFinite(payload?.latencyMs) ? Number(payload.latencyMs) : null;
        if (latencyMs !== null) {
          const status = getModelStatus(targetModelId);
          status.speedMs = latencyMs;
          status.speedLevel = getModelSpeedLevel(latencyMs);
          status.lastChecked = Date.now();
          if (payload?.ok === false) {
            status.error = String(payload?.error || '').slice(0, 80);
          } else {
            status.error = null;
          }
          modelStatus.set(targetModelId, normalizeModelStatusSnapshot(status));
        }
        updateRateLimitNote();
        updateModelDropdownIndicators();
        persistModelTelemetryCache();
      } catch (error) {
        // 静默失败，不影响页面使用
      }
    }

    function isDateQuestion(text) {
      const value = (text || '').replace(/\s+/g, '');
      return /几号|几月几日|今天几号|今天是几号|日期|星期几|今天星期几/.test(value);
    }

    function isModelQuestion(text) {
      const value = (text || '').replace(/\s+/g, '');
      return /什么模型|哪个模型|你是什么模型|模型是什么|谁支持|由谁支持/.test(value);
    }

    function escapeHtml(value) {
      return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function safeUrl(url) {
      const trimmed = String(url || '').trim();
      if (/^(https?:|\/)/i.test(trimmed)) return trimmed;
      return '#';
    }

    function renderInlineMarkdown(text) {
      const placeholders = [];
      const keep = html => {
        const token = `\u0000md${placeholders.length}\u0000`;
        placeholders.push([token, html]);
        return token;
      };
      let output = escapeHtml(text)
        .replace(/`([^`]+)`/g, (match, code) => keep(`<code>${code}</code>`))
        .replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (match, label, url) => {
          const href = safeUrl(url);
          if (href === '#') return label;
          return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
        })
        .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
        .replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
        .replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
        .replace(/(^|[^\*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
        .replace(/(^|[^_])_([^_\n]+)_(?!_)/g, '$1<em>$2</em>');
      placeholders.forEach(([token, html]) => {
        output = output.replaceAll(token, html);
      });
      return output;
    }

    function parseMarkdownTableRow(line) {
      const trimmed = String(line || '').trim().replace(/^\|/, '').replace(/\|$/, '');
      const cells = [];
      let cell = '';
      for (let i = 0; i < trimmed.length; i += 1) {
        const char = trimmed[i];
        const next = trimmed[i + 1];
        if (char === '\\' && next === '|') {
          cell += '|';
          i += 1;
          continue;
        }
        if (char === '|') {
          cells.push(cell.trim());
          cell = '';
          continue;
        }
        cell += char;
      }
      cells.push(cell.trim());
      return cells;
    }

    function isMarkdownTableSeparator(line) {
      const cells = parseMarkdownTableRow(line);
      return cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, '')));
    }

    function getMarkdownTableAlign(cell) {
      const value = cell.replace(/\s+/g, '');
      if (/^:-+:$/.test(value)) return 'center';
      if (/^-+:$/.test(value)) return 'right';
      if (/^:-+$/.test(value)) return 'left';
      return '';
    }

    function renderMarkdownTable(headers, separator, rows) {
      const aligns = separator.map(getMarkdownTableAlign);
      const renderCell = (tag, value, index) => {
        const align = aligns[index] ? ` style="text-align:${aligns[index]}"` : '';
        return `<${tag}${align}>${renderInlineMarkdown(value || '')}</${tag}>`;
      };
      const head = headers.map((cell, index) => renderCell('th', cell, index)).join('');
      const body = rows.map(row => {
        const cells = headers.map((header, index) => renderCell('td', row[index] || '', index)).join('');
        return `<tr>${cells}</tr>`;
      }).join('');
      return `<div class="md-table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
    }

    function renderMarkdown(markdown) {
      const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
      const blocks = [];
      let paragraph = [];
      let listType = '';
      let listItems = [];
      let codeLines = [];
      let inCode = false;

      function flushParagraph() {
        if (!paragraph.length) return;
        blocks.push(`<p>${paragraph.map(renderInlineMarkdown).join('<br>')}</p>`);
        paragraph = [];
      }

      function flushList() {
        if (!listItems.length) return;
        const hasTasks = listItems.some(item => item.task);
        const items = listItems.map(item => {
          if (!item.task) return `<li>${renderInlineMarkdown(item.content)}</li>`;
          const checked = item.checked ? ' checked' : '';
          return `<li class="task-list-item"><input type="checkbox" disabled${checked}>${renderInlineMarkdown(item.content)}</li>`;
        }).join('');
        const className = hasTasks ? ' class="contains-task-list"' : '';
        blocks.push(`<${listType}${className}>${items}</${listType}>`);
        listType = '';
        listItems = [];
      }

      function flushCode() {
        if (!codeLines.length) return;
        blocks.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
        codeLines = [];
      }

      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];

        if (line.trim().startsWith('```')) {
          if (inCode) {
            flushCode();
            inCode = false;
          } else {
            flushParagraph();
            flushList();
            inCode = true;
          }
          continue;
        }

        if (inCode) {
          codeLines.push(line);
          continue;
        }

        if (!line.trim()) {
          flushParagraph();
          flushList();
          continue;
        }

        if (i + 1 < lines.length && line.includes('|') && isMarkdownTableSeparator(lines[i + 1])) {
          flushParagraph();
          flushList();
          const headers = parseMarkdownTableRow(line);
          const separator = parseMarkdownTableRow(lines[i + 1]);
          const rows = [];
          i += 2;
          while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
            if (!isMarkdownTableSeparator(lines[i])) {
              rows.push(parseMarkdownTableRow(lines[i]));
            }
            i += 1;
          }
          i -= 1;
          blocks.push(renderMarkdownTable(headers, separator, rows));
          continue;
        }

        if (/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
          flushParagraph();
          flushList();
          blocks.push('<hr>');
          continue;
        }

        const heading = line.match(/^(#{1,6})\s+(.*)$/);
        if (heading) {
          flushParagraph();
          flushList();
          blocks.push(`<h${heading[1].length}>${renderInlineMarkdown(heading[2])}</h${heading[1].length}>`);
          continue;
        }

        const quote = line.match(/^>\s?(.*)$/);
        if (quote) {
          flushParagraph();
          flushList();
          blocks.push(`<blockquote>${renderInlineMarkdown(quote[1])}</blockquote>`);
          continue;
        }

        const ordered = line.match(/^\d+\.\s+(.*)$/);
        const unordered = line.match(/^[-*+]\s+(.*)$/);
        if (ordered || unordered) {
          flushParagraph();
          const nextType = ordered ? 'ol' : 'ul';
          if (!listType) listType = nextType;
          if (listType !== nextType) flushList();
          listType = nextType;
          const rawItem = (ordered || unordered)[1];
          const task = rawItem.match(/^\[([ xX])\]\s+(.*)$/);
          listItems.push(task ? {
            content: task[2],
            task: true,
            checked: task[1].toLowerCase() === 'x',
          } : {
            content: rawItem,
            task: false,
            checked: false,
          });
          continue;
        }

        flushList();
        paragraph.push(line);
      }

      flushParagraph();
      flushList();
      flushCode();

      return blocks.join('');
    }

    function renderAnimatedMarkdown(markdown) {
      return renderMarkdown(markdown);
    }

    function renderStreamingFragment(text) {
      return renderInlineMarkdown(String(text || '')).replace(/\r?\n/g, '<br>');
    }

    function syncStreamingMarkdownBlock(blockElement, streamState, text, { thinking = false, placeholder = '正在思考中…' } = {}) {
      const nextText = String(text || '');

      if (!nextText.trim()) {
        blockElement.classList.remove('is-streaming');
        blockElement.innerHTML = placeholder ? `<span class="typing-indicator">${escapeHtml(placeholder)}</span>` : '';
        streamState.text = '';
        streamState.ready = false;
        streamState.thinking = thinking;
        return;
      }

      if (streamState.ready && streamState.text === nextText && streamState.thinking === thinking) {
        return;
      }

      blockElement.classList.toggle('is-streaming', Boolean(thinking));
      blockElement.innerHTML = renderMarkdown(nextText);
      streamState.text = nextText;
      streamState.ready = true;
      streamState.thinking = thinking;
    }

    function getModelIdentity(modelId) {
      const identities = {
        'deepseek-v4-flash': '由NexusV支持的DeepSeekV4模型',
        'deepseek-v4-flash-dashscope': '由NexusV支持的DeepSeekV4模型',
        'deepseek-v4-pro': '由NexusV支持的DeepSeekV4-Pro模型',
        'deepseek-v4-pro-dashscope': '由NexusV支持的DeepSeekV4-Pro模型（线路二）',
        'step-3.5-flash': '由NexusV支持的Step-3.5模型',
        'hy3-preview': '由NexusV支持的混元3模型',
        'gpt-oss-120b': '由NexusV支持的chatGPT-OSS模型',
        'nemotron-3-super': '由NexusV支持的Nemotron-3-super模型',
        'ling-2.6-1t': '由NexusV支持的ling-2.6模型',
        'ling-2.6-1t-modelscope': '由NexusV支持的ling-2.6模型（魔塔线路二）',
        'spark-x2': '由NexusV支持的spark-x2模型',
        'qwen3.5': '由NexusV支持的Qwen3.5模型',
        'qwen3-coder': '由NexusV支持的Qwen3-Coder模型',
        'kimi-k2.5': '由NexusV支持的Kimi-K2.5模型',
        'kimi-k2.6': '由NexusV支持的Kimi-K2.6模型（线路一）',
        'kimi-k2.6-moonshot': '由NexusV支持的Kimi-K2.6模型（线路二）',
        'glm-5': '由NexusV支持的GLM-5模型',
        'glm-5.1': '由NexusV支持的GLM-5.1模型',
        'glm-5.1-dashscope': '由NexusV支持的GLM-5.1模型',
        'glm-4.7': '由NexusV支持的GLM-4.7模型',
        'deepseek-r1': '由NexusV支持的DeepSeek-R1模型',
        'minimax-m2.5': '由NexusV支持的MiniMax-M2.5模型',
        'qwen3.6-max-preview': '由NexusV支持的qwen3.6-max-preview模型',
        'qwen3.6-plus': '由NexusV支持的qwen3.6-plus模型',
        // 百炼新增模型
        'qwen3.6-flash': '由NexusV支持的Qwen3.6-Flash模型（百炼）',
        'kimi-k2.5-dashscope': '由NexusV支持的Kimi-K2.5模型（百炼线路二）',
        'deepseek-v3.2': '由NexusV支持的DeepSeek-V3.2模型（百炼）',
        'deepseek-v3.2-exp': '由NexusV支持的DeepSeek-V3.2-Exp模型（百炼）',
        'glm-4.5-air': '由NexusV支持的GLM-4.5-Air模型（百炼）',
        'minimax-m2.5-dashscope': '由NexusV支持的MiniMax-M2.5模型（百炼线路二）',
        'deepseek-v3.1': '由NexusV支持的DeepSeek-V3.1模型（百炼）',
        'qwen3-coder-plus': '由NexusV支持的Qwen3-Coder-Plus模型（百炼）',
        'qwen3-max': '由NexusV支持的Qwen3-Max模型（百炼）',
        'kimi-k2-instruct': '由NexusV支持的Kimi-K2-Instruct模型（百炼）',
        'qwen3.6-plus-20260402': '由NexusV支持的Qwen3.6-Plus模型（百炼线路三）',
        'deepseek-r1-0528': '由NexusV支持的DeepSeek-R1-0528模型（百炼线路三）',
        // MiMo 模型
        'mimo-v2.5-pro': '由NexusV支持的MiMo-V2.5-Pro模型（小米）',
        // 缺失的模型
        'gpt-5.4': '由NexusV支持的GPT-5.4模型',
        'kimi-k2.6-line3': '由NexusV支持的Kimi-K2.6模型（线路三）',
        // NewAPI 模型
        'claude-opus-4.6': '由NexusV支持的Claude Opus 4.6模型',
        'claude-sonnet-4.6': '由NexusV支持的Claude Sonnet 4.6模型',
        'gemini-2.5-pro': '由NexusV支持的Gemini 2.5 Pro模型'
      };
      return identities[modelId] || identities['deepseek-v4-flash'];
    }

    function getAvailableToolDefinitions() {
      return [...ARTICLE_TOOL_DEFINITIONS, WEB_SEARCH_TOOL_DEFINITION, FETCH_WEB_PAGE_TOOL_DEFINITION];
    }

    function getHomeDisplayName() {
      const rawName = String(document.querySelector('.account-name')?.textContent || 'Jony').trim();
      const normalized = rawName.replace(/^mr\.?/i, '').trim();
      return normalized || 'Jony';
    }

    function pickHomeText(candidates) {
      if (!Array.isArray(candidates) || !candidates.length) return '';
      const now = new Date();
      const seed = now.getFullYear() + now.getMonth() + now.getDate() + now.getHours() + now.getMinutes() + now.getSeconds();
      return candidates[Math.abs(seed) % candidates.length];
    }

    function getDefaultHomeHeroText() {
      const now = new Date();
      const hour = now.getHours();
      const weekday = now.getDay();
      const name = getHomeDisplayName();

      if (weekday === 0 || weekday === 6) {
        return pickHomeText([
          `周末的${name}，想整点什么？`,
          `${name}，周末也来搞点新东西？`,
          `${name} 来了！周末想玩点什么？`
        ]);
      }

      if (hour < 5) {
        return pickHomeText([
          `还没睡觉的${name}，想做点什么？`,
          `夜深了，${name}，还在忙什么？`
        ]);
      }

      if (hour < 11) {
        return pickHomeText([
          `早上好，${name}`,
          `${name}，早安，今天先做哪件事？`,
          `${name} 来了！`
        ]);
      }

      if (hour < 14) {
        return pickHomeText([
          `中午好，${name}`,
          `${name}，午安，来点新想法？`
        ]);
      }

      if (hour < 18) {
        return pickHomeText([
          `下午好，${name}`,
          `${name}，下午先推进点什么？`
        ]);
      }

      return pickHomeText([
        `晚上好，${name}`,
        `${name}，今晚想聊点什么？`,
        `${name}，来继续开工？`
      ]);
    }

    function getModeHomeHeroText(mode) {
      const name = getHomeDisplayName();
      if (mode === 'image') {
        return pickHomeText([
          '来点爆炸般的艺术？',
          '把脑洞画出来？',
          '来一张惊艳一点的图？',
          `${name}，今天想生成点什么图？`
        ]);
      }

      if (mode === 'video') {
        return pickHomeText([
          '看看新花样！',
          '让画面动起来？',
          '来一段会动的作品？',
          `${name}，今天想拍点什么？`
        ]);
      }

      return getDefaultHomeHeroText();
    }

    function updateHomeModeChips() {
      document.getElementById('imageModeChipBtn')?.classList.toggle('active', state.homeMode === 'image');
      document.getElementById('videoModeChipBtn')?.classList.toggle('active', state.homeMode === 'video');
    }

    function updateHomeHeroText() {
      if (!heroTitle) return;
      if (state.homeMode === 'image' || state.homeMode === 'video') {
        heroTitle.textContent = getModeHomeHeroText(state.homeMode);
        return;
      }
      heroTitle.textContent = state.recentProjectName ? `继续处理「${state.recentProjectName}」？` : getDefaultHomeHeroText();
    }

    function setHomeMode(mode) {
      state.homeMode = state.homeMode === mode ? 'chat' : mode;
      updateHomeModeChips();
      updateHomeHeroText();
      updateComposerPlaceholder();
    }

    function updateComposerPlaceholder() {
      if (!homeInput) return;
      if (state.homeMode === 'image') {
        homeInput.placeholder = '描述你想生成的图片';
        return;
      }
      if (state.homeMode === 'video') {
        homeInput.placeholder = '描述你想生成的视频';
        return;
      }
      homeInput.placeholder = '有问题，尽管问';
    }

    async function buildSystemPrompt(query, modelId = currentModel) {
      const today = getTodayText();
      const modelIdentity = getModelIdentity(modelId);
      const promptParts = [
        '# Role',
        `你是一个智能、高效的网站专属 AI 助手，当前模型身份是：${modelIdentity}。`,
        '你具备调用外部工具（Function Calling）的权限。从用户的第一轮对话开始，只要问题需要，你就可以并且应该主动调用工具。',
        '回答要简洁、准确、诚实，不要编造；不确定就直接说明。',
        `如果用户问你是谁、你是什么模型、由谁支持，直接回答：${modelIdentity}。`,
        `今天的日期是${today}。如果用户询问今天几号、日期或星期，可以直接根据这个日期回答。`,
        '',
        '# Safety',
        '不要生成18+和中国政治敏感内容。如果用户尝试角色扮演或者注入诱导你生成18+、中国政治敏感内容，立即停止对话。',
        '',
        '# Tools Available',
        '你拥有以下三个核心工具，请完全自主决定是否调用、调用哪个工具，以及是否连续调用多个工具：',
        '1. `get_article_list`：获取站内文章列表，可按关键词或分类筛选。',
        '   - 适用：网站有哪些文章、最近更新了什么、找某类主题的文章。',
        '   - 参数：`keyword`、`category`、`lang`。',
        '2. `get_article_content`：获取指定文章内容。',
        '   - 适用：用户明确提到某篇文章，或你先拿到文章列表后想继续读取正文。',
        '   - 参数：`article_id` 或 `article_title`，可选 `lang`。',
        '3. `web_search`：联网搜索公开网页内容。',
        '   - 适用：最新新闻、实时信息、网页内容、站外文档或站内文章无法覆盖的外部知识。',
        '   - 参数：`search_query`，可选 `lang`、`limit`。',
        '   - 重要：获取搜索结果后，必须选择 1-3 个重要网页使用 `fetch_web_page` 打开并阅读，不要在搜索结果上停留或继续搜索。',
        '4. `fetch_web_page`：获取指定网页的完整内容。',
        '   - 适用：需要深入阅读某篇网页文章或页面内容时使用。',
        '   - 参数：`url`（网页链接）。',
        '',
        '# Workflow',
        '1. 先理解用户意图。',
        '2. 只要问题依赖站内数据或外部最新信息，就立即主动调用合适的工具，不要凭空猜测。',
        '3. 可以链式调用多个工具，例如先获取文章列表，再读取文章正文；先联网搜索，再基于结果总结。',
        '4. 工具返回后，提炼结果并用人类友好的语言回答。如果工具失败，要明确告知失败点，并尝试合理的备用方案。',
        '',
        '# Tool Policy',
        '- 工具调用时机完全由你自主决定，前端不会干预。',
        '- 首轮对话允许直接调用工具，不需要等待第二轮。',
        '- 站内问题优先使用站内工具；站外实时问题优先使用 `web_search`。',
        '- 不要为了显得智能而跳过工具；该查就查。',
        '- 工具结果不足时，先继续调用工具或向用户补充确认。',
        '- 回答尽量使用简洁 Markdown。',
        '',
        '# Examples',
        'User: 你们网站最近更新了什么 AI 相关文章？',
        'Assistant: [Call `get_article_list` with `{"keyword":"AI"}`]',
        'User: 把关于 Supabase 教程的文章内容发我看看。',
        'Assistant: [Call `get_article_list` with `{"keyword":"Supabase"}`]',
        'Assistant: [Call `get_article_content` with `{"article_id":"..."}`]',
        'User: 昨天马斯克发了什么推特？',
        'Assistant: [Call `web_search` with `{"search_query":"马斯克 推特 昨天"}`]',
      ];

      return promptParts.join('\n');
    }

    function scrollChatToBottom(smooth = true) {
      if (!chatMessages) return;
      if (smooth) {
        chatMessages.scrollTo({ top: chatMessages.scrollHeight, behavior: 'smooth' });
      } else {
        chatMessages.scrollTop = chatMessages.scrollHeight;
      }
    }

    function setComposerBusy(isBusy) {
      state.isStreaming = isBusy;
      sendChatBtn.disabled = isBusy || (!homeInput.value.trim() && !pendingAttachments.length);
      homeInput.disabled = isBusy;
      if (voiceInputBtn) {
        voiceInputBtn.disabled = isBusy;
      }
      sendChatBtn.setAttribute('aria-disabled', String(sendChatBtn.disabled));
    }

    function sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    function createAbortError(message = '请求已取消，请重试。') {
      const error = new Error(message);
      error.name = 'AbortError';
      return error;
    }

    function createTimeoutError(timeoutMs, label = '请求') {
      const seconds = Math.max(1, Math.round(timeoutMs / 1000));
      return createAbortError(`${label}超时（>${seconds} 秒），请重试。`);
    }

    function normalizeErrorMessage(error, fallback = '请求失败，请稍后再试。') {
      if (!error) return fallback;
      if (error.name === 'AbortError') {
        return error.message && error.message !== 'The operation was aborted.'
          ? error.message
          : '请求已取消或超时，请重试。';
      }
      const message = error instanceof Error ? error.message : String(error);
      if (/challenge_required|access_blocked|异常高频|安全验证|停止为此 IP 提供服务/.test(message)) {
        return message.replace(/^Error:\s*/i, '');
      }
      if (message.includes('诊断:') || message.includes('后端返回 HTTP')) {
        return message;
      }
      const httpMatch = message.match(/\b(?:HTTP(?: error! status)?|status)\s*:?\s*(\d{3})/i);
      if (httpMatch) {
        return getFriendlyHttpStatusMessage(httpMatch[1]);
      }
      if (/额度已用完|quota|limit/i.test(message)) {
        return '当前模型额度已用完，请切换其他模型再试。';
      }
      if (/^failed to fetch$/i.test(message || '')) {
        return '网络请求失败，请检查 Edge Function 是否已部署、CORS 是否生效，或稍后重试。';
      }
      return message || fallback;
    }

    function startAbortTimer(controller, timeoutMs, label = '请求') {
      const timeoutId = setTimeout(() => {
        controller.abort(createTimeoutError(timeoutMs, label));
      }, timeoutMs);
      return () => clearTimeout(timeoutId);
    }

    async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS, label = '请求') {
      const controller = new AbortController();
      const parentSignal = options.signal;
      const relayAbort = () => controller.abort(parentSignal?.reason || createAbortError());

      if (parentSignal) {
        if (parentSignal.aborted) {
          controller.abort(parentSignal.reason || createAbortError());
        } else {
          parentSignal.addEventListener('abort', relayAbort, { once: true });
        }
      }

      const timeoutId = setTimeout(() => {
        controller.abort(createTimeoutError(timeoutMs, label));
      }, timeoutMs);

      try {
        return await fetch(url, {
          ...options,
          signal: controller.signal,
        });
      } catch (error) {
        if (error?.name === 'AbortError') {
          throw createAbortError(normalizeErrorMessage(error, `${label}已取消，请重试。`));
        }
        throw new Error(normalizeErrorMessage(error, `${label}失败，请稍后再试。`));
      } finally {
        clearTimeout(timeoutId);
        if (parentSignal) {
          parentSignal.removeEventListener('abort', relayAbort);
        }
      }
    }

    function setImageGenerationBusy(isBusy, statusText) {
      state.isImageGenerating = isBusy;
      imagePromptInput.disabled = isBusy;
      sendImagePromptBtn.disabled = isBusy || !imagePromptInput.value.trim();
      sendImagePromptBtn.setAttribute('aria-disabled', String(sendImagePromptBtn.disabled));
      if (typeof statusText === 'string') {
        imageGenerationStatus.textContent = statusText;
      }
    }

    function appendGeneratedImageCard(imageUrl, prompt) {
      if (!generatedImageGrid) return;
      const emptyCard = document.getElementById('generatedImageEmpty');
      if (emptyCard) emptyCard.remove();

      const card = document.createElement('div');
      card.className = 'grid-card';
      card.title = prompt;

      const image = document.createElement('img');
      image.alt = prompt;
      image.src = imageUrl;

      const caption = document.createElement('div');
      caption.style.position = 'absolute';
      caption.style.left = '12px';
      caption.style.right = '12px';
      caption.style.bottom = '12px';
      caption.style.zIndex = '1';
      caption.style.color = '#fff';
      caption.style.fontSize = '12px';
      caption.style.fontWeight = '650';
      caption.style.textShadow = '0 2px 10px rgba(0,0,0,.32)';
      caption.style.whiteSpace = 'nowrap';
      caption.style.overflow = 'hidden';
      caption.style.textOverflow = 'ellipsis';
      caption.textContent = prompt;

      card.appendChild(image);
      card.appendChild(caption);
      card.addEventListener('click', () => window.open(imageUrl, '_blank', 'noopener,noreferrer'));
      generatedImageGrid.prepend(card);
    }

    async function generateImageFromPrompt(prompt, imageModel = MODELSCOPE_IMAGE_MODEL) {
      const value = String(prompt || '').trim();
      if (!value || state.isImageGenerating) return;

      const isOpenAIImage = imageModel === 'dall-e-3';

      setImageGenerationBusy(true, isOpenAIImage ? '正在生成图片...' : '正在提交图片生成任务...');
      showToast('图片生成已开始，请稍等。');

      let finalStatusText = '等待输入提示词';

      try {
        const response = await fetch(EDGE_FUNCTION_URL, {
          method: 'POST',
          headers: proxyHeaders(),
          body: JSON.stringify({
            endpoint: 'image',
            model: imageModel,
            prompt: value,
            n: 1,
            size: '1024x1024',
            response_format: 'url'
          })
        });

        if (response.status === 429) {
          throw new Error(RATE_LIMIT_MESSAGE);
        }

        if (!response.ok) {
          const errorText = await response.text().catch(() => '');
          let detail = errorText.trim();
          if (detail) {
            const parsed = parseBackendErrorPayload(detail);
            detail = parsed.code === 'challenge_required' || parsed.code === 'access_blocked'
              ? formatSecurityGuardMessage(parsed)
              : parsed.message || detail;
          }
          throw new Error(detail || `HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        // OpenAI-compatible API returns images directly
        if (isOpenAIImage) {
          const imageUrl = data?.data?.[0]?.url;
          if (!imageUrl) {
            throw new Error('生成成功，但没有返回图片地址。');
          }
          appendGeneratedImageCard(imageUrl, value);
          imagePromptInput.value = '';
          imageGenerationStatus.textContent = '图片已生成。';
          finalStatusText = '图片已生成。';
          showToast('图片已生成。');
          return;
        }

        // ModelScope async task-based flow
        const taskId = data.task_id;
        if (!taskId) {
          throw new Error('未返回 task_id。');
        }

        setImageGenerationBusy(true, '任务已提交，正在生成图片...');

        while (true) {
          const resultResponse = await fetch(EDGE_FUNCTION_URL, {
            method: 'POST',
            headers: proxyHeaders(),
            body: JSON.stringify({
              endpoint: 'task',
              taskId: taskId
            })
          });

          if (resultResponse.status === 429) {
            setImageGenerationBusy(true, RATE_LIMIT_MESSAGE);
            await sleep(5000);
            continue;
          }

          if (!resultResponse.ok) {
            const errorText = await resultResponse.text().catch(() => '');
            const parsed = parseBackendErrorPayload(errorText);
            const detail = parsed.code === 'challenge_required' || parsed.code === 'access_blocked'
              ? formatSecurityGuardMessage(parsed)
              : parsed.message;
            throw new Error(detail || `HTTP error! status: ${resultResponse.status}`);
          }

          const taskData = await resultResponse.json();

          if (taskData.task_status === 'SUCCEED') {
            const imageUrl = taskData.output_images && taskData.output_images[0];
            if (!imageUrl) {
              throw new Error('生成成功，但没有返回图片地址。');
            }

            appendGeneratedImageCard(imageUrl, value);
            imagePromptInput.value = '';
            imageGenerationStatus.textContent = '图片已生成。';
            finalStatusText = '图片已生成。';
            showToast('图片已生成。');
            break;
          }

          if (taskData.task_status === 'FAILED') {
            throw new Error('Image Generation Failed.');
          }

          setImageGenerationBusy(true, `正在生成中... ${taskData.task_status || 'PENDING'}`);
          await sleep(5000);
        }
      } catch (error) {
        if (error.message === RATE_LIMIT_MESSAGE) {
          imageGenerationStatus.textContent = RATE_LIMIT_MESSAGE;
          finalStatusText = RATE_LIMIT_MESSAGE;
          showToast(RATE_LIMIT_MESSAGE);
        } else if (error.name !== 'AbortError') {
          imageGenerationStatus.textContent = `生成失败：${error.message}`;
          finalStatusText = `生成失败：${error.message}`;
          showToast(`图片生成失败：${error.message}`);
        }
      } finally {
        setImageGenerationBusy(false, finalStatusText);
      }
    }

    function createUserMessage(content, attachments = []) {
      const messageDiv = document.createElement('div');
      messageDiv.className = 'message user';

      const avatar = document.createElement('div');
      avatar.className = 'message-avatar';
      avatar.textContent = 'U';

      const bubble = document.createElement('div');
      bubble.className = 'message-content md-content';
      const normalizedContent = Array.isArray(content) ? extractUserMessageParts(content) : null;
      const messageAttachments = attachments.length ? attachments : (normalizedContent?.attachments || []);
      const text = normalizedContent ? normalizedContent.text : String(content || '').trim();

      const textBlock = document.createElement('div');
      textBlock.textContent = text || (messageAttachments.length ? '已发送图片' : '');
      bubble.appendChild(textBlock);

      if (messageAttachments.length) {
        const attachmentGrid = document.createElement('div');
        attachmentGrid.className = 'user-attachments';

        messageAttachments.forEach(attachment => {
          const item = document.createElement('div');
          item.className = 'user-attachment';

          if (attachment.isTextFile) {
            const icon = document.createElement('div');
            icon.className = 'attachment-file-icon';
            icon.innerHTML = `
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
              </svg>
            `;
            item.appendChild(icon);
          } else {
            const img = document.createElement('img');
            img.src = attachment.dataUrl || attachment.previewUrl || attachment.url;
            img.alt = attachment.name;
            item.appendChild(img);
          }

          const label = document.createElement('div');
          label.className = 'user-attachment-label';
          label.textContent = attachment.name;

          item.appendChild(label);
          item.addEventListener('click', () => window.open(attachment.dataUrl || attachment.previewUrl || attachment.url, '_blank', 'noopener,noreferrer'));
          attachmentGrid.appendChild(item);
        });

        bubble.appendChild(attachmentGrid);
      }

      messageDiv.appendChild(avatar);
      messageDiv.appendChild(bubble);
      chatMessages.appendChild(messageDiv);
      scrollChatToBottom(false);
    }

    function createAssistantMessage() {
      const messageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const messageDiv = document.createElement('div');
      messageDiv.className = 'message assistant';
      messageDiv.id = messageId;

      const avatar = document.createElement('div');
      avatar.className = 'message-avatar';
      avatar.textContent = 'A';

      const bubble = document.createElement('div');
      bubble.className = 'message-content md-content';

      const thinkBlock = document.createElement('details');
      thinkBlock.className = 'think-block';
      thinkBlock.hidden = true;
      thinkBlock.open = true;

      const thinkSummary = document.createElement('summary');
      thinkSummary.innerHTML = `
        <span class="think-label">思考过程</span>
        <div class="think-spinner" style="display: none;"></div>
      `;

      const thinkBody = document.createElement('div');
      thinkBody.className = 'think-body md-content';

      const answerBody = document.createElement('div');
      answerBody.className = 'answer-body md-content';
      answerBody.innerHTML = '<span class="typing-indicator">正在思考中…</span>';

      const toolCallsContainer = document.createElement('div');
      toolCallsContainer.className = 'tool-calls-container';

      const messageActions = document.createElement('div');
      messageActions.className = 'message-actions';
      messageActions.innerHTML = `
        <button class="message-action-btn" data-action="copy" title="复制">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <rect x="9" y="9" width="13" height="13" rx="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
          <span>复制</span>
        </button>
        <button class="message-action-btn" data-action="speak" title="朗读">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
          </svg>
          <span>朗读</span>
        </button>
        <button class="message-action-btn" data-action="quote" title="引用">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/>
            <path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/>
          </svg>
          <span>引用</span>
        </button>
      `;

      thinkBlock.appendChild(thinkSummary);
      thinkBlock.appendChild(thinkBody);
      bubble.appendChild(thinkBlock);
      bubble.appendChild(toolCallsContainer);
      bubble.appendChild(answerBody);
      bubble.appendChild(messageActions);
      messageDiv.appendChild(avatar);
      messageDiv.appendChild(bubble);

      messageActions.querySelector('[data-action="copy"]').addEventListener('click', async () => {
        const text = answerBody.textContent || '';
        if (!text || text === '正在思考中…') {
          showToast('没有可复制的内容');
          return;
        }
        const ok = await writeTextToClipboard(text);
        showToast(ok ? '已复制' : '复制失败');
      });

      messageActions.querySelector('[data-action="quote"]').addEventListener('click', () => {
        const text = answerBody.textContent || '';
        if (!text || text === '正在思考中…') {
          showToast('没有可引用的内容');
          return;
        }
        // 截取前200字符作为引用
        const quoteText = text.length > 200 ? text.slice(0, 200) + '…' : text;
        const quotedContent = `> ${quoteText.replace(/\n/g, '\n> ')}\n\n`;
        homeInput.value = quotedContent + homeInput.value;
        homeInput.focus();
        showToast('已引用到输入框');
      });

      messageActions.querySelector('[data-action="speak"]').addEventListener('click', async () => {
        const text = answerBody.textContent || '';
        if (!text || text === '正在思考中…') {
          showToast('没有可朗读的内容');
          return;
        }
        await speakTextWithMimo(text);
      });

      messageDiv._parts = {
        thinkBlock,
        thinkBody,
        answerBody,
        toolCallsContainer,
        messageActions,
        thinkStreamState: { text: '', ready: false },
        answerStreamState: { text: '', ready: false },
      };
      chatMessages.appendChild(messageDiv);
      scrollChatToBottom(false);

      return messageId;
    }

    function updateAssistantMessage(messageId, { reasoning = '', answer = '', thinking = false } = {}) {
      const messageDiv = document.getElementById(messageId);
      if (!messageDiv || !messageDiv._parts) return;

      const {
        thinkBlock,
        thinkBody,
        answerBody,
        toolCallsContainer,
        thinkStreamState,
        answerStreamState,
      } = messageDiv._parts;
      const reasoningText = String(reasoning ?? '');
      const answerText = String(answer ?? '');
      const hasReasoning = Boolean(reasoningText.trim());
      const hasAnswer = Boolean(answerText.trim());

      thinkBlock.hidden = !hasReasoning;
      if (hasReasoning) {
        syncStreamingMarkdownBlock(thinkBody, thinkStreamState, reasoningText, { thinking });
        thinkBlock.open = true;
      } else {
        thinkBody.innerHTML = '';
        thinkStreamState.text = '';
        thinkStreamState.ready = false;
      }

      const thinkSpinner = thinkBlock.querySelector('.think-spinner');
      if (thinkSpinner) {
        thinkSpinner.style.display = thinking ? 'block' : 'none';
      }

      if (hasAnswer) {
        syncStreamingMarkdownBlock(answerBody, answerStreamState, answerText, { thinking, placeholder: '正在思考中…' });
      } else if (thinking) {
        answerBody.innerHTML = '<span class="typing-indicator">正在思考中…</span>';
        answerStreamState.text = '';
        answerStreamState.ready = false;
      } else {
        answerBody.innerHTML = '';
        answerStreamState.text = '';
        answerStreamState.ready = false;
      }

      scrollChatToBottom();
    }

    function clearConversation() {
      stopVoiceRecognition();
      if (state.activeRequestController) {
        state.activeRequestController.abort();
        state.activeRequestController = null;
      }
      conversationHistory.length = 0;
      clearPendingAttachments();
      updateContextMeter();
      chatMessages.innerHTML = '';
      chatMessages.classList.remove('active');
      homeView.classList.remove('chatting');
      homeInput.value = '';
      updateHomeHeroText();
      setComposerBusy(false);
      homeInput.focus();
    }

    function pushHistory(roleOrMessage, content, extra = {}) {
      const message = typeof roleOrMessage === 'object' && roleOrMessage !== null
        ? { ...roleOrMessage }
        : { role: roleOrMessage, content, ...extra };

      conversationHistory.push(message);
      updateContextMeter();
    }

    async function saveOrUpdateChatHistory() {
      try {
        if (currentChatId) {
          await updateChatHistory(currentChatId, conversationHistory);
        } else if (conversationHistory.length > 0) {
          await saveChatHistory(conversationHistory);
        }
        // 刷新聊天记录列表
        renderChatHistoryList();
      } catch (error) {
        console.error('自动保存聊天记录失败:', error);
      }
    }

    async function finalizeConversationTurn() {
      await saveOrUpdateChatHistory();
      clearPendingAttachments();
    }

    function normalizeHistoryContentForModel(content, modelId) {
      if (!Array.isArray(content)) return content;
      // 多模态模型保留完整内容
      if (isMultimodalModel(modelId)) return content;

      const textParts = content
        .filter(part => part && part.type === 'text' && typeof part.text === 'string')
        .map(part => part.text.trim())
        .filter(Boolean);
      const imageCount = content.filter(part => part && part.type === 'image_url').length;

      const summaryParts = [];
      if (textParts.length) summaryParts.push(textParts.join(' '));
      if (imageCount) summaryParts.push(`（含 ${imageCount} 张图片）`);
      return summaryParts.join(' ').trim() || '（包含图片上下文）';
    }

    function buildRecentConversationSnapshot(history = conversationHistory, maxEntries = 8) {
      if (!Array.isArray(history) || !history.length) return '';

      const relevantMessages = history.filter(message => message && ['user', 'assistant', 'tool'].includes(message.role));
      const recentMessages = relevantMessages.slice(-maxEntries);
      if (!recentMessages.length) return '';

      const lines = recentMessages.map(message => {
        const role = message.role === 'user' ? '用户' : message.role === 'assistant' ? '助手' : '工具';
        const toolName = message.role === 'tool'
          ? `(${String(message.name || message.tool_call_id || '').trim() || 'tool'})`
          : '';
        const contentText = describeContentForCompression(message.content)
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 260);
        return `${role}${toolName}: ${contentText || '（空内容）'}`;
      });

      return ['# 最近对话摘要', ...lines].join('\n');
    }

    function findLastMultimodalAnchorIndex(history = conversationHistory) {
      if (!Array.isArray(history) || !history.length) return -1;

      for (let index = history.length - 1; index >= 0; index -= 1) {
        const content = history[index]?.content;
        if (!Array.isArray(content)) continue;
        if (content.some(part => part && (part.type === 'image_url' || part.type === 'input_file'))) {
          return index;
        }
      }

      return -1;
    }

    function describeContentForCompression(content) {
      if (!Array.isArray(content)) return String(content || '').trim();

      const textParts = content
        .filter(part => part && part.type === 'text' && typeof part.text === 'string')
        .map(part => part.text.trim())
        .filter(Boolean);
      const imageCount = content.filter(part => part && part.type === 'image_url').length;

      const summaryParts = [];
      if (textParts.length) summaryParts.push(textParts.join(' '));
      if (imageCount) summaryParts.push(`（含 ${imageCount} 张图片）`);
      return summaryParts.join(' ').trim() || '（包含图片上下文）';
    }

    async function buildApiMessages(query, extraSystemContent = '', userContent = null, modelId = currentModel) {
      const systemPrompt = await buildSystemPrompt(query, modelId);
      const recentConversationSnapshot = buildRecentConversationSnapshot(conversationHistory, 8);
      const hasImageAttachment = Array.isArray(userContent)
        && userContent.some(part => part && part.type === 'image_url');
      const multimodalHint = hasImageAttachment
        ? '本轮用户附带了图片，请先识别图片内容，再结合文字回答；不要忽略图片附件。'
        : '';
      const mergedSystemContent = [systemPrompt, recentConversationSnapshot, extraSystemContent, multimodalHint].filter(Boolean).join('\n\n');
      const messages = [{ role: 'system', content: mergedSystemContent }];
      conversationHistory.forEach(message => {
        messages.push({
          ...message,
          content: normalizeHistoryContentForModel(message.content, modelId),
        });
      });
      messages.push({
        role: 'user',
        content: normalizeHistoryContentForModel(userContent ?? query, modelId),
      });
      return messages;
    }

    function buildConversationCompressionTranscript(modelId = currentModel) {
      return conversationHistory.map((message, index) => {
        const role = String(message?.role || 'assistant').toUpperCase();
        const contentText = describeContentForCompression(message?.content);
        const toolNames = Array.isArray(message?.tool_calls)
          ? message.tool_calls.map(call => call?.function?.name || call?.name).filter(Boolean).join(', ')
          : '';
        return `[${index + 1}] ${role}${toolNames ? ` [tools: ${toolNames}]` : ''}\n${contentText || '（空内容）'}`;
      }).join('\n\n');
    }

    async function requestConversationCompression(modelId = currentModel) {
      if (!conversationHistory.length) return false;

      const transcript = buildConversationCompressionTranscript(modelId);
      if (!transcript.trim()) return false;

      const response = await fetchWithTimeout(EDGE_FUNCTION_URL, {
        method: 'POST',
        headers: proxyHeaders(),
        body: JSON.stringify({
          endpoint: 'chat',
          model: MODEL_IDS[modelId] || MODEL_IDS['deepseek-v4-flash'],
          messages: [
            {
              role: 'system',
              content: '你将收到一整段历史对话。请将其压缩为可继续聊天的简明摘要。必须保留：目标、已确认事实、用户偏好、重要约束、未完成事项、待继续的问题。请用简洁中文输出，格式固定为：## 目标\n## 已确认信息\n## 未完成事项\n## 延续建议。不要编造。'
            },
            {
              role: 'user',
              content: `请压缩以下历史对话：\n\n${transcript}`
            }
          ],
          stream: false,
          temperature: 0.2
        })
      }, CHAT_REQUEST_TIMEOUT_MS, '上下文压缩');

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        let detail = errorText.trim();
        if (detail) {
          try {
            const parsed = parseBackendErrorPayload(detail);
            detail = parsed.code === 'challenge_required' || parsed.code === 'access_blocked'
              ? formatSecurityGuardMessage(parsed)
              : parsed.message || detail;
          } catch (parseError) {
            // keep raw text
          }
        }
        throw new Error(detail || `上下文压缩失败：HTTP ${response.status}`);
      }

      const data = await response.json();
      const summary = String(data?.choices?.[0]?.message?.content || '').trim();
      if (!summary) {
        throw new Error('上下文压缩未返回摘要');
      }

      const previousHistory = conversationHistory.slice();

      conversationHistory = [{
        role: 'system',
        content: `以下是上一段对话的压缩摘要，请在后续回合继续沿用其中已确认的事实、目标、约束与待办。\n\n${summary}`
      }];

      if (isMultimodalModel(modelId)) {
        const anchorIndex = findLastMultimodalAnchorIndex(previousHistory);
        if (anchorIndex >= 0) {
          const preserveWindow = 12;
          const tailStart = Math.max(anchorIndex, previousHistory.length - (preserveWindow - 1));
          const preservedMessages = previousHistory.slice(tailStart).map(message => ({ ...message }));
          if (anchorIndex < tailStart && previousHistory[anchorIndex]) {
            preservedMessages.unshift({ ...previousHistory[anchorIndex] });
          }
          conversationHistory = [
            conversationHistory[0],
            ...preservedMessages,
          ];
        }
      }

      currentChatId = null;
      chatMessages.innerHTML = '';
      homeView.classList.add('chatting');
      chatMessages.classList.add('active');
      renderMessages();
      updateContextMeter();
      showToast('上下文已自动压缩，并作为新对话继续');
      return true;
    }

    async function ensureContextBudget(nextUserContent = '', modelId = currentModel) {
      const projectedTokens = estimateConversationTokens(conversationHistory) + estimateMessageTokens({ role: 'user', content: nextUserContent });
      if (projectedTokens <= CONTEXT_COMPRESSION_TRIGGER) {
        return false;
      }
      return requestConversationCompression(modelId);
    }

    function parseToolArguments(rawArguments) {
      const value = String(rawArguments || '').trim();
      if (!value) return {};
      try {
        return JSON.parse(value);
      } catch (error) {
        return {};
      }
    }

    function mergeToolCallDeltas(target, deltaToolCalls) {
      if (!Array.isArray(deltaToolCalls)) return;

      for (const item of deltaToolCalls) {
        const index = Number.isInteger(item.index) ? item.index : target.length;
        if (!target[index]) {
          target[index] = { id: '', name: '', arguments: '' };
        }

        const slot = target[index];
        if (item.id) slot.id = item.id;
        if (item.type) slot.type = item.type;
        if (item.function && typeof item.function === 'object') {
          if (item.function.name) slot.name = item.function.name;
          if (typeof item.function.arguments === 'string') slot.arguments += item.function.arguments;
        }
      }
    }

    // 从模型文本输出中提取工具调用标记（兜底解析）
    function extractToolCallsFromText(text) {
      const results = [];
      if (!text || typeof text !== 'string') return results;

      // 匹配模式 1: [Call `tool_name` with `{"key":"val"}`] 或 [Call tool_name with {...}]
      const callBracketPattern = /\[\s*Call\s+[`']?([a-zA-Z0-9_\-]+)[`']?\s+with\s+[`']?(\{[\s\S]*?\})[`']?\s*\]/gi;
      let match;
      while ((match = callBracketPattern.exec(text)) !== null) {
        try {
          const args = JSON.parse(match[2].trim());
          results.push({
            id: `text_call_${Date.now()}_${results.length}`,
            name: match[1].trim(),
            arguments: JSON.stringify(args),
          });
        } catch {
          // 参数解析失败，跳过
        }
      }

      // 匹配模式 2: function_name({...}) 或 function_name({...})
      const funcCallPattern = /([a-zA-Z0-9_\-]+)\s*\((\{[\s\S]*?\})\)/g;
      while ((match = funcCallPattern.exec(text)) !== null) {
        // 避免重复匹配已识别的
        const name = match[1].trim();
        const argStr = match[2].trim();
        try {
          // 尝试作为 JSON 解析；如果不是合法 JSON（如 location: 'Hangzhou'），转为 JSON
          let args;
          try {
            args = JSON.parse(argStr);
          } catch {
            // 尝试简单 key-value 解析：location: 'Hangzhou' -> {"location":"Hangzhou"}
            const simplePairs = [];
            const pairPattern = /([a-zA-Z0-9_\-]+)\s*[:=]\s*['"]?([^'",}]+)['"]?/g;
            let pm;
            while ((pm = pairPattern.exec(argStr)) !== null) {
              simplePairs.push(`"${pm[1]}":"${pm[2].trim()}"`);
            }
            if (simplePairs.length) {
              args = JSON.parse(`{${simplePairs.join(',')}}`);
            } else {
              continue;
            }
          }
          results.push({
            id: `text_call_${Date.now()}_${results.length}`,
            name,
            arguments: JSON.stringify(args),
          });
        } catch {
          // 忽略解析失败
        }
      }

      // 匹配模式 3: <tool_call>name</tool_call> 或 <tool>name</tool>
      const xmlToolPattern = /<tool_call\s*>([a-zA-Z0-9_\-]+)<\/tool_call>/gi;
      while ((match = xmlToolPattern.exec(text)) !== null) {
        results.push({
          id: `text_call_${Date.now()}_${results.length}`,
          name: match[1].trim(),
          arguments: '{}',
        });
      }

      return results;
    }

    // 从文本中移除已识别的工具调用标记，保留纯回答内容
    function removeToolCallMarkers(text) {
      if (!text || typeof text !== 'string') return text;
      // 移除 [Call ... with ...] 标记
      let cleaned = text.replace(/\[\s*Call\s+[`']?[a-zA-Z0-9_\-]+[`']?\s+with\s+[`']?\{[\s\S]*?\}[`']?\s*\]/gi, '');
      // 移除 function_name({...}) 标记（行首或独立出现）
      cleaned = cleaned.replace(/(^|\n)\s*[a-zA-Z0-9_\-]+\s*\(\{[\s\S]*?\}\)\s*(?=\n|$)/g, '$1');
      // 移除 <tool_call>...</tool_call>
      cleaned = cleaned.replace(/<tool_call\s*>[a-zA-Z0-9_\-]+<\/tool_call>/gi, '');
      return cleaned;
    }

    async function executeWebSearchToolCall(toolCall) {
      const args = parseToolArguments(toolCall?.arguments);
      const query = String(args.search_query || args.query || args.keyword || '').trim();
      if (!query) {
        return JSON.stringify({ error: 'web_search 需要 search_query 参数。' }, null, 2);
      }

      const lang = args.lang === 'en' || args.lang === 'zh' ? args.lang : getPreferredArticleLang(query);
      const limitValue = Number.isFinite(Number(args.limit)) ? Number(args.limit) : 5;
      const limit = Math.max(1, Math.min(10, Math.round(limitValue)));

      const requestPayload = { endpoint: 'web_search', query, search_query: query, lang, limit };

      const tryFetchSearch = async (url) => {
        const response = await fetchWithTimeout(url, {
          method: 'POST',
          headers: proxyHeaders(),
          body: JSON.stringify(requestPayload),
        }, FETCH_TIMEOUT_MS, '联网搜索');

        if (!response.ok) {
          const errorText = await response.text().catch(() => '');
          let detail = errorText.trim();
          if (detail) {
            const parsed = parseBackendErrorPayload(detail);
            detail = parsed.code === 'challenge_required' || parsed.code === 'access_blocked'
              ? formatSecurityGuardMessage(parsed)
              : parsed.message || detail;
          }
          throw new Error(detail || `联网搜索失败：HTTP ${response.status}`);
        }

        const data = await response.json();
        if (!data || !Array.isArray(data.results)) {
          throw new Error('联网搜索返回结果格式不正确');
        }
        return data;
      };

      try {
        const data = await tryFetchSearch(EDGE_FUNCTION_URL);
        return JSON.stringify(data, null, 2);
      } catch (edgeError) {
        try {
          const data = await tryFetchSearch(WEB_SEARCH_URL);
          return JSON.stringify(data, null, 2);
        } catch (fallbackError) {
          const message = [normalizeErrorMessage(edgeError), normalizeErrorMessage(fallbackError)]
            .filter(Boolean)
            .join(' / ');
          throw new Error(message || '联网搜索服务暂时不可用，请稍后重试。');
        }
      }
    }

    async function executeFetchWebPageToolCall(toolCall) {
      const args = parseToolArguments(toolCall?.arguments);
      const url = String(args.url || '').trim();
      if (!url) {
        return JSON.stringify({ error: 'fetch_web_page 需要 url 参数。' }, null, 2);
      }

      const requestPayload = { endpoint: 'fetch_web_page', url };

      const tryFetchPage = async (fetchUrl) => {
        const response = await fetchWithTimeout(fetchUrl, {
          method: 'POST',
          headers: proxyHeaders(),
          body: JSON.stringify(requestPayload),
        }, FETCH_TIMEOUT_MS, '获取网页内容');

        if (!response.ok) {
          const errorText = await response.text().catch(() => '');
          let detail = errorText.trim();
          if (detail) {
            const parsed = parseBackendErrorPayload(detail);
            detail = parsed.code === 'challenge_required' || parsed.code === 'access_blocked'
              ? formatSecurityGuardMessage(parsed)
              : parsed.message || detail;
          }
          throw new Error(detail || `获取网页内容失败：HTTP ${response.status}`);
        }

        const data = await response.json();
        return data;
      };

      try {
        const data = await tryFetchPage(WEB_SEARCH_URL);
        return JSON.stringify(data, null, 2);
      } catch (error) {
        const message = normalizeErrorMessage(error, '获取网页内容失败，请稍后重试。');
        throw new Error(message);
      }
    }

    async function executeArticleToolCall(toolCall) {
      const name = String(toolCall?.name || '').trim();
      const args = parseToolArguments(toolCall?.arguments);
      const lang = args.lang === 'en' || args.lang === 'zh' ? args.lang : undefined;

      switch (name) {
        case 'get_article_list':
        case 'list_articles':
        case 'search_articles': {
          const keyword = String(args.keyword || args.query || '').trim();
          const category = String(args.category || '').trim();
          const preferredLang = lang || getPreferredArticleLang(keyword || category);
          let articles = (keyword || name === 'search_articles')
            ? await searchArticles(keyword || category, preferredLang)
            : await listArticles(preferredLang);

          if (category) {
            const normalizedCategory = normalizeArticleText(category);
            articles = articles.filter(item => normalizeArticleText(item.category || '').includes(normalizedCategory));
          }

          const normalizedArticles = articles.map(item => ({
            id: item.id,
            title: item.title,
            category: item.category,
            date: item.date,
            readTime: item.readTime,
            overlay: item.overlay,
            excerpt: item.excerpt,
            score: item.score,
          }));

          return JSON.stringify({ keyword, category, count: normalizedArticles.length, articles: normalizedArticles }, null, 2);
        }
        case 'get_article_content':
        case 'read_article': {
          const articleId = String(args.article_id || args.articleId || args.id || '').trim();
          const articleTitle = String(args.article_title || args.articleTitle || args.title || '').trim();
          if (!articleId && !articleTitle) {
            return JSON.stringify({ error: 'get_article_content 需要 article_id 或 article_title 参数。' }, null, 2);
          }

          const preferredLang = lang || getPreferredArticleLang(articleTitle || articleId);
          let article = articleId ? await readArticle(articleId, preferredLang) : null;

          if (!article && articleTitle) {
            const matches = await searchArticles(articleTitle, preferredLang);
            const bestMatch = matches.find(item => item && item.id);
            if (bestMatch?.id) {
              article = await readArticle(bestMatch.id, preferredLang);
            }
          }

          if (!article) {
            return JSON.stringify({ error: '未找到匹配的文章内容，请提供更准确的文章标题或 article_id。' }, null, 2);
          }

          return JSON.stringify({ article }, null, 2);
        }
        case 'web_search': {
          return executeWebSearchToolCall(toolCall);
        }
        case 'fetch_web_page': {
          return executeFetchWebPageToolCall(toolCall);
        }
        default:
          return JSON.stringify({ error: `不支持的工具：${name}` }, null, 2);
      }
    }

    async function streamChatCompletionRound(messages, assistantMessageId, controller, { enableTools = true, turnId = '' } = {}) {
      let finalAnswer = '';
      let reasoningText = '';
      let streamBuffer = '';
      let doneReasoning = false;
      const toolCalls = [];

      let response = null;
      const activeModelId = MODEL_IDS[currentModel] || MODEL_IDS['deepseek-v4-flash'];

      // 清理消息内容，确保多模态格式正确
      const processedMessages = messages.map(msg => {
        if (Array.isArray(msg.content)) {
          // 确保多模态内容格式正确
          const cleanedContent = msg.content.map(part => {
            if (part.type === 'image_url' && part.image_url?.url) {
              // 检查 base64 图片大小（大约限制 5MB base64 数据）
              const url = part.image_url.url;
              if (url.startsWith('data:')) {
                const base64Part = url.split(',')[1];
                if (base64Part && base64Part.length > 7 * 1024 * 1024) { // 约 5MB 原始数据
                  console.warn('图片过大，可能无法处理');
                }
              }
            }
            return part;
          });
          return { ...msg, content: cleanedContent };
        }
        return msg;
      });

      const requestBody = {
        model: activeModelId,
        messages: processedMessages,
        stream: true,
        temperature: 0.6,
        ...getModelRequestOptions(currentModel),
      };

      if (enableTools) {
        requestBody.tools = getAvailableToolDefinitions();
        requestBody.tool_choice = 'auto';
      }

      for (let attempt = 1; attempt <= 2; attempt += 1) {
        response = await fetchWithTimeout(EDGE_FUNCTION_URL, {
          method: 'POST',
          headers: proxyHeaders(),
          signal: controller.signal,
          body: JSON.stringify({
            endpoint: 'chat',
            client_turn_id: turnId,
            ...requestBody
          })
        }, CHAT_REQUEST_TIMEOUT_MS, '模型请求');

        if (response.status !== 429 || attempt === 2) {
          break;
        }

        await sleep(900 * attempt);
      }

      const showModelQuota = isModelScopeModel(currentModel);
      const errorText = response.ok ? '' : await response.text().catch(() => '');
      updateRateLimitFromHeaders(response.headers, showModelQuota, response.status, errorText);

      if (response.status === 429) {
        throw new Error(getQuotaLockMessage(activeModelId) || '模型额度已超，请切换模型重试。');
      }

      if (!response.ok) {
        let detail = errorText.trim();
        if (detail) {
          const parsed = parseBackendErrorPayload(detail);
          applyBackendModelBlock(parsed, currentModel);
          detail = parsed.code === 'challenge_required' || parsed.code === 'access_blocked'
            ? formatSecurityGuardMessage(parsed)
            : parsed.message || detail;
          if (parsed?.provider) detail += `; provider=${parsed.provider}`;
          if (Array.isArray(parsed?.missing) && parsed.missing.length) detail += `; missing=${parsed.missing.join(',')}`;
        }
        // 多模态特定错误提示
        if (response.status === 400 && processedMessages.some(m => Array.isArray(m.content))) {
          detail += ' (可能是图片格式不支持或图片过大)';
        }
        const friendly = getFriendlyHttpStatusMessage(response.status);
        throw new Error(`${friendly}\n\n诊断: ${formatBackendErrorDebug(response.status, detail || errorText)}`);
      }

      if (!response.body) {
        throw new Error('模型请求未返回可读取的数据流。');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      function applyDelta(parsed) {
        const delta = parsed?.choices?.[0]?.delta || {};
        const reasoning = delta.reasoning_content || '';
        const answer = delta.content || '';

        if (reasoning) {
          reasoningText += reasoning;
          updateAssistantMessage(assistantMessageId, { reasoning: reasoningText, answer: finalAnswer || '', thinking: true });
        }

        if (answer) {
          if (!doneReasoning) {
            doneReasoning = true;
          }
          finalAnswer += answer;
          updateAssistantMessage(assistantMessageId, { reasoning: reasoningText, answer: finalAnswer, thinking: true });
        }

        // 兼容 OpenAI 格式的流式 tool_calls
        if (Array.isArray(delta.tool_calls) && delta.tool_calls.length) {
          mergeToolCallDeltas(toolCalls, delta.tool_calls);
          updateAssistantMessage(assistantMessageId, { reasoning: reasoningText, answer: '', thinking: true });
        }

        // 兼容 function_call（旧版 OpenAI 格式）
        if (delta.function_call) {
          const fc = delta.function_call;
          if (fc.name) {
            toolCalls.push({
              id: `call_${Date.now()}_${toolCalls.length}`,
              name: fc.name,
              arguments: fc.arguments || '',
            });
            updateAssistantMessage(assistantMessageId, { reasoning: reasoningText, answer: '', thinking: true });
          }
        }

        // 兼容非流式 message.tool_calls（某些代理会一次性返回）
        const messageToolCalls = parsed?.choices?.[0]?.message?.tool_calls;
        if (Array.isArray(messageToolCalls) && messageToolCalls.length) {
          for (const tc of messageToolCalls) {
            toolCalls.push({
              id: tc.id || `call_${Date.now()}_${toolCalls.length}`,
              name: tc.function?.name || tc.name || '',
              arguments: tc.function?.arguments || tc.arguments || '',
            });
          }
          updateAssistantMessage(assistantMessageId, { reasoning: reasoningText, answer: '', thinking: true });
        }
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        streamBuffer += decoder.decode(value, { stream: true });
        const lines = streamBuffer.split(/\r?\n/);
        streamBuffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (!payload || payload === '[DONE]') continue;

          try {
            applyDelta(JSON.parse(payload));
          } catch (parseError) {
            // ignore malformed stream chunks
          }
        }
      }

      if (streamBuffer.trim().startsWith('data: ')) {
        const payload = streamBuffer.trim().slice(6).trim();
        if (payload && payload !== '[DONE]') {
          try {
            applyDelta(JSON.parse(payload));
          } catch (parseError) {
            // ignore malformed tail chunk
          }
        }
      }

      if (!finalAnswer && !reasoningText && toolCalls.length) {
        finalAnswer = '';
      }

      // 兜底：如果标准格式没有解析到工具调用，但文本中包含工具调用标记，尝试提取
      if (!toolCalls.length && finalAnswer) {
        const extracted = extractToolCallsFromText(finalAnswer);
        if (extracted.length) {
          toolCalls.push(...extracted);
          // 从 finalAnswer 中移除已提取的工具调用文本
          finalAnswer = removeToolCallMarkers(finalAnswer).trim();
        }
      }

      return {
        reasoningText,
        finalAnswer,
        toolCalls: toolCalls
          .filter(item => item && item.name)
          .map((item, index) => ({
            id: item.id || `tool_${Date.now()}_${index}`,
            name: item.name,
            arguments: item.arguments || '',
          })),
      };
    }

    const TOOL_DISPLAY_NAMES = {
      get_article_list: '获取站内文章列表',
      get_article_content: '获取文章内容',
      list_articles: '获取站内文章列表',
      search_articles: '获取站内文章列表',
      read_article: '获取文章内容',
      web_search: '联网搜索',
    };

    function addToolCallUI(messageId, toolCall) {
      const messageDiv = document.getElementById(messageId);
      if (!messageDiv || !messageDiv._parts) return null;
      const container = messageDiv._parts.toolCallsContainer;

      const block = document.createElement('div');
      block.className = 'tool-call-block';
      block.dataset.toolCallId = toolCall.id || '';

      const header = document.createElement('div');
      header.className = 'tool-call-header';

      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('width', '14');
      icon.setAttribute('height', '14');
      icon.setAttribute('viewBox', '0 0 24 24');
      icon.setAttribute('fill', 'none');
      icon.setAttribute('stroke', 'currentColor');
      icon.setAttribute('stroke-width', '2');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76Z');
      icon.appendChild(path);

      const nameSpan = document.createElement('span');
      nameSpan.className = 'tool-call-name';
      const displayName = TOOL_DISPLAY_NAMES[toolCall.name] || toolCall.name;
      const args = parseToolArguments(toolCall.arguments);
      const argHint = args.search_query || args.query || args.keyword || args.article_id || args.articleId || args.article_title || args.title || args.id || '';
      nameSpan.textContent = argHint ? `${displayName}：${argHint}` : displayName;

      const spinner = document.createElement('div');
      spinner.className = 'tool-call-spinner';

      const status = document.createElement('span');
      status.className = 'tool-call-status';
      status.textContent = '调用中…';
      status.style.display = 'none';

      const resultDiv = document.createElement('div');
      resultDiv.className = 'tool-call-result';

      header.appendChild(icon);
      header.appendChild(nameSpan);
      header.appendChild(spinner);
      header.appendChild(status);

      header.addEventListener('click', () => {
        block.classList.toggle('expanded');
      });

      block.appendChild(header);
      block.appendChild(resultDiv);
      container.appendChild(block);
      scrollChatToBottom();

      return block;
    }

    function completeToolCallUI(block, resultText) {
      if (!block) return;
      const spinner = block.querySelector('.tool-call-spinner');
      const status = block.querySelector('.tool-call-status');
      const resultDiv = block.querySelector('.tool-call-result');

      if (spinner) spinner.remove();
      if (status) {
        status.textContent = '已完成';
        status.classList.add('done');
        status.style.display = '';
      }
      if (resultDiv) {
        let preview = String(resultText || '').trim();
        if (preview.length > 800) preview = preview.slice(0, 800) + '\n…（结果已截断）';
        resultDiv.textContent = preview;
      }
      scrollChatToBottom();
    }

    function failToolCallUI(block, resultText) {
      if (!block) return;
      const spinner = block.querySelector('.tool-call-spinner');
      const status = block.querySelector('.tool-call-status');
      const resultDiv = block.querySelector('.tool-call-result');

      block.classList.add('failed', 'expanded');
      if (spinner) spinner.remove();
      if (status) {
        status.textContent = '失败';
        status.classList.add('failed');
        status.style.display = '';
      }
      if (resultDiv) {
        let preview = String(resultText || '').trim();
        if (preview.length > 800) preview = preview.slice(0, 800) + '\n…（结果已截断）';
        resultDiv.textContent = preview;
      }
      scrollChatToBottom();
    }

    async function sendMessage(content) {
      // 检查速率限制
      const rateCheck = checkRateLimit();
      if (!rateCheck.allowed) {
        showToast(rateCheck.message);
        return;
      }

      const query = String(content || '').trim();
      const attachmentsForSend = pendingAttachments.slice();
      if ((!query && !attachmentsForSend.length) || state.isStreaming) return;

      stopVoiceRecognition();

      homeView.classList.add('chatting');
      chatMessages.classList.add('active');
      if (attachmentsForSend.length && !isMultimodal) {
        setModel('qwen3.5');
      }

      const effectiveQuery = query || '请分析上传的图片。';
      const userContent = attachmentsForSend.length
        ? attachmentToUserContent(effectiveQuery, attachmentsForSend)
        : effectiveQuery;
      const userHistoryMessage = { role: 'user', content: userContent };

      createUserMessage(query || effectiveQuery, attachmentsForSend);
      homeInput.value = '';

      if (!isModelAvailable(currentModel)) {
        await refreshModelscopeQuota().catch(() => {});
      }

      const currentStatus = getModelStatus(currentModel);
      if (!isModelAvailable(currentModel)) {
        const unavailableMessage = getQuotaLockMessage(currentModel)
          || (currentStatus.quotaRemaining !== null && currentStatus.quotaRemaining <= 0
          ? '当前模型额度已用完，请切换其他模型再试。'
          : '当前模型暂时不可用，请切换其他模型再试。');
        const assistantMessageId = createAssistantMessage();
        const detailedUnavailableMessage = `${unavailableMessage}${formatModelUnavailableDebug(currentModel, currentStatus)}`;
        updateAssistantMessage(assistantMessageId, { answer: detailedUnavailableMessage, thinking: false });
        pushHistory(userHistoryMessage);
        pushHistory('assistant', detailedUnavailableMessage);
        await finalizeConversationTurn();
        return;
      }

      setComposerBusy(true);

      try {
        await ensureContextBudget(userContent, currentModel);
      } catch (error) {
        showToast(normalizeErrorMessage(error, '上下文压缩失败，请稍后再试。'));
        return;
      }

      const assistantMessageId = createAssistantMessage();
      const controller = new AbortController();
      const clearTurnTimeout = startAbortTimer(controller, CHAT_TURN_TIMEOUT_MS, '对话请求');
      const turnId = createChatTurnId();
      state.activeRequestController = controller;

      try {
        const baseMessages = await buildApiMessages(effectiveQuery, '', userContent, currentModel);
        const requestMessages = baseMessages.map(message => ({ ...message }));
        const turnMessages = [];
        const repeatedToolCalls = new Map();
        let round = 0;
        while (!controller.signal.aborted) {
          const roundResult = await streamChatCompletionRound(requestMessages, assistantMessageId, controller, { turnId });

          if (roundResult.toolCalls.length) {
            const assistantToolMessage = {
              role: 'assistant',
              content: roundResult.finalAnswer || '',
              tool_calls: roundResult.toolCalls.map((call, index) => ({
                id: call.id || `call_${Date.now()}_${round}_${index}`,
                type: 'function',
                function: {
                  name: call.name,
                  arguments: call.arguments || '',
                },
              })),
            };

            requestMessages.push(assistantToolMessage);
            turnMessages.push(assistantToolMessage);

            updateAssistantMessage(assistantMessageId, {
              reasoning: roundResult.reasoningText,
              answer: roundResult.finalAnswer || '',
              thinking: true,
            });

            for (let index = 0; index < roundResult.toolCalls.length; index += 1) {
              const toolCall = roundResult.toolCalls[index];
              const signature = getToolCallSignature(toolCall);
              const repeatedCount = (repeatedToolCalls.get(signature) || 0) + 1;
              repeatedToolCalls.set(signature, repeatedCount);
              if (repeatedCount > MAX_REPEATED_TOOL_CALLS) {
                const repeatedAnswer = '检测到模型反复调用同一个工具，已自动停止工具链。请换个问法或缩小查询范围。';
                updateAssistantMessage(assistantMessageId, { answer: repeatedAnswer, thinking: false });
                pushHistory(userHistoryMessage);
                turnMessages.forEach(message => pushHistory(message));
                pushHistory('assistant', repeatedAnswer);
                await finalizeConversationTurn();
                return;
              }
              const uiBlock = addToolCallUI(assistantMessageId, toolCall);
              let toolOutput = '';

              try {
                toolOutput = await executeArticleToolCall(toolCall);
                completeToolCallUI(uiBlock, toolOutput);
              } catch (toolError) {
                const toolErrorMessage = normalizeErrorMessage(toolError, '工具调用失败，请稍后重试。');
                toolOutput = JSON.stringify({ error: toolErrorMessage }, null, 2);
                failToolCallUI(uiBlock, toolOutput);
              }

              const toolMessage = {
                role: 'tool',
                tool_call_id: toolCall.id || `tool_${Date.now()}_${round}_${index}`,
                name: toolCall.name,
                content: toolOutput,
              };

              requestMessages.push(toolMessage);
              turnMessages.push(toolMessage);
            }

            round += 1;
            continue;
          }

          const resolvedAnswer = roundResult.finalAnswer || roundResult.reasoningText || '我刚刚没有拿到有效回复。你可以再试一次。';
          updateAssistantMessage(assistantMessageId, {
            reasoning: roundResult.reasoningText,
            answer: resolvedAnswer,
            thinking: false,
          });

          pushHistory(userHistoryMessage);
          turnMessages.forEach(message => pushHistory(message));
          pushHistory('assistant', resolvedAnswer);
          await finalizeConversationTurn();
          return;
        }

        const fallbackAnswer = '请求已取消。';
        updateAssistantMessage(assistantMessageId, { answer: fallbackAnswer, thinking: false });
        pushHistory(userHistoryMessage);
        turnMessages.forEach(message => pushHistory(message));
        pushHistory('assistant', fallbackAnswer);
        await finalizeConversationTurn();
      } catch (error) {
        const message = normalizeErrorMessage(error, '抱歉，发送消息时出现错误，请稍后重试。');
        if (message.includes('额度已用完')
          || message.includes('切换其他模型再试')
          || message.includes('切换模型重试')
          || message.includes('模型额度已超')
          || message.includes('暂时无法访问')
          || message.includes('有点忙')
          || message.startsWith('当前模型')
          || message.includes('请换个模型再试')
          || message.includes('请求已取消')
          || message.includes('超时')) {
          updateAssistantMessage(assistantMessageId, { answer: message, thinking: false });
        } else {
          updateAssistantMessage(assistantMessageId, { answer: `抱歉，发送消息时出现错误：${message}`, thinking: false });
        }
      } finally {
        clearTurnTimeout();
        if (state.activeRequestController === controller) {
          state.activeRequestController = null;
        }
        setComposerBusy(false);
      }
    }

    function buildVideoGenerationPrompt(query) {
      const value = String(query || '').trim();
      if (!value) return '';
      if (/(video|视频|短片|动画|镜头|片段)/i.test(value)) {
        return value;
      }
      return `请生成一个视频，要求：${value}`;
    }

    async function handleHomeSubmit() {
      const query = String(homeInput?.value || '').trim();
      if ((!query && !pendingAttachments.length) || state.isStreaming) return;

      if (state.homeMode === 'image' && query && !pendingAttachments.length) {
        setActiveView('images');
        if (imagePromptInput) {
          imagePromptInput.value = query;
        }
        homeInput.value = '';
        setComposerBusy(false);
        await generateImageFromPrompt(query, OPENAI_IMAGE_MODEL);
        return;
      }

      if (state.homeMode === 'video' && query) {
        await sendMessage(buildVideoGenerationPrompt(query));
        return;
      }

      await sendMessage(query);
    }

    function openPopover(el) {
      if (!el) return;
      if (state.modal) return;
      if (state.popover && state.popover !== el) state.popover.classList.remove('open');
      const willOpen = !el.classList.contains('open');
      closePopover();
      if (willOpen) {
        el.classList.add('open');
        state.popover = el;
      }
    }

    function closePopover() {
      [plusPopover, morePopover, accountPopover].forEach(p => p.classList.remove('open'));
      state.popover = null;
    }

    function openModal(id) {
      closePopover();
      closeModal();
      const modal = document.getElementById(id);
      if (!modal) return;
      state.modal = modal;
      modal.classList.add('open');
      modal.setAttribute('aria-hidden', 'false');
      updateScrimVisibility();
    }

    function closeModal() {
      [settingsModal, tempChatModal, projectModal, privacyPolicyModal].forEach(m => {
        m.classList.remove('open');
        m.setAttribute('aria-hidden', 'true');
      });
      state.modal = null;
      updateScrimVisibility();
    }

    function isMobileViewport() {
      return window.innerWidth <= 640;
    }

    function updateScrimVisibility() {
      if (!scrim) return;
      const shouldShow = Boolean(state.modal) || (isMobileViewport() && sidebar && !sidebar.classList.contains('collapsed'));
      scrim.classList.toggle('show', shouldShow);
    }

    function updateNexusvFooterVisibility() {
      if (!nexusvFooter) return;
      const visible = !homeView?.classList.contains('chatting') && nexusvFooter.classList.contains('is-visible');
      nexusvFooter.style.visibility = visible ? 'visible' : 'hidden';
    }

    function cycleAppearance() {
      themeIndex = (themeIndex + 1) % themeCycle.length;
      state.theme = themeCycle[themeIndex].value;
      applyTheme();
    }

    function cycleContrast() {
      contrastIndex = (contrastIndex + 1) % contrastCycle.length;
      state.contrast = contrastCycle[contrastIndex];
      applyTheme();
    }

    function cycleAccent() {
      accentIndex = (accentIndex + 1) % accentCycle.length;
      state.accentName = accentCycle[accentIndex].name;
      state.accentValue = accentCycle[accentIndex].value;
      applyTheme();
    }

    function cycleLanguage() {
      langIndex = (langIndex + 1) % langCycle.length;
      state.language = langCycle[langIndex];
      applyTheme();
    }

    function cycleSpeech() {
      speechIndex = (speechIndex + 1) % speechCycle.length;
      state.speech = speechCycle[speechIndex];
      applyTheme();
    }

    function activateSettingsPanel(panelId) {
      settingTabs.forEach(tab => tab.classList.toggle('active', tab.dataset.settingsPanel === panelId));
      settingPanels.forEach(panel => panel.classList.toggle('active', panel.id === panelId));
    }

    document.getElementById('sidebarToggle').addEventListener('click', e => {
      e.stopPropagation();
      sidebar.classList.toggle('collapsed');
      closePopover();
      updateScrimVisibility();
    });
    document.getElementById('mobileMenuBtn').addEventListener('click', e => {
      e.stopPropagation();
      sidebar.classList.toggle('collapsed');
      closePopover();
      updateScrimVisibility();
    });

    document.getElementById('newChatBtn').addEventListener('click', newChat);

    document.getElementById('brandHomeBtn').addEventListener('click', () => {
      setActiveView('home');
      clearConversation();
    });
    document.getElementById('plusTrigger').addEventListener('click', e => { e.stopPropagation(); openPopover(plusPopover); });
    on('moreEntry', 'click', e => { e.stopPropagation(); openPopover(morePopover); });
    document.getElementById('accountTrigger').addEventListener('click', e => {
      e.stopPropagation();
      const rect = document.getElementById('accountTrigger').getBoundingClientRect();
      accountPopover.style.left = Math.max(6, rect.left) + 'px';
      accountPopover.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
      accountPopover.style.top = 'auto';
      openPopover(accountPopover);
    });

    const donateBtn = document.getElementById('donateBtn');
    if (donateBtn) {
      donateBtn.addEventListener('click', e => {
        e.stopPropagation();
        const qrModal = document.createElement('div');
        qrModal.style.cssText = 'position:fixed;inset:0;z-index:2000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.8);padding:20px;opacity:0;transition:opacity 0.3s ease;';
        const qrCard = document.createElement('div');
        qrCard.style.cssText = 'background:var(--panel);border-radius:20px;padding:24px;max-width:90%;max-height:90%;display:flex;flex-direction:column;align-items:center;gap:16px;box-shadow:0 24px 64px rgba(0,0,0,0.3);transform:scale(0.95);transition:transform 0.3s ease;';
        qrCard.innerHTML = `
          <h3 style="font-size:18px;font-weight:700;color:var(--text);margin:0;">扫码资助</h3>
        `;

        const qrImage = document.createElement('img');
        qrImage.alt = '收款码';
        qrImage.style.cssText = 'max-width:300px;max-height:400px;border-radius:12px;object-fit:contain;background:#fff;';
        const qrImageCandidates = [
          '../Logo/1107.jpg',
          '../0429/Logo/1107.jpg',
        ];
        let qrImageIndex = 0;
        const loadNextQrImage = () => {
          if (qrImageIndex >= qrImageCandidates.length) {
            qrImage.alt = '收款码加载失败';
            qrImage.removeAttribute('src');
            return;
          }
          qrImage.src = qrImageCandidates[qrImageIndex];
          qrImageIndex += 1;
        };
        qrImage.addEventListener('error', loadNextQrImage);
        loadNextQrImage();

        const closeQrButton = document.createElement('button');
        closeQrButton.id = 'closeQrModal';
        closeQrButton.type = 'button';
        closeQrButton.textContent = '关闭';
        closeQrButton.style.cssText = 'padding:8px 24px;border-radius:8px;border:none;background:var(--accent);color:#fff;font-size:14px;font-weight:600;cursor:pointer;';

        qrCard.appendChild(qrImage);
        qrCard.appendChild(closeQrButton);
        qrModal.appendChild(qrCard);
        document.body.appendChild(qrModal);
        requestAnimationFrame(() => {
          qrModal.style.opacity = '1';
          qrCard.style.transform = 'scale(1)';
        });
        const closeModal = () => {
          qrModal.style.opacity = '0';
          qrCard.style.transform = 'scale(0.95)';
          setTimeout(() => qrModal.remove(), 300);
        };
        qrModal.addEventListener('click', e => {
          if (e.target === qrModal) closeModal();
        });
        closeQrButton.addEventListener('click', closeModal);
      });
    }

    document.getElementById('settingsBtn').addEventListener('click', () => openModal('settingsModal'));
    document.getElementById('themeShortcutBtn').addEventListener('click', () => openModal('settingsModal'));
    document.getElementById('tempChatBtn').addEventListener('click', () => openModal('tempChatModal'));
    on('projectBtn', 'click', () => openModal('projectModal'));
    document.getElementById('createProjectFromPlus').addEventListener('click', () => openModal('projectModal'));
    document.getElementById('privacyPolicyBtn').addEventListener('click', () => openModal('privacyPolicyModal'));

    navRows.forEach(row => {
      row.addEventListener('click', () => {
        const target = row.dataset.viewTarget;
        setActiveView(target);
        if (target === 'home') {
          clearConversation();
        }
      });
    });

    document.getElementById('openImagesFromPlus').addEventListener('click', () => setActiveView('images'));
    document.getElementById('openImagesFromMore').addEventListener('click', () => setActiveView('images'));
    on('imageModeChipBtn', 'click', () => setHomeMode('image'));
    on('videoModeChipBtn', 'click', () => setHomeMode('video'));

    on('searchChatsBtn', 'click', () => showToast('聊天搜索已响应。'));
    on('codexBtn', 'click', () => showToast('Codex 面板已响应。'));
    document.getElementById('teamToastBtn').addEventListener('click', () => showToast('团队邀请入口已响应。'));
    document.getElementById('upgradeBtn').addEventListener('click', () => window.open('https://qm.qq.com/q/bxQU3rXRyo', '_blank'));
    const clearBtnEl = document.getElementById('clearBtn');
    if (clearBtnEl) clearBtnEl.addEventListener('click', () => clearConversation());
    document.getElementById('micToastBtn').addEventListener('click', () => showToast('语音输入入口已响应。'));
    document.getElementById('imageMicToastBtn').addEventListener('click', () => showToast('图片语音输入入口已响应。'));
    document.getElementById('uploadToastBtn').addEventListener('click', () => attachmentInput?.click());
    document.getElementById('thinkingToastBtn').addEventListener('click', () => showToast('思考模式入口已响应。'));
    document.getElementById('researchToastBtn2').addEventListener('click', () => showToast('深度研究入口已响应。'));
    document.getElementById('openResearchToast').addEventListener('click', () => showToast('深度研究入口已响应。'));
    document.getElementById('openAppsToast').addEventListener('click', () => showToast('应用中心入口已响应。'));
    document.getElementById('profileToastBtn').addEventListener('click', () => showToast('个人资料入口已响应。'));
    document.getElementById('helpToastBtn').addEventListener('click', () => showToast('帮助中心入口已响应。'));
    document.getElementById('logoutToastBtn').addEventListener('click', () => showToast('退出登录入口已响应。'));
    document.getElementById('mfaToastBtn').addEventListener('click', () => showToast('MFA 设置入口已响应。'));
    document.getElementById('projectSettingToastBtn').addEventListener('click', () => showToast('项目高级设置入口已响应。'));
    document.getElementById('plusMoreBtn').addEventListener('click', () => showToast('更多二级菜单可继续扩展。'));

    document.getElementById('continueTempChatBtn').addEventListener('click', () => {
      closeModal();
      homeInput.focus();
      showToast('已进入临时聊天。');
    });

    document.getElementById('createProjectConfirmBtn').addEventListener('click', () => {
      const value = projectNameInput.value.trim();
      if (!value) {
        showToast('请先输入项目名称。');
        projectNameInput.focus();
        return;
      }
      state.recentProjectName = value;
      closeModal();
      setActiveView('home');
      showToast(`项目“${value}”已创建。`);
    });

    document.getElementById('sendImagePromptBtn').addEventListener('click', () => {
      const value = imagePromptInput.value.trim();
      if (!value) {
        showToast('请输入图片描述。');
        imagePromptInput.focus();
        return;
      }
      generateImageFromPrompt(value);
    });

    homeInput.addEventListener('input', () => {
      setComposerBusy(state.isStreaming);
    });

    if (voiceInputBtn) {
      voiceInputBtn.addEventListener('click', toggleVoiceInput);
      voiceInputBtn.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggleVoiceInput();
        }
      });
    }

    if (attachBtn && attachmentInput) {
      attachBtn.addEventListener('click', () => attachmentInput.click());
      attachmentInput.addEventListener('change', async () => {
        const nextAttachments = await filesToAttachments(attachmentInput.files);
        if (nextAttachments.length) {
          pendingAttachments.push(...nextAttachments);
          updateAttachmentPreview();
          setComposerBusy(state.isStreaming);
        }
        attachmentInput.value = '';
      });
    }

    // 文件上传按钮事件处理
    if (fileUploadBtn && fileInput) {
      fileUploadBtn.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', async () => {
        const nextAttachments = await filesToAttachments(fileInput.files);
        if (nextAttachments.length) {
          pendingAttachments.push(...nextAttachments);
          updateAttachmentPreview();
          setComposerBusy(state.isStreaming);
        }
        fileInput.value = '';
      });
    }

    imagePromptInput.addEventListener('input', () => {
      setImageGenerationBusy(state.isImageGenerating, imagePromptInput.value.trim() ? imageGenerationStatus.textContent : '等待输入提示词');
    });

    homeInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && (homeInput.value.trim() || pendingAttachments.length)) {
        e.preventDefault();
        handleHomeSubmit();
      }
    });

    sendChatBtn.addEventListener('click', () => {
      if (homeInput.value.trim() || pendingAttachments.length) handleHomeSubmit();
    });

    const expandInputBtn = document.getElementById('expandInputBtn');
    if (expandInputBtn) {
      expandInputBtn.addEventListener('click', () => {
        const composer = document.querySelector('.composer');
        composer.classList.toggle('expanded');
        homeInput.focus();
      });
    }

    sendImagePromptBtn.disabled = true;
    sendImagePromptBtn.setAttribute('aria-disabled', 'true');

    imagePromptInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') sendImagePromptBtn.click();
    });

    projectNameInput.addEventListener('input', () => {
      const hasValue = projectNameInput.value.trim().length > 0;
      const btn = document.getElementById('createProjectConfirmBtn');
      btn.className = hasValue ? 'primary-btn' : 'muted-btn';
    });

    document.getElementById('appearanceRow').addEventListener('click', cycleAppearance);
    document.getElementById('contrastRow').addEventListener('click', cycleContrast);
    document.getElementById('accentRow').addEventListener('click', cycleAccent);
    document.getElementById('languageRow').addEventListener('click', cycleLanguage);
    document.getElementById('speechRow').addEventListener('click', cycleSpeech);

    dismissMfaBtn.addEventListener('click', () => {
      dismissMfaBtn.closest('.mfa-box').style.display = 'none';
      showToast('已隐藏 MFA 推荐。');
    });

    settingTabs.forEach(tab => {
      tab.addEventListener('click', () => activateSettingsPanel(tab.dataset.settingsPanel));
    });

    document.querySelectorAll('[data-close-modal]').forEach(btn => {
      btn.addEventListener('click', () => {
        closeModal();
      });
    });

    document.querySelectorAll('.popover').forEach(pop => pop.addEventListener('click', e => e.stopPropagation()));
    document.querySelectorAll('.modal').forEach(modal => modal.addEventListener('click', e => e.stopPropagation()));

    scrim.addEventListener('click', () => {
      closePopover();
      closeModal();
      if (isMobileViewport() && sidebar) {
        sidebar.classList.add('collapsed');
      }
      updateScrimVisibility();
    });

    document.addEventListener('click', event => {
      closePopover();
      if (isMobileViewport() && sidebar && !sidebar.contains(event.target) && !sidebar.classList.contains('collapsed')) {
        sidebar.classList.add('collapsed');
      }
      if (!state.modal) updateScrimVisibility();
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        closePopover();
        closeModal();
        if (isMobileViewport() && sidebar) {
          sidebar.classList.add('collapsed');
        }
        updateScrimVisibility();
      }
    });

    document.querySelectorAll('.preview-card').forEach(card => {
      card.addEventListener('click', () => showToast(`已选中风格：${card.textContent.trim()}`));
    });

    document.querySelectorAll('.grid-card').forEach((card, index) => {
      card.addEventListener('click', () => showToast(`已打开图片 ${index + 1}`));
    });

    on('stylePrevBtn', 'click', () => showToast('已切换到上一组风格。'));
    on('styleNextBtn', 'click', () => showToast('已切换到下一组风格。'));

    if (customContextMenu) {
      customContextMenu.addEventListener('click', async event => {
        const button = event.target.closest('button[data-menu-action]');
        if (!button) return;
        event.preventDefault();
        event.stopPropagation();
        await handleContextMenuAction(button.dataset.menuAction);
        closeCustomContextMenu();
      });
    }

    // 接收从首页传来的问题参数
    function initQueryFromUrl() {
      const params = new URLSearchParams(window.location.search);
      const question = params.get('q');
      if (question) {
        const decoded = decodeURIComponent(question);
        homeInput.value = decoded;
        // 可选：自动发送或仅填入等待用户确认
        // 这里仅填入并聚焦，让用户按回车或等待
        homeInput.focus();
        // 更新标题显示
        updateHomeHeroText();
        setComposerBusy(false);
      }
    }

    document.addEventListener('keydown', e => {
      const key = String(e.key || '').toLowerCase();
      if (key === 'f12' || (e.ctrlKey && e.shiftKey && ['i', 'j', 'c', 'k'].includes(key)) || (e.ctrlKey && key === 'u') || (e.metaKey && e.altKey && ['i', 'j', 'c'].includes(key))) {
        e.preventDefault();
        e.stopPropagation();
        showDevtoolsShield();
      }
    });

    // 防右键/防F12（可选）
    document.addEventListener('contextmenu', e => {
      e.preventDefault();
      if (devtoolsShield && devtoolsShield.classList.contains('show')) {
        closeCustomContextMenu();
        return;
      }
      openCustomContextMenu(e.clientX, e.clientY, e.target);
    });

    document.addEventListener('click', event => {
      if (customContextMenu && !customContextMenu.contains(event.target)) {
        closeCustomContextMenu();
      }
    });

    document.addEventListener('scroll', closeCustomContextMenu, true);
    window.addEventListener('blur', closeCustomContextMenu);

    // 模型下拉菜单分页
    const MODELS_PER_PAGE = 10;
    let currentModelPage = 1;
    let totalModelPages = 1;

    function initModelPagination() {
      const modelOptions = modelDropdown?.querySelectorAll('.model-option');
      if (!modelOptions) return;

      totalModelPages = Math.ceil(modelOptions.length / MODELS_PER_PAGE);
      updateModelPageDisplay();
    }

    function updateModelPageDisplay() {
      const modelOptions = modelDropdown?.querySelectorAll('.model-option');
      const startIndex = (currentModelPage - 1) * MODELS_PER_PAGE;
      const endIndex = startIndex + MODELS_PER_PAGE;

      modelOptions?.forEach((opt, index) => {
        if (index >= startIndex && index < endIndex) {
          opt.style.display = 'flex';
        } else {
          opt.style.display = 'none';
        }
      });

      // 更新分页控件
      const pageInfo = document.getElementById('modelPageInfo');
      const prevBtn = document.getElementById('modelPagePrev');
      const nextBtn = document.getElementById('modelPageNext');

      if (pageInfo) pageInfo.textContent = `${currentModelPage} / ${totalModelPages}`;
      if (prevBtn) prevBtn.disabled = currentModelPage <= 1;
      if (nextBtn) nextBtn.disabled = currentModelPage >= totalModelPages;
    }

    function goToModelPage(page) {
      if (page < 1 || page > totalModelPages) return;
      currentModelPage = page;
      updateModelPageDisplay();
    }

    function openModelDropdown() {
      modelSelector?.classList.add('open');
      initModelPagination();
      // 确保当前选中的模型所在页可见
      const modelOptions = Array.from(modelDropdown?.querySelectorAll('.model-option') || []);
      const activeIndex = modelOptions.findIndex(opt => opt.dataset.model === currentModel);
      if (activeIndex >= 0) {
        currentModelPage = Math.floor(activeIndex / MODELS_PER_PAGE) + 1;
        updateModelPageDisplay();
      }
      if (modelDropdown) {
        modelDropdown.classList.add('animating');
        modelDropdown.querySelectorAll('.model-option').forEach((opt, i) => {
          opt.style.setProperty('--stagger', String(i));
        });
      }
      document.addEventListener('click', closeModelDropdownOutside);
    }

    function closeModelDropdown() {
      modelSelector?.classList.remove('open');
      modelDropdown?.classList.remove('animating');
      document.removeEventListener('click', closeModelDropdownOutside);
    }

    function closeModelDropdownOutside(e) {
      if (!modelSelector?.contains(e.target)) {
        closeModelDropdown();
      }
    }

    function setModel(modelId) {
      currentModel = modelId;
      isMultimodal = isMultimodalModel(modelId);
      localStorage.setItem('cancri_current_model', modelId);

      if (currentModelName) {
        currentModelName.textContent = getModelDisplayName(modelId);
      }
      updateModelSelectorActive();
      modelDropdown?.querySelectorAll('.model-option').forEach(opt => {
        opt.classList.toggle('active', opt.dataset.model === modelId);
      });
      closeModelDropdown();
      showToast(`已切换至 ${getModelDisplayName(modelId)}，对话历史已保留`);

      // 根据模型是否多模态显示/隐藏上传图片按钮
      updateAttachBtnVisibility();
      updateRateLimitNote();
    }


    function updateAttachBtnVisibility() {
      if (attachBtn) {
        attachBtn.style.display = isMultimodal ? 'grid' : 'none';
      }
      if (fileUploadBtn) {
        fileUploadBtn.style.display = 'grid';
      }
    }

    function updateModelSelectorActive() {
      if (!modelSelector) return;
      modelSelector.querySelectorAll('.model-option').forEach(opt => {
        opt.classList.toggle('active', opt.dataset.model === currentModel);
      });
    }

    if (modelCurrentBtn) {
      modelCurrentBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (modelSelector?.classList.contains('open')) {
          closeModelDropdown();
        } else {
          openModelDropdown();
        }
      });
    }

    if (modelDropdown) {
      modelDropdown.querySelectorAll('.model-option').forEach(option => {
        option.addEventListener('click', () => {
          const modelId = option.dataset.model;
          if (!isModelAvailable(modelId)) {
            const status = getModelStatus(modelId);
            showToast(`${getModelDisplayName(modelId)} 当前不可用：${status.error || '额度已用完'}`);
            return;
          }
          setModel(modelId);
        });
      });

      // 分页按钮事件
      const prevBtn = document.getElementById('modelPagePrev');
      const nextBtn = document.getElementById('modelPageNext');
      if (prevBtn) {
        prevBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          goToModelPage(currentModelPage - 1);
        });
      }
      if (nextBtn) {
        nextBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          goToModelPage(currentModelPage + 1);
        });
      }
    }

    // 主题切换按钮
    const themeSwitchers = Array.from(document.querySelectorAll('.theme-switcher'));

    themeSwitchers.forEach(switcher => {
      switcher.querySelectorAll('.theme-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const theme = btn.dataset.theme;
          if (theme) {
            state.theme = theme;
            applyTheme();
            updateThemeSwitcherActive();
            showToast(`已切换至${btn.title || theme}`);
          }
        });
      });
    });

    function updateThemeSwitcherActive() {
      themeSwitchers.forEach(switcher => {
        switcher.querySelectorAll('.theme-btn').forEach(btn => {
          btn.classList.toggle('active', btn.dataset.theme === state.theme);
        });
      });
    }

    renderWatermark();
    restoreUiPreferences();
    applyTheme();
    updateThemeSwitcherActive();
    updateModelSelectorActive();
    updateContextMeter();
    updateVoiceButtonState();
    updateComposerPlaceholder();
    // 初始化上传按钮显示状态
    updateAttachBtnVisibility();
    if (isMobileViewport() && sidebar) {
      sidebar.classList.add('collapsed');
    }
    updateScrimVisibility();
    window.addEventListener('resize', updateScrimVisibility);
    
    // 设置当前模型显示
    if (currentModelName) {
      currentModelName.textContent = getModelDisplayName(currentModel);
    }
    updateModelSelectorActive();
    updateHomeModeChips();
    setActiveView('home');
    setComposerBusy(false);
    updateTokenExpiryNote();
    setInterval(updateTokenExpiryNote, 1000);
    bootstrapModelTelemetry();

    if (nexusvFooter && typeof IntersectionObserver !== 'undefined') {
      const nexusvFooterObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          nexusvFooter.classList.toggle('is-visible', entry.isIntersecting);
          updateNexusvFooterVisibility();
        });
      }, { threshold: 0.1 });
      nexusvFooterObserver.observe(nexusvFooter);
      updateNexusvFooterVisibility();
    }

    initQueryFromUrl();

    // 加载并渲染聊天记录列表
    renderChatHistoryList();

    // 公告卡片逻辑
    const announcementModal = document.getElementById('announcementModal');
    const closeAnnouncementBtn = document.getElementById('closeAnnouncementBtn');
    const dismissNoticeCheckbox = document.getElementById('dismissNoticeCheckbox');
    const NOTICE_DISMISS_KEY = 'cancri_notice_dismiss_0501_2';

    // 每次进入都显示（除非用户已勾选「下次不再提示」并确认过）
    const alreadyDismissed = localStorage.getItem(NOTICE_DISMISS_KEY) === 'true';
    if (!alreadyDismissed && announcementModal) {
      announcementModal.setAttribute('aria-hidden', 'false');
      announcementModal.classList.add('open');
      if (scrim) scrim.classList.add('show');
    }

    // 关闭公告按钮事件
    if (closeAnnouncementBtn) {
      closeAnnouncementBtn.addEventListener('click', () => {
        if (dismissNoticeCheckbox && dismissNoticeCheckbox.checked) {
          localStorage.setItem(NOTICE_DISMISS_KEY, 'true');
        }
        if (announcementModal) {
          announcementModal.setAttribute('aria-hidden', 'true');
          announcementModal.classList.remove('open');
          if (scrim) scrim.classList.remove('show');
        }
      });
    }

    // 轮播公告逻辑
    function initAnnouncementCarousel() {
      const carousel = document.getElementById('announcementCarousel');
      if (!carousel) return;

      const items = carousel.querySelectorAll('.announcement-item');
      const indicators = carousel.querySelectorAll('.indicator');
      const total = items.length;
      if (total === 0) return;

      let currentIndex = 0;
      let intervalId = null;
      const INTERVAL_DURATION = 4000; // 4秒切换

      function showItem(index) {
        items.forEach((item, i) => {
          item.classList.toggle('active', i === index);
        });
        indicators.forEach((ind, i) => {
          ind.classList.toggle('active', i === index);
        });
        currentIndex = index;
      }

      function nextItem() {
        const next = (currentIndex + 1) % total;
        showItem(next);
      }

      function startAutoPlay() {
        if (intervalId) clearInterval(intervalId);
        intervalId = setInterval(nextItem, INTERVAL_DURATION);
      }

      function stopAutoPlay() {
        if (intervalId) {
          clearInterval(intervalId);
          intervalId = null;
        }
      }

      // 指示器点击事件
      indicators.forEach((ind, i) => {
        ind.addEventListener('click', () => {
          showItem(i);
          startAutoPlay(); // 重置计时
        });
      });

      // 鼠标悬停暂停
      carousel.addEventListener('mouseenter', stopAutoPlay);
      carousel.addEventListener('mouseleave', startAutoPlay);

      // 开始自动轮播
      startAutoPlay();
    }

    initAnnouncementCarousel();
