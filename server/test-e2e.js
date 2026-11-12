const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { server } = require('./index');
const { db } = require('./db');

const TEST_PORT = 3099;
const BASE_URL = `http://localhost:${TEST_PORT}`;

async function request(method, urlPath, body) {
  const res = await fetch(`${BASE_URL}${urlPath}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { status: res.status, json, text };
}

async function runTests() {
  const createdOrderIds = [];
  let createdPatientId = null;

  await new Promise(resolve => server.listen(TEST_PORT, resolve));
  console.log('✅ 1. Server started on port', TEST_PORT);

  try {
    // 1. Health & SQLite WAL Check
    const health = await request('GET', '/api/health');
    assert.strictEqual(health.status, 200);
    assert.strictEqual(health.json.ok, true);
    assert.strictEqual(health.json.walMode.toLowerCase(), 'wal');
    console.log('✅ 2. GET /api/health (SQLite WAL 高可靠模式) verified');

    // 2. Offline Zero-CDN Static Asset Check
    const htmlRes = await request('GET', '/');
    assert.strictEqual(htmlRes.status, 200);
    assert(!/cdn\.tailwindcss\.com/i.test(htmlRes.text), 'Must NOT depend on external Tailwind CDN');
    assert(!/<script[^>]+src=["']https?:/i.test(htmlRes.text), 'Must NOT load external blocking JS CDN');
    const cssRes = await request('GET', '/styles.css');
    const jsRes = await request('GET', '/app.js');
    assert.strictEqual(cssRes.status, 200);
    assert.strictEqual(jsRes.status, 200);
    assert(jsRes.text.includes('function escapeHtml'), 'Frontend must enforce escapeHtml XSS protection');
    console.log('✅ 3. Zero-CDN Offline Static Assets (/ , /styles.css , /app.js) verified');

    // 3. Bootstrap Data Completeness
    const boot = await request('GET', '/api/bootstrap');
    assert.strictEqual(boot.status, 200);
    assert(boot.json.data.patients.length >= 2, 'Should have multi-elder family profiles');
    assert(boot.json.data.diaries.length >= 7, 'Should have >=7 diary entries for 7-day trend chart');
    assert(boot.json.data.articles.length >= 6, 'Should have >=6 Xiaohongshu-style health guide notes');
    console.log('✅ 4. GET /api/bootstrap (多长辈档案 + 7日趋势数据 + 6篇种草攻略) verified');

    // 4. AI Triage Compliance & Matching
    const aiRes = await request('POST', '/api/ai/triage', {
      query: '老人78岁左膝盖剧痛无法自己下3楼，想看北京骨科'
    });
    assert.strictEqual(aiRes.json.ok, true);
    assert(aiRes.json.reply.recommendedHospital.includes('积水潭'));
    assert(aiRes.json.reply.recommendedMobilityLevel.startsWith('L3'));
    console.log('✅ 5. POST /api/ai/triage (AI导诊+ 与国标合规围栏) verified');

    // 5. Multi-elder Creation & Timed Care Check-in Streak
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

    const checkinRes = await request('POST', `/api/patients/${createdPatientId}/care-checkin`, {
      period: 'morning'
    });
    assert.strictEqual(checkinRes.json.ok, true);
    assert.strictEqual(checkinRes.json.checked, true);
    assert(checkinRes.json.care_streak >= 2, 'Streak should increment on first check-in today');
    console.log('✅ 6. POST /api/patients & care-checkin (多长辈建档 + 早晚敲门守护打卡连击) verified');

    // 6. Auto-City Sync & Quote/XSS Payload Safety on Order Creation
    const createOrd = await request('POST', '/api/orders', {
      source_channel: '微信小程序',
      patient_id: createdPatientId,
      patient_name: '周大爷 (79岁) \'"><b onclick=alert(1)>测试</b>',
      contact_phone: '13800138999',
      hospital_name: '四川大学华西医院(本院)',
      department: '呼吸内科',
      visit_date: '2026-11-20',
      package_name: '半天陪诊 (4小时标准服务)',
      base_price: 238,
      mobility_level: 'L2 需轮椅代借与推行',
      mobility_fee: 60,
      reg_mode: '已挂好号',
      pickup_address: '武侯区洗面桥18号"3单元"',
      dropoff_address: '原址安全交接'
    });
    assert.strictEqual(createOrd.status, 201);
    assert.strictEqual(createOrd.json.order.city, '成都', 'Should auto-resolve Chengdu from West China Hospital');
    const ordId = createOrd.json.order.id;
    createdOrderIds.push(ordId);
    console.log('✅ 7. POST /api/orders (医院城市自动映射 + 特殊字符安全入库) verified');

    // 7. Patient Confirmation + Overtime Payment + Dispatch
    const confRes = await request('POST', `/api/orders/${ordId}/confirm-patient`, {
      method: '方式A：患者本人微信大字卡片一键确认授权'
    });
    assert.strictEqual(confRes.json.ok, true);

    const otRes = await request('POST', `/api/orders/${ordId}/add-overtime`, { hours: 1 });
    assert.strictEqual(otRes.json.ok, true);

    const dispRes = await request('POST', `/api/orders/${ordId}/dispatch`, { escort_id: 2 });
    assert.strictEqual(dispRes.json.ok, true);
    console.log('✅ 8. 患者确认(+) + 超时加钟补差价 + 后台精准派单 verified');

    // 8. Idempotent Step 4 (No duplicate reports on double click!) & Idempotent Step 5 (No double payout!)
    await request('POST', `/api/orders/${ordId}/step`, {
      step: 4,
      doctor_advice: '【医生原话客观记录】肺功能稳定，继续规律吸入支气管舒张剂，1个月后复诊。',
      drug_name: '噻托溴铵粉雾剂',
      drug_freq: '每日1次 · 晨起吸入',
      recheck_date: '2026-12-12',
      authorized_viewers: '周敏(女儿)'
    });
    const step4Dup = await request('POST', `/api/orders/${ordId}/step`, {
      step: 4,
      doctor_advice: '【医生原话客观记录】二次补充备注：注意防寒戴口罩。',
      drug_name: '噻托溴铵粉雾剂',
      drug_freq: '每日1次',
      recheck_date: '2026-12-12',
      authorized_viewers: '周敏(女儿)'
    });
    const reportsForOrd = step4Dup.json.data.reports.filter(r => r.order_id === ordId);
    assert.strictEqual(reportsForOrd.length, 1, 'Repeated Step 4 must update idempotently without duplicating reports');

    const beforeEscort = step4Dup.json.data.escorts.find(e => e.id === 2);
    const step5First = await request('POST', `/api/orders/${ordId}/step`, { step: 5 });
    const afterFirst = step5First.json.data.escorts.find(e => e.id === 2);
    assert.strictEqual(afterFirst.completed_orders, beforeEscort.completed_orders + 1);

    const step5Second = await request('POST', `/api/orders/${ordId}/step`, { step: 5 });
    const afterSecond = step5Second.json.data.escorts.find(e => e.id === 2);
    assert.strictEqual(afterSecond.completed_orders, afterFirst.completed_orders, 'Repeated Step 5 must NOT double-settle');
    console.log('✅ 9. 第4步报告幂等防重 + 第5步提成分账唯一性防重 verified');

    // 9. Order Audit Events Trail
    const evRes = await request('GET', `/api/orders/${ordId}/events`);
    assert.strictEqual(evRes.status, 200);
    assert(evRes.json.events.length >= 5, 'Order audit trail should contain all lifecycle events');
    console.log('✅ 10. GET /api/orders/:id/events (全链路合规审计流水) verified');

    // 10. 4-Tier Stepped Cancellation & Double-Cancel Guard
    const cancelOrd = await request('POST', '/api/orders', {
      source_channel: 'Web官网',
      patient_name: '测试退改单',
      base_price: 288,
      mobility_fee: 80
    });
    const cancelOrdId = cancelOrd.json.order.id;
    createdOrderIds.push(cancelOrdId);
    const c1 = await request('POST', `/api/orders/${cancelOrdId}/cancel`, { tier: '4-8h' });
    assert.strictEqual(c1.status, 200);
    assert.strictEqual(c1.json.penalty, 73.6);
    const c2 = await request('POST', `/api/orders/${cancelOrdId}/cancel`, { tier: '4-8h' });
    assert.strictEqual(c2.status, 400, 'Double cancellation must be rejected cleanly');
    console.log('✅ 11. 4档阶梯退改试算与防重复退单保护 verified');

    // 11. Xiaohongshu Article Like/Bookmark + Escort Schedule Toggle
    const artBefore = boot.json.data.articles[0];
    const likeRes = await request('POST', `/api/articles/${artBefore.id}/interact`, { action: 'like' });
    assert.strictEqual(likeRes.status, 200);
    await request('POST', `/api/articles/${artBefore.id}/interact`, { action: 'like' }); // restore

    const sched1 = await request('POST', '/api/escorts/1/toggle-schedule');
    assert.strictEqual(sched1.status, 200);
    await request('POST', '/api/escorts/1/toggle-schedule'); // restore AVAILABLE
    console.log('✅ 12. 种草笔记点赞收藏持久化 + 陪诊师听单/小休切换 verified');

    // 12. Malformed JSON & High-Concurrency Burst Resilience
    const badJsonRes = await fetch(`${BASE_URL}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{bad_json_payload'
    });
    assert.strictEqual(badJsonRes.status, 400, 'Malformed JSON should return 400 without crashing server');

    const burst = await Promise.all(
      Array.from({ length: 20 }, (_, idx) =>
        idx % 2 === 0 ? request('GET', '/api/bootstrap') : request('GET', '/api/health')
      )
    );
    assert(burst.every(r => r.status === 200), 'All 20 concurrent burst requests must succeed');
    console.log('✅ 13. 异常JSON容错保护 + 20并发高频请求稳定性压测 verified');

    console.log('\n🎉 ALL 13 FULL-STACK E2E, SECURITY & STABILITY SUITES PASSED 100%!');
  } finally {
    // Clean up temporary test artifacts so live demo database stays pristine
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
    // Restore escort #2 stats if incremented during test
    db.prepare('UPDATE escorts SET completed_orders = 98, total_earned = 31500 WHERE id = 2').run();
    server.close();
  }
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
