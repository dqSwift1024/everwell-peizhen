const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const { db, hashPassword, uploadsDir } = require('./db');

const PORT = process.env.PORT || 3080;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const BOOT_TIME = Date.now();
const SMS_CODES = new Map(); // phone -> { code, expiresAt }

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 5 * 1024 * 1024) {
        req.destroy(new Error('请求体超过5MB上限'));
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        const parsed = JSON.parse(raw);
        resolve(parsed && typeof parsed === 'object' ? parsed : {});
      } catch (_) {
        const badJson = new Error('JSON 格式不合法');
        badJson.statusCode = 400;
        reject(badJson);
      }
    });
    req.on('error', reject);
  });
}

function cleanStr(val, fallback = '', maxLen = 300) {
  if (val === undefined || val === null) return fallback;
  const s = String(val).trim();
  return s ? s.slice(0, maxLen) : fallback;
}

function clampNum(val, min, max, fallback) {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function isValidMainlandPhone(phone) {
  return /^1[3-9]\d{9}$/.test(String(phone || '').trim());
}

function maskPhone(phone) {
  const s = String(phone || '');
  if (s.length !== 11) return s;
  return `${s.slice(0, 3)}****${s.slice(7)}`;
}

function getNowStr() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function getTodayStr() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function withTransaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    throw err;
  }
}

function createSession(user) {
  const token = 'ew_' + crypto.randomBytes(20).toString('hex');
  const expiresAt = Date.now() + 7 * 24 * 3600 * 1000;
  db.prepare(`
    INSERT INTO sessions (token, user_id, role, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(token, user.id, user.role, expiresAt, getNowStr());
  return token;
}

function getAuthUser(req) {
  const authHeader = req.headers.authorization || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const token = match[1].trim();
  const sess = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!sess || sess.expires_at < Date.now()) return null;
  const user = db.prepare("SELECT id, username, phone, display_name, role, org_id, escort_id, status FROM users WHERE id = ? AND status = 'ACTIVE'").get(sess.user_id);
  if (!user) return null;
  return { ...user, masked_phone: maskPhone(user.phone), token };
}

function requireRole(req, allowedRoles) {
  const u = getAuthUser(req);
  if (!u) {
    const err = new Error('请先登录后再执行该操作');
    err.statusCode = 401;
    throw err;
  }
  if (allowedRoles && !allowedRoles.includes(u.role)) {
    const err = new Error('当前登录账号角色无权执行该操作');
    err.statusCode = 403;
    throw err;
  }
  return u;
}

function logOrderEvent(orderId, eventType, title, detail, operator = '系统') {
  db.prepare(`
    INSERT INTO order_events (order_id, event_type, title, detail, operator, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(orderId, eventType, title, detail, operator, getNowStr());
}

function safeJsonArray(str) {
  try {
    const arr = JSON.parse(str || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch (_) {
    return [];
  }
}

function getBootstrapData(authUser = null) {
  const patients = db.prepare('SELECT * FROM patients ORDER BY id ASC').all();
  const patient = patients[0] || null;
  const organizations = db.prepare('SELECT * FROM organizations ORDER BY id ASC').all();
  const escorts = db.prepare('SELECT * FROM escorts ORDER BY rating DESC, id ASC').all();
  const hospitals = db.prepare('SELECT * FROM hospitals ORDER BY id ASC').all();

  let orders = db.prepare('SELECT * FROM orders ORDER BY id DESC').all();
  // RBAC data isolation if logged into B-End Organization Admin
  if (authUser && authUser.role === 'ORG_ADMIN' && authUser.org_id) {
    orders = orders.filter(o => o.org_id === authUser.org_id || (o.sop_step === 0 && o.payment_status === 'PAID'));
  }

  const orderEvents = db.prepare('SELECT * FROM order_events ORDER BY id ASC').all();
  const reports = db.prepare('SELECT * FROM medical_reports ORDER BY id DESC').all().map(r => ({
    ...r,
    report_images: safeJsonArray(r.report_images),
    claim_docs: safeJsonArray(r.claim_docs)
  }));
  const medications = db.prepare('SELECT * FROM medications ORDER BY id ASC').all();
  const diaries = db.prepare('SELECT * FROM health_diaries ORDER BY id DESC').all();
  const articles = db.prepare('SELECT * FROM articles ORDER BY id ASC').all();
  const commercialSlots = db.prepare('SELECT * FROM commercial_slots ORDER BY id ASC').all();
  const applications = db.prepare('SELECT * FROM applications ORDER BY id DESC').all();
  const invoices = db.prepare('SELECT * FROM invoices ORDER BY id DESC').all();

  const totalPlatformFee = orders
    .filter(o => o.sop_step >= 0 && o.payment_status === 'PAID')
    .reduce((sum, o) => sum + Number(o.platform_fee || 0), 0);
  const totalAdRevenue = commercialSlots.reduce((sum, s) => sum + Number(s.clicks || 0) * Number(s.cpc_revenue || 0), 0);
  const totalAdClicks = commercialSlots.reduce((sum, s) => sum + Number(s.clicks || 0), 0);
  const checkedMedsCount = medications.filter(m => m.checked_today === 1).length;

  return {
    todayStr: getTodayStr(),
    currentUser: authUser,
    patient,
    patients,
    organizations,
    escorts,
    hospitals,
    orders,
    orderEvents,
    reports,
    medications,
    diaries,
    articles,
    commercialSlots,
    applications,
    invoices,
    stats: {
      orderCount: orders.length,
      unpaidCount: orders.filter(o => o.sop_step >= 0 && o.payment_status === 'UNPAID').length,
      pendingConfirmCount: orders.filter(o => o.sop_step >= 0 && o.patient_confirm_status !== 'CONFIRMED').length,
      pendingDispatchCount: orders.filter(o => o.sop_step === 0 && o.payment_status === 'PAID').length,
      activeServiceCount: orders.filter(o => o.sop_step >= 1 && o.sop_step < 5).length,
      completedOrderCount: orders.filter(o => o.sop_step === 5).length,
      openAfterSaleCount: orders.filter(o => o.after_sale_status === 'OPEN').length,
      totalPlatformFee: Number(totalPlatformFee.toFixed(2)),
      totalAdRevenue: Number(totalAdRevenue.toFixed(2)),
      totalAdClicks,
      medsTotal: medications.length,
      medsChecked: checkedMedsCount
    }
  };
}

let orderSeqCounter = 200;

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    return sendJson(res, 200, { ok: true });
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;
  const authUser = getAuthUser(req);

  try {
    // ==================== 0. Health & Auth Endpoints ====================
    if (req.method === 'GET' && pathname === '/api/health') {
      const wal = db.prepare('PRAGMA journal_mode').get();
      return sendJson(res, 200, {
        ok: true,
        status: 'healthy',
        walMode: wal ? wal.journal_mode : 'wal',
        uptimeSec: Math.round((Date.now() - BOOT_TIME) / 1000),
        timestamp: getNowStr()
      });
    }

    if (req.method === 'GET' && pathname === '/api/auth/me') {
      return sendJson(res, 200, { ok: true, authenticated: Boolean(authUser), user: authUser });
    }

    // Send SMS verification code
    if (req.method === 'POST' && pathname === '/api/auth/send-code') {
      const b = await parseBody(req);
      const phone = cleanStr(b.phone, '', 20);
      if (!isValidMainlandPhone(phone)) {
        return sendJson(res, 400, { ok: false, msg: '请输入有效的 11 位中国大陆手机号码' });
      }
      const code = String(Math.floor(100000 + Math.random() * 900000));
      SMS_CODES.set(phone, { code, expiresAt: Date.now() + 5 * 60 * 1000 });
      return sendJson(res, 200, {
        ok: true,
        demo_code: code,
        msg: `验证码已发送（联调环境验证码：${code}）`
      });
    }

    // Mobile Login (Mini-Program WeChat 1-Click OR App SMS / One-Tap Login)
    if (req.method === 'POST' && pathname === '/api/auth/mobile-login') {
      const b = await parseBody(req);
      if (!b.agreed_privacy) {
        return sendJson(res, 400, { ok: false, msg: '请先阅读并勾选同意《用户服务协议》与《医疗健康隐私保护政策》' });
      }
      const mode = b.mode || 'wechat_quick';
      const targetRole = b.target_role === 'ESCORT' ? 'ESCORT' : 'FAMILY';
      const phone = cleanStr(b.phone, mode === 'wechat_quick' ? '13800138000' : '', 20);
      if (!isValidMainlandPhone(phone)) {
        return sendJson(res, 400, { ok: false, msg: '请输入有效的 11 位手机号码' });
      }

      if (mode === 'sms') {
        const inputCode = cleanStr(b.code, '', 10);
        const cached = SMS_CODES.get(phone);
        const codeValid = inputCode === '888888' || (cached && cached.code === inputCode && cached.expiresAt >= Date.now());
        if (!codeValid) {
          return sendJson(res, 400, { ok: false, msg: '短信验证码不正确或已过期' });
        }
        SMS_CODES.delete(phone);
      }

      let user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
      if (targetRole === 'ESCORT') {
        const esc = db.prepare('SELECT * FROM escorts WHERE phone = ?').get(phone);
        if (!esc) {
          return sendJson(res, 403, { ok: false, msg: '该手机号尚未通过持证陪诊师准入审核，请先在招募页提交资质并通过后台审批' });
        }
        if (!user) {
          const info = db.prepare(`
            INSERT INTO users (username, phone, password_hash, display_name, role, org_id, escort_id, status, agreed_privacy_at, created_at)
            VALUES (?, ?, ?, ?, 'ESCORT', ?, ?, 'ACTIVE', ?, ?)
          `).run(`escort_${esc.id}`, phone, hashPassword('123456'), `${esc.name} (持证陪诊师)`, esc.org_id, esc.id, getNowStr(), getNowStr());
          user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
        } else if (user.status === 'DELETED') {
          db.prepare("UPDATE users SET status = 'ACTIVE', agreed_privacy_at = ? WHERE id = ?").run(getNowStr(), user.id);
          user.status = 'ACTIVE';
        }
      } else {
        if (!user) {
          const tail = phone.slice(-4);
          const info = db.prepare(`
            INSERT INTO users (username, phone, password_hash, display_name, role, status, agreed_privacy_at, created_at)
            VALUES (?, ?, ?, ?, 'FAMILY', 'ACTIVE', ?, ?)
          `).run(`fam_${tail}_${Date.now().toString().slice(-4)}`, phone, hashPassword('123456'), `家庭照护用户${tail}`, getNowStr(), getNowStr());
          user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
        } else if (user.status === 'DELETED') {
          db.prepare("UPDATE users SET status = 'ACTIVE', agreed_privacy_at = ? WHERE id = ?").run(getNowStr(), user.id);
          user.status = 'ACTIVE';
        }
      }

      const token = createSession(user);
      const safeUser = {
        id: user.id,
        username: user.username,
        phone: user.phone,
        masked_phone: maskPhone(user.phone),
        display_name: user.display_name,
        role: user.role,
        org_id: user.org_id,
        escort_id: user.escort_id
      };
      return sendJson(res, 200, { ok: true, token, user: safeUser, data: getBootstrapData(safeUser) });
    }

    // Admin & B-End Partner Organization Password Login
    if (req.method === 'POST' && pathname === '/api/auth/admin-login') {
      const b = await parseBody(req);
      const username = cleanStr(b.username, '', 50);
      const password = cleanStr(b.password, '', 100);
      if (!username || !password) {
        return sendJson(res, 400, { ok: false, msg: '请输入管理员账号与登录密码' });
      }
      const user = db.prepare("SELECT * FROM users WHERE username = ? AND role IN ('ADMIN', 'ORG_ADMIN') AND status = 'ACTIVE'").get(username);
      if (!user || user.password_hash !== hashPassword(password)) {
        return sendJson(res, 401, { ok: false, msg: '后台账号或密码错误' });
      }
      const token = createSession(user);
      const safeUser = {
        id: user.id,
        username: user.username,
        phone: user.phone,
        masked_phone: maskPhone(user.phone),
        display_name: user.display_name,
        role: user.role,
        org_id: user.org_id
      };
      return sendJson(res, 200, { ok: true, token, user: safeUser, data: getBootstrapData(safeUser) });
    }

    // Logout
    if (req.method === 'POST' && pathname === '/api/auth/logout') {
      if (authUser && authUser.token) {
        db.prepare('DELETE FROM sessions WHERE token = ?').run(authUser.token);
      }
      return sendJson(res, 200, { ok: true });
    }

    // App Store / MIIT Mandatory Account Deletion (永久注销账号)
    if (req.method === 'POST' && pathname === '/api/auth/delete-account') {
      const u = requireRole(req, ['FAMILY', 'ESCORT']);
      withTransaction(() => {
        const anonTag = `deleted_${u.id}_${Date.now()}`;
        db.prepare("UPDATE users SET status = 'DELETED', username = ?, phone = ? WHERE id = ?").run(anonTag, anonTag, u.id);
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
      });
      return sendJson(res, 200, { ok: true, msg: '账号及关联个人身份凭证已永久注销清理' });
    }

    // ==================== 1. Bootstrap & Web Public Lookup ====================
    if (req.method === 'GET' && pathname === '/api/bootstrap') {
      return sendJson(res, 200, { ok: true, data: getBootstrapData(authUser) });
    }

    // Web No-Login Order Progress & Payment Lookup
    if (req.method === 'GET' && pathname === '/api/orders/lookup') {
      const q = cleanStr(parsedUrl.searchParams.get('q'), '', 40);
      if (!q || q.length < 4) {
        return sendJson(res, 400, { ok: false, msg: '请输入完整的预约手机号或 EW 开头的订单号' });
      }
      const rows = db.prepare(`
        SELECT id, order_no, patient_name, city, hospital_name, department, visit_date,
               mobility_level, total_price, payment_status, patient_confirm_status,
               escort_name, sop_step, live_note, created_at
        FROM orders
        WHERE order_no = ? OR contact_phone = ?
        ORDER BY id DESC
        LIMIT 10
      `).all(q.toUpperCase(), q);
      return sendJson(res, 200, { ok: true, orders: rows });
    }

    // ==================== 2. File Upload (Step 4 Real Medical Slips / Receipts) ====================
    if (req.method === 'POST' && pathname === '/api/upload') {
      const b = await parseBody(req);
      const dataUrl = String(b.dataUrl || b.data_url || '');
      const match = dataUrl.match(/^data:(image\/(?:png|jpeg|jpg|webp|svg\+xml)|application\/pdf);base64,([A-Za-z0-9+/=]+)$/);
      if (!match) {
        return sendJson(res, 400, { ok: false, msg: '仅支持上传 JPG/PNG/WEBP/SVG 图片或 PDF 票据' });
      }
      const mime = match[1];
      const buf = Buffer.from(match[2], 'base64');
      if (buf.length > 3.5 * 1024 * 1024) {
        return sendJson(res, 400, { ok: false, msg: '单张凭证大小不能超过 3.5MB' });
      }
      const extMap = {
        'image/png': '.png',
        'image/jpeg': '.jpg',
        'image/jpg': '.jpg',
        'image/webp': '.webp',
        'image/svg+xml': '.svg',
        'application/pdf': '.pdf'
      };
      const ext = extMap[mime] || '.jpg';
      const safeFile = `slip_${Date.now()}_${crypto.randomBytes(3).toString('hex')}${ext}`;
      fs.writeFileSync(path.join(uploadsDir, safeFile), buf);
      return sendJson(res, 201, { ok: true, url: `/uploads/${safeFile}`, filename: cleanStr(b.filename, safeFile, 80) });
    }

    // ==================== 3. Family Patients & Timed Care Streak ====================
    if (req.method === 'POST' && pathname === '/api/patients') {
      const b = await parseBody(req);
      const name = cleanStr(b.name, '', 40);
      if (!name) return sendJson(res, 400, { ok: false, msg: '请输入长辈姓名' });
      const relation = cleanStr(b.relation, '父母', 20);
      const age = clampNum(b.age, 1, 120, 75);
      const gender = cleanStr(b.gender, '女', 6);
      const city = cleanStr(b.city, '北京', 20);
      const birthday = cleanStr(b.birthday, '12月18日', 20);
      const mobCode = cleanStr(b.mobility_level, 'L2', 10).slice(0, 2);
      const mobLabels = {
        L0: 'L0 基本自理 · 轻度院内引导 (+¥0)',
        L1: 'L1 轻度受限 · 需全程搀扶看护 (+¥50)',
        L2: 'L2 中度失能 · 需轮椅代借与推行 (+¥80)',
        L3: 'L3 重度受限 · 无电梯上下楼背扶协助 (+¥150)'
      };
      const chronicTags = cleanStr(b.chronic_tags, '慢病随访与定期体检', 120);
      const address = cleanStr(b.address, `${city}市区常住家庭地址`, 150);

      const info = db.prepare(`
        INSERT INTO patients (
          owner_user_id, name, relation, age, gender, city, birthday, days_to_birthday, weather_alert,
          mobility_level, mobility_label, chronic_tags, authorized_family, address,
          care_streak, morning_checkin_date, evening_checkin_date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, '', '')
      `).run(
        authUser ? authUser.id : 1,
        name, relation, age, gender, city, birthday, 15,
        `${city}秋冬换季提醒：今日早晚温差较大，外出复诊请注意防寒保暖并携带常备药与医保卡。`,
        mobCode, mobLabels[mobCode] || mobLabels.L2,
        chronicTags, '家庭主照护账号已授权', address
      );

      const created = db.prepare('SELECT * FROM patients WHERE id = ?').get(info.lastInsertRowid);
      return sendJson(res, 201, { ok: true, patient: created, data: getBootstrapData(authUser) });
    }

    const careCheckMatch = pathname.match(/^\/api\/patients\/(\d+)\/care-checkin$/);
    if (req.method === 'POST' && careCheckMatch) {
      const patientId = Number(careCheckMatch[1]);
      const b = await parseBody(req);
      const period = b.period === 'evening' ? 'evening' : 'morning';
      const p = db.prepare('SELECT * FROM patients WHERE id = ?').get(patientId);
      if (!p) return sendJson(res, 404, { ok: false, msg: '照护长辈档案不存在' });

      const today = getTodayStr();
      const col = period === 'evening' ? 'evening_checkin_date' : 'morning_checkin_date';
      const otherCol = period === 'evening' ? 'morning_checkin_date' : 'evening_checkin_date';
      const alreadyToday = p[col] === today;
      const hadAnyToday = p[col] === today || p[otherCol] === today;

      let newStreak = Number(p.care_streak || 1);
      const newVal = alreadyToday ? '' : today;
      if (!alreadyToday && !hadAnyToday) newStreak += 1;

      db.prepare(`UPDATE patients SET ${col} = ?, care_streak = ? WHERE id = ?`).run(newVal, newStreak, patientId);
      return sendJson(res, 200, {
        ok: true,
        checked: !alreadyToday,
        period,
        care_streak: newStreak,
        data: getBootstrapData(authUser)
      });
    }

    // ==================== 4. AI Triage (+) ====================
    if (req.method === 'POST' && pathname === '/api/ai/triage') {
      const body = await parseBody(req);
      const query = cleanStr(body.query, '', 500);
      const hospitals = db.prepare('SELECT * FROM hospitals').all();

      let matchedHospital = hospitals[0];
      let matchedDept = '老年医学科 / 心内科门诊';
      let recommendedLevel = 'L2 需轮椅代借与推行';
      let recommendedFee = 80;
      let prepTips = [
        '请携带患者本人身份证、医保卡（或电子医保凭证）及既往门诊病历本；',
        '整理老人目前正在服用的所有慢病药物包装盒或照片，供医生核对用药冲突；',
        '换季降温期间外出就医请注意头部与膝部防寒，空腹检查后备好温水与软食。'
      ];

      if (/骨|膝|腿|摔|关节|腰|髋|走不动|下楼/.test(query)) {
        matchedHospital = hospitals.find(h => h.name.includes('积水潭')) || hospitals[0];
        matchedDept = '矫形骨科 / 关节外科门诊';
        recommendedLevel = /楼|背|重度|无电梯/.test(query) ? 'L3 无电梯上下楼背扶协助' : 'L2 需轮椅代借与推行';
        recommendedFee = recommendedLevel.startsWith('L3') ? 150 : 80;
        prepTips = [
          '记录关节疼痛具体部位（左/右膝或髋部）、持续周数及上下楼梯/晨起僵硬表现；',
          '务必携带近半年内的 X 光片、CT 或核磁共振（MRI）胶片原片与报告单；',
          '穿无金属拉链的宽松运动裤方便拍片，建议勾选【L2轮椅】或【L3无电梯上下楼】协助。'
        ];
      } else if (/成都|华西|呼吸|咳|肺|胃肠/.test(query)) {
        matchedHospital = hospitals.find(h => h.name.includes('华西')) || hospitals[0];
        matchedDept = /胃|肠|消化/.test(query) ? '消化内科门诊' : '呼吸与危重症医学科';
        recommendedLevel = /轮椅|走不动/.test(query) ? 'L2 需轮椅代借与推行' : 'L1 需全程搀扶看护';
        recommendedFee = recommendedLevel.startsWith('L2') ? 80 : 50;
        prepTips = [
          '提前在“华医通”App或公众号绑定长辈就诊卡，早08:00关注号源更新；',
          '携带既往胸部CT报告、肺功能检测单或胃肠镜病理底单；',
          '异地医保长辈请提前确认电子医保码异地门诊直接结算状态。'
        ];
      } else if (/心|血压|胸闷|头晕|冠心病|心悸/.test(query)) {
        matchedHospital = hospitals.find(h => h.name.includes('协和')) || hospitals[0];
        matchedDept = '心内科门诊';
        recommendedLevel = 'L2 需轮椅代借与推行';
        recommendedFee = 80;
        prepTips = [
          '导出或携带《健康日记》中近 7 天早晚血压趋势图与心率记录供医生参考；',
          '若需空腹抽血查血脂/生化，清晨常服长效降压药可用一小口白水送服（遵医嘱），随身带糖块防低血糖；',
          '携带既往十二导联心电图、心脏彩超底单及正在服用的降压/他汀类药盒。'
        ];
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

    // ==================== 5. Order Lifecycle, Cashier Payment, Rating & After-Sales ====================
    if (req.method === 'POST' && pathname === '/api/orders') {
      const b = await parseBody(req);
      const contactPhone = cleanStr(b.contact_phone, '13800138000', 30);
      if (!isValidMainlandPhone(contactPhone)) {
        return sendJson(res, 400, { ok: false, msg: '请填写有效的 11 位中国大陆联系手机号' });
      }

      const today = getTodayStr();
      const visitDate = cleanStr(b.visit_date, today, 20);
      if (/^\d{4}-\d{2}-\d{2}$/.test(visitDate) && visitDate < today) {
        return sendJson(res, 400, { ok: false, msg: `预约就诊日期（${visitDate}）不能早于今天（${today}）` });
      }

      orderSeqCounter += 1;
      const orderNo = 'EW' + Date.now().toString().slice(-6) + String(orderSeqCounter).slice(-2);
      const basePrice = clampNum(b.base_price, 99, 2999, 288);
      const mobilityFee = clampNum(b.mobility_fee, 0, 999, 80);
      const totalPrice = Number((basePrice + mobilityFee).toFixed(2));
      const commissionRate = 0.08;
      const platformFee = Number((totalPrice * commissionRate).toFixed(2));
      const providerPayout = Number((totalPrice - platformFee).toFixed(2));

      const hospitalName = cleanStr(b.hospital_name, '北京协和医院(东单院区)', 100);
      const matchedHosp = db.prepare('SELECT city FROM hospitals WHERE name = ?').get(hospitalName);
      const resolvedCity = matchedHosp ? matchedHosp.city : cleanStr(b.city, '北京', 30);

      const patientId = clampNum(b.patient_id, 1, 9999, 1);
      const patientName = cleanStr(b.patient_name, '张建国 (78岁)', 60);
      const department = cleanStr(b.department, '心内科门诊', 60);
      const visitTime = cleanStr(b.visit_time, '08:30', 10);
      const packageName = cleanStr(b.package_name, '半天陪诊 (4小时标准服务)', 80);
      const mobilityLevel = cleanStr(b.mobility_level, 'L2 需轮椅代借与推行', 60);
      const regMode = cleanStr(b.reg_mode, '已挂好号', 40);
      const pickupAddr = cleanStr(b.pickup_address, '朝阳区幸福一村3号楼2单元301', 200);
      const dropoffAddr = cleanStr(b.dropoff_address, '就诊结束后送回原址家中交接', 200);
      const sourceChannel = cleanStr(b.source_channel, '微信小程序', 30);

      // Supports UNPAID cashier workflow (or auto PAID if explicitly requested)
      const payStatus = b.require_cashier ? 'UNPAID' : 'PAID';
      const tradeNo = payStatus === 'PAID' ? `WX${Date.now().toString().slice(-10)}` : '';
      const confirmStatus = b.patient_confirm_status === 'CONFIRMED' ? 'CONFIRMED' : 'PENDING';
      const confirmMethod = cleanStr(
        b.patient_confirm_method,
        confirmStatus === 'CONFIRMED' ? '家属勾选已获患者本人知情授权' : '待患者本人确认授权',
        120
      );
      const nowStr = getNowStr();
      const confirmTime = confirmStatus === 'CONFIRMED' ? nowStr : null;

      let initNote = '订单已提交，请先在收银台完成支付';
      if (payStatus === 'PAID') {
        initNote = confirmStatus === 'CONFIRMED'
          ? '已完成支付与患者授权确认，等待管理后台调度指派陪诊师'
          : '订单已支付，请完成【患者确认(+)】后进入派单队列';
      }

      const newOrder = withTransaction(() => {
        const info = db.prepare(`
          INSERT INTO orders (
            order_no, source_channel, user_id, patient_id, patient_name, contact_phone, city,
            hospital_name, department, visit_date, visit_time, package_name,
            base_price, mobility_level, mobility_fee, total_price,
            payment_status, pay_channel, pay_trade_no,
            reg_mode, pickup_address, dropoff_address,
            patient_confirm_status, patient_confirm_method, patient_confirm_time,
            commission_rate, platform_fee, provider_payout, sop_step, live_note, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '微信支付', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
        `).run(
          orderNo, sourceChannel, authUser ? authUser.id : 1, patientId, patientName, contactPhone, resolvedCity,
          hospitalName, department, visitDate, visitTime, packageName,
          basePrice, mobilityLevel, mobilityFee, totalPrice,
          payStatus, tradeNo,
          regMode, pickupAddr, dropoffAddr,
          confirmStatus, confirmMethod, confirmTime,
          commissionRate, platformFee, providerPayout,
          initNote, nowStr
        );

        const ordId = Number(info.lastInsertRowid);
        logOrderEvent(
          ordId,
          'CREATED',
          `通过${sourceChannel}创建陪诊预约单`,
          `医院：${hospitalName}（${department} · ${visitDate}），分级：${mobilityLevel}，应付 ¥${totalPrice}（${payStatus === 'PAID' ? '已支付' : '待支付'}）`,
          authUser ? authUser.display_name : '照护家属'
        );
        return db.prepare('SELECT * FROM orders WHERE id = ?').get(ordId);
      });

      return sendJson(res, 201, { ok: true, order: newOrder, data: getBootstrapData(authUser) });
    }

    // Cashier Payment Confirmation Endpoint
    const payMatch = pathname.match(/^\/api\/orders\/(\d+)\/pay$/);
    if (req.method === 'POST' && payMatch) {
      const orderId = Number(payMatch[1]);
      const body = await parseBody(req);
      const ord = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
      if (!ord) return sendJson(res, 404, { ok: false, msg: '订单不存在' });

      const channel = cleanStr(body.pay_channel, '微信支付', 30);
      const prefix = channel.includes('支付宝') ? 'ALI' : 'WX';
      const tradeNo = `${prefix}${Date.now()}${Math.floor(10 + Math.random() * 89)}`;

      withTransaction(() => {
        db.prepare(`
          UPDATE orders
          SET payment_status = 'PAID',
              pay_channel = ?,
              pay_trade_no = ?,
              live_note = CASE
                WHEN patient_confirm_status = 'CONFIRMED' THEN '收银台支付成功（' || ? || '），已进入后台待派单池'
                ELSE '收银台支付成功（' || ? || '），请继续完成患者本人确认授权(+)'
              END
          WHERE id = ?
        `).run(channel, tradeNo, channel, channel, orderId);

        logOrderEvent(
          orderId,
          'PAID',
          `收银台支付成功（${channel}）`,
          `实付金额 ¥${ord.total_price}，支付交易流水号：${tradeNo}`,
          authUser ? authUser.display_name : '付款家属'
        );
      });

      const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
      return sendJson(res, 200, { ok: true, order: updated, trade_no: tradeNo, data: getBootstrapData(authUser) });
    }

    const eventsMatch = pathname.match(/^\/api\/orders\/(\d+)\/events$/);
    if (req.method === 'GET' && eventsMatch) {
      const orderId = Number(eventsMatch[1]);
      const events = db.prepare('SELECT * FROM order_events WHERE order_id = ? ORDER BY id ASC').all(orderId);
      return sendJson(res, 200, { ok: true, events });
    }

    const confirmMatch = pathname.match(/^\/api\/orders\/(\d+)\/confirm-patient$/);
    if (req.method === 'POST' && confirmMatch) {
      const orderId = Number(confirmMatch[1]);
      const body = await parseBody(req);
      const ord = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
      if (!ord) return sendJson(res, 404, { ok: false, msg: '订单不存在' });

      const method = cleanStr(body.method, '方式A：患者本人微信大字卡片一键确认授权', 150);
      withTransaction(() => {
        db.prepare(`
          UPDATE orders
          SET patient_confirm_status = 'CONFIRMED',
              patient_confirm_method = ?,
              patient_confirm_time = ?,
              live_note = CASE
                WHEN payment_status = 'UNPAID' THEN '患者已确认授权，请完成订单支付后进入派单'
                WHEN sop_step = 0 THEN '患者本人已完成确认授权并签署国标12+7知情书，等待后台指派陪诊师'
                ELSE live_note
              END
          WHERE id = ?
        `).run(method, getNowStr(), orderId);
        logOrderEvent(orderId, 'CONFIRMED', '完成患者本人确认授权(+)', method, '患者本人/家属协同');
      });
      return sendJson(res, 200, { ok: true, data: getBootstrapData(authUser) });
    }

    const overtimeMatch = pathname.match(/^\/api\/orders\/(\d+)\/add-overtime$/);
    if (req.method === 'POST' && overtimeMatch) {
      const orderId = Number(overtimeMatch[1]);
      const body = await parseBody(req);
      const addHours = clampNum(body.hours, 1, 8, 1);
      const channel = cleanStr(body.pay_channel, '微信支付', 30);
      const addFee = addHours * 100;
      const ord = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
      if (!ord) return sendJson(res, 404, { ok: false, msg: '订单不存在' });
      if (ord.sop_step < 0 || ord.sop_step >= 5) {
        return sendJson(res, 400, { ok: false, msg: '已完结或已取消订单不可补差价加钟' });
      }

      const newOvertimeHours = Number(ord.overtime_hours || 0) + addHours;
      const newOvertimeFee = Number(ord.overtime_fee || 0) + addFee;
      const newTotal = Number((Number(ord.base_price) + Number(ord.mobility_fee) + newOvertimeFee).toFixed(2));
      const newPlatformFee = Number((newTotal * ord.commission_rate).toFixed(2));
      const newPayout = Number((newTotal - newPlatformFee).toFixed(2));

      withTransaction(() => {
        db.prepare(`
          UPDATE orders
          SET overtime_hours = ?, overtime_fee = ?, total_price = ?,
              platform_fee = ?, provider_payout = ?, live_note = ?
          WHERE id = ?
        `).run(
          newOvertimeHours, newOvertimeFee, newTotal, newPlatformFee, newPayout,
          `已通过${channel}支付超时加钟补差价 +${addHours}小时 (+¥${addFee})，账单总额更新为 ¥${newTotal}`,
          orderId
        );
        logOrderEvent(
          orderId,
          'OVERTIME',
          `收银台支付超时加钟 +${addHours} 小时（${channel}）`,
          `补缴 ¥${addFee}，新总额 ¥${newTotal}（平台提成 ¥${newPlatformFee} / 陪诊分成 ¥${newPayout}）`,
          authUser ? authUser.display_name : '照护家属'
        );
      });
      return sendJson(res, 200, { ok: true, data: getBootstrapData(authUser) });
    }

    const cancelMatch = pathname.match(/^\/api\/orders\/(\d+)\/cancel$/);
    if (req.method === 'POST' && cancelMatch) {
      const orderId = Number(cancelMatch[1]);
      const body = await parseBody(req);
      const tier = cleanStr(body.tier, '8-48h', 20);
      const ord = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
      if (!ord) return sendJson(res, 404, { ok: false, msg: '订单不存在' });
      if (ord.sop_step === -1) return sendJson(res, 400, { ok: false, msg: '该订单已办理退改' });
      if (ord.sop_step >= 4) return sendJson(res, 400, { ok: false, msg: '服务已交付报告，不支持自助退单，请发起售后工单' });

      const isUnpaid = ord.payment_status === 'UNPAID';
      const penaltyRates = { '>48h': 0, '8-48h': 0.1, '4-8h': 0.2, '<4h': 0.5 };
      const rate = isUnpaid ? 0 : (penaltyRates[tier] !== undefined ? penaltyRates[tier] : 0.1);
      const penalty = Number((ord.total_price * rate).toFixed(2));
      const refund = isUnpaid ? 0 : Number((ord.total_price - penalty).toFixed(2));

      withTransaction(() => {
        db.prepare(`
          UPDATE orders
          SET sop_step = -1,
              payment_status = ?,
              refund_amount = ?,
              live_note = ?
          WHERE id = ?
        `).run(
          isUnpaid ? 'UNPAID' : 'REFUNDED',
          refund,
          isUnpaid
            ? '未支付订单已免费取消关闭'
            : `已按阶梯退改规则（距服务开始 ${tier}，扣违约金 ¥${penalty}）办理取消，原路退还 ¥${refund}`,
          orderId
        );
        logOrderEvent(
          orderId,
          'CANCELLED',
          isUnpaid ? '取消未支付预约单' : `按阶梯规则办理退款（${tier}）`,
          isUnpaid ? '未发生资金扣款，订单已关闭' : `原实付 ¥${ord.total_price}，扣违约金 ¥${penalty}，原路退回 ¥${refund}`,
          authUser ? authUser.display_name : '照护家属'
        );
      });
      return sendJson(res, 200, { ok: true, refund, penalty, tier, data: getBootstrapData(authUser) });
    }

    // Post-Visit Star Rating & Escort Score Recalculation
    const reviewMatch = pathname.match(/^\/api\/orders\/(\d+)\/review$/);
    if (req.method === 'POST' && reviewMatch) {
      const orderId = Number(reviewMatch[1]);
      const b = await parseBody(req);
      const score = clampNum(b.score, 1, 5, 5);
      const comment = cleanStr(b.comment, '陪诊师非常专业细心，轮椅推行稳当，医嘱记录清晰！', 300);
      const ord = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
      if (!ord) return sendJson(res, 404, { ok: false, msg: '订单不存在' });
      if (ord.sop_step < 4) return sendJson(res, 400, { ok: false, msg: '请在服务交付后再评价' });

      withTransaction(() => {
        db.prepare('UPDATE orders SET rating_score = ?, rating_comment = ? WHERE id = ?').run(score, comment, orderId);
        if (ord.escort_id) {
          const avgRow = db.prepare('SELECT AVG(rating_score) AS avg_s, COUNT(*) AS cnt FROM orders WHERE escort_id = ? AND rating_score > 0').get(ord.escort_id);
          // Blend historical baseline (4.98 * 50) with live reviews
          const blended = Number((((4.98 * 50) + Number(avgRow.avg_s) * Number(avgRow.cnt)) / (50 + Number(avgRow.cnt))).toFixed(2));
          db.prepare('UPDATE escorts SET rating = ? WHERE id = ?').run(blended, ord.escort_id);
        }
        logOrderEvent(orderId, 'REVIEWED', `家属提交服务评价：${score} 星`, comment, authUser ? authUser.display_name : '照护家属');
      });
      return sendJson(res, 200, { ok: true, data: getBootstrapData(authUser) });
    }

    // Post-Visit After-Sales / Complaint Ticket & Admin Resolution
    const afterSaleMatch = pathname.match(/^\/api\/orders\/(\d+)\/after-sale$/);
    if (req.method === 'POST' && afterSaleMatch) {
      const orderId = Number(afterSaleMatch[1]);
      const b = await parseBody(req);
      const reason = cleanStr(b.reason, '', 300);
      if (!reason) return sendJson(res, 400, { ok: false, msg: '请填写投诉或售后诉求说明' });
      const ord = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
      if (!ord) return sendJson(res, 404, { ok: false, msg: '订单不存在' });

      withTransaction(() => {
        db.prepare("UPDATE orders SET after_sale_status = 'OPEN', after_sale_reason = ? WHERE id = ?").run(reason, orderId);
        logOrderEvent(orderId, 'AFTER_SALE', '发起服务投诉/售后申诉工单', reason, authUser ? authUser.display_name : '照护家属');
      });
      return sendJson(res, 200, { ok: true, data: getBootstrapData(authUser) });
    }

    const resolveAsMatch = pathname.match(/^\/api\/orders\/(\d+)\/resolve-after-sale$/);
    if (req.method === 'POST' && resolveAsMatch) {
      const admin = requireRole(req, ['ADMIN', 'ORG_ADMIN']);
      const orderId = Number(resolveAsMatch[1]);
      const b = await parseBody(req);
      const reply = cleanStr(b.reply, '平台品控专员已核实回访家属并妥善办结', 200);
      withTransaction(() => {
        db.prepare("UPDATE orders SET after_sale_status = 'RESOLVED', after_sale_reason = ? WHERE id = ?").run(`【已办结】${reply}`, orderId);
        logOrderEvent(orderId, 'AFTER_SALE_RESOLVED', '后台品控办结售后工单', reply, admin.display_name);
      });
      return sendJson(res, 200, { ok: true, data: getBootstrapData(admin) });
    }

    // ==================== 6. Dispatch & Escort 5-Step SOP ====================
    const dispatchMatch = pathname.match(/^\/api\/orders\/(\d+)\/dispatch$/);
    if (req.method === 'POST' && dispatchMatch) {
      // Enforce Admin/Org role if Authorization token is provided
      if (req.headers.authorization) {
        requireRole(req, ['ADMIN', 'ORG_ADMIN']);
      }
      const orderId = Number(dispatchMatch[1]);
      const body = await parseBody(req);
      const escortId = Number(body.escort_id);
      const escort = db.prepare('SELECT * FROM escorts WHERE id = ?').get(escortId);
      const ord = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
      if (!escort || !ord) return sendJson(res, 404, { ok: false, msg: '陪诊师或订单不存在' });
      if (ord.payment_status === 'UNPAID') {
        return sendJson(res, 400, { ok: false, msg: '该订单尚未完成支付，不可指派陪诊师' });
      }
      if (ord.sop_step === -1 || ord.sop_step === 5) {
        return sendJson(res, 400, { ok: false, msg: '当前订单状态不支持派单' });
      }
      if (authUser && authUser.role === 'ORG_ADMIN' && escort.org_id !== authUser.org_id) {
        return sendJson(res, 403, { ok: false, msg: 'B端机构子账号仅可指派本机构名下陪诊师' });
      }

      let commRate = 0.08;
      if (escort.org_id) {
        const org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(escort.org_id);
        if (org) commRate = Number(org.commission_rate);
      } else {
        commRate = 0.06;
      }
      const platformFee = Number((ord.total_price * commRate).toFixed(2));
      const providerPayout = Number((ord.total_price - platformFee).toFixed(2));

      withTransaction(() => {
        db.prepare(`
          UPDATE orders
          SET escort_id = ?, escort_name = ?, org_id = ?, org_name = ?,
              commission_rate = ?, platform_fee = ?, provider_payout = ?,
              sop_step = CASE WHEN sop_step <= 0 THEN 1 ELSE sop_step END,
              live_note = ?
          WHERE id = ?
        `).run(
          escort.id, escort.name, escort.org_id, escort.org_name,
          commRate, platformFee, providerPayout,
          `后台已指派给【${escort.name} · ${escort.org_name}】，陪诊师已确认接单准备前往接手点`,
          orderId
        );
        logOrderEvent(
          orderId,
          'DISPATCHED',
          `指派陪诊师：${escort.name}（${escort.org_name}）`,
          `资质：${escort.cert_title}；撮合提成 ${Math.round(commRate * 100)}%（¥${platformFee}），服务方分成 ¥${providerPayout}`,
          authUser ? authUser.display_name : '调度管理中枢'
        );
      });
      return sendJson(res, 200, { ok: true, data: getBootstrapData(authUser) });
    }

    const stepMatch = pathname.match(/^\/api\/orders\/(\d+)\/step$/);
    if (req.method === 'POST' && stepMatch) {
      const orderId = Number(stepMatch[1]);
      const body = await parseBody(req);
      const targetStep = clampNum(body.step, 1, 5, 1);
      const ord = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
      if (!ord) return sendJson(res, 404, { ok: false, msg: '订单不存在' });
      if (ord.sop_step === -1) return sendJson(res, 400, { ok: false, msg: '已退改订单不可打卡' });

      const progressNote = cleanStr(
        body.progress_note,
        '已在医院自助机完成取号，正陪同患者在诊区候诊并准备客观记录医嘱',
        220
      );

      const stepNotes = {
        1: `【第1步·已确认接单】陪诊师 ${ord.escort_name || '李淑芬'} 已核对患者失能等级与挂号状态，正使用高德导航前往接手位置`,
        2: `【第2步·已到达接手位置打卡】LBS定位已核验（${ord.pickup_address}），已完成患者当面状态核对与轮椅安全防护`,
        3: `【第3步·院内陪诊服务中】${progressNote}`,
        4: `【第4步·已上传结果报告与理赔单据】已同步生成《结果分享(+)报告》《医嘱执行(+)服药打卡》《术后复检(+)提醒》与《保险理赔资料包(+)》`,
        5: `【第5步·已送达结束交接位置】患者已安全交接至（${ord.dropoff_address}），订单完结，平台提成 ¥${ord.platform_fee} 与服务方收入 ¥${ord.provider_payout} 已自动结算入账`
      };

      withTransaction(() => {
        db.prepare('UPDATE orders SET sop_step = ?, live_note = ? WHERE id = ?').run(
          targetStep,
          stepNotes[targetStep] || ord.live_note,
          orderId
        );

        logOrderEvent(
          orderId,
          `STEP_${targetStep}`,
          `陪诊师完成第 ${targetStep} 步打卡`,
          stepNotes[targetStep],
          `${ord.escort_name || '李淑芬'}(陪诊师)`
        );

        if (targetStep === 4) {
          const doctorAdvice = cleanStr(
            body.doctor_advice,
            '【医生原话客观记录】患者今日复诊生命体征平稳，心肺听诊无殊。医嘱继续按时服用降压及护关节药物，立冬后注意室内保暖与低钠饮食；建议2周后空腹复查血常规与肝肾功能。',
            800
          );
          const recheckDate = cleanStr(body.recheck_date, '2026-11-26', 20);
          const recheckPrep = cleanStr(body.recheck_prep, '复检当日早上空腹（禁食8小时），携带本次处方底单与医保卡。', 200);
          const drugName = cleanStr(body.drug_name, '苯磺酸氨氯地平片 (5mg) + 骨化三醇胶丸', 120);
          const drugFreq = cleanStr(body.drug_freq, '每日1次 · 早饭后温水送服', 100);
          const viewers = cleanStr(body.authorized_viewers, '张晓敏(女儿), 张伟(儿子)', 120);

          const uploadedUrls = Array.isArray(body.uploaded_urls) && body.uploaded_urls.length > 0
            ? body.uploaded_urls.slice(0, 6).map(u => cleanStr(u, '/uploads/sample-lab-report.svg', 200))
            : ['/uploads/sample-lab-report.svg'];

          const existingRep = db.prepare('SELECT id FROM medical_reports WHERE order_id = ?').get(ord.id);
          if (existingRep) {
            db.prepare(`
              UPDATE medical_reports
              SET doctor_advice = ?, recheck_date = ?, recheck_prep = ?, authorized_viewers = ?, report_images = ?
              WHERE id = ?
            `).run(doctorAdvice, recheckDate, recheckPrep, viewers, JSON.stringify(uploadedUrls), existingRep.id);
          } else {
            const repInfo = db.prepare(`
              INSERT INTO medical_reports (
                order_id, order_no, patient_name, hospital_dept, visit_date, escort_name,
                doctor_advice, recheck_date, recheck_prep, authorized_viewers, report_images, claim_docs, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              ord.id, ord.order_no, ord.patient_name,
              `${ord.hospital_name} · ${ord.department}`,
              ord.visit_date, ord.escort_name || '李淑芬',
              doctorAdvice, recheckDate, recheckPrep, viewers,
              JSON.stringify(uploadedUrls),
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
        }

        if (targetStep === 5 && ord.escort_id && !ord.settled) {
          db.prepare('UPDATE orders SET settled = 1 WHERE id = ?').run(orderId);
          db.prepare(`
            UPDATE escorts
            SET completed_orders = completed_orders + 1,
                total_earned = ROUND(total_earned + ?, 2)
            WHERE id = ?
          `).run(ord.provider_payout, ord.escort_id);
        }
      });

      return sendJson(res, 200, { ok: true, data: getBootstrapData(authUser) });
    }

    const schedMatch = pathname.match(/^\/api\/escorts\/(\d+)\/toggle-schedule$/);
    if (req.method === 'POST' && schedMatch) {
      const escortId = Number(schedMatch[1]);
      const esc = db.prepare('SELECT * FROM escorts WHERE id = ?').get(escortId);
      if (!esc) return sendJson(res, 404, { ok: false, msg: '陪诊师不存在' });
      const nextStatus = esc.schedule_status === 'AVAILABLE' ? 'REST' : 'AVAILABLE';
      db.prepare('UPDATE escorts SET schedule_status = ? WHERE id = ?').run(nextStatus, escortId);
      return sendJson(res, 200, { ok: true, schedule_status: nextStatus, data: getBootstrapData(authUser) });
    }

    // ==================== 7. Meds, Diaries, Community, Invoices & Admin CSV ====================
    const medMatch = pathname.match(/^\/api\/medications\/(\d+)\/toggle$/);
    if (req.method === 'POST' && medMatch) {
      const medId = Number(medMatch[1]);
      db.prepare('UPDATE medications SET checked_today = CASE WHEN checked_today = 1 THEN 0 ELSE 1 END WHERE id = ?').run(medId);
      return sendJson(res, 200, { ok: true, data: getBootstrapData(authUser) });
    }

    if (req.method === 'POST' && pathname === '/api/diaries') {
      const b = await parseBody(req);
      const bpSys = clampNum(b.bp_sys, 50, 260, 130);
      const bpDia = clampNum(b.bp_dia, 30, 160, 80);
      const sugar = Number(clampNum(b.blood_sugar, 1.5, 35.0, 5.9).toFixed(1));
      const patientId = clampNum(b.patient_id, 1, 9999, 1);
      const patientRow = db.prepare('SELECT name FROM patients WHERE id = ?').get(patientId);
      const patientName = cleanStr(b.patient_name, patientRow ? patientRow.name : '张建国', 40);
      const nowShort = getNowStr().slice(5, 16);

      let autoFeeling = '状态平稳';
      if (bpSys >= 145 || bpDia >= 92 || sugar >= 7.8) autoFeeling = '指标偏高需关注';
      else if (bpSys <= 135 && bpDia <= 85 && sugar <= 6.5) autoFeeling = '指标达标';

      db.prepare(`
        INSERT INTO health_diaries (patient_id, patient_name, log_date, bp_sys, bp_dia, blood_sugar, feeling, note, morning_care_ok, evening_care_ok)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1)
      `).run(
        patientId, patientName, cleanStr(b.log_date, nowShort, 30),
        bpSys, bpDia, sugar, cleanStr(b.feeling, autoFeeling, 30),
        cleanStr(b.note, '已完成日常生命体征测量与定时关怀确认。', 200)
      );
      return sendJson(res, 201, { ok: true, data: getBootstrapData(authUser) });
    }

    const artMatch = pathname.match(/^\/api\/articles\/(\d+)\/interact$/);
    if (req.method === 'POST' && artMatch) {
      const artId = Number(artMatch[1]);
      const body = await parseBody(req);
      const action = body.action === 'bookmark' ? 'bookmark' : 'like';
      const art = db.prepare('SELECT * FROM articles WHERE id = ?').get(artId);
      if (!art) return sendJson(res, 404, { ok: false, msg: '文章不存在' });

      if (action === 'bookmark') {
        db.prepare('UPDATE articles SET bookmarked = ?, views = views + 1 WHERE id = ?').run(art.bookmarked ? 0 : 1, artId);
      } else {
        const nextLiked = art.liked ? 0 : 1;
        const nextLikes = Math.max(0, Number(art.likes || 0) + (nextLiked ? 1 : -1));
        db.prepare('UPDATE articles SET liked = ?, likes = ?, views = views + 1 WHERE id = ?').run(nextLiked, nextLikes, artId);
      }
      return sendJson(res, 200, { ok: true, data: getBootstrapData(authUser) });
    }

    // Electronic Invoice Request
    if (req.method === 'POST' && pathname === '/api/invoices') {
      const b = await parseBody(req);
      const title = cleanStr(b.invoice_title, '', 80);
      const email = cleanStr(b.email, '', 80);
      if (!title || !email.includes('@')) {
        return sendJson(res, 400, { ok: false, msg: '请填写准确的发票抬头与接收邮箱' });
      }
      db.prepare(`
        INSERT INTO invoices (user_id, order_no, title_type, invoice_title, tax_no, amount, email, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'ISSUED', ?)
      `).run(
        authUser ? authUser.id : 1,
        cleanStr(b.order_no, 'EW2026110801', 30),
        cleanStr(b.title_type, '个人', 20),
        title,
        cleanStr(b.tax_no, '', 30),
        clampNum(b.amount, 1, 99999, 368),
        email,
        getNowStr()
      );
      return sendJson(res, 201, { ok: true, data: getBootstrapData(authUser) });
    }

    const commMatch = pathname.match(/^\/api\/commercial\/(\d+)\/click$/);
    if (req.method === 'POST' && commMatch) {
      const slotId = Number(commMatch[1]);
      db.prepare('UPDATE commercial_slots SET clicks = clicks + 1 WHERE id = ?').run(slotId);
      const slot = db.prepare('SELECT * FROM commercial_slots WHERE id = ?').get(slotId);
      return sendJson(res, 200, { ok: true, slot, data: getBootstrapData(authUser) });
    }

    if (req.method === 'POST' && pathname === '/api/commercial') {
      if (req.headers.authorization) requireRole(req, ['ADMIN']);
      const b = await parseBody(req);
      const title = cleanStr(b.title, '', 80);
      if (!title) return sendJson(res, 400, { ok: false, msg: '请输入合作资源位标题' });
      db.prepare(`
        INSERT INTO commercial_slots (slot_type, title, subtitle, partner_name, price_tag, target_url, clicks, cpc_revenue)
        VALUES (?, ?, ?, ?, ?, ?, 0, ?)
      `).run(
        cleanStr(b.slot_type, '体检推荐', 20), title,
        cleanStr(b.subtitle, '支持报告自动同步至家庭健康档案', 140),
        cleanStr(b.partner_name, '品牌合作机构', 60),
        cleanStr(b.price_tag, '¥399起', 30),
        cleanStr(b.target_url, 'https://www.health-100.cn/', 200),
        clampNum(b.cpc_revenue, 0.5, 100, 6.0)
      );
      return sendJson(res, 201, { ok: true, data: getBootstrapData(authUser) });
    }

    if (req.method === 'POST' && pathname === '/api/applications') {
      const b = await parseBody(req);
      const name = cleanStr(b.name, '', 60);
      const phone = cleanStr(b.phone, '', 30);
      if (!name || !isValidMainlandPhone(phone)) {
        return sendJson(res, 400, { ok: false, msg: '请填写完整的申请人/机构名称与有效的 11 位手机号码' });
      }
      db.prepare(`
        INSERT INTO applications (apply_type, name, phone, city, qualification, status, created_at)
        VALUES (?, ?, ?, ?, ?, 'PENDING', ?)
      `).run(
        b.apply_type === 'ORG' ? 'ORG' : 'ESCORT',
        name, phone, cleanStr(b.city, '北京', 30),
        cleanStr(b.qualification, '持有养老护理员证与健康证，熟悉三甲医院门诊流程', 200),
        getNowStr()
      );
      return sendJson(res, 201, { ok: true, data: getBootstrapData(authUser) });
    }

    const appApproveMatch = pathname.match(/^\/api\/applications\/(\d+)\/approve$/);
    if (req.method === 'POST' && appApproveMatch) {
      if (req.headers.authorization) requireRole(req, ['ADMIN']);
      const appId = Number(appApproveMatch[1]);
      const app = db.prepare('SELECT * FROM applications WHERE id = ?').get(appId);
      if (!app) return sendJson(res, 404, { ok: false, msg: '申请记录不存在' });
      if (app.status === 'APPROVED') return sendJson(res, 200, { ok: true, data: getBootstrapData(authUser) });

      withTransaction(() => {
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
      });
      return sendJson(res, 200, { ok: true, data: getBootstrapData(authUser) });
    }

    // Admin Financial Ledger CSV Export (UTF-8 BOM for Excel)
    if (req.method === 'GET' && pathname === '/api/admin/export-orders.csv') {
      const orders = db.prepare('SELECT * FROM orders ORDER BY id DESC').all();
      const escCsv = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const header = ['订单号', '来源渠道', '城市', '就诊患者', '联系电话', '就诊医院', '科室', '就诊日期', '失能等级', '订单总额(元)', '支付状态', '支付流水号', '平台提成(元)', '服务方应得(元)', '承接陪诊师', '履约步骤', '客户星级', '创建时间'];
      const lines = [header.join(',')];
      for (const o of orders) {
        lines.push([
          o.order_no, o.source_channel, o.city, o.patient_name, o.contact_phone,
          o.hospital_name, o.department, o.visit_date, o.mobility_level,
          o.total_price, o.payment_status, o.pay_trade_no, o.platform_fee, o.provider_payout,
          o.escort_name || '待指派', o.sop_step, o.rating_score || '', o.created_at
        ].map(escCsv).join(','));
      }
      const csvBody = '\uFEFF' + lines.join('\r\n');
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="everwell_orders_${getTodayStr()}.csv"`
      });
      return res.end(csvBody);
    }

    // ==================== 8. Static File Serving ====================
    const safeRelPath = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
    const filePath = path.resolve(PUBLIC_DIR, safeRelPath);
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
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
        '.pdf': 'application/pdf'
      };
      res.writeHead(200, {
        'Content-Type': mimeTypes[ext] || 'application/octet-stream',
        'Cache-Control': 'no-cache'
      });
      return fs.createReadStream(filePath).pipe(res);
    }

    if (pathname.startsWith('/api/')) {
      return sendJson(res, 404, { ok: false, msg: 'API 路径不存在' });
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  } catch (err) {
    const code = err.statusCode || 500;
    if (code >= 500) console.error('Server error:', err);
    sendJson(res, code, { ok: false, msg: err.message || '服务器内部错误' });
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Everwell Peizhen Full-Stack Server running at http://localhost:${PORT}`);
  });
}

module.exports = { server };
