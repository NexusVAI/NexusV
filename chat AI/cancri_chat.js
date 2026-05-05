    const ARENA_MODE_MIGRATIONS = {
      battle: 'anonymous',
      direct: 'single',
    };
    const ARENA_MODES = new Set(['anonymous', 'side_by_side', 'single']);
    function normalizeArenaMode(mode) {
      const value = String(mode || '').trim();
      const migrated = ARENA_MODE_MIGRATIONS[value] || value;
      return ARENA_MODES.has(migrated) ? migrated : 'anonymous';
    }

    const savedArenaMode = localStorage.getItem('cancri_arena_mode');
    const initialArenaMode = normalizeArenaMode(savedArenaMode);
    if (savedArenaMode !== initialArenaMode) {
      localStorage.setItem('cancri_arena_mode', initialArenaMode);
    }

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
      arenaMode: initialArenaMode,
    };

    const root = document.documentElement;
    const sidebar = document.getElementById('sidebar');
    const scrim = document.getElementById('scrim');
    const toast = document.getElementById('toast');
    const pageWatermarkGrid = document.getElementById('pageWatermarkGrid');
    const customContextMenu = document.getElementById('customContextMenu');
    const homeView = document.getElementById('homeView');
    const leaderboardView = document.getElementById('leaderboardView');
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
    const imageSizeSelect = document.getElementById('imageSizeSelect');
    const attachBtn = document.getElementById('attachBtn');
    const attachmentInput = document.getElementById('attachmentInput');
    const modelSelector = document.getElementById('modelSelector');
    const modelCurrentBtn = document.getElementById('modelCurrentBtn');
    const modelDropdown = document.getElementById('modelDropdown');
    const modelSearchInput = document.getElementById('modelSearchInput');
    const modelFilterRow = document.getElementById('modelFilterRow');
    const currentModelName = document.getElementById('currentModelName');
    const topArenaModeSelector = document.getElementById('topArenaModeSelector');
    const topArenaModeBtn = document.getElementById('topArenaModeBtn');
    const topArenaModeLabel = document.getElementById('topArenaModeLabel');
    const compareModelSelector = document.getElementById('compareModelSelector');
    const compareModelCurrentBtn = document.getElementById('compareModelCurrentBtn');
    const compareModelName = document.getElementById('compareModelName');
    const chatHistorySearchInput = document.getElementById('chatHistorySearchInput');
    const sidebarSearchWrap = document.getElementById('sidebarSearchWrap');
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

    // 共享额度信息
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
    const SHARED_QUOTA_REFRESH_INTERVAL_MS = 60 * 60 * 1000; // 共享额度页面打开探测一次，后续主要跟随真实请求头更新
    const INDEPENDENT_MODEL_PING_INTERVAL_MS = 60 * 60 * 1000; // 独立额度模型1小时ping一次
    const MODEL_STATUS_REFRESH_INTERVAL_MS = INDEPENDENT_MODEL_PING_INTERVAL_MS;
    const RATE_LIMIT_UPDATE_INTERVAL_MS = SHARED_QUOTA_REFRESH_INTERVAL_MS;
    const DEFAULT_MODEL_ID = 'grok-4.20-fast';
    const DEFAULT_COMPARE_MODEL_ID = 'minimax-m2.7';
    const RATE_LIMIT_PROBE_MODEL_ID = DEFAULT_MODEL_ID;
    let INDEPENDENT_QUOTA_MODEL_IDS = new Set();
    let rateLimitRefreshToken = 0;
    let independentModelPingTimer = null;
    let modelTelemetryLastRefreshedAt = 0;

    // 模型状态：额度和速度
    const modelStatus = new Map(); // modelId -> { quotaRemaining, quotaLimit, speedMs, speedLevel, lastChecked, error }
    const SPEED_TEST_INTERVAL_MS = INDEPENDENT_MODEL_PING_INTERVAL_MS;
    const QUOTA_PROBE_INTERVAL_MS = SHARED_QUOTA_REFRESH_INTERVAL_MS;

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
          return '当前模型暂时不可用，请检查网络后重试。';
      }
    }

    function parseBackendErrorPayload(errorText) {
      const raw = String(errorText || '').trim();
      if (!raw) return { message: '', code: '' };

      try {
        const parsed = JSON.parse(raw);
        const parsedError = parsed?.error;
        let message = typeof parsedError === 'string'
          ? parsedError
          : parsedError?.message || parsed?.message || parsed?.detail || raw;
        // 如果 error 是通用占位符（如 "Internal error"），优先使用 detail 字段
        if (message === 'Internal error' && parsed?.detail) {
          message = parsed.detail;
        }
        return {
          message,
          code: String(parsed?.code || parsedError?.code || parsed?.error || '').trim(),
          retryAfter: parsed?.retry_after_seconds,
        };
      } catch {
        return { message: raw, code: '' };
      }
    }

    function formatSecurityGuardMessage(payload, fallback = '请求触发安全风控，请放慢速度后重试。') {
      const code = String(payload?.code || '').trim();
      const message = String(payload?.message || '').trim();
      const retryAfter = Number(payload?.retryAfter);
      if (code === 'anonymous_not_allowed') {
        authSessionPromise = null;
        showAuthOverlay();
        return message || '请使用邮箱验证码登录后再使用。';
      }
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
      if (usesSharedQuota(modelId) && Number.isFinite(rateLimitInfo.userLockedUntil) && rateLimitInfo.userLockedUntil > now) {
        return '今日共享额度已用完，请明天 0 点后再试，或先切换其他模型。';
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
      const isScopeModel = usesSharedQuota(targetModelId);

      const userLimit = parseHeaderInteger(headers.get('x-cancri-user-limit') || headers.get('X-Cancri-User-Limit'));
      const userRemaining = parseHeaderInteger(headers.get('x-cancri-user-remaining') || headers.get('X-Cancri-User-Remaining'));
      const modelLimit = parseHeaderInteger(headers.get('x-cancri-model-limit') || headers.get('X-Cancri-Model-Limit'));
      const modelRemaining = parseHeaderInteger(headers.get('x-cancri-model-remaining') || headers.get('X-Cancri-Model-Remaining'));

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
            for (const scopeModelId of Object.keys(MODEL_IDS).filter(usesSharedQuota)) {
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
          if (!usesSharedQuota(modelId)) {
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

    function scheduleIndependentModelPingRefresh(delayMs) {
      if (independentModelPingTimer) {
        clearTimeout(independentModelPingTimer);
        independentModelPingTimer = null;
      }

      independentModelPingTimer = setTimeout(() => {
        refreshIndependentModelPing()
          .catch(() => {})
          .finally(() => {
            scheduleIndependentModelPingRefresh(INDEPENDENT_MODEL_PING_INTERVAL_MS);
          });
      }, Math.max(0, delayMs));
    }

    async function refreshSharedQuota() {
      await refreshRateLimitForCurrentModel(true);
      modelTelemetryLastRefreshedAt = Date.now();
      persistModelTelemetryCache();
    }

    async function refreshIndependentModelPing() {
      // 临时禁用全模型批量 ping，避免页面启动时几十个 POST 并发打爆 chat-gateway
      return;
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
        refreshSharedQuota(),
        refreshIndependentModelPing(),
      ]);
      autoSwitchIfCurrentModelUnavailable();
      scheduleIndependentModelPingRefresh(INDEPENDENT_MODEL_PING_INTERVAL_MS);
    }

    function isModelAvailable(modelId) {
      clearExpiredQuotaLocks();
      if (!isModelEnabled(modelId)) return false;
      const now = Date.now();

      if (usesSharedQuota(modelId)) {
        if (Number.isFinite(rateLimitInfo.userLockedUntil) && rateLimitInfo.userLockedUntil > now) {
          return false;
        }
        const status = getModelStatus(modelId);
        if (Number.isFinite(status.lockedUntil) && status.lockedUntil > now) return false;
        if (!isTelemetryFresh(status.lastChecked)) return true;
        if (status.quotaRemaining !== null && status.quotaRemaining <= 0) return false;
        return true;
      }

      // 独立额度模型：看锁定状态，未锁定则可用
      const status = getModelStatus(modelId);
      if (Number.isFinite(status.lockedUntil) && status.lockedUntil > now) return false;
      return true;
    }

    async function pingModel(modelId) {
      const start = performance.now();
      try {
        const probeModel = MODEL_IDS[modelId] || modelId;
        const probeEndpoint = getModelProbeEndpoint(modelId);

        const response = await proxyFetch(EDGE_FUNCTION_URL, {
          method: 'POST',
          headers: await proxyHeaders(),
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
      const availableModels = SELECTABLE_MODELS.map(model => model.id).filter(id => id !== currentModel && isModelAvailable(id));
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

    function usesSharedQuota(modelId = currentModel) {
      return !INDEPENDENT_QUOTA_MODEL_IDS.has(modelId);
    }

    function getRateLimitRequestModelId(modelId = currentModel) {
      if (modelId === 'kimi-k2.6-alt') {
        return MODEL_IDS[modelId] || modelId;
      }
      if (usesSharedQuota(modelId)) {
        return MODEL_IDS[modelId] || modelId;
      }
      return MODEL_IDS[RATE_LIMIT_PROBE_MODEL_ID] || RATE_LIMIT_PROBE_MODEL_ID;
    }

    function getModelProbeEndpoint(modelId = currentModel) {
      return modelId === 'image-precise' || modelId === 'image-fast' || modelId === 'gpt-image-2' ? 'image' : 'chat';
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
      'deepseek-v4-flash': DEFAULT_MODEL_ID,
      'deepseek-v4-flash-alt': DEFAULT_MODEL_ID,
      'kimi-k2.6': DEFAULT_MODEL_ID,
      'kimi-k2.6-futureppo': DEFAULT_MODEL_ID,
      'deepseek-v4-pro-futureppo': DEFAULT_MODEL_ID,
      'deepseek-v4-flash-futureppo': DEFAULT_MODEL_ID,
      'gemma-4-31b-it': DEFAULT_MODEL_ID,
      'gemma-4-31b-chat': DEFAULT_MODEL_ID,
      'gpt-oss-120b-futureppo': DEFAULT_MODEL_ID,
      'grok-code-fast-1': DEFAULT_MODEL_ID,
      'gemini-3.0-flash-high': DEFAULT_MODEL_ID,
      'gemini-3-flash-preview': DEFAULT_MODEL_ID,
      'gemini-3.1-flash-lite-preview': DEFAULT_MODEL_ID,
      'gpt-5.4': DEFAULT_MODEL_ID,
      'glm-5v-turbo': DEFAULT_MODEL_ID,
      'kimi-k2-instruct': DEFAULT_MODEL_ID,
      'minimax-m2.5-alt': DEFAULT_MODEL_ID,
      'claude-haiku-4-5-20251001': DEFAULT_MODEL_ID,
      'glm-5.1-futureppo': DEFAULT_MODEL_ID,
    };
    const MODEL_PRIORITY_IDS = [
      'minimax-m2.7',
      'grok-4.20-fast',
      'claude-opus-4.6',
      'gemini-2.5-pro',
      'qwen3-max',
      'kimi-k2.6-alt',
      'kimi-k2.6-extended',
      'glm-5.1',
      'qwen3-coder-plus',
      'qwen3-coder',
      'deepseek-r1',
    ];
    const MODEL_PRIORITY = new Map(MODEL_PRIORITY_IDS.map((id, index) => [id, index]));
    const MODEL_DEPRIORITY = new Map();
    const MODEL_CATALOG = [
      { id: 'grok-4.20-fast', displayName: 'Grok 4.20 Fast', brand: 'Grok', canonicalId: 'grok-4.20-fast', lineLabel: '线路一', visible: true, enabled: true, arena: true, iconPath: './grok.svg', tags: ['新', '快速'] },
      { id: 'grok-code-fast-1', displayName: 'Grok Code Fast 1', brand: 'Grok', canonicalId: 'grok-code-fast-1', lineLabel: '线路一', visible: false, enabled: false, arena: false, iconPath: './grok.svg', tags: ['编码', '快速'] },
      { id: 'minimax-m2.7', displayName: 'MiniMax M2.7', brand: 'MiniMax', canonicalId: 'minimax-m2.7', lineLabel: '线路一', visible: true, enabled: true, arena: true, iconPath: './minimax-color.svg', tags: ['新', '快速'] },
      { id: 'gemini-3.1-flash-lite-preview', displayName: 'Gemini 3.1 Flash Lite Preview', brand: 'Google', canonicalId: 'gemini-3.1-flash-lite-preview', lineLabel: '线路一', visible: false, enabled: false, arena: false, iconPath: './gemini-color.svg', tags: ['新', '轻量'] },
      { id: 'gemini-3-flash-preview', displayName: 'Gemini 3 Flash Preview', brand: 'Google', canonicalId: 'gemini-3-flash-preview', lineLabel: '线路一', visible: false, enabled: false, arena: false, iconPath: './gemini-color.svg', tags: ['新', '均衡'] },
      { id: 'gemma-4-31b-chat', displayName: 'Gemma 4 Chat', brand: 'Google', canonicalId: 'gemma-4-31b-chat', lineLabel: '线路一', visible: false, enabled: false, arena: false, iconPath: './gemini-color.svg', tags: ['新', '开放'] },
      { id: 'deepseek-v4-flash', displayName: 'DeepSeek-V4-Flash', brand: 'DeepSeek', canonicalId: 'deepseek-v4-flash', lineLabel: '线路一', visible: false, enabled: false, arena: false, iconPath: './deepseek-color (1).svg', tags: ['闪电', '快速', '稳定'] },
      { id: 'deepseek-v4-pro', displayName: 'DeepSeek-V4-Pro', brand: 'DeepSeek', canonicalId: 'deepseek-v4-pro', lineLabel: '线路一', visible: false, enabled: true, arena: false, iconPath: './deepseek-color (1).svg', tags: ['Pro研究级模型', '隐藏调试'] },
      { id: 'deepseek-v4-pro-alt', displayName: 'DeepSeek-V4-Pro', brand: 'DeepSeek', canonicalId: 'deepseek-v4-pro', lineLabel: '线路二', visible: false, enabled: true, arena: false, iconPath: './deepseek-color (1).svg', tags: ['Pro研究级模型', '隐藏调试'] },
      { id: 'step-3.5-flash', displayName: 'Step-3.5', brand: '阶跃星辰', canonicalId: 'step-3.5-flash', lineLabel: '线路一', visible: true, enabled: true, arena: true, iconPath: './stepfun-color.svg', tags: ['快速', '稳定'] },
      { id: 'hy3-preview', displayName: '混元3', brand: '腾讯混元', canonicalId: 'hy3-preview', lineLabel: '线路一', visible: true, enabled: true, arena: false, iconPath: './yuanbao-color.svg', tags: ['低限额', '通用'] },
      { id: 'gpt-oss-120b', displayName: 'GPT-OSS', brand: 'OpenAI', canonicalId: 'gpt-oss-120b', lineLabel: '线路一', visible: true, enabled: true, arena: false, iconPath: './openai.svg', tags: ['通用', '慢'] },
      { id: 'gpt-5.4', displayName: 'GPT-5.4', brand: 'OpenAI', canonicalId: 'gpt-5.4', lineLabel: '线路一', visible: false, enabled: false, arena: false, iconPath: './openai.svg', tags: ['每日限流', '通用'] },
      { id: 'claude-opus-4.6', displayName: 'Claude Opus 4.6', brand: 'Anthropic Claude', canonicalId: 'claude-opus-4.6', lineLabel: '线路一', visible: true, enabled: true, arena: false, iconPath: './claude-color.svg', tags: ['每日限流', '长文本'] },
      { id: 'claude-sonnet-4.6', displayName: 'Claude Sonnet 4.6', brand: 'Anthropic Claude', canonicalId: 'claude-sonnet-4.6', lineLabel: '线路一', visible: false, enabled: true, arena: false, iconPath: './claude-color.svg', tags: ['均衡', '隐藏调试'] },
      { id: 'gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', brand: 'Google', canonicalId: 'gemini-2.5-pro', lineLabel: '线路一', visible: true, enabled: true, arena: false, iconPath: './gemini-color.svg', tags: ['每日限流', '推理'] },
      { id: 'nemotron-3-super', displayName: 'Nemotron-3-super', brand: 'NVIDIA Nemotron', canonicalId: 'nemotron-3-super', lineLabel: '线路一', visible: true, enabled: true, arena: false, iconPath: './nvidia-color.svg', tags: ['通用'] },
      { id: 'ling-2.6-1t', displayName: 'Ling 2.6', brand: '蚂蚁 Ling', canonicalId: 'ling-2.6-1t', lineLabel: '线路一', visible: true, enabled: true, arena: false, iconPath: './antgroup-color.svg', tags: ['通用'] },
      { id: 'ling-2.6-1t-alt', displayName: 'Ling 2.6', brand: '蚂蚁 Ling', canonicalId: 'ling-2.6-1t', lineLabel: '线路二', visible: true, enabled: true, arena: false, iconPath: './antgroup-color.svg', tags: ['稳定'] },
      { id: 'spark-x2', displayName: 'spark-x2', brand: '讯飞星火', canonicalId: 'spark-x2', lineLabel: '线路一', visible: true, enabled: true, arena: false, iconPath: './spark-color.svg', tags: ['推理'] },
      { id: 'deepseek-r1', displayName: 'DeepSeek-R1', brand: 'DeepSeek', canonicalId: 'deepseek-r1', lineLabel: '线路一', visible: true, enabled: true, arena: true, iconPath: './deepseek-color (1).svg', tags: ['强推理', '稳定'] },
      { id: 'qwen3.5', displayName: 'Qwen 3.5', brand: '通义千问', canonicalId: 'qwen3.5', lineLabel: '线路一', visible: true, enabled: true, arena: false, iconPath: './qwen-color.svg', tags: ['多模态', '全能型AI'], multimodal: true },
      { id: 'qwen3-coder', displayName: 'Qwen3-Coder', brand: '通义千问', canonicalId: 'qwen3-coder', lineLabel: '线路一', visible: true, enabled: true, arena: false, iconPath: './qwen-color.svg', tags: ['多模态', '编码专项'], multimodal: true },
      { id: 'kimi-k2.5', displayName: 'Kimi K2.5', brand: 'Kimi', canonicalId: 'kimi-k2.5', lineLabel: '线路一', visible: true, enabled: true, arena: false, iconPath: './moonshot.svg', tags: ['多模态', '复杂任务处理'], multimodal: true },
      { id: 'kimi-k2.6', displayName: 'Kimi K2.6', brand: 'Kimi', canonicalId: 'kimi-k2.6', lineLabel: '线路一', visible: false, enabled: false, arena: false, iconPath: './moonshot.svg', tags: ['多模态', '超复杂编程'], multimodal: true },
      { id: 'kimi-k2.6-alt', displayName: 'Kimi K2.6', brand: 'Kimi', canonicalId: 'kimi-k2.6', lineLabel: '线路二', visible: true, enabled: true, arena: false, iconPath: './moonshot.svg', tags: ['多模态', '稳定'], multimodal: true },
      { id: 'kimi-k2.6-extended', displayName: 'Kimi K2.6', brand: 'Kimi', canonicalId: 'kimi-k2.6', lineLabel: '线路三', visible: true, enabled: true, arena: false, iconPath: './moonshot.svg', tags: ['多模态', '稳定'], multimodal: true },
      { id: 'glm-5', displayName: 'GLM-5', brand: '智谱 GLM', canonicalId: 'glm-5', lineLabel: '线路一', visible: true, enabled: true, arena: true, iconPath: './zhipu-color.svg', tags: ['深度编程'] },
      { id: 'glm-5.1-alt', displayName: 'GLM-5.1', brand: '智谱 GLM', canonicalId: 'glm-5.1', lineLabel: '线路二', visible: true, enabled: true, arena: false, iconPath: './zhipu-color.svg', tags: ['复杂编码处理', '稳定'] },
      { id: 'glm-5.1', displayName: 'GLM-5.1', brand: '智谱 GLM', canonicalId: 'glm-5.1', lineLabel: '线路一', visible: true, enabled: true, arena: false, iconPath: './zhipu-color.svg', tags: ['复杂编码处理', '稳定'] },
      { id: 'glm-4.7', displayName: 'GLM-4.7', brand: '智谱 GLM', canonicalId: 'glm-4.7', lineLabel: '线路一', visible: true, enabled: true, arena: false, iconPath: './zhipu-color.svg', tags: ['Max', '约等于Gemini3'] },
      { id: 'qwen3.6-max-preview', displayName: 'qwen3.6-max-preview', brand: '通义千问', canonicalId: 'qwen3.6-max-preview', lineLabel: '线路一', visible: true, enabled: true, arena: false, iconPath: './qwen-color.svg', tags: ['预览'] },
      { id: 'qwen3.6-plus', displayName: 'qwen3.6-plus', brand: '通义千问', canonicalId: 'qwen3.6-plus', lineLabel: '线路一', visible: true, enabled: true, arena: true, iconPath: './qwen-color.svg', tags: ['多模态', '均衡之选'], multimodal: true },
      { id: 'minimax-m2.5', displayName: 'MiniMax-M2.5', brand: 'MiniMax', canonicalId: 'minimax-m2.5', lineLabel: '线路一', visible: true, enabled: true, arena: false, iconPath: './minimax-color.svg', tags: ['新', '性价比之选 快速'] },
      { id: 'qwen3.6-flash', displayName: 'Qwen3.6-Flash', brand: '通义千问', canonicalId: 'qwen3.6-flash', lineLabel: '线路一', visible: true, enabled: true, arena: false, iconPath: './qwen-color.svg', tags: ['多模态', '快速', '稳定'], multimodal: true },
      { id: 'kimi-k2.5-alt', displayName: 'Kimi K2.5', brand: 'Kimi', canonicalId: 'kimi-k2.5', lineLabel: '线路二', visible: true, enabled: true, arena: false, iconPath: './moonshot.svg', tags: ['多模态', '稳定'], multimodal: true },
      { id: 'deepseek-v3.2', displayName: 'DeepSeek-V3.2', brand: 'DeepSeek', canonicalId: 'deepseek-v3.2', lineLabel: '线路一', visible: true, enabled: true, arena: false, iconPath: './deepseek-color (1).svg', tags: ['稳定', '稳定'] },
      { id: 'deepseek-v3.2-exp', displayName: 'DeepSeek-V3.2-Exp', brand: 'DeepSeek', canonicalId: 'deepseek-v3.2-exp', lineLabel: '线路一', visible: true, enabled: true, arena: false, iconPath: './deepseek-color (1).svg', tags: ['实验版', '稳定'] },
      { id: 'glm-4.5-air', displayName: 'GLM-4.5-Air', brand: '智谱 GLM', canonicalId: 'glm-4.5-air', lineLabel: '线路一', visible: true, enabled: true, arena: false, iconPath: './zhipu-color.svg', tags: ['轻量', '稳定'] },
      { id: 'minimax-m2.5-alt', displayName: 'MiniMax-M2.5', brand: 'MiniMax', canonicalId: 'minimax-m2.5', lineLabel: '线路二', visible: false, enabled: false, arena: false, iconPath: './minimax-color.svg', tags: ['稳定'] },
      { id: 'deepseek-v3.1', displayName: 'DeepSeek-V3.1', brand: 'DeepSeek', canonicalId: 'deepseek-v3.1', lineLabel: '线路一', visible: true, enabled: true, arena: false, iconPath: './deepseek-color (1).svg', tags: ['稳定', '均衡'] },
      { id: 'qwen3-coder-plus', displayName: 'Qwen3-Coder-Plus', brand: '通义千问', canonicalId: 'qwen3-coder-plus', lineLabel: '线路一', visible: true, enabled: true, arena: false, iconPath: './qwen-color.svg', tags: ['多模态', '专业编码', '稳定'], multimodal: true },
      { id: 'qwen3-max', displayName: 'Qwen3-Max', brand: '通义千问', canonicalId: 'qwen3-max', lineLabel: '线路一', visible: true, enabled: true, arena: true, iconPath: './qwen-color.svg', tags: ['多模态', '旗舰', '稳定'], multimodal: true },
      { id: 'kimi-k2-instruct', displayName: 'Kimi-K2-Instruct', brand: 'Kimi', canonicalId: 'kimi-k2-instruct', lineLabel: '线路一', visible: false, enabled: false, arena: false, iconPath: './moonshot.svg', tags: ['多模态', '指令优化', '稳定'], multimodal: true },
      { id: 'qwen3.6-plus-20260402', displayName: 'Qwen3.6-Plus', brand: '通义千问', canonicalId: 'qwen3.6-plus-20260402', lineLabel: '线路一', visible: true, enabled: true, arena: false, iconPath: './qwen-color.svg', tags: ['多模态', '2026-04-02', '稳定'], multimodal: true },
      { id: 'deepseek-r1-0528', displayName: 'DeepSeek-R1-0528', brand: 'DeepSeek', canonicalId: 'deepseek-r1-0528', lineLabel: '线路一', visible: true, enabled: true, arena: false, iconPath: './deepseek-color (1).svg', tags: ['强推理', '稳定'] },
      { id: 'gemini-3.0-flash-high', displayName: 'Gemini 3.0 Flash High', brand: 'Google', canonicalId: 'gemini-3.0-flash-high', lineLabel: '线路一', visible: false, enabled: false, arena: false, iconPath: './gemini-color.svg', tags: ['新', '高速'], multimodal: true },
      { id: 'glm-5v-turbo', displayName: 'GLM-5V-Turbo', brand: '智谱 GLM', canonicalId: 'glm-5v-turbo', lineLabel: '线路一', visible: false, enabled: false, arena: false, iconPath: './zhipu-color.svg', tags: ['多模态', '视觉', '新'], multimodal: true },
      { id: 'mimo-v2.5-pro', displayName: 'MiMo-V2.5-Pro', brand: '小米 MiMo', canonicalId: 'mimo-v2.5-pro', lineLabel: '线路一', visible: true, enabled: true, arena: false, iconPath: './xiaomimimo-color.svg', tags: ['长程任务', '推理'] },
      { id: 'gpt-image-2', displayName: 'GPT Image 2', brand: 'OpenAI', canonicalId: 'gpt-image-2', lineLabel: '线路一', visible: true, enabled: true, arena: false, imageOnly: true, iconPath: './openai.svg', tags: ['生图'] }
    ].sort((a, b) => {
      const rankA = MODEL_PRIORITY.has(a.id)
        ? MODEL_PRIORITY.get(a.id)
        : (MODEL_DEPRIORITY.has(a.id) ? 2000 + MODEL_DEPRIORITY.get(a.id) : 1000);
      const rankB = MODEL_PRIORITY.has(b.id)
        ? MODEL_PRIORITY.get(b.id)
        : (MODEL_DEPRIORITY.has(b.id) ? 2000 + MODEL_DEPRIORITY.get(b.id) : 1000);
      return rankA - rankB;
    });
    const MODEL_CATALOG_BY_ID = new Map(MODEL_CATALOG.map(model => [model.id, model]));
    const ENABLED_MODEL_CATALOG = MODEL_CATALOG.filter(model => model.enabled !== false);
    const SELECTABLE_MODELS = MODEL_CATALOG.filter(model => model.visible !== false && model.enabled !== false);
    const ARENA_MODELS = SELECTABLE_MODELS.filter(model => model.arena !== false && !String(model.id).startsWith('image-'));
    const MODEL_IDS = Object.fromEntries(ENABLED_MODEL_CATALOG.map(model => [model.id, model.id]));
    const MULTIMODAL_MODEL_IDS = new Set(ENABLED_MODEL_CATALOG.filter(model => model.multimodal).map(model => model.id));
    INDEPENDENT_QUOTA_MODEL_IDS = new Set();

    function getModelMeta(modelId) {
      return MODEL_CATALOG_BY_ID.get(modelId) || {
        id: modelId || 'unknown',
        displayName: modelId || '未知模型',
        brand: '未知品牌',
        canonicalId: modelId || 'unknown',
        lineLabel: '',
        visible: false,
        enabled: false,
        arena: false,
        iconPath: './openai.svg',
        tags: []
      };
    }

    function isModelEnabled(modelId) {
      return getModelMeta(modelId).enabled !== false && Boolean(MODEL_IDS[modelId]);
    }

    function isModelSelectable(modelId) {
      const meta = getModelMeta(modelId);
      if (meta.visible === false || meta.enabled === false || !MODEL_IDS[modelId]) return false;
      if (meta.imageOnly && (state.arenaMode === 'side_by_side' || state.arenaMode === 'anonymous')) return false;
      return true;
    }

    function getFallbackModelId(excludeId = '') {
      const model = SELECTABLE_MODELS.find(item => item.id !== excludeId && isModelEnabled(item.id));
      return model ? model.id : DEFAULT_MODEL_ID;
    }

    function resolveSelectableModelId(modelId, fallbackId = DEFAULT_MODEL_ID) {
      const migrated = MODEL_SELECTION_MIGRATIONS[modelId] || modelId;
      if (isModelSelectable(migrated)) return migrated;
      if (isModelSelectable(fallbackId)) return fallbackId;
      return getFallbackModelId(migrated);
    }

    function getModelDisplayName(modelId) {
      return getModelMeta(modelId).displayName || modelId;
    }

    function getModelBrandName(modelId) {
      const meta = getModelMeta(modelId);
      if (meta.brand) return meta.brand;
      const text = `${meta.id || ''} ${meta.displayName || ''} ${meta.iconPath || ''}`.toLowerCase();
      if (text.includes('qwen')) return '通义千问';
      if (text.includes('deepseek')) return 'DeepSeek';
      if (text.includes('grok')) return 'Grok';
      if (text.includes('gemini') || text.includes('gemma')) return 'Google';
      if (text.includes('claude')) return 'Anthropic Claude';
      if (text.includes('gpt') || text.includes('openai')) return 'OpenAI';
      if (text.includes('kimi') || text.includes('moonshot')) return 'Kimi';
      if (text.includes('glm') || text.includes('zhipu')) return '智谱 GLM';
      if (text.includes('minimax')) return 'MiniMax';
      if (text.includes('mimo') || text.includes('xiaomi')) return '小米 MiMo';
      if (text.includes('hunyuan') || text.includes('hy3') || text.includes('yuanbao')) return '腾讯混元';
      if (text.includes('spark')) return '讯飞星火';
      if (text.includes('ling') || text.includes('antgroup')) return '蚂蚁 Ling';
      if (text.includes('nemotron') || text.includes('nvidia')) return 'NVIDIA Nemotron';
      if (text.includes('step')) return '阶跃星辰';
      return meta.displayName || modelId || '未知模型';
    }

    function getModelIconPath(modelId) {
      return getModelMeta(modelId).iconPath || './openai.svg';
    }

    function createModelMetadata(modelId = currentModel) {
      const meta = getModelMeta(modelId);
      return {
        modelId: meta.id,
        modelName: meta.displayName || meta.id,
        iconPath: meta.iconPath || './openai.svg'
      };
    }

    const savedModelSelection = localStorage.getItem('cancri_current_model') || DEFAULT_MODEL_ID;
    let currentModel = resolveSelectableModelId(savedModelSelection, DEFAULT_MODEL_ID);
    if (currentModel !== savedModelSelection) {
      localStorage.setItem('cancri_current_model', currentModel);
    }

    const savedCompareModelSelection = localStorage.getItem('cancri_compare_model') || DEFAULT_COMPARE_MODEL_ID;
    let compareModel = resolveSelectableModelId(savedCompareModelSelection, DEFAULT_COMPARE_MODEL_ID);
    if (compareModel === currentModel) {
      compareModel = getFallbackModelId(currentModel);
      localStorage.setItem('cancri_compare_model', compareModel);
    }

    let modelSelectTarget = 'primary';

    function isMultimodalModel(modelId) {
      return MULTIMODAL_MODEL_IDS.has(modelId);
    }

    let isMultimodal = isMultimodalModel(currentModel);

    function getModelRequestOptions(modelId) {
      if (modelId === 'glm-5' || modelId === 'glm-5.1-alt' || modelId === 'glm-4.7' || modelId === 'qwen3.6-plus' || modelId === 'qwen3.6-max-preview' || modelId === 'kimi-k2.6' || modelId === 'kimi-k2.6-alt' || modelId === 'kimi-k2.6-extended' || modelId === 'deepseek-v4-pro' || modelId === 'deepseek-v4-pro-alt' || modelId === 'deepseek-r1' || modelId === 'deepseek-v3.2' || modelId === 'deepseek-v3.2-exp' || modelId === 'deepseek-v3.1' || modelId === 'deepseek-r1-0528') {
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
    const SUPABASE_ANON_KEY = (window.__SUPABASE_ANON_KEY__ || '').trim();
    const EDGE_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/chat-gateway`;
    const DEFAULT_IMAGE_MODEL = 'image-precise';
    const OPENAI_IMAGE_MODEL = 'image-precise';
    const MAX_REPEATED_TOOL_CALLS = 3;
    const FETCH_TIMEOUT_MS = 20000;
    const CHAT_REQUEST_TIMEOUT_MS = 25000;
    const CHAT_TURN_TIMEOUT_MS = 180000;
    const TOOL_CALL_TIMEOUT_MS = 25000;

    // 为特定模型设置更长的超时（如 Claude Opus 响应较慢）
    function getChatRequestTimeoutMs(modelId) {
      if (modelId === 'claude-opus-4.6') return 60000; // Claude Opus 60秒
      return CHAT_REQUEST_TIMEOUT_MS;
    }

    let supabaseClient = null;
    let authSessionPromise = null;
    let authInitialized = false;

    function getSupabaseClient() {
      if (supabaseClient) return supabaseClient;
      if (!SUPABASE_ANON_KEY) {
        throw new Error('Supabase anon key 未配置，无法创建会话。');
      }
      if (!window.supabase?.createClient) {
        throw new Error('Supabase Auth SDK 加载失败，请检查网络或刷新页面。');
      }
      supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
          storageKey: 'cancri_supabase_auth'
        }
      });
      return supabaseClient;
    }

    function showAuthOverlay() {
      const overlay = document.getElementById('authOverlay');
      if (overlay) overlay.classList.add('visible');
    }

    function hideAuthOverlay() {
      const overlay = document.getElementById('authOverlay');
      if (overlay) overlay.classList.remove('visible');
    }

    function updateAccountInfo(user) {
      if (!user) return;
      const email = user.email || '';
      const initials = email ? email.charAt(0).toUpperCase() : 'U';
      // 更新侧边栏账户信息
      const accountName = document.querySelector('.account-strip .account-name');
      const accountPlan = document.querySelector('.account-strip .account-plan');
      const avatarEl = document.querySelector('.account-strip .avatar');
      const popoverAvatar = document.querySelector('.account-popover .avatar');
      const popoverName = document.querySelector('.account-popover .popover-item span[style*="font-size:14px"]');
      const popoverSub = document.querySelector('.account-popover .popover-item span[style*="font-size:12px"]');
      if (accountName) accountName.textContent = getNickname() || email;
      if (accountPlan) accountPlan.textContent = '已登录';
      if (avatarEl) avatarEl.textContent = initials;
      if (popoverAvatar) popoverAvatar.textContent = initials;
      if (popoverName) popoverName.textContent = getNickname() || email;
      if (popoverSub) popoverSub.textContent = '邮箱验证码登录';
      refreshNicknameUI();
      // 同步刷新hero区域的个性化问候语
      updateHomeHeroText();
    }

    async function ensureAuthSession() {
      if (!authSessionPromise) {
        authSessionPromise = (async () => {
          const client = getSupabaseClient();
          const { data: sessionData, error: sessionError } = await client.auth.getSession();
          if (sessionError) throw sessionError;
          if (sessionData?.session?.access_token) {
            const user = sessionData.session.user;
            // 检查是否为匿名用户
            if (user?.is_anonymous) {
              // 匿名用户需要重新登录
              await client.auth.signOut();
              authSessionPromise = null;
              showAuthOverlay();
              throw new Error('请使用邮箱验证码登录。');
            }
            updateAccountInfo(user);
            hideAuthOverlay();
            return sessionData.session;
          }
          // 无会话，显示登录界面
          showAuthOverlay();
          throw new Error('请先登录后再使用。');
        })().catch(error => {
          authSessionPromise = null;
          throw error;
        });
      }
      return authSessionPromise;
    }

    async function sendOtp(email) {
      const client = getSupabaseClient();
      const { error } = await client.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: true,
          emailRedirectTo: window.location.origin + window.location.pathname,
        },
      });
      if (error) throw error;
    }

    async function verifyOtp(email, token) {
      const client = getSupabaseClient();
      const { data, error } = await client.auth.verifyOtp({
        email,
        token,
        type: 'email',
      });
      if (error) throw error;
      return data;
    }

    async function handleLogout() {
      const client = getSupabaseClient();
      await client.auth.signOut();
      authSessionPromise = null;
      authInitialized = false;
      showAuthOverlay();
      // 重置账户显示
      const accountName = document.querySelector('.account-strip .account-name');
      const accountPlan = document.querySelector('.account-strip .account-plan');
      const avatarEl = document.querySelector('.account-strip .avatar');
      if (accountName) accountName.textContent = '登录 / 注册';
      if (accountPlan) accountPlan.textContent = '邮箱验证码账户';
      if (avatarEl) avatarEl.textContent = 'MR';
    }

    function initAuthOverlay() {
      const overlay = document.getElementById('authOverlay');
      if (!overlay) return;

      // 主动检查现有 session，如果是匿名用户则清除并显示登录
      (async () => {
        try {
          const client = getSupabaseClient();
          const { data } = await client.auth.getSession();
          if (data?.session?.user) {
            if (data.session.user.is_anonymous) {
              await client.auth.signOut();
              authSessionPromise = null;
              showAuthOverlay();
            } else {
              updateAccountInfo(data.session.user);
              hideAuthOverlay();
              authSessionPromise = Promise.resolve(data.session);
              authInitialized = true;
            }
          } else {
            showAuthOverlay();
          }
        } catch {
          showAuthOverlay();
        }
      })();

      const emailInput = document.getElementById('authEmailInput');
      const sendOtpBtn = document.getElementById('authSendOtpBtn');
      const emailError = document.getElementById('authEmailError');
      const stepEmail = document.getElementById('authStepEmail');
      const stepOtp = document.getElementById('authStepOtp');
      const otpInput = document.getElementById('authOtpInput');
      const verifyOtpBtn = document.getElementById('authVerifyOtpBtn');
      const otpError = document.getElementById('authOtpError');
      const emailDisplay = document.getElementById('authEmailDisplay');
      const resendOtpBtn = document.getElementById('authResendOtpBtn');
      const backToEmailBtn = document.getElementById('authBackToEmailBtn');

      let currentEmail = '';
      let resendCooldown = 0;

      function showStepOtp() {
        stepEmail.style.display = 'none';
        stepOtp.style.display = '';
        if (emailDisplay) emailDisplay.textContent = currentEmail;
        if (otpInput) otpInput.value = '';
        if (otpError) otpError.textContent = '';
        setTimeout(() => otpInput?.focus(), 100);
      }

      function showStepEmail() {
        stepEmail.style.display = '';
        stepOtp.style.display = 'none';
        if (emailError) emailError.textContent = '';
      }

      if (sendOtpBtn) {
        sendOtpBtn.addEventListener('click', async () => {
          const email = (emailInput?.value || '').trim();
          if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            if (emailError) emailError.textContent = '请输入有效的邮箱地址';
            return;
          }
          // QQ邮箱限制：只允许qq.com和foxmail.com
          const emailLower = email.toLowerCase();
          if (!emailLower.endsWith('@qq.com') && !emailLower.endsWith('@foxmail.com')) {
            if (emailError) emailError.textContent = '暂仅支持QQ邮箱（@qq.com 或 @foxmail.com）注册';
            return;
          }
          sendOtpBtn.disabled = true;
          sendOtpBtn.textContent = '发送中...';
          if (emailError) emailError.textContent = '';
          try {
            currentEmail = email;
            await sendOtp(email);
            showStepOtp();
          } catch (err) {
            if (emailError) emailError.textContent = err.message || '发送失败，请重试';
          } finally {
            sendOtpBtn.disabled = false;
            sendOtpBtn.textContent = '发送验证码';
          }
        });
      }

      if (emailInput) {
        emailInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') sendOtpBtn?.click();
        });
      }

      if (verifyOtpBtn) {
        verifyOtpBtn.addEventListener('click', async () => {
          const token = (otpInput?.value || '').trim();
          if (!token || token.length < 6) {
            if (otpError) otpError.textContent = '请输入验证码';
            return;
          }
          verifyOtpBtn.disabled = true;
          verifyOtpBtn.textContent = '验证中...';
          if (otpError) otpError.textContent = '';
          try {
            const result = await verifyOtp(currentEmail, token);
            if (result?.session) {
              authSessionPromise = Promise.resolve(result.session);
              updateAccountInfo(result.session.user);
              hideAuthOverlay();
              authInitialized = true;
            } else {
              if (otpError) otpError.textContent = '验证失败，请重试';
            }
          } catch (err) {
            if (otpError) otpError.textContent = err.message || '验证码错误或已过期';
          } finally {
            verifyOtpBtn.disabled = false;
            verifyOtpBtn.textContent = '验证登录';
          }
        });
      }

      if (otpInput) {
        otpInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') verifyOtpBtn?.click();
        });
      }

      if (resendOtpBtn) {
        resendOtpBtn.addEventListener('click', async () => {
          if (resendCooldown > Date.now()) return;
          resendOtpBtn.textContent = '发送中...';
          try {
            await sendOtp(currentEmail);
            resendCooldown = Date.now() + 60000;
            resendOtpBtn.textContent = '已重发（60s）';
            const tick = setInterval(() => {
              const remain = Math.ceil((resendCooldown - Date.now()) / 1000);
              if (remain <= 0) {
                clearInterval(tick);
              resendOtpBtn.textContent = '重新发送';
              } else {
                resendOtpBtn.textContent = `重新发送（${remain}s）`;
              }
            }, 1000);
          } catch (err) {
            if (otpError) otpError.textContent = err.message || '重发失败';
            resendOtpBtn.textContent = '重新发送';
          }
        });
      }

      if (backToEmailBtn) {
        backToEmailBtn.addEventListener('click', showStepEmail);
      }

      // 监听 Supabase auth 状态变化
      const client = getSupabaseClient();
      client.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_IN' && session?.user && !session.user.is_anonymous) {
          authSessionPromise = Promise.resolve(session);
          updateAccountInfo(session.user);
          hideAuthOverlay();
          authInitialized = true;
        } else if (event === 'SIGNED_OUT') {
          authSessionPromise = null;
          authInitialized = false;
          showAuthOverlay();
        }
      });
    }

    async function proxyHeaders(extra = {}) {
      return {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        ...extra
      };
    }

    async function authBody(body) {
      const session = await ensureAuthSession();
      return { ...body, __auth_token: session.access_token };
    }

    async function proxyFetch(url, options = {}) {
      const session = await ensureAuthSession();
      const body = typeof options.body === 'string'
        ? JSON.parse(options.body || '{}')
        : (options.body && typeof options.body === 'object' ? { ...options.body } : {});
      body.__auth_token = session.access_token;
      return fetch(url, { ...options, body: JSON.stringify(body) });
    }

    async function proxyFetchWithTimeout(url, options = {}, timeoutMs, label) {
      const session = await ensureAuthSession();
      const body = typeof options.body === 'string'
        ? JSON.parse(options.body || '{}')
        : (options.body && typeof options.body === 'object' ? { ...options.body } : {});
      body.__auth_token = session.access_token;
      return fetchWithTimeout(url, { ...options, body: JSON.stringify(body) }, timeoutMs, label);
    }

    function createChatTurnId() {
      return `turn_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    }

    // 聊天记录管理
    let currentChatId = null;
    let chatHistoryList = [];
    const CHAT_HISTORY_LIST_CACHE_KEY = 'cancri_chat_history_list_cache_v1';

    function readCachedChatHistoryList() {
      try {
        const cached = JSON.parse(localStorage.getItem(CHAT_HISTORY_LIST_CACHE_KEY) || '[]');
        return Array.isArray(cached) ? cached : [];
      } catch {
        return [];
      }
    }

    function writeCachedChatHistoryList(chats) {
      if (!Array.isArray(chats)) return;
      try {
        localStorage.setItem(CHAT_HISTORY_LIST_CACHE_KEY, JSON.stringify(chats.slice(0, 100)));
      } catch {
        // localStorage may be full or disabled; server state remains authoritative.
      }
    }

    function upsertCachedChatSummary(chat) {
      if (!chat?.id) return;
      const summary = {
        id: chat.id,
        title: chat.title || '新对话',
        model: chat.model || currentModel,
        created_at: chat.created_at || new Date().toISOString(),
        updated_at: chat.updated_at || new Date().toISOString()
      };
      const next = [summary, ...readCachedChatHistoryList().filter(item => item?.id !== summary.id)];
      chatHistoryList = next;
      writeCachedChatHistoryList(next);
    }

    function removeCachedChatSummary(chatId) {
      const next = readCachedChatHistoryList().filter(item => item?.id !== chatId);
      chatHistoryList = next;
      writeCachedChatHistoryList(next);
    }

    function getChatHistoryBucket(chat) {
      const raw = chat?.updated_at || chat?.created_at || new Date().toISOString();
      const date = new Date(raw);
      const now = new Date();
      const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const startYesterday = startToday - 24 * 60 * 60 * 1000;
      const time = Number.isFinite(date.getTime()) ? date.getTime() : startToday;
      if (time >= startToday) return 'Today';
      if (time >= startYesterday) return 'Yesterday';
      return 'Older';
    }

    function matchesChatHistorySearch(chat, query) {
      const q = String(query || '').trim().toLowerCase();
      if (!q) return true;
      return [chat?.title, chat?.model, chat?.id].some(value => String(value || '').toLowerCase().includes(q));
    }

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
        const response = await proxyFetch(EDGE_FUNCTION_URL, {
          method: 'POST',
          headers: await proxyHeaders(),
          body: JSON.stringify({ endpoint: 'chat_history', action: 'update', id: chatId, messages: chat.messages || [], title: newTitle })
        });
        if (!response.ok) throw new Error('重命名失败');
        const { data } = await response.json().catch(() => ({}));
        if (data) {
          upsertCachedChatSummary(data);
        }
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
        if (!chatHistoryList.length) {
          listContainer.innerHTML = '<div class="recent-placeholder recent-placeholder-loading">正在加载中</div>';
        }
        const chats = await loadChatHistoryList();
        listContainer.innerHTML = '';

        if (chats.length === 0) {
          listContainer.innerHTML = '<div class="recent-placeholder">暂无聊天记录</div>';
          return;
        }

        const pinned = getPinnedChats();
        const searchQuery = chatHistorySearchInput ? chatHistorySearchInput.value : '';
        const sorted = [...chats].filter(chat => matchesChatHistorySearch(chat, searchQuery)).sort((a, b) => {
          const ap = pinned.includes(a.id);
          const bp = pinned.includes(b.id);
          if (ap !== bp) return ap ? -1 : 1;
          const at = new Date(a.updated_at || a.created_at || 0).getTime();
          const bt = new Date(b.updated_at || b.created_at || 0).getTime();
          return bt - at;
        });

        if (sorted.length === 0) {
          listContainer.innerHTML = '<div class="recent-placeholder">没有匹配的对话</div>';
          return;
        }

        ['Today', 'Yesterday', 'Older'].forEach(bucket => {
          const group = sorted.filter(chat => getChatHistoryBucket(chat) === bucket);
          if (!group.length) return;
          const section = document.createElement('div');
          section.className = 'section-title history-date-title';
          section.textContent = bucket;
          listContainer.appendChild(section);
          group.forEach(chat => {
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
        });
      } catch (error) {
        console.error('加载聊天记录列表失败:', error);
        listContainer.innerHTML = '<div class="recent-placeholder">加载失败</div>';
      }
    }

    // 加载特定聊天记录
    async function loadChat(chatId) {
      try {
        const chat = await loadChatHistory(chatId);
        if (chat && chat.messages) {
          currentChatId = chatId;
          conversationHistory = Array.isArray(chat.messages) ? chat.messages.map(sanitizeHistoryMessage) : [];
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
          const metadata = message.metadata || message.modelMetadata || null;

          // 检测对战卡片格式：【模型 A】...【模型 B】...
          const duelMatch = content.match(/【模型\s*A】\s*([\s\S]*?)【模型\s*B】\s*([\s\S]*)$/);
          if (duelMatch) {
            const answerA = duelMatch[1].trim();
            const answerB = duelMatch[2].trim();
            renderRestoredDuelMessage(answerA, answerB, metadata);
            return;
          }

          // 检测生成图片格式：![generated image](url)
          const imageMatch = content.match(/^!\[generated image\]\((https?:\/\/[^\)]+)\)$/);
          if (imageMatch) {
            const imageUrl = imageMatch[1];
            const id = createAssistantMessage(metadata);
            const messageDiv = document.getElementById(id);
            const answerBody = messageDiv?.querySelector('.answer-body');
            if (answerBody) {
              answerBody.innerHTML = '';
              answerBody.appendChild(createRestoredImageElement(imageUrl));
            }
            return;
          }

          const id = createAssistantMessage(metadata);
          updateAssistantMessage(id, { answer: content, thinking: false });
        }
      });
    }

    function renderRestoredDuelMessage(answerA, answerB, metadata) {
      const messageId = `duel-restored-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const wrapper = document.createElement('div');
      wrapper.className = 'message assistant duel-message';
      wrapper.id = messageId;

      const avatar = document.createElement('div');
      avatar.className = 'message-avatar';
      avatar.textContent = 'A';

      const grid = document.createElement('div');
      grid.className = 'duel-grid';

      const makeCard = (slot, answer) => {
        const card = document.createElement('article');
        card.className = 'duel-card';
        card.dataset.duelSlot = slot;
        const title = `模型 ${slot.toUpperCase()}`;

        const head = document.createElement('div');
        head.className = 'duel-card-head';
        head.innerHTML = `<span>${escapeHtml(title)}</span>`;

        const answerBody = document.createElement('div');
        answerBody.className = 'duel-answer md-content';
        answerBody.dataset.duelAnswer = slot;
        answerBody.innerHTML = answer ? renderMarkdown(answer) : '<span class="typing-indicator">暂无内容</span>';

        card.appendChild(head);
        card.appendChild(answerBody);
        return card;
      };

      grid.appendChild(makeCard('a', answerA));
      grid.appendChild(makeCard('b', answerB));
      wrapper.appendChild(avatar);
      wrapper.appendChild(grid);
      chatMessages.appendChild(wrapper);

      if (window.renderMathInElement) {
        window.renderMathInElement(wrapper);
      }
    }

    function createRestoredImageElement(imageUrl) {
      const wrapper = document.createElement('span');
      wrapper.style.cssText = 'display:inline-block;position:relative;max-width:360px';
      const img = document.createElement('img');
      img.src = imageUrl;
      img.alt = 'generated image';
      img.style.cssText = 'max-width:100%;border-radius:10px;display:block';
      img.addEventListener('contextmenu', (e) => e.preventDefault());
      const dlBtn = document.createElement('button');
      dlBtn.title = '下载图片';
      dlBtn.style.cssText = 'position:absolute;bottom:8px;right:8px;width:30px;height:30px;border-radius:8px;border:none;background:rgba(0,0,0,.45);backdrop-filter:blur(8px);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center';
      dlBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
      dlBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        dlBtn.disabled = true;
        try {
          const resp = await fetch(imageUrl);
          const blob = await resp.blob();
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `cancri-image-${Date.now()}.png`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(a.href);
        } catch {
          window.open(imageUrl, '_blank');
        } finally {
          dlBtn.disabled = false;
        }
      });
      wrapper.appendChild(img);
      wrapper.appendChild(dlBtn);
      return wrapper;
    }

    async function saveChatHistory(messages) {
      try {
        const response = await proxyFetch(EDGE_FUNCTION_URL, {
          method: 'POST',
          headers: await proxyHeaders(),
          body: JSON.stringify({
            endpoint: 'chat_history',
            action: 'create',
            title: generateChatTitle(messages),
            messages: messages,
            model: currentModel
          })
        });

        if (!response.ok) throw new Error('保存聊天记录失败');

        const { data } = await response.json();
        currentChatId = data.id;
        upsertCachedChatSummary(data);
        return data;
      } catch (error) {
        console.error('保存聊天记录失败:', error);
      }
    }

    async function updateChatHistory(chatId, messages) {
      try {
        const response = await proxyFetch(EDGE_FUNCTION_URL, {
          method: 'POST',
          headers: await proxyHeaders(),
          body: JSON.stringify({
            endpoint: 'chat_history',
            action: 'update',
            id: chatId,
            messages: messages,
            title: generateChatTitle(messages)
          })
        });

        if (!response.ok) throw new Error('更新聊天记录失败');

        const { data } = await response.json();
        upsertCachedChatSummary(data);
        return data;
      } catch (error) {
        console.error('更新聊天记录失败:', error);
      }
    }

    async function loadChatHistoryList() {
      try {
        const response = await proxyFetch(EDGE_FUNCTION_URL, {
          method: 'POST',
          headers: await proxyHeaders(),
          body: JSON.stringify({ endpoint: 'chat_history', action: 'list' })
        });

        if (!response.ok) throw new Error('加载聊天记录列表失败');

        const { data } = await response.json();
        chatHistoryList = data || [];
        writeCachedChatHistoryList(chatHistoryList);
        return chatHistoryList;
      } catch (error) {
        console.error('加载聊天记录列表失败:', error);
        const cached = readCachedChatHistoryList();
        if (cached.length) {
          chatHistoryList = cached;
          return cached;
        }
        return chatHistoryList;
      }
    }

    async function loadChatHistory(chatId) {
      try {
        const response = await proxyFetch(EDGE_FUNCTION_URL, {
          method: 'POST',
          headers: await proxyHeaders(),
          body: JSON.stringify({ endpoint: 'chat_history', action: 'get', id: chatId })
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
        const response = await proxyFetch(EDGE_FUNCTION_URL, {
          method: 'POST',
          headers: await proxyHeaders(),
          body: JSON.stringify({ endpoint: 'chat_history', action: 'delete', id: chatId })
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

        removeCachedChatSummary(chatId);
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

    // MiMo TTS 朗读功能，不在模型菜单展示。
    async function speakTextWithMimo(text) {
      if (!text || text.trim().length === 0) {
        showToast('没有可朗读的内容');
        return;
      }

      showToast('正在生成语音...');

      try {
        const response = await proxyFetch(EDGE_FUNCTION_URL, {
          method: 'POST',
          headers: await proxyHeaders(),
          body: JSON.stringify({
            endpoint: 'chat',
            model: 'mimo-v2.5-tts',
            messages: [
              { role: 'user', content: '用自然的声音朗读以下内容' },
              { role: 'assistant', content: text.slice(0, 2000) }
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
        const audioBase64 = data?.choices?.[0]?.message?.audio?.data;
        if (!audioBase64) {
          throw new Error('无法获取音频数据');
        }

        const audioBlob = base64ToBlob(audioBase64, 'audio/wav');
        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl);
        audio.play();
        showToast('开始朗读');
        audio.onended = () => URL.revokeObjectURL(audioUrl);
      } catch (error) {
        console.error('TTS 错误:', error);
        showToast('朗读失败，使用系统语音。');
        if ('speechSynthesis' in window) {
          speechSynthesis.cancel();
          const utterance = new SpeechSynthesisUtterance(text.slice(0, 800));
          utterance.lang = 'zh-CN';
          speechSynthesis.speak(utterance);
        }
      }
    }

    function base64ToBlob(base64, mimeType) {
      const byteCharacters = atob(base64);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      return new Blob([new Uint8Array(byteNumbers)], { type: mimeType });
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

    function setActiveView(view) {
      state.currentView = view;

      document.querySelectorAll('.main > .view').forEach(el => {
        el.classList.toggle('active', el.id === `${view}View`);
      });

      if (homeView) homeView.classList.toggle('active', view === 'home');
      if (leaderboardView) leaderboardView.classList.toggle('active', view === 'leaderboard');
      if (imagesView) imagesView.classList.toggle('active', view === 'images');

      navRows.forEach(row => row.classList.toggle('active', row.dataset.viewTarget === view));
      closePopover();
      closeModal();

      if (modelSelector) modelSelector.hidden = view === 'leaderboard' || state.arenaMode === 'anonymous';
      if (topArenaModeSelector) topArenaModeSelector.style.display = view === 'leaderboard' ? 'none' : '';

      if (view === 'home') {
        updateHomeHeroText();
      }
      if (view === 'leaderboard') {
        loadMainLeaderboard();
      }
      window.dispatchEvent(new CustomEvent('cancri:viewchange', { detail: { view } }));
    }

    function syncTopArenaMode() {
      const modeLabels = {
        single: '单模型',
        anonymous: '匿名对战',
        side_by_side: 'Side by Side'
      };
      if (topArenaModeLabel) topArenaModeLabel.textContent = modeLabels[state.arenaMode] || '单模型';
      topArenaModeSelector?.querySelectorAll('.arena-mode-option').forEach(option => {
        option.classList.toggle('active', option.dataset.mode === state.arenaMode);
      });
      if (topArenaModeSelector) topArenaModeSelector.style.display = state.currentView === 'leaderboard' ? 'none' : '';
      if (modelSelector) modelSelector.hidden = state.arenaMode === 'anonymous' || state.currentView === 'leaderboard';
      if (compareModelSelector) compareModelSelector.hidden = state.arenaMode !== 'side_by_side' || state.currentView === 'leaderboard';
      if (compareModelName) compareModelName.textContent = getModelDisplayName(compareModel);
      if (homeInput) {
        if (state.arenaMode === 'anonymous') homeInput.placeholder = '向两个匿名模型发起同一个问题';
        else if (state.arenaMode === 'side_by_side') homeInput.placeholder = '比较你选择的两个模型回答';
        else homeInput.placeholder = '有问题，尽管问';
      }
    }
    function setTopArenaMode(mode) {
      state.arenaMode = normalizeArenaMode(mode || 'single');
      localStorage.setItem('cancri_arena_mode', state.arenaMode);
      syncTopArenaMode();
      renderModelDropdownFromCatalog();
      // 如果当前模型是图像专用模型，切换到非图像模型
      const currentMeta = getModelMeta(currentModel);
      if (currentMeta.imageOnly && state.arenaMode !== 'single') {
        const fallback = getFallbackModelId(currentModel);
        setModel(fallback);
      }
      topArenaModeSelector?.classList.remove('open');
      if (state.arenaMode === 'single') {
        showToast('已切换到单模型聊天');
      } else if (state.arenaMode === 'anonymous') {
        showToast('已切换到匿名双模型对战');
      } else if (state.arenaMode === 'side_by_side') {
        showToast('已切换到双模型对话');
      }
    }

    function getLeaderboardRowMeta(row = {}) {
      const bestLineModelId = row.best_line_model_id || row.source_model_id || row.model_id || 'unknown';
      const canonicalModelId = row.model_id || row.canonical_id || row.canonical_model_id || bestLineModelId;
      const bestLineMeta = getModelMeta(bestLineModelId);
      const canonicalMeta = getModelMeta(canonicalModelId);
      const displayName = row.display_name || canonicalMeta.displayName || bestLineMeta.displayName || canonicalModelId;
      const brand = row.brand || canonicalMeta.brand || bestLineMeta.brand || getModelBrandName(bestLineModelId);
      const lineLabel = row.line_label || bestLineMeta.lineLabel || '';
      return {
        displayName,
        brand,
        lineLabel,
        bestLineModelId,
        canonicalModelId,
      };
    }

    async function loadSidebarLeaderboard() {
      const list = document.getElementById('sidebarLeaderboardList');
      if (!list) return;
      list.innerHTML = '<span style="color:var(--text-dim);font-size:12px;">加载排行榜中…</span>';
      try {
        const response = await proxyFetchWithTimeout(EDGE_FUNCTION_URL, {
          method: 'POST',
          headers: await proxyHeaders(),
          body: JSON.stringify({ endpoint: 'arena_leaderboard' })
        }, FETCH_TIMEOUT_MS, '排行榜');
        const result = await response.json().catch(() => ({}));
        const rows = Array.isArray(result.data) ? result.data.slice(0, 12) : [];
        if (!rows.length) {
          list.innerHTML = '<span style="color:var(--text-dim);font-size:12px;">暂无排行榜数据。</span>';
          return;
        }
        const headerHtml = `<div class="sidebar-leaderboard-title">🏆 Chat 排行榜</div>
          <div class="sidebar-leaderboard-header sidebar-leaderboard-arena-head"><span>Rank</span><span>Rank Spread</span><span>Model</span><span>Score</span></div>`;
        const rowsHtml = rows.map((row, index) => {
          const meta = getLeaderboardRowMeta(row);
          const name = escapeHtml(meta.displayName);
          const brand = escapeHtml(meta.brand);
          const lineLabel = escapeHtml(meta.lineLabel || '线路一');
          const total = Number(row.total_votes || 0);
          const winRate = Number(row.win_rate || 0);
          const elo = Math.round(Number(row.elo_score || 1000));
          const spreadLow = Number(row.rank_spread_low || row.rank_min || index + 1);
          const spreadHigh = Number(row.rank_spread_high || row.rank_max || Math.min(rows.length, index + 3));
          const delta = Math.max(1, Math.round(Number(row.elo_delta || row.uncertainty || row.confidence || 20)));
          const rankClass = index < 3 ? ' top' : '';
          return `<div class="sidebar-leaderboard-row sidebar-leaderboard-arena-row"><span class="rank${rankClass}">${index + 1}</span><span class="sidebar-leaderboard-spread">${spreadLow} ↔ ${spreadHigh}</span><span class="sidebar-leaderboard-model"><strong>${name}</strong><small>${brand} · 最高线路：${lineLabel} · 有效票 ${total.toLocaleString()} · 胜率 ${winRate}%</small></span><span class="sidebar-leaderboard-score">${elo}<small>±${delta}</small></span></div>`;
        }).join('');
        list.innerHTML = headerHtml + rowsHtml;
      } catch (error) {
        list.innerHTML = '<span style="color:var(--text-dim);font-size:12px;">排行榜加载失败。</span>';
      }
    }

    function renderMainLeaderboardRows(rows) {
      const header = `
        <div class="leaderboard-table-head">
          <span>排名</span>
          <span>排名区间</span>
          <span>模型 / 有效票</span>
          <span>Elo</span>
        </div>`;
      const body = rows.map((row, index) => {
        const meta = getLeaderboardRowMeta(row);
        const name = escapeHtml(meta.displayName);
        const brand = escapeHtml(meta.brand);
        const lineLabel = escapeHtml(meta.lineLabel || '线路一');
        const elo = Math.round(Number(row.elo_score || 1000));
        const total = Number(row.total_votes || 0);
        const winRate = Number(row.win_rate || 0);
        const spreadLow = Number(row.rank_spread_low || row.rank_min || index + 1);
        const spreadHigh = Number(row.rank_spread_high || row.rank_max || Math.min(rows.length, index + 3));
        const delta = Math.max(1, Math.round(Number(row.elo_delta || row.uncertainty || row.confidence || 20)));
        const updatedAt = formatLeaderboardUpdatedAt(row.updated_at);
        return `
          <div class="leaderboard-table-row">
            <span class="leaderboard-rank">${index + 1}</span>
            <span class="leaderboard-spread">${spreadLow} ↔ ${spreadHigh}</span>
            <span class="leaderboard-model-cell">
              <strong>${name}</strong>
              <small>${brand} · 最高线路：${lineLabel} · 有效票 ${total.toLocaleString()} · 胜率 ${winRate}%</small>
            </span>
            <span class="leaderboard-score"><strong>${elo}</strong><small><span class="leaderboard-delta">±${delta}</span><span class="leaderboard-updated"> · ${updatedAt}</span></small></span>
          </div>`;
      }).join('');
      return header + body;
    }

    function formatLeaderboardUpdatedAt(value) {
      const date = new Date(value || '');
      if (!Number.isFinite(date.getTime())) return '更新时间未知';
      return new Intl.DateTimeFormat('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      }).format(date);
    }

    function computeParetoFrontier(points) {
      const sorted = points.filter(p => p.votes > 0 && p.elo > 0).sort((a, b) => a.votes - b.votes);
      const frontier = [];
      let maxElo = -Infinity;
      for (const p of sorted) {
        if (p.elo > maxElo) {
          frontier.push(p);
          maxElo = p.elo;
        }
      }
      return frontier;
    }

    function renderParetoChart(rows) {
      const container = document.createElement('div');
      container.className = 'pareto-chart-container';

      const data = rows.map(row => {
        const meta = getLeaderboardRowMeta(row);
        return {
          id: meta.canonicalModelId,
          name: meta.displayName,
          brand: meta.brand,
          elo: Number(row.elo_score || 1000),
          votes: Math.max(1, Number(row.total_votes || 0)),
        };
      }).filter(d => d.votes > 0 && d.elo > 0);

      if (!data.length) return '<div class="pareto-empty">暂无数据</div>';

      const frontier = computeParetoFrontier(data);
      const minVotes = Math.min(...data.map(d => d.votes));
      const maxVotes = Math.max(...data.map(d => d.votes));
      const minElo = Math.min(...data.map(d => d.elo));
      const maxElo = Math.max(...data.map(d => d.elo));
      const voteRange = maxVotes - minVotes || 1;
      const eloRange = maxElo - minElo || 1;

      const width = 960;
      const height = 480;
      const padding = { top: 24, right: 36, bottom: 56, left: 68 };
      const chartW = width - padding.left - padding.right;
      const chartH = height - padding.top - padding.bottom;

      const toX = (votes) => padding.left + ((votes - minVotes) / voteRange) * chartW;
      const toY = (elo) => padding.top + chartH - ((elo - minElo) / eloRange) * chartH;

      let frontierPath = '';
      if (frontier.length > 1) {
        frontierPath = frontier.map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(p.votes)},${toY(p.elo)}`).join(' ');
      }

      const gridLinesX = [0, 0.25, 0.5, 0.75, 1].map(r => {
        const x = padding.left + r * chartW;
        return `<line x1="${x}" y1="${padding.top}" x2="${x}" y2="${padding.top + chartH}" stroke="var(--border)" stroke-dasharray="2,2" opacity="0.3"/>`;
      }).join('');

      const gridLinesY = [0, 0.25, 0.5, 0.75, 1].map(r => {
        const y = padding.top + r * chartH;
        return `<line x1="${padding.left}" y1="${y}" x2="${padding.left + chartW}" y2="${y}" stroke="var(--border)" stroke-dasharray="2,2" opacity="0.3"/>`;
      }).join('');

      const voteLabels = [0, 0.2, 0.4, 0.6, 0.8, 1].map(r => {
        const votes = minVotes + r * voteRange;
        const x = padding.left + r * chartW;
        return `<text x="${x}" y="${height - 15}" text-anchor="middle" fill="var(--text-secondary)" font-size="11">${Math.round(votes)}</text>`;
      }).join('');

      const eloLabels = [0, 0.25, 0.5, 0.75, 1].map(r => {
        const elo = minElo + (1 - r) * eloRange;
        const y = padding.top + r * chartH;
        return `<text x="${padding.left - 10}" y="${y + 4}" text-anchor="end" fill="var(--text-secondary)" font-size="11">${Math.round(elo)}</text>`;
      }).join('');

      const brandColors = {
        'openai': '#10a37f',
        'anthropic': '#d97757',
        'google': '#4285f4',
        'deepseek': '#4f46e5',
        'qwen': '#8b5cf6',
        'moonshot': '#f59e0b',
        'zhipu': '#06b6d4',
        'grok': '#ef4444',
        'minimax': '#10b981',
        'nvidia': '#76b900',
        'default': '#6b7280'
      };

      const getBrandColor = (brand) => {
        const key = Object.keys(brandColors).find(k => brand.toLowerCase().includes(k));
        return key ? brandColors[key] : brandColors.default;
      };

      const points = data.map(d => {
        const x = toX(d.votes);
        const y = toY(d.elo);
        const color = getBrandColor(d.brand);
        const r = Math.max(4, Math.min(10, Math.sqrt(d.votes) / 2));
        return `<circle cx="${x}" cy="${y}" r="${r}" fill="${color}" opacity="0.8" class="pareto-point" data-model="${escapeHtml(d.name)}" data-brand="${escapeHtml(d.brand)}" data-elo="${d.elo}" data-votes="${d.votes}"/>`;
      }).join('');

      const frontierSvg = frontierPath ? `<path d="${frontierPath}" fill="none" stroke="#10a37f" stroke-width="2" opacity="0.9"/>` : '';

      container.innerHTML = `
        <div class="pareto-chart-wrapper">
          <svg viewBox="0 0 ${width} ${height}" class="pareto-svg">
            ${gridLinesX}
            ${gridLinesY}
            <line x1="${padding.left}" y1="${padding.top + chartH}" x2="${padding.left + chartW}" y2="${padding.top + chartH}" stroke="var(--border)" stroke-width="1"/>
            <line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${padding.top + chartH}" stroke="var(--border)" stroke-width="1"/>
            ${frontierSvg}
            ${points}
            ${voteLabels}
            ${eloLabels}
            <text x="${width / 2}" y="${height - 2}" text-anchor="middle" fill="var(--text-secondary)" font-size="12">有效票数</text>
            <text x="15" y="${height / 2}" text-anchor="middle" fill="var(--text-secondary)" font-size="12" transform="rotate(-90, 15, ${height / 2})">Elo 分数</text>
          </svg>
          <div class="pareto-legend">
            <div class="pareto-legend-title">Pareto 前沿</div>
            <div class="pareto-legend-item">
              <span class="pareto-legend-line" style="background:#10a37f"></span>
              <span>性价比最优</span>
            </div>
            <div class="pareto-legend-title" style="margin-top:12px">模型品牌</div>
            ${Object.entries(brandColors).filter(([k]) => k !== 'default').map(([brand, color]) => {
              const name = {openai:'OpenAI',anthropic:'Anthropic',google:'Google',deepseek:'DeepSeek',qwen:'Qwen',moonshot:'Moonshot',zhipu:'Zhipu',grok:'Grok',minimax:'MiniMax',nvidia:'NVIDIA'}[brand];
              return `<div class="pareto-legend-item"><span class="pareto-legend-dot" style="background:${color}"></span><span>${name}</span></div>`;
            }).join('')}
          </div>
        </div>
        <div class="pareto-tooltip" id="paretoTooltip"></div>
      `;

      requestAnimationFrame(() => {
        const tooltip = container.querySelector('#paretoTooltip');
        container.querySelectorAll('.pareto-point').forEach(point => {
          point.addEventListener('mouseenter', (e) => {
            const model = e.target.dataset.model;
            const brand = e.target.dataset.brand;
            const elo = e.target.dataset.elo;
            const votes = e.target.dataset.votes;
            tooltip.innerHTML = `<strong>${model}</strong><br/><small>${brand}</small><br/>Elo: ${Math.round(elo)} · 有效票 ${Number(votes).toLocaleString()}`;
            tooltip.style.opacity = '1';
          });
          point.addEventListener('mousemove', (e) => {
            const rect = container.getBoundingClientRect();
            tooltip.style.left = (e.clientX - rect.left + 10) + 'px';
            tooltip.style.top = (e.clientY - rect.top - 30) + 'px';
          });
          point.addEventListener('mouseleave', () => {
            tooltip.style.opacity = '0';
          });
        });
      });

      return container;
    }

    let currentLeaderboardData = [];
    let currentLeaderboardView = 'ranking';

    function switchLeaderboardView(view) {
      currentLeaderboardView = view;
      const list = document.getElementById('mainLeaderboardList');
      const buttons = document.querySelectorAll('.leaderboard-segment button');
      buttons.forEach((btn, i) => btn.classList.toggle('active', i === (view === 'ranking' ? 0 : 1)));

      if (!list || !currentLeaderboardData.length) return;

      if (view === 'pareto') {
        const chart = renderParetoChart(currentLeaderboardData);
        list.innerHTML = '';
        list.appendChild(chart);
        list.classList.add('pareto-mode');
      } else {
        list.innerHTML = renderMainLeaderboardRows(currentLeaderboardData);
        list.classList.remove('pareto-mode');
      }
    }

    async function loadMainLeaderboard() {
      const list = document.getElementById('mainLeaderboardList');
      if (!list) return;
      list.textContent = '排行榜加载中…';
      try {
        const response = await proxyFetchWithTimeout(EDGE_FUNCTION_URL, {
          method: 'POST',
          headers: await proxyHeaders(),
          body: JSON.stringify({ endpoint: 'arena_leaderboard' })
        }, FETCH_TIMEOUT_MS, '排行榜');
        const result = await response.json().catch(() => ({}));
        const rows = Array.isArray(result.data) ? result.data.slice(0, 50) : [];
        if (!rows.length) {
          list.textContent = '暂无排行榜数据。';
          return;
        }
        currentLeaderboardData = rows;
        const totalVotes = rows.reduce((sum, row) => sum + Number(row.total_votes || 0), 0);
        const latestUpdatedAt = rows
          .map(row => new Date(row.updated_at || '').getTime())
          .filter(value => Number.isFinite(value))
          .sort((a, b) => b - a)[0];
        const voteCount = document.getElementById('mainLeaderboardVoteCount');
        const modelCount = document.getElementById('mainLeaderboardModelCount');
        const updatedAt = document.getElementById('mainLeaderboardUpdatedAt');
        if (voteCount) voteCount.textContent = `${totalVotes.toLocaleString()} 有效票`;
        if (modelCount) modelCount.textContent = `${rows.length} 个模型`;
        if (updatedAt) updatedAt.textContent = latestUpdatedAt ? `最近更新 ${formatLeaderboardUpdatedAt(latestUpdatedAt)}` : '最近更新未知';
        switchLeaderboardView(currentLeaderboardView);
      } catch (error) {
        list.textContent = '排行榜加载失败。';
      }
    }

    async function arenaMainApi(endpoint, payload = {}, timeoutMs = FETCH_TIMEOUT_MS) {
      const response = await proxyFetchWithTimeout(EDGE_FUNCTION_URL, {
        method: 'POST',
        headers: await proxyHeaders(),
        body: JSON.stringify({ endpoint, ...payload })
      }, timeoutMs, '\u5bf9\u6218\u8bf7\u6c42');
      const text = await response.text().catch(() => '');
      let data = {};
      try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
      if (!response.ok) {
        const parsed = parseBackendErrorPayload(text);
        throw new Error(parsed.message || data.message || data.error || '\u5bf9\u6218\u8bf7\u6c42\u5931\u8d25');
      }
      return data;
    }
    function parseArenaMainStreamDelta(parsed) {
      const delta = parsed?.choices?.[0]?.delta || {};
      const message = parsed?.choices?.[0]?.message || {};
      const reasoning = String(delta.reasoning_content || '');
      const content = String(delta.content || message.content || '');
      const toolCalls = Array.isArray(delta.tool_calls) && delta.tool_calls.length ? delta.tool_calls : null;
      return { reasoning, content, toolCalls };
    }
    async function streamMainArenaSlot(matchId, slot, prompt, duelMessageId, turnId = '', { modelId = '', anonymous = false } = {}) {
      let reasoningText = '';
      let answerText = '';
      let doneReasoning = false;
      const toolCalls = [];
      const requestOptions = getModelRequestOptions(modelId);
      const messages = [];
      // 添加完整历史对话上下文（128K上下文兜底）
      const MAX_ARENA_CONTEXT_TOKENS = 120 * 1024; // 留8K给回答
      let estimatedTokens = 0;
      const contextMessages = [];
      // 从后往前累积历史，直到接近上限
      for (let i = conversationHistory.length - 1; i >= 0; i--) {
        const msg = conversationHistory[i];
        const msgTokens = estimateMessageTokens(msg);
        if (estimatedTokens + msgTokens > MAX_ARENA_CONTEXT_TOKENS) break;
        contextMessages.unshift(toApiMessage(msg, modelId));
        estimatedTokens += msgTokens;
      }
      messages.push(...contextMessages);
      // 添加当前用户消息
      const userMsg = { role: 'user', content: prompt };
      if (estimatedTokens + estimateMessageTokens(userMsg) > CONTEXT_TOKEN_LIMIT) {
        updateDuelMessage(duelMessageId, slot, {
          answer: '**上下文已满**\n\n当前对话已超过128K上下文限制，请导出聊天记录后开启新对话继续。',
          thinking: false
        });
        return '';
      }
      messages.push(userMsg);
      const response = await proxyFetchWithTimeout(EDGE_FUNCTION_URL, {
        method: 'POST',
        headers: await proxyHeaders(),
        body: JSON.stringify({
          endpoint: 'arena_slot_chat',
          id: matchId,
          slot,
          messages,
          stream: true,
          temperature: 0.6,
          client_turn_id: turnId || createChatTurnId(),
          request_kind: 'arena_model_answer',
          arena_match_id: matchId,
          arena_slot: slot,
          arena_mode: anonymous ? 'anonymous' : 'side_by_side',
          ...requestOptions
        })
      }, CHAT_TURN_TIMEOUT_MS, `\u6a21\u578b ${slot.toUpperCase()} \u8bf7\u6c42`);
      const errorText = response.ok ? '' : await response.text().catch(() => '');
      if (!response.ok) {
        const parsed = parseBackendErrorPayload(errorText);
        throw new Error(parsed.message || errorText || `\u6a21\u578b ${slot.toUpperCase()} \u8bf7\u6c42\u5931\u8d25`);
      }
      if (!response.body) throw new Error(`\u6a21\u578b ${slot.toUpperCase()} \u6ca1\u6709\u8fd4\u56de\u6570\u636e\u6d41`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (!payload || payload === '[DONE]') continue;
          try {
            const chunk = parseArenaMainStreamDelta(JSON.parse(payload));
            if (chunk.reasoning) {
              reasoningText += chunk.reasoning;
              updateDuelMessage(duelMessageId, slot, { reasoning: reasoningText, answer: answerText, thinking: true });
            }
            if (chunk.content) {
              if (!doneReasoning) doneReasoning = true;
              answerText += chunk.content;
              updateDuelMessage(duelMessageId, slot, { reasoning: reasoningText, answer: answerText, thinking: true });
            }
            if (chunk.toolCalls) {
              mergeToolCallDeltas(toolCalls, chunk.toolCalls);
              updateDuelMessage(duelMessageId, slot, { reasoning: reasoningText, answer: answerText, thinking: true, toolCalls });
            }
          } catch { void 0; }
        }
      }
      updateDuelMessage(duelMessageId, slot, {
        reasoning: reasoningText,
        answer: answerText || '\u8fd9\u4e2a\u6a21\u578b\u6ca1\u6709\u8fd4\u56de\u6709\u6548\u5185\u5bb9\u3002',
        thinking: false,
        toolCalls: toolCalls.length ? toolCalls : undefined
      });
      return answerText;
    }
    function getArenaSlotTurnId(match, slot) {
      const slots = Array.isArray(match?.slots) ? match.slots : [];
      const found = slots.find(item => item && item.slot === slot);
      return String(found?.turn_id || found?.client_turn_id || '');
    }
    async function sendArenaDuelMessage(prompt, { anonymous = false } = {}) {
      const selectedA = currentModel;
      const selectedB = compareModel === currentModel
        ? getFallbackModelId(currentModel)
        : compareModel;
      const createPayload = anonymous
        ? { prompt, mode: 'anonymous' }
        : { prompt, mode: 'side_by_side', model_a: selectedA, model_b: selectedB };
      const result = await arenaMainApi('arena_create_match', createPayload);
      const match = result.data;
      const modelA = anonymous ? '' : selectedA;
      const modelB = anonymous ? '' : selectedB;
      const duelMessageId = createDuelAssistantMessage({ anonymous, modelA, modelB });
      const duelTurnId = `compare_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      const slotTurnA = getArenaSlotTurnId(match, 'a') || duelTurnId;
      const slotTurnB = getArenaSlotTurnId(match, 'b') || duelTurnId;
      const [a, b] = await Promise.allSettled([
        streamMainArenaSlot(match.id, 'a', prompt, duelMessageId, slotTurnA, { modelId: modelA, anonymous }),
        streamMainArenaSlot(match.id, 'b', prompt, duelMessageId, slotTurnB, { modelId: modelB, anonymous })
      ]);
      if (a.status === 'rejected') updateDuelMessage(duelMessageId, 'a', `\u8bf7\u6c42\u5931\u8d25\uff1a${a.reason?.message || a.reason}`, { loading: false });
      if (b.status === 'rejected') updateDuelMessage(duelMessageId, 'b', `\u8bf7\u6c42\u5931\u8d25\uff1a${b.reason?.message || b.reason}`, { loading: false });
      attachDuelVoteRow(duelMessageId, match.id, {
        anonymous,
        answerA: a.status === 'fulfilled' ? a.value : '',
        answerB: b.status === 'fulfilled' ? b.value : '',
      });
      return { answerA: a.status === 'fulfilled' ? a.value : '', answerB: b.status === 'fulfilled' ? b.value : '' };
    }

    function setDuelSelection(wrapper, winner, { preview = false } = {}) {
      if (!wrapper) return;
      const effectiveWinner = winner || wrapper.dataset.duelSelected || '';
      wrapper.dataset.duelPreview = preview ? effectiveWinner : '';
      wrapper.querySelectorAll('.duel-card').forEach(card => {
        const slot = card.dataset.duelSlot;
        card.classList.toggle('is-good', effectiveWinner === slot || effectiveWinner === 'tie');
        card.classList.toggle('is-bad', effectiveWinner === 'bad');
      });
      wrapper.querySelectorAll('.duel-vote-row button').forEach(button => {
        button.classList.toggle('is-active', button.dataset.winner === effectiveWinner);
      });
    }

    function attachDuelVoteRow(messageId, matchId, { anonymous = false, answerA = '', answerB = '' } = {}) {
      if (!String(answerA || '').trim() || !String(answerB || '').trim()) {
        showToast('A/B 有一侧未返回有效内容，本轮不开放投票。');
        return;
      }
      const wrapper = document.getElementById(messageId);
      const grid = wrapper?.querySelector('.duel-grid');
      if (!wrapper || !grid || wrapper.querySelector('.duel-vote-row')) return;
      const voteRow = document.createElement('div');
      voteRow.className = 'duel-vote-row';
      voteRow.innerHTML = `
        <button data-winner="a">A \u66f4\u597d</button>
        <button data-winner="tie">\u21c4</button>
        <button data-winner="bad">\u2298</button>
        <button data-winner="b">B \u66f4\u597d</button>
      `;
      grid.appendChild(voteRow);
      voteRow.querySelectorAll('button').forEach(button => {
        button.addEventListener('mouseenter', () => setDuelSelection(wrapper, button.dataset.winner, { preview: true }));
        button.addEventListener('mouseleave', () => setDuelSelection(wrapper, wrapper.dataset.duelSelected || ''));
        button.addEventListener('click', async () => {
          wrapper.dataset.duelSelected = button.dataset.winner || '';
          setDuelSelection(wrapper, wrapper.dataset.duelSelected);
          voteRow.querySelectorAll('button').forEach(btn => { btn.disabled = true; });
          try {
            const vote = await arenaMainApi('arena_vote', { id: matchId, winner: button.dataset.winner });
            const reveal = vote?.data?.reveal || {};
            if (anonymous) {
              updateDuelMessage(messageId, 'a', answerA, { modelId: reveal.model_a });
              updateDuelMessage(messageId, 'b', answerB, { modelId: reveal.model_b });
            }
            renderDuelVoteResult(wrapper, vote);
            showToast(vote?.data?.effective === false ? '投票已记录，未计入公开榜。' : (anonymous ? '投票成功，已揭晓并计入公开榜。' : '已记录你的偏好。'));
            loadSidebarLeaderboard();
            loadMainLeaderboard();
          } catch (error) {
            showToast(error?.message || '\u6295\u7968\u5931\u8d25');
            voteRow.querySelectorAll('button').forEach(btn => { btn.disabled = false; });
          }
        });
      });
    }

    function formatSignedEloDelta(before, after) {
      const start = Number(before);
      const end = Number(after);
      if (!Number.isFinite(start) || !Number.isFinite(end)) return '';
      const delta = Math.round((end - start) * 10) / 10;
      const sign = delta > 0 ? '+' : '';
      return `${Math.round(end)} (${sign}${delta})`;
    }

    function renderDuelVoteResult(wrapper, vote) {
      if (!wrapper) return;
      const grid = wrapper.querySelector('.duel-grid');
      if (!grid) return;
      const reveal = vote?.data?.reveal || {};
      const effective = vote?.data?.effective !== false;
      const modelA = formatSignedEloDelta(reveal.model_a_elo_before, reveal.model_a_elo_after);
      const modelB = formatSignedEloDelta(reveal.model_b_elo_before, reveal.model_b_elo_after);
      let note = wrapper.querySelector('.duel-result-note');
      if (!note) {
        note = document.createElement('div');
        note.className = 'duel-result-note';
        grid.appendChild(note);
      }
      const details = [modelA ? `A ${modelA}` : '', modelB ? `B ${modelB}` : ''].filter(Boolean).join(' · ');
      note.innerHTML = `<strong>${effective ? '已计入公开榜' : '未计入公开榜'}</strong><span>${details || '本次偏好已记录。'}</span>`;
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

      const showModelQuota = usesSharedQuota(currentModel);
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

    function updateRateLimitFromHeaders(headers, showModelQuota = usesSharedQuota(currentModel), responseStatus = 200, errorText = '', modelId = currentModel) {
      applyQuotaSnapshotFromHeaders(modelId, headers, {
        responseStatus,
        errorText,
        updateCurrentRateLimitInfo: showModelQuota,
      });
      persistModelTelemetryCache();
    }

    async function refreshRateLimitForCurrentModel(resetModelQuota = false) {
      const refreshToken = ++rateLimitRefreshToken;
      const targetModelId = currentModel;
      const showModelQuota = usesSharedQuota(targetModelId);

      if (!showModelQuota) {
        rateLimitInfo.modelLimit = null;
        rateLimitInfo.modelRemaining = null;
        rateLimitInfo.modelId = null;
        updateRateLimitNote();
      }

      try {
        const probeModel = getRateLimitRequestModelId(targetModelId);
        const probeEndpoint = getModelProbeEndpoint(targetModelId);
        const response = await proxyFetch(EDGE_FUNCTION_URL, {
          method: 'POST',
          headers: await proxyHeaders(),
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
      // 先保护数学公式，避免被 escapeHtml 转义
      let output = text
        .replace(/\$\$\s*([\s\S]*?)\s*\$\$/g, (match, formula) => keep(`$$${escapeHtml(formula.trim())}$$`))
        .replace(/\\\[([\s\S]*?)\\\]/g, (match, formula) => keep(`\\[${escapeHtml(formula)}\\]`))
        .replace(/\\\(([\s\S]*?)\\\)/g, (match, formula) => keep(`\\(${escapeHtml(formula)}\\)`))
        .replace(/\$\s*([^\$]+?)\s*\$/g, (match, formula) => keep(`$${escapeHtml(formula.trim())}$`))
        .replace(/`([^`]+)`/g, (match, code) => keep(`<code>${escapeHtml(code)}</code>`))
        .replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (match, label, url) => {
          const href = safeUrl(url);
          if (href === '#') return label;
          return keep(`<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`);
        })
        .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (match, alt, url) => {
          const href = safeUrl(url);
          if (href === '#') return alt;
          const escHref = escapeHtml(href);
          const escAlt = escapeHtml(alt);
          return keep(`<span style="display:inline-block;position:relative;max-width:100%"><img src="${escHref}" alt="${escAlt}" style="max-width:100%;border-radius:8px;display:block" oncontextmenu="return false"><button onclick="(async()=>{try{const r=await fetch('${escHref}');const b=await r.blob();const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='cancri-image-'+Date.now()+'.png';document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(a.href)}catch(e){}})()" style="position:absolute;bottom:8px;right:8px;width:30px;height:30px;border-radius:8px;border:none;background:rgba(0,0,0,.45);backdrop-filter:blur(8px);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center" title="下载图片"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></button></span>`);
        });
      // 转义剩余的 HTML
      output = escapeHtml(output)
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
      let mathLines = [];
      let inMath = false;

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

      function flushMath() {
        if (!mathLines.length) return;
        blocks.push(`<p>\\[${escapeHtml(mathLines.join('\n'))}\\]</p>`);
        mathLines = [];
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
            flushMath();
            inCode = true;
          }
          continue;
        }

        if (inCode) {
          codeLines.push(line);
          continue;
        }

        // 处理 \[...\] 数学公式块
        if (line.trim() === '\\[' && !inMath) {
          flushParagraph();
          flushList();
          inMath = true;
          continue;
        }
        if (line.trim() === '\\]' && inMath) {
          flushMath();
          inMath = false;
          continue;
        }
        if (inMath) {
          mathLines.push(line);
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
      flushMath();

      return blocks.join('');
    }

    function renderMathInElement(element) {
      if (typeof window === 'undefined' || !element) return;

      // 所有 CDN 都失败了，直接降级
      if (window.__KATEX_FAILED__) {
        fallbackMathRender(element);
        return;
      }

      // 使用 __katexRender 保存的 KaTeX 原版函数，避免和自身同名递归
      const katexRender = window.__katexRender;
      let retryCount = 0;
      const maxRetries = 30;

      const tryRender = () => {
        if (katexRender) {
          try {
            katexRender(element, {
              delimiters: [
                { left: '$$', right: '$$', display: true },
                { left: '\\[', right: '\\]', display: true },
                { left: '\\(', right: '\\)', display: false },
                { left: '$', right: '$', display: false }
              ],
              throwOnError: false,
              trust: false,
              strict: false
            });
          } catch (e) {
            console.warn('KaTeX render error:', e);
          }
        } else if (window.__katexRender) {
          // 重试期间检测是否已加载
          window.__katexRender(element, {
            delimiters: [
              { left: '$$', right: '$$', display: true },
              { left: '\\[', right: '\\]', display: true },
              { left: '\\(', right: '\\)', display: false },
              { left: '$', right: '$', display: false }
            ],
            throwOnError: false,
            trust: false,
            strict: false
          });
        } else if (retryCount < maxRetries) {
          retryCount++;
          setTimeout(tryRender, 100);
        } else {
          console.warn('KaTeX not available, applying fallback');
          fallbackMathRender(element);
        }
      };

      tryRender();
    }

    // KaTeX 加载失败时的降级渲染：去掉 $ 定界符，保留公式内容
    function fallbackMathRender(element) {
      // 直接操作 innerHTML，替换所有数学定界符
      let html = element.innerHTML;
      // 处理 $$...$$（display math）— 用 blockquote 样式突出显示
      html = html.replace(/\$\$([\s\S]*?)\$\$/g, function(_, formula) {
        return '<div style="text-align:center;margin:8px 0;font-style:italic;color:var(--text);">' + escapeHtml(formula.trim()) + '</div>';
      });
      // 处理 $...$（inline math）— 用斜体显示
      html = html.replace(/\$([^\$]+?)\$/g, function(_, formula) {
        return '<em style="color:var(--text);">' + escapeHtml(formula.trim()) + '</em>';
      });
      // 处理 \[...\]（display math）
      html = html.replace(/\\\[([\s\S]*?)\\\]/g, function(_, formula) {
        return '<div style="text-align:center;margin:8px 0;font-style:italic;color:var(--text);">' + escapeHtml(formula.trim()) + '</div>';
      });
      // 处理 \(...\)（inline math）
      html = html.replace(/\\\(([\s\S]*?)\\\)/g, function(_, formula) {
        return '<em style="color:var(--text);">' + escapeHtml(formula.trim()) + '</em>';
      });
      element.innerHTML = html;
    }

    function renderAnimatedMarkdown(markdown) {
      const html = renderMarkdown(markdown);
      // 使用 setTimeout 确保 KaTeX 已加载
      setTimeout(() => {
        const container = document.querySelector('.message-content');
        if (container) renderMathInElement(container);
      }, 0);
      return html;
    }

    // 在消息更新后调用 KaTeX 渲染
    function renderMathInMessage(messageId) {
      const messageDiv = document.getElementById(messageId);
      if (!messageDiv) return;
      const answerBody = messageDiv.querySelector('.answer-body');
      if (answerBody) renderMathInElement(answerBody);
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
      // 渲染数学公式
      renderMathInElement(blockElement);
      streamState.text = nextText;
      streamState.ready = true;
      streamState.thinking = thinking;
    }

    function getAvailableToolDefinitions() {
      return [...ARTICLE_TOOL_DEFINITIONS, WEB_SEARCH_TOOL_DEFINITION, FETCH_WEB_PAGE_TOOL_DEFINITION];
    }

    function getHomeDisplayName() {
      const nickname = getNickname();
      if (nickname) return nickname;
      const rawName = String(document.querySelector('.account-name')?.textContent || 'Jony').trim();
      const normalized = rawName.replace(/^mr\.?/i, '').trim();
      if (normalized && normalized !== '登录 / 注册') return normalized;
      return 'Jony';
    }

    function getNickname() {
      try { return localStorage.getItem('cancri_nickname') || ''; } catch (e) { return ''; }
    }

    function setNickname(name) {
      try { localStorage.setItem('cancri_nickname', name); } catch (e) {}
      refreshNicknameUI();
      updateHomeHeroText();
    }

    function refreshNicknameUI() {
      const nick = getNickname();
      const display = document.getElementById('nicknameDisplay');
      if (display) display.textContent = nick || '未设置';
      const accountName = document.querySelector('.account-strip .account-name');
      if (accountName && nick) {
        const email = accountName.textContent;
        if (email && email.includes('@')) accountName.textContent = nick;
      }
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

    function scrollChatToBottom(smooth = true) {
      if (!chatMessages) return;
      const threshold = 120;
      const distanceFromBottom = chatMessages.scrollHeight - chatMessages.scrollTop - chatMessages.clientHeight;
      if (distanceFromBottom > threshold) return;
      if (smooth) {
        chatMessages.scrollTo({ top: chatMessages.scrollHeight, behavior: 'smooth' });
      } else {
        chatMessages.scrollTop = chatMessages.scrollHeight;
      }
    }

    function setComposerBusy(isBusy) {
      state.isStreaming = isBusy;
      if (isBusy) {
        sendChatBtn.classList.add('is-streaming');
        sendChatBtn.disabled = false;
        sendChatBtn.setAttribute('aria-label', '停止生成');
      } else {
        sendChatBtn.classList.remove('is-streaming');
        sendChatBtn.disabled = !homeInput.value.trim() && !pendingAttachments.length;
        sendChatBtn.setAttribute('aria-label', '发送消息');
      }
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
      // 处理浏览器原生 "The user aborted a request" 错误
      if (/The user aborted a request|aborted a request/i.test(message)) {
        return '请求超时或被取消。Claude Opus 响应较慢，请稍后重试或切换到其他模型。';
      }
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
      if (imagePromptInput) {
        imagePromptInput.disabled = isBusy;
      }
      if (sendImagePromptBtn) {
        sendImagePromptBtn.disabled = isBusy || !(imagePromptInput && imagePromptInput.value.trim());
        sendImagePromptBtn.setAttribute('aria-disabled', String(sendImagePromptBtn.disabled));
      }
      if (imageGenerationStatus && typeof statusText === 'string') {
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
      image.addEventListener('contextmenu', (e) => e.preventDefault());

      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:absolute;left:0;right:0;bottom:0;padding:10px 12px;z-index:2;display:flex;align-items:center;gap:8px;background:linear-gradient(transparent,rgba(0,0,0,.55))';

      const caption = document.createElement('div');
      caption.style.cssText = 'flex:1;color:#fff;font-size:12px;font-weight:650;text-shadow:0 2px 10px rgba(0,0,0,.32);white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
      caption.textContent = prompt;

      const downloadBtn = document.createElement('button');
      downloadBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
      downloadBtn.title = '下载图片';
      downloadBtn.style.cssText = 'width:32px;height:32px;border-radius:8px;border:none;background:rgba(255,255,255,.18);backdrop-filter:blur(8px);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:background .15s';
      downloadBtn.onmouseenter = () => { downloadBtn.style.background = 'rgba(255,255,255,.35)' };
      downloadBtn.onmouseleave = () => { downloadBtn.style.background = 'rgba(255,255,255,.18)' };
      downloadBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        downloadBtn.disabled = true;
        try {
          const resp = await fetch(imageUrl);
          const blob = await resp.blob();
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `cancri-image-${Date.now()}.png`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(a.href);
        } catch {
          window.open(imageUrl, '_blank');
        } finally {
          downloadBtn.disabled = false;
        }
      });

      overlay.appendChild(caption);
      overlay.appendChild(downloadBtn);
      card.appendChild(image);
      card.appendChild(overlay);
      generatedImageGrid.prepend(card);
    }

    async function generateImageFromPrompt(prompt, imageModel = DEFAULT_IMAGE_MODEL) {
      const value = String(prompt || '').trim();
      if (!value || state.isImageGenerating) return;

      const isOpenAIImage = imageModel === OPENAI_IMAGE_MODEL || imageModel === 'gpt-image-2';
      const imageSize = imageSizeSelect?.value || '1024x1024';

      setImageGenerationBusy(true, isOpenAIImage ? '正在生成图片...' : '正在提交图片生成任务...');
      showToast('图片生成已开始，请稍等。');

      let finalStatusText = '等待输入提示词';

      try {
        const response = await proxyFetch(EDGE_FUNCTION_URL, {
          method: 'POST',
          headers: await proxyHeaders(),
          body: JSON.stringify({
            endpoint: 'image',
            model: imageModel,
            prompt: value,
            n: 1,
            size: imageSize,
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
            detail = parsed.code === 'challenge_required' || parsed.code === 'access_blocked' || parsed.code === 'anonymous_not_allowed'
              ? formatSecurityGuardMessage(parsed)
              : parsed.message || detail;
          }
          throw new Error(detail || `HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        // OpenAI-compatible API returns images directly
        if (isOpenAIImage) {
          const imageUrl = data?.data?.[0]?.url || (data?.data?.[0]?.b64_json ? `data:image/png;base64,${data.data[0].b64_json}` : '');
          if (!imageUrl) {
            const revised = data?.data?.[0]?.revised_prompt;
            const detail = data?.error?.message || data?.message
              || (revised ? `提示词可能被过滤（修正后：${String(revised).slice(0, 60)}）` : '')
              || '图片生成失败，未返回图片数据。';
            throw new Error(detail);
          }
          appendGeneratedImageCard(imageUrl, value);
          if (imagePromptInput) imagePromptInput.value = '';
          if (imageGenerationStatus) imageGenerationStatus.textContent = '图片已生成。';
          finalStatusText = '图片已生成。';
          showToast('图片已生成。');
          return imageUrl;
        }

        // Async task-based image flow
        const taskId = data.task_id;
        if (!taskId) {
          throw new Error('未返回 task_id。');
        }

        setImageGenerationBusy(true, '任务已提交，正在生成图片...');

        while (true) {
          const resultResponse = await proxyFetch(EDGE_FUNCTION_URL, {
            method: 'POST',
            headers: await proxyHeaders(),
            body: JSON.stringify({
              endpoint: 'task',
              model: imageModel,
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
            const detail = parsed.code === 'challenge_required' || parsed.code === 'access_blocked' || parsed.code === 'anonymous_not_allowed'
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
            if (imagePromptInput) imagePromptInput.value = '';
            if (imageGenerationStatus) imageGenerationStatus.textContent = '图片已生成。';
            finalStatusText = '图片已生成。';
            showToast('图片已生成。');
            return imageUrl;
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
          throw error;
        } else if (error.name !== 'AbortError') {
          imageGenerationStatus.textContent = `生成失败：${error.message}`;
          finalStatusText = `生成失败：${error.message}`;
          showToast(`图片生成失败：${error.message}`);
          throw error;
        }
      } finally {
        setImageGenerationBusy(false, finalStatusText);
      }
      return '';
    }

    async function sendImageGenerationMessage(query, modelId, metadata) {
      createUserMessage(query, []);
      homeInput.value = '';

      const assistantMessageId = createAssistantMessage(metadata);
      updateAssistantMessage(assistantMessageId, { answer: '正在生成图片...', thinking: true });

      setComposerBusy(true);

      try {
        const imageUrl = await generateImageFromPrompt(query, modelId);
        if (imageUrl) {
          updateAssistantMessage(assistantMessageId, { answer: '', thinking: false });
          const messageDiv = document.getElementById(assistantMessageId);
          const answerBody = messageDiv?.querySelector('.answer-body');
          if (answerBody) {
            const wrapper = document.createElement('span');
            wrapper.style.cssText = 'display:inline-block;position:relative;max-width:360px';
            const img = document.createElement('img');
            img.src = imageUrl;
            img.alt = 'generated image';
            img.style.cssText = 'max-width:100%;border-radius:10px;display:block';
            img.addEventListener('contextmenu', (e) => e.preventDefault());
            const dlBtn = document.createElement('button');
            dlBtn.title = '下载图片';
            dlBtn.style.cssText = 'position:absolute;bottom:8px;right:8px;width:30px;height:30px;border-radius:8px;border:none;background:rgba(0,0,0,.45);backdrop-filter:blur(8px);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center';
            dlBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
            dlBtn.addEventListener('click', async (e) => {
              e.stopPropagation();
              dlBtn.disabled = true;
              try {
                const resp = await fetch(imageUrl);
                const blob = await resp.blob();
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `cancri-image-${Date.now()}.png`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(a.href);
              } catch {
                window.open(imageUrl, '_blank');
              } finally {
                dlBtn.disabled = false;
              }
            });
            wrapper.appendChild(img);
            wrapper.appendChild(dlBtn);
            answerBody.appendChild(wrapper);
          }
          pushHistory('user', query);
          pushHistory(assistantHistoryMessage(`![generated image](${imageUrl})`, metadata));
          await finalizeConversationTurn();
        } else {
          updateAssistantMessage(assistantMessageId, { answer: '图片生成失败，未返回图片地址。', thinking: false });
          pushHistory('user', query);
          pushHistory(assistantHistoryMessage('图片生成失败，未返回图片地址。', metadata));
        }
      } catch (error) {
        const message = normalizeErrorMessage(error, '图片生成失败，请稍后重试。');
        updateAssistantMessage(assistantMessageId, { answer: `图片生成失败：${message}`, thinking: false });
        pushHistory('user', query);
        pushHistory(assistantHistoryMessage(`图片生成失败：${message}`, metadata));
      } finally {
        setComposerBusy(false);
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

    function normalizeAssistantMetadata(metadata) {
      if (metadata === null) {
        return {
          modelId: 'unknown',
          modelName: '未知模型',
          iconPath: './openai.svg'
        };
      }
      const base = metadata?.modelId ? metadata : createModelMetadata(currentModel);
      return {
        modelId: base.modelId || 'unknown',
        modelName: base.modelName || getModelDisplayName(base.modelId) || '未知模型',
        iconPath: base.iconPath || getModelIconPath(base.modelId)
      };
    }

    function sanitizeHistoryMessage(message) {
      if (!message || typeof message !== 'object') {
        return { role: 'assistant', content: '' };
      }
      const sanitized = { ...message };
      if (sanitized.role === 'assistant') {
        sanitized.metadata = normalizeAssistantMetadata(sanitized.metadata || sanitized.modelMetadata || null);
      } else {
        delete sanitized.metadata;
      }
      delete sanitized.modelMetadata;
      delete sanitized.provider;
      return sanitized;
    }

    function createAssistantMessage(metadata = createModelMetadata(currentModel)) {
      const messageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const messageDiv = document.createElement('div');
      messageDiv.className = 'message assistant';
      messageDiv.id = messageId;
      const modelMetadata = normalizeAssistantMetadata(metadata);

      const avatar = document.createElement('div');
      avatar.className = 'message-avatar';
      avatar.textContent = 'A';

      const bubble = document.createElement('div');
      bubble.className = 'message-content md-content';

      const modelBadge = document.createElement('div');
      modelBadge.className = 'assistant-model-badge';

      const modelPulse = document.createElement('span');
      modelPulse.className = 'assistant-model-pulse';
      modelPulse.setAttribute('aria-hidden', 'true');
      modelBadge.appendChild(modelPulse);

      const modelIcon = document.createElement('img');
      modelIcon.className = 'assistant-model-icon';
      modelIcon.src = modelMetadata.iconPath;
      modelIcon.alt = '';
      modelBadge.appendChild(modelIcon);

      const modelName = document.createElement('span');
      modelName.className = 'assistant-model-name';
      modelName.textContent = modelMetadata.modelName;
      modelBadge.appendChild(modelName);

      const thinkBlock = document.createElement('div');
      thinkBlock.className = 'think-block';
      thinkBlock.hidden = true;

      const thinkHeader = document.createElement('button');
      thinkHeader.className = 'think-header';
      thinkHeader.type = 'button';
      thinkHeader.setAttribute('aria-expanded', 'true');
      thinkHeader.innerHTML = `<span class="think-label">Thinking</span><span class="think-caret">⌄</span>`;

      const thinkBody = document.createElement('div');
      thinkBody.className = 'think-body md-content';

      const answerBody = document.createElement('div');
      answerBody.className = 'answer-body md-content';
      answerBody.innerHTML = '';

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

      thinkBlock.appendChild(thinkHeader);
      thinkBlock.appendChild(thinkBody);
      bubble.appendChild(modelBadge);
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

      thinkHeader.addEventListener('click', () => {
        if (thinkBlock.hidden) return;
        const collapsed = !thinkBlock.classList.contains('is-collapsed');
        thinkBlock.classList.toggle('is-collapsed', collapsed);
        thinkHeader.setAttribute('aria-expanded', String(!collapsed));
      });

      messageDiv._parts = {
        thinkBlock,
        thinkHeader,
        thinkBody,
        answerBody,
        toolCallsContainer,
        messageActions,
        modelMetadata,
        thinkStreamState: { text: '', ready: false, startedAt: 0, wasThinking: false, autoCollapsed: false },
        answerStreamState: { text: '', ready: false },
      };
      chatMessages.appendChild(messageDiv);
      scrollChatToBottom(false);

      return messageId;
    }

    function createDuelAssistantMessage({ anonymous = false, modelA = currentModel, modelB = compareModel } = {}) {
      const messageId = `duel-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const wrapper = document.createElement('div');
      wrapper.className = 'message assistant duel-message';
      wrapper.id = messageId;

      const avatar = document.createElement('div');
      avatar.className = 'message-avatar';
      avatar.textContent = 'A';

      const grid = document.createElement('div');
      grid.className = 'duel-grid';

      const makeCard = (slot, modelId) => {
        const card = document.createElement('article');
        card.className = 'duel-card';
        card.dataset.duelSlot = slot;
        const title = anonymous ? `模型 ${slot.toUpperCase()}` : getModelDisplayName(modelId);

        const head = document.createElement('div');
        head.className = 'duel-card-head';
        head.innerHTML = `<span>${escapeHtml(title)}</span><small>${anonymous ? '投票后揭晓' : escapeHtml(modelId)}</small>`;

        const thinkBlock = document.createElement('div');
        thinkBlock.className = 'think-block';
        thinkBlock.hidden = true;

        const thinkHeader = document.createElement('button');
        thinkHeader.className = 'think-header';
        thinkHeader.type = 'button';
        thinkHeader.setAttribute('aria-expanded', 'true');
        thinkHeader.innerHTML = '<span class="think-label">Thinking</span><span class="think-caret">⌄</span>';
        thinkHeader.addEventListener('click', () => {
          if (thinkBlock.hidden) return;
          const collapsed = !thinkBlock.classList.contains('is-collapsed');
          thinkBlock.classList.toggle('is-collapsed', collapsed);
          thinkHeader.setAttribute('aria-expanded', String(!collapsed));
        });

        const thinkBody = document.createElement('div');
        thinkBody.className = 'think-body md-content';
        thinkBlock.appendChild(thinkHeader);
        thinkBlock.appendChild(thinkBody);

        const toolCallsContainer = document.createElement('div');
        toolCallsContainer.className = 'tool-calls-container';

        const answerBody = document.createElement('div');
        answerBody.className = 'duel-answer md-content';
        answerBody.dataset.duelAnswer = slot;
        answerBody.innerHTML = '<span class="typing-indicator">正在生成…</span>';

        card.appendChild(head);
        card.appendChild(thinkBlock);
        card.appendChild(toolCallsContainer);
        card.appendChild(answerBody);

        card._duelParts = {
          thinkBlock,
          thinkHeader,
          thinkBody,
          toolCallsContainer,
          answerBody,
          thinkStreamState: { text: '', ready: false, startedAt: 0, wasThinking: false, autoCollapsed: false },
          answerStreamState: { text: '', ready: false },
        };
        return card;
      };

      grid.appendChild(makeCard('a', modelA));
      grid.appendChild(makeCard('b', modelB));
      const dots = document.createElement('div');
      dots.className = 'duel-carousel-dots';
      dots.innerHTML = '<span class="active"></span><span></span>';
      grid.appendChild(dots);
      wrapper.appendChild(avatar);
      wrapper.appendChild(grid);
      wrapper._duel = { anonymous, modelA, modelB };
      chatMessages.appendChild(wrapper);
      scrollChatToBottom(false);
      return messageId;
    }

    function updateDuelMessage(messageId, slot, textOrData, { loading = false, modelId = '' } = {}) {
      const wrapper = document.getElementById(messageId);
      if (!wrapper) return;
      const card = wrapper.querySelector(`.duel-card[data-duel-slot="${slot}"]`);
      if (!card) return;
      const parts = card._duelParts;

      // Legacy string-based call (backward compat)
      if (typeof textOrData === 'string') {
        const target = parts?.answerBody || wrapper.querySelector(`[data-duel-answer="${slot}"]`);
        if (!target) return;
        const value = textOrData.trim();
        target.innerHTML = value ? renderMarkdown(value) : `<span class="typing-indicator">${loading ? '正在生成…' : '暂无内容'}</span>`;
        renderMathInElement(target);
        if (modelId && wrapper._duel?.anonymous) {
          const head = card.querySelector('.duel-card-head');
          if (head) head.innerHTML = `<span>${escapeHtml(getModelDisplayName(modelId))}</span><small>${escapeHtml(modelId)}</small>`;
        }
        return;
      }

      // Structured data: { reasoning, answer, thinking, toolCalls }
      const { reasoning = '', answer = '', thinking = false, toolCalls } = textOrData;
      const reasoningText = String(reasoning || '').trim();
      const answerText = String(answer || '').trim();
      const hasReasoning = Boolean(reasoningText);
      const hasAnswer = Boolean(answerText);

      if (parts) {
        const { thinkBlock, thinkHeader, thinkBody, answerBody, toolCallsContainer, thinkStreamState, answerStreamState } = parts;

        // Think block
        thinkBlock.hidden = !hasReasoning && !thinking;
        if (thinking && !thinkStreamState.wasThinking) {
          thinkStreamState.startedAt = Date.now();
          thinkStreamState.autoCollapsed = false;
          thinkBlock.classList.remove('is-collapsed');
          if (thinkHeader) thinkHeader.setAttribute('aria-expanded', 'true');
        }
        if (hasReasoning) {
          syncStreamingMarkdownBlock(thinkBody, thinkStreamState, reasoningText, { thinking });
        } else if (!thinking) {
          thinkBody.innerHTML = '';
          thinkStreamState.text = '';
          thinkStreamState.ready = false;
        }
        if (thinking) thinkBlock.classList.add('is-thinking');
        else thinkBlock.classList.remove('is-thinking');
        if (thinkHeader) {
          const label = thinkHeader.querySelector('.think-label');
          const seconds = thinkStreamState.startedAt
            ? Math.max(1, Math.round((Date.now() - thinkStreamState.startedAt) / 1000))
            : 1;
          if (label) label.textContent = thinking ? 'Thinking' : `Thought for ${seconds}s`;
        }
        if (!thinking && hasReasoning && thinkStreamState.wasThinking && !thinkStreamState.autoCollapsed) {
          thinkBlock.classList.add('is-collapsed');
          if (thinkHeader) thinkHeader.setAttribute('aria-expanded', 'false');
          thinkStreamState.autoCollapsed = true;
        }
        thinkStreamState.wasThinking = Boolean(thinking);

        // Answer body
        if (hasAnswer) {
          syncStreamingMarkdownBlock(answerBody, answerStreamState, answerText, { thinking, placeholder: '正在思考中…' });
        } else if (thinking) {
          answerBody.innerHTML = '';
          answerStreamState.text = '';
          answerStreamState.ready = false;
        } else if (!hasReasoning) {
          answerBody.innerHTML = '<span class="typing-indicator">暂无内容</span>';
        }

        // Tool calls display (badge only, no execution in Arena)
        if (Array.isArray(toolCalls) && toolCalls.length) {
          const existing = toolCallsContainer.querySelectorAll('.tool-call-block');
          const existingIds = new Set([...existing].map(el => el.dataset.toolCallId));
          for (const tc of toolCalls) {
            const tcId = tc.id || `call_${tc.name}`;
            if (existingIds.has(tcId)) continue;
            const block = document.createElement('div');
            block.className = 'tool-call-block';
            block.dataset.toolCallId = tcId;
            const header = document.createElement('div');
            header.className = 'tool-call-header';
            const nameSpan = document.createElement('span');
            nameSpan.className = 'tool-call-name';
            const displayName = TOOL_DISPLAY_NAMES[tc.name] || tc.name;
            const args = parseToolArguments(tc.arguments);
            const argHint = args.search_query || args.query || args.keyword || args.article_id || args.articleId || args.article_title || args.title || args.id || '';
            nameSpan.textContent = argHint ? `${displayName}：${argHint}` : displayName;
            const status = document.createElement('span');
            status.className = 'tool-call-status';
            status.textContent = '（竞技场模式不执行）';
            header.appendChild(nameSpan);
            header.appendChild(status);
            header.addEventListener('click', () => block.classList.toggle('expanded'));
            block.appendChild(header);
            toolCallsContainer.appendChild(block);
          }
        }

        if (hasAnswer || hasReasoning) renderMathInElement(card);
      }

      // Reveal model name
      if (modelId && wrapper._duel?.anonymous) {
        const head = card.querySelector('.duel-card-head');
        if (head) head.innerHTML = `<span>${escapeHtml(getModelDisplayName(modelId))}</span><small>${escapeHtml(modelId)}</small>`;
      }

      scrollChatToBottom();
    }

    function updateAssistantMessage(messageId, { reasoning = '', answer = '', thinking = false } = {}) {
      const messageDiv = document.getElementById(messageId);
      if (!messageDiv || !messageDiv._parts) return;

      const {
        thinkBlock,
        thinkHeader,
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

      thinkBlock.hidden = !hasReasoning && !thinking;
      if (thinking && !thinkStreamState.wasThinking) {
        thinkStreamState.startedAt = Date.now();
        thinkStreamState.autoCollapsed = false;
        thinkBlock.classList.remove('is-collapsed');
        if (thinkHeader) thinkHeader.setAttribute('aria-expanded', 'true');
      }
      if (hasReasoning) {
        syncStreamingMarkdownBlock(thinkBody, thinkStreamState, reasoningText, { thinking });
      } else if (!thinking) {
        thinkBody.innerHTML = '';
        thinkStreamState.text = '';
        thinkStreamState.ready = false;
      }

      if (thinking) thinkBlock.classList.add('is-thinking');
      else thinkBlock.classList.remove('is-thinking');
      if (thinkHeader) {
        const label = thinkHeader.querySelector('.think-label');
        const seconds = thinkStreamState.startedAt
          ? Math.max(1, Math.round((Date.now() - thinkStreamState.startedAt) / 1000))
          : 1;
        if (label) label.textContent = thinking ? 'Thinking' : `Thought for ${seconds}s`;
      }
      if (!thinking && hasReasoning && thinkStreamState.wasThinking && !thinkStreamState.autoCollapsed) {
        thinkBlock.classList.add('is-collapsed');
        if (thinkHeader) thinkHeader.setAttribute('aria-expanded', 'false');
        thinkStreamState.autoCollapsed = true;
      }
      thinkStreamState.wasThinking = Boolean(thinking);

      if (hasAnswer) {
        syncStreamingMarkdownBlock(answerBody, answerStreamState, answerText, { thinking, placeholder: '正在思考中…' });
      } else if (thinking) {
        answerBody.innerHTML = '';
        answerStreamState.text = '';
        answerStreamState.ready = false;
      } else {
        answerBody.innerHTML = '';
        answerStreamState.text = '';
        answerStreamState.ready = false;
      }

      // 渲染数学公式
      if (hasAnswer || hasReasoning) {
        renderMathInMessage(messageId);
      }

      scrollChatToBottom();
    }

    function composeReasoningText(previous, current) {
      const left = String(previous || '').trim();
      const right = String(current || '').trim();
      if (!left) return right;
      if (!right) return left;
      return `${left}\n\n---\n\n${right}`;
    }

    function exportChatToMarkdown() {
      if (!conversationHistory || conversationHistory.length === 0) {
        showToast('当前没有可导出的对话记录');
        return;
      }

      const now = new Date();
      const dateStr = now.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      }).replace(/\//g, '-').replace(/:/g, '-');

      let markdown = `# ChatAI 对话记录\n\n导出时间: ${now.toLocaleString('zh-CN')}\n总消息数: ${conversationHistory.length}\n\n---\n\n`;

      conversationHistory.forEach((msg, index) => {
        const role = msg.role === 'user' ? '用户' : (msg.role === 'assistant' ? '助手' : '系统');
        markdown += `## ${role} (${index + 1})\n\n`;

        if (Array.isArray(msg.content)) {
          // 多模态内容
          msg.content.forEach(part => {
            if (part.type === 'text') {
              markdown += `${part.text}\n\n`;
            } else if (part.type === 'image_url') {
              markdown += `[图片附件]\n\n`;
            } else if (part.type === 'input_file') {
              markdown += `[文件附件: ${part.file_name || '未知'}]\n\n`;
            }
          });
        } else {
          markdown += `${msg.content}\n\n`;
        }

        if (msg.tool_calls && msg.tool_calls.length > 0) {
          markdown += `**工具调用**:\n`;
          msg.tool_calls.forEach(tool => {
            markdown += `- \`${tool.function?.name}\`\n`;
          });
          markdown += '\n';
        }

        markdown += '---\n\n';
      });

      // 添加Token统计
      const totalTokens = estimateConversationTokens(conversationHistory);
      markdown += `\n## 统计信息\n\n- 总Token数: ${formatTokenCount(totalTokens)}\n- 消息数: ${conversationHistory.length}\n\n`;

      // 创建下载
      const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ChatAI-对话-${dateStr}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showToast('对话记录已导出');
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

    function assistantHistoryMessage(content, metadata) {
      return {
        role: 'assistant',
        content,
        metadata: normalizeAssistantMetadata(metadata)
      };
    }

    async function saveOrUpdateChatHistory() {
      try {
        let saved = false;
        if (currentChatId) {
          saved = Boolean(await updateChatHistory(currentChatId, conversationHistory));
        } else if (conversationHistory.length > 0) {
          saved = Boolean(await saveChatHistory(conversationHistory));
        }
        if (saved) {
          // 刷新聊天记录列表
          renderChatHistoryList();
        }
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

    function toApiMessage(message, modelId) {
      const apiMessage = {
        role: message.role,
        content: normalizeHistoryContentForModel(message.content, modelId),
      };
      if (message.name) apiMessage.name = message.name;
      if (message.tool_call_id) apiMessage.tool_call_id = message.tool_call_id;
      if (Array.isArray(message.tool_calls)) apiMessage.tool_calls = message.tool_calls;
      return apiMessage;
    }

    async function buildApiMessages(query, extraSystemContent = '', userContent = null, modelId = currentModel) {
      void extraSystemContent;
      const messages = [];
      conversationHistory.forEach(message => {
        messages.push(toApiMessage(message, modelId));
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

      const response = await proxyFetchWithTimeout(EDGE_FUNCTION_URL, {
        method: 'POST',
        headers: await proxyHeaders(),
        body: JSON.stringify({
          endpoint: 'chat',
          model: MODEL_IDS[modelId] || MODEL_IDS[DEFAULT_MODEL_ID] || DEFAULT_MODEL_ID,
          messages: [
            {
              role: 'user',
              content: `请将以下历史对话压缩为可继续聊天的简明摘要。必须保留：目标、已确认事实、用户偏好、重要约束、未完成事项、待继续的问题。请用简洁中文输出，格式固定为：## 目标\n## 已确认信息\n## 未完成事项\n## 延续建议。不要编造。\n\n${transcript}`
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
            detail = parsed.code === 'challenge_required' || parsed.code === 'access_blocked' || parsed.code === 'anonymous_not_allowed'
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
        role: 'assistant',
        content: `【历史摘要】\n以下是上一段对话的压缩摘要，请在后续回合继续沿用其中已确认的事实、目标、约束与待办。\n\n${summary}`
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
      return [];
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
      return text;
      if (!text || typeof text !== 'string') return text;
      // 移除 [Call ... with ...] 标记
      let cleaned = text.replace(/\[\s*Call\s+[`']?[a-zA-Z0-9_\-]+[`']?\s+with\s+[`']?\{[\s\S]*?\}[`']?\s*\]/gi, '');
      // 移除 function_name({...}) 标记（行首或独立出现）
      cleaned = cleaned.replace(/(^|\n)\s*[a-zA-Z0-9_\-]+\s*\(\{[\s\S]*?\}\)\s*(?=\n|$)/g, '$1');
      return cleaned.trim();
    }

    async function executeWebSearchToolCall(toolCall, activeTurnId = '') {
      const args = parseToolArguments(toolCall?.arguments);
      const query = String(args.search_query || args.query || args.keyword || '').trim();
      if (!query) {
        return JSON.stringify({ error: 'web_search 需要 search_query 参数。' }, null, 2);
      }

      const lang = args.lang === 'en' || args.lang === 'zh' ? args.lang : getPreferredArticleLang(query);
      const limitValue = Number.isFinite(Number(args.limit)) ? Number(args.limit) : 5;
      const limit = Math.max(1, Math.min(10, Math.round(limitValue)));

      const requestPayload = {
        endpoint: 'web_search',
        query,
        search_query: query,
        lang,
        limit,
        client_turn_id: activeTurnId,
        tool_call_id: toolCall?.id || '',
        tool_name: 'web_search',
        request_kind: 'tool_call',
        tool_index: Number(toolCall?._index ?? 0)
      };

      const tryFetchSearch = async (url) => {
        const response = await proxyFetchWithTimeout(url, {
          method: 'POST',
          headers: await proxyHeaders(activeTurnId ? { 'X-Chat-Turn-Id': activeTurnId } : {}),
          body: JSON.stringify(requestPayload),
        }, FETCH_TIMEOUT_MS, '联网搜索');

        if (!response.ok) {
          const errorText = await response.text().catch(() => '');
          let detail = errorText.trim();
          if (detail) {
            const parsed = parseBackendErrorPayload(detail);
            detail = parsed.code === 'challenge_required' || parsed.code === 'access_blocked' || parsed.code === 'anonymous_not_allowed'
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

      const data = await tryFetchSearch(EDGE_FUNCTION_URL);
      return JSON.stringify(data, null, 2);
    }

    async function executeFetchWebPageToolCall(toolCall, activeTurnId = '') {
      const args = parseToolArguments(toolCall?.arguments);
      const url = String(args.url || '').trim();
      if (!url) {
        return JSON.stringify({ error: 'fetch_web_page 需要 url 参数。' }, null, 2);
      }

      const requestPayload = {
        endpoint: 'fetch_web_page',
        url,
        client_turn_id: activeTurnId,
        tool_call_id: toolCall?.id || '',
        tool_name: 'fetch_web_page',
        request_kind: 'tool_call',
        tool_index: Number(toolCall?._index ?? 0)
      };

      const tryFetchPage = async (fetchUrl) => {
        const response = await proxyFetchWithTimeout(fetchUrl, {
          method: 'POST',
          headers: await proxyHeaders(activeTurnId ? { 'X-Chat-Turn-Id': activeTurnId } : {}),
          body: JSON.stringify(requestPayload),
        }, FETCH_TIMEOUT_MS, '获取网页内容');

        if (!response.ok) {
          const errorText = await response.text().catch(() => '');
          let detail = errorText.trim();
          if (detail) {
            const parsed = parseBackendErrorPayload(detail);
            detail = parsed.code === 'challenge_required' || parsed.code === 'access_blocked' || parsed.code === 'anonymous_not_allowed'
              ? formatSecurityGuardMessage(parsed)
              : parsed.message || detail;
          }
          throw new Error(detail || `获取网页内容失败：HTTP ${response.status}`);
        }

        const data = await response.json();
        return data;
      };

      try {
        const data = await tryFetchPage(EDGE_FUNCTION_URL);
        return JSON.stringify(data, null, 2);
      } catch (error) {
        const message = normalizeErrorMessage(error, '获取网页内容失败，请稍后重试。');
        throw new Error(message);
      }
    }

    async function executeArticleToolCall(toolCall, activeTurnId = '') {
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
          return executeWebSearchToolCall(toolCall, activeTurnId);
        }
        case 'fetch_web_page': {
          return executeFetchWebPageToolCall(toolCall, activeTurnId);
        }
        default:
          return JSON.stringify({ error: `不支持的工具：${name}` }, null, 2);
      }
    }

    async function streamChatCompletionRound(messages, assistantMessageId, controller, { enableTools = true, turnId = '', modelId = currentModel, priorReasoning = '', requestKind = 'direct_chat' } = {}) {
      let finalAnswer = '';
      let reasoningText = '';
      let streamBuffer = '';
      let doneReasoning = false;
      const toolCalls = [];

      let response = null;
      const activeModelId = MODEL_IDS[modelId] || MODEL_IDS[DEFAULT_MODEL_ID] || DEFAULT_MODEL_ID;

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
        ...getModelRequestOptions(modelId),
      };

      if (enableTools) {
        requestBody.tools = getAvailableToolDefinitions();
        requestBody.tool_choice = 'auto';
      }

      for (let attempt = 1; attempt <= 2; attempt += 1) {
        response = await proxyFetchWithTimeout(EDGE_FUNCTION_URL, {
          method: 'POST',
          headers: await proxyHeaders(),
          signal: controller.signal,
          body: JSON.stringify({
            endpoint: 'chat',
            client_turn_id: turnId,
            request_kind: requestKind,
            ...requestBody
          })
        }, getChatRequestTimeoutMs(modelId), '模型请求');

        if (response.status !== 429 || attempt === 2) {
          break;
        }

        await sleep(900 * attempt);
      }

      const showModelQuota = usesSharedQuota(modelId);
      const errorText = response.ok ? '' : await response.text().catch(() => '');
      updateRateLimitFromHeaders(response.headers, showModelQuota, response.status, errorText, modelId);

      if (response.status === 429) {
        throw new Error(getQuotaLockMessage(modelId) || '模型额度已超，请切换模型重试。');
      }

      if (!response.ok) {
        let detail = errorText.trim();
        if (detail) {
          const parsed = parseBackendErrorPayload(detail);
          applyBackendModelBlock(parsed, modelId);
          detail = parsed.code === 'challenge_required' || parsed.code === 'access_blocked' || parsed.code === 'anonymous_not_allowed'
            ? formatSecurityGuardMessage(parsed)
            : parsed.message || detail;
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
          updateAssistantMessage(assistantMessageId, { reasoning: composeReasoningText(priorReasoning, reasoningText), answer: finalAnswer || '', thinking: true });
        }

        if (answer) {
          if (!doneReasoning) {
            doneReasoning = true;
          }
          finalAnswer += answer;
          updateAssistantMessage(assistantMessageId, { reasoning: composeReasoningText(priorReasoning, reasoningText), answer: finalAnswer, thinking: true });
        }

        // 兼容 OpenAI 格式的流式 tool_calls
        if (Array.isArray(delta.tool_calls) && delta.tool_calls.length) {
          mergeToolCallDeltas(toolCalls, delta.tool_calls);
          updateAssistantMessage(assistantMessageId, { reasoning: composeReasoningText(priorReasoning, reasoningText), answer: '', thinking: true });
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
            updateAssistantMessage(assistantMessageId, { reasoning: composeReasoningText(priorReasoning, reasoningText), answer: '', thinking: true });
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
          updateAssistantMessage(assistantMessageId, { reasoning: composeReasoningText(priorReasoning, reasoningText), answer: '', thinking: true });
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
      const turnModelId = currentModel;
      const turnModelMetadata = createModelMetadata(turnModelId);

      if (turnModelId === 'gpt-image-2') {
        if (!query && !attachmentsForSend.length) return;
        await sendImageGenerationMessage(query, turnModelId, turnModelMetadata);
        return;
      }

      const effectiveQuery = query || '请分析上传的图片。';
      const userContent = attachmentsForSend.length
        ? attachmentToUserContent(effectiveQuery, attachmentsForSend)
        : effectiveQuery;
      const userHistoryMessage = { role: 'user', content: userContent };

      createUserMessage(query || effectiveQuery, attachmentsForSend);
      homeInput.value = '';

      let fallbackToSingleModel = false;
      if (!attachmentsForSend.length && (state.arenaMode === 'anonymous' || state.arenaMode === 'side_by_side')) {
        setComposerBusy(true);
        try {
          const duelResult = await sendArenaDuelMessage(effectiveQuery, { anonymous: state.arenaMode === 'anonymous' });
          pushHistory(userHistoryMessage);
          pushHistory(assistantHistoryMessage(`【模型 A】\n${duelResult.answerA || '无有效回复'}\n\n【模型 B】\n${duelResult.answerB || '无有效回复'}`, createModelMetadata(turnModelId)));
          await finalizeConversationTurn();
          homeInput.placeholder = 'Ask followup...';
        } catch (error) {
          const message = normalizeErrorMessage(error, '双模型对话失败，请稍后重试。');
          const isSecurityError = /登录|访问被拒绝|暂仅支持|邮箱验证码|Invalid session|access_blocked|email_domain_not_allowed/i.test(message);
          if (isSecurityError) {
            const errorMessageId = createAssistantMessage(turnModelMetadata);
            updateAssistantMessage(errorMessageId, { answer: message, thinking: false });
            showToast(message);
          } else {
            fallbackToSingleModel = true;
            showToast('对战暂不可用，已用单模型继续。');
          }
        } finally {
          setComposerBusy(false);
        }
        if (!fallbackToSingleModel) return;
      }

      if (!isModelAvailable(turnModelId)) {
        await refreshSharedQuota().catch(() => {});
      }

      const currentStatus = getModelStatus(turnModelId);
      if (!isModelAvailable(turnModelId)) {
        const unavailableMessage = getQuotaLockMessage(turnModelId)
          || (currentStatus.quotaRemaining !== null && currentStatus.quotaRemaining <= 0
          ? '当前模型额度已用完，请切换其他模型再试。'
          : '当前模型暂时不可用，请切换其他模型再试。');
        const assistantMessageId = createAssistantMessage(turnModelMetadata);
        const detailedUnavailableMessage = `${unavailableMessage}${formatModelUnavailableDebug(turnModelId, currentStatus)}`;
        updateAssistantMessage(assistantMessageId, { answer: detailedUnavailableMessage, thinking: false });
        pushHistory(userHistoryMessage);
        pushHistory(assistantHistoryMessage(detailedUnavailableMessage, turnModelMetadata));
        await finalizeConversationTurn();
        return;
      }

      setComposerBusy(true);

      try {
        await ensureContextBudget(userContent, turnModelId);
      } catch (error) {
        showToast(normalizeErrorMessage(error, '上下文压缩失败，请稍后再试。'));
        state.sendLocked = false;
        setComposerBusy(false);
        return;
      }

      const assistantMessageId = createAssistantMessage(turnModelMetadata);
      const controller = new AbortController();
      const clearTurnTimeout = startAbortTimer(controller, CHAT_TURN_TIMEOUT_MS, '对话请求');
      const turnId = createChatTurnId();
      state.activeRequestController = controller;
      const turnMessages = [];

      try {
        const baseMessages = await buildApiMessages(effectiveQuery, '', userContent, turnModelId);
        const requestMessages = baseMessages.map(message => ({ ...message }));
        const repeatedToolCalls = new Map();
        let accumulatedReasoningText = '';
        let round = 0;
        while (!controller.signal.aborted) {
          const roundResult = await streamChatCompletionRound(requestMessages, assistantMessageId, controller, { turnId, modelId: turnModelId, priorReasoning: accumulatedReasoningText, requestKind: round === 0 ? 'direct_chat' : 'tool_followup_chat' });
          accumulatedReasoningText = composeReasoningText(accumulatedReasoningText, roundResult.reasoningText);

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
              reasoning: accumulatedReasoningText,
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
                updateAssistantMessage(assistantMessageId, { reasoning: accumulatedReasoningText, answer: repeatedAnswer, thinking: false });
                pushHistory(userHistoryMessage);
                turnMessages.forEach(message => pushHistory(message));
                pushHistory(assistantHistoryMessage(repeatedAnswer, turnModelMetadata));
                await finalizeConversationTurn();
                return;
              }
              const uiBlock = addToolCallUI(assistantMessageId, toolCall);
              let toolOutput = '';

              try {
                toolCall._index = index;
                const toolPromise = executeArticleToolCall(toolCall, turnId);
                const timeoutPromise = new Promise((_, reject) => {
                  setTimeout(() => reject(new Error('工具调用超时（25秒），请稍后重试。')), TOOL_CALL_TIMEOUT_MS);
                });
                toolOutput = await Promise.race([toolPromise, timeoutPromise]);
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
            reasoning: accumulatedReasoningText,
            answer: resolvedAnswer,
            thinking: false,
          });

          pushHistory(userHistoryMessage);
          turnMessages.forEach(message => pushHistory(message));
          pushHistory(assistantHistoryMessage(resolvedAnswer, turnModelMetadata));
          await finalizeConversationTurn();
          return;
        }

        const fallbackAnswer = controller.signal.aborted ? '请求已取消。' : '请求超时（对话回合超过3分钟），建议简化问题或分多次询问。';
        updateAssistantMessage(assistantMessageId, { answer: fallbackAnswer, thinking: false });
        pushHistory(userHistoryMessage);
        turnMessages.forEach(message => pushHistory(message));
        pushHistory(assistantHistoryMessage(fallbackAnswer, turnModelMetadata));
        await finalizeConversationTurn();
      } catch (error) {
        const message = normalizeErrorMessage(error, '抱歉，发送消息时出现错误，请稍后重试。');
        let failureAnswer = '';
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
          failureAnswer = message;
        } else {
          failureAnswer = `抱歉，发送消息时出现错误：${message}`;
        }
        updateAssistantMessage(assistantMessageId, { answer: failureAnswer, thinking: false });
        try {
          pushHistory(userHistoryMessage);
          turnMessages.forEach(historyMessage => pushHistory(historyMessage));
          pushHistory(assistantHistoryMessage(failureAnswer, turnModelMetadata));
          await finalizeConversationTurn();
        } catch (saveError) {
          console.error('保存失败回合失败:', saveError);
        }
      } finally {
        clearTurnTimeout();
        if (state.activeRequestController === controller) {
          state.activeRequestController = null;
        }
        state.sendLocked = false;
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
        showToast('账户系统建议使用 Supabase Auth 邮箱验证码，后端配置见本次总结。');
      });
    }

    if (topArenaModeBtn) {
      topArenaModeBtn.addEventListener('click', e => {
        e.stopPropagation();
        topArenaModeSelector?.classList.toggle('open');
        closeModelDropdown();
      });
      topArenaModeSelector?.querySelectorAll('.arena-mode-option').forEach(option => {
        option.addEventListener('click', e => {
          e.stopPropagation();
          setTopArenaMode(option.dataset.mode);
        });
      });
      document.addEventListener('click', e => {
        if (!topArenaModeSelector?.contains(e.target)) topArenaModeSelector?.classList.remove('open');
      });
    }

    const arenaLeaderboardNavBtn = document.getElementById('arenaLeaderboardNavBtn');
    if (arenaLeaderboardNavBtn) {
      arenaLeaderboardNavBtn.addEventListener('click', () => {
        const panel = document.getElementById('sidebarLeaderboardPanel');
        if (panel) panel.hidden = true;
      });
    }

    const sidebarSearchBtn = document.getElementById('sidebarSearchBtn');
    if (sidebarSearchBtn) {
      sidebarSearchBtn.addEventListener('click', () => {
        if (sidebarSearchWrap) sidebarSearchWrap.hidden = !sidebarSearchWrap.hidden;
        if (sidebarSearchWrap && !sidebarSearchWrap.hidden) chatHistorySearchInput?.focus();
      });
    }

    if (chatHistorySearchInput) {
      chatHistorySearchInput.addEventListener('input', renderChatHistoryList);
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

    on('searchChatsBtn', 'click', () => {});
    on('codexBtn', 'click', () => {});
    document.getElementById('teamToastBtn').addEventListener('click', () => {});
    document.getElementById('upgradeBtn').addEventListener('click', () => window.open('https://qm.qq.com/q/bxQU3rXRyo', '_blank'));
    const clearBtnEl = document.getElementById('clearBtn');
    if (clearBtnEl) clearBtnEl.addEventListener('click', () => clearConversation());
    const exportBtnEl = document.getElementById('exportBtn');
    if (exportBtnEl) exportBtnEl.addEventListener('click', () => exportChatToMarkdown());
    const leaderboardStartVotingBtn = document.getElementById('leaderboardStartVotingBtn');
    if (leaderboardStartVotingBtn) {
      leaderboardStartVotingBtn.addEventListener('click', () => {
        setTopArenaMode('anonymous');
        setActiveView('home');
        homeInput?.focus();
      });
    }
    const leaderboardSegmentButtons = document.querySelectorAll('.leaderboard-segment button');
    if (leaderboardSegmentButtons.length >= 2) {
      leaderboardSegmentButtons[0].addEventListener('click', () => switchLeaderboardView('ranking'));
      leaderboardSegmentButtons[1].addEventListener('click', () => switchLeaderboardView('pareto'));
    }
    document.getElementById('micToastBtn').addEventListener('click', () => {});
    document.getElementById('imageMicToastBtn').addEventListener('click', () => {});
    document.getElementById('uploadToastBtn').addEventListener('click', () => attachmentInput?.click());
    document.getElementById('thinkingToastBtn').addEventListener('click', () => {});
    document.getElementById('researchToastBtn2').addEventListener('click', () => {});
    document.getElementById('openResearchToast').addEventListener('click', () => {});
    document.getElementById('openAppsToast').addEventListener('click', () => {});
    document.getElementById('profileToastBtn').addEventListener('click', () => {});
    document.getElementById('helpToastBtn').addEventListener('click', () => {
      window.open('https://nexusvai.github.io/NexusV/article.html?id=hero', '_blank');
    });
    document.getElementById('nicknameEditBtn').addEventListener('click', () => {
      closePopover();
      const current = getNickname();
      const name = prompt('输入你的昵称（留空则清除）：', current);
      if (name !== null) setNickname(name.trim());
    });
    document.getElementById('logoutToastBtn').addEventListener('click', async () => {
      closePopover();
      await handleLogout();
      showToast('已退出登录');
    });
    document.getElementById('mfaToastBtn').addEventListener('click', () => {});
    document.getElementById('projectSettingToastBtn').addEventListener('click', () => {});
    document.getElementById('plusMoreBtn').addEventListener('click', () => {});

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

    document.querySelectorAll('.image-prompt-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const prompt = chip.dataset.prompt || chip.textContent || '';
        imagePromptInput.value = prompt.trim();
        setImageGenerationBusy(state.isImageGenerating, imageGenerationStatus.textContent);
        imagePromptInput.focus();
      });
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
      if (state.isStreaming) {
        if (state.activeRequestController) {
          state.activeRequestController.abort(createAbortError('已停止生成。'));
          state.activeRequestController = null;
        }
        return;
      }
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

    document.addEventListener('click', event => {
      if (customContextMenu && !customContextMenu.contains(event.target)) {
        closeCustomContextMenu();
      }
    });

    document.addEventListener('scroll', closeCustomContextMenu, true);
    window.addEventListener('blur', closeCustomContextMenu);

    function renderModelDropdownFromCatalog() {
      const content = document.getElementById('modelDropdownContent');
      if (!content) return;
      content.textContent = '';

      const isArenaMode = state.arenaMode === 'side_by_side' || state.arenaMode === 'anonymous';
      const grouped = new Map();
      SELECTABLE_MODELS.forEach(model => {
        if (isArenaMode && model.imageOnly) return;
        const brand = model.brand || getModelBrandName(model.id);
        if (!grouped.has(brand)) grouped.set(brand, []);
        grouped.get(brand).push(model);
      });

      grouped.forEach((models, brand) => {
        const header = document.createElement('div');
        header.className = 'model-group-header';
        header.dataset.brand = brand;
        header.textContent = brand;
        content.appendChild(header);

        models
          .slice()
          .sort((a, b) => {
            const canonical = String(a.canonicalId || a.id).localeCompare(String(b.canonicalId || b.id));
            if (canonical !== 0) return canonical;
            return String(a.lineLabel || '').localeCompare(String(b.lineLabel || ''));
          })
          .forEach(model => {
            const option = document.createElement('div');
            option.className = 'model-option';
            option.dataset.model = model.id;
            option.dataset.brand = brand;
            option.dataset.canonical = model.canonicalId || model.id;
            option.dataset.lineLabel = model.lineLabel || '';
            option.dataset.multimodal = model.multimodal ? 'true' : 'false';
            option.title = model.lineLabel ? `${model.displayName || model.id} · ${model.lineLabel}` : (model.displayName || model.id);

            const speedDot = document.createElement('span');
            speedDot.className = 'model-speed-dot speed-unknown';
            option.appendChild(speedDot);

            const label = document.createElement('span');
            label.className = 'model-label';

            const icon = document.createElement('img');
            icon.src = model.iconPath || './openai.svg';
            icon.alt = '';
            icon.className = 'model-option-icon';
            label.appendChild(icon);

            const textWrap = document.createElement('span');
            textWrap.className = 'model-label-stack';

            const name = document.createElement('span');
            name.className = 'model-label-text';
            name.textContent = model.displayName || model.id;
            textWrap.appendChild(name);

            const subtext = document.createElement('span');
            subtext.className = 'model-label-subtext';
            subtext.textContent = [model.lineLabel, model.canonicalId && model.canonicalId !== model.id ? model.canonicalId : ''].filter(Boolean).join(' · ');
            if (subtext.textContent) textWrap.appendChild(subtext);
            label.appendChild(textWrap);
            option.appendChild(label);

            (model.tags || []).forEach(tagText => {
              const tag = document.createElement('span');
              tag.className = 'model-tag';
              if (String(tagText).includes('多模态')) tag.classList.add('multimodal');
              tag.textContent = tagText;
              option.appendChild(tag);
            });

            option.classList.toggle('active', model.id === currentModel);
            content.appendChild(option);
          });
      });
      applyModelDropdownFilters();
    }

    function getActiveModelFilter() {
      return modelFilterRow?.querySelector('.model-filter-chip.active')?.dataset.filter || 'all';
    }

    function modelMatchesFilter(option, filter, query) {
      const modelId = option.dataset.model || '';
      const meta = getModelMeta(modelId);
      const haystack = [modelId, meta.canonicalId, meta.displayName, meta.brand, meta.lineLabel, ...(meta.tags || [])].join(' ').toLowerCase();
      const q = String(query || '').trim().toLowerCase();
      if (q && !haystack.includes(q)) return false;
      if (filter === 'code') return /code|coder|编程|编码/.test(haystack);
      if (filter === 'image') return meta.multimodal || /image|多模态|视觉|图片|生图/.test(haystack);
      if (filter === 'search') return /search|联网|搜索/.test(haystack);
      return true;
    }

    function applyModelDropdownFilters() {
      const filter = getActiveModelFilter();
      const query = modelSearchInput ? modelSearchInput.value : '';
      const options = Array.from(modelDropdown?.querySelectorAll('.model-option') || []);
      let visibleCount = 0;
      const visibleBrands = new Set();
      options.forEach(option => {
        const visible = modelMatchesFilter(option, filter, query);
        option.dataset.filtered = visible ? 'true' : 'false';
        option.style.display = visible ? 'flex' : 'none';
        if (visible) {
          visibleCount += 1;
          if (option.dataset.brand) visibleBrands.add(option.dataset.brand);
        }
      });
      modelDropdown?.querySelectorAll('.model-group-header').forEach(header => {
        header.style.display = visibleBrands.has(header.dataset.brand || '') ? 'block' : 'none';
      });
      const pageInfo = document.getElementById('modelPageInfo');
      const prevBtn = document.getElementById('modelPagePrev');
      const nextBtn = document.getElementById('modelPageNext');
      if (pageInfo) pageInfo.textContent = visibleCount ? `${visibleCount} models` : 'No match';
      if (prevBtn) prevBtn.disabled = true;
      if (nextBtn) nextBtn.disabled = true;
    }

    // 模型下拉菜单分页
    const MODELS_PER_PAGE = 10;
    let currentModelPage = 1;
    let totalModelPages = 1;

    function initModelPagination() {
      currentModelPage = 1;
      totalModelPages = 1;
      applyModelDropdownFilters();
    }

    function updateModelPageDisplay() {
      applyModelDropdownFilters();
    }

    function goToModelPage(page) {
      if (page < 1 || page > totalModelPages) return;
      currentModelPage = page;
      updateModelPageDisplay();
    }

    function openModelDropdown() {
      modelSelector?.classList.add('open');
      applyModelDropdownFilters();
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

    function setCompareModel(modelId) {
      if (!isModelSelectable(modelId)) return;
      if (modelId === currentModel) {
        showToast('\u6a21\u578b B \u4e0d\u80fd\u548c\u6a21\u578b A \u76f8\u540c');
        return;
      }
      compareModel = modelId;
      localStorage.setItem('cancri_compare_model', modelId);
      if (compareModelName) compareModelName.textContent = getModelDisplayName(modelId);
      closeModelDropdown();
      showToast(`\u6a21\u578b B \u5df2\u5207\u6362\u81f3 ${getModelDisplayName(modelId)}`);
    }
    function setModel(modelId) {
      if (!isModelSelectable(modelId)) return;
      currentModel = modelId;
      isMultimodal = isMultimodalModel(modelId);
      localStorage.setItem('cancri_current_model', modelId);
      if (compareModel === currentModel) {
        compareModel = getFallbackModelId(currentModel);
        localStorage.setItem('cancri_compare_model', compareModel);
        if (compareModelName) compareModelName.textContent = getModelDisplayName(compareModel);
      }

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
        modelSelectTarget = 'primary';
        if (modelSelector?.classList.contains('open')) {
          closeModelDropdown();
        } else {
          openModelDropdown();
        }
      });
    }

    if (compareModelCurrentBtn) {
      compareModelCurrentBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        modelSelectTarget = 'compare';
        if (modelSelector?.classList.contains('open')) closeModelDropdown();
        else openModelDropdown();
      });
    }
    renderModelDropdownFromCatalog();

    if (modelDropdown) {
      modelDropdown.querySelectorAll('.model-option').forEach(option => {
        option.addEventListener('click', () => {
          const modelId = option.dataset.model;
          if (!isModelAvailable(modelId)) {
            const status = getModelStatus(modelId);
            showToast(`${getModelDisplayName(modelId)} 当前不可用：${status.error || '额度已用完'}`);
            return;
          }
          if (modelSelectTarget === 'compare') setCompareModel(modelId);
          else setModel(modelId);
        });
      });

      if (modelSearchInput) {
        modelSearchInput.addEventListener('input', () => {
          currentModelPage = 1;
          applyModelDropdownFilters();
        });
      }

      if (modelFilterRow) {
        modelFilterRow.querySelectorAll('.model-filter-chip').forEach(chip => {
          chip.addEventListener('click', e => {
            e.stopPropagation();
            modelFilterRow.querySelectorAll('.model-filter-chip').forEach(item => item.classList.toggle('active', item === chip));
            currentModelPage = 1;
            applyModelDropdownFilters();
          });
        });
      }

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
    if (compareModelName) {
      compareModelName.textContent = getModelDisplayName(compareModel);
    }
    updateModelSelectorActive();
    updateHomeModeChips();
    syncTopArenaMode();
    setActiveView('home');
    refreshNicknameUI();
    setComposerBusy(false);
    updateTokenExpiryNote();
    setInterval(updateTokenExpiryNote, 1000);
    initAuthOverlay();
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

    window.CancriApp = {
      state,
      MODEL_CATALOG,
      SELECTABLE_MODELS,
      ARENA_MODELS,
      EDGE_FUNCTION_URL,
      FETCH_TIMEOUT_MS,
      CHAT_TURN_TIMEOUT_MS,
      proxyHeaders,
      proxyFetchWithTimeout,
      authBody,
      createChatTurnId,
      parseBackendErrorPayload,
      renderMarkdown,
      escapeHtml,
      getModelDisplayName,
      getLeaderboardRowMeta,
      showToast,
      setActiveView,
      getModelRequestOptions,
      mergeToolCallDeltas,
      syncStreamingMarkdownBlock,
      TOOL_DISPLAY_NAMES,
      parseToolArguments,
    };
