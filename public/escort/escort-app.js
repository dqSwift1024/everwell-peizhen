/* ==========================================================================
   健康来敲门 Everwell · 应用3：持证陪诊师独立工作台引擎 (public/escort/escort-app.js)
   ========================================================================== */

let ESC_TOKEN = localStorage.getItem('ew_escort_token') || '';
let ESC_USER = JSON.parse(localStorage.getItem('ew_escort_user') || 'null');
let ESC_STATE = null;
let ESC_TAB = 'pool';
let ACTIVE_S4_ORDER_ID = null;
let ESC_UPLOADED_URLS = ['/uploads/sample-lab-report.svg'];

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
  clearTimeout(window.__escToast);
  window.__escToast = setTimeout(() => el.classList.add('hidden'), 4000);
}

function openModal(id) { document.getElementById(id)?.classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id)?.classList.add('hidden'); }

document.addEventListener('click', e => {
  if (e.target && e.target.classList && e.target.classList.contains('modal-backdrop')) {
    e.target.classList.add('hidden');
  }
});

async function escApi(path, opts = {}, btnEl = null) {
  if (btnEl && btnEl.disabled) return null;
  const orig = btnEl ? btnEl.innerHTML : '';
  if (btnEl) btnEl.disabled = true;
  try {
    const headers = {};
    if (opts.body) headers['Content-Type'] = 'application/json';
    if (ESC_TOKEN) headers['Authorization'] = `Bearer ${ESC_TOKEN}`;
    const res = await fetch(path, {
      method: opts.method || 'GET',
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    const json = await res.json();
    if (!res.ok || !json.ok) {
      showToast(json.msg || `请求未成功 (${res.status})`, true);
      return null;
    }
    if (json.data) {
      ESC_STATE = json.data;
      renderEscortWorkspace();
    }
    return json;
  } catch (_) {
    showToast('网络异常，请检查连接后重试', true);
    return null;
  } finally {
    if (btnEl) {
      btnEl.disabled = false;
      btnEl.innerHTML = orig;
    }
  }
}

async function sendEscortCode(btnEl) {
  const phone = document.getElementById('esc-phone').value.trim();
  const json = await escApi('/api/auth/send-code', { method: 'POST', body: { phone } }, btnEl);
  if (json && json.demo_code) {
    document.getElementById('esc-code').value = json.demo_code;
    showToast(json.msg);
  }
}

async function handleEscortSmsLogin(e) {
  e.preventDefault();
  if (!document.getElementById('esc-agree-chk').checked) {
    showToast('请先阅读并勾选遵守国标执业红线规范与健康承诺', true);
    return;
  }
  const phone = document.getElementById('esc-phone').value.trim();
  const code = document.getElementById('esc-code').value.trim();
  const btn = document.getElementById('esc-login-btn');
  const json = await escApi('/api/auth/mobile-login', {
    method: 'POST',
    body: { mode: 'sms', phone, code, agreed_privacy: true, target_role: 'ESCORT' }
  }, btn);
  if (json && json.token) {
    ESC_TOKEN = json.token;
    ESC_USER = json.user;
    localStorage.setItem('ew_escort_token', ESC_TOKEN);
    localStorage.setItem('ew_escort_user', JSON.stringify(ESC_USER));
    syncAuthScreens();
    await loadEscortBootstrap();
    showToast(`核验通过：欢迎上岗，${json.user.display_name}`);
  }
}

async function handleEscortLogout() {
  await escApi('/api/auth/logout', { method: 'POST' });
  ESC_TOKEN = '';
  ESC_USER = null;
  localStorage.removeItem('ew_escort_token');
  localStorage.removeItem('ew_escort_user');
  syncAuthScreens();
  showToast('已安全退出陪诊师执业端');
}

function syncAuthScreens() {
  const loginEl = document.getElementById('escort-login-screen');
  const authedEl = document.getElementById('escort-authed-shell');
  if (ESC_TOKEN && ESC_USER && ESC_USER.role === 'ESCORT') {
    loginEl.classList.add('hidden');
    authedEl.classList.remove('hidden');
  } else {
    loginEl.classList.remove('hidden');
    authedEl.classList.add('hidden');
  }
}

function switchEscortTab(tab) {
  ESC_TAB = tab;
  document.querySelectorAll('.esc-subview').forEach(el => el.classList.add('hidden'));
  document.getElementById('esc-tab-' + tab)?.classList.remove('hidden');
  document.querySelectorAll('.capp-tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('etab-' + tab)?.classList.add('active');
}

async function loadEscortBootstrap() {
  await escApi('/api/bootstrap');
}

function getCurrentEscortRecord() {
  if (!ESC_STATE || !ESC_USER) return null;
  return ESC_STATE.escorts.find(e => e.id === Number(ESC_USER.escort_id)) || ESC_STATE.escorts[0];
}

async function toggleEscortOnline(btnEl) {
  const esc = getCurrentEscortRecord();
  if (!esc) return;
  const json = await escApi(`/api/escorts/${esc.id}/toggle-schedule`, { method: 'POST' }, btnEl);
  if (json) {
    showToast(json.schedule_status === 'AVAILABLE' ? '已切换为【听单接单中】' : '已切换为【小休暂停派单】');
  }
}

async function claimPoolOrder(orderId, btnEl) {
  const json = await escApi(`/api/orders/${orderId}/claim`, { method: 'POST' }, btnEl);
  if (json) {
    switchEscortTab('sop');
    showToast('抢单承接成功！请核对患者失能分级并按 SOP 准时出发接手');
  }
}

function renderEscortWorkspace() {
  const esc = getCurrentEscortRecord();
  if (!esc) return;

  document.getElementById('esc-hdr-name').textContent = `${esc.name} · 持证陪诊顾问`;
  document.getElementById('esc-hdr-org').textContent = `${esc.org_name} ｜ 健康证至 ${esc.health_cert_expiry}`;
  const schedBtn = document.getElementById('esc-sched-btn');
  const isAvail = esc.schedule_status === 'AVAILABLE';
  schedBtn.textContent = isAvail ? '● 听单接单中' : '○ 小休暂停中';
  schedBtn.className = `badge ${isAvail ? 'badge-solid-green' : 'badge-orange'}`;

  const myActive = ESC_STATE.orders.filter(o => o.escort_id === esc.id && o.sop_step >= 1 && o.sop_step < 5);
  const myDone = ESC_STATE.orders.filter(o => o.escort_id === esc.id && o.sop_step === 5);
  const poolOrders = ESC_STATE.orders.filter(o => o.sop_step === 0 && o.payment_status === 'PAID');

  const sopBadge = document.getElementById('esc-badge-sop');
  sopBadge.textContent = String(myActive.length);
  sopBadge.classList.toggle('hidden', myActive.length === 0);

  // KPI strip
  document.getElementById('esc-kpi-strip').innerHTML = `
    <div><div class="text-lg font-extrabold text-green">${myActive.length}</div><div class="text-subtle" style="font-size:10.5px;">待履约任务</div></div>
    <div><div class="text-lg font-extrabold text-orange">${Number(esc.completed_orders)}</div><div class="text-subtle" style="font-size:10.5px;">累计完单数</div></div>
    <div><div class="text-lg font-extrabold text-green">★${Number(esc.rating).toFixed(2)}</div><div class="text-subtle" style="font-size:10.5px;">家属好评度</div></div>
  `;

  // Tab 1: Claimable Pool
  const poolEl = document.getElementById('esc-claim-pool');
  poolEl.innerHTML = poolOrders.length === 0
    ? '<div class="ew-card-paper text-center text-muted py-6">当前听单大厅暂无待承接新单，保持在线可优先接收指派</div>'
    : poolOrders.map(o => {
        const estRate = esc.org_id ? 0.92 : 0.94;
        const estEarn = (Number(o.total_price) * estRate).toFixed(2);
        return `
          <div class="ew-card space-y-2" style="padding:13px;border:1.5px solid #9fd0b9;">
            <div class="flex items-center justify-between">
              <span class="badge badge-green">${escapeHtml(o.city)} · ${escapeHtml(o.visit_date)}</span>
              <span class="font-extrabold text-sm text-orange">预计本单分成 ¥${estEarn}</span>
            </div>
            <div class="font-extrabold text-sm">${escapeHtml(o.hospital_name)} · ${escapeHtml(o.department)}</div>
            <div class="text-muted">患者：${escapeHtml(o.patient_name)} ｜ <b>${escapeHtml(o.mobility_level)}</b></div>
            <div class="text-subtle">接手点：${escapeHtml(o.pickup_address)}</div>
            <button type="button" onclick="claimPoolOrder(${Number(o.id)}, this)" class="btn-primary w-full" style="padding:9px;">立即抢单承接 →</button>
          </div>
        `;
      }).join('');

  // Active brief on Tab 1
  document.getElementById('esc-active-brief').innerHTML = myActive.length === 0
    ? '<div class="ew-card-paper text-muted">当前无进行中订单</div>'
    : myActive.map(o => `
        <div class="ew-card-mint flex items-center justify-between gap-2">
          <div>
            <div class="font-extrabold text-green">#${escapeHtml(o.order_no)} · ${escapeHtml(o.hospital_name)}</div>
            <div class="text-muted mt-1">当前第 ${o.sop_step}/5 步 · ${escapeHtml(o.patient_name)}</div>
          </div>
          <button type="button" onclick="switchEscortTab('sop')" class="btn-primary whitespace-nowrap" style="padding:7px 12px;">去打卡 →</button>
        </div>
      `).join('');

  // Tab 2: 5-Step SOP Execution
  const sopEl = document.getElementById('esc-sop-list');
  const stepDefs = [
    { step: 1, title: '第1步：确认接单 & 核对挂号状态' },
    { step: 2, title: '第2步：到达接手位置 LBS 定位签到' },
    { step: 3, title: '第3步：院内陪诊服务中 & 实时播报' },
    { step: 4, title: '第4步：拍照上传检验单/发票 & 录医嘱' },
    { step: 5, title: '第5步：安全送回交接完结 & 自动结算' }
  ];
  sopEl.innerHTML = myActive.length === 0
    ? '<div class="ew-card text-center py-6 text-muted">暂无进行中的陪诊任务，请前往【听单大厅】抢单或等待机构指派</div>'
    : myActive.map(o => `
        <div class="ew-card space-y-2.5" style="padding:14px;border:1.5px solid #9fd0b9;">
          <div class="flex items-center justify-between">
            <span class="font-extrabold text-sm">#${escapeHtml(o.order_no)} · ${escapeHtml(o.patient_name)}</span>
            <span class="badge badge-orange">本单分成 ¥${Number(o.provider_payout)}</span>
          </div>
          <div class="font-bold text-green">${escapeHtml(o.hospital_name)} · ${escapeHtml(o.department)}（${escapeHtml(o.visit_date)}）</div>
          <div class="ew-card-paper space-y-1">
            <div><strong>行动分级：</strong>${escapeHtml(o.mobility_level)}</div>
            <div><strong>接手地址：</strong>${escapeHtml(o.pickup_address)}</div>
            <div><strong>送回地址：</strong>${escapeHtml(o.dropoff_address)}</div>
            <div><strong>联系电话：</strong><a href="tel:${escapeHtml(o.contact_phone)}" class="text-green font-bold">${escapeHtml(o.contact_phone)}（点击拨号）</a></div>
          </div>
          <a href="https://uri.amap.com/navigation?to=116.4175,39.9138,${encodeURIComponent(o.hospital_name)}&mode=car&src=everwell" target="_blank" rel="noopener" class="btn-blue w-full text-center" style="padding:8px;display:block;">
            唤醒高德导航前往接手点 / 医院无障碍通道
          </a>

          <div class="ew-card-mint space-y-1.5">
            <div class="font-bold text-green">院内实时进度播报（推送至家属手机）：</div>
            <div class="flex gap-1-5">
              <input id="custom-note-${o.id}" value="已借好消毒轮椅，正陪同长辈在诊区候诊" class="w-full" style="background:#fff;" />
              <button type="button" onclick="sendCustomStep3(${Number(o.id)}, this)" class="btn-primary whitespace-nowrap" style="padding:6px 11px;">播报</button>
            </div>
          </div>

          <div class="space-y-1.5">
            ${stepDefs.map(sd => {
              const done = o.sop_step >= sd.step;
              return `
                <button type="button" onclick="runEscortStep(${Number(o.id)}, ${sd.step}, this)"
                  class="w-full flex items-center justify-between ${done ? 'btn-soft' : 'btn-primary'}"
                  style="padding:9px 12px;${done ? 'background:var(--ew-mint-soft);color:#075e50;border-color:#9fd0b9;' : ''}">
                  <span>${done ? '✓ ' : ''}${sd.title}</span>
                  <span>${done ? '已完成' : (sd.step === 4 ? '拍照传单据 →' : '打卡 →')}</span>
                </button>
              `;
            }).join('')}
          </div>
        </div>
      `).join('');

  // Tab 3: Wallet & Withdrawals
  const myWithdrawals = (ESC_STATE.withdrawals || []).filter(w => w.escort_id === esc.id);
  const withdrawnTotal = myWithdrawals.reduce((s, w) => s + Number(w.amount || 0), 0);
  const availableBal = Math.max(0, Number(esc.total_earned) - withdrawnTotal);

  document.getElementById('esc-wallet-hero').innerHTML = `
    <div class="flex items-center justify-between">
      <span class="badge" style="background:rgba(255,255,255,0.18);color:#fff;">前 3 年免押金保障期至 2029-11</span>
      <span style="font-size:11px;color:#b8dbcf;">提成费率仅 ${esc.org_id ? '8%' : '6%'}</span>
    </div>
    <div style="font-size:12px;color:#cde5dc;margin-top:4px;">当前可提现净余额（元）</div>
    <div class="flex items-center justify-between">
      <div class="text-3xl font-extrabold">¥${availableBal.toFixed(2)}</div>
      <button type="button" onclick="openModal('modal-withdraw')" class="btn-orange" style="padding:8px 15px;">申请提现</button>
    </div>
    <div class="flex justify-between pt-1" style="border-top:1px solid rgba(255,255,255,0.16);font-size:11px;color:#c0ded4;">
      <span>累计服务总分成：¥${Number(esc.total_earned).toFixed(2)}</span>
      <span>累计已提现：¥${withdrawnTotal.toFixed(2)}</span>
    </div>
  `;

  document.getElementById('esc-settlement-list').innerHTML = myDone.length === 0
    ? '<div class="text-muted">完成第 5 步安全交接后，分成账单将实时结算至此</div>'
    : myDone.map(o => `
        <div class="ew-card-paper flex items-center justify-between">
          <div>
            <div class="font-bold">#${escapeHtml(o.order_no)} · ${escapeHtml(o.hospital_name)}</div>
            <div class="text-subtle" style="font-size:10.5px;">客户实付 ¥${Number(o.total_price)} · 平台服务费 ¥${Number(o.platform_fee)}</div>
          </div>
          <span class="font-extrabold text-green">+¥${Number(o.provider_payout)}</span>
        </div>
      `).join('');

  document.getElementById('esc-withdraw-list').innerHTML = myWithdrawals.length === 0
    ? '<div class="text-muted">暂无提现记录</div>'
    : myWithdrawals.map(w => `
        <div class="ew-card-paper flex items-center justify-between">
          <div>
            <div class="font-bold">${escapeHtml(w.channel)} · ${escapeHtml(w.account_info)}</div>
            <div class="text-subtle" style="font-size:10.5px;">${escapeHtml(w.created_at)}</div>
          </div>
          <div class="text-right">
            <div class="font-extrabold text-orange">-¥${Number(w.amount).toFixed(2)}</div>
            <span class="badge badge-green">已打款</span>
          </div>
        </div>
      `).join('');

  // Tab 4: GB/T 47801-2026 Digital Badge
  document.getElementById('esc-digital-badge').innerHTML = `
    <div class="flex items-center justify-between">
      <span class="badge" style="background:#d77844;color:#fff;">GB/T 47801—2026 实名认证胸牌</span>
      <span class="badge badge-solid-green">健康证有效</span>
    </div>
    <div class="flex items-center gap-3 mt-2">
      <div class="mine-avatar" style="width:54px;height:54px;font-size:20px;">${escapeHtml(esc.name.slice(0, 1))}</div>
      <div>
        <div class="text-lg font-extrabold">${escapeHtml(esc.name)} <span style="font-size:12px;font-weight:600;color:#c8e3d9;">（工号 EW-00${Number(esc.id)}）</span></div>
        <div style="font-size:11.5px;color:#cde4dc;">所属单位：${escapeHtml(esc.org_name)}</div>
      </div>
    </div>
    <div style="background:rgba(0,0,0,0.22);border-radius:12px;padding:10px 12px;font-size:11.5px;line-height:1.65;">
      <div><strong>执业资质证书：</strong>${escapeHtml(esc.cert_title)}</div>
      <div><strong>健康证有效期至：</strong>${escapeHtml(esc.health_cert_expiry)}</div>
      <div><strong>准入护理分级：</strong>${escapeHtml(esc.skills)}（熟院：${escapeHtml(esc.hospitals)}）</div>
      <div><strong>综合服务评分：</strong>★ ${Number(esc.rating).toFixed(2)} / 5.00（已服务 ${Number(esc.completed_orders)} 户家庭）</div>
    </div>
  `;
}

async function sendCustomStep3(orderId, btnEl) {
  const val = document.getElementById('custom-note-' + orderId)?.value || '正在院内陪同就诊';
  const json = await escApi(`/api/orders/${orderId}/step`, {
    method: 'POST',
    body: { step: 3, progress_note: val }
  }, btnEl);
  if (json) showToast('院内实时进展已推送至家属端！');
}

async function runEscortStep(orderId, stepNum, btnEl) {
  if (stepNum === 4) {
    ACTIVE_S4_ORDER_ID = orderId;
    renderEscortThumbs();
    openModal('modal-step4-report');
    return;
  }
  const json = await escApi(`/api/orders/${orderId}/step`, {
    method: 'POST',
    body: { step: stepNum }
  }, btnEl);
  if (json) {
    showToast(stepNum === 5 ? '第5步安全交接完成！本单分成已结算至您的【收入钱包】' : `第 ${stepNum} 步签到打卡成功！`);
  }
}

function renderEscortThumbs() {
  const box = document.getElementById('es4-thumbs');
  if (!box) return;
  box.innerHTML = ESC_UPLOADED_URLS.map((u, idx) => `
    <div style="position:relative;">
      <img src="${escapeHtml(u)}" class="slip-thumb" alt="单据${idx + 1}" />
    </div>
  `).join('');
}

function handleEscortFileUpload(e) {
  const files = Array.from(e.target.files || []).slice(0, 4);
  files.forEach(f => {
    const r = new FileReader();
    r.onload = async () => {
      const json = await escApi('/api/upload', {
        method: 'POST',
        body: { filename: f.name, data_url: r.result }
      });
      if (json && json.url) {
        ESC_UPLOADED_URLS.push(json.url);
        renderEscortThumbs();
        showToast(`实拍凭证【${f.name}】上传成功！`);
      }
    };
    r.readAsDataURL(f);
  });
  e.target.value = '';
}

async function submitEscortStep4(e) {
  e.preventDefault();
  if (!ACTIVE_S4_ORDER_ID) return;
  const btn = document.getElementById('es4-submit-btn');
  const json = await escApi(`/api/orders/${ACTIVE_S4_ORDER_ID}/step`, {
    method: 'POST',
    body: {
      step: 4,
      doctor_advice: document.getElementById('es4-advice').value,
      drug_name: document.getElementById('es4-drug').value,
      drug_freq: document.getElementById('es4-freq').value,
      recheck_date: document.getElementById('es4-recheck').value,
      authorized_viewers: document.getElementById('es4-viewers').value,
      uploaded_urls: ESC_UPLOADED_URLS
    }
  }, btn);
  if (json) {
    closeModal('modal-step4-report');
    showToast('报告照片与客观医嘱已归档！家属端已同步生成结果卡、用药打卡与理赔包');
  }
}

async function submitWithdrawRequest(e) {
  e.preventDefault();
  const btn = document.getElementById('wd-submit-btn');
  const json = await escApi('/api/escorts/withdraw', {
    method: 'POST',
    body: {
      channel: document.getElementById('wd-channel').value,
      account_info: document.getElementById('wd-account').value,
      amount: Number(document.getElementById('wd-amount').value)
    }
  }, btn);
  if (json) {
    closeModal('modal-withdraw');
    showToast(`提现成功！¥${Number(json.amount).toFixed(2)} 已打款至您的实名账户`);
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  if (ESC_TOKEN) {
    const me = await escApi('/api/auth/me');
    if (!me || !me.authenticated || me.user.role !== 'ESCORT') {
      ESC_TOKEN = '';
      ESC_USER = null;
      localStorage.removeItem('ew_escort_token');
      localStorage.removeItem('ew_escort_user');
    } else {
      ESC_USER = me.user;
    }
  }
  syncAuthScreens();
  if (ESC_TOKEN) {
    await loadEscortBootstrap();
  }
});
