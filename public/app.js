let APP_STATE = null;
let CURRENT_ESCORT_ID = 1;
let CURRENT_ADMIN_ROLE = 'PLATFORM'; // 'PLATFORM' or 'ORG_1'
let ACTIVE_CONFIRM_ORDER_ID = null;
let ACTIVE_DISPATCH_ORDER_ID = null;
let ACTIVE_STEP4_ORDER_ID = null;

function showToast(msg) {
  const el = document.getElementById('global-toast');
  if (!el) return;
  el.innerText = msg;
  el.classList.remove('hidden');
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => {
    el.classList.add('hidden');
  }, 4500);
}

function openModal(id) {
  const m = document.getElementById(id);
  if (m) {
    m.classList.remove('hidden');
    m.classList.add('flex');
  }
}

function closeModal(id) {
  const m = document.getElementById(id);
  if (m) {
    m.classList.add('hidden');
    m.classList.remove('flex');
  }
}

function switchTerminal(termId) {
  document.querySelectorAll('.terminal-view').forEach(el => el.classList.add('hidden'));
  const target = document.getElementById('term-' + termId);
  if (target) target.classList.remove('hidden');

  document.querySelectorAll('.term-btn').forEach(btn => {
    btn.className = 'term-btn px-3.5 py-1.5 rounded-lg text-xs font-semibold transition text-[#b6cec2] hover:text-white';
  });
  const activeBtn = document.getElementById('tab-btn-' + termId);
  if (activeBtn) {
    activeBtn.className = 'term-btn px-3.5 py-1.5 rounded-lg text-xs font-semibold transition bg-[#d77844] text-white shadow';
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function switchCAppTab(tabId) {
  document.querySelectorAll('.capp-subview').forEach(el => el.classList.add('hidden'));
  const view = document.getElementById('capp-view-' + tabId);
  if (view) view.classList.remove('hidden');

  document.querySelectorAll('.capp-tab-btn').forEach(btn => {
    btn.className = 'capp-tab-btn text-gray-500 flex flex-col items-center';
  });
  const activeTab = document.getElementById('ctab-' + tabId);
  if (activeTab) {
    activeTab.className = 'capp-tab-btn font-bold ew-text-green flex flex-col items-center';
  }
}

async function fetchBootstrap() {
  const res = await fetch('/api/bootstrap');
  const json = await res.json();
  if (json.ok) {
    APP_STATE = json.data;
    renderAll();
  }
}

function renderAll() {
  if (!APP_STATE) return;
  renderWebPortal();
  renderCApp();
  renderBApp();
  renderAdmin();
}

// ==================== 1. Render Web Portal ====================
function renderWebPortal() {
  const container = document.getElementById('web-articles-container');
  if (!container) return;
  container.innerHTML = APP_STATE.articles.map(art => `
    <div class="p-3 rounded-xl bg-[#faf9f5] border border-[#dce3dc] flex justify-between items-center gap-3">
      <div>
        <span class="px-2 py-0.5 rounded bg-[#dff0e7] ew-text-green font-semibold mr-1.5">${art.category} · ${art.solar_term}</span>
        <span class="font-bold text-[#142c2a]">${art.title}</span>
        <p class="text-gray-500 mt-1">${art.summary}</p>
      </div>
      <button onclick="switchTerminal('c-app');switchCAppTab('care')" class="ew-text-orange font-bold whitespace-nowrap">阅读/预约 →</button>
    </div>
  `).join('');
}

async function handleWebOrderSubmit(e) {
  e.preventDefault();
  const [basePrice, pkgName, regMode] = document.getElementById('wb-pkg').value.split('|');
  const [mobFee, mobLabel] = document.getElementById('wb-mobility').value.split('|');

  const payload = {
    source_channel: 'Web官网',
    patient_name: document.getElementById('wb-patient').value,
    contact_phone: document.getElementById('wb-phone').value,
    city: '北京',
    hospital_name: document.getElementById('wb-hospital').value,
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
    patient_confirm_method: 'Web端家属勾选已获患者本人知情授权'
  };

  const res = await fetch('/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const json = await res.json();
  if (json.ok) {
    APP_STATE = json.data;
    renderAll();
    showToast(`🎉 Web 预约单 #${json.order.order_no} 已写入数据库！正在为您切换至【4.管理后台】查看实时待派单...`);
    setTimeout(() => switchTerminal('admin'), 900);
  }
}

async function handleWebJoinSubmit(e) {
  e.preventDefault();
  const payload = {
    apply_type: document.getElementById('join-type').value,
    name: document.getElementById('join-name').value,
    phone: document.getElementById('join-phone').value,
    city: document.getElementById('join-city').value,
    qualification: document.getElementById('join-qual').value
  };
  const res = await fetch('/api/applications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const json = await res.json();
  if (json.ok) {
    APP_STATE = json.data;
    renderAll();
    e.target.reset();
    showToast('✅ 入驻申请已提交至数据库！正在切换至【4.管理后台】供您审核通过...');
    setTimeout(() => switchTerminal('admin'), 900);
  }
}

// ==================== 2. Render C-App (Mini-Program / App Family Mode) ====================
function renderCApp() {
  const p = APP_STATE.patient;
  if (p) {
    document.getElementById('capp-patient-banner').innerText = `照护对象：${p.name} (${p.age}岁 · ${p.mobility_label.split(' ')[0]})`;
    document.getElementById('capp-weather-city').innerText = `📍 ${p.city} · 立冬节气`;
    document.getElementById('capp-birthday-title').innerText = `今日大幅降温 8°C · 距父亲 ${p.age} 岁生日(${p.birthday})还有 ${p.days_to_birthday} 天`;
    document.getElementById('capp-weather-desc').innerText = p.weather_alert;
  }

  // Orders list in C-App Home
  const ordersBox = document.getElementById('capp-orders-container');
  const sopLabels = {
    '-1': '⚪ 已退改取消',
    0: '⏳ 待后台指派陪诊师',
    1: '🚗 第1步：陪诊师已接单出发',
    2: '📍 第2步：已到达接手位置打卡',
    3: '🏥 第3步：院内陪诊服务进行中',
    4: '📋 第4步：已传报告/医嘱与理赔单',
    5: '✅ 第5步：已送回交接点·服务完成'
  };

  ordersBox.innerHTML = APP_STATE.orders.slice(0, 4).map(ord => `
    <div class="bg-white p-3.5 rounded-2xl border-2 ${ord.sop_step === -1 ? 'border-gray-200 opacity-75' : 'ew-border-green'} shadow-sm space-y-2 text-xs">
      <div class="flex justify-between items-center">
        <span class="font-bold px-2 py-0.5 rounded ew-bg-mint ew-text-green">${ord.order_no} · ${sopLabels[ord.sop_step] || ''}</span>
        <span class="font-extrabold ew-text-orange">¥${ord.total_price}</span>
      </div>
      <div class="font-bold text-[#142c2a]">${ord.hospital_name} · ${ord.department} (${ord.visit_date})</div>
      <div class="text-gray-600">患者：${ord.patient_name} ｜ 分级：<b>${ord.mobility_level}</b> ｜ 挂号：${ord.reg_mode}</div>
      <div class="text-gray-500">📍 接手：${ord.pickup_address}</div>
      <div class="p-2 rounded-lg bg-[#faf9f5] border text-gray-600">
        <b>实时状态</b>：${ord.live_note}
        <br><b>患者确认(+)</b>：<span class="ew-text-green font-semibold">${ord.patient_confirm_method}</span>
      </div>
      ${ord.sop_step >= 0 ? `
        <div class="flex flex-wrap gap-1.5 pt-1">
          ${ord.patient_confirm_status !== 'CONFIRMED' ? `
            <button onclick="openPatientConfirmModalForOrder(${ord.id}, '${ord.order_no}')" class="bg-[#d77844] text-white py-1.5 px-2.5 rounded-lg font-bold">✍️ 患者确认(+)</button>
          ` : ''}
          <button onclick="openRideModal('${ord.pickup_address}', '${ord.hospital_name}')" class="flex-1 bg-blue-600 text-white py-1.5 px-2 rounded-lg font-bold">🚕 跳滴滴/高德(+)</button>
          <button onclick="addOrderOvertime(${ord.id})" class="bg-orange-100 ew-text-orange py-1.5 px-2 rounded-lg font-bold">⏱️ 补差价(+¥100)</button>
          ${ord.sop_step < 4 ? `
            <button onclick="cancelOrderWithTier(${ord.id})" class="bg-gray-100 text-gray-600 py-1.5 px-2 rounded-lg">退改</button>
          ` : ''}
        </div>
      ` : ''}
    </div>
  `).join('');

  // Commercial slots on Home (体检推荐+ & 保险入口+)
  const commHome = document.getElementById('capp-commercial-home');
  commHome.innerHTML = APP_STATE.commercialSlots.filter(s => s.slot_type !== '购药入口').slice(0, 2).map(s => `
    <div onclick="triggerCommercialClick(${s.id}, '${s.title}', '${s.target_url}')" class="p-2.5 rounded-xl bg-[#faf9f5] border border-[#dce3dc] cursor-pointer hover:border-[#075e50] transition">
      <span class="px-1.5 py-0.5 rounded ew-bg-mint ew-text-green font-bold">${s.slot_type}(+)</span>
      <div class="font-bold text-[#142c2a] mt-1">${s.title}</div>
      <div class="text-gray-500 mt-0.5 line-clamp-2">${s.subtitle}</div>
      <div class="ew-text-orange font-bold mt-1 flex justify-between items-center">
        <span>${s.price_tag}</span>
        <span class="text-gray-400 font-normal">已导流 ${s.clicks}次</span>
      </div>
    </div>
  `).join('');

  // Post-visit Reports (结果分享+ / 术后复检与再次陪诊+ / 保险理赔资料+)
  const repBox = document.getElementById('capp-reports-container');
  const drugSlot = APP_STATE.commercialSlots.find(s => s.slot_type === '购药入口') || APP_STATE.commercialSlots[0];
  repBox.innerHTML = APP_STATE.reports.map(r => `
    <div class="bg-white p-3.5 rounded-2xl border border-[#dce3dc] space-y-2.5 shadow-sm">
      <div class="flex justify-between items-center">
        <span class="font-extrabold text-sm ew-text-green">📋 结果分享 (+) · 陪诊医嘱报告</span>
        <button onclick="showToast('📤 已按患者授权范围（${r.authorized_viewers}）生成加密小程序卡片并分享至家庭微信群！')" class="ew-bg-orange text-white px-2.5 py-1 rounded-lg font-bold">📤 转发授权家属</button>
      </div>
      <div class="p-2.5 rounded-xl bg-[#faf9f5] border border-[#dce3dc] space-y-1.5">
        <div class="font-bold text-[#142c2a]">${r.visit_date} ｜ ${r.hospital_dept} (陪诊员：${r.escort_name})</div>
        <div class="text-gray-700 leading-relaxed">${r.doctor_advice}</div>
        <div class="text-gray-500">👁️ <b>患者授权可查看人</b>：${r.authorized_viewers}</div>
        <div class="text-emerald-800 bg-[#dff0e7]/60 p-1.5 rounded text-xs">
          🛡️ <b>GB/T 47801—2026 合规水牌</b>：本报告仅作医生原话客观记录，不含任何报告解读或诊疗建议。
        </div>
      </div>

      <!-- 术后复检与再次陪诊 (+) -->
      <div class="p-2.5 rounded-xl bg-[#dff0e7]/40 border ew-border-green flex items-center justify-between gap-2">
        <div>
          <div class="font-extrabold ew-text-green">🗓️ 术后/诊后复检与再次陪诊 (+)</div>
          <div class="text-gray-600 mt-0.5">建议复检日：<b>${r.recheck_date}</b> (${r.recheck_prep})</div>
        </div>
        <button onclick="rebookFromReport('${r.hospital_dept}', '${r.recheck_date}')" class="ew-bg-green text-white px-3 py-2 rounded-xl font-bold whitespace-nowrap">
          一键再次陪诊
        </button>
      </div>

      <!-- 保险入口与理赔资料 (+) -->
      <div class="p-2.5 rounded-xl bg-gray-50 border border-[#dce3dc] space-y-1.5">
        <div class="flex justify-between items-center">
          <span class="font-extrabold ew-text-green">🗂️ 保险理赔资料包 (+) · 共 ${r.claim_docs.length} 份凭证</span>
          <button onclick="showToast('📥 已将【${r.claim_docs.join('、')}】打包导出为 PDF 理赔资料包！')" class="bg-[#102e29] text-white px-2.5 py-1 rounded-lg font-bold">📥 一键打包下载</button>
        </div>
        <div class="flex flex-wrap gap-1.5">
          ${r.claim_docs.map(doc => `<span class="px-2 py-1 bg-white rounded border text-gray-600">🧾 ${doc}</span>`).join('')}
        </div>
      </div>
    </div>
  `).join('');

  // 医嘱执行 (+) & 购药 (+)
  const medsBox = document.getElementById('capp-meds-container');
  medsBox.innerHTML = `
    <div class="flex justify-between items-center">
      <span class="font-extrabold text-sm ew-text-green">💊 医嘱执行打卡 (+) & 合作购药入口 (+)</span>
      ${drugSlot ? `<button onclick="triggerCommercialClick(${drugSlot.id}, '${drugSlot.title}', '${drugSlot.target_url}')" class="text-blue-600 font-bold underline">🛒 跳京东健康购药(+) →</button>` : ''}
    </div>
    <div class="space-y-2 pt-1">
      ${APP_STATE.medications.map(m => `
        <label class="flex items-center justify-between p-2.5 rounded-xl ${m.checked_today ? 'bg-[#dff0e7]/50 border ew-border-green' : 'bg-[#faf9f5] border'} cursor-pointer">
          <div>
            <div class="font-bold text-[#142c2a]">${m.drug_name}</div>
            <div class="text-gray-500">${m.frequency} · ${m.dosage} (疗程 ${m.days_total}天)</div>
          </div>
          <div class="flex items-center gap-1.5">
            <span class="font-bold ${m.checked_today ? 'ew-text-green' : 'text-orange-600'}">${m.checked_today ? '今日已服' : '待打卡'}</span>
            <input type="checkbox" ${m.checked_today ? 'checked' : ''} onchange="toggleMedication(${m.id})" class="w-5 h-5 accent-[#075e50]" />
          </div>
        </label>
      `).join('')}
    </div>
  `;

  // 健康日记与定时关怀 (+)
  const diaryBox = document.getElementById('capp-diaries-container');
  diaryBox.innerHTML = APP_STATE.diaries.map(d => `
    <div class="p-2.5 rounded-xl bg-[#faf9f5] border border-[#dce3dc] flex justify-between items-center">
      <div>
        <div class="font-bold text-[#142c2a]">${d.log_date} · 血压 ${d.bp_sys}/${d.bp_dia} mmHg · 血糖 ${d.blood_sugar}</div>
        <div class="text-gray-500 mt-0.5">${d.note || ''}</div>
      </div>
      <span class="px-2 py-0.5 rounded bg-[#dff0e7] ew-text-green font-bold whitespace-nowrap">${d.feeling}</span>
    </div>
  `).join('');

  // 健康文章、视频与时令饮食 (+)
  const artBox = document.getElementById('capp-articles-container');
  artBox.innerHTML = APP_STATE.articles.map(a => `
    <div class="p-2.5 rounded-xl bg-[#faf9f5] border border-[#dce3dc] space-y-1">
      <div class="flex justify-between items-center">
        <span class="px-2 py-0.5 rounded ew-bg-mint ew-text-green font-bold">${a.category} · ${a.solar_term}</span>
        <span class="text-gray-400">${a.views} 阅读</span>
      </div>
      <div class="font-bold text-[#142c2a]">${a.title}</div>
      <p class="text-gray-600 leading-relaxed">${a.content}</p>
      <div class="pt-1 flex justify-between items-center border-t">
        <span class="text-gray-500">关联科室：${a.recommend_dept}</span>
        <button onclick="switchCAppTab('book')" class="ew-text-orange font-bold">预约该科室陪诊 →</button>
      </div>
    </div>
  `).join('');
}

function setAiSample(text) {
  document.getElementById('ai-query-input').value = text;
  runAiTriage();
}

async function runAiTriage() {
  const query = document.getElementById('ai-query-input').value;
  const res = await fetch('/api/ai/triage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  });
  const json = await res.json();
  if (!json.ok) return;
  const r = json.reply;
  document.getElementById('ai-result-box').innerHTML = `
    <div class="bg-white p-3.5 rounded-2xl border-2 ew-border-green space-y-2.5 shadow-sm">
      <div class="font-bold ew-text-green">📌 1. 就医前准备与携带材料清单：</div>
      <ul class="list-disc pl-4 text-gray-600 space-y-1">
        ${r.prepTips.map(t => `<li>${t}</li>`).join('')}
      </ul>
      <div class="font-bold ew-text-green pt-1">🏥 2. 智能匹配医院科室与无障碍指引：</div>
      <div class="p-3 rounded-xl bg-[#faf9f5] border space-y-1">
        <div class="font-extrabold text-sm text-[#142c2a]">${r.recommendedHospital} · ${r.recommendedDept}</div>
        <div class="text-gray-600"><b>官方挂号指引</b>：${r.officialRegGuide}</div>
        <div class="text-gray-600"><b>院内轮椅租借</b>：${r.wheelchairGuide}</div>
        <div class="ew-text-orange font-bold">建议行动协助等级：${r.recommendedMobilityLevel} (+¥${r.recommendedMobilityFee})</div>
        <button onclick="applyAiToBooking('${r.recommendedHospital}', '${r.recommendedDept}', '${r.recommendedMobilityFee}|${r.recommendedMobilityLevel}')" class="w-full mt-2 ew-bg-orange text-white py-2 rounded-xl font-bold shadow">
          一键带入该医院科室预约陪诊 →
        </button>
      </div>
    </div>
  `;
}

function applyAiToBooking(hospital, dept, mobilityVal) {
  document.getElementById('mb-hospital').value = hospital;
  document.getElementById('mb-dept').value = dept;
  const mobSel = document.getElementById('mb-mobility');
  for (let i = 0; i < mobSel.options.length; i++) {
    if (mobSel.options[i].value.startsWith(mobilityVal.split('|')[0])) {
      mobSel.selectedIndex = i;
      break;
    }
  }
  recalcMobilePrice();
  switchCAppTab('book');
  showToast('🤖 已将 AI 推荐的医院、科室与失能协助等级自动填入下单页！');
}

function prefillBookingLevel(val) {
  const mobSel = document.getElementById('mb-mobility');
  for (let i = 0; i < mobSel.options.length; i++) {
    if (mobSel.options[i].value === val) {
      mobSel.selectedIndex = i;
      break;
    }
  }
  recalcMobilePrice();
  switchCAppTab('book');
}

function selectRegMode(mode, btnEl) {
  document.getElementById('mb-reg-mode').value = mode;
  document.querySelectorAll('.reg-mode-btn').forEach(b => {
    b.className = 'reg-mode-btn p-2 rounded-lg border bg-[#faf9f5]';
  });
  btnEl.className = 'reg-mode-btn p-2 rounded-lg border-2 ew-border-green bg-[#dff0e7] ew-text-green font-bold';
  if (mode === '跳官方挂号') {
    const hosp = document.getElementById('mb-hospital').value;
    showToast(`🔗 已为您展示【${hosp}】官方挂号通道指引，挂好号后可直接继续下单！`);
  }
}

function recalcMobilePrice() {
  const [base] = document.getElementById('mb-pkg').value.split('|');
  const [mob] = document.getElementById('mb-mobility').value.split('|');
  const total = Number(base) + Number(mob);
  document.getElementById('mb-total-price').innerText = '¥' + total;
}

async function handleMobileOrderSubmit(e) {
  e.preventDefault();
  const [basePrice, pkgName] = document.getElementById('mb-pkg').value.split('|');
  const [mobFee, mobLabel] = document.getElementById('mb-mobility').value.split('|');

  const payload = {
    source_channel: '微信小程序',
    patient_name: document.getElementById('mb-patient').value,
    contact_phone: document.getElementById('mb-phone').value,
    city: '北京',
    hospital_name: document.getElementById('mb-hospital').value,
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

  const res = await fetch('/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const json = await res.json();
  if (json.ok) {
    APP_STATE = json.data;
    renderAll();
    openPatientConfirmModalForOrder(json.order.id, json.order.order_no);
  }
}

function openPatientConfirmModalForOrder(orderId, orderNo) {
  ACTIVE_CONFIRM_ORDER_ID = orderId;
  document.getElementById('confirm-modal-orderno').innerText = '#' + orderNo;
  openModal('modal-patient-confirm');
}

function openPatientConfirmForLatest() {
  if (!APP_STATE || !APP_STATE.orders.length) return;
  const target = APP_STATE.orders[0];
  openPatientConfirmModalForOrder(target.id, target.order_no);
}

async function submitPatientConfirm(methodDesc) {
  if (!ACTIVE_CONFIRM_ORDER_ID) return;
  const res = await fetch(`/api/orders/${ACTIVE_CONFIRM_ORDER_ID}/confirm-patient`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method: methodDesc })
  });
  const json = await res.json();
  if (json.ok) {
    APP_STATE = json.data;
    closeModal('modal-patient-confirm');
    renderAll();
    switchCAppTab('home');
    showToast(`✅ 【患者确认(+)成功】${methodDesc}，已同步至管理后台待派单池！`);
  }
}

function openRideModal(startAddr, endHosp) {
  const s = startAddr || document.getElementById('mb-pickup').value;
  const e = endHosp || document.getElementById('mb-hospital').value;
  document.getElementById('ride-start-text').innerText = s;
  document.getElementById('ride-end-text').innerText = e + ' 东门无障碍落客区';
  openModal('modal-ride-wakeup');
}

async function addOrderOvertime(orderId) {
  const res = await fetch(`/api/orders/${orderId}/add-overtime`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hours: 1 })
  });
  const json = await res.json();
  if (json.ok) {
    APP_STATE = json.data;
    renderAll();
    showToast('⏱️ 已在线支付 1 小时超时加钟补差价 (+¥100)，订单总额与平台/陪诊师分账已实时更新！');
  }
}

async function cancelOrderWithTier(orderId) {
  const res = await fetch(`/api/orders/${orderId}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tier: '8-48h' })
  });
  const json = await res.json();
  if (json.ok) {
    APP_STATE = json.data;
    renderAll();
    showToast(`💸 已按阶梯退改规则（距服务 8~48h 扣 10% 违约金 ¥${json.penalty}）办理取消，原路退还 ¥${json.refund}！`);
  }
}

async function toggleMedication(medId) {
  const res = await fetch(`/api/medications/${medId}/toggle`, { method: 'POST' });
  const json = await res.json();
  if (json.ok) {
    APP_STATE = json.data;
    renderAll();
    showToast('💊 【医嘱执行(+)】今日服药打卡状态已更新至数据库！');
  }
}

function rebookFromReport(hospDept, recheckDate) {
  const parts = hospDept.split('·').map(s => s.trim());
  if (parts[0]) document.getElementById('mb-hospital').value = parts[0];
  if (parts[1]) document.getElementById('mb-dept').value = parts[1];
  if (recheckDate) document.getElementById('mb-date').value = recheckDate;
  switchCAppTab('book');
  showToast('🗓️ 【术后复检与再次陪诊(+)】已自动带入上次医院、科室与复检日期！');
}

async function handleDiarySubmit(e) {
  e.preventDefault();
  const payload = {
    patient_name: '张建国',
    bp_sys: document.getElementById('diary-sys').value,
    bp_dia: document.getElementById('diary-dia').value,
    blood_sugar: document.getElementById('diary-sugar').value,
    feeling: '今日打卡 ✅',
    note: document.getElementById('diary-note').value || '已完成早晚定时关怀确认与日常血压记录。'
  };
  const res = await fetch('/api/diaries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const json = await res.json();
  if (json.ok) {
    APP_STATE = json.data;
    renderAll();
    document.getElementById('diary-note').value = '';
    showToast('📓 【健康日记与定时关怀(+)】新记录已保存入库！');
  }
}

async function triggerCommercialClick(slotId, title, targetUrl) {
  const res = await fetch(`/api/commercial/${slotId}/click`, { method: 'POST' });
  const json = await res.json();
  if (json.ok) {
    APP_STATE = json.data;
    renderAll();
    showToast(`💰 【商业化入口归因成功】已记录「${title}」有效点击 +1（后台广告收入已累加），合作外链：${targetUrl}`);
  }
}

// ==================== 3. Render B-App (Escort Worker Mode) ====================
function renderBApp() {
  const switcher = document.getElementById('escort-switcher-list');
  switcher.innerHTML = APP_STATE.escorts.map(esc => `
    <button onclick="selectEscortIdentity(${esc.id})" class="w-full p-3 rounded-xl text-left transition flex justify-between items-center ${esc.id === CURRENT_ESCORT_ID ? 'bg-[#075e50] text-white border-2 border-[#d77844]' : 'bg-[#102e29] text-[#b6cec2] hover:text-white'}">
      <div>
        <div class="font-bold text-sm">${esc.name} (${esc.gender} · ${esc.age}岁) — ${esc.org_name}</div>
        <div class="text-xs opacity-80 mt-0.5">${esc.cert_title} ｜ 可承接：${esc.skills}</div>
      </div>
      <span class="px-2 py-0.5 rounded bg-white/15 font-bold">${esc.id === CURRENT_ESCORT_ID ? '当前登录' : '切换'}</span>
    </button>
  `).join('');

  const curEscort = APP_STATE.escorts.find(e => e.id === CURRENT_ESCORT_ID) || APP_STATE.escorts[0];
  if (!curEscort) return;

  document.getElementById('bapp-escort-name').innerText = `${curEscort.name} · 陪诊师工作台`;
  document.getElementById('bapp-escort-meta').innerText = `${curEscort.org_name} ｜ 健康证有效至 ${curEscort.health_cert_expiry}`;

  document.getElementById('bapp-escort-stats').innerHTML = `
    <div>
      <div class="text-gray-400">累计完单</div>
      <div class="text-base font-extrabold ew-text-green">${curEscort.completed_orders} 单</div>
    </div>
    <div class="border-x">
      <div class="text-gray-400">累计分成收入</div>
      <div class="text-base font-extrabold ew-text-orange">¥${curEscort.total_earned}</div>
    </div>
    <div>
      <div class="text-gray-400">平台押金</div>
      <div class="text-xs font-bold ew-text-green mt-1">¥0 (3年免押)</div>
    </div>
  `;

  const myOrders = APP_STATE.orders.filter(o => o.escort_id === curEscort.id && o.sop_step >= 0);
  const bOrdersBox = document.getElementById('bapp-orders-list');

  if (myOrders.length === 0) {
    bOrdersBox.innerHTML = `
      <div class="bg-white p-6 rounded-2xl border text-center text-gray-500">
        当前名下暂无进行中派单，可前往【4. 管理后台】将待派单指派给 <b>${curEscort.name}</b>。
      </div>
    `;
    return;
  }

  bOrdersBox.innerHTML = myOrders.map(ord => {
    const stepDefs = [
      { n: 1, label: '第1步：确认接单 & 拉起高德/滴滴去接手点' },
      { n: 2, label: '第2步：到达接手位置 (LBS定位+拍照打卡)' },
      { n: 3, label: '第3步：院内陪诊进行中 (同步取号/检查动态)' },
      { n: 4, label: '第4步：上传报告/理赔发票 & 录入客观医嘱' },
      { n: 5, label: '第5步：送回结束交接位置 · 完结分账' }
    ];

    return `
      <div class="bg-white p-3.5 rounded-2xl border-2 ew-border-green space-y-3 shadow-sm">
        <div class="flex justify-between items-center">
          <span class="px-2 py-0.5 rounded bg-orange-100 ew-text-orange font-bold">#${ord.order_no} · ${ord.mobility_level}</span>
          <span class="font-extrabold ew-text-green">本单分成 ¥${ord.provider_payout}</span>
        </div>
        <div class="p-2.5 rounded-xl bg-[#faf9f5] space-y-1">
          <div class="font-bold text-sm text-[#142c2a]">患者：${ord.patient_name} (${ord.patient_confirm_method})</div>
          <div class="text-gray-600">医院：${ord.hospital_name} · ${ord.department} (${ord.visit_date})</div>
          <div class="text-gray-600">📍 接手：${ord.pickup_address}</div>
          <div class="text-gray-600">🏁 交接：${ord.dropoff_address}</div>
        </div>

        <div class="flex justify-between items-center">
          <span class="font-bold ew-text-green">⚡ 5 步标准履约打卡：</span>
          <button onclick="openRideModal('${ord.pickup_address}', '${ord.hospital_name}')" class="text-blue-600 font-bold underline">🗺️ 唤醒高德/滴滴导航</button>
        </div>

        <div class="space-y-1.5">
          ${stepDefs.map(st => {
            const done = ord.sop_step >= st.n;
            const isNext = ord.sop_step + 1 === st.n || (ord.sop_step === 1 && st.n === 1);
            return `
              <button onclick="handleEscortStepClick(${ord.id}, ${st.n})" class="w-full p-2.5 rounded-xl font-bold flex justify-between items-center transition ${done ? 'ew-bg-green text-white' : isNext ? 'ew-bg-orange text-white shadow' : 'bg-gray-100 text-gray-600 border'}">
                <span>${st.label}</span>
                <span>${done ? '✅ 已完成' : isNext ? '👉 点击打卡' : '待执行'}</span>
              </button>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }).join('');
}

function selectEscortIdentity(escortId) {
  CURRENT_ESCORT_ID = escortId;
  renderBApp();
}

async function handleEscortStepClick(orderId, stepNum) {
  if (stepNum === 4) {
    ACTIVE_STEP4_ORDER_ID = orderId;
    openModal('modal-step4-report');
    return;
  }
  const res = await fetch(`/api/orders/${orderId}/step`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ step: stepNum })
  });
  const json = await res.json();
  if (json.ok) {
    APP_STATE = json.data;
    renderAll();
    showToast(`✅ 【陪诊师打卡第 ${stepNum} 步完成】状态已实时同步至 C 端家庭视图与管理后台！`);
  }
}

async function submitStep4Report(e) {
  e.preventDefault();
  if (!ACTIVE_STEP4_ORDER_ID) return;
  const payload = {
    step: 4,
    doctor_advice: document.getElementById('s4-advice').value,
    drug_name: document.getElementById('s4-drug').value,
    drug_freq: document.getElementById('s4-freq').value,
    recheck_date: document.getElementById('s4-recheck-date').value,
    authorized_viewers: document.getElementById('s4-viewers').value
  };
  const res = await fetch(`/api/orders/${ACTIVE_STEP4_ORDER_ID}/step`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const json = await res.json();
  if (json.ok) {
    APP_STATE = json.data;
    closeModal('modal-step4-report');
    renderAll();
    showToast('🎉 【第4步医嘱与理赔单上传成功】C端已自动生成《结果分享(+)》《医嘱执行(+)》《术后复检(+)》与《理赔资料包(+)》！');
  }
}

// ==================== 4. Render Admin & B-End Org RBAC Console ====================
function setAdminRole(role) {
  CURRENT_ADMIN_ROLE = role;
  const pBtn = document.getElementById('adm-btn-platform');
  const oBtn = document.getElementById('adm-btn-org1');
  if (role === 'ORG_1') {
    oBtn.className = 'px-3 py-1.5 rounded-lg ew-bg-green text-white font-bold';
    pBtn.className = 'px-3 py-1.5 rounded-lg text-gray-600 hover:bg-gray-200 font-bold';
    showToast('🏢 已切换至【B端合作机构 RBAC 子账号：北京康护之家】，仅展示本机构关联人员、订单与 8% 提成账单！');
  } else {
    pBtn.className = 'px-3 py-1.5 rounded-lg ew-bg-green text-white font-bold';
    oBtn.className = 'px-3 py-1.5 rounded-lg text-gray-600 hover:bg-gray-200 font-bold';
    showToast('👑 已切换至【平台总控管理员】视角，可调度全平台机构与自有培训人员！');
  }
  renderAdmin();
}

function renderAdmin() {
  const st = APP_STATE.stats;
  const filteredOrders = CURRENT_ADMIN_ROLE === 'ORG_1'
    ? APP_STATE.orders.filter(o => o.org_id === 1 || o.sop_step === 0)
    : APP_STATE.orders;

  document.getElementById('adm-kpi-cards').innerHTML = `
    <div class="bg-white p-4 rounded-2xl border border-[#dce3dc]">
      <div class="text-gray-500">总订单数 / 待派单数</div>
      <div class="text-2xl font-extrabold ew-text-orange mt-1">${filteredOrders.length} 单 <small class="text-xs font-normal">(待派 ${st.pendingDispatchCount} 单)</small></div>
      <div class="text-gray-400 mt-1">含 Web官网、小程序、App 实时同步</div>
    </div>
    <div class="bg-white p-4 rounded-2xl border border-[#dce3dc]">
      <div class="text-gray-500">平台撮合提成净收入 (≤10%)</div>
      <div class="text-2xl font-extrabold ew-text-green mt-1">¥${st.totalPlatformFee}</div>
      <div class="text-gray-400 mt-1">B端机构抽8% · 自有人员抽6%</div>
    </div>
    <div class="bg-white p-4 rounded-2xl border border-[#dce3dc]">
      <div class="text-gray-500">供给端押金台账 (前3年免收期)</div>
      <div class="text-2xl font-extrabold ew-text-green mt-1">¥0.00 <small class="text-xs font-normal">(免押期至2029)</small></div>
      <div class="text-gray-400 mt-1">${APP_STATE.organizations.length}家B端机构 + ${APP_STATE.escorts.length}名认证陪诊员</div>
    </div>
    <div class="bg-white p-4 rounded-2xl border border-[#dce3dc]">
      <div class="text-gray-500">6大扩展业务广告与入口费收入</div>
      <div class="text-2xl font-extrabold text-blue-600 mt-1">¥${st.totalAdRevenue}</div>
      <div class="text-gray-400 mt-1">累计有效导流点击 ${st.totalAdClicks} 次</div>
    </div>
  `;

  const stepBadges = {
    '-1': '<span class="px-2 py-0.5 rounded bg-gray-200 text-gray-600">已退改取消</span>',
    0: '<span class="px-2 py-0.5 rounded bg-orange-100 ew-text-orange font-bold">⏳ 待派单调度</span>',
    1: '<span class="px-2 py-0.5 rounded bg-blue-100 text-blue-700 font-bold">① 已接单出发</span>',
    2: '<span class="px-2 py-0.5 rounded bg-blue-100 text-blue-700 font-bold">② 已达接手点</span>',
    3: '<span class="px-2 py-0.5 rounded bg-purple-100 text-purple-700 font-bold">③ 院内陪诊中</span>',
    4: '<span class="px-2 py-0.5 rounded bg-[#dff0e7] ew-text-green font-bold">④ 已传医嘱/理赔</span>',
    5: '<span class="px-2 py-0.5 rounded bg-emerald-600 text-white font-bold">⑤ 已完结分账</span>'
  };

  document.getElementById('adm-orders-tbody').innerHTML = filteredOrders.map(ord => `
    <tr class="${ord.sop_step === 0 ? 'bg-orange-50/40' : ''}">
      <td class="p-3 font-bold">#${ord.order_no}<br><span class="text-gray-500 font-normal">${ord.source_channel}</span></td>
      <td class="p-3"><b>${ord.patient_name}</b><br><span class="px-1.5 py-0.5 rounded bg-orange-100 ew-text-orange font-bold">${ord.mobility_level}</span></td>
      <td class="p-3"><b>${ord.hospital_name}</b><br>${ord.department} · ${ord.visit_date}<br><span class="text-gray-400">挂号：${ord.reg_mode}</span></td>
      <td class="p-3">
        ${ord.patient_confirm_status === 'CONFIRMED'
          ? `<span class="px-2 py-0.5 rounded bg-[#dff0e7] ew-text-green font-bold">✅ 已确认</span><div class="text-gray-400 mt-0.5">${ord.patient_confirm_method}</div>`
          : `<button onclick="openPatientConfirmModalForOrder(${ord.id}, '${ord.order_no}')" class="px-2 py-1 rounded bg-red-100 text-red-700 font-bold">待确认(点击代确认)</button>`}
      </td>
      <td class="p-3">
        总额 <b>¥${ord.total_price}</b> ${ord.overtime_fee > 0 ? `<span class="ew-text-orange">(含加钟¥${ord.overtime_fee})</span>` : ''}
        <div class="text-gray-400">平台提成(${Math.round(ord.commission_rate * 100)}%)：¥${ord.platform_fee}</div>
        <div class="ew-text-green font-semibold">服务方应得：¥${ord.provider_payout}</div>
      </td>
      <td class="p-3">
        ${ord.escort_name ? `<b>${ord.escort_name}</b> (${ord.org_name})` : '<span class="text-gray-400">暂未指派</span>'}
        <div class="mt-1">${stepBadges[ord.sop_step] || ''}</div>
      </td>
      <td class="p-3">
        ${ord.sop_step >= 0 && ord.sop_step < 5 ? `
          <button onclick="openDispatchModalForOrder(${ord.id})" class="px-3 py-1.5 rounded-lg ${ord.sop_step === 0 ? 'ew-bg-orange text-white shadow' : 'border ew-border-green ew-text-green'} font-bold">
            ${ord.sop_step === 0 ? '立即派单' : '改派替补'}
          </button>
        ` : '<span class="text-gray-400">已归档</span>'}
      </td>
    </tr>
  `).join('');

  // Commercial slots table
  document.getElementById('adm-commercial-list').innerHTML = APP_STATE.commercialSlots.map(s => `
    <div class="p-3 rounded-xl bg-[#faf9f5] border border-[#dce3dc] flex justify-between items-center">
      <div>
        <span class="px-2 py-0.5 rounded ew-bg-mint ew-text-green font-bold mr-1">${s.slot_type}</span>
        <b>${s.title}</b> (${s.partner_name})
      </div>
      <div class="text-right whitespace-nowrap ml-3">
        <div class="font-bold text-blue-600">点击 ${s.clicks} 次 · 创收 ¥${(s.clicks * s.cpc_revenue).toFixed(2)}</div>
        <div class="text-gray-400">单次导流结算 ¥${s.cpc_revenue}/次</div>
      </div>
    </div>
  `).join('');

  // Applications & Escorts
  const pendingApps = APP_STATE.applications.filter(a => a.status === 'PENDING');
  document.getElementById('adm-applications-list').innerHTML = pendingApps.length === 0
    ? '<div class="p-3 rounded-xl bg-[#faf9f5] text-gray-500">当前暂无待审批的入驻申请（可在【1.Web官网】底部提交新的B端机构或陪诊师申请进行测试）。</div>'
    : pendingApps.map(a => `
        <div class="p-3 rounded-xl bg-orange-50 border border-[#d77844] flex justify-between items-center">
          <div>
            <span class="px-2 py-0.5 rounded ew-bg-orange text-white font-bold mr-1">${a.apply_type === 'ORG' ? 'B端机构申请' : '个人陪诊师报名'}</span>
            <b>${a.name}</b> (${a.city} · ${a.phone})
            <div class="text-gray-600 mt-0.5">${a.qualification}</div>
          </div>
          <button onclick="approveApplication(${a.id})" class="ew-bg-green text-white px-3 py-1.5 rounded-lg font-bold whitespace-nowrap">审核通过入驻</button>
        </div>
      `).join('');

  document.getElementById('adm-escorts-summary').innerHTML = APP_STATE.escorts.map(e => `
    <div class="flex justify-between items-center py-1">
      <span><b>${e.name}</b> · <span class="ew-text-green">${e.org_name}</span> (${e.cert_title})</span>
      <span class="text-gray-500">可接：${e.skills} ｜ 完单 ${e.completed_orders}</span>
    </div>
  `).join('');
}

function openDispatchModalForOrder(orderId) {
  ACTIVE_DISPATCH_ORDER_ID = orderId;
  const ord = APP_STATE.orders.find(o => o.id === orderId);
  if (!ord) return;
  document.getElementById('dispatch-modal-title').innerText = `派单调度：#${ord.order_no} ${ord.patient_name} (${ord.mobility_level})`;

  const reqLevelCode = (ord.mobility_level || 'L0').slice(0, 2);
  const candidates = APP_STATE.escorts.filter(e =>
    CURRENT_ADMIN_ROLE === 'ORG_1' ? e.org_id === 1 : true
  );

  document.getElementById('dispatch-candidates-list').innerHTML = candidates.map(e => {
    const skillMatch = e.skills.includes(reqLevelCode);
    const hospMatch = e.hospitals.includes(ord.hospital_name.slice(0, 4));
    return `
      <div class="p-3.5 rounded-2xl border-2 ${skillMatch ? 'ew-border-green bg-[#dff0e7]/30' : 'border-gray-200 bg-[#faf9f5]'} flex items-center justify-between gap-3">
        <div>
          <div class="font-extrabold text-sm ew-text-green">
            ${e.name} (${e.gender} · ${e.age}岁) — <span class="text-[#d77844]">${e.org_name}</span>
          </div>
          <div class="text-gray-600 mt-0.5">${e.cert_title} ｜ 评分 ${e.rating}</div>
          <div class="mt-1 flex gap-1.5 flex-wrap">
            <span class="px-2 py-0.5 rounded bg-white border font-semibold">${skillMatch ? '✅ 匹配 ' + reqLevelCode + ' 失能技能' : '⚠️ 技能等级：' + e.skills}</span>
            <span class="px-2 py-0.5 rounded bg-white border">${hospMatch ? '✅ 熟悉该院科室路线' : '常驻：' + e.hospitals}</span>
          </div>
        </div>
        <button onclick="confirmDispatchToEscort(${e.id})" class="ew-bg-green text-white px-4 py-2 rounded-xl font-bold whitespace-nowrap shadow">
          指派给TA
        </button>
      </div>
    `;
  }).join('');

  openModal('modal-dispatch');
}

async function confirmDispatchToEscort(escortId) {
  if (!ACTIVE_DISPATCH_ORDER_ID) return;
  const res = await fetch(`/api/orders/${ACTIVE_DISPATCH_ORDER_ID}/dispatch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ escort_id: escortId })
  });
  const json = await res.json();
  if (json.ok) {
    APP_STATE = json.data;
    CURRENT_ESCORT_ID = escortId;
    closeModal('modal-dispatch');
    renderAll();
    showToast('✅ 派单成功！已自动将该订单同步至【3. 陪诊师接单端】，可点击顶部切换体验 5 步打卡！');
  }
}

async function approveApplication(appId) {
  const res = await fetch(`/api/applications/${appId}/approve`, { method: 'POST' });
  const json = await res.json();
  if (json.ok) {
    APP_STATE = json.data;
    renderAll();
    showToast('🎉 已审核通过！该机构/陪诊师已正式加入平台运力池，享受前3年免押金政策！');
  }
}

window.addEventListener('DOMContentLoaded', () => {
  fetchBootstrap();
  runAiTriage();
});
