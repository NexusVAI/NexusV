// checkout-app.js — checkout page logic
// 负责：会话识别、订单摘要同步、支付方式切换、订单提交
(function () {
  'use strict';

  const PLAN_LABELS = {
    pro: 'Pro',
    pro_plus: 'Pro+',
    pro_max: 'Pro Max',
    go: 'Go',
    plus: 'Plus',
  };

  const METHOD_META = {
    wechat: {
      label: '微信',
      icon: 'chat/assets/wechat_icon_138016.svg',
      qr: 'Logo/1107.jpg',
      hint: '微信收款码',
    },
    alipay: {
      label: '支付宝',
      icon: 'chat/assets/alipay_payment_method_card_icon_142745.svg',
      qr: 'Logo/ZFB.jpg',
      hint: '支付宝收款码',
    },
  };

  const METHOD_ORDER = ['wechat', 'alipay'];
  const DEFAULT_METHOD = 'wechat';
  const DEFAULT_EMAIL = '';
  const GATEWAY_URL = `${(window.__SUPABASE_URL__ || 'https://chat.nexusvai.xyz').replace(/\/+$/, '')}/functions/v1/chat-gateway`;

  const state = {
    selection: null,
    session: null,
    method: DEFAULT_METHOD,
    // 用户是否手动改过该字段；为 true 时 IP 自动填充不再覆盖
    userTouched: { country: false, address: false },
  };

  const el = (id) => document.getElementById(id);
  const q = (selector, root = document) => root.querySelector(selector);
  const qa = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  function safeLocalStorageGet(key, fallback = '') {
    try {
      return localStorage.getItem(key) || fallback;
    } catch {
      return fallback;
    }
  }

  function safeLocalStorageSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // ignore
    }
  }

  function formatAmount(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n.toFixed(2) : '0.00';
  }

  function formatCurrency(value) {
    return `US$${formatAmount(value)}`;
  }

  function readSelection() {
    const params = new URLSearchParams(location.search);
    const rawKind = (params.get('kind') || 'subscription').toLowerCase();
    const kind = ['subscription', 'topup', 'recharge', 'plan_v4'].includes(rawKind) ? rawKind : 'subscription';
    const rawAmount = params.get('amount');
    const amount = rawAmount == null || rawAmount === '' ? Number.NaN : Number(rawAmount);
    return {
      kind,
      plan: params.get('plan') || 'pro',
      sku: params.get('sku') || '',
      amount: Number.isFinite(amount) ? amount : 20,
      label: params.get('label') || '',
      desc: params.get('desc') || '',
      email: params.get('email') || '',
    };
  }

  function resolveSelectionText(sel) {
    const planLabel = PLAN_LABELS[sel.plan] || sel.plan || 'Pro';
    let summaryName = `订阅 ${planLabel}`;
    let interval = '每月';
    let billing = '按月收费';
    let lineName = sel.label || planLabel;

    if (sel.kind === 'plan_v4') {
      summaryName = `订阅 ${planLabel} 套餐`;
      lineName = sel.label || `${planLabel} 套餐`;
    } else if (sel.kind === 'recharge') {
      summaryName = '按量充值';
      interval = '一次性';
      billing = '一次性付款';
      lineName = sel.label || '按量充值';
    } else if (sel.kind === 'topup') {
      summaryName = sel.label || '加油包';
      interval = '一次性';
      billing = '一次性付款';
      lineName = sel.label || '加油包';
    }

    return {
      summaryName,
      interval,
      billing,
      lineName,
      amount: formatCurrency(sel.amount),
    };
  }

  function ensureStyles() {
    if (q('#nexusv-checkout-style')) return;
    const style = document.createElement('style');
    style.id = 'nexusv-checkout-style';
    style.textContent = `
      .nexusv-method-picker{display:flex;gap:10px;flex-wrap:wrap;width:100%}
      .nexusv-method-pill{appearance:none;border:1px solid rgba(17,24,39,.14);border-radius:999px;background:#fff;color:#111827;display:inline-flex;align-items:center;gap:8px;justify-content:center;padding:10px 14px;min-width:126px;font:inherit;font-weight:600;cursor:pointer;transition:border-color .18s ease,background-color .18s ease,box-shadow .18s ease,transform .18s ease}
      .nexusv-method-pill img{width:18px;height:18px;object-fit:contain;flex:none}
      .nexusv-method-pill:hover{transform:translateY(-1px);border-color:#1677ff}
      .nexusv-method-pill.is-active{border-color:#1677ff;background:rgba(22,119,255,.08);box-shadow:0 0 0 2px rgba(22,119,255,.08) inset}
      .nexusv-payment-preview{margin:32px auto 0;max-width:320px;width:calc(100% - 32px);border:1px solid rgba(17,24,39,.12);border-radius:24px;background:#fff;padding:18px;box-sizing:border-box;box-shadow:0 1px 4px rgba(0,0,0,.04)}
      .nexusv-payment-preview__title{font-size:14px;line-height:1.4;font-weight:700;color:#111827}
      .nexusv-payment-preview__meta{margin-top:6px;font-size:12px;line-height:1.4;color:#6b7280}
      .nexusv-payment-preview__frame{position:relative;margin-top:14px;min-height:220px;border-radius:20px;overflow:hidden;background:linear-gradient(180deg,#f8fafc 0%,#eef2f7 100%);display:flex;align-items:center;justify-content:center}
      .nexusv-payment-preview__image{position:relative;z-index:1;display:block;width:100%;height:100%;object-fit:contain}
      .nexusv-payment-preview__skeleton{position:absolute;inset:0;z-index:0;background:linear-gradient(90deg,rgba(255,255,255,.0) 0%,rgba(255,255,255,.85) 50%,rgba(255,255,255,.0) 100%);background-size:200% 100%;animation:nexusv-shimmer 1.1s linear infinite;opacity:1}
      .nexusv-payment-preview.is-ready .nexusv-payment-preview__skeleton{display:none}
      .nexusv-payment-preview__foot{margin-top:10px;font-size:12px;line-height:1.45;color:#6b7280}
      .nexusv-payment-preview.is-error .nexusv-payment-preview__foot{color:#dc2626}
      .nexusv-submit-status{margin-top:12px;margin-bottom:10px;font-size:13px;line-height:1.45}
      .nexusv-submit-status.is-success{color:#16a34a}
      .nexusv-submit-status.is-error{color:#dc2626}
      .nexusv-submit-status.is-info{color:#4b5563}
      /* 修复：提交状态与下方"授权"文字间距 */
      .ConfirmPayment-PostSubmit{
        margin:18px 0 44px !important;
        padding-bottom:8px !important
      }
      .ConfirmPayment-PostSubmit .B4eU5jRx__ConfirmTerms{
        line-height:1.55
      }
      .ConfirmPayment-PostSubmit .D_NDnqWc__ConfirmTerms--item{
        word-break:break-word
      }
      .App-Footer{
        margin-top:24px !important
      }
      /* 修复：复选框勾标居中 + 选中态 */
      .Checkbox-Input:checked ~ .Checkbox-StyledInput{
        display:flex;align-items:center;justify-content:center;
        background-color:#1677ff;border-color:#1677ff;color:#fff;
      }
      .Checkbox-Input:checked ~ .Checkbox-StyledInput .Checkbox-tickSvg{
        display:block;
        width:calc(var(--checkout-checkbox-height) * 0.85);
        height:calc(var(--checkout-checkbox-height) * 0.85);
      }
      /* 必填项红色星号 */
      .nexusv-required-mark{color:#dc2626;font-weight:700;margin-left:2px}
      /* 提交按钮：必填通过后文字提亮 */
      .SubmitButton.nexusv-submit-ready .SubmitButton-Text--current{
        color:#ffffff !important;
        opacity:1 !important;
        font-weight:800 !important;
        letter-spacing:.02em;
        text-shadow:0 1px 2px rgba(0,0,0,.25),0 0 8px rgba(255,255,255,.12);
      }
      /* 必填未通过时文字偏暗 */
      .SubmitButton:not(.nexusv-submit-ready) .SubmitButton-Text--current{
        color:rgba(255,255,255,.55) !important;
        font-weight:500 !important;
      }
      @keyframes nexusv-shimmer{0%{background-position:0 0}100%{background-position:-200% 0}}
    `;
    document.head.appendChild(style);
  }

  function setText(selector, value, root = document) {
    const node = q(selector, root);
    if (node) node.textContent = value;
  }

  function setButtonProcessing(button, processing) {
    if (!button) return;
    button.disabled = processing;
    const processingLabel = q('[data-testid="submit-button-processing-label"]', button);
    const currentLabel = q('.SubmitButton-Text--current', button);
    if (processing) {
      button.classList.add('SubmitButton--processing');
      if (processingLabel) processingLabel.setAttribute('aria-hidden', 'false');
      if (currentLabel) currentLabel.setAttribute('aria-hidden', 'true');
    } else {
      button.classList.remove('SubmitButton--processing');
      if (processingLabel) processingLabel.setAttribute('aria-hidden', 'true');
      if (currentLabel) currentLabel.setAttribute('aria-hidden', 'false');
    }
  }

  function getSessionEmail() {
    return state.session?.user?.email || state.selection?.email || safeLocalStorageGet('checkout_email') || DEFAULT_EMAIL;
  }

  async function callGateway(endpoint, payload) {
    if (!window.PlatformAuth) throw new Error('supabase_not_loaded');
    const session = state.session || await window.PlatformAuth.requireSession({ timeoutMs: 6000 });
    if (!session) return null;

    const resp = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: window.__SUPABASE_ANON_KEY__ || '',
      },
      body: JSON.stringify({ endpoint, ...(payload || {}), __auth_token: session.access_token }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.message || data.error || resp.statusText || 'request_failed');
    return data;
  }

  function renderSummary(sel) {
    const meta = resolveSelectionText(sel);
    document.title = 'NexusV AI Team.';

    setText('[data-testid="product-summary-name"]', meta.summaryName);
    setText('[data-testid="product-summary-total-amount"] .CurrencyAmount', meta.amount);
    setText('[data-testid="product-summary-total-amount"] .ProductSummaryTotalAmount-billingInterval', meta.interval);
    setText('[data-testid="line-item-product-name"] .ExpandableText', meta.lineName);
    setText('[data-testid="line-item-billing-interval"]', meta.billing);
    setText('[data-testid="line-item-total-amount"] .CurrencyAmount', meta.amount);
    setText('[data-testid="order-details-footer-subtotal-amount"] .CurrencyAmount', meta.amount);
    setText('#OrderDetails-TotalAmount', meta.amount);
  }

  function renderEmail() {
    const node = q('.App-Global-Fields .ReadOnlyFormField-title') || q('.ReadOnlyFormField-title');
    if (node) node.textContent = getSessionEmail();
  }

  function renderCountrySelect() {
    const select = el('billingCountry');
    if (!select) return;
    const saved = safeLocalStorageGet('checkout_country');
    if (saved && select.querySelector(`option[value="${saved}"]`)) {
      select.value = saved;
    } else if (select.querySelector('option[value="GB"]')) {
      select.value = 'GB';
    }
    select.addEventListener('change', () => {
      state.userTouched.country = true;
      safeLocalStorageSet('checkout_country', select.value);
    });
  }

  // 自动获取浏览器出口 IP，回填国家 + 地址（用户已手动改过的不覆盖）
  async function autoFillGeo() {
    const select = el('billingCountry');
    const addressInput = el('billingAddressLine1');

    // 多源兜底，任一成功即用；适应不同网络环境（墙内/外、CORS 差异）
    const sources = [
      'https://ipapi.co/json/',
      'https://ip.useragentinfo.com/json',
      'https://ipinfo.io/json',
      'https://api.ip.sb/geoip',
    ];
    let geo = null;
    for (const url of sources) {
      if (geo) break;
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 4000);
        const resp = await fetch(url, { signal: ctrl.signal });
        clearTimeout(timer);
        if (resp.ok) {
          const data = await resp.json();
          if (data && (data.ip || data.query) && (data.country || data.country_code)) {
            geo = data;
          }
        }
      } catch {
        // 单源失败静默，试下一个
      }
    }
    if (!geo) return;

    // 字段名归一化（不同 API 字段名不同）
    const countryCode = String(geo.country_code || geo.country || '').toUpperCase();
    const ip = geo.ip || geo.query || '';
    const city = geo.city || geo.region || geo.regionName || '';
    const region = geo.region || geo.regionName || geo.province || '';

    // 国家：未手动改过才自动选中
    if (select && !state.userTouched.country && countryCode) {
      if (select.querySelector(`option[value="${countryCode}"]`)) {
        select.value = countryCode;
        safeLocalStorageSet('checkout_country', countryCode);
      }
    }

    // 地址：未手动改过才自动写入 IP（含城市/省份补充）
    if (addressInput && !state.userTouched.address) {
      const parts = [ip, city, region].filter(Boolean);
      if (parts.length) {
        addressInput.value = parts.join(', ');
        // 移除 Stripe 静态 HTML 残留的空状态 class，确保文字可见
        addressInput.classList.remove('Input--empty');
        // 通知任何监听 input 的控制器
        addressInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
  }

  function updateAmountField() {
    const input = el('cardNumber');
    if (!input || !state.selection) return;
    const editable = state.selection.kind === 'recharge' || (state.selection.kind === 'topup' && state.selection.sku === 'topup_custom');
    input.readOnly = !editable;
    input.required = editable;
    input.inputMode = 'decimal';
    input.autocomplete = 'off';
    input.setAttribute('aria-label', editable ? '充值金额' : '订单金额');
    input.placeholder = editable ? '充值金额，如果是投量可以调整，' : '订单金额';
    input.value = editable ? '' : formatAmount(state.selection.amount);
    input.setCustomValidity('');
  }

  function updateContactFieldHints() {
    const qqInput = el('cardExpiry');
    if (qqInput) {
      qqInput.setAttribute('aria-label', 'QQ号');
      qqInput.placeholder = 'QQ号';
      qqInput.autocomplete = 'off';
      qqInput.inputMode = 'numeric';
      qqInput.pattern = '[0-9]{5,15}';
    }

    const wechatInput = el('cardCvc');
    if (wechatInput) {
      wechatInput.setAttribute('aria-label', '微信号');
      wechatInput.placeholder = '微信号';
      wechatInput.autocomplete = 'off';
      wechatInput.pattern = '\\S{2,64}';
    }

    const noteInput = el('billingName');
    if (noteInput) {
      noteInput.setAttribute('aria-label', '备注内容');
      noteInput.placeholder = '备注内容';
    }

    const addressInput = el('billingAddressLine1');
    if (addressInput) {
      addressInput.setAttribute('aria-label', '地址');
      addressInput.placeholder = '自动获取浏览器IP填写，未获取到可手动填写';
      addressInput.addEventListener('input', () => {
        state.userTouched.address = true;
      });
    }
  }

  function updateOrderCardHeading() {
    const label = q('label[for="cardForm-fieldset"] span');
    if (!label || !state.selection) return;
    label.textContent = state.selection.kind === 'recharge' ? '充值信息' : '订单信息';
  }

  function ensureStatusNode(form) {
    let node = el('nexusv-submit-status');
    if (node) return node;
    node = document.createElement('div');
    node.id = 'nexusv-submit-status';
    node.className = 'nexusv-submit-status is-info';
    node.setAttribute('role', 'status');
    node.setAttribute('aria-live', 'polite');
    const button = q('button[type="submit"]', form);
    if (button && button.parentNode) {
      button.parentNode.insertBefore(node, button);
    } else {
      form.appendChild(node);
    }
    return node;
  }

  function setStatus(message, kind = 'info') {
    const node = el('nexusv-submit-status');
    if (!node) return;
    node.className = `nexusv-submit-status is-${kind}`;
    node.textContent = message || '';
  }

  function buildMethodButton(method, active) {
    const meta = METHOD_META[method];
    return `
      <button type="button" class="nexusv-method-pill${active ? ' is-active' : ''}" data-method="${method}" role="radio" aria-checked="${active ? 'true' : 'false'}">
        <img src="${meta.icon}" alt="" aria-hidden="true">
        <span>${meta.label}</span>
      </button>
    `;
  }

  function ensureMethodPicker() {
    const label = el('payment-method-label-card');
    if (!label) return null;
    const titleRow = label.closest('.PaymentMethodFormAccordionItemTitle');
    if (!titleRow) return null;
    if (titleRow.dataset.nexusvMethodPickerMounted === '1') return titleRow;

    titleRow.dataset.nexusvMethodPickerMounted = '1';
    titleRow.innerHTML = `
      <div class="nexusv-method-picker" role="radiogroup" aria-label="支付方式">
        ${METHOD_ORDER.map((method) => buildMethodButton(method, method === state.method)).join('')}
      </div>
    `;

    qa('[data-method]', titleRow).forEach((button) => {
      button.addEventListener('click', () => {
        setMethod(button.getAttribute('data-method') || DEFAULT_METHOD);
      });
    });

    return titleRow;
  }

  function ensurePreviewShell() {
    let shell = el('nexusv-payment-preview');
    if (shell) return shell;
    const overview = q('.App-Overview');
    if (!overview) return null;
    shell = document.createElement('section');
    shell.id = 'nexusv-payment-preview';
    shell.className = 'nexusv-payment-preview is-loading';
    shell.innerHTML = `
      <div class="nexusv-payment-preview__title">付款码</div>
      <div class="nexusv-payment-preview__meta" data-testid="payment-preview-meta"></div>
      <div class="nexusv-payment-preview__frame">
        <div class="nexusv-payment-preview__skeleton"></div>
        <img class="nexusv-payment-preview__image" alt="" />
      </div>
      <div class="nexusv-payment-preview__foot" data-testid="payment-preview-foot">请选择支付方式后显示对应收款码</div>
    `;
    overview.appendChild(shell);
    return shell;
  }

  function updatePreview() {
    if (!state.selection) return;
    const shell = ensurePreviewShell();
    if (!shell) return;
    const meta = METHOD_META[state.method] || METHOD_META[DEFAULT_METHOD];
    const img = q('img', shell);
    const metaNode = q('[data-testid="payment-preview-meta"]', shell);
    const footNode = q('[data-testid="payment-preview-foot"]', shell);

    shell.classList.remove('is-error');
    shell.classList.add('is-loading');
    if (metaNode) {
      metaNode.textContent = state.selection.kind === 'recharge'
        ? `按量充值 · ${formatCurrency(state.selection.amount)}`
        : `${resolveSelectionText(state.selection).summaryName} · ${resolveSelectionText(state.selection).amount}`;
    }
    if (footNode) footNode.textContent = meta.hint;
    if (img) {
      img.onload = () => {
        shell.classList.remove('is-loading', 'is-error');
        shell.classList.add('is-ready');
      };
      img.onerror = () => {
        shell.classList.remove('is-loading', 'is-ready');
        shell.classList.add('is-error');
        if (footNode) footNode.textContent = `${meta.label}收款码加载失败，请切换支付方式或重试。`;
      };
      img.alt = `${meta.label}收款码`;
      img.src = meta.qr;
    }
  }

  function updateMethodButtons() {
    const picker = q('.nexusv-method-picker');
    if (!picker) return;
    qa('[data-method]', picker).forEach((button) => {
      const method = button.getAttribute('data-method') || DEFAULT_METHOD;
      const active = method === state.method;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-checked', active ? 'true' : 'false');
    });
  }

  function setMethod(method) {
    const next = METHOD_META[method] ? method : DEFAULT_METHOD;
    state.method = next;
    safeLocalStorageSet('checkout_payment_method', next);
    updateMethodButtons();
    updatePreview();
  }

  function cleanupSnapshotLinks() {
    const backLink = q('.NTVCZeIn__BusinessLink');
    if (backLink) {
      backLink.href = state.selection?.kind === 'recharge' ? 'chat/api/billing.html' : 'chat/pricing.html';
      backLink.setAttribute('aria-label', '返回 NexusV AI Team.');
      backLink.setAttribute('title', 'NexusV AI Team.');
      const img = q('img', backLink);
      if (img) img.alt = 'NexusV AI Team icon';
    }

    qa('a[href]').forEach((anchor) => {
      const href = anchor.getAttribute('href') || '';
      if (/^https:\/\/(cognition\.com|stripe\.com)\//i.test(href)) {
        anchor.href = '#';
        anchor.removeAttribute('target');
        anchor.removeAttribute('rel');
      }
    });
  }

  function getContactValue(input) {
    return input ? input.value.trim() : '';
  }

  function clearContactValidity(inputs) {
    inputs.forEach((input) => input && input.setCustomValidity(''));
  }

  function validateForm(selection) {
    const amountInput = el('cardNumber');
    const qqInput = el('cardExpiry');
    const wechatInput = el('cardCvc');
    const termsInput = el('termsOfServiceConsentCheckbox');
    const inputs = [amountInput, qqInput, wechatInput];
    clearContactValidity(inputs);

    const qq = getContactValue(qqInput);
    const wechatId = getContactValue(wechatInput);
    const editableAmount = selection.kind === 'recharge' || (selection.kind === 'topup' && selection.sku === 'topup_custom');
    const amountText = getContactValue(amountInput);

    if (editableAmount) {
      const amount = Number(amountText);
      if (!Number.isFinite(amount) || amount < 1 || amount > 2000) {
        if (amountInput) amountInput.setCustomValidity('请输入 1 - 2000 之间的有效金额。');
      }
    }

    const qqValid = !qq || /^[0-9]{5,15}$/.test(qq);
    const wechatValid = !wechatId || (wechatId.length >= 2 && !/\s/.test(wechatId));

    if (qq && !qqValid && qqInput) qqInput.setCustomValidity('QQ 号必须是 5-15 位纯数字。');
    if (wechatId && !wechatValid && wechatInput) wechatInput.setCustomValidity('微信号至少 2 位且不能包含空格。');
    if (!qq && !wechatId) {
      const message = '请至少填写 QQ 号或微信号其一。';
      if (qqInput) qqInput.setCustomValidity(message);
      if (wechatInput) wechatInput.setCustomValidity(message);
    }

    if (termsInput && !termsInput.checked) {
      termsInput.setCustomValidity('请先勾选条款同意。');
    } else if (termsInput) {
      termsInput.setCustomValidity('');
    }

    const form = qqInput ? qqInput.form : null;
    const ok = !!form && typeof form.reportValidity === 'function' ? form.reportValidity() : true;
    return ok;
  }

  function getOrderPayload(selection) {
    const email = getSessionEmail();
    const amountInput = el('cardNumber');
    const qqInput = el('cardExpiry');
    const wechatInput = el('cardCvc');
    const noteInput = el('billingName');
    const payload = {
      email,
      method: state.method,
      order_kind: selection.kind,
    };

    const qq = getContactValue(qqInput);
    const wechat_id = getContactValue(wechatInput);
    const user_note = getContactValue(noteInput);

    if (qq) payload.qq = qq;
    if (wechat_id) payload.wechat_id = wechat_id;
    if (user_note) payload.user_note = user_note;

    if (selection.kind === 'subscription' || selection.kind === 'plan_v4') {
      payload.plan_code = selection.plan || 'pro';
    }

    if (selection.kind === 'topup') {
      payload.topup_sku = selection.sku || 'topup_custom';
      if (payload.topup_sku === 'topup_custom' && amountInput) {
        payload.amount_cny = Number(amountInput.value);
      }
    }

    if (selection.kind === 'recharge') {
      payload.amount_cny = Number(amountInput ? amountInput.value : NaN);
    }

    return payload;
  }

  function updateSubmitLabel() {
    const button = q('button[type="submit"]');
    if (!button) return;
    const currentLabel = q('.SubmitButton-Text--current', button);
    if (!currentLabel) return;
    const text = state.selection?.kind === 'recharge'
      ? '支付并充值'
      : state.selection?.kind === 'topup'
        ? '支付并购买'
        : '支付并订阅';
    currentLabel.textContent = text;
  }

  // 给必填项 label 追加红色 * 标记
  function markRequiredFields() {
    const targets = [
      'label[for="cardForm-fieldset"] span',   // 银行卡信息（QQ/微信至少一项）
      'label[for="termsOfServiceConsentCheckbox"] .Checkbox-Label', // 条款同意
    ];
    targets.forEach((sel) => {
      const node = q(sel);
      if (node && !node.querySelector('.nexusv-required-mark')) {
        const mark = document.createElement('span');
        mark.className = 'nexusv-required-mark';
        mark.textContent = ' *';
        node.appendChild(mark);
      }
    });
  }

  // 静默检查必填项是否全部通过（不触发 reportValidity 弹泡）
  function checkRequiredValid() {
    if (!state.selection) return false;
    const qqInput = el('cardExpiry');
    const wechatInput = el('cardCvc');
    const termsInput = el('termsOfServiceConsentCheckbox');
    const amountInput = el('cardNumber');

    const qq = getContactValue(qqInput);
    const wechatId = getContactValue(wechatInput);
    const editableAmount = state.selection.kind === 'recharge' || (state.selection.kind === 'topup' && state.selection.sku === 'topup_custom');

    // QQ/微信至少一项
    const hasContact = !!(qq || wechatId);
    const qqValid = !qq || /^[0-9]{5,15}$/.test(qq);
    const wechatValid = !wechatId || (wechatId.length >= 2 && !/\s/.test(wechatId));
    const contactOk = hasContact && qqValid && wechatValid;

    // 金额（可编辑时）
    let amountOk = true;
    if (editableAmount && amountInput) {
      const amount = Number(getContactValue(amountInput));
      amountOk = Number.isFinite(amount) && amount >= 1 && amount <= 2000;
    }

    // 条款
    const termsOk = !termsInput || termsInput.checked;

    return contactOk && amountOk && termsOk;
  }

  // 根据必填校验结果切换提交按钮提亮态
  function updateSubmitButtonState() {
    const button = q('button[type="submit"]');
    if (!button) return;
    if (state.planDowngradeBlocked) {
      button.classList.remove('nexusv-submit-ready');
      return;
    }
    if (checkRequiredValid()) {
      button.classList.add('nexusv-submit-ready');
    } else {
      button.classList.remove('nexusv-submit-ready');
    }
  }

  function bindSubmit(form) {
    const button = q('button[type="submit"]', form);
    if (!button) return;
    setButtonProcessing(button, false);
    updateSubmitLabel();
    markRequiredFields();
    updateSubmitButtonState();

    // 监听必填字段变化，实时更新按钮提亮态
    const watched = ['cardExpiry', 'cardCvc', 'cardNumber', 'termsOfServiceConsentCheckbox'];
    watched.forEach((id) => {
      const node = el(id);
      if (!node) return;
      const evt = node.type === 'checkbox' ? 'change' : 'input';
      node.addEventListener(evt, updateSubmitButtonState);
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      setStatus('', 'info');

      if (state.planDowngradeBlocked) {
        setStatus('当前套餐仍在有效期内，不能换购更低档套餐。', 'error');
        return;
      }
      if (!validateForm(state.selection)) return;
      if (button.disabled) return;

      setButtonProcessing(button, true);
      setStatus('正在提交订单，请稍候…', 'info');
      try {
        const res = await callGateway('submit_payment_order', getOrderPayload(state.selection));
        const order = res && res.order ? res.order : null;
        const orderId = order && (order.id || order.order_id) ? (order.id || order.order_id) : '—';
        setStatus(`订单已提交：${orderId}。请等待管理员审批。`, 'success');
        if (orderId !== '—') safeLocalStorageSet('checkout_last_order_id', String(orderId));
      } catch (err) {
        setStatus(err && err.message ? err.message : '提交失败，请稍后重试。', 'error');
      } finally {
        setButtonProcessing(button, false);
        updateSubmitLabel();
      }
    });
  }

  // plan_v4 升级按天折价：以 server 报价（plan_v4_status.catalog[].quote）覆盖 URL 金额。
  async function refreshPlanQuote() {
    const sel = state.selection;
    if (!sel || sel.kind !== 'plan_v4') return;
    try {
      const data = await callGateway('plan_v4_status', {});
      const cat = (data && Array.isArray(data.catalog) ? data.catalog : []).find((c) => c.plan_code === sel.plan);
      const quote = cat && cat.quote;
      if (quote && quote.downgrade_not_allowed) {
        setStatus('当前套餐仍在有效期内，不能换购更低档套餐。', 'error');
        state.planDowngradeBlocked = true;
        const submitBtn = q('button[type="submit"]');
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.classList.remove('nexusv-submit-ready');
        }
        return;
      }
      if (quote && Number.isFinite(Number(quote.pay_price_cny)) && Number(quote.pay_price_cny) !== sel.amount) {
        sel.amount = Number(quote.pay_price_cny);
        renderSummary(sel);
        updateAmountField();
        if (Number(quote.credit_cny) > 0) {
          setStatus(`升级已按旧套餐剩余天数折抵 ¥${formatAmount(quote.credit_cny)}，实付 ¥${formatAmount(sel.amount)}。`, 'info');
        }
      }
    } catch (err) { /* 报价失败回落 URL 金额；server 下单仍按 RPC 报价裁决 */ }
  }

  async function init() {
    ensureStyles();
    state.selection = readSelection();
    state.method = METHOD_META[safeLocalStorageGet('checkout_payment_method')] ? safeLocalStorageGet('checkout_payment_method') : DEFAULT_METHOD;

    if (!window.PlatformAuth) {
      document.title = 'NexusV AI Team.';
      setStatus('依赖脚本加载失败，请检查网络后刷新。', 'error');
      return;
    }

    try {
      state.session = await window.PlatformAuth.requireSession({ timeoutMs: 6000 });
      if (!state.session) return;

      renderSummary(state.selection);
      renderEmail();
      renderCountrySelect();
      updateAmountField();
      updateContactFieldHints();
      updateOrderCardHeading();
      cleanupSnapshotLinks();
      ensureMethodPicker();
      setMethod(state.method);
      updatePreview();

      const form = el('payment-form');
      if (form) {
        ensureStatusNode(form);
        bindSubmit(form);
      }

      const noteInput = el('billingName');
      if (noteInput && !noteInput.value) noteInput.value = '';

      // 异步自动填充 IP/国家，不阻塞提交表单渲染
      autoFillGeo();

      // plan_v4：拉 server 报价（升级按天折价），用实付价刷新订单摘要
      refreshPlanQuote();
    } catch (err) {
      if (err && err.message === 'supabase_not_loaded') {
        window.PlatformAuth.showAuthError('依赖脚本加载失败，请检查网络后刷新。');
        return;
      }
      if (err && err.message === 'not_logged_in') {
        window.PlatformAuth.redirectToLogin();
        return;
      }
      window.PlatformAuth.showAuthError('初始化失败，请刷新重试。');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
