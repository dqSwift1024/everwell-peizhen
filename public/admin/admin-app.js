/* ==========================================================================
   健康来敲门 Everwell · 应用4：运营总控与合作机构 SaaS 管理后台引擎 (public/admin/admin-app.js)
   ========================================================================== */

let SAAS_TOKEN = localStorage.getItem('ew_admin_token') || '';
let SAAS_USER = JSON.parse(localStorage.getItem('ew_admin_user') || 'null');
let SAAS_STATE = null;
let SAAS_MOD = 'dashboard';
let SAAS_ORD_FILTER = 'ALL';
let ACTIVE_DISP_ORD_ID = null;

function escapeHtml(val) {
  if (val === undefined || val === null) return '';
  return String(val)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function showToast(msg, isErr = false) {
  const el = document.getElementById('global-toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden', 'error');
  if (isErr) el.classList.add('error');
  clearTimeout(window.__saasToast);
  window.__saasToast = setTimeout(() => el.classList.add('hidden'), 4200);
}

function openModal(id) { document.getElementById(id)?.classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id)?.classList.add('hidden'); }

document.addEventListener('click', e => {
  if (e.target && e.target.classList && e.target.classList.contains('modal-backdrop')) {
    e.target.classList.add('hidden');
  }
});

async function saasApi(path, opts = {}, btnEl = null) {
  if (btnEl && btnEl.disabled) return null;
  const orig = btnEl ? btnEl.innerHTML : '';
  if (btnEl) btnEl.disabled = true;
  try {
    const headers = {};
    if (opts.body) headers['Content-Type'] = 'application/json';
    if (SAAS_TOKEN) headers['Authorization'] = `Bearer ${SAAS_TOKEN}`;
    const res = await fetch(path, {
      method: opts.method || 'GET',
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    const json = await res.json();
    if (!res.ok || !json.ok) {
      showToast(json.msg || `请求失败 (${res.status})`, true);
      return null;
    }
    if (json.data) {
      SAAS_STATE = json.data;
      renderAllSaasModules();
    }
    return json;
  } catch (_) {
    showToast('网络请求异常，请检查连接', true);
    return null;
  } finally {
    if (btnEl) {
      btnEl.disabled = false;
      btnEl.innerHTML = orig;
    }
  }
}

function fillSaasCred(u, p) {
  document.getElementById('saas-user').value = u;
  document.getElementById('saas-pass').value = p;
}

async function handleSaasLogin(e) {
  e.preventDefault();
  const btn = document.getElementById('saas-login-btn');
  const username = document.getElementById('saas-user').value.trim();
  const password = document.getElementById('saas-pass').value;
  const json = await saasApi('/api/auth/admin-login', {
    method: 'POST',
    body: { username, password }
  }, btn);
  if (json && json.token) {
    SAAS_TOKEN = json.token;
    SAAS_USER = json.user;
    localStorage.setItem('ew_admin_token', SAAS_TOKEN);
    localStorage.setItem('ew_admin_user', JSON.stringify(SAAS_USER));
    syncSaasGate();
    await loadSaasData();
    showToast(`登录成功：${json.user.display_name}`);
  }
}

async function handleSaasLogout() {
  await saasApi('/api/auth/logout', { method: 'POST' });
  SAAS_TOKEN = '';
  SAAS_USER = null;
  localStorage.removeItem('ew_admin_token');
  localStorage.removeItem('ew_admin_user');
  syncSaasGate();
  showToast('已安全退出管理中台');
}

function syncSaasGate() {
  const gate = document.getElementById('saas-login-gate');
  const ws = document.getElementById('saas-workspace');
  if (SAAS_TOKEN && SAAS_USER && ['ADMIN', 'ORG_ADMIN'].includes(SAAS_USER.role)) {
    gate.classList.add('hidden');
    ws.classList.remove('hidden');
    const isOrg = SAAS_USER.role === 'ORG_ADMIN';
    document.getElementById('saas-side-role').textContent = isOrg ? 'B端合作机构子后台 (数据已隔离)' : '平台运营总控管理员';
    document.getElementById('saas-side-user').textContent = `当前身份：${SAAS_USER.display_name}`;
    document.getElementById('saas-apply-card')?.classList.toggle('hidden', isOrg);
    document.getElementById('saas-add-comm-btn')?.classList.toggle('hidden', isOrg);
  } else {
    gate.classList.remove('hidden');
    ws.classList.add('hidden');
  }
}

function switchSaasMod(mod) {
  SAAS_MOD = mod;
  const titles = {
    dashboard: ['经营数据总览看板', '实时监控 GMV、撮合净收入、三甲医院订单分布与履约留痕'],
    orders: ['订单调度与智能派单台', '未支付订单自动拦截派单；按失能分级与熟院匹配度精准调度'],
    quality: ['服务评价与售后品控中心', '客户星级评价回溯与投诉/售后申诉工单闭环办结'],
    supply: ['护工机构与持证运力准入', 'B端合作陪护公司管理、前3年免押金台账与入驻资质审核'],
    finance: ['财务清分·提现·电子发票台账', '平台 ≤10% 服务费清分核对、陪诊师提现流水与客户发票管理'],
    commercial: ['体检·购药·保险扩展商业化', '高毛利医疗健康周边界导流点击归因与合作位配置']
  };
  const [t, sub] = titles[mod] || titles.dashboard;
  document.getElementById('saas-mod-title').textContent = t;
  document.getElementById('saas-mod-sub').textContent = sub;

  document.querySelectorAll('.saas-mod').forEach(el => el.classList.add('hidden'));
  document.getElementById('smod-' + mod)?.classList.remove('hidden');
  document.querySelectorAll('.saas-nav-item').forEach(b => b.classList.remove('active'));
  document.getElementById('snav-' + mod)?.classList.add('active');
}

async function loadSaasData() {
  await saasApi('/api/bootstrap');
}

function renderAllSaasModules() {
  if (!SAAS_STATE) return;
  const st = SAAS_STATE.stats;
  const pendingApps = SAAS_STATE.applications.filter(a => a.status === 'PENDING').length;

  document.getElementById('sbadge-dispatch').textContent = String(st.pendingDispatchCount);
  const asBadge = document.getElementById('sbadge-aftersale');
  asBadge.textContent = String(st.openAfterSaleCount || 0);
  asBadge.classList.toggle('hidden', !st.openAfterSaleCount);
  document.getElementById('sbadge-apply').textContent = String(pendingApps);

  // 1. Dashboard
  document.getElementById('saas-kpi-grid').innerHTML = `
    <div class="ew-card" style="padding:16px;">
      <div class="text-muted">已付订单交易总额 (GMV)</div>
      <div class="text-2xl font-extrabold text-green mt-1">¥${Number(st.totalGmv || 0).toFixed(2)}</div>
      <div class="text-subtle mt-1">有效订单 ${Number(st.orderCount)} 笔（待支付 ${Number(st.unpaidCount)} 笔）</div>
    </div>
    <div class="ew-card" style="padding:16px;">
      <div class="text-muted">平台撮合净技术服务费 (≤10%)</div>
      <div class="text-2xl font-extrabold text-green mt-1">¥${Number(st.totalPlatformFee).toFixed(2)}</div>
      <div class="text-subtle mt-1">B端机构 8% / 自有人员 6% 自动清分</div>
    </div>
    <div class="ew-card" style="padding:16px;">
      <div class="text-muted">体检·购药·保险扩展导流收入</div>
      <div class="text-2xl font-extrabold text-orange mt-1">¥${Number(st.totalAdRevenue).toFixed(2)}</div>
      <div class="text-subtle mt-1">累计精准导流点击 ${Number(st.totalAdClicks)} 次</div>
    </div>
    <div class="ew-card" style="padding:16px;">
      <div class="text-muted">待派单 / 现场履约中 / 待办售后</div>
      <div class="text-2xl font-extrabold text-orange mt-1">${Number(st.pendingDispatchCount)} / ${Number(st.activeServiceCount)} / <span class="${st.openAfterSaleCount ? 'text-danger' : 'text-green'}">${Number(st.openAfterSaleCount || 0)}</span></div>
      <div class="text-subtle mt-1">累计完结交接 ${Number(st.completedOrderCount)} 单</div>
    </div>
  `;

  document.getElementById('saas-hosp-summary').innerHTML = SAAS_STATE.hospitals.map(h => {
    const cnt = SAAS_STATE.orders.filter(o => o.hospital_name === h.name).length;
    return `
      <div class="ew-card-paper flex items-center justify-between gap-2">
        <div>
          <div class="font-extrabold">${escapeHtml(h.city)} · ${escapeHtml(h.name)} <span class="badge badge-green">${escapeHtml(h.level)}</span></div>
          <div class="text-muted mt-1">优势科室：${escapeHtml(h.strong_depts)}</div>
          <div class="text-subtle" style="font-size:11px;">无障碍轮椅：${escapeHtml(h.wheelchair_guide)}</div>
        </div>
        <span class="badge badge-orange whitespace-nowrap">${cnt} 笔订单</span>
      </div>
    `;
  }).join('');

  document.getElementById('saas-recent-events').innerHTML = (SAAS_STATE.orderEvents || []).slice(-6).reverse().map(ev => `
    <div class="audit-item">
      <div class="flex justify-between"><span class="font-bold text-green">${escapeHtml(ev.title)}</span><span class="text-subtle" style="font-size:10.5px;">${escapeHtml(ev.created_at)}</span></div>
      <div class="text-muted mt-1">${escapeHtml(ev.detail)}（操作人：${escapeHtml(ev.operator)}）</div>
    </div>
  `).join('');

  renderSaasOrders();
  renderSaasQuality();
  renderSaasSupply();
  renderSaasFinance();
  renderSaasCommercial();
}

function setSaasOrderFilter(f) {
  SAAS_ORD_FILTER = f;
  renderSaasOrders();
}

function renderSaasOrders() {
  if (!SAAS_STATE) return;
  const kw = (document.getElementById('saas-order-search')?.value || '').trim().toLowerCase();
  const filters = [
    ['ALL', '全部订单'],
    ['UNPAID', '待支付'],
    ['WAIT', '已付待派单'],
    ['ACTIVE', '现场履约中'],
    ['DONE', '已完结结算'],
    ['CANCEL', '已取消/退款']
  ];
  document.getElementById('saas-order-filters').innerHTML = filters.map(([k, label]) => `
    <button type="button" onclick="setSaasOrderFilter('${k}')" class="filter-pill ${SAAS_ORD_FILTER === k ? 'active' : ''}">${label}</button>
  `).join('');

  const rows = SAAS_STATE.orders.filter(o => {
    if (SAAS_ORD_FILTER === 'UNPAID' && !(o.payment_status === 'UNPAID' && o.sop_step >= 0)) return false;
    if (SAAS_ORD_FILTER === 'WAIT' && !(o.sop_step === 0 && o.payment_status === 'PAID')) return false;
    if (SAAS_ORD_FILTER === 'ACTIVE' && !(o.sop_step >= 1 && o.sop_step < 5)) return false;
    if (SAAS_ORD_FILTER === 'DONE' && o.sop_step !== 5) return false;
    if (SAAS_ORD_FILTER === 'CANCEL' && o.sop_step !== -1) return false;
    if (kw) {
      const hay = `${o.order_no} ${o.patient_name} ${o.contact_phone} ${o.hospital_name} ${o.escort_name || ''}`.toLowerCase();
      if (!hay.includes(kw)) return false;
    }
    return true;
  });

  document.getElementById('saas-orders-tbody').innerHTML = rows.map(o => {
    const payTag = o.payment_status === 'PAID'
      ? `<span class="badge badge-green">已付 · ${escapeHtml(o.pay_channel)}</span>`
      : (o.payment_status === 'REFUNDED' ? `<span class="badge badge-gray">已退 ¥${Number(o.refund_amount)}</span>` : `<span class="badge badge-red">待支付拦截</span>`);
    return `
      <tr style="border-bottom:1px solid var(--ew-line);">
        <td style="padding:10px;">
          <div class="font-extrabold">#${escapeHtml(o.order_no)}</div>
          <div class="text-subtle">${escapeHtml(o.source_channel)}</div>
          <div class="mt-1">${payTag}</div>
        </td>
        <td style="padding:10px;">
          <div class="font-bold">${escapeHtml(o.patient_name)}</div>
          <div class="text-subtle">${escapeHtml(o.contact_phone)}</div>
          <span class="badge badge-orange mt-1">${escapeHtml(o.mobility_level)}</span>
        </td>
        <td style="padding:10px;">
          <div class="font-bold">${escapeHtml(o.city)} · ${escapeHtml(o.hospital_name)}</div>
          <div class="text-muted">${escapeHtml(o.department)} ｜ ${escapeHtml(o.visit_date)}</div>
        </td>
        <td style="padding:10px;">
          <span class="badge ${o.patient_confirm_status === 'CONFIRMED' ? 'badge-green' : 'badge-orange'}">${o.patient_confirm_status === 'CONFIRMED' ? '✓ 已确认授权' : '待患者确认'}</span>
          <div class="text-subtle mt-1" style="max-width:140px;font-size:10.5px;">${escapeHtml(o.patient_confirm_method)}</div>
        </td>
        <td style="padding:10px;">
          <div class="font-extrabold">¥${Number(o.total_price)}</div>
          <div class="text-green">平台 ¥${Number(o.platform_fee)}</div>
          <div class="text-muted">分成 ¥${Number(o.provider_payout)}</div>
        </td>
        <td style="padding:10px;">
          <div class="font-bold">${escapeHtml(o.escort_name || '待指派')}</div>
          <div class="text-subtle">${o.sop_step === -1 ? '已关闭' : `SOP 第 ${o.sop_step}/5 步`}</div>
        </td>
        <td style="padding:10px;">
          <div class="flex flex-col gap-1">
            ${o.sop_step >= 0 && o.sop_step < 5 && o.payment_status === 'PAID'
              ? `<button type="button" onclick="openSaasDispatch(${Number(o.id)})" class="btn-primary" style="padding:5px 10px;font-size:11px;">${o.escort_id ? '改派运力' : '智能派单'}</button>`
              : ''}
            <button type="button" onclick="openSaasEvents(${Number(o.id)})" class="btn-soft" style="padding:4px 9px;font-size:11px;">审计流水</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function renderSaasQuality() {
  const openAs = SAAS_STATE.orders.filter(o => o.after_sale_status !== 'NONE');
  document.getElementById('saas-aftersale-list').innerHTML = openAs.length === 0
    ? '<div class="ew-card-paper text-muted">当前全平台零未结投诉工单，服务履约质量正常</div>'
    : openAs.map(o => `
        <div class="ew-card-paper flex items-center justify-between gap-3">
          <div>
            <div class="font-extrabold">#${escapeHtml(o.order_no)} · ${escapeHtml(o.patient_name)}（承接陪诊师：${escapeHtml(o.escort_name || '未指派')}）</div>
            <div class="text-danger mt-1">诉求内容：${escapeHtml(o.after_sale_reason)}</div>
          </div>
          ${o.after_sale_status === 'OPEN'
            ? `<button type="button" onclick="resolveAfterSaleTicket(${Number(o.id)}, this)" class="btn-orange whitespace-nowrap">核实回访并办结</button>`
            : `<span class="badge badge-green whitespace-nowrap">已妥善结案</span>`}
        </div>
      `).join('');

  const reviewed = SAAS_STATE.orders.filter(o => o.rating_score > 0);
  document.getElementById('saas-reviews-list').innerHTML = reviewed.length === 0
    ? '<div class="ew-card-paper text-muted">暂无新增星级评价记录</div>'
    : reviewed.map(o => `
        <div class="ew-card-paper flex items-center justify-between gap-3">
          <div>
            <div class="font-bold">#${escapeHtml(o.order_no)} · 陪诊师：${escapeHtml(o.escort_name || '')} <span class="text-orange font-extrabold ml-1">${'★'.repeat(Number(o.rating_score))} (${Number(o.rating_score)}.0分)</span></div>
            <div class="text-muted mt-1">${escapeHtml(o.rating_comment)}</div>
          </div>
          <span class="badge badge-green">${escapeHtml(o.hospital_name)}</span>
        </div>
      `).join('');
}

function renderSaasSupply() {
  const isOrg = SAAS_USER && SAAS_USER.role === 'ORG_ADMIN';
  document.getElementById('saas-apply-list').innerHTML = SAAS_STATE.applications.map(a => `
    <div class="ew-card-paper flex items-center justify-between gap-3">
      <div>
        <span class="badge ${a.apply_type === 'ORG' ? 'badge-blue' : 'badge-green'}">${a.apply_type === 'ORG' ? 'B端陪护机构' : '个人持证陪诊员'}</span>
        <span class="font-extrabold ml-1">${escapeHtml(a.name)}（${escapeHtml(a.city)} · ${escapeHtml(a.phone)}）</span>
        <div class="text-muted mt-1">资质证明：${escapeHtml(a.qualification)}</div>
      </div>
      ${a.status === 'PENDING'
        ? `<button type="button" onclick="approveSaasApp(${Number(a.id)}, this)" class="btn-primary whitespace-nowrap">审核通过准入</button>`
        : `<span class="badge badge-solid-green whitespace-nowrap">已准入在册</span>`}
    </div>
  `).join('');

  const orgs = isOrg ? SAAS_STATE.organizations.filter(o => o.id === SAAS_USER.org_id) : SAAS_STATE.organizations;
  document.getElementById('saas-orgs-list').innerHTML = orgs.map(org => `
    <div class="ew-card-paper space-y-1">
      <div class="flex justify-between"><span class="font-extrabold">${escapeHtml(org.name)}</span><span class="badge badge-green">抽佣 ${Math.round(Number(org.commission_rate) * 100)}%</span></div>
      <div class="text-muted">统一信用代码：${escapeHtml(org.credit_code)} ｜ 负责人：${escapeHtml(org.contact_name)} (${escapeHtml(org.contact_phone)})</div>
      <div class="text-subtle">免押金期至：${escapeHtml(org.deposit_free_until)} ｜ 备案护工数：${Number(org.escort_count)} 人</div>
    </div>
  `).join('');

  const escs = isOrg ? SAAS_STATE.escorts.filter(e => e.org_id === SAAS_USER.org_id) : SAAS_STATE.escorts;
  document.getElementById('saas-escorts-list').innerHTML = escs.map(e => `
    <div class="ew-card-paper flex items-center justify-between gap-2">
      <div>
        <div class="font-extrabold">${escapeHtml(e.name)} (${escapeHtml(e.phone)}) <span class="badge badge-orange">★${Number(e.rating).toFixed(2)}</span></div>
        <div class="text-muted mt-1">${escapeHtml(e.org_name)} ｜ ${escapeHtml(e.cert_title)}</div>
        <div class="text-subtle">可接分级：${escapeHtml(e.skills)} ｜ 累计完单 ${Number(e.completed_orders)} 单</div>
      </div>
      <span class="badge ${e.schedule_status === 'AVAILABLE' ? 'badge-solid-green' : 'badge-gray'} whitespace-nowrap">${e.schedule_status === 'AVAILABLE' ? '听单中' : '小休'}</span>
    </div>
  `).join('');
}

function renderSaasFinance() {
  const paidOrders = SAAS_STATE.orders.filter(o => o.payment_status === 'PAID' && o.sop_step >= 0);
  document.getElementById('saas-ledger-list').innerHTML = paidOrders.map(o => `
    <div class="ew-card-paper flex items-center justify-between gap-2 flex-wrap">
      <div>
        <div class="font-extrabold">#${escapeHtml(o.order_no)} · ${escapeHtml(o.hospital_name)}（${escapeHtml(o.pay_channel)} 流水：${escapeHtml(o.pay_trade_no || '已核销')}）</div>
        <div class="text-muted mt-1">承接方：${escapeHtml(o.escort_name || '待派单')}（${escapeHtml(o.org_name || '平台调配')}）</div>
      </div>
      <div class="text-right">
        <div class="font-extrabold">实付 ¥${Number(o.total_price)}</div>
        <div class="text-green">平台留存 ¥${Number(o.platform_fee)} ｜ 服务方结算 ¥${Number(o.provider_payout)}</div>
      </div>
    </div>
  `).join('');

  document.getElementById('saas-withdraw-list').innerHTML = (SAAS_STATE.withdrawals || []).map(w => `
    <div class="ew-card-paper flex items-center justify-between">
      <div>
        <div class="font-bold">${escapeHtml(w.escort_name)} · ${escapeHtml(w.channel)}</div>
        <div class="text-subtle">${escapeHtml(w.account_info)} ｜ ${escapeHtml(w.created_at)}</div>
      </div>
      <div class="text-right"><div class="font-extrabold text-orange">¥${Number(w.amount).toFixed(2)}</div><span class="badge badge-green">已打款</span></div>
    </div>
  `).join('');

  document.getElementById('saas-invoice-list').innerHTML = (SAAS_STATE.invoices || []).length === 0
    ? '<div class="ew-card-paper text-muted">暂无客户开票记录</div>'
    : SAAS_STATE.invoices.map(inv => `
        <div class="ew-card-paper flex items-center justify-between">
          <div>
            <div class="font-bold">${escapeHtml(inv.invoice_title)}（${escapeHtml(inv.title_type)}）· #${escapeHtml(inv.order_no)}</div>
            <div class="text-subtle">邮箱：${escapeHtml(inv.email)} ｜ ${escapeHtml(inv.created_at)}</div>
          </div>
          <div class="text-right"><div class="font-extrabold text-green">¥${Number(inv.amount)}</div><span class="badge badge-green">已开具</span></div>
        </div>
      `).join('');
}

function renderSaasCommercial() {
  document.getElementById('saas-comm-list').innerHTML = SAAS_STATE.commercialSlots.map(s => `
    <div class="ew-card-paper flex items-center justify-between gap-3">
      <div>
        <span class="badge badge-green">${escapeHtml(s.slot_type)}</span>
        <span class="font-extrabold text-sm ml-1">${escapeHtml(s.title)}</span>
        <div class="text-muted mt-1">合作方：${escapeHtml(s.partner_name)} ｜ 展示价：${escapeHtml(s.price_tag)} ｜ 单次点击结算 ¥${Number(s.cpc_revenue)}</div>
      </div>
      <div class="text-right whitespace-nowrap">
        <div class="font-extrabold text-orange">${Number(s.clicks)} 次有效导流</div>
        <div class="text-green font-bold">累计分成 ¥${(Number(s.clicks) * Number(s.cpc_revenue)).toFixed(2)}</div>
      </div>
    </div>
  `).join('');
}

function openSaasDispatch(orderId) {
  const ord = SAAS_STATE.orders.find(o => o.id === orderId);
  if (!ord) return;
  ACTIVE_DISP_ORD_ID = ord.id;
  document.getElementById('disp-title').textContent = `指派陪诊师 · #${ord.order_no}（${ord.hospital_name} · ${ord.mobility_level}）`;
  const reqCode = String(ord.mobility_level).slice(0, 2);
  const isOrg = SAAS_USER && SAAS_USER.role === 'ORG_ADMIN';

  const candidates = SAAS_STATE.escorts
    .filter(e => !(isOrg && e.org_id !== SAAS_USER.org_id))
    .map(e => {
      let sc = 60;
      if (String(e.skills).includes(reqCode)) sc += 20;
      if (String(e.hospitals).includes(ord.hospital_name.slice(0, 4))) sc += 15;
      if (e.schedule_status === 'AVAILABLE') sc += 5;
      return { ...e, matchScore: Math.min(99, sc) };
    })
    .sort((a, b) => b.matchScore - a.matchScore);

  document.getElementById('disp-candidates').innerHTML = candidates.map(c => `
    <div class="ew-card-paper flex items-center justify-between gap-3">
      <div>
        <div class="font-extrabold text-sm">${escapeHtml(c.name)} <span class="badge badge-green">匹配度 ${c.matchScore}%</span> <span class="badge badge-orange">★${Number(c.rating).toFixed(2)}</span></div>
        <div class="text-muted mt-1">${escapeHtml(c.org_name)} ｜ ${escapeHtml(c.cert_title)}</div>
        <div class="text-subtle">技能：${escapeHtml(c.skills)} ｜ 熟院：${escapeHtml(c.hospitals)}</div>
      </div>
      <button type="button" onclick="confirmSaasDispatch(${Number(c.id)}, this)" class="btn-primary whitespace-nowrap">确认指派</button>
    </div>
  `).join('');
  openModal('modal-dispatch');
}

async function confirmSaasDispatch(escortId, btnEl) {
  if (!ACTIVE_DISP_ORD_ID) return;
  const json = await saasApi(`/api/orders/${ACTIVE_DISP_ORD_ID}/dispatch`, {
    method: 'POST',
    body: { escort_id: escortId }
  }, btnEl);
  if (json) {
    closeModal('modal-dispatch');
    showToast('派单成功！任务已实时推送至该持证陪诊师工作台');
  }
}

async function openSaasEvents(orderId) {
  const ord = SAAS_STATE.orders.find(o => o.id === orderId);
  document.getElementById('ev-title').textContent = ord ? `订单 #${ord.order_no} 全链路合规审计时间轴` : '审计流水';
  const json = await saasApi(`/api/orders/${orderId}/events`);
  if (!json) return;
  document.getElementById('ev-list').innerHTML = json.events.map(ev => `
    <div class="audit-item">
      <div class="flex justify-between"><span class="font-bold text-green">${escapeHtml(ev.title)}</span><span class="text-subtle" style="font-size:10.5px;">${escapeHtml(ev.created_at)}</span></div>
      <div class="text-muted mt-1">${escapeHtml(ev.detail)}</div>
      <div class="text-subtle" style="font-size:10.5px;">操作人：${escapeHtml(ev.operator)}</div>
    </div>
  `).join('');
  openModal('modal-events');
}

async function resolveAfterSaleTicket(orderId, btnEl) {
  const json = await saasApi(`/api/orders/${orderId}/resolve-after-sale`, {
    method: 'POST',
    body: { reply: '品控主管已核查履约轨迹并与家属电话回访达成满意结案' }
  }, btnEl);
  if (json) showToast('售后工单已办结归档！');
}

async function approveSaasApp(appId, btnEl) {
  const json = await saasApi(`/api/applications/${appId}/approve`, { method: 'POST' }, btnEl);
  if (json) showToast('资质审批通过！该伙伴已纳入在册运力库并可登录陪诊师工作台');
}

async function submitNewCommercial(e) {
  e.preventDefault();
  const btn = document.getElementById('nc-submit-btn');
  const json = await saasApi('/api/commercial', {
    method: 'POST',
    body: {
      slot_type: document.getElementById('nc-type').value,
      cpc_revenue: Number(document.getElementById('nc-cpc').value),
      title: document.getElementById('nc-title').value,
      partner_name: document.getElementById('nc-partner').value,
      price_tag: document.getElementById('nc-price').value,
      subtitle: document.getElementById('nc-sub').value
    }
  }, btn);
  if (json) {
    closeModal('modal-add-comm');
    e.target.reset();
    showToast('新商业合作位已上架至 C端家庭应用！');
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  if (SAAS_TOKEN) {
    const me = await saasApi('/api/auth/me');
    if (!me || !me.authenticated || !['ADMIN', 'ORG_ADMIN'].includes(me.user.role)) {
      SAAS_TOKEN = '';
      SAAS_USER = null;
      localStorage.removeItem('ew_admin_token');
      localStorage.removeItem('ew_admin_user');
    } else {
      SAAS_USER = me.user;
    }
  }
  syncSaasGate();
  if (SAAS_TOKEN) {
    await loadSaasData();
  }
});
