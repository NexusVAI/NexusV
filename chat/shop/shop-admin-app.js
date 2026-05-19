// shop-admin-app.js — Windsurf Shop 管理员后台逻辑

const sb = window.supabase.createClient(
  window.__SUPABASE_URL__,
  window.__SUPABASE_ANON_KEY__,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: 'cancri_supabase_auth',
    },
  },
);
const GW = window.__SUPABASE_URL__ + '/functions/v1/windsurf-shop';

let cachedOrders = [];
let cachedProduct = null;
let currentFilter = '';

const $ = (id) => document.getElementById(id);

function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = String(s == null ? '' : s);
  return d.innerHTML;
}

function showToast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast';
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => t.classList.remove('show'), 2500);
}

function fmtTime(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

function formatPrice(n) {
  const value = Number(n);
  return Number.isFinite(value) ? '¥' + value : '-';
}

async function getSession() {
  const { data: { session } } = await sb.auth.getSession();
  return session;
}

async function callGW(endpoint, payload) {
  const session = await getSession();
  if (!session) throw new Error('not_logged_in');
  const resp = await fetch(GW, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: window.__SUPABASE_ANON_KEY__ },
    body: JSON.stringify({ endpoint, ...(payload || {}), __auth_token: session.access_token }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.message || data.error || 'request_failed');
  return data;
}

// ─── Stats ───
function updateStats() {
  const counts = { pending: 0, approved: 0, rejected: 0 };
  cachedOrders.forEach(o => { if (counts[o.status] !== undefined) counts[o.status]++; });
  $('statPending').textContent = counts.pending;
  $('statApproved').textContent = counts.approved;
  $('statRejected').textContent = counts.rejected;
  $('statTotal').textContent = cachedOrders.length;
}

function renderProduct(product) {
  cachedProduct = product || cachedProduct;
  if (!cachedProduct) return;
  $('productTitle').textContent = cachedProduct.title || 'Windsurf $200 Pro';
  $('productPrice').textContent = formatPrice(cachedProduct.price_yuan);
  $('productStock').textContent = Number(cachedProduct.stock_count || 0) + ' 个';
  $('productActive').textContent = cachedProduct.is_active === false ? '暂停销售' : '上架中';
  $('stockInput').value = Number(cachedProduct.stock_count || 0);
  $('activeInput').checked = cachedProduct.is_active !== false;
}

async function loadProduct() {
  try {
    const data = await callGW('admin_get_product', {});
    renderProduct(data.product);
  } catch (err) {
    showToast('库存加载失败: ' + (err.message || ''));
  }
}

function bindProductActions() {
  $('refreshProductBtn').addEventListener('click', loadProduct);
  $('saveStockBtn').addEventListener('click', async () => {
    const btn = $('saveStockBtn');
    const stock = Number($('stockInput').value);
    if (!Number.isInteger(stock) || stock < 0 || stock > 999) {
      showToast('库存数量必须是 0-999 的整数');
      return;
    }

    btn.disabled = true;
    try {
      const data = await callGW('admin_update_product', {
        stock_count: stock,
        is_active: $('activeInput').checked,
      });
      renderProduct(data.product);
      showToast('库存已保存');
    } catch (err) {
      showToast('库存保存失败: ' + (err.message || ''));
    } finally {
      btn.disabled = false;
    }
  });
}

// ─── Render ───
function renderOrders() {
  const list = $('orderList');
  const filtered = currentFilter
    ? cachedOrders.filter(o => o.status === currentFilter)
    : cachedOrders;

  if (filtered.length === 0) {
    list.innerHTML = '<div class="empty">暂无订单</div>';
    return;
  }

  list.innerHTML = filtered.map(o => {
    const isPending = o.status === 'pending';
    const contactLabel = { wechat: '微信', qq: 'QQ', email: '邮箱' }[o.contact_type] || o.contact_type;

    return '<div class="order-card" data-order-id="' + escHtml(o.order_id) + '">' +
      '<div class="order-header">' +
        '<span class="order-id">' + escHtml(o.order_id) + '</span>' +
        '<span class="status-pill ' + o.status + '">' + escHtml(o.status) + '</span>' +
      '</div>' +
      '<div class="order-details">' +
        '<div>' + contactLabel + '：<strong>' + escHtml(o.contact) + '</strong></div>' +
        '<div>付款备注：<strong>' + escHtml(o.payment_note || '-') + '</strong></div>' +
        '<div>金额：<strong>¥' + (o.amount_yuan || 5) + '</strong></div>' +
        '<div>商品：<strong>Windsurf $200 Pro</strong></div>' +
        '<div>下单：<strong>' + fmtTime(o.created_at) + '</strong></div>' +
        '<div>IP：<strong>' + escHtml(o.client_ip || '-') + '</strong></div>' +
        (o.delivered_email ? '<div>已发账号：<strong>' + escHtml(o.delivered_email) + '</strong></div>' : '') +
        (o.admin_note ? '<div>备注：<strong>' + escHtml(o.admin_note) + '</strong></div>' : '') +
        (o.reviewed_at ? '<div>审核时间：<strong>' + fmtTime(o.reviewed_at) + '</strong></div>' : '') +
      '</div>' +
      (isPending ? (
        '<div class="order-actions">' +
          '<input type="text" placeholder="账号邮箱" data-field="email" />' +
          '<input type="text" placeholder="密码" data-field="password" />' +
          '<input type="text" placeholder="备注（可选）" data-field="note" />' +
          '<button class="btn-sm approve" data-action="approve">发货</button>' +
          '<button class="btn-sm reject" data-action="reject">拒绝</button>' +
        '</div>'
      ) : '') +
    '</div>';
  }).join('');
}

// ─── Event delegation ───
function bindOrderActions() {
  $('orderList').addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-action]');
    if (!btn) return;
    const card = btn.closest('.order-card');
    if (!card) return;

    const orderId = card.dataset.orderId;
    const action = btn.dataset.action;
    btn.disabled = true;

    try {
      if (action === 'approve') {
        const email = card.querySelector('[data-field="email"]').value.trim();
        const password = card.querySelector('[data-field="password"]').value.trim();
        const note = card.querySelector('[data-field="note"]').value.trim();

        if (!email || !password) {
          showToast('请填写账号和密码');
          btn.disabled = false;
          return;
        }

        await callGW('admin_approve', {
          order_id: orderId,
          delivered_email: email,
          delivered_password: password,
          delivered_note: note,
        });
        showToast('✅ 已发货: ' + orderId);
      } else if (action === 'reject') {
        const note = card.querySelector('[data-field="note"]').value.trim();
        await callGW('admin_reject', { order_id: orderId, admin_note: note || '未通过审核' });
        showToast('已拒绝: ' + orderId);
      }

      await loadOrders();
    } catch (err) {
      showToast('操作失败: ' + (err.message || ''));
      btn.disabled = false;
    }
  });
}

// ─── Filter ───
function bindFilters() {
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      renderOrders();
    });
  });
}

// ─── Load ───
async function loadOrders() {
  try {
    const data = await callGW('admin_list_orders', {});
    cachedOrders = data.orders || [];
    updateStats();
    renderOrders();
  } catch (err) {
    showToast('加载失败: ' + (err.message || ''));
  }
}

// ─── Init ───
async function init() {
  const session = await getSession();
  $('loading').style.display = 'none';

  if (!session || !session.user || session.user.is_anonymous) {
    $('loginGate').style.display = 'block';
    return;
  }

  try {
    const r = await callGW('admin_check', {});
    if (!r.is_admin) {
      $('denyGate').style.display = 'block';
      return;
    }
  } catch {
    $('denyGate').style.display = 'block';
    return;
  }

  $('mainContent').style.display = 'block';
  bindProductActions();
  bindFilters();
  bindOrderActions();
  $('refreshBtn').addEventListener('click', loadOrders);
  await loadProduct();
  await loadOrders();
}

init();
