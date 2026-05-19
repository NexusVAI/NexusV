// shop-app.js — Windsurf Shop 前端逻辑
// 处理订单提交 + 订单查询

const GW = window.__SUPABASE_URL__ + '/functions/v1/windsurf-shop';
const $ = (id) => document.getElementById(id);
let currentProduct = null;

function showToast(msg, isError) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast' + (isError ? ' error' : '');
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => t.classList.remove('show'), 3000);
}

async function callShop(endpoint, payload) {
  const resp = await fetch(GW, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint, ...payload }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.message || data.error || 'request_failed');
  return data;
}

function formatPrice(n) {
  const value = Number(n);
  return Number.isFinite(value) ? '¥' + value : '¥--';
}

function renderProduct(product) {
  currentProduct = product || currentProduct || { price_yuan: 5, stock_count: 0, is_active: true };
  const priceText = formatPrice(currentProduct.price_yuan);
  const stock = Number(currentProduct.stock_count || 0);
  const active = currentProduct.is_active !== false;
  const badge = $('stockBadge');
  const submit = $('submitOrderBtn');

  $('productPrice').textContent = priceText;
  $('qrPrice').textContent = priceText;

  if (!active) {
    badge.textContent = '暂停销售';
    badge.className = 'stock-pill out';
    submit.disabled = true;
    submit.textContent = '暂停销售';
    return;
  }

  if (stock <= 0) {
    badge.textContent = '已售罄';
    badge.className = 'stock-pill out';
    submit.disabled = true;
    submit.textContent = '暂时售罄';
    return;
  }

  badge.textContent = stock + ' 个';
  badge.className = 'stock-pill' + (stock <= 3 ? ' low' : '');
  submit.disabled = false;
  submit.textContent = '提交订单';
}

async function loadProduct() {
  try {
    const data = await callShop('get_product', {});
    renderProduct(data.product);
  } catch {
    renderProduct({ price_yuan: 5, stock_count: 0, is_active: false });
  }
}

// ─── Submit Order ───
function bindSubmitOrder() {
  const btn = $('submitOrderBtn');
  btn.addEventListener('click', async () => {
    const contact = $('contact').value.trim();
    const contactType = $('contactType').value;
    const paymentNote = $('paymentNote').value.trim();

    if (currentProduct && (currentProduct.is_active === false || Number(currentProduct.stock_count || 0) <= 0)) {
      showToast('当前商品暂时无库存', true);
      return;
    }

    if (!contact || contact.length < 2) {
      showToast('请填写有效的联系方式', true);
      return;
    }

    btn.disabled = true;
    btn.textContent = '提交中...';

    try {
      const res = await callShop('create_order', { contact, contact_type: contactType, payment_note: paymentNote });
      $('resOrderId').textContent = res.order_id;
      $('resBuyerToken').textContent = res.buyer_token;
      $('orderResult').classList.add('show');
      $('orderQueryLink').href = './order.html?id=' + encodeURIComponent(res.order_id) + '&token=' + encodeURIComponent(res.buyer_token);

      $('queryOrderId').value = res.order_id;
      $('queryToken').value = res.buyer_token;

      try {
        const saved = JSON.parse(localStorage.getItem('ws_orders') || '[]');
        saved.unshift({ order_id: res.order_id, buyer_token: res.buyer_token, created: Date.now() });
        localStorage.setItem('ws_orders', JSON.stringify(saved.slice(0, 20)));
      } catch (e) { /* ignore */ }

      showToast('订单提交成功！请保存订单号和查询密钥');
      if (res.product) renderProduct(res.product);
      else await loadProduct();
    } catch (err) {
      showToast(err.message || '提交失败，请重试', true);
      await loadProduct();
    } finally {
      if (currentProduct && (currentProduct.is_active === false || Number(currentProduct.stock_count || 0) <= 0)) {
        renderProduct(currentProduct);
      } else {
        btn.disabled = false;
        btn.textContent = '提交订单';
      }
    }
  });
}

// ─── Query Order ───
function bindQueryOrder() {
  const btn = $('queryOrderBtn');
  btn.addEventListener('click', async () => {
    const orderId = $('queryOrderId').value.trim();
    const buyerToken = $('queryToken').value.trim();

    if (!orderId || !buyerToken) {
      showToast('请填写订单号和查询密钥', true);
      return;
    }

    btn.disabled = true;
    btn.textContent = '查询中...';

    try {
      const res = await callShop('get_order', { order_id: orderId, buyer_token: buyerToken });
      const order = res.order;
      const el = $('queryResult');
      el.className = 'query-result show ' + order.status;

      if (order.status === 'pending') {
        el.innerHTML = '<p><strong>⏳ 订单待审核</strong></p><p>付款后请耐心等待人工审核。</p>';
      } else if (order.status === 'approved') {
        el.innerHTML =
          '<p><strong>✓ 已发货</strong></p>' +
          '<div class="cred-row"><span class="cred-label">账号：</span><span class="cred-value">' + escHtml(order.delivered_email) + '</span></div>' +
          '<div class="cred-row"><span class="cred-label">密码：</span><span class="cred-value">' + escHtml(order.delivered_password) + '</span></div>' +
          (order.delivered_note ? '<p style="margin-top:8px;color:var(--ink-2);font-size:12px;">备注：' + escHtml(order.delivered_note) + '</p>' : '');
      } else if (order.status === 'rejected') {
        el.innerHTML = '<p><strong>✗ 订单被拒绝</strong></p><p>' + escHtml(order.admin_note || '未通过审核') + '</p>';
      }
    } catch (err) {
      showToast(err.message || '查询失败', true);
      $('queryResult').className = 'query-result';
    } finally {
      btn.disabled = false;
      btn.textContent = '查询';
    }
  });
}

function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = String(s == null ? '' : s);
  return d.innerHTML;
}

// ─── Init ───
function init() {
  loadProduct();
  bindSubmitOrder();
  bindQueryOrder();

  try {
    const saved = JSON.parse(localStorage.getItem('ws_orders') || '[]');
    if (saved.length > 0) {
      $('queryOrderId').value = saved[0].order_id || '';
      $('queryToken').value = saved[0].buyer_token || '';
    }
  } catch (e) { /* ignore */ }
}

init();
