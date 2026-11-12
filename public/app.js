/* ==========================================================================
   健康来敲门 Everwell · 四端同库高可靠前端交互引擎 (V2.0)
   特性：XSS全量转义 | 防连点请求锁 | 超时容错 | 状态记忆 | SVG趋势图 | 种草社区
   ========================================================================== */

let APP_STATE = null;
let CURRENT_TERMINAL = loadPref('ew_terminal', 'web');
let CURRENT_CAPP_TAB = loadPref('ew_capp_tab', 'home');
let CURRENT_PATIENT_ID = Number(loadPref('ew_patient_id', '1')) || 1;
let CURRENT_ESCORT_ID = Number(loadPref('ew_escort_id', '1')) || 1;
let CURRENT_ADMIN_ROLE = 'PLATFORM'; // 'PLATFORM' or 'ORG_1'
let CURRENT_ART_FILTER = loadPref('ew_art_filter', 'ALL');
let CURRENT_ADM_FILTER = loadPref('ew_adm_filter', 'ALL');

let ACTIVE_CONFIRM_ORDER_ID = null;
let ACTIVE_DISPATCH_ORDER_ID = null;
let ACTIVE_STEP4_ORDER_ID = null;
let ACTIVE_CANCEL_ORDER_ID = null;

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
  window.__toastTimer = setTimeout(() => {
    el.classList.add('hidden');
  }, 4200);
}

function updateSyncIndicator(ok, text) {
  const dot = document.getElementById('sync-dot-el');
  const label = document.getElementById('sync-status-text');
  if (!dot || !label) return;
  dot.style.background = ok ? '#34d399' : '#f87171';
  const now = new Date();
  const hhmmss = [now.getHours(), now.getMinutes(), now.getSeconds()]
    .map(n => String(n).padStart(2, '0'))
    .join(':');
  label.textContent = text || (ok ? `SQLite 已同步 · ${hhmmss}` : '网络连接重试中...');
}

async function apiRequest(path, options = {}, btnEl = null) {
  if (btnEl && btnEl.disabled) return null;
  let origHtml = '';
  if (btnEl) {
    origHtml = btnEl.innerHTML;
    btnEl.disabled = true;
    btnEl.dataset.loading = '1';
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8500);

  try {
    const fetchOpts = {
      method: options.method || 'GET',
      headers: options.body ? { 'Content-Type': 'application/json' } : {},
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal
    };
    const res = await fetch(path, fetchOpts);
    const json = await res.json();
    if (!res.ok || !json.ok) {
      updateSyncIndicator(false, '请求校验提示');
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
    updateSyncIndicator(false, '网络波动，本地状态已保护');
    const reason = err.name === 'AbortError' ? '请求响应超时，请稍后重试' : '网络连接异常，页面数据已安全保留';
    showToast(reason, true);
    return null;
  } finally {
    clearTimeout(timer);
    if (btnEl) {
      btnEl.disabled = false;
      delete btnEl.dataset.loading;
      if (document.body.contains(btnEl)) {
        btnEl.innerHTML = origHtml;
      }
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

// Close modal when clicking backdrop outside panel or pressing Escape
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

  if (!skipScroll) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function switchCAppTab(tabId) {
  const validTabs = ['home', 'ai', 'book', 'post', 'care'];
  const targetTab = validTabs.includes(tabId) ? tabId : 'home';
  CURRENT_CAPP_TAB = targetTab;
  savePref('ew_capp_tab', targetTab);

  document.querySelectorAll('.capp-subview').forEach(el => el.classList.add('hidden'));
  const view = document.getElementById('capp-view-' + targetTab);
  if (view) view.classList.remove('hidden');

  document.querySelectorAll('.capp-tab-btn').forEach(btn => btn.classList.remove('active'));
  const activeTab = document.getElementById('ctab-' + targetTab);
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
    const pendingOrd = APP_STATE.orders.find(o => o.sop_step === 0);
    if (pendingOrd) openDispatchModalForOrder(pendingOrd.id);
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

async function fetchBootstrap() {
  await apiRequest('/api/bootstrap');
}

function renderAll() {
  if (!APP_STATE) return;
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

  const bCapp = document.getElementById('nav-badge-capp');
  const bBapp = document.getElementById('nav-badge-bapp');
  const bAdm = document.getElementById('nav-badge-admin');
  if (bCapp) bCapp.textContent = String(activeOrders.length);
  if (bBapp) bBapp.textContent = String(curEscortOrders.length);
  if (bAdm) bAdm.textContent = String(st.pendingDispatchCount);

  const uncheckedMeds = Math.max(0, st.medsTotal - st.medsChecked);
  const medBadge = document.getElementById('tab-badge-meds');
  if (medBadge) {
    if (uncheckedMeds > 0) {
      medBadge.textContent = String(uncheckedMeds);
      medBadge.classList.remove('hidden');
    } else {
      medBadge.classList.add('hidden');
    }
  }

  // Highlight active stage in the 5-step closed-loop strip
  for (let i = 1; i <= 5; i++) {
    const el = document.getElementById('loop-step-' + i);
    if (el) el.classList.remove('highlight');
  }

  let highlightStage = 1;
  let hintText = '点击上方任一环节可直达对应操作界面';
  const latestActive = APP_STATE.orders.find(o => o.sop_step >= 0 && o.sop_step < 5);
  if (latestActive) {
    if (latestActive.patient_confirm_status !== 'CONFIRMED') {
      highlightStage = 2;
      hintText = `订单 #${latestActive.order_no} 待完成【② 患者本人确认(+)】`;
    } else if (latestActive.sop_step === 0) {
      highlightStage = 3;
      hintText = `订单 #${latestActive.order_no} 已确认授权，点击【③ 后台智能筛选派单】指派陪诊师`;
    } else if (latestActive.sop_step >= 1 && latestActive.sop_step < 4) {
      highlightStage = 4;
      hintText = `订单 #${latestActive.order_no} 正在履约（第${latestActive.sop_step}/5步），点击【④ 陪诊师打卡】推进`;
    } else if (latestActive.sop_step === 4) {
      highlightStage = 5;
      hintText = `订单 #${latestActive.order_no} 已生成医嘱与理赔包，点击【⑤ 医嘱/复检/理赔】查收`;
    }
  } else {
    highlightStage = 5;
    hintText = '当前进行中订单已全部履约闭环，可在①发起新预约或在⑤每日服药打卡';
  }

  const hlEl = document.getElementById('loop-step-' + highlightStage);
  if (hlEl) hlEl.classList.add('highlight');
  const hintEl = document.getElementById('loop-live-hint');
  if (hintEl) hintEl.textContent = hintText;
}

// ==================== 1. Web Brand Portal ====================
function recalcWebPrice() {
  const pkgEl = document.getElementById('wb-pkg');
  const mobEl = document.getElementById('wb-mobility');
  const outEl = document.getElementById('wb-live-price');
  if (!pkgEl || !mobEl || !outEl) return;
  const base = Number(pkgEl.value.split('|')[0] || 288);
  const mob = Number(mobEl.value.split('|')[0] || 80);
  outEl.textContent = `¥${base + mob}`;
}

function syncWebHospitalCity() {
  const sel = document.getElementById('wb-hospital');
  if (!sel) return;
  const opt = sel.options[sel.selectedIndex];
  const city = opt ? opt.getAttribute('data-city') : '北京';
  const pickupEl = document.getElementById('wb-pickup');
  const dropEl = document.getElementById('wb-dropoff');
  if (city === '成都' && pickupEl && pickupEl.value.includes('朝阳区')) {
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
  const selectedOpt = hospSel.options[hospSel.selectedIndex];
  const city = (selectedOpt && selectedOpt.getAttribute('data-city')) || '北京';

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
    patient_confirm_status: 'CONFIRMED',
    patient_confirm_method: 'Web端家属勾选已获患者本人知情同意授权'
  };

  const json = await apiRequest('/api/orders', { method: 'POST', body: payload }, btn);
  if (json && json.order) {
    showToast(`Web 预约单 #${json.order.order_no} (${city}) 已创建入库！正在为您切至【4.管理后台】指派陪诊师...`);
    setTimeout(() => switchTerminal('admin'), 750);
  }
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
    showToast('入驻申请已写入数据库！正在跳转至【4.管理后台】供您一键审批入驻...');
    setTimeout(() => switchTerminal('admin'), 750);
  }
}

// ==================== 2. C-App (Family Mode) ====================
function selectFamilyElder(patientId) {
  CURRENT_PATIENT_ID = Number(patientId);
  savePref('ew_patient_id', CURRENT_PATIENT_ID);
  const p = getCurrentPatient();
  if (p) {
    const mbPatient = document.getElementById('mb-patient');
    const mbPickup = document.getElementById('mb-pickup');
    const mbDrop = document.getElementById('mb-dropoff');
    if (mbPatient) mbPatient.value = `${p.name} (${p.age}岁)`;
    if (mbPickup && p.address) mbPickup.value = p.address;
    if (mbDrop && p.address) mbDrop.value = `就诊结束后安全送回${p.address.slice(0, 12)}家中交接`;

    const mobSel = document.getElementById('mb-mobility');
    if (mobSel && p.mobility_level) {
      for (let i = 0; i < mobSel.options.length; i++) {
        if (mobSel.options[i].text.includes(p.mobility_level)) {
          mobSel.selectedIndex = i;
          break;
        }
      }
      recalcMobilePrice();
    }
  }
  renderCApp();
}

async function handleAddPatientSubmit(e) {
  e.preventDefault();
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
    showToast(`已新增照护长辈【${json.patient.name} · ${json.patient.relation}】并切换为当前档案！`);
  }
}

async function toggleCareCheckin(patientId, period, btnEl) {
  const json = await apiRequest(`/api/patients/${patientId}/care-checkin`, {
    method: 'POST',
    body: { period }
  }, btnEl);
  if (json) {
    const label = period === 'morning' ? '早安量压服药问候' : '晚安睡前平安确认';
    showToast(json.checked
      ? `已完成今日【${label}】打卡！家庭连续守护天数：${json.care_streak} 天`
      : `已取消今日【${label}】标记`);
  }
}

function renderOrderStepperHtml(ord) {
  const confirmed = ord.patient_confirm_status === 'CONFIRMED';
  const s = Number(ord.sop_step);
  const nodes = [
    { label: '患者确认', done: confirmed, cur: !confirmed && s >= 0 },
    { label: '已派单', done: s >= 1, cur: confirmed && s === 0 },
    { label: '已接手', done: s >= 2, cur: s === 1 },
    { label: '院内陪诊', done: s >= 3, cur: s === 2 || s === 3 },
    { label: '医嘱完结', done: s >= 5, cur: s === 4 }
  ];
  return `
    <div class="order-stepper">
      ${nodes.map((n, idx) => {
        const cls = n.done ? 'done' : (n.cur ? 'current' : '');
        const sym = n.done ? '✓' : String(idx + 1);
        return `
          <div class="stepper-node ${cls}">
            <div class="stepper-dot">${sym}</div>
            <span>${n.label}</span>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderVitalsSvgChart(diaries) {
  const box = document.getElementById('capp-vitals-chart');
  if (!box) return;
  if (!diaries || diaries.length === 0) {
    box.innerHTML = '<div class="text-center text-muted py-6">暂无血压血糖打卡记录，在下方录入第一笔数据即刻生成趋势曲线</div>';
    return;
  }

  // Take latest 7 entries in chronological order (left = oldest, right = latest)
  const pts = diaries.slice(0, 7).reverse();
  const w = 340;
  const h = 132;
  const padL = 28;
  const padR = 16;
  const padT = 18;
  const padB = 24;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

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
      <span class="badge badge-green">近${pts.length}次空腹血糖均值 ${avgSugar} mmol/L</span>
    </div>
    <svg viewBox="0 0 ${w} ${h}" width="100%" height="132" role="img" aria-label="近7日血压变化趋势折线图">
      <line x1="${padL}" y1="${y140.toFixed(1)}" x2="${w - padR}" y2="${y140.toFixed(1)}" stroke="#e6a279" stroke-dasharray="3,3" stroke-width="1" />
      <text x="${padL + 2}" y="${(y140 - 3).toFixed(1)}" font-size="8.5" fill="#c96b36">警戒线 140mmHg</text>

      ${pts.length > 1 ? `<polyline fill="none" stroke="#d77844" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" points="${sysPoly}" />` : ''}
      ${pts.length > 1 ? `<polyline fill="none" stroke="#075e50" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" points="${diaPoly}" />` : ''}

      ${pts.map((d, i) => {
        const x = getX(i).toFixed(1);
        const ys = getY(Number(d.bp_sys)).toFixed(1);
        const yd = getY(Number(d.bp_dia)).toFixed(1);
        const shortDate = escapeHtml(String(d.log_date).replace(/\(.*\)/, '').trim().slice(-5));
        return `
          <circle cx="${x}" cy="${ys}" r="3.4" fill="#ffffff" stroke="#d77844" stroke-width="2" />
          <text x="${x}" y="${(Number(ys) - 6).toFixed(1)}" text-anchor="middle" font-size="8.5" font-weight="700" fill="#b85a25">${Number(d.bp_sys)}</text>
          <circle cx="${x}" cy="${yd}" r="3.4" fill="#ffffff" stroke="#075e50" stroke-width="2" />
          <text x="${x}" y="${(Number(yd) + 11).toFixed(1)}" text-anchor="middle" font-size="8" fill="#075e50">${Number(d.bp_dia)}</text>
          <text x="${x}" y="${h - 5}" text-anchor="middle" font-size="8.5" fill="#6b7d77">${shortDate}</text>
        `;
      }).join('')}
    </svg>
    <div class="flex items-center justify-between text-subtle" style="font-size:10.5px;border-top:1px dashed var(--ew-line);padding-top:5px;">
      <span>最新测量：${escapeHtml(latest.bp_sys)}/${escapeHtml(latest.bp_dia)} mmHg · 血糖 ${escapeHtml(latest.blood_sugar)}</span>
      <span class="text-green font-bold">${escapeHtml(latest.feeling)}</span>
    </div>
  `;
}

function renderCApp() {
  const p = getCurrentPatient();
  const today = APP_STATE.todayStr || '';

  // 1. Multi-elder switcher chips
  const switcherEl = document.getElementById('capp-elder-switcher');
  if (switcherEl && APP_STATE.patients) {
    switcherEl.innerHTML = APP_STATE.patients.map(pt => `
      <button type="button" onclick="selectFamilyElder(${Number(pt.id)})" class="elder-chip ${pt.id === (p && p.id) ? 'active' : ''}">
        ${escapeHtml(pt.relation)}·${escapeHtml(pt.name)} (${Number(pt.age)}岁·${escapeHtml(pt.mobility_level)})
      </button>
    `).join('') + `
      <button type="button" onclick="openModal('modal-add-patient')" class="elder-chip" title="新增家庭照护长辈">+ 新增长辈</button>
    `;
  }

  // 2. Retention Hero Card: Weather/Solar-Term/Birthday + Streak + Morning/Evening Check-in
  const heroBox = document.getElementById('capp-care-hero');
  if (heroBox && p) {
    const morningDone = p.morning_checkin_date === today;
    const eveningDone = p.evening_checkin_date === today;
    heroBox.innerHTML = `
      <div class="flex items-center justify-between text-xs" style="color:#cfe6dc;">
        <span>${escapeHtml(p.city)} · 立冬节气关怀(+)</span>
        <span class="badge" style="background:rgba(215,120,68,0.92);color:#fff;">已连续守护 ${Number(p.care_streak || 12)} 天</span>
      </div>
      <div class="text-sm font-extrabold mt-1">
        距${escapeHtml(p.relation)}${escapeHtml(p.name)} ${Number(p.age)} 岁生日（${escapeHtml(p.birthday)}）还有 ${Number(p.days_to_birthday)} 天
      </div>
      <div class="text-xs mt-1" style="color:#bed8cd;">${escapeHtml(p.weather_alert)}</div>

      <div class="care-checkin-grid">
        <button type="button" onclick="toggleCareCheckin(${Number(p.id)}, 'morning', this)" class="care-slot-btn ${morningDone ? 'done' : ''}">
          <div>
            <div class="font-bold">08:00 早安敲门</div>
            <div style="font-size:10px;opacity:0.82;">晨起测血压与服药确认</div>
          </div>
          <span>${morningDone ? '✓ 已确认' : '点此打卡'}</span>
        </button>
        <button type="button" onclick="toggleCareCheckin(${Number(p.id)}, 'evening', this)" class="care-slot-btn ${eveningDone ? 'done' : ''}">
          <div>
            <div class="font-bold">20:00 晚安敲门</div>
            <div style="font-size:10px;opacity:0.82;">晚间服药与居家平安确认</div>
          </div>
          <span>${eveningDone ? '✓ 已确认' : '点此打卡'}</span>
        </button>
      </div>

      <div class="flex items-center justify-between gap-2 mt-2 pt-1" style="border-top:1px solid rgba(255,255,255,0.14);">
        <span style="font-size:11px;color:#b8d5c9;">慢病关注：${escapeHtml(p.chronic_tags || '日常随访')}</span>
        <button type="button" onclick="shareCareCardForCurrentElder()" class="badge" style="background:rgba(255,255,255,0.18);color:#fff;padding:4px 9px;cursor:pointer;">
          转发微信问候卡 →
        </button>
      </div>
    `;
  }

  // 3. Family Orders List with 5-Node Visual Stepper & Contextual Closed-Loop Actions
  const ordersBox = document.getElementById('capp-orders-container');
  const sopLabels = {
    '-1': { text: '已退改取消', cls: 'badge-gray' },
    0: { text: '待后台指派陪诊师', cls: 'badge-orange' },
    1: { text: '第1步 · 陪诊师已接单出发', cls: 'badge-blue' },
    2: { text: '第2步 · 已达接手点打卡', cls: 'badge-blue' },
    3: { text: '第3步 · 院内陪诊进行中', cls: 'badge-purple' },
    4: { text: '第4步 · 已出医嘱与理赔包', cls: 'badge-green' },
    5: { text: '第5步 · 安全送回已完结', cls: 'badge-solid-green' }
  };

  if (ordersBox) {
    if (!APP_STATE.orders.length) {
      ordersBox.innerHTML = '<div class="ew-card text-center text-muted text-xs">暂无陪诊订单，点击上方「立即预约」开启服务</div>';
    } else {
      ordersBox.innerHTML = APP_STATE.orders.slice(0, 5).map(ord => {
        const stInfo = sopLabels[ord.sop_step] || sopLabels[0];
        const isCancelled = ord.sop_step === -1;
        return `
          <div class="ew-card space-y-2 text-xs" style="padding:13px;${isCancelled ? 'opacity:0.74;background:#f7f8f7;' : 'border-color:#b9d8cb;'}">
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-1-5 flex-wrap">
                <span class="font-extrabold">#${escapeHtml(ord.order_no)}</span>
                <span class="badge ${stInfo.cls}">${stInfo.text}</span>
              </div>
              <span class="font-extrabold text-sm text-orange">¥${Number(ord.total_price)}</span>
            </div>

            <div class="font-extrabold">${escapeHtml(ord.city)} · ${escapeHtml(ord.hospital_name)} · ${escapeHtml(ord.department)}</div>
            <div class="text-muted">就诊人：${escapeHtml(ord.patient_name)} ｜ ${escapeHtml(ord.visit_date)} ｜ <b>${escapeHtml(ord.mobility_level)}</b></div>

            ${!isCancelled ? renderOrderStepperHtml(ord) : ''}

            <div class="ew-card-paper" style="padding:8px 10px;">
              <div><strong>最新进展：</strong>${escapeHtml(ord.live_note)}</div>
              <div class="text-muted mt-1"><strong>患者确认(+)：</strong><span class="text-green font-semibold">${escapeHtml(ord.patient_confirm_method)}</span></div>
            </div>

            <div class="flex flex-wrap gap-1-5">
              ${!isCancelled && ord.patient_confirm_status !== 'CONFIRMED' ? `
                <button type="button" onclick="openPatientConfirmModalForOrder(${Number(ord.id)})" class="btn-orange" style="padding:6px 10px;font-size:11.5px;">患者确认(+)</button>
              ` : ''}
              ${!isCancelled && ord.sop_step === 0 && ord.patient_confirm_status === 'CONFIRMED' ? `
                <button type="button" onclick="switchTerminal('admin');openDispatchModalForOrder(${Number(ord.id)})" class="btn-orange" style="padding:6px 10px;font-size:11.5px;">去后台派单 →</button>
              ` : ''}
              ${!isCancelled && ord.sop_step >= 1 && ord.sop_step < 5 && ord.escort_id ? `
                <button type="button" onclick="jumpToEscortForOrder(${Number(ord.id)})" class="btn-primary" style="padding:6px 10px;font-size:11.5px;">去陪诊端打卡 →</button>
              ` : ''}
              ${ord.sop_step >= 4 ? `
                <button type="button" onclick="switchCAppTab('post')" class="btn-outline" style="padding:5px 10px;font-size:11.5px;">查收医嘱/理赔包</button>
              ` : ''}
              ${!isCancelled ? `
                <button type="button" onclick="openRideModalByOrderId(${Number(ord.id)})" class="btn-blue" style="padding:6px 10px;font-size:11.5px;">跳滴滴/高德(+)</button>
              ` : ''}
              ${!isCancelled && ord.sop_step < 5 ? `
                <button type="button" onclick="addOrderOvertime(${Number(ord.id)}, this)" class="btn-soft" style="padding:6px 9px;font-size:11px;">加钟+¥100</button>
              ` : ''}
              ${!isCancelled && ord.sop_step < 4 ? `
                <button type="button" onclick="openCancelModal(${Number(ord.id)})" class="btn-soft" style="padding:6px 9px;font-size:11px;">退改</button>
              ` : ''}
              <button type="button" onclick="openOrderEventsModal(${Number(ord.id)})" class="btn-soft" style="padding:6px 9px;font-size:11px;">流转日志</button>
            </div>
          </div>
        `;
      }).join('');
    }
  }

  // 4. Commercial Slots on Home (体检推荐+ & 保险入口+)
  const commHome = document.getElementById('capp-commercial-home');
  if (commHome) {
    commHome.innerHTML = APP_STATE.commercialSlots.filter(s => s.slot_type !== '购药入口').slice(0, 2).map(s => `
      <button type="button" onclick="triggerCommercialClickById(${Number(s.id)}, this)" class="ew-card-paper text-left flex flex-col justify-between" style="padding:10px;">
        <div>
          <span class="badge badge-green">${escapeHtml(s.slot_type)}(+)</span>
          <div class="font-extrabold mt-1" style="font-size:12px;line-height:1.35;">${escapeHtml(s.title)}</div>
          <div class="text-muted mt-1" style="font-size:10.5px;">${escapeHtml(s.partner_name)}</div>
        </div>
        <div class="flex items-center justify-between mt-2 pt-1" style="border-top:1px solid var(--ew-line);width:100%;">
          <span class="font-extrabold text-orange" style="font-size:11.5px;">${escapeHtml(s.price_tag)}</span>
          <span class="text-subtle" style="font-size:10px;">已导流 ${Number(s.clicks)}</span>
        </div>
      </button>
    `).join('');
  }

  // 5. Post-visit: Daily Medication Adherence Progress Bar (+) & Partner Pharmacy (+)
  const medsBox = document.getElementById('capp-meds-container');
  const drugSlot = APP_STATE.commercialSlots.find(s => s.slot_type === '购药入口') || APP_STATE.commercialSlots[0];
  if (medsBox) {
    const totalMeds = APP_STATE.medications.length || 1;
    const doneMeds = APP_STATE.medications.filter(m => m.checked_today === 1).length;
    const pct = Math.round((doneMeds / totalMeds) * 100);

    medsBox.innerHTML = `
      <div class="flex items-center justify-between gap-2">
        <div>
          <span class="font-extrabold text-sm text-green">医嘱执行每日打卡 (+)</span>
          <span class="badge ${pct === 100 ? 'badge-solid-green' : 'badge-orange'}">${doneMeds}/${APP_STATE.medications.length} 已服 (${pct}%)</span>
        </div>
        ${drugSlot ? `<button type="button" onclick="triggerCommercialClickById(${Number(drugSlot.id)}, this)" class="btn-blue" style="padding:5px 10px;font-size:11px;">京东健康购药(+) →</button>` : ''}
      </div>
      <div class="ew-progress-track">
        <div class="ew-progress-fill" style="width:${pct}%;"></div>
      </div>
      <div class="space-y-2 pt-1">
        ${APP_STATE.medications.map(m => `
          <label class="ew-card-paper flex items-center justify-between gap-2" style="cursor:pointer;${m.checked_today ? 'background:var(--ew-mint-soft);border-color:#9fd0b9;' : ''}">
            <div>
              <div class="font-extrabold">${escapeHtml(m.drug_name)} <span class="badge badge-gray">${escapeHtml(m.patient_name)}</span></div>
              <div class="text-muted mt-1" style="font-size:11px;">${escapeHtml(m.frequency)} · ${escapeHtml(m.dosage)} (疗程 ${Number(m.days_total)}天)</div>
            </div>
            <div class="flex items-center gap-1-5 whitespace-nowrap">
              <span class="font-bold ${m.checked_today ? 'text-green' : 'text-orange'}">${m.checked_today ? '今日已服' : '待服药'}</span>
              <input type="checkbox" ${m.checked_today ? 'checked' : ''} onchange="toggleMedication(${Number(m.id)}, this)" style="width:18px;height:18px;accent-color:#075e50;" />
            </div>
          </label>
        `).join('')}
      </div>
    `;
  }

  // 6. Post-visit Reports: 结果分享(+) / 术后复检倒计时(+) / 保险理赔资料包(+)
  const repBox = document.getElementById('capp-reports-container');
  if (repBox) {
    repBox.innerHTML = APP_STATE.reports.map(r => {
      const dLeft = daysUntilDate(r.recheck_date);
      const countdownLabel = dLeft !== null
        ? (dLeft >= 0 ? `距复检还有 ${dLeft} 天` : `已超建议复检期 ${Math.abs(dLeft)} 天`)
        : '复检提醒';
      return `
        <div class="ew-card space-y-2" style="padding:14px;">
          <div class="flex items-center justify-between">
            <span class="font-extrabold text-sm text-green">结果分享 (+) · 陪诊医嘱报告</span>
            <button type="button" onclick="shareMedicalReport(${Number(r.id)})" class="btn-orange" style="padding:5px 10px;font-size:11.5px;">转发授权家属</button>
          </div>

          <div class="ew-card-paper space-y-1.5">
            <div class="font-extrabold">${escapeHtml(r.visit_date)} ｜ ${escapeHtml(r.hospital_dept)}</div>
            <div class="text-subtle" style="font-size:11px;">患者：${escapeHtml(r.patient_name)} ｜ 履约陪诊员：${escapeHtml(r.escort_name)} ｜ 授权查看：${escapeHtml(r.authorized_viewers)}</div>
            <div style="line-height:1.58;">${escapeHtml(r.doctor_advice)}</div>
            <div class="badge badge-green" style="font-weight:600;">GB/T 47801—2026 合规水牌：仅作医生原话客观记录，不含任何主观诊断解读</div>
          </div>

          <!-- 术后复检与再次陪诊 (+) -->
          <div class="ew-card-mint flex items-center justify-between gap-2" style="padding:10px 12px;">
            <div>
              <div class="flex items-center gap-1-5 flex-wrap">
                <span class="font-extrabold text-green">术后/诊后复检提醒 (+)</span>
                <span class="badge badge-orange">${escapeHtml(countdownLabel)}</span>
              </div>
              <div class="text-muted mt-1" style="font-size:11px;">建议日期：<b>${escapeHtml(r.recheck_date)}</b> · ${escapeHtml(r.recheck_prep)}</div>
            </div>
            <button type="button" onclick="rebookFromReportId(${Number(r.id)})" class="btn-primary whitespace-nowrap" style="padding:8px 12px;font-size:11.5px;">
              一键再次陪诊
            </button>
          </div>

          <!-- 保险入口与理赔资料 (+) -->
          <div class="ew-card-paper space-y-1.5">
            <div class="flex items-center justify-between">
              <span class="font-extrabold text-green">保险理赔资料包 (+) · 共 ${r.claim_docs.length} 份凭证</span>
              <button type="button" onclick="downloadClaimBundle(${Number(r.id)})" class="btn-soft" style="padding:4px 9px;font-size:11px;background:#102e29;color:#fff;">
                一键打包下载 PDF
              </button>
            </div>
            <div class="flex flex-wrap gap-1">
              ${r.claim_docs.map(doc => `<span class="badge badge-gray">${escapeHtml(doc)}</span>`).join('')}
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  // 7. Care Tab: 7-Day Trend SVG Chart + Diaries List + Xiaohongshu Community Notes
  const elderDiaries = p
    ? APP_STATE.diaries.filter(d => d.patient_id === p.id || d.patient_name === p.name)
    : APP_STATE.diaries;
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
}

function renderCAppArticles() {
  const filterRow = document.getElementById('capp-article-filters');
  const artBox = document.getElementById('capp-articles-container');
  if (!filterRow || !artBox) return;

  const bookmarkedCount = APP_STATE.articles.filter(a => a.bookmarked).length;
  const cats = [
    { key: 'ALL', label: '全部推荐' },
    { key: '无障碍攻略', label: '无障碍攻略' },
    { key: '时令饮食', label: '节气食养' },
    { key: '视频讲堂', label: '护老视频' },
    { key: '慢病预防', label: '慢病防坑' },
    { key: 'BOOKMARKED', label: `我的收藏(${bookmarkedCount})` }
  ];

  filterRow.innerHTML = cats.map(c => `
    <button type="button" onclick="setArticleFilter('${c.key}')" class="filter-pill ${CURRENT_ART_FILTER === c.key ? 'active' : ''}">
      ${escapeHtml(c.label)}
    </button>
  `).join('');

  const list = APP_STATE.articles.filter(a => {
    if (CURRENT_ART_FILTER === 'ALL') return true;
    if (CURRENT_ART_FILTER === 'BOOKMARKED') return Boolean(a.bookmarked);
    return a.category === CURRENT_ART_FILTER;
  });

  if (list.length === 0) {
    artBox.innerHTML = '<div class="col-span-2 ew-card-paper text-center text-muted py-6">暂无收藏笔记，点击任意攻略卡片右下角「☆收藏」即可沉淀至个人清单</div>';
    return;
  }

  const coverClassMap = {
    '无障碍攻略': 'cat-guide',
    '时令饮食': 'cat-diet',
    '视频讲堂': 'cat-video',
    '慢病预防': 'cat-prev'
  };

  artBox.innerHTML = list.map(a => {
    const covCls = coverClassMap[a.category] || 'cat-guide';
    return `
      <article class="xhs-card">
        <div onclick="openArticleDetail(${Number(a.id)})" style="cursor:pointer;">
          <div class="xhs-cover ${covCls}">
            <div class="flex items-center justify-between" style="font-size:10px;opacity:0.92;">
              <span>#${escapeHtml(a.cover_tag || a.solar_term)}</span>
              <span>${Number(a.views)} 浏览</span>
            </div>
            <div style="font-size:11.5px;font-weight:800;line-height:1.3;">${escapeHtml(a.hospital_link || a.recommend_dept)}</div>
          </div>
          <div class="xhs-body">
            <div class="xhs-title">${escapeHtml(a.title)}</div>
            <div class="xhs-summary">${escapeHtml(a.summary)}</div>
            <div class="text-subtle" style="font-size:10px;">${escapeHtml(a.author_name || '持证陪诊顾问')}</div>
          </div>
        </div>
        <div class="flex items-center justify-between" style="padding:6px 10px 9px;border-top:1px solid #edf2ef;font-size:11px;">
          <button type="button" onclick="toggleArticleInteract(${Number(a.id)}, 'like', this)" class="font-bold" style="color:${a.liked ? '#d77844' : '#6c7f7a'};">
            ${a.liked ? '♥' : '♡'} ${Number(a.likes || 0)}
          </button>
          <button type="button" onclick="toggleArticleInteract(${Number(a.id)}, 'bookmark', this)" class="font-bold" style="color:${a.bookmarked ? '#075e50' : '#6c7f7a'};">
            ${a.bookmarked ? '★ 已藏' : '☆ 收藏'}
          </button>
        </div>
      </article>
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
  document.getElementById('art-modal-author').textContent = `作者：${art.author_name || '金牌陪诊顾问'} ｜ 关联医院科室：${art.hospital_link} · ${art.recommend_dept}`;
  document.getElementById('art-modal-content').textContent = art.content;
  document.getElementById('art-modal-actions').innerHTML = `
    <button type="button" onclick="toggleArticleInteract(${Number(art.id)}, 'bookmark', this);closeModal('modal-article-detail')" class="btn-soft">
      ${art.bookmarked ? '★ 取消收藏' : '☆ 收藏这篇避坑指南'}
    </button>
    <button type="button" onclick="bookFromArticle(${Number(art.id)})" class="btn-primary">
      预约同院该科室陪诊 →
    </button>
  `;
  openModal('modal-article-detail');
}

function bookFromArticle(artId) {
  const art = APP_STATE.articles.find(a => a.id === artId);
  if (!art) return;
  closeModal('modal-article-detail');
  if (art.hospital_link) {
    document.getElementById('mb-hospital').value = art.hospital_link;
    syncMobileHospitalCity();
  }
  if (art.recommend_dept) {
    document.getElementById('mb-dept').value = art.recommend_dept;
  }
  switchTerminal('c-app');
  switchCAppTab('book');
  showToast(`已从笔记自动带入【${art.hospital_link} · ${art.recommend_dept}】，可直接预约陪诊！`);
}

function shareCareCardForCurrentElder() {
  const p = getCurrentPatient();
  if (!p) return;
  showToast(`已生成【${p.city}立冬防寒与${p.relation}${p.age}岁生日温馨关怀卡】，已模拟调起微信转发至家庭群！`);
}

function shareMedicalReport(repId) {
  const r = APP_STATE.reports.find(x => x.id === repId);
  if (!r) return;
  showToast(`已按患者授权范围（${r.authorized_viewers}）生成加密小程序医嘱卡片并分享至家庭微信群！`);
}

function downloadClaimBundle(repId) {
  const r = APP_STATE.reports.find(x => x.id === repId);
  if (!r) return;
  showToast(`已将【${r.claim_docs.join('、')}】合并导出为标准保险理赔 PDF 资料包！`);
}

function setAiSample(text) {
  const inp = document.getElementById('ai-query-input');
  if (inp) inp.value = text;
  runAiTriage();
}

async function runAiTriage(btnEl) {
  const inp = document.getElementById('ai-query-input');
  if (!inp) return;
  const json = await apiRequest('/api/ai/triage', {
    method: 'POST',
    body: { query: inp.value }
  }, btnEl);
  if (!json || !json.reply) return;
  const r = json.reply;
  window.__lastAiReply = r;
  const box = document.getElementById('ai-result-box');
  if (!box) return;

  box.innerHTML = `
    <div class="ew-card space-y-2" style="padding:14px;border:2px solid var(--ew-green);">
      <div class="font-extrabold text-green">1. 就医前准备与必带资料清单：</div>
      <ul style="margin:0;padding-left:18px;" class="text-muted space-y-1">
        ${r.prepTips.map(t => `<li>${escapeHtml(t)}</li>`).join('')}
      </ul>
      <div class="font-extrabold text-green pt-1">2. 匹配医院科室与院内无障碍指引：</div>
      <div class="ew-card-paper space-y-1">
        <div class="font-extrabold text-sm">${escapeHtml(r.recommendedCity)} · ${escapeHtml(r.recommendedHospital)} · ${escapeHtml(r.recommendedDept)}</div>
        <div class="text-muted"><strong>官方放号规则：</strong>${escapeHtml(r.officialRegGuide)}</div>
        <div class="text-muted"><strong>轮椅与无障碍通道：</strong>${escapeHtml(r.wheelchairGuide)}</div>
        <div class="text-orange font-extrabold">建议协助分级：${escapeHtml(r.recommendedMobilityLevel)} (+¥${Number(r.recommendedMobilityFee)})</div>
        <button type="button" onclick="applyLastAiToBooking()" class="btn-orange w-full mt-2">
          一键带入该医院科室与失能分级去下单 →
        </button>
      </div>
    </div>
  `;
}

function applyLastAiToBooking() {
  const r = window.__lastAiReply;
  if (!r) return;
  document.getElementById('mb-hospital').value = r.recommendedHospital;
  document.getElementById('mb-dept').value = r.recommendedDept;
  syncMobileHospitalCity();

  const mobSel = document.getElementById('mb-mobility');
  for (let i = 0; i < mobSel.options.length; i++) {
    if (mobSel.options[i].value.startsWith(String(r.recommendedMobilityFee) + '|')) {
      mobSel.selectedIndex = i;
      break;
    }
  }
  recalcMobilePrice();
  switchCAppTab('book');
  showToast(`已将 AI 推荐的【${r.recommendedHospital} · ${r.recommendedDept}】填入预约单！`);
}

function syncMobileHospitalCity() {
  const sel = document.getElementById('mb-hospital');
  const badge = document.getElementById('mb-city-badge');
  if (!sel || !badge) return;
  const opt = sel.options[sel.selectedIndex];
  const city = (opt && opt.getAttribute('data-city')) || '北京';
  badge.textContent = `就诊城市：${city}`;
}

function prefillBookingLevel(val) {
  const mobSel = document.getElementById('mb-mobility');
  if (mobSel) {
    for (let i = 0; i < mobSel.options.length; i++) {
      if (mobSel.options[i].value === val) {
        mobSel.selectedIndex = i;
        break;
      }
    }
  }
  recalcMobilePrice();
  switchCAppTab('book');
}

function selectRegMode(mode, btnEl) {
  document.getElementById('mb-reg-mode').value = mode;
  document.querySelectorAll('.reg-mode-btn').forEach(b => {
    b.className = 'reg-mode-btn btn-soft';
    b.style.background = '';
  });
  btnEl.className = 'reg-mode-btn btn-outline';
  btnEl.style.background = 'var(--ew-mint-soft)';

  if (mode === '跳官方挂号') {
    const hospName = document.getElementById('mb-hospital').value;
    const hObj = APP_STATE && APP_STATE.hospitals.find(h => h.name === hospName);
    const guide = hObj ? hObj.official_reg_info : '医院官方小程序/App';
    showToast(`官方挂号指引：${guide}。挂好号后可直接继续提交陪诊预约！`);
  }
}

function recalcMobilePrice() {
  const base = Number(document.getElementById('mb-pkg').value.split('|')[0] || 288);
  const mob = Number(document.getElementById('mb-mobility').value.split('|')[0] || 80);
  const formulaEl = document.getElementById('mb-price-formula');
  const totalEl = document.getElementById('mb-total-price');
  if (formulaEl) formulaEl.textContent = `套餐 ¥${base} + 分级协助 ¥${mob}`;
  if (totalEl) totalEl.textContent = `¥${base + mob}`;
}

async function handleMobileOrderSubmit(e) {
  e.preventDefault();
  const btn = document.getElementById('mb-submit-btn');
  const [basePrice, pkgName] = document.getElementById('mb-pkg').value.split('|');
  const [mobFee, mobLabel] = document.getElementById('mb-mobility').value.split('|');
  const hospSel = document.getElementById('mb-hospital');
  const opt = hospSel.options[hospSel.selectedIndex];
  const city = (opt && opt.getAttribute('data-city')) || '北京';

  const payload = {
    source_channel: '微信小程序',
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
    patient_confirm_status: 'PENDING',
    patient_confirm_method: '待患者本人确认授权'
  };

  const json = await apiRequest('/api/orders', { method: 'POST', body: payload }, btn);
  if (json && json.order) {
    openPatientConfirmModalForOrder(json.order.id);
  }
}

function openPatientConfirmModalForOrder(orderId) {
  if (!APP_STATE) return;
  const ord = APP_STATE.orders.find(o => o.id === orderId);
  if (!ord) return;
  ACTIVE_CONFIRM_ORDER_ID = ord.id;
  document.getElementById('confirm-modal-orderno').textContent = `#${ord.order_no}（${ord.patient_name}）`;
  openModal('modal-patient-confirm');
}

function openPatientConfirmForLatest() {
  if (!APP_STATE || !APP_STATE.orders.length) return;
  const unconfirmed = APP_STATE.orders.find(o => o.sop_step >= 0 && o.patient_confirm_status !== 'CONFIRMED');
  const target = unconfirmed || APP_STATE.orders[0];
  openPatientConfirmModalForOrder(target.id);
}

async function submitPatientConfirm(methodDesc, btnEl) {
  if (!ACTIVE_CONFIRM_ORDER_ID) return;
  const json = await apiRequest(`/api/orders/${ACTIVE_CONFIRM_ORDER_ID}/confirm-patient`, {
    method: 'POST',
    body: { method: methodDesc }
  }, btnEl);
  if (json) {
    closeModal('modal-patient-confirm');
    switchCAppTab('home');
    showToast(`【患者确认(+)已完成】${methodDesc}，订单已进入后台待派单池！`);
  }
}

function openRideModal(startAddr, endHosp) {
  const s = startAddr || document.getElementById('mb-pickup').value;
  const e = endHosp || document.getElementById('mb-hospital').value;
  const hospObj = APP_STATE && APP_STATE.hospitals.find(h => h.name === e);
  const lat = hospObj ? hospObj.lat : 39.9138;
  const lng = hospObj ? hospObj.lng : 116.4175;

  document.getElementById('ride-start-text').textContent = s;
  document.getElementById('ride-end-text').textContent = `${e} · 无障碍优先落客通道`;
  document.getElementById('ride-coord-text').textContent = `目标无障碍坐标：lat=${lat}, lng=${lng} (已注入跳转 URI)`;
  const amapLink = document.getElementById('ride-amap-link');
  if (amapLink) {
    amapLink.href = `https://uri.amap.com/navigation?to=${encodeURIComponent(`${lng},${lat},${e}`)}&mode=car&src=everwell`;
  }
  openModal('modal-ride-wakeup');
}

function openRideModalByOrderId(orderId) {
  if (!APP_STATE) return;
  const ord = APP_STATE.orders.find(o => o.id === orderId);
  if (!ord) return;
  openRideModal(ord.pickup_address, ord.hospital_name);
}

async function addOrderOvertime(orderId, btnEl) {
  const json = await apiRequest(`/api/orders/${orderId}/add-overtime`, {
    method: 'POST',
    body: { hours: 1 }
  }, btnEl);
  if (json) {
    showToast('已在线支付 1 小时超时加钟补差价 (+¥100)，订单总额与陪诊师分账已实时重算！');
  }
}

function openCancelModal(orderId) {
  if (!APP_STATE) return;
  const ord = APP_STATE.orders.find(o => o.id === orderId);
  if (!ord) return;
  ACTIVE_CANCEL_ORDER_ID = ord.id;

  const tiers = [
    { code: '>48h', label: '距服务开始 > 48 小时', rate: 0, desc: '全额免费无损取消（违约金 0%）' },
    { code: '8-48h', label: '距服务开始 8 ~ 48 小时', rate: 0.1, desc: '扣除 10% 排班锁档违约金' },
    { code: '4-8h', label: '距服务开始 4 ~ 8 小时', rate: 0.2, desc: '扣除 20% 临期空驶违约金' },
    { code: '<4h', label: '距服务开始 < 4 小时', rate: 0.5, desc: '扣除 50% 紧急出勤补偿违约金' }
  ];

  const box = document.getElementById('cancel-tier-options');
  box.innerHTML = tiers.map(t => {
    const pen = (ord.total_price * t.rate).toFixed(2);
    const ref = (ord.total_price - ord.total_price * t.rate).toFixed(2);
    return `
      <button type="button" onclick="confirmCancelOrder('${t.code}', this)" class="ew-card-paper w-full text-left flex items-center justify-between gap-2" style="cursor:pointer;">
        <div>
          <div class="font-extrabold">${escapeHtml(t.label)}</div>
          <div class="text-muted" style="font-size:11px;">${escapeHtml(t.desc)} · 违约金 ¥${pen}</div>
        </div>
        <div class="text-right whitespace-nowrap">
          <div class="font-extrabold text-green">退回 ¥${ref}</div>
          <div class="text-orange font-bold" style="font-size:10.5px;">确认退单 →</div>
        </div>
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
    showToast(`订单已按【${tierCode}】阶梯规则办理取消：扣违约金 ¥${json.penalty}，原路退还 ¥${json.refund}`);
  }
}

async function toggleMedication(medId, inputEl) {
  const json = await apiRequest(`/api/medications/${medId}/toggle`, { method: 'POST' });
  if (json) {
    const allDone = APP_STATE.stats.medsChecked === APP_STATE.stats.medsTotal && APP_STATE.stats.medsTotal > 0;
    showToast(allDone
      ? '太棒了！今日所有医嘱服药计划已 100% 完成打卡！'
      : '【医嘱执行(+)】服药状态已实时同步至家庭档案！');
  } else if (inputEl) {
    inputEl.checked = !inputEl.checked;
  }
}

function rebookFromReportId(repId) {
  if (!APP_STATE) return;
  const r = APP_STATE.reports.find(x => x.id === repId);
  if (!r) return;
  const parts = String(r.hospital_dept || '').split('·').map(s => s.trim());
  if (parts[0]) document.getElementById('mb-hospital').value = parts[0];
  if (parts[1]) document.getElementById('mb-dept').value = parts[1];
  if (r.recheck_date) document.getElementById('mb-date').value = r.recheck_date;
  syncMobileHospitalCity();
  switchCAppTab('book');
  showToast('【术后复检与再次陪诊(+)】已自动带入原就诊医院、科室与建议复检日期！');
}

async function handleDiarySubmit(e) {
  e.preventDefault();
  const btn = document.getElementById('diary-submit-btn');
  const p = getCurrentPatient();
  const payload = {
    patient_id: p ? p.id : 1,
    patient_name: p ? p.name : '张建国',
    bp_sys: Number(document.getElementById('diary-sys').value),
    bp_dia: Number(document.getElementById('diary-dia').value),
    blood_sugar: Number(document.getElementById('diary-sugar').value),
    note: document.getElementById('diary-note').value || '已完成今日居家测量与定时关怀确认。'
  };
  const json = await apiRequest('/api/diaries', { method: 'POST', body: payload }, btn);
  if (json) {
    document.getElementById('diary-note').value = '';
    showToast('【健康日记(+)】体征记录已入库，7日趋势折线图已实时刷新！');
  }
}

async function triggerCommercialClickById(slotId, btnEl) {
  const json = await apiRequest(`/api/commercial/${slotId}/click`, { method: 'POST' }, btnEl);
  if (json && json.slot) {
    showToast(`【商业入口归因 +1】已记录「${json.slot.title}」有效导流（结算单价 ¥${json.slot.cpc_revenue}），即将打开合作页`);
  }
}

// ==================== 3. B-App (Escort Worker Workbench) ====================
function selectEscortIdentity(escortId) {
  CURRENT_ESCORT_ID = Number(escortId);
  savePref('ew_escort_id', CURRENT_ESCORT_ID);
  renderBApp();
  updateGlobalBadgesAndLoop();
}

function jumpToEscortForOrder(orderId) {
  if (!APP_STATE) return;
  const ord = APP_STATE.orders.find(o => o.id === orderId);
  if (ord && ord.escort_id) {
    CURRENT_ESCORT_ID = ord.escort_id;
    savePref('ew_escort_id', CURRENT_ESCORT_ID);
    renderBApp();
  }
  switchTerminal('b-app');
}

async function toggleCurrentEscortSchedule(btnEl) {
  const curEscort = APP_STATE && (APP_STATE.escorts.find(e => e.id === CURRENT_ESCORT_ID) || APP_STATE.escorts[0]);
  if (!curEscort) return;
  const json = await apiRequest(`/api/escorts/${curEscort.id}/toggle-schedule`, { method: 'POST' }, btnEl);
  if (json) {
    showToast(json.schedule_status === 'AVAILABLE'
      ? `【${curEscort.name}】已切换为「排班听单中」，后台派单池优先推荐！`
      : `【${curEscort.name}】已切换为「小休暂停接单」，后台调度已同步感知！`);
  }
}

function renderBApp() {
  const switcher = document.getElementById('escort-switcher-list');
  if (!switcher || !APP_STATE) return;

  switcher.innerHTML = APP_STATE.escorts.map(esc => {
    const isCur = esc.id === CURRENT_ESCORT_ID;
    const isAvail = esc.schedule_status === 'AVAILABLE';
    return `
      <button type="button" onclick="selectEscortIdentity(${Number(esc.id)})" class="w-full text-left flex items-center justify-between gap-2" style="padding:11px 13px;border-radius:12px;background:${isCur ? '#075e50' : '#132824'};border:1.5px solid ${isCur ? '#eb9362' : '#2a4a43'};color:#fff;">
        <div>
          <div class="font-extrabold text-sm">${escapeHtml(esc.name)} (${escapeHtml(esc.gender)}·${Number(esc.age)}岁) — ${escapeHtml(esc.org_name)}</div>
          <div style="font-size:11px;color:#b8d4c9;" class="mt-1">${escapeHtml(esc.cert_title)} ｜ 技能：${escapeHtml(esc.skills)}</div>
        </div>
        <span class="badge ${isAvail ? 'badge-solid-green' : 'badge-gray'} whitespace-nowrap">${isCur ? '当前工作台' : (isAvail ? '听单中' : '小休中')}</span>
      </button>
    `;
  }).join('');

  const curEscort = APP_STATE.escorts.find(e => e.id === CURRENT_ESCORT_ID) || APP_STATE.escorts[0];
  if (!curEscort) return;

  document.getElementById('bapp-escort-name').textContent = `${curEscort.name} · 陪诊师工作台`;
  document.getElementById('bapp-escort-meta').textContent = `${curEscort.org_name} ｜ 健康证有效至 ${curEscort.health_cert_expiry}`;

  const schedBtn = document.getElementById('bapp-schedule-btn');
  if (schedBtn) {
    const avail = curEscort.schedule_status === 'AVAILABLE';
    schedBtn.className = avail ? 'badge badge-solid-green' : 'badge badge-orange';
    schedBtn.textContent = avail ? '● 排班听单中' : '☾ 小休暂停听单';
  }

  document.getElementById('bapp-escort-stats').innerHTML = `
    <div>
      <div class="text-subtle" style="font-size:11px;">累计完单</div>
      <div class="text-base font-extrabold text-green">${Number(curEscort.completed_orders)} 单</div>
    </div>
    <div style="border-left:1px solid var(--ew-line);border-right:1px solid var(--ew-line);">
      <div class="text-subtle" style="font-size:11px;">累计分成收入</div>
      <div class="text-base font-extrabold text-orange">¥${Number(curEscort.total_earned)}</div>
    </div>
    <div>
      <div class="text-subtle" style="font-size:11px;">保证金余额</div>
      <div class="font-extrabold text-green mt-1" style="font-size:12px;">¥0 (3年免押)</div>
    </div>
  `;

  const myOrders = APP_STATE.orders.filter(o => o.escort_id === curEscort.id && o.sop_step >= 0);
  const bOrdersBox = document.getElementById('bapp-orders-list');

  if (myOrders.length === 0) {
    bOrdersBox.innerHTML = `
      <div class="ew-card text-center space-y-2" style="padding:24px 16px;">
        <div class="font-extrabold text-sm">当前名下暂无待履约订单</div>
        <div class="text-muted">您可以前往【4.管理与派单后台】将待派订单指派给 <b>${escapeHtml(curEscort.name)}</b>。</div>
        <button type="button" onclick="switchTerminal('admin')" class="btn-primary mt-2">前往管理后台派单 →</button>
      </div>
    `;
    return;
  }

  const quickNotes = [
    '已代借院内共享轮椅并完成自助机取号，正在诊区候诊',
    '正陪同长辈在诊室面诊，客观记录医生原话医嘱中',
    '正在放射科/检验科走高龄无障碍优先窗口完成检查',
    '已完成医保结算并在药房逐盒核对药品用法标签'
  ];

  bOrdersBox.innerHTML = myOrders.map(ord => {
    const stepDefs = [
      { n: 1, label: '第1步：确认接单 & 导航前往接手点' },
      { n: 2, label: '第2步：到达接手位置 (LBS核验+接手打卡)' },
      { n: 3, label: '第3步：院内陪诊进行中 (同步现场动态)' },
      { n: 4, label: '第4步：上传报告/理赔单 & 录入客观医嘱' },
      { n: 5, label: '第5步：安全送回交接点 · 完结自动分账' }
    ];

    return `
      <div class="ew-card space-y-2.5" style="padding:13px;border:2px solid var(--ew-green);">
        <div class="flex items-center justify-between">
          <span class="badge badge-orange">#${escapeHtml(ord.order_no)} · ${escapeHtml(ord.mobility_level)}</span>
          <span class="font-extrabold text-green">本单分成 ¥${Number(ord.provider_payout)}</span>
        </div>

        <div class="ew-card-paper space-y-1">
          <div class="font-extrabold text-sm">${escapeHtml(ord.patient_name)} · ${escapeHtml(ord.hospital_name)} (${escapeHtml(ord.department)})</div>
          <div class="text-muted">预约时间：${escapeHtml(ord.visit_date)} ${escapeHtml(ord.visit_time || '08:30')} ｜ 挂号：${escapeHtml(ord.reg_mode)}</div>
          <div class="text-muted"><strong>接手：</strong>${escapeHtml(ord.pickup_address)}</div>
          <div class="text-muted"><strong>交接：</strong>${escapeHtml(ord.dropoff_address)}</div>
        </div>

        <div class="flex items-center justify-between">
          <span class="font-extrabold text-green">标准 5 步履约节点打卡：</span>
          <button type="button" onclick="openRideModalByOrderId(${Number(ord.id)})" class="btn-blue" style="padding:4px 9px;font-size:11px;">高德/滴滴导航</button>
        </div>

        <div class="space-y-1.5">
          ${stepDefs.map(st => {
            const done = ord.sop_step >= st.n;
            const isNext = ord.sop_step + 1 === st.n;
            let cls = 'btn-soft';
            if (done) cls = 'btn-primary';
            else if (isNext) cls = 'btn-orange';
            return `
              <button type="button" onclick="handleEscortStepClick(${Number(ord.id)}, ${st.n}, '', this)" class="${cls} w-full justify-between" style="padding:9px 12px;font-size:11.5px;">
                <span>${st.label}</span>
                <span>${done ? '✓ 已打卡' : (isNext ? '点击推进 →' : '待执行')}</span>
              </button>
            `;
          }).join('')}
        </div>

        ${ord.sop_step >= 2 && ord.sop_step < 5 ? `
          <div class="ew-card-paper space-y-1.5">
            <div class="font-bold text-green" style="font-size:11px;">院内实时动态一键播报给家属（第3步细化关怀）：</div>
            <div class="grid-2" style="gap:5px;">
              ${quickNotes.map((qn, qIdx) => `
                <button type="button" onclick="broadcastStep3QuickNote(${Number(ord.id)}, ${qIdx}, this)" class="btn-soft text-left" style="padding:5px 7px;font-size:10.5px;">
                  · ${escapeHtml(qn.slice(0, 13))}...
                </button>
              `).join('')}
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');
}

async function broadcastStep3QuickNote(orderId, noteIdx, btnEl) {
  const quickNotes = [
    '已代借院内共享轮椅并完成自助机取号，正在诊区候诊',
    '正陪同长辈在诊室面诊，客观记录医生原话医嘱中',
    '正在放射科/检验科走高龄无障碍优先窗口完成检查',
    '已完成医保结算并在药房逐盒核对药品用法标签'
  ];
  const note = quickNotes[noteIdx] || quickNotes[0];
  await handleEscortStepClick(orderId, 3, note, btnEl);
}

async function handleEscortStepClick(orderId, stepNum, customNote = '', btnEl = null) {
  if (stepNum === 4) {
    ACTIVE_STEP4_ORDER_ID = orderId;
    openModal('modal-step4-report');
    return;
  }
  const json = await apiRequest(`/api/orders/${orderId}/step`, {
    method: 'POST',
    body: { step: stepNum, progress_note: customNote }
  }, btnEl);
  if (json) {
    showToast(stepNum === 5
      ? '【第5步安全交接完成】订单已闭环完结，平台提成与陪诊师收入已自动唯一入账！'
      : `【第 ${stepNum} 步打卡成功】现场进展已实时同步至 C 端家属手机与管理后台！`);
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
    authorized_viewers: document.getElementById('s4-viewers').value
  };
  const json = await apiRequest(`/api/orders/${ACTIVE_STEP4_ORDER_ID}/step`, {
    method: 'POST',
    body: payload
  }, btn);
  if (json) {
    closeModal('modal-step4-report');
    showToast('【第4步医嘱与理赔单上传成功】C端已同步生成《结果分享》《服药打卡》《复检倒计时》与《理赔资料包》！');
  }
}

// ==================== 4. Admin & B-End Org RBAC Console ====================
function setAdminRole(role) {
  CURRENT_ADMIN_ROLE = role;
  const pBtn = document.getElementById('adm-btn-platform');
  const oBtn = document.getElementById('adm-btn-org1');
  if (role === 'ORG_1') {
    oBtn.className = 'btn-primary';
    pBtn.className = 'btn-soft';
    showToast('已切换至【B端机构 RBAC 子账号：北京康护之家】，仅展示本机构运力、待抢/承接订单与8%分账明细');
  } else {
    pBtn.className = 'btn-primary';
    oBtn.className = 'btn-soft';
    showToast('已切换至【平台总控管理员】，可跨机构调度全平台运力并管理广告与入驻审批');
  }
  renderAdmin();
}

function setAdminOrderFilter(filterKey) {
  CURRENT_ADM_FILTER = filterKey;
  savePref('ew_adm_filter', filterKey);
  renderAdmin();
}

function renderAdmin() {
  if (!APP_STATE) return;
  const st = APP_STATE.stats;
  const roleOrders = CURRENT_ADMIN_ROLE === 'ORG_1'
    ? APP_STATE.orders.filter(o => o.org_id === 1 || o.sop_step === 0)
    : APP_STATE.orders;

  document.getElementById('adm-kpi-cards').innerHTML = `
    <div class="ew-card">
      <div class="text-muted">累计订单 / 待派单队列</div>
      <div class="text-2xl font-extrabold text-orange mt-1">${roleOrders.length} 单 <span class="text-xs font-semibold text-muted">(待派 ${st.pendingDispatchCount})</span></div>
      <div class="text-subtle mt-1">Web官网 / 小程序 / App 实时汇总</div>
    </div>
    <div class="ew-card">
      <div class="text-muted">平台撮合提成净收入 (≤10%)</div>
      <div class="text-2xl font-extrabold text-green mt-1">¥${st.totalPlatformFee.toFixed(2)}</div>
      <div class="text-subtle mt-1">B端合作机构 8% · 自有培训人员 6%</div>
    </div>
    <div class="ew-card">
      <div class="text-muted">运力保证金台账 (前3年免押期)</div>
      <div class="text-2xl font-extrabold text-green mt-1">¥0.00 <span class="text-xs font-semibold text-muted">(免至2029)</span></div>
      <div class="text-subtle mt-1">${APP_STATE.organizations.length} 家合作机构 · ${APP_STATE.escorts.length} 名持证陪诊师</div>
    </div>
    <div class="ew-card">
      <div class="text-muted">扩展业务导流与入口费收入</div>
      <div class="text-2xl font-extrabold text-blue mt-1">¥${st.totalAdRevenue.toFixed(2)}</div>
      <div class="text-subtle mt-1">累计精准导流点击 ${st.totalAdClicks} 次</div>
    </div>
  `;

  // Admin Order Status Filter Pills
  const filterDefs = [
    { key: 'ALL', label: `全部 (${roleOrders.length})` },
    { key: 'NEED_CONFIRM', label: `待患者确认 (${roleOrders.filter(o => o.sop_step >= 0 && o.patient_confirm_status !== 'CONFIRMED').length})` },
    { key: 'NEED_DISPATCH', label: `待派单 (${roleOrders.filter(o => o.sop_step === 0).length})` },
    { key: 'IN_PROGRESS', label: `履约中 (${roleOrders.filter(o => o.sop_step >= 1 && o.sop_step < 5).length})` },
    { key: 'COMPLETED', label: `已完结 (${roleOrders.filter(o => o.sop_step === 5).length})` },
    { key: 'CANCELLED', label: `已退改 (${roleOrders.filter(o => o.sop_step === -1).length})` }
  ];

  const admFiltersEl = document.getElementById('adm-order-filters');
  if (admFiltersEl) {
    admFiltersEl.innerHTML = filterDefs.map(f => `
      <button type="button" onclick="setAdminOrderFilter('${f.key}')" class="filter-pill ${CURRENT_ADM_FILTER === f.key ? 'active' : ''}">
        ${escapeHtml(f.label)}
      </button>
    `).join('');
  }

  const displayedOrders = roleOrders.filter(o => {
    if (CURRENT_ADM_FILTER === 'NEED_CONFIRM') return o.sop_step >= 0 && o.patient_confirm_status !== 'CONFIRMED';
    if (CURRENT_ADM_FILTER === 'NEED_DISPATCH') return o.sop_step === 0;
    if (CURRENT_ADM_FILTER === 'IN_PROGRESS') return o.sop_step >= 1 && o.sop_step < 5;
    if (CURRENT_ADM_FILTER === 'COMPLETED') return o.sop_step === 5;
    if (CURRENT_ADM_FILTER === 'CANCELLED') return o.sop_step === -1;
    return true;
  });

  const stepBadges = {
    '-1': '<span class="badge badge-gray">已退改取消</span>',
    0: '<span class="badge badge-orange">待派单调度</span>',
    1: '<span class="badge badge-blue">① 已接单出发</span>',
    2: '<span class="badge badge-blue">② 已达接手点</span>',
    3: '<span class="badge badge-purple">③ 院内陪诊中</span>',
    4: '<span class="badge badge-green">④ 已传医嘱/理赔</span>',
    5: '<span class="badge badge-solid-green">⑤ 已完结清分</span>'
  };

  const tbody = document.getElementById('adm-orders-tbody');
  if (displayedOrders.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-6">当前筛选条件下暂无订单记录</td></tr>';
  } else {
    tbody.innerHTML = displayedOrders.map(ord => `
      <tr style="border-bottom:1px solid var(--ew-line);${ord.sop_step === 0 ? 'background:#fff9f5;' : ''}">
        <td style="padding:11px;">
          <div class="font-extrabold">#${escapeHtml(ord.order_no)}</div>
          <div class="text-subtle">${escapeHtml(ord.source_channel)} · ${escapeHtml(ord.created_at)}</div>
        </td>
        <td style="padding:11px;">
          <div class="font-bold">${escapeHtml(ord.patient_name)}</div>
          <span class="badge badge-orange mt-1">${escapeHtml(ord.mobility_level)}</span>
        </td>
        <td style="padding:11px;">
          <div class="font-bold">[${escapeHtml(ord.city)}] ${escapeHtml(ord.hospital_name)}</div>
          <div class="text-muted">${escapeHtml(ord.department)} · ${escapeHtml(ord.visit_date)}</div>
          <div class="text-subtle">挂号：${escapeHtml(ord.reg_mode)}</div>
        </td>
        <td style="padding:11px;">
          ${ord.patient_confirm_status === 'CONFIRMED'
            ? `<span class="badge badge-green">✓ 已授权确认</span><div class="text-subtle mt-1" style="max-width:170px;">${escapeHtml(ord.patient_confirm_method)}</div>`
            : `<button type="button" onclick="openPatientConfirmModalForOrder(${Number(ord.id)})" class="badge badge-red" style="cursor:pointer;padding:4px 8px;">待确认 · 点击补确认</button>`}
        </td>
        <td style="padding:11px;">
          <div>总额 <strong>¥${Number(ord.total_price)}</strong> ${ord.overtime_fee > 0 ? `<span class="text-orange">(含加钟¥${Number(ord.overtime_fee)})</span>` : ''}</div>
          <div class="text-subtle">平台提成(${Math.round(ord.commission_rate * 100)}%)：¥${Number(ord.platform_fee)}</div>
          <div class="text-green font-bold">服务方分成：¥${Number(ord.provider_payout)}</div>
        </td>
        <td style="padding:11px;">
          ${ord.escort_name ? `<div class="font-bold">${escapeHtml(ord.escort_name)} <span class="text-subtle font-normal">(${escapeHtml(ord.org_name)})</span></div>` : '<div class="text-subtle">暂未指派人员</div>'}
          <div class="mt-1">${stepBadges[ord.sop_step] || ''}</div>
        </td>
        <td style="padding:11px;">
          <div class="flex flex-col gap-1">
            ${ord.sop_step >= 0 && ord.sop_step < 5 ? `
              <button type="button" onclick="openDispatchModalForOrder(${Number(ord.id)})" class="${ord.sop_step === 0 ? 'btn-orange' : 'btn-outline'}" style="padding:5px 10px;font-size:11.5px;">
                ${ord.sop_step === 0 ? '智能派单' : '改派替补'}
              </button>
            ` : ''}
            <button type="button" onclick="openOrderEventsModal(${Number(ord.id)})" class="btn-soft" style="padding:4px 10px;font-size:11px;">
              审计流水
            </button>
          </div>
        </td>
      </tr>
    `).join('');
  }

  // Commercial Attribution List
  document.getElementById('adm-commercial-list').innerHTML = APP_STATE.commercialSlots.map(s => `
    <div class="ew-card-paper flex items-center justify-between gap-2">
      <div>
        <span class="badge badge-green">${escapeHtml(s.slot_type)}</span>
        <strong class="ml-1">${escapeHtml(s.title)}</strong>
        <div class="text-subtle mt-1">${escapeHtml(s.partner_name)} · 展示价 ${escapeHtml(s.price_tag)}</div>
      </div>
      <div class="text-right whitespace-nowrap">
        <div class="font-extrabold text-blue">点击 ${Number(s.clicks)} 次 · ¥${(Number(s.clicks) * Number(s.cpc_revenue)).toFixed(2)}</div>
        <div class="text-subtle">单次导流 ¥${Number(s.cpc_revenue)}</div>
      </div>
    </div>
  `).join('');

  // Supply Applications & Escort Roster
  const pendingApps = APP_STATE.applications.filter(a => a.status === 'PENDING');
  document.getElementById('adm-applications-list').innerHTML = pendingApps.length === 0
    ? '<div class="ew-card-paper text-muted">当前无待审批申请（可在【1.Web官网】底部提交新的B端护工机构或陪诊师申请实时测试）。</div>'
    : pendingApps.map(a => `
        <div class="ew-card-paper flex items-center justify-between gap-2" style="background:var(--ew-orange-soft);border-color:#efc3a8;">
          <div>
            <span class="badge badge-orange">${a.apply_type === 'ORG' ? 'B端机构入驻' : '个人陪诊师报名'}</span>
            <strong>${escapeHtml(a.name)}</strong> (${escapeHtml(a.city)} · ${escapeHtml(a.phone)})
            <div class="text-muted mt-1">${escapeHtml(a.qualification)}</div>
          </div>
          <button type="button" onclick="approveApplication(${Number(a.id)}, this)" class="btn-primary whitespace-nowrap" style="padding:6px 12px;">审核通过</button>
        </div>
      `).join('');

  document.getElementById('adm-escorts-summary').innerHTML = APP_STATE.escorts.map(e => `
    <div class="flex items-center justify-between" style="padding:4px 0;">
      <span>
        <strong>${escapeHtml(e.name)}</strong> · <span class="text-green">${escapeHtml(e.org_name)}</span>
        <span class="badge ${e.schedule_status === 'AVAILABLE' ? 'badge-green' : 'badge-gray'}">${e.schedule_status === 'AVAILABLE' ? '听单中' : '小休'}</span>
      </span>
      <span class="text-muted">技能 ${escapeHtml(e.skills)} ｜ 完单 ${Number(e.completed_orders)}</span>
    </div>
  `).join('');
}

function openDispatchModalForOrder(orderId) {
  if (!APP_STATE) return;
  const ord = APP_STATE.orders.find(o => o.id === orderId);
  if (!ord) return;
  ACTIVE_DISPATCH_ORDER_ID = ord.id;
  document.getElementById('dispatch-modal-title').textContent = `智能派单：#${ord.order_no} · ${ord.patient_name} (${ord.mobility_level})`;

  const reqLevelCode = String(ord.mobility_level || 'L0').slice(0, 2);
  const hospShort = String(ord.hospital_name || '').slice(0, 4);

  const candidates = APP_STATE.escorts
    .filter(e => (CURRENT_ADMIN_ROLE === 'ORG_1' ? e.org_id === 1 : true))
    .map(e => {
      const skillMatch = String(e.skills).includes(reqLevelCode);
      const hospMatch = String(e.hospitals).includes(hospShort);
      const avail = e.schedule_status === 'AVAILABLE';
      const score = (avail ? 40 : 0) + (skillMatch ? 35 : 0) + (hospMatch ? 20 : 0) + Number(e.rating || 4.9);
      return { e, skillMatch, hospMatch, avail, score };
    })
    .sort((a, b) => b.score - a.score);

  document.getElementById('dispatch-candidates-list').innerHTML = candidates.map(({ e, skillMatch, hospMatch, avail }) => `
    <div class="${skillMatch && avail ? 'ew-card-mint' : 'ew-card-paper'} flex items-center justify-between gap-3">
      <div>
        <div class="font-extrabold text-sm text-green">
          ${escapeHtml(e.name)} (${escapeHtml(e.gender)}·${Number(e.age)}岁) — <span class="text-orange">${escapeHtml(e.org_name)}</span>
        </div>
        <div class="text-muted mt-1">${escapeHtml(e.cert_title)} ｜ 评分 ${Number(e.rating)} ｜ 提成率 ${e.org_id ? '8%' : '6%(自有优惠)'}</div>
        <div class="flex flex-wrap gap-1 mt-1">
          <span class="badge ${avail ? 'badge-solid-green' : 'badge-gray'}">${avail ? '● 排班空闲可接单' : '☾ 小休中'}</span>
          <span class="badge ${skillMatch ? 'badge-green' : 'badge-orange'}">${skillMatch ? `✓ 具备 ${reqLevelCode} 协助认证` : `技能范围：${escapeHtml(e.skills)}`}</span>
          <span class="badge badge-gray">${hospMatch ? '✓ 熟悉目标医院动线' : `常驻：${escapeHtml(e.hospitals)}`}</span>
        </div>
      </div>
      <button type="button" onclick="confirmDispatchToEscort(${Number(e.id)}, this)" class="btn-primary whitespace-nowrap">
        指派TA
      </button>
    </div>
  `).join('');

  openModal('modal-dispatch');
}

async function confirmDispatchToEscort(escortId, btnEl) {
  if (!ACTIVE_DISPATCH_ORDER_ID) return;
  const json = await apiRequest(`/api/orders/${ACTIVE_DISPATCH_ORDER_ID}/dispatch`, {
    method: 'POST',
    body: { escort_id: escortId }
  }, btnEl);
  if (json) {
    CURRENT_ESCORT_ID = Number(escortId);
    savePref('ew_escort_id', CURRENT_ESCORT_ID);
    closeModal('modal-dispatch');
    renderBApp();
    showToast('派单成功！订单已同步推送至该陪诊师工作台，点击顶部【3.陪诊师接单台】即可推进现场打卡！');
  }
}

function openOrderEventsModal(orderId) {
  if (!APP_STATE) return;
  const ord = APP_STATE.orders.find(o => o.id === orderId);
  if (!ord) return;
  document.getElementById('events-modal-title').textContent = `订单 #${ord.order_no} 全链路合规留痕流水`;
  const evs = (APP_STATE.orderEvents || []).filter(ev => ev.order_id === orderId);
  const box = document.getElementById('events-timeline-box');
  if (evs.length === 0) {
    box.innerHTML = '<div class="ew-card-paper text-muted">订单已建档，等待后续流转事件记录</div>';
  } else {
    box.innerHTML = evs.map(ev => `
      <div class="audit-item">
        <div class="flex items-center justify-between">
          <span class="font-extrabold text-green">${escapeHtml(ev.title)}</span>
          <span class="text-subtle" style="font-size:11px;">${escapeHtml(ev.created_at)}</span>
        </div>
        <div class="text-muted mt-1">${escapeHtml(ev.detail)}</div>
        <div class="text-subtle mt-1" style="font-size:10.5px;">操作主体：${escapeHtml(ev.operator)}</div>
      </div>
    `).join('');
  }
  openModal('modal-order-events');
}

async function approveApplication(appId, btnEl) {
  const json = await apiRequest(`/api/applications/${appId}/approve`, { method: 'POST' }, btnEl);
  if (json) {
    showToast('审批通过！新运力已自动加入平台供给池并开启前 3 年免押金台账！');
  }
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
  const json = await apiRequest('/api/commercial', { method: 'POST', body: payload }, btn);
  if (json) {
    closeModal('modal-add-commercial');
    e.target.reset();
    showToast('新商业合作资源位已上架至 C 端，点击归因计费已实时生效！');
  }
}

// ==================== Bootstrapping ====================
window.addEventListener('DOMContentLoaded', async () => {
  switchTerminal(CURRENT_TERMINAL, true);
  switchCAppTab(CURRENT_CAPP_TAB);
  recalcWebPrice();
  recalcMobilePrice();
  await fetchBootstrap();
  runAiTriage();
});
