/* ==========================================================================
   健康来敲门 Everwell · 生产交付级全栈前端引擎 (Part 1: 鉴权 / 收银台 / Web / C端核心)
   ========================================================================== */

let APP_STATE = null;
let CURRENT_TERMINAL = loadPref('ew_terminal', 'web');
let CURRENT_CAPP_TAB = loadPref('ew_capp_tab', 'home');
let CURRENT_PATIENT_ID = Number(loadPref('ew_patient_id', '1')) || 1;
let CURRENT_ESCORT_ID = Number(loadPref('ew_escort_id', '1')) || 1;
let CURRENT_ART_FILTER = loadPref('ew_art_filter', 'ALL');
let CURRENT_ADM_FILTER = loadPref('ew_adm_filter', 'ALL');

// Auth Session State (Supports Lazy Login Guest Mode + Real Bearer Tokens)
let MOBILE_TOKEN = loadPref('ew_mobile_token', '');
let MOBILE_USER = loadJsonPref('ew_mobile_user', null);
let ADMIN_TOKEN = loadPref('ew_admin_token', '');
let ADMIN_USER = loadJsonPref('ew_admin_user', null);
let LOGIN_TARGET_ROLE = 'FAMILY';
let PENDING_AFTER_LOGIN_FN = null;

// Modal Context State
let ACTIVE_CONFIRM_ORDER_ID = null;
let ACTIVE_DISPATCH_ORDER_ID = null;
let ACTIVE_STEP4_ORDER_ID = null;
let ACTIVE_CANCEL_ORDER_ID = null;
let ACTIVE_REVIEW_ORDER_ID = null;
let CURRENT_REVIEW_STAR = 5;
let SELECTED_PAY_CHANNEL = '微信支付';
let ACTIVE_CASHIER_CTX = null; // { mode: 'ORDER' | 'OVERTIME', orderId, orderNo, amount, fromWeb }
let STEP4_UPLOADED_URLS = ['/uploads/sample-lab-report.svg'];

function savePref(key, val) {
  try { window.localStorage.setItem(key, String(val)); } catch (_) {}
}

function loadPref(key, fallback) {
  try {
    const v = window.localStorage.getItem(key);
    return v !== null ? v : fallback;
  } catch (_) {
    return fallback;
  }
}

function saveJsonPref(key, obj) {
  try {
    if (!obj) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(obj));
  } catch (_) {}
}

function loadJsonPref(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (_) {
    return fallback;
  }
}

function escapeHtml(val) {
  if (val === undefined || val === null) return '';
  return String(val)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function showToast(msg, isError = false) {
  const el = document.getElementById('global-toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden', 'error');
  if (isError) el.classList.add('error');
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => el.classList.add('hidden'), 4300);
}

function updateSyncIndicator(ok, text) {
  const dot = document.getElementById('sync-dot-el');
  const label = document.getElementById('sync-status-text');
  if (!dot || !label) return;
  dot.style.background = ok ? '#34d399' : '#f87171';
  const d = new Date();
  const hhmmss = [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, '0')).join(':');
  label.textContent = text || (ok ? `SQLite 已同步 · ${hhmmss}` : '请求校验提醒');
}

async function apiRequest(path, options = {}, btnEl = null) {
  if (btnEl && btnEl.disabled) return null;
  let origHtml = '';
  if (btnEl) {
    origHtml = btnEl.innerHTML;
    btnEl.disabled = true;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8500);

  try {
    const headers = {};
    if (options.body) headers['Content-Type'] = 'application/json';
    const useToken = options.useAdminToken ? ADMIN_TOKEN : (options.token || MOBILE_TOKEN || ADMIN_TOKEN);
    if (useToken) headers['Authorization'] = `Bearer ${useToken}`;

    const res = await fetch(path, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal
    });
    const json = await res.json();
    if (!res.ok || !json.ok) {
      updateSyncIndicator(false, '参数或权限提示');
      showToast(json.msg || `操作未成功 (HTTP ${res.status})`, true);
      return null;
    }
    if (json.data) {
      APP_STATE = json.data;
      renderAll();
    }
    updateSyncIndicator(true);
    return json;
  } catch (err) {
    updateSyncIndicator(false, '网络波动保护中');
    showToast(err.name === 'AbortError' ? '请求超时，请重试' : '网络异常，页面状态已保留', true);
    return null;
  } finally {
    clearTimeout(timer);
    if (btnEl) {
      btnEl.disabled = false;
      if (document.body.contains(btnEl)) btnEl.innerHTML = origHtml;
    }
  }
}

function openModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.remove('hidden');
}

function closeModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.add('hidden');
}

document.addEventListener('click', e => {
  if (e.target && e.target.classList && e.target.classList.contains('modal-backdrop')) {
    e.target.classList.add('hidden');
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.add('hidden'));
  }
});

// ==================== Compliant Lazy Login & Auth Flows ====================
function requireMobileAuth(actionFn, role = 'FAMILY') {
  if (MOBILE_TOKEN && MOBILE_USER) {
    if (role === 'ESCORT' && MOBILE_USER.role !== 'ESCORT') {
      PENDING_AFTER_LOGIN_FN = actionFn;
      openMobileLoginModal('ESCORT');
      return false;
    }
    actionFn();
    return true;
  }
  PENDING_AFTER_LOGIN_FN = actionFn;
  openMobileLoginModal(role);
  return false;
}

function openMobileLoginModal(targetRole = 'FAMILY') {
  LOGIN_TARGET_ROLE = targetRole;
  const badge = document.getElementById('mlogin-role-badge');
  const title = document.getElementById('mlogin-title');
  const phoneInp = document.getElementById('mlogin-phone');
  if (targetRole === 'ESCORT') {
    badge.textContent = '持证陪诊师准入登录';
    title.textContent = '验证持证陪诊师备案手机号';
    phoneInp.value = '13811223344';
  } else {
    badge.textContent = 'C端家庭照护登录';
    title.textContent = '欢迎登录健康来敲门';
    phoneInp.value = '13800138000';
  }
  openModal('modal-mobile-login');
}

async function sendMobileSmsCode(btnEl) {
  const phone = document.getElementById('mlogin-phone').value.trim();
  const json = await apiRequest('/api/auth/send-code', {
    method: 'POST',
    body: { phone }
  }, btnEl);
  if (json && json.demo_code) {
    document.getElementById('mlogin-code').value = json.demo_code;
    showToast(json.msg);
  }
}

async function submitWechatQuickLogin(btnEl) {
  const agreed = document.getElementById('mlogin-privacy-chk').checked;
  if (!agreed) {
    showToast('请先阅读并手动勾选《用户服务协议》与《医疗健康敏感信息隐私政策》', true);
    return;
  }
  const defaultPhone = LOGIN_TARGET_ROLE === 'ESCORT' ? '13811223344' : '13800138000';
  const json = await apiRequest('/api/auth/mobile-login', {
    method: 'POST',
    body: {
      mode: 'wechat_quick',
      phone: defaultPhone,
      agreed_privacy: true,
      target_role: LOGIN_TARGET_ROLE
    }
  }, btnEl);
  finishMobileLogin(json);
}

async function submitSmsMobileLogin(e) {
  e.preventDefault();
  const agreed = document.getElementById('mlogin-privacy-chk').checked;
  if (!agreed) {
    showToast('请先阅读并手动勾选《用户服务协议》与《医疗健康敏感信息隐私政策》', true);
    return;
  }
  const btn = document.getElementById('mlogin-sms-btn');
  const phone = document.getElementById('mlogin-phone').value.trim();
  const code = document.getElementById('mlogin-code').value.trim();
  const json = await apiRequest('/api/auth/mobile-login', {
    method: 'POST',
    body: {
      mode: 'sms',
      phone,
      code,
      agreed_privacy: true,
      target_role: LOGIN_TARGET_ROLE
    }
  }, btn);
  finishMobileLogin(json);
}

function finishMobileLogin(json) {
  if (!json || !json.token) return;
  MOBILE_TOKEN = json.token;
  MOBILE_USER = json.user;
  savePref('ew_mobile_token', MOBILE_TOKEN);
  saveJsonPref('ew_mobile_user', MOBILE_USER);
  if (json.user.escort_id) {
    CURRENT_ESCORT_ID = Number(json.user.escort_id);
    savePref('ew_escort_id', CURRENT_ESCORT_ID);
  }
  closeModal('modal-mobile-login');
  renderAll();
  showToast(`登录成功：欢迎您，${json.user.display_name}（${json.user.masked_phone}）`);
  if (typeof PENDING_AFTER_LOGIN_FN === 'function') {
    const fn = PENDING_AFTER_LOGIN_FN;
    PENDING_AFTER_LOGIN_FN = null;
    fn();
  }
}

async function handleMobileLogout(btnEl) {
  await apiRequest('/api/auth/logout', { method: 'POST', token: MOBILE_TOKEN }, btnEl);
  MOBILE_TOKEN = '';
  MOBILE_USER = null;
  savePref('ew_mobile_token', '');
  saveJsonPref('ew_mobile_user', null);
  renderAll();
  showToast('已安全退出登录，当前处于游客浏览模式（下单或查看私密档案时将按需拉起登录）');
}

async function handleDeleteAccount(btnEl) {
  if (!MOBILE_TOKEN) {
    showToast('当前未登录账号', true);
    return;
  }
  const json = await apiRequest('/api/auth/delete-account', { method: 'POST', token: MOBILE_TOKEN }, btnEl);
  if (json) {
    MOBILE_TOKEN = '';
    MOBILE_USER = null;
    savePref('ew_mobile_token', '');
    saveJsonPref('ew_mobile_user', null);
    renderAll();
    showToast('账号及个人身份凭证已完成永久注销清理（符合 App Store 与工信部合规要求）');
  }
}

function handleHeaderUserClick() {
  if (MOBILE_USER) {
    switchCAppTab('mine');
  } else {
    openMobileLoginModal('FAMILY');
  }
}

// ==================== Cashier Payment Flow ====================
function selectPayChannel(channelName, cardEl) {
  SELECTED_PAY_CHANNEL = channelName;
  document.querySelectorAll('#cashier-channels .pay-option-card').forEach(el => {
    el.classList.remove('selected');
    el.lastElementChild.textContent = '○';
    el.lastElementChild.className = '';
  });
  cardEl.classList.add('selected');
  cardEl.lastElementChild.textContent = '✓';
  cardEl.lastElementChild.className = 'text-green';
}

function openCashierForOrder(order, fromWeb = false) {
  ACTIVE_CASHIER_CTX = {
    mode: 'ORDER',
    orderId: order.id,
    orderNo: order.order_no,
    amount: order.total_price,
    fromWeb
  };
  document.getElementById('cashier-order-desc').textContent = `陪诊预约单 #${order.order_no}（${order.hospital_name}）`;
  document.getElementById('cashier-amount-text').textContent = `¥${Number(order.total_price).toFixed(2)}`;
  openModal('modal-cashier');
}

function openCashierForOvertime(orderId) {
  const ord = APP_STATE && APP_STATE.orders.find(o => o.id === orderId);
  if (!ord) return;
  ACTIVE_CASHIER_CTX = {
    mode: 'OVERTIME',
    orderId: ord.id,
    orderNo: ord.order_no,
    amount: 100,
    fromWeb: false
  };
  document.getElementById('cashier-order-desc').textContent = `超时加钟补差价 +1小时 · #${ord.order_no}`;
  document.getElementById('cashier-amount-text').textContent = '¥100.00';
  openModal('modal-cashier');
}

async function confirmCashierPayment(btnEl) {
  if (!ACTIVE_CASHIER_CTX) return;
  const ctx = ACTIVE_CASHIER_CTX;
  if (ctx.mode === 'OVERTIME') {
    const json = await apiRequest(`/api/orders/${ctx.orderId}/add-overtime`, {
      method: 'POST',
      body: { hours: 1, pay_channel: SELECTED_PAY_CHANNEL }
    }, btnEl);
    if (json) {
      closeModal('modal-cashier');
      showToast(`【${SELECTED_PAY_CHANNEL}】超时补差价 ¥100 支付成功！账单与陪诊师分成已自动重算`);
    }
    return;
  }

  const json = await apiRequest(`/api/orders/${ctx.orderId}/pay`, {
    method: 'POST',
    body: { pay_channel: SELECTED_PAY_CHANNEL }
  }, btnEl);
  if (json && json.order) {
    closeModal('modal-cashier');
    if (ctx.fromWeb) {
      showToast(`【${SELECTED_PAY_CHANNEL}】支付成功（流水号 ${json.trade_no}）！可在后台指派陪诊师`);
      handleWebOrderLookup();
    } else {
      showToast(`【${SELECTED_PAY_CHANNEL}】支付成功！请继续完成【患者本人确认授权(+)】`);
      openPatientConfirmModalForOrder(json.order.id);
    }
  }
}

// ==================== Navigation & Global Loop ====================
function switchTerminal(termId, skipScroll = false) {
  const validTerms = ['web', 'c-app', 'b-app', 'admin'];
  const targetId = validTerms.includes(termId) ? termId : 'web';
  CURRENT_TERMINAL = targetId;
  savePref('ew_terminal', targetId);

  document.querySelectorAll('.terminal-view').forEach(el => el.classList.add('hidden'));
  const target = document.getElementById('term-' + targetId);
  if (target) target.classList.remove('hidden');

  document.querySelectorAll('.term-btn').forEach(btn => btn.classList.remove('active'));
  const activeBtn = document.getElementById('tab-btn-' + targetId);
  if (activeBtn) activeBtn.classList.add('active');

  if (targetId === 'admin') renderAdminGateState();
  if (!skipScroll) window.scrollTo({ top: 0, behavior: 'smooth' });
}

function switchCAppTab(tabId) {
  const validTabs = ['home', 'ai', 'book', 'post', 'care', 'mine'];
  const targetTab = validTabs.includes(tabId) ? tabId : 'home';
  CURRENT_CAPP_TAB = targetTab;
  savePref('ew_capp_tab', targetTab);

  document.querySelectorAll('.capp-subview').forEach(el => el.classList.add('hidden'));
  const view = document.getElementById('capp-view-' + targetTab);
  if (view) view.classList.remove('hidden');

  document.querySelectorAll('.capp-tab-btn').forEach(btn => btn.classList.remove('active'));
  const activeTab = document.getElementById('ctab-' + (targetTab === 'ai' ? 'home' : targetTab));
  if (activeTab) activeTab.classList.add('active');
}

function jumpClosedLoop(stage) {
  if (!APP_STATE) return;
  if (stage === 1) {
    switchTerminal('c-app');
    switchCAppTab('book');
  } else if (stage === 2) {
    switchTerminal('c-app');
    switchCAppTab('home');
    openPatientConfirmForLatest();
  } else if (stage === 3) {
    switchTerminal('admin');
    if (ADMIN_TOKEN) {
      const pendingOrd = APP_STATE.orders.find(o => o.sop_step === 0 && o.payment_status === 'PAID');
      if (pendingOrd) openDispatchModalForOrder(pendingOrd.id);
    }
  } else if (stage === 4) {
    const activeOrd = APP_STATE.orders.find(o => o.escort_id && o.sop_step >= 1 && o.sop_step < 5);
    if (activeOrd) {
      CURRENT_ESCORT_ID = activeOrd.escort_id;
      savePref('ew_escort_id', CURRENT_ESCORT_ID);
      renderBApp();
    }
    switchTerminal('b-app');
  } else if (stage === 5) {
    switchTerminal('c-app');
    switchCAppTab('post');
  }
}

function getCurrentPatient() {
  if (!APP_STATE || !APP_STATE.patients || !APP_STATE.patients.length) return null;
  return APP_STATE.patients.find(p => p.id === CURRENT_PATIENT_ID) || APP_STATE.patients[0];
}

function daysUntilDate(dateStr) {
  if (!dateStr) return null;
  const target = new Date(dateStr + 'T00:00:00');
  if (Number.isNaN(target.getTime())) return null;
  const todayStr = (APP_STATE && APP_STATE.todayStr) ? APP_STATE.todayStr : new Date().toISOString().slice(0, 10);
  const base = new Date(todayStr + 'T00:00:00');
  return Math.round((target.getTime() - base.getTime()) / 86400000);
}

function enforceMinTodayOnDateInputs() {
  const today = (APP_STATE && APP_STATE.todayStr) ? APP_STATE.todayStr : new Date().toISOString().slice(0, 10);
  ['wb-date', 'mb-date', 's4-recheck-date'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.min = today;
      if (el.value && el.value < today) el.value = today;
    }
  });
}

function renderAll() {
  if (!APP_STATE) return;
  enforceMinTodayOnDateInputs();
  updateGlobalBadgesAndLoop();
  renderWebPortal();
  renderCApp();
  renderBApp();
  renderAdmin();
}

function updateGlobalBadgesAndLoop() {
  const st = APP_STATE.stats;
  const activeOrders = APP_STATE.orders.filter(o => o.sop_step >= 0 && o.sop_step < 5);
  const curEscortOrders = APP_STATE.orders.filter(o => o.escort_id === CURRENT_ESCORT_ID && o.sop_step >= 1 && o.sop_step < 5);

  document.getElementById('nav-badge-capp').textContent = String(activeOrders.length);
  document.getElementById('nav-badge-bapp').textContent = String(curEscortOrders.length);
  document.getElementById('nav-badge-admin').textContent = String(st.pendingDispatchCount + (st.openAfterSaleCount || 0));

  const uncheckedMeds = Math.max(0, st.medsTotal - st.medsChecked);
  const medBadge = document.getElementById('tab-badge-meds');
  if (medBadge) {
    medBadge.textContent = String(uncheckedMeds);
    medBadge.classList.toggle('hidden', uncheckedMeds === 0);
  }

  for (let i = 1; i <= 5; i++) {
    const el = document.getElementById('loop-step-' + i);
    if (el) el.classList.remove('highlight');
  }

  let stage = 1;
  let hint = '点击任一节点直达对应交付界面';
  const latest = APP_STATE.orders.find(o => o.sop_step >= 0 && o.sop_step < 5);
  if (latest) {
    if (latest.payment_status === 'UNPAID') {
      stage = 1;
      hint = `订单 #${latest.order_no} 待收银台支付`;
    } else if (latest.patient_confirm_status !== 'CONFIRMED') {
      stage = 2;
      hint = `订单 #${latest.order_no} 已付款，请完成【② 患者本人确认(+)】`;
    } else if (latest.sop_step === 0) {
      stage = 3;
      hint = `订单 #${latest.order_no} 待派单 → 点击【③ 后台鉴权登录与派单】`;
    } else if (latest.sop_step < 4) {
      stage = 4;
      hint = `订单 #${latest.order_no} 履约第${latest.sop_step}/5步 → 点击【④ 陪诊师打卡】`;
    } else {
      stage = 5;
      hint = `订单 #${latest.order_no} 报告已出 → 点击【⑤ 查收医嘱/理赔包/评价】`;
    }
  }
  const hl = document.getElementById('loop-step-' + stage);
  if (hl) hl.classList.add('highlight');
  document.getElementById('loop-live-hint').textContent = hint;
}

// ==================== 1. Web Portal & Order Lookup ====================
function recalcWebPrice() {
  const base = Number(document.getElementById('wb-pkg').value.split('|')[0] || 288);
  const mob = Number(document.getElementById('wb-mobility').value.split('|')[0] || 80);
  document.getElementById('wb-live-price').textContent = `¥${base + mob}`;
}

function syncWebHospitalCity() {
  const sel = document.getElementById('wb-hospital');
  const opt = sel.options[sel.selectedIndex];
  const city = opt ? opt.getAttribute('data-city') : '北京';
  const pickupEl = document.getElementById('wb-pickup');
  const dropEl = document.getElementById('wb-dropoff');
  if (city === '成都' && pickupEl.value.includes('朝阳区')) {
    pickupEl.value = '成都市武侯区玉林北路12号院2单元302';
    dropEl.value = '就诊结束后安全送回武侯区玉林北路家中交接';
  }
}

function renderWebPortal() {
  const container = document.getElementById('web-articles-container');
  if (!container) return;
  container.innerHTML = APP_STATE.articles.slice(0, 4).map(art => `
    <div class="ew-card-paper flex items-center justify-between gap-3">
      <div>
        <div class="flex items-center gap-1-5 flex-wrap">
          <span class="badge badge-green">${escapeHtml(art.category)} · ${escapeHtml(art.solar_term)}</span>
          <span class="font-bold">${escapeHtml(art.title)}</span>
        </div>
        <div class="text-muted mt-1">${escapeHtml(art.summary)}</div>
      </div>
      <button type="button" onclick="openArticleDetail(${Number(art.id)})" class="btn-soft whitespace-nowrap">详情/约陪诊 →</button>
    </div>
  `).join('');
}

async function handleWebOrderSubmit(e) {
  e.preventDefault();
  const btn = document.getElementById('wb-submit-btn');
  const [basePrice, pkgName, regMode] = document.getElementById('wb-pkg').value.split('|');
  const [mobFee, mobLabel] = document.getElementById('wb-mobility').value.split('|');
  const hospSel = document.getElementById('wb-hospital');
  const city = (hospSel.options[hospSel.selectedIndex].getAttribute('data-city')) || '北京';

  const payload = {
    source_channel: 'Web官网',
    patient_id: CURRENT_PATIENT_ID,
    patient_name: document.getElementById('wb-patient').value,
    contact_phone: document.getElementById('wb-phone').value,
    city,
    hospital_name: hospSel.value,
    department: document.getElementById('wb-dept').value,
    visit_date: document.getElementById('wb-date').value,
    package_name: pkgName,
    base_price: Number(basePrice),
    mobility_level: mobLabel,
    mobility_fee: Number(mobFee),
    reg_mode: regMode,
    pickup_address: document.getElementById('wb-pickup').value,
    dropoff_address: document.getElementById('wb-dropoff').value,
    require_cashier: true,
    patient_confirm_status: 'CONFIRMED',
    patient_confirm_method: 'Web端勾选已获患者本人知情授权'
  };

  const json = await apiRequest('/api/orders', { method: 'POST', body: payload }, btn);
  if (json && json.order) {
    document.getElementById('wb-lookup-input').value = json.order.order_no;
    openCashierForOrder(json.order, true);
  }
}

async function handleWebOrderLookup(e) {
  if (e) e.preventDefault();
  const q = document.getElementById('wb-lookup-input').value.trim();
  const btn = document.getElementById('wb-lookup-btn');
  const box = document.getElementById('wb-lookup-results');
  const json = await apiRequest(`/api/orders/lookup?q=${encodeURIComponent(q)}`, {}, btn);
  if (!json) return;

  if (!json.orders || json.orders.length === 0) {
    box.innerHTML = '<div class="ew-card-paper text-muted">未查询到匹配的预约订单，请核对手机号或订单号</div>';
    return;
  }
  box.innerHTML = json.orders.slice(0, 3).map(o => `
    <div class="ew-card-paper flex items-center justify-between gap-2">
      <div>
        <div class="font-extrabold">#${escapeHtml(o.order_no)} · ${escapeHtml(o.hospital_name)} (${escapeHtml(o.visit_date)})</div>
        <div class="text-muted mt-1">${escapeHtml(o.patient_name)} ｜ ¥${Number(o.total_price)} ｜ ${escapeHtml(o.live_note)}</div>
      </div>
      ${o.payment_status === 'UNPAID' && o.sop_step >= 0
        ? `<button type="button" onclick="openCashierById(${Number(o.id)}, true)" class="btn-orange whitespace-nowrap" style="padding:6px 11px;">去支付</button>`
        : `<span class="badge ${o.payment_status === 'PAID' ? 'badge-green' : 'badge-gray'} whitespace-nowrap">${o.payment_status === 'PAID' ? '已支付' : '已退款/关闭'}</span>`}
    </div>
  `).join('');
}

function openCashierById(orderId, fromWeb = false) {
  const ord = APP_STATE && APP_STATE.orders.find(o => o.id === orderId);
  if (ord) openCashierForOrder(ord, fromWeb);
}

async function handleWebJoinSubmit(e) {
  e.preventDefault();
  const btn = document.getElementById('join-submit-btn');
  const payload = {
    apply_type: document.getElementById('join-type').value,
    name: document.getElementById('join-name').value,
    phone: document.getElementById('join-phone').value,
    city: document.getElementById('join-city').value,
    qualification: document.getElementById('join-qual').value
  };
  const json = await apiRequest('/api/applications', { method: 'POST', body: payload }, btn);
  if (json) {
    e.target.reset();
    document.getElementById('join-city').value = '北京';
    showToast('入驻申请已入库！请前往【4.管理与机构后台】登录后审批通过');
  }
}

// ==================== 2. C-App (Family Mode + Personal Center "Mine") ====================
function selectFamilyElder(patientId) {
  CURRENT_PATIENT_ID = Number(patientId);
  savePref('ew_patient_id', CURRENT_PATIENT_ID);
  const p = getCurrentPatient();
  if (p) {
    document.getElementById('mb-patient').value = `${p.name} (${p.age}岁)`;
    if (p.address) {
      document.getElementById('mb-pickup').value = p.address;
      document.getElementById('mb-dropoff').value = `就诊结束后安全送回${p.address.slice(0, 12)}家中交接`;
    }
    const mobSel = document.getElementById('mb-mobility');
    for (let i = 0; i < mobSel.options.length; i++) {
      if (mobSel.options[i].text.includes(p.mobility_level)) {
        mobSel.selectedIndex = i;
        break;
      }
    }
    recalcMobilePrice();
  }
  renderCApp();
}

async function handleAddPatientSubmit(e) {
  e.preventDefault();
  if (!requireMobileAuth(() => document.getElementById('np-submit-btn').click())) return;
  const btn = document.getElementById('np-submit-btn');
  const payload = {
    name: document.getElementById('np-name').value,
    relation: document.getElementById('np-relation').value,
    age: Number(document.getElementById('np-age').value),
    city: document.getElementById('np-city').value,
    birthday: document.getElementById('np-birthday').value,
    mobility_level: document.getElementById('np-mobility').value,
    chronic_tags: document.getElementById('np-chronic').value,
    address: document.getElementById('np-address').value
  };
  const json = await apiRequest('/api/patients', { method: 'POST', body: payload }, btn);
  if (json && json.patient) {
    closeModal('modal-add-patient');
    e.target.reset();
    selectFamilyElder(json.patient.id);
    showToast(`已新增照护长辈【${json.patient.name}】并切换为当前档案！`);
  }
}

async function toggleCareCheckin(patientId, period, btnEl) {
  if (!requireMobileAuth(() => toggleCareCheckin(patientId, period, btnEl))) return;
  const json = await apiRequest(`/api/patients/${patientId}/care-checkin`, {
    method: 'POST',
    body: { period }
  }, btnEl);
  if (json) {
    const label = period === 'morning' ? '早安量压服药问候' : '晚安睡前平安确认';
    showToast(json.checked ? `已完成【${label}】打卡！连续守护：${json.care_streak} 天` : `已取消【${label}】标记`);
  }
}

function renderOrderStepperHtml(ord) {
  const paid = ord.payment_status === 'PAID';
  const confirmed = ord.patient_confirm_status === 'CONFIRMED';
  const s = Number(ord.sop_step);
  const nodes = [
    { label: '已支付', done: paid, cur: !paid && s >= 0 },
    { label: '患者确认', done: confirmed, cur: paid && !confirmed && s >= 0 },
    { label: '已派单', done: s >= 1, cur: paid && confirmed && s === 0 },
    { label: '院内陪诊', done: s >= 3, cur: s === 1 || s === 2 || s === 3 },
    { label: '医嘱完结', done: s >= 5, cur: s === 4 }
  ];
  return `
    <div class="order-stepper">
      ${nodes.map((n, idx) => {
        const cls = n.done ? 'done' : (n.cur ? 'current' : '');
        return `<div class="stepper-node ${cls}"><div class="stepper-dot">${n.done ? '✓' : idx + 1}</div><span>${n.label}</span></div>`;
      }).join('')}
    </div>
  `;
}

function renderVitalsSvgChart(diaries) {
  const box = document.getElementById('capp-vitals-chart');
  if (!box) return;
  if (!diaries || !diaries.length) {
    box.innerHTML = '<div class="text-center text-muted py-6">暂无记录，录入第一笔数据即刻生成趋势曲线</div>';
    return;
  }
  const pts = diaries.slice(0, 7).reverse();
  const w = 340, h = 132, padL = 28, padR = 16, padT = 18, padB = 24;
  const plotW = w - padL - padR, plotH = h - padT - padB;
  const allBp = pts.flatMap(d => [Number(d.bp_sys), Number(d.bp_dia)]);
  const minVal = Math.min(65, ...allBp) - 5;
  const maxVal = Math.max(155, ...allBp) + 8;
  const span = Math.max(20, maxVal - minVal);
  const getX = i => pts.length === 1 ? padL + plotW / 2 : padL + (i / (pts.length - 1)) * plotW;
  const getY = v => padT + plotH - ((v - minVal) / span) * plotH;
  const y140 = getY(140);
  const sysPoly = pts.map((d, i) => `${getX(i).toFixed(1)},${getY(Number(d.bp_sys)).toFixed(1)}`).join(' ');
  const diaPoly = pts.map((d, i) => `${getX(i).toFixed(1)},${getY(Number(d.bp_dia)).toFixed(1)}`).join(' ');
  const avgSugar = (pts.reduce((acc, d) => acc + Number(d.blood_sugar || 0), 0) / pts.length).toFixed(1);
  const latest = pts[pts.length - 1];

  box.innerHTML = `
    <div class="flex items-center justify-between mb-1" style="font-size:10.5px;">
      <div class="flex items-center gap-2">
        <span style="color:#d77844;font-weight:800;">● 收缩压(高压)</span>
        <span style="color:#075e50;font-weight:800;">● 舒张压(低压)</span>
      </div>
      <span class="badge badge-green">空腹血糖均值 ${avgSugar} mmol/L</span>
    </div>
    <svg viewBox="0 0 ${w} ${h}" width="100%" height="132" role="img" aria-label="近7日血压折线图">
      <line x1="${padL}" y1="${y140.toFixed(1)}" x2="${w - padR}" y2="${y140.toFixed(1)}" stroke="#e6a279" stroke-dasharray="3,3" stroke-width="1" />
      <text x="${padL + 2}" y="${(y140 - 3).toFixed(1)}" font-size="8.5" fill="#c96b36">警戒线 140mmHg</text>
      ${pts.length > 1 ? `<polyline fill="none" stroke="#d77844" stroke-width="2.2" points="${sysPoly}" />` : ''}
      ${pts.length > 1 ? `<polyline fill="none" stroke="#075e50" stroke-width="2.2" points="${diaPoly}" />` : ''}
      ${pts.map((d, i) => {
        const x = getX(i).toFixed(1), ys = getY(Number(d.bp_sys)).toFixed(1), yd = getY(Number(d.bp_dia)).toFixed(1);
        const dt = escapeHtml(String(d.log_date).replace(/\(.*\)/, '').trim().slice(-5));
        return `<circle cx="${x}" cy="${ys}" r="3.3" fill="#fff" stroke="#d77844" stroke-width="2"/><text x="${x}" y="${(Number(ys) - 6).toFixed(1)}" text-anchor="middle" font-size="8.5" font-weight="700" fill="#b85a25">${Number(d.bp_sys)}</text><circle cx="${x}" cy="${yd}" r="3.3" fill="#fff" stroke="#075e50" stroke-width="2"/><text x="${x}" y="${(Number(yd) + 11).toFixed(1)}" text-anchor="middle" font-size="8" fill="#075e50">${Number(d.bp_dia)}</text><text x="${x}" y="${h - 5}" text-anchor="middle" font-size="8.5" fill="#6b7d77">${dt}</text>`;
      }).join('')}
    </svg>
    <div class="flex items-center justify-between text-subtle" style="font-size:10.5px;border-top:1px dashed var(--ew-line);padding-top:5px;">
      <span>最新：${Number(latest.bp_sys)}/${Number(latest.bp_dia)} mmHg · 血糖 ${Number(latest.blood_sugar)}</span>
      <span class="text-green font-bold">${escapeHtml(latest.feeling)}</span>
    </div>
  `;
}

function renderCApp() {
  const p = getCurrentPatient();
  const today = APP_STATE.todayStr || '';

  // Auth status in phone header
  const statusPill = document.getElementById('capp-auth-status-pill');
  const headerUserBtn = document.getElementById('capp-header-user-btn');
  if (MOBILE_USER) {
    statusPill.textContent = '已实名登录';
    headerUserBtn.textContent = `${MOBILE_USER.display_name.slice(0, 6)} · 已登录`;
    headerUserBtn.style.background = 'rgba(255,255,255,0.22)';
  } else {
    statusPill.textContent = '游客浏览态';
    headerUserBtn.textContent = '未登录 · 点击一键登录';
    headerUserBtn.style.background = 'var(--ew-orange)';
  }

  // Elder switcher
  const switcherEl = document.getElementById('capp-elder-switcher');
  if (switcherEl && APP_STATE.patients) {
    switcherEl.innerHTML = APP_STATE.patients.map(pt => `
      <button type="button" onclick="selectFamilyElder(${Number(pt.id)})" class="elder-chip ${pt.id === (p && p.id) ? 'active' : ''}">
        ${escapeHtml(pt.relation)}·${escapeHtml(pt.name)} (${Number(pt.age)}岁·${escapeHtml(pt.mobility_level)})
      </button>
    `).join('') + `<button type="button" onclick="openModal('modal-add-patient')" class="elder-chip">+ 新增长辈</button>`;
  }

  // Care Hero
  const heroBox = document.getElementById('capp-care-hero');
  if (heroBox && p) {
    const morningDone = p.morning_checkin_date === today;
    const eveningDone = p.evening_checkin_date === today;
    heroBox.innerHTML = `
      <div class="flex items-center justify-between text-xs" style="color:#cfe6dc;">
        <span>${escapeHtml(p.city)} · 立冬节气关怀(+)</span>
        <span class="badge" style="background:rgba(215,120,68,0.92);color:#fff;">已连续守护 ${Number(p.care_streak || 12)} 天</span>
      </div>
      <div class="text-sm font-extrabold mt-1">距${escapeHtml(p.relation)}${escapeHtml(p.name)} ${Number(p.age)} 岁生日（${escapeHtml(p.birthday)}）还有 ${Number(p.days_to_birthday)} 天</div>
      <div class="text-xs mt-1" style="color:#bed8cd;">${escapeHtml(p.weather_alert)}</div>
      <div class="care-checkin-grid">
        <button type="button" onclick="toggleCareCheckin(${Number(p.id)}, 'morning', this)" class="care-slot-btn ${morningDone ? 'done' : ''}">
          <div><div class="font-bold">08:00 早安敲门</div><div style="font-size:10px;opacity:0.82;">晨起测压服药</div></div>
          <span>${morningDone ? '✓ 已确认' : '打卡'}</span>
        </button>
        <button type="button" onclick="toggleCareCheckin(${Number(p.id)}, 'evening', this)" class="care-slot-btn ${eveningDone ? 'done' : ''}">
          <div><div class="font-bold">20:00 晚安敲门</div><div style="font-size:10px;opacity:0.82;">睡前平安确认</div></div>
          <span>${eveningDone ? '✓ 已确认' : '打卡'}</span>
        </button>
      </div>
    `;
  }

  // Family Orders
  const ordersBox = document.getElementById('capp-orders-container');
  const sopLabels = {
    '-1': { text: '已取消/已退改', cls: 'badge-gray' },
    0: { text: '待指派陪诊师', cls: 'badge-orange' },
    1: { text: '第1步 · 已接单出发', cls: 'badge-blue' },
    2: { text: '第2步 · 已达接手点', cls: 'badge-blue' },
    3: { text: '第3步 · 院内陪诊中', cls: 'badge-purple' },
    4: { text: '第4步 · 已出医嘱/理赔', cls: 'badge-green' },
    5: { text: '第5步 · 服务已完结', cls: 'badge-solid-green' }
  };

  if (ordersBox) {
    ordersBox.innerHTML = APP_STATE.orders.slice(0, 5).map(ord => {
      const isUnpaid = ord.payment_status === 'UNPAID' && ord.sop_step >= 0;
      const stInfo = isUnpaid ? { text: '待收银台支付', cls: 'badge-red' } : (sopLabels[ord.sop_step] || sopLabels[0]);
      const isCancelled = ord.sop_step === -1;
      return `
        <div class="ew-card space-y-2 text-xs" style="padding:13px;${isCancelled ? 'opacity:0.74;background:#f7f8f7;' : 'border-color:#b9d8cb;'}">
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-1-5 flex-wrap">
              <span class="font-extrabold">#${escapeHtml(ord.order_no)}</span>
              <span class="badge ${stInfo.cls}">${stInfo.text}</span>
              ${ord.rating_score > 0 ? `<span class="badge badge-orange">已评 ${Number(ord.rating_score)}★</span>` : ''}
            </div>
            <span class="font-extrabold text-sm text-orange">¥${Number(ord.total_price)}</span>
          </div>
          <div class="font-extrabold">${escapeHtml(ord.city)} · ${escapeHtml(ord.hospital_name)} · ${escapeHtml(ord.department)}</div>
          <div class="text-muted">就诊人：${escapeHtml(ord.patient_name)} ｜ ${escapeHtml(ord.visit_date)} ｜ <b>${escapeHtml(ord.mobility_level)}</b></div>
          ${!isCancelled ? renderOrderStepperHtml(ord) : ''}
          <div class="ew-card-paper" style="padding:8px 10px;">
            <div><strong>最新进展：</strong>${escapeHtml(ord.live_note)}</div>
            ${ord.after_sale_status !== 'NONE' ? `<div class="text-danger mt-1"><strong>售后进度：</strong>${escapeHtml(ord.after_sale_reason)}</div>` : ''}
          </div>
          <div class="flex flex-wrap gap-1-5">
            ${isUnpaid ? `<button type="button" onclick="openCashierById(${Number(ord.id)}, false)" class="btn-orange" style="padding:6px 11px;font-size:11.5px;">立即去支付</button>` : ''}
            ${!isCancelled && !isUnpaid && ord.patient_confirm_status !== 'CONFIRMED' ? `<button type="button" onclick="openPatientConfirmModalForOrder(${Number(ord.id)})" class="btn-orange" style="padding:6px 10px;font-size:11.5px;">患者确认(+)</button>` : ''}
            ${!isCancelled && !isUnpaid && ord.sop_step === 0 && ord.patient_confirm_status === 'CONFIRMED' ? `<button type="button" onclick="switchTerminal('admin')" class="btn-outline" style="padding:5px 10px;font-size:11.5px;">去后台派单 →</button>` : ''}
            ${!isCancelled && ord.sop_step >= 1 && ord.sop_step < 5 && ord.escort_id ? `<button type="button" onclick="jumpToEscortForOrder(${Number(ord.id)})" class="btn-primary" style="padding:6px 10px;font-size:11.5px;">去陪诊端打卡 →</button>` : ''}
            ${ord.sop_step >= 4 ? `<button type="button" onclick="openReviewModal(${Number(ord.id)})" class="btn-outline" style="padding:5px 10px;font-size:11.5px;">${ord.rating_score > 0 ? '修改评价/售后' : '评价陪诊师/售后'}</button>` : ''}
            ${!isCancelled ? `<button type="button" onclick="openRideModalByOrderId(${Number(ord.id)})" class="btn-blue" style="padding:6px 9px;font-size:11px;">跳滴滴/高德(+)</button>` : ''}
            ${!isCancelled && !isUnpaid && ord.sop_step < 5 ? `<button type="button" onclick="openCashierForOvertime(${Number(ord.id)})" class="btn-soft" style="padding:6px 9px;font-size:11px;">加钟+¥100</button>` : ''}
            ${!isCancelled && ord.sop_step < 4 ? `<button type="button" onclick="openCancelModal(${Number(ord.id)})" class="btn-soft" style="padding:6px 9px;font-size:11px;">退改</button>` : ''}
            <button type="button" onclick="openOrderEventsModal(${Number(ord.id)})" class="btn-soft" style="padding:6px 9px;font-size:11px;">流转日志</button>
          </div>
        </div>
      `;
    }).join('');
  }

  // Commercial Home
  const commHome = document.getElementById('capp-commercial-home');
  if (commHome) {
    commHome.innerHTML = APP_STATE.commercialSlots.filter(s => s.slot_type !== '购药入口').slice(0, 2).map(s => `
      <button type="button" onclick="triggerCommercialClickById(${Number(s.id)}, this)" class="ew-card-paper text-left flex flex-col justify-between" style="padding:10px;">
        <div>
          <span class="badge badge-green">${escapeHtml(s.slot_type)}(+)</span>
          <div class="font-extrabold mt-1" style="font-size:12px;line-height:1.35;">${escapeHtml(s.title)}</div>
        </div>
        <div class="flex items-center justify-between mt-2 pt-1" style="border-top:1px solid var(--ew-line);width:100%;">
          <span class="font-extrabold text-orange" style="font-size:11.5px;">${escapeHtml(s.price_tag)}</span>
          <span class="text-subtle" style="font-size:10px;">导流 ${Number(s.clicks)}</span>
        </div>
      </button>
    `).join('');
  }

  // Meds & Post-visit Reports (with Real Uploaded Image Thumbnails!)
  const medsBox = document.getElementById('capp-meds-container');
  const drugSlot = APP_STATE.commercialSlots.find(s => s.slot_type === '购药入口') || APP_STATE.commercialSlots[0];
  if (medsBox) {
    const totalMeds = APP_STATE.medications.length || 1;
    const doneMeds = APP_STATE.medications.filter(m => m.checked_today === 1).length;
    const pct = Math.round((doneMeds / totalMeds) * 100);
    medsBox.innerHTML = `
      <div class="flex items-center justify-between gap-2">
        <div><span class="font-extrabold text-sm text-green">医嘱执行打卡 (+)</span> <span class="badge ${pct === 100 ? 'badge-solid-green' : 'badge-orange'}">${doneMeds}/${APP_STATE.medications.length} (${pct}%)</span></div>
        ${drugSlot ? `<button type="button" onclick="triggerCommercialClickById(${Number(drugSlot.id)}, this)" class="btn-blue" style="padding:5px 9px;font-size:11px;">京东健康购药(+) →</button>` : ''}
      </div>
      <div class="ew-progress-track"><div class="ew-progress-fill" style="width:${pct}%;"></div></div>
      <div class="space-y-2 pt-1">
        ${APP_STATE.medications.map(m => `
          <label class="ew-card-paper flex items-center justify-between gap-2" style="cursor:pointer;${m.checked_today ? 'background:var(--ew-mint-soft);border-color:#9fd0b9;' : ''}">
            <div>
              <div class="font-extrabold">${escapeHtml(m.drug_name)} <span class="badge badge-gray">${escapeHtml(m.patient_name)}</span></div>
              <div class="text-muted mt-1" style="font-size:11px;">${escapeHtml(m.frequency)} · ${escapeHtml(m.dosage)}</div>
            </div>
            <input type="checkbox" ${m.checked_today ? 'checked' : ''} onchange="toggleMedication(${Number(m.id)}, this)" style="width:18px;height:18px;accent-color:#075e50;" />
          </label>
        `).join('')}
      </div>
    `;
  }

  const repBox = document.getElementById('capp-reports-container');
  if (repBox) {
    repBox.innerHTML = APP_STATE.reports.map(r => {
      const dLeft = daysUntilDate(r.recheck_date);
      const cdLabel = dLeft !== null ? (dLeft >= 0 ? `距复检还有 ${dLeft} 天` : `已超复检期 ${Math.abs(dLeft)} 天`) : '复检提醒';
      const imgs = (r.report_images || []).filter(u => String(u).startsWith('/uploads/') || String(u).startsWith('data:image/'));
      return `
        <div class="ew-card space-y-2" style="padding:14px;">
          <div class="flex items-center justify-between">
            <span class="font-extrabold text-sm text-green">结果分享 (+) · 陪诊医嘱报告</span>
            <button type="button" onclick="shareMedicalReport(${Number(r.id)})" class="btn-orange" style="padding:5px 10px;font-size:11.5px;">转发授权家属</button>
          </div>
          <div class="ew-card-paper space-y-1.5">
            <div class="font-extrabold">${escapeHtml(r.visit_date)} ｜ ${escapeHtml(r.hospital_dept)}</div>
            <div class="text-subtle" style="font-size:11px;">授权查看：${escapeHtml(r.authorized_viewers)} ｜ 陪诊员：${escapeHtml(r.escort_name)}</div>
            <div style="line-height:1.58;">${escapeHtml(r.doctor_advice)}</div>
            ${imgs.length > 0 ? `
              <div class="pt-1">
                <div class="text-green font-bold mb-1" style="font-size:11px;">现场实拍检验单/处方原件（点击放大查验）：</div>
                <div class="flex flex-wrap gap-2">
                  ${imgs.map((url, idx) => `<img src="${escapeHtml(url)}" alt="报告原件${idx + 1}" class="slip-thumb" onclick="openImagePreview('${escapeHtml(url)}')" />`).join('')}
                </div>
              </div>
            ` : ''}
            <div class="badge badge-green" style="font-weight:600;">GB/T 47801—2026 合规水牌：仅作医生原话客观记录</div>
          </div>
          <div class="ew-card-mint flex items-center justify-between gap-2" style="padding:10px 12px;">
            <div>
              <span class="font-extrabold text-green">术后/诊后复检 (+)</span> <span class="badge badge-orange">${escapeHtml(cdLabel)}</span>
              <div class="text-muted mt-1" style="font-size:11px;">建议日：<b>${escapeHtml(r.recheck_date)}</b> · ${escapeHtml(r.recheck_prep)}</div>
            </div>
            <button type="button" onclick="rebookFromReportId(${Number(r.id)})" class="btn-primary whitespace-nowrap" style="padding:8px 11px;font-size:11px;">一键再次陪诊</button>
          </div>
          <div class="ew-card-paper space-y-1.5">
            <div class="flex items-center justify-between">
              <span class="font-extrabold text-green">保险理赔资料包 (+) · ${r.claim_docs.length} 份凭证</span>
              <button type="button" onclick="downloadClaimBundle(${Number(r.id)})" class="btn-soft" style="padding:4px 9px;font-size:11px;background:#102e29;color:#fff;">打包下载 PDF</button>
            </div>
            <div class="flex flex-wrap gap-1">${r.claim_docs.map(doc => `<span class="badge badge-gray">${escapeHtml(doc)}</span>`).join('')}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  // Care Chart + Articles + Mine
  const elderDiaries = p ? APP_STATE.diaries.filter(d => d.patient_id === p.id || d.patient_name === p.name) : APP_STATE.diaries;
  const displayDiaries = elderDiaries.length > 0 ? elderDiaries : APP_STATE.diaries;
  renderVitalsSvgChart(displayDiaries);

  const diaryBox = document.getElementById('capp-diaries-container');
  if (diaryBox) {
    diaryBox.innerHTML = displayDiaries.slice(0, 4).map(d => `
      <div class="ew-card-paper flex items-center justify-between gap-2" style="padding:8px 10px;">
        <div>
          <div class="font-bold">${escapeHtml(d.log_date)} · 血压 ${Number(d.bp_sys)}/${Number(d.bp_dia)} · 血糖 ${Number(d.blood_sugar)}</div>
          <div class="text-muted" style="font-size:11px;">${escapeHtml(d.note || '')}</div>
        </div>
        <span class="badge badge-green whitespace-nowrap">${escapeHtml(d.feeling)}</span>
      </div>
    `).join('');
  }

  renderCAppArticles();
  renderCAppMine();
}

function renderCAppMine() {
  const banner = document.getElementById('capp-mine-banner');
  const authActions = document.getElementById('capp-mine-auth-actions');
  const invCount = document.getElementById('mine-invoice-count');
  if (invCount && APP_STATE.invoices) {
    invCount.textContent = `已开 ${APP_STATE.invoices.length} 张`;
  }
  if (!banner || !authActions) return;

  if (MOBILE_USER) {
    banner.innerHTML = `
      <div class="flex items-center gap-3">
        <div class="mine-avatar">${escapeHtml(MOBILE_USER.display_name.slice(0, 1))}</div>
        <div>
          <div class="font-extrabold text-sm">${escapeHtml(MOBILE_USER.display_name)}</div>
          <div style="font-size:11.5px;color:#c3dfd3;">绑定手机：${escapeHtml(MOBILE_USER.masked_phone)} · 角色：${MOBILE_USER.role === 'ESCORT' ? '持证陪诊师' : '家庭主照护人'}</div>
        </div>
      </div>
      <span class="badge badge-solid-green">已实名认证</span>
    `;
    authActions.innerHTML = `
      <button type="button" onclick="handleMobileLogout(this)" class="btn-soft w-full" style="padding:10px;">退出当前登录（切回游客浏览态）</button>
      <button type="button" onclick="handleDeleteAccount(this)" class="btn-soft text-danger w-full" style="padding:10px;border-color:#f3c6c6;">永久注销账号并清理个人身份凭证（合规必配）</button>
    `;
  } else {
    banner.innerHTML = `
      <div class="flex items-center gap-3">
        <div class="mine-avatar">游</div>
        <div>
          <div class="font-extrabold text-sm">当前未登录（游客浏览模式）</div>
          <div style="font-size:11.5px;color:#c3dfd3;">支持先浏览价格表、种草攻略与AI导诊</div>
        </div>
      </div>
      <button type="button" onclick="openMobileLoginModal('FAMILY')" class="btn-orange" style="padding:7px 12px;">一键登录</button>
    `;
    authActions.innerHTML = `
      <button type="button" onclick="openMobileLoginModal('FAMILY')" class="btn-primary w-full" style="padding:11px;">立即登录 / 注册家庭照护账号</button>
    `;
  }
}


// ==================== Part 2B-1: 社区笔记 / AI导诊 / 下单收银 / 合规法务 / 评价与发票 ====================
function renderCAppArticles() {
  const filterBox = document.getElementById('capp-article-filters');
  const grid = document.getElementById('capp-articles-container');
  if (!filterBox || !grid || !APP_STATE) return;

  const cats = ['ALL', '实景攻略', '节气食养', '护工经验'];
  filterBox.innerHTML = cats.map(c => `
    <button type="button" onclick="setArticleFilter('${c}')" class="filter-pill ${CURRENT_ART_FILTER === c ? 'active' : ''}">
      ${c === 'ALL' ? '全部笔记' : c}
    </button>
  `).join('');

  const list = APP_STATE.articles.filter(a => {
    if (CURRENT_ART_FILTER === 'ALL') return true;
    return String(a.category || '').includes(CURRENT_ART_FILTER.slice(0, 2));
  });

  grid.innerHTML = (list.length ? list : APP_STATE.articles).map(art => {
    const catStr = String(art.category || '');
    const catCls = catStr.includes('食') ? 'cat-diet' : (catStr.includes('护') ? 'cat-video' : 'cat-guide');
    return `
    <div class="xhs-card">
      <div onclick="openArticleDetail(${Number(art.id)})" class="xhs-cover ${catCls}" style="cursor:pointer;">
        <span class="badge" style="background:rgba(255,255,255,0.22);color:#fff;align-self:flex-start;">${escapeHtml(art.category)}</span>
        <div class="font-extrabold mt-1" style="font-size:12.5px;line-height:1.38;">${escapeHtml(art.title)}</div>
      </div>
      <div class="xhs-body">
        <div class="xhs-summary">${escapeHtml(art.summary)}</div>
        <div class="flex items-center justify-between pt-1" style="border-top:1px dashed var(--ew-line);font-size:10.5px;">
          <button type="button" onclick="toggleArticleInteract(${Number(art.id)}, 'like', this)" class="btn-soft" style="padding:3px 7px;font-size:10.5px;${art.liked ? 'color:#d77844;border-color:#f0c4a8;' : ''}">
            ${art.liked ? '♥' : '♡'} ${Number(art.likes || 0)}
          </button>
          <button type="button" onclick="toggleArticleInteract(${Number(art.id)}, 'bookmark', this)" class="btn-soft" style="padding:3px 7px;font-size:10.5px;${art.bookmarked ? 'color:#075e50;border-color:#9fd0b9;' : ''}">
            ${art.bookmarked ? '★ 已藏' : '☆ 收藏'}
          </button>
        </div>
      </div>
    </div>
  `;
  }).join('');
}

function setArticleFilter(key) {
  CURRENT_ART_FILTER = key;
  savePref('ew_art_filter', key);
  renderCAppArticles();
}

async function toggleArticleInteract(artId, action, btnEl) {
  await apiRequest(`/api/articles/${artId}/interact`, {
    method: 'POST',
    body: { action }
  }, btnEl);
}

function openArticleDetail(artId) {
  if (!APP_STATE) return;
  const art = APP_STATE.articles.find(a => a.id === artId);
  if (!art) return;
  document.getElementById('art-modal-badge').textContent = `${art.category} · ${art.solar_term}`;
  document.getElementById('art-modal-title').textContent = art.title;
  document.getElementById('art-modal-author').textContent = `作者：${art.author || '健康来敲门持证护工组'} ｜ 浏览 ${Number(art.views || 0) + 1}`;
  document.getElementById('art-modal-content').textContent = art.content || art.summary;
  document.getElementById('art-modal-actions').innerHTML = `
    <div class="flex gap-2">
      <button type="button" onclick="toggleArticleInteract(${Number(art.id)}, 'like', this)" class="btn-soft">${art.liked ? '♥ 已赞' : '♡ 点赞'} (${Number(art.likes || 0)})</button>
      <button type="button" onclick="toggleArticleInteract(${Number(art.id)}, 'bookmark', this)" class="btn-soft">${art.bookmarked ? '★ 已收藏' : '☆ 收藏攻略'}</button>
    </div>
    <button type="button" onclick="bookFromArticle(${Number(art.id)})" class="btn-primary">按此攻略预约同院陪诊 →</button>
  `;
  openModal('modal-article-detail');
}

function bookFromArticle(artId) {
  const art = APP_STATE && APP_STATE.articles.find(a => a.id === artId);
  closeModal('modal-article-detail');
  switchTerminal('c-app');
  switchCAppTab('book');
  if (art) {
    const hospSel = document.getElementById('mb-hospital');
    if (art.title.includes('积水潭')) hospSel.value = '北京积水潭医院(新街口院区)';
    else if (art.title.includes('华西')) hospSel.value = '四川大学华西医院(本院)';
    else hospSel.value = '北京协和医院(东单院区)';
    syncMobileHospitalCity();
  }
  showToast('已为您带入攻略对应目标医院，确认信息后即可下单！');
}

// AI Triage & Mobile Booking
let LAST_AI_REPLY = null;

function setAiSample(text) {
  const inp = document.getElementById('ai-query-input');
  if (inp) inp.value = text;
  runAiTriage(document.getElementById('ai-run-btn'));
}

async function runAiTriage(btnEl = null) {
  const inp = document.getElementById('ai-query-input');
  if (!inp) return;
  const json = await apiRequest('/api/ai/triage', {
    method: 'POST',
    body: { query: inp.value }
  }, btnEl);
  if (!json || !json.reply) return;
  LAST_AI_REPLY = json.reply;
  const r = json.reply;
  const box = document.getElementById('ai-result-box');
  if (!box) return;
  box.innerHTML = `
    <div class="ew-card space-y-2" style="padding:13px;border:1.5px solid #9fd0b9;">
      <div class="flex items-center justify-between">
        <span class="badge badge-green">推荐城市：${escapeHtml(r.recommendedCity)}</span>
        <span class="badge badge-orange">建议分级：${escapeHtml(r.recommendedMobilityLevel)} (+¥${Number(r.recommendedMobilityFee)})</span>
      </div>
      <div class="font-extrabold text-sm text-green">${escapeHtml(r.recommendedHospital)} · ${escapeHtml(r.recommendedDept)}</div>
      <div class="ew-card-paper space-y-1">
        <div class="font-bold">诊前准备材料清单：</div>
        ${(r.prepTips || []).map((t, idx) => `<div>${idx + 1}. ${escapeHtml(t)}</div>`).join('')}
      </div>
      <div class="text-muted"><strong>官方放号指引：</strong>${escapeHtml(r.officialRegGuide)}</div>
      <div class="text-muted"><strong>院内轮椅与无障碍动线：</strong>${escapeHtml(r.wheelchairGuide)}</div>
      <button type="button" onclick="applyLastAiToBooking()" class="btn-orange w-full" style="padding:9px;">
        一键带入【预约陪诊】表单（自动匹配医院/科室/分级）→
      </button>
    </div>
  `;
}

function applyLastAiToBooking() {
  if (!LAST_AI_REPLY) return;
  const r = LAST_AI_REPLY;
  const hospSel = document.getElementById('mb-hospital');
  for (let i = 0; i < hospSel.options.length; i++) {
    if (hospSel.options[i].value === r.recommendedHospital) {
      hospSel.selectedIndex = i;
      break;
    }
  }
  document.getElementById('mb-dept').value = r.recommendedDept.split('/')[0].trim();
  const mobSel = document.getElementById('mb-mobility');
  const code = String(r.recommendedMobilityLevel).slice(0, 2);
  for (let i = 0; i < mobSel.options.length; i++) {
    if (mobSel.options[i].text.includes(code)) {
      mobSel.selectedIndex = i;
      break;
    }
  }
  syncMobileHospitalCity();
  recalcMobilePrice();
  switchCAppTab('book');
  showToast('已将 AI 推荐的医院、科室与失能分级一键填入预约单！');
}

function syncMobileHospitalCity() {
  const sel = document.getElementById('mb-hospital');
  if (!sel) return;
  const opt = sel.options[sel.selectedIndex];
  const city = opt ? opt.getAttribute('data-city') : '北京';
  const badge = document.getElementById('mb-city-badge');
  if (badge) badge.textContent = `就诊城市：${city}`;
  const pickup = document.getElementById('mb-pickup');
  const dropoff = document.getElementById('mb-dropoff');
  if (city === '成都' && pickup.value.includes('朝阳区')) {
    pickup.value = '成都市武侯区玉林北路12号院2单元302';
    dropoff.value = '就诊结束后送回武侯区玉林北路家中交接';
  } else if (city === '北京' && pickup.value.includes('成都市')) {
    pickup.value = '朝阳区幸福一村3号楼2单元301(无电梯3楼)';
    dropoff.value = '就诊结束后送回幸福一村3号楼家中交接';
  }
}

function prefillBookingLevel(val) {
  const mobSel = document.getElementById('mb-mobility');
  if (mobSel) {
    mobSel.value = val;
    recalcMobilePrice();
  }
  switchCAppTab('book');
}

function selectRegMode(mode, btnEl) {
  document.getElementById('mb-reg-mode').value = mode;
  document.querySelectorAll('.reg-mode-btn').forEach(b => {
    b.className = 'reg-mode-btn btn-soft';
    b.style.background = '';
    b.textContent = b.textContent.replace(/^✓\s*/, '');
  });
  btnEl.className = 'reg-mode-btn btn-outline';
  btnEl.style.background = 'var(--ew-mint-soft)';
  btnEl.textContent = `✓ ${mode}`;
  if (mode === '跳官方挂号') {
    const hosp = document.getElementById('mb-hospital').value;
    showToast(`已标记【跳官方放号】：下单后将为您直链跳转 ${hosp} 官方小程序挂号入口`);
  }
}

function recalcMobilePrice() {
  const pkgEl = document.getElementById('mb-pkg');
  const mobEl = document.getElementById('mb-mobility');
  if (!pkgEl || !mobEl) return;
  const base = Number(pkgEl.value.split('|')[0] || 288);
  const mob = Number(mobEl.value.split('|')[0] || 80);
  document.getElementById('mb-price-formula').textContent = `套餐 ¥${base} + 分级 ¥${mob}`;
  document.getElementById('mb-total-price').textContent = `¥${base + mob}`;
}

async function handleMobileOrderSubmit(e) {
  if (e) e.preventDefault();
  if (!requireMobileAuth(() => handleMobileOrderSubmit(null), 'FAMILY')) return;

  const btn = document.getElementById('mb-submit-btn');
  const [basePrice, pkgName] = document.getElementById('mb-pkg').value.split('|');
  const [mobFee, mobLabel] = document.getElementById('mb-mobility').value.split('|');
  const hospSel = document.getElementById('mb-hospital');
  const city = (hospSel.options[hospSel.selectedIndex].getAttribute('data-city')) || '北京';

  const payload = {
    source_channel: '微信小程序/App',
    patient_id: CURRENT_PATIENT_ID,
    patient_name: document.getElementById('mb-patient').value,
    contact_phone: document.getElementById('mb-phone').value,
    city,
    hospital_name: hospSel.value,
    department: document.getElementById('mb-dept').value,
    visit_date: document.getElementById('mb-date').value,
    package_name: pkgName,
    base_price: Number(basePrice),
    mobility_level: mobLabel,
    mobility_fee: Number(mobFee),
    reg_mode: document.getElementById('mb-reg-mode').value,
    pickup_address: document.getElementById('mb-pickup').value,
    dropoff_address: document.getElementById('mb-dropoff').value,
    require_cashier: true,
    patient_confirm_status: 'PENDING'
  };

  const json = await apiRequest('/api/orders', { method: 'POST', body: payload }, btn);
  if (json && json.order) {
    switchCAppTab('home');
    openCashierForOrder(json.order, false);
  }
}

// Patient Confirm (+)
function openPatientConfirmModalForOrder(orderId) {
  const ord = APP_STATE && APP_STATE.orders.find(o => o.id === orderId);
  if (!ord) return;
  ACTIVE_CONFIRM_ORDER_ID = ord.id;
  document.getElementById('confirm-modal-orderno').textContent = `#${ord.order_no}（${ord.patient_name} · ${ord.hospital_name}）`;
  openModal('modal-patient-confirm');
}

function openPatientConfirmForLatest() {
  if (!APP_STATE || !APP_STATE.orders.length) return;
  const pending = APP_STATE.orders.find(o => o.sop_step >= 0 && o.patient_confirm_status !== 'CONFIRMED') || APP_STATE.orders[0];
  openPatientConfirmModalForOrder(pending.id);
}

async function submitPatientConfirm(methodDesc, btnEl) {
  if (!ACTIVE_CONFIRM_ORDER_ID) return;
  const json = await apiRequest(`/api/orders/${ACTIVE_CONFIRM_ORDER_ID}/confirm-patient`, {
    method: 'POST',
    body: { method: methodDesc }
  }, btnEl);
  if (json) {
    closeModal('modal-patient-confirm');
    showToast('已完成【患者本人知情确认(+)】！订单已进入管理后台待派单队列');
  }
}

// Ride Wakeup (+)
function openRideModal(startAddr, endHosp) {
  const s = startAddr || document.getElementById('mb-pickup').value;
  const e = endHosp || document.getElementById('mb-hospital').value;
  const hospObj = (APP_STATE && APP_STATE.hospitals.find(h => h.name === e)) || { dropoff_point: '医院门诊楼无障碍落客区', lng: 116.4175, lat: 39.9138 };
  document.getElementById('ride-start-text').textContent = s;
  document.getElementById('ride-end-text').textContent = `${e} · ${hospObj.dropoff_point || '东门无障碍通道'}`;
  document.getElementById('ride-coord-text').textContent = `精准导航坐标：E ${hospObj.lng || 116.4175}, N ${hospObj.lat || 39.9138}（轮椅坡道直达）`;
  const amap = document.getElementById('ride-amap-link');
  if (amap) {
    amap.href = `https://uri.amap.com/navigation?to=${hospObj.lng || 116.4175},${hospObj.lat || 39.9138},${encodeURIComponent(e)}&mode=car&src=everwell`;
  }
  openModal('modal-ride-wakeup');
}

function openRideModalByOrderId(orderId) {
  const ord = APP_STATE && APP_STATE.orders.find(o => o.id === orderId);
  if (!ord) return;
  openRideModal(ord.pickup_address, ord.hospital_name);
}

// 4-Tier Cancel & Refund
function openCancelModal(orderId) {
  const ord = APP_STATE && APP_STATE.orders.find(o => o.id === orderId);
  if (!ord) return;
  ACTIVE_CANCEL_ORDER_ID = ord.id;
  const total = Number(ord.total_price);
  const isUnpaid = ord.payment_status === 'UNPAID';
  const tiers = [
    { code: '>48h', title: '距服务开始 > 48 小时（全额无损退）', rate: 0 },
    { code: '8-48h', title: '距服务开始 8 ~ 48 小时（扣 10% 留档排班费）', rate: 0.1 },
    { code: '4-8h', title: '距服务开始 4 ~ 8 小时（扣 20% 运力空置费）', rate: 0.2 },
    { code: '<4h', title: '距服务开始 < 4 小时（扣 50% 临期违约金）', rate: 0.5 }
  ];
  document.getElementById('cancel-tier-options').innerHTML = isUnpaid
    ? `<button type="button" onclick="confirmCancelOrder('>48h', this)" class="ew-card-mint w-full text-left" style="cursor:pointer;">
        <div class="font-extrabold text-green">当前订单尚未支付 · 免费关闭取消</div>
        <div class="text-muted mt-1">无需扣除任何违约金，确认后立即关闭订单。</div>
      </button>`
    : tiers.map(t => {
        const pen = (total * t.rate).toFixed(2);
        const ref = (total - Number(pen)).toFixed(2);
        return `
          <button type="button" onclick="confirmCancelOrder('${t.code}', this)" class="ew-card-paper w-full text-left flex items-center justify-between" style="cursor:pointer;">
            <div>
              <div class="font-extrabold">${t.title}</div>
              <div class="text-muted mt-1">原实付 ¥${total} · 违约金 ¥${pen}</div>
            </div>
            <span class="badge badge-green">退回 ¥${ref}</span>
          </button>
        `;
      }).join('');
  openModal('modal-cancel-tier');
}

async function confirmCancelOrder(tierCode, btnEl) {
  if (!ACTIVE_CANCEL_ORDER_ID) return;
  const json = await apiRequest(`/api/orders/${ACTIVE_CANCEL_ORDER_ID}/cancel`, {
    method: 'POST',
    body: { tier: tierCode }
  }, btnEl);
  if (json) {
    closeModal('modal-cancel-tier');
    showToast(json.refund > 0 ? `退改成功！已原路退回 ¥${json.refund}（违约金 ¥${json.penalty}）` : '未支付订单已免费取消关闭');
  }
}

// Post-Visit Meds / Recheck / Diary / Commercial
async function toggleMedication(medId, inputEl) {
  if (!MOBILE_TOKEN) {
    if (inputEl) inputEl.checked = !inputEl.checked;
    requireMobileAuth(() => toggleMedication(medId, null), 'FAMILY');
    return;
  }
  const json = await apiRequest(`/api/medications/${medId}/toggle`, { method: 'POST' });
  if (json) showToast('医嘱服药打卡状态已实时同步至家庭照护看板！');
}

function rebookFromReportId(repId) {
  const rep = APP_STATE && APP_STATE.reports.find(r => r.id === repId);
  if (!rep) return;
  const parts = String(rep.hospital_dept || '').split('·');
  const hospName = (parts[0] || '').trim();
  const deptName = (parts[1] || '复查门诊').trim();
  const hospSel = document.getElementById('mb-hospital');
  for (let i = 0; i < hospSel.options.length; i++) {
    if (hospSel.options[i].value === hospName) {
      hospSel.selectedIndex = i;
      break;
    }
  }
  document.getElementById('mb-dept').value = deptName;
  if (rep.recheck_date && rep.recheck_date >= (APP_STATE.todayStr || '')) {
    document.getElementById('mb-date').value = rep.recheck_date;
  }
  syncMobileHospitalCity();
  switchCAppTab('book');
  showToast(`已按医嘱自动带入【${rep.recheck_date} · ${hospName}】复检预约信息！`);
}

async function handleDiarySubmit(e) {
  if (e) e.preventDefault();
  if (!requireMobileAuth(() => handleDiarySubmit(null), 'FAMILY')) return;
  const btn = document.getElementById('diary-submit-btn');
  const p = getCurrentPatient();
  const payload = {
    patient_id: p ? p.id : 1,
    patient_name: p ? p.name : '张建国',
    bp_sys: Number(document.getElementById('diary-sys').value),
    bp_dia: Number(document.getElementById('diary-dia').value),
    blood_sugar: Number(document.getElementById('diary-sugar').value),
    note: document.getElementById('diary-note').value
  };
  const json = await apiRequest('/api/diaries', { method: 'POST', body: payload }, btn);
  if (json) {
    document.getElementById('diary-note').value = '';
    showToast('今日血压与空腹血糖已入库，7日临床趋势曲线已实时重绘！');
  }
}

async function triggerCommercialClickById(slotId, btnEl) {
  const json = await apiRequest(`/api/commercial/${slotId}/click`, { method: 'POST' }, btnEl);
  if (json && json.slot) {
    showToast(`已为您导流至【${json.slot.partner_name} · ${json.slot.title}】（后台归因点击 +1）`);
  }
}

function shareMedicalReport(repId) {
  const rep = APP_STATE && APP_STATE.reports.find(r => r.id === repId);
  if (!rep) return;
  showToast(`已生成加密授权阅读卡片并发送至【${rep.authorized_viewers}】微信端！`);
}

function downloadClaimBundle(repId) {
  const rep = APP_STATE && APP_STATE.reports.find(r => r.id === repId);
  if (!rep) return;
  const content = [
    '================ 健康来敲门 · 商业医疗险理赔资料核验包 ================',
    `关联订单号：${rep.order_no}`,
    `就诊患者：${rep.patient_name}`,
    `就诊医院科室：${rep.hospital_dept}（就诊日：${rep.visit_date}）`,
    `承接持证陪诊员：${rep.escort_name}`,
    `客观医嘱记录：${rep.doctor_advice}`,
    `包含凭证清单：${(rep.claim_docs || []).join(' / ')}`,
    `现场实拍原件路径：${(rep.report_images || []).join(', ')}`,
    '======================================================================='
  ].join('\n');
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `健康来敲门_保险理赔资料清单_${rep.order_no}.txt`;
  a.click();
  URL.revokeObjectURL(a.href);
  showToast(`已打包下载订单 #${rep.order_no} 的保险理赔资料清单！`);
}

// Legal Docs, Emergency SOS, Invoice, Review & After-Sale, Image Lightbox
function openLegalDoc(docType) {
  const docs = {
    user: {
      title: '《健康来敲门用户服务协议》（2026生产交付版）',
      html: `
        <p><strong>1. 服务性质界定：</strong>“健康来敲门（Everwell）”系依据国家标准《GB/T 47801—2026 医疗陪诊服务规范》提供非医疗性质助老就医陪同、院内轮椅推行、取号缴费跑腿与医生原话客观记录的信息撮合与服务管理平台。</p>
        <p><strong>2. 实名与患者知情同意：</strong>代父母预约的子女须确保就诊患者本人知情同意（重度失能老人可由陪诊师上门接手现场核验），明确授权诊后报告共享亲属名单。</p>
        <p><strong>3. 透明计费与阶梯退改：</strong>平台实行基础时长费+失能分级费明码标价，绝无医院黄牛加价；距服务开始48小时以上免费全额退款，临期取消按公示比例扣除运力空置补贴。</p>
      `
    },
    privacy: {
      title: '《医疗健康敏感个人信息保护政策》（符合《个人信息保护法》）',
      html: `
        <p><strong>1. 最小必要采集原则：</strong>我们仅在您主动预约陪诊、创建家庭长辈档案或录入健康日记时，收集患者姓名、联系手机号、接送地址及必要的慢病照护提示。未登录游客模式下不采集任何设备身份信息。</p>
        <p><strong>2. 医疗报告加密隔离：</strong>陪诊师第4步上传的检验单、病历页及医嘱记录仅对订单创建人及经明确授权的家庭成员开放查阅，严禁向任何第三方营销机构泄露。</p>
        <p><strong>3. 账号注销与彻底删除权：</strong>您可随时在【我的 → 永久注销账号】中一键注销账户，系统将立即销毁全部会话凭证并脱敏清理个人身份数据。</p>
      `
    },
    service: {
      title: '《GB/T 47801—2026 陪诊服务 12 项准做与 7 项严禁告知书》',
      html: `
        <p><strong>【12项标准准做】：</strong>诊前准备提醒、上门/定点接手、无障碍打车协助、共享轮椅借还推行、自助机取号报到、诊室陪同沟通、客观记录医嘱、检查检验陪同、门诊缴费取药、整理商业保险理赔票据、安全送回交接、诊后服药与复检提醒。</p>
        <p><strong>【7项高压严禁红线】：</strong>严禁任何形式倒卖专家号源（黄牛抢号）、严禁擅自解读检验指标或提供医疗诊断建议、严禁篡改或增删医生医嘱、严禁推销保健品或非医嘱药品、严禁代患者签署有创手术知情同意书、严禁泄露患者医疗隐私、严禁私下收受红包或引导场外交易。</p>
      `
    }
  };
  const d = docs[docType] || docs.user;
  document.getElementById('legal-doc-title').textContent = d.title;
  document.getElementById('legal-doc-body').innerHTML = d.html;
  openModal('modal-legal-doc');
}

function openEmergencySos() {
  showToast('【SOS 应急响应已就绪】危急生命体征请立即拨打 120 急救；陪诊现场突发协调专线：400-890-2026（7×24h直通值班长）');
}

function switchToEscortFromMine() {
  requireMobileAuth(() => {
    switchTerminal('b-app');
  }, 'ESCORT');
}

function openInvoiceModal() {
  if (!requireMobileAuth(() => openInvoiceModal(), 'FAMILY')) return;
  const paidOrd = APP_STATE && APP_STATE.orders.find(o => o.payment_status === 'PAID' && o.sop_step >= 0);
  if (paidOrd) {
    document.getElementById('inv-orderno').value = paidOrd.order_no;
    document.getElementById('inv-amount').value = paidOrd.total_price;
  }
  if (MOBILE_USER) {
    document.getElementById('inv-title').value = MOBILE_USER.display_name;
  }
  renderInvoiceHistory();
  openModal('modal-invoice');
}

function renderInvoiceHistory() {
  const box = document.getElementById('inv-history-list');
  if (!box || !APP_STATE) return;
  const list = APP_STATE.invoices || [];
  box.innerHTML = list.length === 0
    ? '<div class="text-subtle">暂无历史开票记录，提交后即时开具增值税普通电子发票</div>'
    : `<div class="font-bold text-green">已开具发票记录（${list.length}张）：</div>` + list.slice(0, 4).map(inv => `
      <div class="ew-card-paper flex items-center justify-between">
        <div>
          <div class="font-bold">${escapeHtml(inv.invoice_title)}（${escapeHtml(inv.title_type)}）· ¥${Number(inv.amount)}</div>
          <div class="text-subtle" style="font-size:10.5px;">订单 #${escapeHtml(inv.order_no)} → 已发至 ${escapeHtml(inv.email)}</div>
        </div>
        <span class="badge badge-green">已开票</span>
      </div>
    `).join('');
}

async function handleInvoiceSubmit(e) {
  e.preventDefault();
  const btn = document.getElementById('inv-submit-btn');
  const payload = {
    title_type: document.getElementById('inv-type').value,
    order_no: document.getElementById('inv-orderno').value,
    invoice_title: document.getElementById('inv-title').value,
    tax_no: document.getElementById('inv-taxno').value,
    amount: Number(document.getElementById('inv-amount').value),
    email: document.getElementById('inv-email').value
  };
  const json = await apiRequest('/api/invoices', { method: 'POST', body: payload }, btn);
  if (json) {
    renderInvoiceHistory();
    showToast(`电子发票（¥${payload.amount}）已成功开具并发送至 ${payload.email}！`);
  }
}

function openReviewModal(orderId) {
  if (!requireMobileAuth(() => openReviewModal(orderId), 'FAMILY')) return;
  const ord = APP_STATE && APP_STATE.orders.find(o => o.id === orderId);
  if (!ord) return;
  ACTIVE_REVIEW_ORDER_ID = ord.id;
  document.getElementById('ra-modal-title').textContent = `评价陪诊师 ${ord.escort_name || ''}（#${ord.order_no}）`;
  selectReviewStar(ord.rating_score > 0 ? ord.rating_score : 5);
  if (ord.rating_comment) document.getElementById('ra-comment-input').value = ord.rating_comment;
  openModal('modal-review-aftersale');
}

function selectReviewStar(n) {
  CURRENT_REVIEW_STAR = n;
  const labels = { 1: '1.0 分 · 非常不满', 2: '2.0 分 · 有待改进', 3: '3.0 分 · 一般', 4: '4.0 分 · 比较满意', 5: '5.0 分 · 非常满意' };
  document.querySelectorAll('#ra-stars-row .star-btn').forEach((btn, idx) => {
    btn.classList.toggle('lit', idx < n);
  });
  document.getElementById('ra-star-label').textContent = labels[n] || '5.0 分';
}

async function submitOrderReview(btnEl) {
  if (!ACTIVE_REVIEW_ORDER_ID) return;
  const json = await apiRequest(`/api/orders/${ACTIVE_REVIEW_ORDER_ID}/review`, {
    method: 'POST',
    body: {
      score: CURRENT_REVIEW_STAR,
      comment: document.getElementById('ra-comment-input').value
    }
  }, btnEl);
  if (json) {
    closeModal('modal-review-aftersale');
    showToast(`感谢您的 ${CURRENT_REVIEW_STAR} 星评价！陪诊师综合服务分已实时更新`);
  }
}

async function submitOrderAfterSale(btnEl) {
  if (!ACTIVE_REVIEW_ORDER_ID) return;
  const reason = document.getElementById('ra-comment-input').value.trim();
  const json = await apiRequest(`/api/orders/${ACTIVE_REVIEW_ORDER_ID}/after-sale`, {
    method: 'POST',
    body: { reason }
  }, btnEl);
  if (json) {
    closeModal('modal-review-aftersale');
    showToast('售后/投诉工单已提交！平台品控台已亮起红标提醒并将在30分钟内介入处理');
  }
}

function openImagePreview(url) {
  const img = document.getElementById('preview-img-el');
  if (img) img.src = url;
  openModal('modal-image-preview');
}


// ==================== Part 2B-2: 真图上传 / 陪诊师工作台 / 管理后台 RBAC 与初始化 ====================
function renderStep4UploadedThumbs() {
  const box = document.getElementById('s4-uploaded-preview');
  if (!box) return;
  if (!STEP4_UPLOADED_URLS.length) {
    box.innerHTML = '<span class="text-subtle">暂未附加照片，点击上方选择本地检验单或票据图片</span>';
    return;
  }
  box.innerHTML = STEP4_UPLOADED_URLS.map((url, idx) => `
    <div style="position:relative;display:inline-block;">
      <img src="${escapeHtml(url)}" alt="待归档单据${idx + 1}" class="slip-thumb" onclick="openImagePreview('${escapeHtml(url)}')" />
      <button type="button" onclick="removeStep4Thumb(${idx})" title="移除" style="position:absolute;top:-6px;right:-6px;width:18px;height:18px;border-radius:999px;background:#c53939;color:#fff;font-size:10px;line-height:18px;text-align:center;">✕</button>
    </div>
  `).join('');
}

function removeStep4Thumb(idx) {
  STEP4_UPLOADED_URLS.splice(idx, 1);
  renderStep4UploadedThumbs();
}

function handleStep4FileSelect(e) {
  const files = Array.from((e.target && e.target.files) || []).slice(0, 4);
  if (!files.length) return;
  files.forEach(file => {
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result;
      const json = await apiRequest('/api/upload', {
        method: 'POST',
        body: { filename: file.name, data_url: dataUrl }
      });
      if (json && json.url) {
        STEP4_UPLOADED_URLS.push(json.url);
        renderStep4UploadedThumbs();
        showToast(`单据实拍图【${file.name}】已上传至服务器归档目录！`);
      }
    };
    reader.readAsDataURL(file);
  });
  e.target.value = '';
}

function selectEscortIdentity(escortId) {
  CURRENT_ESCORT_ID = Number(escortId);
  savePref('ew_escort_id', CURRENT_ESCORT_ID);
  renderBApp();
  updateGlobalBadgesAndLoop();
}

function jumpToEscortForOrder(orderId) {
  const ord = APP_STATE && APP_STATE.orders.find(o => o.id === orderId);
  if (ord && ord.escort_id) {
    CURRENT_ESCORT_ID = Number(ord.escort_id);
    savePref('ew_escort_id', CURRENT_ESCORT_ID);
  }
  switchTerminal('b-app');
  renderBApp();
}

async function toggleCurrentEscortSchedule(btnEl) {
  const json = await apiRequest(`/api/escorts/${CURRENT_ESCORT_ID}/toggle-schedule`, { method: 'POST' }, btnEl);
  if (json) {
    showToast(json.schedule_status === 'AVAILABLE' ? '已恢复【排班听单中】状态，后台派单优先推荐' : '已切换为【小休暂停派单】状态');
  }
}

function renderBApp() {
  if (!APP_STATE || !APP_STATE.escorts || !APP_STATE.escorts.length) return;
  const curEscort = APP_STATE.escorts.find(e => e.id === CURRENT_ESCORT_ID) || APP_STATE.escorts[0];

  const swList = document.getElementById('escort-switcher-list');
  if (swList) {
    swList.innerHTML = APP_STATE.escorts.map(esc => {
      const activeCnt = APP_STATE.orders.filter(o => o.escort_id === esc.id && o.sop_step >= 1 && o.sop_step < 5).length;
      const isCur = esc.id === curEscort.id;
      return `
        <button type="button" onclick="selectEscortIdentity(${Number(esc.id)})" class="w-full text-left ew-card-paper flex items-center justify-between" style="cursor:pointer;background:${isCur ? '#16453c' : '#1b312d'};border-color:${isCur ? '#43a089' : '#2e5049'};color:#fff;">
          <div>
            <div class="font-extrabold">${escapeHtml(esc.name)} · ${escapeHtml(esc.city || (esc.hospitals.includes('华西') ? '成都' : '北京'))} <span class="badge badge-green" style="margin-left:4px;">★${Number(esc.rating).toFixed(2)}</span></div>
            <div style="font-size:11px;color:#abd0c4;margin-top:2px;">备案手机：${escapeHtml(esc.phone)} ｜ ${escapeHtml(esc.org_name)}</div>
          </div>
          <span class="badge ${activeCnt > 0 ? 'badge-orange' : 'badge-gray'}">${activeCnt} 单进行中</span>
        </button>
      `;
    }).join('');
  }

  document.getElementById('bapp-escort-name').textContent = `${curEscort.name} · 陪诊师工作台`;
  document.getElementById('bapp-escort-meta').textContent = `${curEscort.org_name} ｜ 健康证至 ${curEscort.health_cert_expiry}`;
  const schedBtn = document.getElementById('bapp-schedule-btn');
  if (schedBtn) {
    const avail = curEscort.schedule_status === 'AVAILABLE';
    schedBtn.textContent = avail ? '● 排班听单中' : '○ 小休暂停中';
    schedBtn.className = `badge ${avail ? 'badge-solid-green' : 'badge-orange'}`;
  }

  const statsEl = document.getElementById('bapp-escort-stats');
  if (statsEl) {
    statsEl.innerHTML = `
      <div><div class="text-lg font-extrabold text-green">${Number(curEscort.completed_orders)}</div><div class="text-subtle" style="font-size:10.5px;">累计完单</div></div>
      <div><div class="text-lg font-extrabold text-orange">¥${Number(curEscort.total_earned).toFixed(0)}</div><div class="text-subtle" style="font-size:10.5px;">累计分成收入</div></div>
      <div><div class="text-lg font-extrabold text-green">${Number(curEscort.rating).toFixed(2)}</div><div class="text-subtle" style="font-size:10.5px;">家属综合评分</div></div>
    `;
  }

  const listEl = document.getElementById('bapp-orders-list');
  if (!listEl) return;
  const myOrders = APP_STATE.orders.filter(o => o.escort_id === curEscort.id && o.sop_step >= 1);
  if (!myOrders.length) {
    listEl.innerHTML = `
      <div class="ew-card text-center py-6 space-y-2">
        <div class="font-extrabold text-green">当前名下暂无进行中陪诊单</div>
        <div class="text-muted">可在左侧切换其他陪诊师，或前往【4. 管理与机构后台】将待派订单指派给 ${escapeHtml(curEscort.name)}</div>
      </div>
    `;
    return;
  }

  const stepDefs = [
    { step: 1, title: '第1步：确认接单 & 核对挂号状态' },
    { step: 2, title: '第2步：到达接手位置 LBS 签到' },
    { step: 3, title: '第3步：院内陪诊中 & 实时播报' },
    { step: 4, title: '第4步：上传真图报告/理赔单 & 录医嘱' },
    { step: 5, title: '第5步：送回交接完结 & 自动分账入账' }
  ];
  const quickNotes = [
    '已在共享轮椅点完成借车消毒，正陪同长辈乘无障碍电梯前往诊区报到',
    '已进入诊室陪同长辈向主任陈述病史，正在客观记录医生原话医嘱',
    '已完成门诊抽血/拍片检查陪同，正在自助缴费机打印电子发票与费用清单'
  ];

  listEl.innerHTML = myOrders.map(ord => `
    <div class="ew-card space-y-2.5" style="padding:13px;border:1.5px solid #9fd0b9;">
      <div class="flex items-center justify-between">
        <span class="font-extrabold">#${escapeHtml(ord.order_no)} · ${escapeHtml(ord.patient_name)}</span>
        <span class="badge badge-orange">本单分成 ¥${Number(ord.provider_payout)}</span>
      </div>
      <div class="font-bold text-green">${escapeHtml(ord.hospital_name)} · ${escapeHtml(ord.department)} (${escapeHtml(ord.visit_date)})</div>
      <div class="ew-card-paper space-y-1" style="font-size:11px;">
        <div><strong>行动分级：</strong>${escapeHtml(ord.mobility_level)}</div>
        <div><strong>接手地址：</strong>${escapeHtml(ord.pickup_address)}</div>
        <div><strong>患者确认(+)：</strong>${escapeHtml(ord.patient_confirm_method)}</div>
      </div>

      ${ord.sop_step === 3 ? `
        <div class="ew-card-mint space-y-1.5">
          <div class="font-bold text-green">第3步院内实时播报快捷同步（点击即推向家属端）：</div>
          ${quickNotes.map((qn, idx) => `
            <button type="button" onclick="broadcastStep3QuickNote(${Number(ord.id)}, ${idx}, this)" class="btn-soft w-full text-left" style="font-size:11px;padding:6px 8px;background:#fff;">
              ● ${escapeHtml(qn)}
            </button>
          `).join('')}
        </div>
      ` : ''}

      <div class="space-y-1.5">
        ${stepDefs.map(sd => {
          const done = ord.sop_step >= sd.step;
          const isNext = ord.sop_step === sd.step - 1 || (sd.step === 4 && ord.sop_step === 3);
          return `
            <button type="button"
              onclick="handleEscortStepClick(${Number(ord.id)}, ${sd.step}, '', this)"
              class="w-full flex items-center justify-between ${done ? 'btn-soft' : (isNext ? 'btn-primary' : 'btn-outline')}"
              style="padding:8px 11px;font-size:11.5px;${done ? 'background:var(--ew-mint-soft);border-color:#9fd0b9;color:#075e50;' : ''}">
              <span>${done ? '✓ ' : ''}${sd.title}</span>
              <span>${done ? '已完成' : (sd.step === 4 ? '传图录医嘱 →' : '立即打卡 →')}</span>
            </button>
          `;
        }).join('')}
      </div>
    </div>
  `).join('');
}

const STEP3_QUICK_NOTES = [
  '已在共享轮椅点完成借车消毒，正陪同长辈乘无障碍电梯前往诊区报到',
  '已进入诊室陪同长辈向主任陈述病史，正在客观记录医生原话医嘱',
  '已完成门诊抽血/拍片检查陪同，正在自助缴费机打印电子发票与费用清单'
];

async function broadcastStep3QuickNote(orderId, noteIdx, btnEl) {
  const note = STEP3_QUICK_NOTES[noteIdx] || STEP3_QUICK_NOTES[0];
  const json = await apiRequest(`/api/orders/${orderId}/step`, {
    method: 'POST',
    body: { step: 3, progress_note: note }
  }, btnEl);
  if (json) showToast('院内实时动态已同步推送至 C 端家属看板！');
}

async function handleEscortStepClick(orderId, stepNum, customNote = '', btnEl = null) {
  if (stepNum === 4) {
    ACTIVE_STEP4_ORDER_ID = orderId;
    renderStep4UploadedThumbs();
    openModal('modal-step4-report');
    return;
  }
  const json = await apiRequest(`/api/orders/${orderId}/step`, {
    method: 'POST',
    body: { step: stepNum, progress_note: customNote }
  }, btnEl);
  if (json) {
    showToast(stepNum === 5
      ? '第5步安全交接已完成！服务费已自动完成平台抽佣（≤10%）与陪诊师分账结算'
      : `已完成第 ${stepNum} 步履约节点打卡，家属端进度条已同步更新！`);
  }
}

async function submitStep4Report(e) {
  e.preventDefault();
  if (!ACTIVE_STEP4_ORDER_ID) return;
  const btn = document.getElementById('s4-submit-btn');
  const payload = {
    step: 4,
    doctor_advice: document.getElementById('s4-advice').value,
    drug_name: document.getElementById('s4-drug').value,
    drug_freq: document.getElementById('s4-freq').value,
    recheck_date: document.getElementById('s4-recheck-date').value,
    authorized_viewers: document.getElementById('s4-viewers').value,
    uploaded_urls: STEP4_UPLOADED_URLS.length ? STEP4_UPLOADED_URLS : ['/uploads/sample-lab-report.svg']
  };
  const json = await apiRequest(`/api/orders/${ACTIVE_STEP4_ORDER_ID}/step`, {
    method: 'POST',
    body: payload
  }, btn);
  if (json) {
    closeModal('modal-step4-report');
    showToast('第4步真图报告与医嘱已归档！C端已同步生成【结果报告/服药打卡/复检提醒/理赔包】');
  }
}

// ==================== 4. Admin Gate & RBAC Console ====================
function renderAdminGateState() {
  const gate = document.getElementById('admin-login-gate');
  const ws = document.getElementById('admin-authed-workspace');
  if (!gate || !ws) return;
  if (ADMIN_TOKEN && ADMIN_USER) {
    gate.classList.add('hidden');
    ws.classList.remove('hidden');
    const roleBadge = document.getElementById('adm-role-badge');
    const userLabel = document.getElementById('adm-user-label');
    if (roleBadge) {
      roleBadge.textContent = ADMIN_USER.role === 'ORG_ADMIN' ? 'B端合作护工机构子后台' : '平台总控管理员';
      roleBadge.className = `badge ${ADMIN_USER.role === 'ORG_ADMIN' ? 'badge-orange' : 'badge-green'}`;
    }
    if (userLabel) {
      userLabel.textContent = `当前登录：${ADMIN_USER.display_name}（账号 ${ADMIN_USER.username}）`;
    }
  } else {
    gate.classList.remove('hidden');
    ws.classList.add('hidden');
  }
}

function quickFillAdmin(u, p) {
  document.getElementById('adm-login-user').value = u;
  document.getElementById('adm-login-pass').value = p;
}

async function handleAdminLoginSubmit(e) {
  e.preventDefault();
  const btn = document.getElementById('adm-login-btn');
  const username = document.getElementById('adm-login-user').value.trim();
  const password = document.getElementById('adm-login-pass').value;
  const json = await apiRequest('/api/auth/admin-login', {
    method: 'POST',
    body: { username, password }
  }, btn);
  if (json && json.token) {
    ADMIN_TOKEN = json.token;
    ADMIN_USER = json.user;
    savePref('ew_admin_token', ADMIN_TOKEN);
    saveJsonPref('ew_admin_user', ADMIN_USER);
    await apiRequest('/api/bootstrap', { useAdminToken: true });
    renderAdminGateState();
    showToast(`欢迎进入管理后台：${json.user.display_name}`);
  }
}

async function switchAdminDemoAccount() {
  const nextUser = (ADMIN_USER && ADMIN_USER.username === 'admin') ? 'org_bj' : 'admin';
  const nextPass = nextUser === 'admin' ? 'Everwell2026' : 'Org2026';
  const json = await apiRequest('/api/auth/admin-login', {
    method: 'POST',
    body: { username: nextUser, password: nextPass }
  });
  if (json && json.token) {
    ADMIN_TOKEN = json.token;
    ADMIN_USER = json.user;
    savePref('ew_admin_token', ADMIN_TOKEN);
    saveJsonPref('ew_admin_user', ADMIN_USER);
    await apiRequest('/api/bootstrap', { useAdminToken: true });
    renderAdminGateState();
    showToast(`已切换后台角色至：${json.user.display_name}（自动应用 RBAC 数据隔离）`);
  }
}

async function handleAdminLogout() {
  await apiRequest('/api/auth/logout', { method: 'POST', useAdminToken: true });
  ADMIN_TOKEN = '';
  ADMIN_USER = null;
  savePref('ew_admin_token', '');
  saveJsonPref('ew_admin_user', null);
  await apiRequest('/api/bootstrap');
  renderAdminGateState();
  showToast('已退出管理后台，返回安全密码登录门户');
}

function setAdminOrderFilter(filterKey) {
  CURRENT_ADM_FILTER = filterKey;
  savePref('ew_adm_filter', filterKey);
  renderAdmin();
}

function renderAdmin() {
  renderAdminGateState();
  if (!APP_STATE) return;
  const st = APP_STATE.stats;

  const kpiEl = document.getElementById('adm-kpi-cards');
  if (kpiEl) {
    kpiEl.innerHTML = `
      <div class="ew-card" style="padding:14px;">
        <div class="text-muted">可见订单总数 / 待支付</div>
        <div class="text-2xl font-extrabold text-green mt-1">${Number(st.orderCount)} <span class="text-xs text-orange font-bold">(待付 ${Number(st.unpaidCount || 0)})</span></div>
      </div>
      <div class="ew-card" style="padding:14px;">
        <div class="text-muted">已付待派单 / 履约中</div>
        <div class="text-2xl font-extrabold text-orange mt-1">${Number(st.pendingDispatchCount)} <span class="text-xs text-green font-bold">/ ${Number(st.activeServiceCount)} 进行中</span></div>
      </div>
      <div class="ew-card" style="padding:14px;">
        <div class="text-muted">平台撮合净提成 (≤10%)</div>
        <div class="text-2xl font-extrabold text-green mt-1">¥${Number(st.totalPlatformFee).toFixed(2)}</div>
      </div>
      <div class="ew-card" style="padding:14px;">
        <div class="text-muted">扩展导流收入 / 待办售后</div>
        <div class="text-2xl font-extrabold text-green mt-1">¥${Number(st.totalAdRevenue).toFixed(1)} <span class="text-xs ${st.openAfterSaleCount > 0 ? 'text-danger' : 'text-muted'} font-bold">(售后 ${Number(st.openAfterSaleCount || 0)})</span></div>
      </div>
    `;
  }

  const filterDefs = [
    { key: 'ALL', label: `全部 (${APP_STATE.orders.length})` },
    { key: 'UNPAID', label: `待支付 (${APP_STATE.orders.filter(o => o.payment_status === 'UNPAID' && o.sop_step >= 0).length})` },
    { key: 'WAIT_DISPATCH', label: `待派单 (${APP_STATE.orders.filter(o => o.sop_step === 0 && o.payment_status === 'PAID').length})` },
    { key: 'ACTIVE', label: `履约中 (${APP_STATE.orders.filter(o => o.sop_step >= 1 && o.sop_step < 5).length})` },
    { key: 'AFTER_SALE', label: `售后待办 (${APP_STATE.orders.filter(o => o.after_sale_status === 'OPEN').length})` },
    { key: 'DONE', label: `已完结 (${APP_STATE.orders.filter(o => o.sop_step === 5).length})` }
  ];
  const filterRow = document.getElementById('adm-order-filters');
  if (filterRow) {
    filterRow.innerHTML = filterDefs.map(f => `
      <button type="button" onclick="setAdminOrderFilter('${f.key}')" class="filter-pill ${CURRENT_ADM_FILTER === f.key ? 'active' : ''}">${f.label}</button>
    `).join('');
  }

  const filteredOrders = APP_STATE.orders.filter(o => {
    if (CURRENT_ADM_FILTER === 'UNPAID') return o.payment_status === 'UNPAID' && o.sop_step >= 0;
    if (CURRENT_ADM_FILTER === 'WAIT_DISPATCH') return o.sop_step === 0 && o.payment_status === 'PAID';
    if (CURRENT_ADM_FILTER === 'ACTIVE') return o.sop_step >= 1 && o.sop_step < 5;
    if (CURRENT_ADM_FILTER === 'AFTER_SALE') return o.after_sale_status === 'OPEN';
    if (CURRENT_ADM_FILTER === 'DONE') return o.sop_step === 5;
    return true;
  });

  const tbody = document.getElementById('adm-orders-tbody');
  if (tbody) {
    tbody.innerHTML = filteredOrders.map(o => {
      const payBadge = o.payment_status === 'PAID'
        ? `<span class="badge badge-green">已付 · ${escapeHtml(o.pay_channel || '微信支付')}</span>`
        : (o.payment_status === 'REFUNDED' ? `<span class="badge badge-gray">已退 ¥${Number(o.refund_amount)}</span>` : `<span class="badge badge-red">未支付拦截</span>`);
      return `
        <tr style="border-bottom:1px solid var(--ew-line);">
          <td style="padding:10px 11px;">
            <div class="font-extrabold">#${escapeHtml(o.order_no)}</div>
            <div class="mt-1">${payBadge}</div>
            ${o.pay_trade_no ? `<div class="text-subtle" style="font-size:10px;">流水 ${escapeHtml(o.pay_trade_no)}</div>` : ''}
          </td>
          <td style="padding:10px 11px;">
            <div class="font-bold">${escapeHtml(o.patient_name)}</div>
            <div class="text-subtle">${escapeHtml(o.contact_phone)}</div>
            <span class="badge badge-orange mt-1">${escapeHtml(o.mobility_level)}</span>
          </td>
          <td style="padding:10px 11px;">
            <div class="font-bold">${escapeHtml(o.city)} · ${escapeHtml(o.hospital_name)}</div>
            <div class="text-muted">${escapeHtml(o.department)} ｜ ${escapeHtml(o.visit_date)}</div>
          </td>
          <td style="padding:10px 11px;">
            <span class="badge ${o.patient_confirm_status === 'CONFIRMED' ? 'badge-green' : 'badge-orange'}">
              ${o.patient_confirm_status === 'CONFIRMED' ? '✓ 已获患者授权' : '待患者确认'}
            </span>
            <div class="text-subtle mt-1" style="max-width:150px;font-size:10.5px;">${escapeHtml(o.patient_confirm_method)}</div>
          </td>
          <td style="padding:10px 11px;">
            <div class="font-extrabold">¥${Number(o.total_price)}</div>
            <div class="text-green" style="font-size:11px;">提成(${Math.round(Number(o.commission_rate) * 100)}%)：¥${Number(o.platform_fee)}</div>
            <div class="text-muted" style="font-size:11px;">服务方得：¥${Number(o.provider_payout)}</div>
          </td>
          <td style="padding:10px 11px;">
            <div class="font-bold">${escapeHtml(o.escort_name || '待指派')}</div>
            <div class="text-subtle">SOP：${o.sop_step === -1 ? '已退单' : `第 ${o.sop_step}/5 步`}</div>
            ${o.rating_score > 0 ? `<div class="text-orange font-bold">客户评价：${Number(o.rating_score)}★</div>` : ''}
            ${o.after_sale_status === 'OPEN' ? `<div class="badge badge-red mt-1">售后待办：${escapeHtml(o.after_sale_reason)}</div>` : ''}
            ${o.after_sale_status === 'RESOLVED' ? `<div class="badge badge-green mt-1">${escapeHtml(o.after_sale_reason)}</div>` : ''}
          </td>
          <td style="padding:10px 11px;">
            <div class="flex flex-col gap-1">
              ${o.sop_step >= 0 && o.sop_step < 5 && o.payment_status === 'PAID'
                ? `<button type="button" onclick="openDispatchModalForOrder(${Number(o.id)})" class="btn-primary" style="padding:5px 9px;font-size:11px;">${o.escort_id ? '改派陪诊师' : '智能派单'}</button>`
                : ''}
              ${o.after_sale_status === 'OPEN'
                ? `<button type="button" onclick="resolveOrderAfterSale(${Number(o.id)}, this)" class="btn-orange" style="padding:5px 9px;font-size:11px;">办结售后工单</button>`
                : ''}
              <button type="button" onclick="openOrderEventsModal(${Number(o.id)})" class="btn-soft" style="padding:4px 9px;font-size:11px;">审计时间轴</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  const commBox = document.getElementById('adm-commercial-list');
  if (commBox) {
    commBox.innerHTML = APP_STATE.commercialSlots.map(s => `
      <div class="ew-card-paper flex items-center justify-between gap-2">
        <div>
          <span class="badge badge-green">${escapeHtml(s.slot_type)}(+)</span>
          <span class="font-bold ml-1">${escapeHtml(s.title)}</span>
          <div class="text-subtle mt-1">${escapeHtml(s.partner_name)} · 单次导流 ¥${Number(s.cpc_revenue)}</div>
        </div>
        <div class="text-right whitespace-nowrap">
          <div class="font-extrabold text-orange">${Number(s.clicks)} 次点击</div>
          <div class="text-green font-bold">¥${(Number(s.clicks) * Number(s.cpc_revenue)).toFixed(1)}</div>
        </div>
      </div>
    `).join('');
  }

  const appBox = document.getElementById('adm-applications-list');
  if (appBox) {
    appBox.innerHTML = APP_STATE.applications.slice(0, 5).map(a => `
      <div class="ew-card-paper flex items-center justify-between gap-2">
        <div>
          <span class="badge ${a.apply_type === 'ORG' ? 'badge-blue' : 'badge-green'}">${a.apply_type === 'ORG' ? 'B端机构' : '个人陪诊师'}</span>
          <span class="font-bold ml-1">${escapeHtml(a.name)}（${escapeHtml(a.city)}）</span>
          <div class="text-subtle mt-1">${escapeHtml(a.phone)} ｜ ${escapeHtml(a.qualification)}</div>
        </div>
        ${a.status === 'PENDING'
          ? `<button type="button" onclick="approveApplication(${Number(a.id)}, this)" class="btn-primary whitespace-nowrap" style="padding:5px 10px;font-size:11px;">准入通过</button>`
          : `<span class="badge badge-solid-green whitespace-nowrap">已准入</span>`}
      </div>
    `).join('');
  }

  const escSum = document.getElementById('adm-escorts-summary');
  if (escSum) {
    const visibleEscorts = (ADMIN_USER && ADMIN_USER.role === 'ORG_ADMIN' && ADMIN_USER.org_id)
      ? APP_STATE.escorts.filter(e => e.org_id === ADMIN_USER.org_id)
      : APP_STATE.escorts;
    escSum.innerHTML = `<div class="font-bold text-green">在册持证陪诊员运力池（当前可见 ${visibleEscorts.length} 名）：</div>` +
      visibleEscorts.map(e => `
        <div class="flex items-center justify-between text-muted">
          <span>${escapeHtml(e.name)} · ${escapeHtml(e.org_name)} (${escapeHtml(e.skills)})</span>
          <span class="${e.schedule_status === 'AVAILABLE' ? 'text-green font-bold' : 'text-orange'}">${e.schedule_status === 'AVAILABLE' ? '● 听单中' : '○ 小休'} · ★${Number(e.rating).toFixed(2)}</span>
        </div>
      `).join('');
  }
}

async function resolveOrderAfterSale(orderId, btnEl) {
  const json = await apiRequest(`/api/orders/${orderId}/resolve-after-sale`, {
    method: 'POST',
    useAdminToken: true,
    body: { reply: '品控专员已核实服务录音与轨迹，完成家属回访慰问并妥善结案' }
  }, btnEl);
  if (json) showToast('售后工单已办结并写入全链路审计流水！');
}

function openDispatchModalForOrder(orderId) {
  const ord = APP_STATE && APP_STATE.orders.find(o => o.id === orderId);
  if (!ord) return;
  if (ord.payment_status === 'UNPAID') {
    showToast('该订单尚未支付，请先完成收银台付款后再派单', true);
    return;
  }
  ACTIVE_DISPATCH_ORDER_ID = ord.id;
  document.getElementById('dispatch-modal-title').textContent = `指派陪诊师 · #${ord.order_no}（${ord.hospital_name} · ${ord.mobility_level}）`;

  const reqCode = String(ord.mobility_level).slice(0, 2);
  const candidates = APP_STATE.escorts
    .filter(e => !(ADMIN_USER && ADMIN_USER.role === 'ORG_ADMIN' && ADMIN_USER.org_id && e.org_id !== ADMIN_USER.org_id))
    .map(esc => {
      let score = 60;
      if (String(esc.skills).includes(reqCode)) score += 20;
      if (String(esc.hospitals).includes(ord.hospital_name.slice(0, 4))) score += 15;
      if (esc.schedule_status === 'AVAILABLE') score += 5;
      return { ...esc, matchScore: Math.min(99, score) };
    })
    .sort((a, b) => b.matchScore - a.matchScore);

  document.getElementById('dispatch-candidates-list').innerHTML = candidates.map(c => `
    <div class="ew-card-paper flex items-center justify-between gap-3">
      <div>
        <div class="font-extrabold text-sm">${escapeHtml(c.name)} <span class="badge badge-green">匹配度 ${c.matchScore}%</span> <span class="badge badge-orange">★${Number(c.rating).toFixed(2)}</span></div>
        <div class="text-muted mt-1">${escapeHtml(c.org_name)} ｜ 资质：${escapeHtml(c.cert_title)}</div>
        <div class="text-subtle" style="font-size:11px;">技能：${escapeHtml(c.skills)} ｜ 熟院：${escapeHtml(c.hospitals)}</div>
      </div>
      <button type="button" onclick="confirmDispatchToEscort(${Number(c.id)}, this)" class="btn-primary whitespace-nowrap">指派TA接单</button>
    </div>
  `).join('');

  openModal('modal-dispatch');
}

async function confirmDispatchToEscort(escortId, btnEl) {
  if (!ACTIVE_DISPATCH_ORDER_ID) return;
  const json = await apiRequest(`/api/orders/${ACTIVE_DISPATCH_ORDER_ID}/dispatch`, {
    method: 'POST',
    useAdminToken: true,
    body: { escort_id: escortId }
  }, btnEl);
  if (json) {
    CURRENT_ESCORT_ID = Number(escortId);
    savePref('ew_escort_id', CURRENT_ESCORT_ID);
    closeModal('modal-dispatch');
    showToast('派单成功！订单已推送至该陪诊师工作台，可前往【3. 陪诊师接单台】打卡履约');
  }
}

async function openOrderEventsModal(orderId) {
  const ord = APP_STATE && APP_STATE.orders.find(o => o.id === orderId);
  document.getElementById('events-modal-title').textContent = ord
    ? `订单 #${ord.order_no} 全链路合规审计时间轴`
    : '订单履约时间轴';
  const json = await apiRequest(`/api/orders/${orderId}/events`);
  if (!json || !json.events) return;
  document.getElementById('events-timeline-box').innerHTML = json.events.map(ev => `
    <div class="audit-item">
      <div class="flex items-center justify-between">
        <span class="font-extrabold text-green">${escapeHtml(ev.title)}</span>
        <span class="text-subtle" style="font-size:10.5px;">${escapeHtml(ev.created_at)}</span>
      </div>
      <div class="text-muted mt-1">${escapeHtml(ev.detail)}</div>
      <div class="text-subtle mt-1" style="font-size:10.5px;">操作主体：${escapeHtml(ev.operator)}</div>
    </div>
  `).join('');
  openModal('modal-order-events');
}

async function approveApplication(appId, btnEl) {
  const json = await apiRequest(`/api/applications/${appId}/approve`, {
    method: 'POST',
    useAdminToken: true
  }, btnEl);
  if (json) showToast('审批通过！已自动转入在册运力池并开通前3年免押金权益');
}

async function handleAddCommercialSubmit(e) {
  e.preventDefault();
  const btn = document.getElementById('cm-submit-btn');
  const payload = {
    slot_type: document.getElementById('cm-type').value,
    cpc_revenue: Number(document.getElementById('cm-cpc').value),
    title: document.getElementById('cm-title').value,
    partner_name: document.getElementById('cm-partner').value,
    price_tag: document.getElementById('cm-price').value,
    subtitle: document.getElementById('cm-sub').value
  };
  const json = await apiRequest('/api/commercial', {
    method: 'POST',
    useAdminToken: true,
    body: payload
  }, btn);
  if (json) {
    closeModal('modal-add-commercial');
    e.target.reset();
    showToast('新商业合作入口已上架至 C 端并开始实时统计导流收入！');
  }
}

// ==================== Bootstrapping ====================
window.addEventListener('DOMContentLoaded', async () => {
  switchTerminal(CURRENT_TERMINAL, true);
  switchCAppTab(CURRENT_CAPP_TAB);
  recalcWebPrice();
  recalcMobilePrice();
  renderStep4UploadedThumbs();

  // Verify saved tokens cleanly so stale sessions never desync UI
  if (MOBILE_TOKEN) {
    const me = await apiRequest('/api/auth/me', { token: MOBILE_TOKEN });
    if (!me || !me.authenticated) {
      MOBILE_TOKEN = '';
      MOBILE_USER = null;
      savePref('ew_mobile_token', '');
      saveJsonPref('ew_mobile_user', null);
    } else {
      MOBILE_USER = me.user;
      saveJsonPref('ew_mobile_user', MOBILE_USER);
    }
  }
  if (ADMIN_TOKEN) {
    const admMe = await apiRequest('/api/auth/me', { token: ADMIN_TOKEN });
    if (!admMe || !admMe.authenticated) {
      ADMIN_TOKEN = '';
      ADMIN_USER = null;
      savePref('ew_admin_token', '');
      saveJsonPref('ew_admin_user', null);
    } else {
      ADMIN_USER = admMe.user;
      saveJsonPref('ew_admin_user', ADMIN_USER);
    }
  }

  await apiRequest('/api/bootstrap', { useAdminToken: Boolean(ADMIN_TOKEN) });
  await runAiTriage();
  await handleWebOrderLookup();
});
