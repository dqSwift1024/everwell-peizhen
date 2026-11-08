const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const { db } = require('./db');

const PORT = process.env.PORT || 3080;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 2 * 1024 * 1024) req.destroy();
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function getNowStr() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function getBootstrapData() {
  const patient = db.prepare('SELECT * FROM patients ORDER BY id ASC LIMIT 1').get();
  const organizations = db.prepare('SELECT * FROM organizations ORDER BY id ASC').all();
  const escorts = db.prepare('SELECT * FROM escorts ORDER BY rating DESC, id ASC').all();
  const hospitals = db.prepare('SELECT * FROM hospitals ORDER BY id ASC').all();
  const orders = db.prepare('SELECT * FROM orders ORDER BY id DESC').all();
  const reports = db.prepare('SELECT * FROM medical_reports ORDER BY id DESC').all().map(r => ({
    ...r,
    report_images: JSON.parse(r.report_images || '[]'),
    claim_docs: JSON.parse(r.claim_docs || '[]')
  }));
  const medications = db.prepare('SELECT * FROM medications ORDER BY id ASC').all();
  const diaries = db.prepare('SELECT * FROM health_diaries ORDER BY id DESC').all();
  const articles = db.prepare('SELECT * FROM articles ORDER BY id ASC').all();
  const commercialSlots = db.prepare('SELECT * FROM commercial_slots ORDER BY id ASC').all();
  const applications = db.prepare('SELECT * FROM applications ORDER BY id DESC').all();

  const totalPlatformFee = orders
    .filter(o => o.sop_step >= 0)
    .reduce((sum, o) => sum + Number(o.platform_fee || 0), 0);
  const totalAdRevenue = commercialSlots.reduce((sum, s) => sum + Number(s.clicks || 0) * Number(s.cpc_revenue || 0), 0);
  const totalAdClicks = commercialSlots.reduce((sum, s) => sum + Number(s.clicks || 0), 0);

  return {
    patient,
    organizations,
    escorts,
    hospitals,
    orders,
    reports,
    medications,
    diaries,
    articles,
    commercialSlots,
    applications,
    stats: {
      orderCount: orders.length,
      pendingDispatchCount: orders.filter(o => o.sop_step === 0).length,
      totalPlatformFee: Number(totalPlatformFee.toFixed(2)),
      totalAdRevenue: Number(totalAdRevenue.toFixed(2)),
      totalAdClicks
    }
  };
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    return sendJson(res, 200, { ok: true });
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  try {
    // 1. Bootstrap full state
    if (req.method === 'GET' && pathname === '/api/bootstrap') {
      return sendJson(res, 200, { ok: true, data: getBootstrapData() });
    }

    // 2. AI问答与就医推荐 (+)
    if (req.method === 'POST' && pathname === '/api/ai/triage') {
      const body = await parseBody(req);
      const query = (body.query || '').trim();
      const hospitals = db.prepare('SELECT * FROM hospitals').all();

      let matchedHospital = hospitals[0];
      let matchedDept = '老年医学科 / 心内科';
      let recommendedLevel = 'L2 需轮椅代借与推行';
      let recommendedFee = 80;
      let prepTips = [
        '请携带患者本人身份证、医保卡（或电子医保凭证）及既往门诊病历本；',
        '整理老人目前正在服用的所有慢病药物包装盒或清单，供医生核对用药冲突；',
        '立冬降温期间外出就医请注意头部与膝部防寒，空腹检查后备好温水与软食。'
      ];

      if (/骨|膝|腿|摔|关节|腰|走不动|下楼/.test(query)) {
        matchedHospital = hospitals.find(h => h.name.includes('积水潭')) || hospitals[0];
        matchedDept = '矫形骨科 / 关节外科门诊';
        recommendedLevel = /楼|背|重度/.test(query) ? 'L3 无电梯上下楼背扶协助' : 'L2 需轮椅代借与推行';
        recommendedFee = recommendedLevel.startsWith('L3') ? 150 : 80;
        prepTips = [
          '记录关节疼痛具体部位（左/右膝）、持续周数及上下楼梯/晨起僵硬表现；',
          '务必携带近半年内的 X 光片、CT 或核磁共振（MRI）胶片与报告单；',
          '患者行动受限明显，建议勾选【L2轮椅协助】或【L3无电梯上下楼】，由陪诊员提前在医院租借好轮椅候诊。'
        ];
      } else if (/心|血压|胸闷|头晕|冠心病/.test(query)) {
        matchedHospital = hospitals.find(h => h.name.includes('协和')) || hospitals[0];
        matchedDept = '心内科 / 老年综合门诊';
        recommendedLevel = 'L2 需轮椅代借与推行';
        recommendedFee = 80;
        prepTips = [
          '携带近7天家庭健康日记中的早晚血压与心率记录表；',
          '若需空腹抽血查血脂/生化，清晨常服降压药是否照常服用请提前确认并随身带药；',
          '携带既往心电图、心脏彩超底单及正在服用的降压/他汀类药盒。'
        ];
      } else if (/成都|华西|呼吸|胃肠/.test(query)) {
        matchedHospital = hospitals.find(h => h.name.includes('华西')) || hospitals[0];
        matchedDept = '呼吸内科 / 消化内科';
        recommendedLevel = 'L1 需全程搀扶协助';
        recommendedFee = 50;
      }

      return sendJson(res, 200, {
        ok: true,
        reply: {
          query,
          complianceNotice: '符合《GB/T 47801—2026》国家标准：本AI仅提供就医前症状信息梳理、携带材料提醒与医院科室导诊推荐，不作任何疾病诊断或处方建议。',
          prepTips,
          recommendedHospital: matchedHospital.name,
          recommendedCity: matchedHospital.city,
          recommendedDept: matchedDept,
          officialRegGuide: matchedHospital.official_reg_info,
          wheelchairGuide: matchedHospital.wheelchair_guide,
          recommendedMobilityLevel: recommendedLevel,
          recommendedMobilityFee: recommendedFee
        }
      });
    }

    // 3. Create new order (from Web /booking OR Mini-Program/App)
    if (req.method === 'POST' && pathname === '/api/orders') {
      const b = await parseBody(req);
      const orderNo = 'EW' + Date.now().toString().slice(-8);
      const basePrice = Number(b.base_price || 288);
      const mobilityFee = Number(b.mobility_fee || 80);
      const totalPrice = basePrice + mobilityFee;
      const commissionRate = 0.08;
      const platformFee = Number((totalPrice * commissionRate).toFixed(2));
      const providerPayout = Number((totalPrice - platformFee).toFixed(2));
      const confirmStatus = b.patient_confirm_status || 'PENDING';
      const confirmMethod = b.patient_confirm_method || '待患者本人确认授权';
      const confirmTime = confirmStatus === 'CONFIRMED' ? getNowStr() : null;

      const info = db.prepare(`
        INSERT INTO orders (
          order_no, source_channel, patient_id, patient_name, contact_phone, city,
          hospital_name, department, visit_date, visit_time, package_name,
          base_price, mobility_level, mobility_fee, total_price,
          reg_mode, pickup_address, dropoff_address,
          patient_confirm_status, patient_confirm_method, patient_confirm_time,
          commission_rate, platform_fee, provider_payout, sop_step, live_note, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        orderNo,
        b.source_channel || '微信小程序',
        1,
        b.patient_name || '张建国 (78岁)',
        b.contact_phone || '13800138000',
        b.city || '北京',
        b.hospital_name || '北京协和医院(东单院区)',
        b.department || '心内科门诊',
        b.visit_date || '2026-11-12',
        b.visit_time || '08:30',
        b.package_name || '半天陪诊 (4小时标准服务)',
        basePrice,
        b.mobility_level || 'L2 需轮椅代借与推行',
        mobilityFee,
        totalPrice,
        b.reg_mode || '已挂好号',
        b.pickup_address || '朝阳区幸福一村3号楼2单元301',
        b.dropoff_address || '就诊结束后送回幸福一村家中交接',
        confirmStatus,
        confirmMethod,
        confirmTime,
        commissionRate,
        platformFee,
        providerPayout,
        0,
        confirmStatus === 'CONFIRMED'
          ? '已完成患者授权确认，等待管理后台调度指派陪诊师'
          : '订单已创建，请完成【患者确认(+)】后进入派单队列',
        getNowStr()
      );

      const newOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(info.lastInsertRowid);
      return sendJson(res, 201, { ok: true, order: newOrder, data: getBootstrapData() });
    }

    // 4. 患者确认 (+) (3-way elastic confirmation)
    const confirmMatch = pathname.match(/^\/api\/orders\/(\d+)\/confirm-patient$/);
    if (req.method === 'POST' && confirmMatch) {
      const orderId = Number(confirmMatch[1]);
      const body = await parseBody(req);
      const method = body.method || '方式A：患者本人微信大字卡片一键确认授权';
      db.prepare(`
        UPDATE orders
        SET patient_confirm_status = 'CONFIRMED',
            patient_confirm_method = ?,
            patient_confirm_time = ?,
            live_note = '患者本人已完成确认授权并签署国标12+7知情书，等待后台指派陪诊师'
        WHERE id = ?
      `).run(method, getNowStr(), orderId);
      return sendJson(res, 200, { ok: true, data: getBootstrapData() });
    }

    // 5. 超时加钟补差价 (Overtime fee payment)
    const overtimeMatch = pathname.match(/^\/api\/orders\/(\d+)\/add-overtime$/);
    if (req.method === 'POST' && overtimeMatch) {
      const orderId = Number(overtimeMatch[1]);
      const body = await parseBody(req);
      const addHours = Number(body.hours || 1);
      const addFee = addHours * 100;
      const ord = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
      if (!ord) return sendJson(res, 404, { ok: false, msg: '订单不存在' });

      const newOvertimeHours = Number(ord.overtime_hours || 0) + addHours;
      const newOvertimeFee = Number(ord.overtime_fee || 0) + addFee;
      const newTotal = Number(ord.base_price) + Number(ord.mobility_fee) + newOvertimeFee;
      const newPlatformFee = Number((newTotal * ord.commission_rate).toFixed(2));
      const newPayout = Number((newTotal - newPlatformFee).toFixed(2));

      db.prepare(`
        UPDATE orders
        SET overtime_hours = ?,
            overtime_fee = ?,
            total_price = ?,
            platform_fee = ?,
            provider_payout = ?,
            live_note = ?
        WHERE id = ?
      `).run(
        newOvertimeHours,
        newOvertimeFee,
        newTotal,
        newPlatformFee,
        newPayout,
        `已在线支付超时加钟补差价 +${addHours}小时 (+¥${addFee})，账单与分账已实时更新`,
        orderId
      );
      return sendJson(res, 200, { ok: true, data: getBootstrapData() });
    }

    // 6. 阶梯退改规则取消订单 (Stepped cancellation policy)
    const cancelMatch = pathname.match(/^\/api\/orders\/(\d+)\/cancel$/);
    if (req.method === 'POST' && cancelMatch) {
      const orderId = Number(cancelMatch[1]);
      const body = await parseBody(req);
      const tier = body.tier || '>48h'; // '>48h', '8-48h', '4-8h', '<4h'
      const ord = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
      if (!ord) return sendJson(res, 404, { ok: false, msg: '订单不存在' });

      const penaltyRates = { '>48h': 0, '8-48h': 0.1, '4-8h': 0.2, '<4h': 0.5 };
      const rate = penaltyRates[tier] !== undefined ? penaltyRates[tier] : 0.1;
      const penalty = Number((ord.total_price * rate).toFixed(2));
      const refund = Number((ord.total_price - penalty).toFixed(2));

      db.prepare(`
        UPDATE orders
        SET sop_step = -1,
            refund_amount = ?,
            live_note = ?
        WHERE id = ?
      `).run(
        refund,
        `已按阶梯退改规则（距服务开始 ${tier}，扣违约金 ${rate * 100}% = ¥${penalty}）办理取消，原路退还 ¥${refund}`,
        orderId
      );
      return sendJson(res, 200, { ok: true, refund, penalty, data: getBootstrapData() });
    }

    // 7. 管理后台派单 / 改派替补 (Admin or B-Org Dispatch)
    const dispatchMatch = pathname.match(/^\/api\/orders\/(\d+)\/dispatch$/);
    if (req.method === 'POST' && dispatchMatch) {
      const orderId = Number(dispatchMatch[1]);
      const body = await parseBody(req);
      const escortId = Number(body.escort_id);
      const escort = db.prepare('SELECT * FROM escorts WHERE id = ?').get(escortId);
      const ord = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
      if (!escort || !ord) return sendJson(res, 404, { ok: false, msg: '陪诊师或订单不存在' });

      let commRate = 0.08;
      if (escort.org_id) {
        const org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(escort.org_id);
        if (org) commRate = Number(org.commission_rate);
      } else {
        commRate = 0.06; // 平台自有培训人员提成更优惠
      }
      const platformFee = Number((ord.total_price * commRate).toFixed(2));
      const providerPayout = Number((ord.total_price - platformFee).toFixed(2));

      db.prepare(`
        UPDATE orders
        SET escort_id = ?,
            escort_name = ?,
            org_id = ?,
            org_name = ?,
            commission_rate = ?,
            platform_fee = ?,
            provider_payout = ?,
            sop_step = CASE WHEN sop_step <= 0 THEN 1 ELSE sop_step END,
            live_note = ?
        WHERE id = ?
      `).run(
        escort.id,
        escort.name,
        escort.org_id,
        escort.org_name,
        commRate,
        platformFee,
        providerPayout,
        `后台已指派给【${escort.name} · ${escort.org_name}】，陪诊师已接单准备出发前往接手点`,
        orderId
      );
      return sendJson(res, 200, { ok: true, data: getBootstrapData() });
    }

    // 8. 陪诊师 5 步 SOP 节点打卡与第 4 步结构化报告/理赔资料上传
    const stepMatch = pathname.match(/^\/api\/orders\/(\d+)\/step$/);
    if (req.method === 'POST' && stepMatch) {
      const orderId = Number(stepMatch[1]);
      const body = await parseBody(req);
      const targetStep = Number(body.step);
      const ord = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
      if (!ord) return sendJson(res, 404, { ok: false, msg: '订单不存在' });

      const stepNotes = {
        1: `【第1步·已确认接单】陪诊师 ${ord.escort_name || '李淑芬'} 已核对患者失能等级与挂号状态，正使用高德导航前往接手位置`,
        2: `【第2步·已到达接手位置打卡】LBS定位已核验（${ord.pickup_address}），已完成患者当面状态核对与轮椅安全带固定`,
        3: `【第3步·院内陪诊服务中】${body.progress_note || '已在医院自助机完成取号，正陪同患者在诊区候诊并准备客观记录医嘱'}`,
        4: `【第4步·已上传结果报告与理赔单据】已生成《结果分享(+)报告》、《医嘱执行(+)每日服药打卡》、《术后复检(+)提醒》与《保险理赔资料包(+)》`,
        5: `【第5步·已送达结束交接位置】患者已安全交接至（${ord.dropoff_address}），订单圆满完结，平台提成 ¥${ord.platform_fee} 与服务方收入 ¥${ord.provider_payout} 已自动结算入账`
      };

      db.prepare('UPDATE orders SET sop_step = ?, live_note = ? WHERE id = ?').run(
        targetStep,
        stepNotes[targetStep] || ord.live_note,
        orderId
      );

      // If step === 4, automatically insert medical_reports & medications!
      if (targetStep === 4) {
        const doctorAdvice = body.doctor_advice ||
          '【医生原话客观记录】患者今日复诊生命体征平稳，心肺听诊无殊。医嘱继续按时服用降压及护关节药物，立冬后注意室内保暖与低钠饮食；建议2周后空腹复查血常规与肝肾功能。';
        const recheckDate = body.recheck_date || '2026-11-24';
        const recheckPrep = body.recheck_prep || '复检当日早上空腹（禁食8小时），携带本次处方底单与医保卡。';
        const drugName = body.drug_name || '苯磺酸氨氯地平片 (5mg) + 骨化三醇胶丸';
        const drugFreq = body.drug_freq || '每日1次 · 早饭后温水送服';
        const viewers = body.authorized_viewers || '张晓敏(女儿), 张伟(儿子)';

        const repInfo = db.prepare(`
          INSERT INTO medical_reports (
            order_id, order_no, patient_name, hospital_dept, visit_date, escort_name,
            doctor_advice, recheck_date, recheck_prep, authorized_viewers, report_images, claim_docs, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          ord.id,
          ord.order_no,
          ord.patient_name,
          `${ord.hospital_name} · ${ord.department}`,
          ord.visit_date,
          ord.escort_name || '李淑芬',
          doctorAdvice,
          recheckDate,
          recheckPrep,
          viewers,
          JSON.stringify([
            `${ord.department}_检查检验报告单_${ord.order_no}.jpg`,
            `${ord.department}_门诊处方笺_${ord.order_no}.jpg`
          ]),
          JSON.stringify([
            `医疗门诊收费电子票据_${ord.order_no}.pdf`,
            `门诊病历记录页_${ord.order_no}.jpg`,
            `医保费用结算明细清单_${ord.order_no}.jpg`
          ]),
          getNowStr()
        );

        db.prepare(`
          INSERT INTO medications (report_id, patient_name, drug_name, dosage, frequency, days_total, checked_today)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(repInfo.lastInsertRowid, ord.patient_name, drugName, '遵医嘱常规剂量', drugFreq, 14, 0);
      }

      // If step === 5, increment escort stats
      if (targetStep === 5 && ord.escort_id) {
        db.prepare(`
          UPDATE escorts
          SET completed_orders = completed_orders + 1,
              total_earned = ROUND(total_earned + ?, 2)
          WHERE id = ?
        `).run(ord.provider_payout, ord.escort_id);
      }

      return sendJson(res, 200, { ok: true, data: getBootstrapData() });
    }

    // 9. 医嘱执行 (+) 每日服药打卡切换
    const medMatch = pathname.match(/^\/api\/medications\/(\d+)\/toggle$/);
    if (req.method === 'POST' && medMatch) {
      const medId = Number(medMatch[1]);
      db.prepare('UPDATE medications SET checked_today = CASE WHEN checked_today = 1 THEN 0 ELSE 1 END WHERE id = ?').run(medId);
      return sendJson(res, 200, { ok: true, data: getBootstrapData() });
    }

    // 10. 健康日记与定时关怀 (+) 新增记录
    if (req.method === 'POST' && pathname === '/api/diaries') {
      const b = await parseBody(req);
      db.prepare(`
        INSERT INTO health_diaries (patient_name, log_date, bp_sys, bp_dia, blood_sugar, feeling, note, morning_care_ok, evening_care_ok)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1)
      `).run(
        b.patient_name || '张建国',
        b.log_date || getNowStr(),
        Number(b.bp_sys || 130),
        Number(b.bp_dia || 80),
        Number(b.blood_sugar || 5.9),
        b.feeling || '状态良好 😊',
        b.note || '今日按时完成早晚定时关怀确认与服药。'
      );
      return sendJson(res, 201, { ok: true, data: getBootstrapData() });
    }

    // 11. 商业化入口点击归因统计 (体检推荐+ / 购药+ / 保险入口+)
    const commMatch = pathname.match(/^\/api\/commercial\/(\d+)\/click$/);
    if (req.method === 'POST' && commMatch) {
      const slotId = Number(commMatch[1]);
      db.prepare('UPDATE commercial_slots SET clicks = clicks + 1 WHERE id = ?').run(slotId);
      const slot = db.prepare('SELECT * FROM commercial_slots WHERE id = ?').get(slotId);
      return sendJson(res, 200, { ok: true, slot, data: getBootstrapData() });
    }

    // 12. 供给端招募入驻申请 (B端机构 / 个人陪诊师) 与后台审核通过
    if (req.method === 'POST' && pathname === '/api/applications') {
      const b = await parseBody(req);
      db.prepare(`
        INSERT INTO applications (apply_type, name, phone, city, qualification, status, created_at)
        VALUES (?, ?, ?, ?, ?, 'PENDING', ?)
      `).run(
        b.apply_type || 'ESCORT',
        b.name || '新申请人',
        b.phone || '13800009999',
        b.city || '北京',
        b.qualification || '持有养老护理员证与健康证，熟悉三甲医院门诊流程',
        getNowStr()
      );
      return sendJson(res, 201, { ok: true, data: getBootstrapData() });
    }

    const appApproveMatch = pathname.match(/^\/api\/applications\/(\d+)\/approve$/);
    if (req.method === 'POST' && appApproveMatch) {
      const appId = Number(appApproveMatch[1]);
      const app = db.prepare('SELECT * FROM applications WHERE id = ?').get(appId);
      if (!app) return sendJson(res, 404, { ok: false });

      db.prepare("UPDATE applications SET status = 'APPROVED' WHERE id = ?").run(appId);
      if (app.apply_type === 'ORG') {
        db.prepare(`
          INSERT INTO organizations (name, credit_code, contact_name, contact_phone, city, commission_rate, deposit_free_until, deposit_balance, escort_count, status)
          VALUES (?, '91110108MA02NEW99X', ?, ?, ?, 0.08, '2029-11-08', 0, 10, 'ACTIVE')
        `).run(app.name, app.name, app.phone, app.city);
      } else {
        db.prepare(`
          INSERT INTO escorts (name, gender, age, phone, source_type, org_id, org_name, cert_title, health_cert_expiry, skills, hospitals, schedule_status, rating, completed_orders, total_earned)
          VALUES (?, '女', 35, ?, 'SELF', null, '平台自有培训人员', ?, '2027-11-08', 'L0,L1,L2', '北京协和医院,北京积水潭医院', 'AVAILABLE', 5.0, 0, 0)
        `).run(app.name, app.phone, app.qualification);
      }
      return sendJson(res, 200, { ok: true, data: getBootstrapData() });
    }

    // Serve static files from public/
    let filePath = pathname === '/' ? path.join(PUBLIC_DIR, 'index.html') : path.join(PUBLIC_DIR, pathname);
    if (!filePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      return res.end('Forbidden');
    }
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.svg': 'image/svg+xml'
      };
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain; charset=utf-8' });
      return fs.createReadStream(filePath).pipe(res);
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  } catch (err) {
    console.error('Server error:', err);
    sendJson(res, 500, { ok: false, msg: err.message });
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Everwell Peizhen Full-Stack Server running at http://localhost:${PORT}`);
  });
}

module.exports = { server };
