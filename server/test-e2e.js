const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { server } = require('./index');
const { db, uploadsDir } = require('./db');

const TEST_PORT = 3099;
const BASE_URL = `http://localhost:${TEST_PORT}`;

async function request(method, urlPath, body, token = '') {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${urlPath}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { status: res.status, json, text, headers: res.headers };
}

async function runTests() {
  const createdOrderIds = [];
  const uploadedFiles = [];
  let createdPatientId = null;
  let createdInvoiceId = null;
  let tempDeletedPhone = '13966668888';

  await new Promise(resolve => server.listen(TEST_PORT, resolve));
  console.log('✅ 1. Server started on port', TEST_PORT);

  try {
    // 1. Health & SQLite WAL Check
    const health = await request('GET', '/api/health');
    assert.strictEqual(health.status, 200);
    assert.strictEqual(health.json.ok, true);
    assert.strictEqual(health.json.walMode.toLowerCase(), 'wal');
    console.log('✅ 2. GET /api/health (SQLite WAL 高可靠模式) verified');

    // 2. Offline Zero-CDN Static Asset Check & 5-Tab Spec Check
    const htmlRes = await request('GET', '/');
    assert.strictEqual(htmlRes.status, 200);
    assert(!/cdn\.tailwindcss\.com/i.test(htmlRes.text), 'Must NOT depend on external Tailwind CDN');
    assert(!/<script[^>]+src=["']https?:/i.test(htmlRes.text), 'Must NOT load external blocking JS CDN');
    const tabBtnMatches = [...htmlRes.text.matchAll(/class="capp-tab-btn/g)];
    assert.strictEqual(tabBtnMatches.length, 5, 'Mobile bottom tabBar must have exactly 5 tabs (WeChat hard limit)');
    const cssRes = await request('GET', '/styles.css');
    const jsRes = await request('GET', '/app.js');
    assert.strictEqual(cssRes.status, 200);
    assert.strictEqual(jsRes.status, 200);
    assert(jsRes.text.includes('function escapeHtml'), 'Frontend must enforce escapeHtml XSS protection');
    console.log('✅ 3. Zero-CDN Offline Assets & 微信小程序标准 5-Tab 底部导航上限 verified');

    // 3. Multi-Role Mobile Auth, Privacy Checkbox Gate, Escort Whitelist & Account Deletion
    const noPrivacy = await request('POST', '/api/auth/mobile-login', {
      mode: 'wechat_quick',
      phone: '13800138000',
      agreed_privacy: false
    });
    assert.strictEqual(noPrivacy.status, 400, 'Must reject login when privacy policy is NOT checked');

    const unauthEscort = await request('POST', '/api/auth/mobile-login', {
      mode: 'wechat_quick',
      phone: '13912345678',
      agreed_privacy: true,
      target_role: 'ESCORT'
    });
    assert.strictEqual(unauthEscort.status, 403, 'Uncertified phone must be blocked from Escort workbench');

    const certEscort = await request('POST', '/api/auth/mobile-login', {
      mode: 'wechat_quick',
      phone: '13811223344',
      agreed_privacy: true,
      target_role: 'ESCORT'
    });
    assert.strictEqual(certEscort.status, 200);
    assert.strictEqual(certEscort.json.user.role, 'ESCORT');

    const sendCode = await request('POST', '/api/auth/send-code', { phone: tempDeletedPhone });
    assert.strictEqual(sendCode.status, 200);
    const smsLogin = await request('POST', '/api/auth/mobile-login', {
      mode: 'sms',
      phone: tempDeletedPhone,
      code: sendCode.json.demo_code,
      agreed_privacy: true,
      target_role: 'FAMILY'
    });
    assert.strictEqual(smsLogin.status, 200);
    const tempToken = smsLogin.json.token;

    const meCheck = await request('GET', '/api/auth/me', null, tempToken);
    assert.strictEqual(meCheck.json.authenticated, true);

    const delRes = await request('POST', '/api/auth/delete-account', {}, tempToken);
    assert.strictEqual(delRes.status, 200);
    const meAfterDel = await request('GET', '/api/auth/me', null, tempToken);
    assert.strictEqual(meAfterDel.json.authenticated, false, 'Deleted account session must be invalidated immediately');
    console.log('✅ 4. C端短信/微信登录 + 隐私未勾选拦截 + 陪诊师持证白名单准入 + 永久注销账号 verified');

    // 4. Admin & B-End Org Password Login + RBAC Isolation
    const badAdmin = await request('POST', '/api/auth/admin-login', { username: 'admin', password: 'wrong' });
    assert.strictEqual(badAdmin.status, 401);

    const superAdmin = await request('POST', '/api/auth/admin-login', { username: 'admin', password: 'Everwell2026' });
    assert.strictEqual(superAdmin.status, 200);
    const adminToken = superAdmin.json.token;

    const orgAdmin = await request('POST', '/api/auth/admin-login', { username: 'org_bj', password: 'Org2026' });
    assert.strictEqual(orgAdmin.status, 200);
    const orgToken = orgAdmin.json.token;
    assert.strictEqual(orgAdmin.json.user.role, 'ORG_ADMIN');
    console.log('✅ 5. 管理后台独立账号密码鉴权 (总控 admin & B端机构 org_bj) verified');

    // 5. Bootstrap Data Completeness
    const boot = await request('GET', '/api/bootstrap');
    assert.strictEqual(boot.status, 200);
    assert(boot.json.data.patients.length >= 2);
    assert(boot.json.data.diaries.length >= 7);
    assert(boot.json.data.articles.length >= 6);
    console.log('✅ 6. GET /api/bootstrap (多长辈档案 + 7日趋势数据 + 6篇种草攻略) verified');

    // 6. Strict Input Validation (Invalid Phone & Past Date Rejection)
    const badPhoneOrd = await request('POST', '/api/orders', {
      contact_phone: '12345',
      visit_date: '2099-12-01'
    });
    assert.strictEqual(badPhoneOrd.status, 400, 'Invalid phone number must be rejected');

    const pastDateOrd = await request('POST', '/api/orders', {
      contact_phone: '13800138000',
      visit_date: '2020-01-01'
    });
    assert.strictEqual(pastDateOrd.status, 400, 'Past visit_date must be rejected');
    console.log('✅ 7. 严格表单边界校验 (非法手机号拦截 + 过去就诊日期拦截) verified');

    // 7. AI Triage Compliance & Matching
    const aiRes = await request('POST', '/api/ai/triage', {
      query: '老人78岁左膝盖剧痛无法自己下3楼，想看北京骨科'
    });
    assert.strictEqual(aiRes.json.ok, true);
    assert(aiRes.json.reply.recommendedHospital.includes('积水潭'));
    assert(aiRes.json.reply.recommendedMobilityLevel.startsWith('L3'));
    console.log('✅ 8. POST /api/ai/triage (AI导诊+ 与国标合规围栏) verified');

    // 8. Multi-elder Creation & Timed Care Check-in Streak
    const newPt = await request('POST', '/api/patients', {
      name: '周大爷',
      relation: '岳父',
      age: 79,
      city: '成都',
      birthday: '12月20日',
      mobility_level: 'L2',
      chronic_tags: '慢阻肺',
      address: '成都市武侯区洗面桥街18号'
    });
    assert.strictEqual(newPt.status, 201);
    createdPatientId = newPt.json.patient.id;

    const checkinRes = await request('POST', `/api/patients/${createdPatientId}/care-checkin`, { period: 'morning' });
    assert.strictEqual(checkinRes.json.ok, true);
    assert.strictEqual(checkinRes.json.checked, true);
    console.log('✅ 9. POST /api/patients & care-checkin (多长辈建档 + 早晚敲门守护打卡) verified');

    // 9. Cashier Closed Loop: UNPAID Order -> Block Dispatch -> Web Lookup -> Pay -> Allow Dispatch + RBAC Check
    const createOrd = await request('POST', '/api/orders', {
      source_channel: '微信小程序',
      patient_id: createdPatientId,
      patient_name: '周大爷 (79岁) \'"><b onclick=alert(1)>测试</b>',
      contact_phone: '13800138999',
      hospital_name: '四川大学华西医院(本院)',
      department: '呼吸内科',
      visit_date: '2099-11-20',
      package_name: '半天陪诊 (4小时标准服务)',
      base_price: 238,
      mobility_level: 'L2 需轮椅代借与推行',
      mobility_fee: 60,
      reg_mode: '已挂好号',
      pickup_address: '武侯区洗面桥18号"3单元"',
      dropoff_address: '原址安全交接',
      require_cashier: true
    });
    assert.strictEqual(createOrd.status, 201);
    assert.strictEqual(createOrd.json.order.payment_status, 'UNPAID');
    assert.strictEqual(createOrd.json.order.city, '成都');
    const ordId = createOrd.json.order.id;
    const ordNo = createOrd.json.order.order_no;
    createdOrderIds.push(ordId);

    // Unpaid order MUST block dispatch
    const blockedDisp = await request('POST', `/api/orders/${ordId}/dispatch`, { escort_id: 2 }, adminToken);
    assert.strictEqual(blockedDisp.status, 400, 'Unpaid order must block dispatch');

    // Web No-Login Order Lookup
    const lookupRes = await request('GET', `/api/orders/lookup?q=${encodeURIComponent(ordNo)}`);
    assert.strictEqual(lookupRes.status, 200);
    assert.strictEqual(lookupRes.json.orders[0].order_no, ordNo);

    // Cashier Payment
    const payRes = await request('POST', `/api/orders/${ordId}/pay`, { pay_channel: '支付宝' });
    assert.strictEqual(payRes.status, 200);
    assert.strictEqual(payRes.json.order.payment_status, 'PAID');
    assert(payRes.json.trade_no.startsWith('ALI'), 'Alipay payment should generate ALI serial number');

    // Patient Confirm + Overtime
    await request('POST', `/api/orders/${ordId}/confirm-patient`, { method: '方式A：患者本人微信大字卡片一键确认授权' });
    await request('POST', `/api/orders/${ordId}/add-overtime`, { hours: 1, pay_channel: '微信支付' });

    // RBAC Cross-Org Dispatch Block (org_bj is org_id=1, escort #2 王建军 is SELF org_id=null)
    const crossOrgDisp = await request('POST', `/api/orders/${ordId}/dispatch`, { escort_id: 2 }, orgToken);
    assert.strictEqual(crossOrgDisp.status, 403, 'Org Admin must NOT dispatch non-member escort');

    // Super Admin Dispatch succeeds
    const dispRes = await request('POST', `/api/orders/${ordId}/dispatch`, { escort_id: 2 }, adminToken);
    assert.strictEqual(dispRes.status, 200);
    console.log('✅ 10. 收银台支付闭环 + 未付禁派拦截 + Web查单 + 机构RBAC越权派单拦截 verified');

    // 10. Real File Upload (/api/upload) + Idempotent Step 4 & Step 5
    const sampleSvgBase64 = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="#075e50"/></svg>').toString('base64');
    const uploadRes = await request('POST', '/api/upload', {
      filename: 'test_slip.svg',
      data_url: `data:image/svg+xml;base64,${sampleSvgBase64}`
    });
    assert.strictEqual(uploadRes.status, 201);
    assert(uploadRes.json.url.startsWith('/uploads/slip_'));
    const diskPath = path.join(uploadsDir, path.basename(uploadRes.json.url));
    assert(fs.existsSync(diskPath), 'Uploaded slip file must exist on disk');
    uploadedFiles.push(diskPath);

    await request('POST', `/api/orders/${ordId}/step`, {
      step: 4,
      doctor_advice: '【医生原话客观记录】肺功能稳定，继续规律吸入支气管舒张剂，1个月后复诊。',
      drug_name: '噻托溴铵粉雾剂',
      drug_freq: '每日1次 · 晨起吸入',
      recheck_date: '2099-12-12',
      authorized_viewers: '周敏(女儿)',
      uploaded_urls: [uploadRes.json.url]
    });
    const step4Dup = await request('POST', `/api/orders/${ordId}/step`, {
      step: 4,
      doctor_advice: '【医生原话客观记录】二次补充备注：注意防寒戴口罩。',
      drug_name: '噻托溴铵粉雾剂',
      drug_freq: '每日1次',
      recheck_date: '2099-12-12',
      authorized_viewers: '周敏(女儿)',
      uploaded_urls: [uploadRes.json.url]
    });
    const reportsForOrd = step4Dup.json.data.reports.filter(r => r.order_id === ordId);
    assert.strictEqual(reportsForOrd.length, 1, 'Repeated Step 4 must update idempotently');
    assert.strictEqual(reportsForOrd[0].report_images[0], uploadRes.json.url);

    const beforeEscort = step4Dup.json.data.escorts.find(e => e.id === 2);
    const step5First = await request('POST', `/api/orders/${ordId}/step`, { step: 5 });
    const afterFirst = step5First.json.data.escorts.find(e => e.id === 2);
    assert.strictEqual(afterFirst.completed_orders, beforeEscort.completed_orders + 1);
    const step5Second = await request('POST', `/api/orders/${ordId}/step`, { step: 5 });
    const afterSecond = step5Second.json.data.escorts.find(e => e.id === 2);
    assert.strictEqual(afterSecond.completed_orders, afterFirst.completed_orders, 'Repeated Step 5 must NOT double-settle');
    console.log('✅ 11. 真实图片上传落盘 (/api/upload) + 第4步报告幂等 + 第5步防重复分账 verified');

    // 11. Post-Visit Star Rating + After-Sale Complaint & Admin Resolution
    const revRes = await request('POST', `/api/orders/${ordId}/review`, {
      score: 5,
      comment: '轮椅推行稳当，实拍检验单清晰！'
    });
    assert.strictEqual(revRes.status, 200);

    const asRes = await request('POST', `/api/orders/${ordId}/after-sale`, {
      reason: '希望补寄一份纸质门诊收费票据'
    });
    assert.strictEqual(asRes.status, 200);

    const resAs = await request('POST', `/api/orders/${ordId}/resolve-after-sale`, {
      reply: '已顺丰寄出纸质票据并同步单号'
    }, adminToken);
    assert.strictEqual(resAs.status, 200);
    const updatedOrd = resAs.json.data.orders.find(o => o.id === ordId);
    assert.strictEqual(updatedOrd.after_sale_status, 'RESOLVED');
    console.log('✅ 12. 诊后五星评价闭环 + 投诉售后工单发起与后台品控办结 verified');

    // 12. Electronic Invoice Issuance & Admin Financial CSV Export
    const invRes = await request('POST', '/api/invoices', {
      order_no: ordNo,
      title_type: '个人',
      invoice_title: '周敏',
      amount: 398,
      email: 'zhoumin@example.com'
    });
    assert.strictEqual(invRes.status, 201);
    createdInvoiceId = invRes.json.data.invoices[0].id;

    const csvRawRes = await fetch(`${BASE_URL}/api/admin/export-orders.csv`);
    assert.strictEqual(csvRawRes.status, 200);
    const csvBytes = new Uint8Array(await csvRawRes.arrayBuffer());
    assert(csvBytes[0] === 0xef && csvBytes[1] === 0xbb && csvBytes[2] === 0xbf, 'CSV export must include raw UTF-8 BOM (EF BB BF) for Excel');
    const csvText = Buffer.from(csvBytes).toString('utf8');
    assert(csvText.includes(ordNo), 'CSV export must contain newly created order');
    console.log('✅ 13. 电子发票申请开具 (/api/invoices) + 后台财务对账单 CSV 导出 verified');

    // 13. 4-Tier Stepped Cancellation & Double-Cancel Guard
    const cancelOrd = await request('POST', '/api/orders', {
      source_channel: 'Web官网',
      patient_name: '测试退改单',
      contact_phone: '13800138000',
      visit_date: '2099-12-01',
      base_price: 288,
      mobility_fee: 80
    });
    const cancelOrdId = cancelOrd.json.order.id;
    createdOrderIds.push(cancelOrdId);
    const c1 = await request('POST', `/api/orders/${cancelOrdId}/cancel`, { tier: '4-8h' });
    assert.strictEqual(c1.status, 200);
    assert.strictEqual(c1.json.penalty, 73.6);
    const c2 = await request('POST', `/api/orders/${cancelOrdId}/cancel`, { tier: '4-8h' });
    assert.strictEqual(c2.status, 400);
    console.log('✅ 14. 4档阶梯退改试算与防重复退单保护 verified');

    // 14. Malformed JSON & High-Concurrency Burst Resilience
    const badJsonRes = await fetch(`${BASE_URL}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{bad_json_payload'
    });
    assert.strictEqual(badJsonRes.status, 400);

    const burst = await Promise.all(
      Array.from({ length: 20 }, (_, idx) =>
        idx % 2 === 0 ? request('GET', '/api/bootstrap') : request('GET', '/api/health')
      )
    );
    assert(burst.every(r => r.status === 200));
    console.log('✅ 15. 异常JSON容错保护 + 20并发高频请求稳定性压测 verified');

    console.log('\n🎉 ALL 15 PRODUCTION-DELIVERY FULL-STACK E2E SUITES PASSED 100%!');
  } finally {
    for (const oid of createdOrderIds) {
      const reps = db.prepare('SELECT id FROM medical_reports WHERE order_id = ?').all(oid);
      for (const r of reps) {
        db.prepare('DELETE FROM medications WHERE report_id = ?').run(r.id);
      }
      db.prepare('DELETE FROM medical_reports WHERE order_id = ?').run(oid);
      db.prepare('DELETE FROM order_events WHERE order_id = ?').run(oid);
      db.prepare('DELETE FROM orders WHERE id = ?').run(oid);
    }
    if (createdPatientId) {
      db.prepare('DELETE FROM patients WHERE id = ?').run(createdPatientId);
    }
    if (createdInvoiceId) {
      db.prepare('DELETE FROM invoices WHERE id = ?').run(createdInvoiceId);
    }
    for (const fp of uploadedFiles) {
      try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch (_) {}
    }
    db.prepare("DELETE FROM users WHERE status = 'DELETED'").run();
    db.prepare('UPDATE escorts SET completed_orders = 98, total_earned = 31500, rating = 4.96 WHERE id = 2').run();
    server.close();
  }
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
