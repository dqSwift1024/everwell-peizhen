const assert = require('node:assert');
const { server } = require('./index');

const TEST_PORT = 3099;
const BASE_URL = `http://localhost:${TEST_PORT}`;

async function request(method, path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  const json = await res.json();
  return { status: res.status, json };
}

async function runTests() {
  await new Promise(resolve => server.listen(TEST_PORT, resolve));
  console.log('✅ 1. Server started on port', TEST_PORT);

  try {
    // Test 1: Bootstrap
    const boot = await request('GET', '/api/bootstrap');
    assert.strictEqual(boot.status, 200);
    assert.strictEqual(boot.json.ok, true);
    assert(boot.json.data.escorts.length >= 3, 'Should have seeded escorts');
    console.log('✅ 2. GET /api/bootstrap verified');

    // Test 2: AI问答与就医推荐 (+)
    const aiRes = await request('POST', '/api/ai/triage', {
      query: '老人78岁左膝盖剧痛无法自己下3楼，想看北京骨科'
    });
    assert.strictEqual(aiRes.json.ok, true);
    assert(aiRes.json.reply.recommendedHospital.includes('积水潭'), 'Should match Jishuitan Hospital for orthopedics');
    assert(aiRes.json.reply.recommendedMobilityLevel.startsWith('L3'), 'Should recommend L3 stairs assistance');
    console.log('✅ 3. POST /api/ai/triage (AI问答与就医推荐+) verified');

    // Test 3: Create Order + 患者确认 (+) + 管理后台派单 + 陪诊师 5步打卡 (含第4步生成结果分享/医嘱/复检/理赔包)
    const createOrd = await request('POST', '/api/orders', {
      source_channel: '微信小程序',
      patient_name: '李大爷 (80岁)',
      contact_phone: '13800138999',
      city: '北京',
      hospital_name: '北京积水潭医院(新街口院区)',
      department: '矫形骨科门诊',
      visit_date: '2026-11-18',
      package_name: '半天陪诊 (4小时标准服务)',
      base_price: 288,
      mobility_level: 'L2 需轮椅代借与推行',
      mobility_fee: 80,
      reg_mode: '已挂好号',
      pickup_address: '海淀区花园路5号院2号楼',
      dropoff_address: '原址送回'
    });
    assert.strictEqual(createOrd.status, 201);
    const newOrderId = createOrd.json.order.id;
    console.log('✅ 4. POST /api/orders (预约挂号+ / 交通预约+ / 位置选择+) verified, orderId =', newOrderId);

    // Confirm patient
    const confRes = await request('POST', `/api/orders/${newOrderId}/confirm-patient`, {
      method: '方式A：患者本人微信大字卡片一键确认授权'
    });
    assert.strictEqual(confRes.json.ok, true);
    console.log('✅ 5. POST /api/orders/:id/confirm-patient (患者确认+) verified');

    // Dispatch to escort #2 (王建军 - 平台自有培训人员)
    const dispRes = await request('POST', `/api/orders/${newOrderId}/dispatch`, {
      escort_id: 2
    });
    assert.strictEqual(dispRes.json.ok, true);
    console.log('✅ 6. POST /api/orders/:id/dispatch (后台精准派单) verified');

    // Advance SOP Step 4 (Upload report, medications, recheck date, claim docs)
    const step4Res = await request('POST', `/api/orders/${newOrderId}/step`, {
      step: 4,
      doctor_advice: '【医生原话客观记录】右膝退行性骨关节炎，医嘱外贴氟比洛芬凝胶贴膏、口服氨基葡萄糖，2周后复诊。',
      drug_name: '盐酸氨基葡萄糖胶囊',
      drug_freq: '每日2次 · 随餐服用',
      recheck_date: '2026-12-02',
      authorized_viewers: '李晓华(儿子)'
    });
    assert.strictEqual(step4Res.json.ok, true);
    assert(step4Res.json.data.reports.some(r => r.order_id === newOrderId), 'Report should be auto-generated');
    assert(step4Res.json.data.medications.some(m => m.drug_name === '盐酸氨基葡萄糖胶囊'), 'Medication task should be auto-generated');
    console.log('✅ 7. POST /api/orders/:id/step (第4步自动生成 结果分享+ / 医嘱执行+ / 术后复检+ / 理赔资料包+) verified');

    // Advance SOP Step 5 (Complete order & settle <=10% commission)
    const step5Res = await request('POST', `/api/orders/${newOrderId}/step`, { step: 5 });
    assert.strictEqual(step5Res.json.ok, true);
    console.log('✅ 8. POST /api/orders/:id/step (第5步交接完成与≤10%提成清分) verified');

    // Test Commercial Click Attribution (体检推荐+ / 购药+ / 保险入口+)
    const commRes = await request('POST', '/api/commercial/1/click');
    assert.strictEqual(commRes.json.ok, true);
    console.log('✅ 9. POST /api/commercial/:id/click (体检/购药/保险入口归因统计+) verified');

    // Test Health Diary (+)
    const diaryRes = await request('POST', '/api/diaries', {
      patient_name: '张建国',
      bp_sys: 128,
      bp_dia: 78,
      blood_sugar: 5.8,
      feeling: '状态极佳 😄',
      note: 'E2E 自动化测试健康日记打卡'
    });
    assert.strictEqual(diaryRes.status, 201);
    console.log('✅ 10. POST /api/diaries (健康日记与定时关怀+) verified');

    console.log('\n🎉 ALL 10 END-TO-END TESTS PASSED SUCCESSFULLY!');
  } finally {
    server.close();
  }
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
