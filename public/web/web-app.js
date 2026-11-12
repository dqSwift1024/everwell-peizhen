/* ==========================================================================
   健康来敲门 Everwell · 应用1：官方品牌商业网站独立引擎 (public/web/web-app.js)
   ========================================================================== */

let WEB_STATE = null;
let SELECTED_PAY_CHANNEL = '微信支付';
let ACTIVE_CASHIER_ORDER = null;

function escapeHtml(val) {
  if (val === undefined || val === null) return '';
  return String(val)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function showToast(msg, isError = false) {
  const el = document.getElementById('global-toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden', 'error');
  if (isError) el.classList.add('error');
  clearTimeout(window.__webToast);
  window.__webToast = setTimeout(() => el.classList.add('hidden'), 4200);
}

function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('hidden');
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('hidden');
}

document.addEventListener('click', e => {
  if (e.target && e.target.classList && e.target.classList.contains('modal-backdrop')) {
    e.target.classList.add('hidden');
  }
});

async function apiCall(path, options = {}, btnEl = null) {
  if (btnEl && btnEl.disabled) return null;
  const orig = btnEl ? btnEl.innerHTML : '';
  if (btnEl) btnEl.disabled = true;
  try {
    const res = await fetch(path, {
      method: options.method || 'GET',
      headers: options.body ? { 'Content-Type': 'application/json' } : {},
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    const json = await res.json();
    if (!res.ok || !json.ok) {
      showToast(json.msg || `操作失败 (HTTP ${res.status})`, true);
      return null;
    }
    if (json.data) {
      WEB_STATE = json.data;
      renderWebArticles();
    }
    return json;
  } catch (_) {
    showToast('网络连接波动，请稍后重试', true);
    return null;
  } finally {
    if (btnEl) {
      btnEl.disabled = false;
      btnEl.innerHTML = orig;
    }
  }
}

function recalcWebPrice() {
  const base = Number(document.getElementById('wb-pkg').value.split('|')[0] || 288);
  const mob = Number(document.getElementById('wb-mobility').value.split('|')[0] || 80);
  document.getElementById('wb-live-price').textContent = `¥${base + mob}`;
}

function syncWebHospitalCity() {
  const sel = document.getElementById('wb-hospital');
  const city = sel.options[sel.selectedIndex].getAttribute('data-city') || '北京';
  const p = document.getElementById('wb-pickup');
  const d = document.getElementById('wb-dropoff');
  if (city === '成都' && p.value.includes('朝阳区')) {
    p.value = '成都市武侯区玉林北路12号院2单元302';
    d.value = '就诊结束后安全送回武侯区玉林北路家中交接';
  } else if (city === '北京' && p.value.includes('成都市')) {
    p.value = '北京市朝阳区幸福一村3号楼2单元301';
    d.value = '就诊结束后安全送回原址家中交接';
  }
}

async function handleWebOrderSubmit(e) {
  e.preventDefault();
  if (!document.getElementById('wb-agree-chk').checked) {
    showToast('请先阅读并勾选患者知情同意与隐私保护声明', true);
    return;
  }
  const btn = document.getElementById('wb-submit-btn');
  const [basePrice, pkgName, regMode] = document.getElementById('wb-pkg').value.split('|');
  const [mobFee, mobLabel] = document.getElementById('wb-mobility').value.split('|');
  const hospSel = document.getElementById('wb-hospital');
  const city = hospSel.options[hospSel.selectedIndex].getAttribute('data-city') || '北京';

  const json = await apiCall('/api/orders', {
    method: 'POST',
    body: {
      source_channel: '官方Web网站',
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
      patient_confirm_method: '官网预约勾选已获患者本人知情授权'
    }
  }, btn);

  if (json && json.order) {
    document.getElementById('wb-lookup-input').value = json.order.order_no;
    openCashierForOrder(json.order);
  }
}

function selectPayChannel(channel, el) {
  SELECTED_PAY_CHANNEL = channel;
  document.querySelectorAll('#cashier-channels .pay-option-card').forEach(c => {
    c.classList.remove('selected');
    c.lastElementChild.textContent = '○';
    c.lastElementChild.className = '';
  });
  el.classList.add('selected');
  el.lastElementChild.textContent = '✓';
  el.lastElementChild.className = 'text-green';
}

function openCashierForOrder(ord) {
  ACTIVE_CASHIER_ORDER = ord;
  document.getElementById('cashier-order-desc').textContent = `陪诊预约单 #${ord.order_no}（${ord.hospital_name}）`;
  document.getElementById('cashier-amount-text').textContent = `¥${Number(ord.total_price).toFixed(2)}`;
  openModal('modal-cashier');
}

function openCashierById(orderId) {
  const ord = WEB_STATE && WEB_STATE.orders.find(o => o.id === orderId);
  if (ord) openCashierForOrder(ord);
}

async function confirmCashierPayment(btnEl) {
  if (!ACTIVE_CASHIER_ORDER) return;
  const json = await apiCall(`/api/orders/${ACTIVE_CASHIER_ORDER.id}/pay`, {
    method: 'POST',
    body: { pay_channel: SELECTED_PAY_CHANNEL }
  }, btnEl);
  if (json) {
    closeModal('modal-cashier');
    showToast(`【${SELECTED_PAY_CHANNEL}】支付成功（交易流水号：${json.trade_no}）！已同步进入调度中心派单池`);
    handleWebOrderLookup();
  }
}

async function handleWebOrderLookup(e) {
  if (e) e.preventDefault();
  const q = document.getElementById('wb-lookup-input').value.trim();
  const btn = document.getElementById('wb-lookup-btn');
  const box = document.getElementById('wb-lookup-results');
  const json = await apiCall(`/api/orders/lookup?q=${encodeURIComponent(q)}`, {}, btn);
  if (!json) return;

  if (!json.orders || !json.orders.length) {
    box.innerHTML = '<div class="ew-card-paper text-muted">未查询到匹配的订单记录，请核对 11 位预订手机号或订单号。</div>';
    return;
  }
  box.innerHTML = json.orders.map(o => `
    <div class="ew-card-paper flex items-center justify-between gap-3 flex-wrap">
      <div>
        <div class="font-extrabold text-sm">
          #${escapeHtml(o.order_no)} · ${escapeHtml(o.city)} · ${escapeHtml(o.hospital_name)}（${escapeHtml(o.department)}）
          <span class="badge ${o.payment_status === 'PAID' ? 'badge-green' : 'badge-red'} ml-1">${o.payment_status === 'PAID' ? '已支付' : (o.payment_status === 'REFUNDED' ? '已退款' : '待支付')}</span>
        </div>
        <div class="text-muted mt-1">就诊人：${escapeHtml(o.patient_name)} ｜ 就诊日：${escapeHtml(o.visit_date)} ｜ 总额：<b>¥${Number(o.total_price)}</b> ｜ 承接陪诊师：${escapeHtml(o.escort_name || '待调度指派')}</div>
        <div class="text-green font-semibold mt-1">实时履约动态：${escapeHtml(o.live_note)}</div>
      </div>
      <div class="flex items-center gap-2">
        ${o.payment_status === 'UNPAID' && o.sop_step >= 0
          ? `<button type="button" onclick="openCashierById(${Number(o.id)})" class="btn-orange">立即支付</button>`
          : `<a href="/app/" class="btn-soft">在 C端家庭版查看完整报告 →</a>`}
      </div>
    </div>
  `).join('');
}

function renderWebArticles() {
  const grid = document.getElementById('web-articles-grid');
  if (!grid || !WEB_STATE) return;
  grid.innerHTML = WEB_STATE.articles.slice(0, 6).map(art => `
    <div class="ew-card flex flex-col justify-between space-y-2">
      <div>
        <div class="flex items-center justify-between">
          <span class="badge badge-green">${escapeHtml(art.category)} · ${escapeHtml(art.solar_term)}</span>
          <span class="text-subtle" style="font-size:11px;">阅读 ${Number(art.views || 300)}</span>
        </div>
        <h3 class="text-sm font-extrabold mt-2" style="margin-bottom:6px;line-height:1.45;">${escapeHtml(art.title)}</h3>
        <p class="text-muted" style="margin:0;line-height:1.6;">${escapeHtml(art.summary)}</p>
      </div>
      <div class="flex items-center justify-between pt-1" style="border-top:1px solid var(--ew-line);">
        <span class="text-subtle" style="font-size:11px;">${escapeHtml(art.author_name || '持证陪诊顾问组')}</span>
        <button type="button" onclick="openWebArticle(${Number(art.id)})" class="btn-soft" style="padding:5px 10px;">阅读全文 →</button>
      </div>
    </div>
  `).join('');
}

function openWebArticle(id) {
  const art = WEB_STATE && WEB_STATE.articles.find(a => a.id === id);
  if (!art) return;
  document.getElementById('art-modal-badge').textContent = `${art.category} · ${art.solar_term}`;
  document.getElementById('art-modal-title').textContent = art.title;
  document.getElementById('art-modal-author').textContent = `撰写：${art.author_name || '健康来敲门顾问'} ｜ 推荐科室：${art.recommend_dept}`;
  document.getElementById('art-modal-content').textContent = art.content || art.summary;
  openModal('modal-article-detail');
}

async function handleWebJoinSubmit(e) {
  e.preventDefault();
  const btn = document.getElementById('join-submit-btn');
  const json = await apiCall('/api/applications', {
    method: 'POST',
    body: {
      apply_type: document.getElementById('join-type').value,
      city: document.getElementById('join-city').value,
      name: document.getElementById('join-name').value,
      phone: document.getElementById('join-phone').value,
      qualification: document.getElementById('join-qual').value
    }
  }, btn);
  if (json) {
    e.target.reset();
    showToast('资质入驻申请已成功提交至运营审批库！审核通过后可直接凭手机号登录【陪诊师工作台】');
  }
}

function openInvoiceModal() {
  renderInvoices();
  openModal('modal-invoice');
}

function renderInvoices() {
  const box = document.getElementById('inv-history-list');
  if (!box || !WEB_STATE) return;
  const list = WEB_STATE.invoices || [];
  box.innerHTML = list.slice(0, 3).map(inv => `
    <div class="ew-card-paper flex items-center justify-between">
      <span>${escapeHtml(inv.invoice_title)} · #${escapeHtml(inv.order_no)} · ¥${Number(inv.amount)}</span>
      <span class="badge badge-green">已发邮箱</span>
    </div>
  `).join('');
}

async function handleInvoiceSubmit(e) {
  e.preventDefault();
  const btn = document.getElementById('inv-submit-btn');
  const json = await apiCall('/api/invoices', {
    method: 'POST',
    body: {
      title_type: document.getElementById('inv-type').value,
      order_no: document.getElementById('inv-orderno').value,
      invoice_title: document.getElementById('inv-title').value,
      tax_no: document.getElementById('inv-taxno').value,
      amount: Number(document.getElementById('inv-amount').value),
      email: document.getElementById('inv-email').value
    }
  }, btn);
  if (json) {
    renderInvoices();
    showToast('增值税普通电子发票已开具并发送至您的邮箱！');
  }
}

function openLegalDoc(type) {
  const map = {
    user: ['《健康来敲门用户服务协议》', '<p>1. 平台依据国家标准《GB/T 47801—2026》提供非医疗性质就医陪同、轮椅推行、取号跑腿与客观医嘱记录服务。</p><p>2. 代父母预约须确认就诊患者本人知情同意，所有服务明码标价，支持48小时前无损全额退改。</p>'],
    privacy: ['《医疗健康敏感个人信息保护政策》', '<p>1. 严格遵循最小必要原则采集就诊人姓名、接送地址与慢病护理提示。</p><p>2. 现场实拍检验单与医嘱报告仅对订单创建人及授权亲属加密展示，支持随时在 App【我的】页面一键永久注销清理。</p>'],
    service: ['《GB/T 47801—2026 陪诊服务 12 准做与 7 严禁告知书》', '<p><strong>12项准做：</strong>诊前提醒、上门接手、助老打车衔接、轮椅借还推行、取号报到、诊室陪同、客观记录医嘱、检查陪同、缴费取药、理赔票据整理、安全送回、服药与复检提醒。</p><p><strong>7项严禁：</strong>严禁黄牛倒号、严禁主观解读报告或诊疗、严禁篡改医嘱、严禁推销保健品、严禁代签手术同意书、严禁泄露隐私、严禁私下收红包跳单。</p>']
  };
  const [t, html] = map[type] || map.user;
  document.getElementById('legal-doc-title').textContent = t;
  document.getElementById('legal-doc-body').innerHTML = html;
  openModal('modal-legal-doc');
}

window.addEventListener('DOMContentLoaded', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const dateInp = document.getElementById('wb-date');
  if (dateInp) {
    dateInp.min = today;
    if (dateInp.value < today) dateInp.value = today;
  }
  recalcWebPrice();
  await apiCall('/api/bootstrap');
  await handleWebOrderLookup();
});
