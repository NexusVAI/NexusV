(function () {
  'use strict';

  const app = window.CancriApp;
  if (!app) {
    console.warn('[Arena] CancriApp not found — arena module skipped.');
    return;
  }

  const {
    state,
    MODEL_CATALOG,
    EDGE_FUNCTION_URL,
    FETCH_TIMEOUT_MS,
    CHAT_TURN_TIMEOUT_MS,
    proxyHeaders,
    proxyFetchWithTimeout,
    createChatTurnId,
    parseBackendErrorPayload,
    renderMarkdown,
    escapeHtml,
    getModelDisplayName,
    showToast,
  } = app;

  const arenaPromptInput = document.getElementById('arenaPromptInput');
  const arenaModeSelect = document.getElementById('arenaModeSelect');
  const arenaModelPickers = document.getElementById('arenaModelPickers');
  const arenaModelPickerB = document.getElementById('arenaModelPickerB');
  const arenaModelSearchA = document.getElementById('arenaModelSearchA');
  const arenaModelSearchB = document.getElementById('arenaModelSearchB');
  const arenaModelOptions = document.getElementById('arenaModelOptions');
  const arenaStartBtn = document.getElementById('arenaStartBtn');
  const arenaStatus = document.getElementById('arenaStatus');
  const arenaAnswerA = document.getElementById('arenaAnswerA');
  const arenaAnswerB = document.getElementById('arenaAnswerB');
  const arenaModelA = document.getElementById('arenaModelA');
  const arenaModelB = document.getElementById('arenaModelB');
  const arenaVoteRow = document.getElementById('arenaVoteRow');
  const arenaLeaderboardList = document.getElementById('arenaLeaderboardList');

  let currentArenaMatch = null;
  state.isArenaRunning = false;

  const arenaModels = Array.isArray(MODEL_CATALOG) ? MODEL_CATALOG.filter(model => model && model.id && !String(model.id).startsWith('image-')) : [];

  function getModelIdFromInput(input) {
    const value = String(input?.value || '').trim();
    if (!value) return '';
    const exact = arenaModels.find(model => model.id === value || model.displayName === value);
    if (exact) return exact.id;
    const lowered = value.toLowerCase();
    const fuzzy = arenaModels.find(model => String(model.id).toLowerCase().includes(lowered) || String(model.displayName || '').toLowerCase().includes(lowered));
    return fuzzy ? fuzzy.id : '';
  }

  function syncArenaModeUi() {
    const mode = arenaModeSelect?.value || 'anonymous';
    if (arenaModelPickers) arenaModelPickers.hidden = mode === 'anonymous';
    if (arenaModelPickerB) arenaModelPickerB.hidden = mode === 'single';
    if (arenaStartBtn) arenaStartBtn.textContent = mode === 'single' ? '开始单模型' : '开始对战';
    const cardB = document.querySelector('.arena-card[data-slot="b"]');
    if (cardB) cardB.hidden = mode === 'single';
    if (arenaVoteRow) arenaVoteRow.hidden = true;
  }

  function initArenaModelOptions() {
    if (!arenaModelOptions) return;
    arenaModelOptions.innerHTML = arenaModels.map(model => {
      const label = `${model.displayName || model.id} · ${model.id}`;
      return `<option value="${escapeHtml(model.id)}" label="${escapeHtml(label)}"></option>`;
    }).join('');
    if (arenaModelSearchA && !arenaModelSearchA.value && arenaModels[0]) arenaModelSearchA.value = arenaModels[0].id;
    if (arenaModelSearchB && !arenaModelSearchB.value && arenaModels[1]) arenaModelSearchB.value = arenaModels[1].id;
  }

  function setArenaStatus(message) {
    if (arenaStatus) arenaStatus.textContent = message;
  }

  function setArenaBusy(busy) {
    state.isArenaRunning = Boolean(busy);
    if (arenaStartBtn) arenaStartBtn.disabled = Boolean(busy);
    if (arenaPromptInput) arenaPromptInput.disabled = Boolean(busy);
    if (arenaVoteRow) {
      arenaVoteRow.querySelectorAll('button').forEach(button => {
        button.disabled = Boolean(busy) || !currentArenaMatch || currentArenaMatch.voted || !currentArenaMatch.ready;
      });
    }
  }

  function renderArenaText(target, text, loading) {
    if (!target) return;
    const value = String(text || '').trim();
    target.innerHTML = value ? renderMarkdown(value) : '<span class="typing-indicator">' + (loading ? '正在生成…' : '暂无内容') + '</span>';
    if (window.renderMathInElement) window.renderMathInElement(target);
  }

  async function arenaApi(endpoint, payload, timeoutMs) {
    const response = await proxyFetchWithTimeout(EDGE_FUNCTION_URL, {
      method: 'POST',
      headers: await proxyHeaders(),
      body: JSON.stringify({ endpoint, ...payload })
    }, timeoutMs || FETCH_TIMEOUT_MS, '竞技场请求');
    const text = await response.text().catch(() => '');
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
    if (!response.ok) {
      const parsed = parseBackendErrorPayload(text);
      throw new Error(parsed.message || data.message || data.error || 'Arena request failed: ' + response.status);
    }
    return data;
  }

  function parseArenaStreamDelta(parsed) {
    const delta = parsed && parsed.choices && parsed.choices[0] ? parsed.choices[0].delta : {};
    const message = parsed && parsed.choices && parsed.choices[0] ? parsed.choices[0].message : {};
    return String(delta.content || delta.reasoning_content || message.content || '');
  }

  async function streamArenaSlot(matchId, slot, prompt, target) {
    let answer = '';
    const turnId = createChatTurnId();
    renderArenaText(target, '', true);
    const messages = [
      { role: 'system', content: '你正在参加匿名 AI 竞技场。请直接回答用户问题，不要透露或猜测自己的模型身份，不要提及评分规则。回答应清晰、有帮助、适度简洁。' },
      { role: 'user', content: prompt }
    ];

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
        client_turn_id: turnId
      })
    }, CHAT_TURN_TIMEOUT_MS, '竞技场模型请求');

    const errorText = response.ok ? '' : await response.text().catch(() => '');
    if (!response.ok) {
      const parsed = parseBackendErrorPayload(errorText);
      throw new Error(parsed.message || errorText || '模型 ' + slot.toUpperCase() + ' 请求失败');
    }
    if (!response.body) throw new Error('模型 ' + slot.toUpperCase() + ' 没有返回数据流');

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
          const chunk = parseArenaStreamDelta(JSON.parse(payload));
          if (!chunk) continue;
          answer += chunk;
          renderArenaText(target, answer, true);
        } catch { continue; }
      }
    }
    if (buffer.trim().startsWith('data: ')) {
      const payload = buffer.trim().slice(6).trim();
      if (payload && payload !== '[DONE]') {
        try { answer += parseArenaStreamDelta(JSON.parse(payload)); } catch { void 0; }
      }
    }
    renderArenaText(target, answer || '这个模型没有返回有效内容。', false);
    await arenaApi('arena_record_response', { id: matchId, slot, response: answer || '' });
    return answer;
  }

  async function loadArenaLeaderboard() {
    if (!arenaLeaderboardList) return;
    try {
      const result = await arenaApi('arena_leaderboard', {}, FETCH_TIMEOUT_MS);
      const rows = Array.isArray(result.data) ? result.data : [];
      if (!rows.length) {
        arenaLeaderboardList.textContent = '暂无投票数据。';
        return;
      }
      arenaLeaderboardList.innerHTML = rows.map(function (row, index) {
        const name = getModelDisplayName(row.model_id);
        const total = Number(row.total_votes || 0);
        const rate = Number(row.win_rate || 0);
        const elo = Number(row.elo_score || 1000).toFixed(0);
        return '<div class="arena-leaderboard-row"><strong>' + (index + 1) + '. ' + escapeHtml(name) + '</strong><span>Elo ' + elo + ' · ' + total + ' 票 · 胜率 ' + rate + '%</span></div>';
      }).join('');
    } catch (error) {
      arenaLeaderboardList.textContent = '排行榜暂时加载失败。';
    }
  }

  async function startArenaMatch() {
    const prompt = String(arenaPromptInput ? arenaPromptInput.value : '').trim();
    if (!prompt || state.isArenaRunning) return;
    const mode = arenaModeSelect?.value || 'anonymous';
    const modelA = getModelIdFromInput(arenaModelSearchA);
    const modelB = getModelIdFromInput(arenaModelSearchB);
    if ((mode === 'single' || mode === 'side_by_side') && !modelA) {
      setArenaStatus('请先选择模型 A。');
      return;
    }
    if (mode === 'side_by_side' && (!modelB || modelB === modelA)) {
      setArenaStatus('双模型对战需要选择两个不同模型。');
      return;
    }
    currentArenaMatch = null;
    if (arenaModelA) arenaModelA.textContent = mode === 'anonymous' ? '投票后揭晓' : getModelDisplayName(modelA);
    if (arenaModelB) arenaModelB.textContent = mode === 'anonymous' ? '投票后揭晓' : (mode === 'single' ? '未启用' : getModelDisplayName(modelB));
    renderArenaText(arenaAnswerA, '', true);
    renderArenaText(arenaAnswerB, mode === 'single' ? '单模型模式不会启动第二个模型。' : '', mode !== 'single');
    setArenaBusy(true);
    setArenaStatus(mode === 'single' ? '正在启动单模型…' : '正在创建对战，并启动模型…');

    try {
      const result = await arenaApi('arena_create_match', { prompt, mode, model_a: modelA, model_b: modelB }, FETCH_TIMEOUT_MS);
      const match = result.data;
      currentArenaMatch = { id: match.id, prompt: prompt, ready: false, voted: mode === 'single', reveal: null, mode };
      setArenaBusy(true);
      if (mode === 'single') {
        const answerA = await streamArenaSlot(match.id, 'a', prompt, arenaAnswerA);
        currentArenaMatch.ready = true;
        if (arenaVoteRow) arenaVoteRow.hidden = true;
        setArenaStatus(answerA ? '单模型回答完成。' : '单模型没有返回有效内容。');
        return;
      }
      if (arenaVoteRow) arenaVoteRow.hidden = false;
      const [answerA, answerB] = await Promise.allSettled([
        streamArenaSlot(match.id, 'a', prompt, arenaAnswerA),
        streamArenaSlot(match.id, 'b', prompt, arenaAnswerB)
      ]);
      if (answerA.status === 'rejected') renderArenaText(arenaAnswerA, '请求失败：' + (answerA.reason ? answerA.reason.message : answerA.reason), false);
      if (answerB.status === 'rejected') renderArenaText(arenaAnswerB, '请求失败：' + (answerB.reason ? answerB.reason.message : answerB.reason), false);
      currentArenaMatch.ready = true;
      setArenaStatus(mode === 'anonymous' ? '回答完成。请选择你认为更好的回答，投票后会揭晓模型。' : '回答完成。请选择你认为更好的回答。');
    } catch (error) {
      currentArenaMatch = null;
      setArenaStatus(error ? error.message : '竞技场请求失败，请稍后重试。');
    } finally {
      setArenaBusy(false);
    }
  }

  async function voteArenaMatch(winner) {
    if (!currentArenaMatch || !currentArenaMatch.ready || currentArenaMatch.voted) return;
    setArenaBusy(true);
    setArenaStatus('正在提交投票并揭晓模型…');
    try {
      const result = await arenaApi('arena_vote', { id: currentArenaMatch.id, winner: winner }, FETCH_TIMEOUT_MS);
      const reveal = (result && result.data && result.data.reveal) ? result.data.reveal : {};
      currentArenaMatch.voted = true;
      currentArenaMatch.reveal = reveal;
      if (arenaModelA) arenaModelA.textContent = getModelDisplayName(reveal.model_a || 'Model A');
      if (arenaModelB) arenaModelB.textContent = getModelDisplayName(reveal.model_b || 'Model B');
      const eloText = reveal.model_a_elo_after && reveal.model_b_elo_after ? ` Elo：A ${Math.round(reveal.model_a_elo_after)} / B ${Math.round(reveal.model_b_elo_after)}` : '';
      setArenaStatus((result && result.data && result.data.effective === false) ? '投票已记录，但因风控评分较高，不计入公开榜。' : '投票成功，排行榜已更新。' + eloText);
      await loadArenaLeaderboard();
    } catch (error) {
      setArenaStatus(error ? error.message : '投票失败，请稍后重试。');
    } finally {
      setArenaBusy(false);
    }
  }

  window.addEventListener('cancri:viewchange', function (e) {
    if (e.detail && e.detail.view === 'arena') {
      loadArenaLeaderboard();
    }
  });

  if (arenaStartBtn) {
    arenaStartBtn.addEventListener('click', startArenaMatch);
  }
  if (arenaPromptInput) {
    arenaPromptInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        startArenaMatch();
      }
    });
  }
  if (arenaVoteRow) {
    arenaVoteRow.hidden = true;
    arenaVoteRow.querySelectorAll('button[data-winner]').forEach(function (button) {
      button.addEventListener('click', function () { voteArenaMatch(button.dataset.winner); });
    });
    setArenaBusy(false);
  }
  if (arenaModeSelect) {
    arenaModeSelect.addEventListener('change', syncArenaModeUi);
  }
  initArenaModelOptions();
  syncArenaModeUi();

  console.log('[Arena] module loaded');
})();
