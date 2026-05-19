const GW = window.__SUPABASE_URL__ + '/functions/v1/windsurf-shop';
const $ = (id) => document.getElementById(id);

function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = String(s == null ? '' : s);
  return d.innerHTML;
}

function showToast(msg, isError) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast' + (isError ? ' error' : '');
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => t.classList.remove('show'), 3000);
}

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

async function doQuery() {
  const orderId = $('queryOrderId').value.trim();
  const buyerToken = $('queryToken').value.trim();
  if (!orderId || !buyerToken) { showToast('请填写订单号和查询密钥', true); return; }

  const btn = $('queryBtn');
  btn.disabled = true; btn.textContent = '查询中...';

  try {
    const resp = await fetch(GW, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: 'get_order', order_id: orderId, buyer_token: buyerToken }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.message || data.error || '查询失败');

    const o = data.order;
    const el = $('resultCard');
    el.className = 'result-card show ' + o.status;

    let html = '';
    if (o.status === 'pending') {
      html = '<h3>⏳ 待审核</h3><p>已提交，请扫码付款后等待人工审核。</p>';
    } else if (o.status === 'approved') {
      html = '<h3>✓ 已发货</h3>' +
        '<div class="cred-row"><span class="cred-label">账号</span><span class="cred-value">' + escHtml(o.delivered_email) + '</span></div>' +
        '<div class="cred-row"><span class="cred-label">密码</span><span class="cred-value">' + escHtml(o.delivered_password) + '</span></div>' +
        (o.delivered_note ? '<p class="meta-text">备注：' + escHtml(o.delivered_note) + '</p>' : '') +
        '<p class="meta-text">发货时间：' + fmtTime(o.reviewed_at) + '</p>' +
        '<p class="meta-text">首登质保：首次登录如不可用，请保留订单号联系处理。</p>';
    } else if (o.status === 'rejected') {
      html = '<h3>✗ 已拒绝</h3><p>' + escHtml(o.admin_note || '未通过审核') + '</p>';
    }
    html += '<p class="meta-text">下单时间：' + fmtTime(o.created_at) + '</p>';
    el.innerHTML = html;
  } catch (err) {
    showToast(err.message || '查询失败', true);
    $('resultCard').className = 'result-card';
  } finally {
    btn.disabled = false; btn.textContent = '查询订单';
  }
}

function renderHistory() {
  try {
    const saved = JSON.parse(localStorage.getItem('ws_orders') || '[]');
    if (saved.length === 0) return;
    const el = $('historyList');
    let html = '<h2>历史订单</h2>';
    saved.forEach(o => {
      const ts = o.created ? new Date(o.created).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '';
      html += '<div class="history-item" data-oid="' + escHtml(o.order_id) + '" data-token="' + escHtml(o.buyer_token) + '">' +
        '<span class="oid">' + escHtml(o.order_id) + '</span>' +
        '<span class="ts">' + ts + '</span></div>';
    });
    el.innerHTML = html;

    el.addEventListener('click', (ev) => {
      const item = ev.target.closest('.history-item');
      if (!item) return;
      $('queryOrderId').value = item.dataset.oid;
      $('queryToken').value = item.dataset.token;
      doQuery();
    });
  } catch (e) { /* ignore */ }
}

$('queryBtn').addEventListener('click', doQuery);
renderHistory();

const params = new URLSearchParams(location.search);
if (params.get('id')) $('queryOrderId').value = params.get('id');
if (params.get('token')) $('queryToken').value = params.get('token');
if (params.get('id') && params.get('token')) doQuery();
