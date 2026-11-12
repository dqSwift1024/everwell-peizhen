const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'everwell.sqlite');
const db = new DatabaseSync(dbPath);

function ensureColumn(tableName, colName, colDef) {
  const cols = db.prepare(`PRAGMA table_info(${tableName})`).all();
  if (!cols.some(c => c.name === colName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${colName} ${colDef}`);
  }
}

function initDb() {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS patients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      relation TEXT DEFAULT '父亲',
      age INTEGER NOT NULL,
      gender TEXT DEFAULT '男',
      city TEXT NOT NULL,
      birthday TEXT NOT NULL,
      days_to_birthday INTEGER DEFAULT 5,
      weather_alert TEXT,
      mobility_level TEXT NOT NULL,
      mobility_label TEXT NOT NULL,
      chronic_tags TEXT,
      authorized_family TEXT,
      address TEXT,
      care_streak INTEGER DEFAULT 12,
      morning_checkin_date TEXT DEFAULT '',
      evening_checkin_date TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS organizations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      credit_code TEXT NOT NULL,
      contact_name TEXT NOT NULL,
      contact_phone TEXT NOT NULL,
      city TEXT NOT NULL,
      commission_rate REAL DEFAULT 0.08,
      deposit_free_until TEXT DEFAULT '2029-11-08',
      deposit_balance REAL DEFAULT 0,
      escort_count INTEGER DEFAULT 0,
      status TEXT DEFAULT 'ACTIVE'
    );

    CREATE TABLE IF NOT EXISTS escorts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      gender TEXT DEFAULT '女',
      age INTEGER DEFAULT 38,
      phone TEXT NOT NULL,
      source_type TEXT NOT NULL, -- 'ORG' (B端机构人员) or 'SELF' (自有培训人员)
      org_id INTEGER,
      org_name TEXT NOT NULL,
      cert_title TEXT NOT NULL,
      health_cert_expiry TEXT NOT NULL,
      skills TEXT NOT NULL, -- comma separated: L0,L1,L2,L3
      hospitals TEXT NOT NULL,
      schedule_status TEXT DEFAULT 'AVAILABLE',
      rating REAL DEFAULT 4.98,
      completed_orders INTEGER DEFAULT 0,
      total_earned REAL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS hospitals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      city TEXT NOT NULL,
      level TEXT DEFAULT '三级甲等',
      strong_depts TEXT NOT NULL,
      official_reg_info TEXT NOT NULL,
      wheelchair_guide TEXT NOT NULL,
      lat REAL DEFAULT 39.913,
      lng REAL DEFAULT 116.417
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_no TEXT NOT NULL UNIQUE,
      source_channel TEXT NOT NULL, -- 'Web官网', '微信小程序', 'App客户端'
      patient_id INTEGER DEFAULT 1,
      patient_name TEXT NOT NULL,
      contact_phone TEXT NOT NULL,
      city TEXT NOT NULL,
      hospital_name TEXT NOT NULL,
      department TEXT NOT NULL,
      visit_date TEXT NOT NULL,
      visit_time TEXT DEFAULT '08:30',
      package_name TEXT NOT NULL,
      base_price REAL NOT NULL,
      mobility_level TEXT NOT NULL,
      mobility_fee REAL NOT NULL,
      overtime_hours INTEGER DEFAULT 0,
      overtime_fee REAL DEFAULT 0,
      total_price REAL NOT NULL,
      reg_mode TEXT NOT NULL, -- '已挂好号', '跳官方挂号', '需人工协助挂号'
      pickup_address TEXT NOT NULL,
      dropoff_address TEXT NOT NULL,
      patient_confirm_status TEXT DEFAULT 'PENDING', -- 'PENDING', 'CONFIRMED'
      patient_confirm_method TEXT DEFAULT '待患者本人确认',
      patient_confirm_time TEXT,
      escort_id INTEGER,
      escort_name TEXT,
      org_id INTEGER,
      org_name TEXT,
      commission_rate REAL DEFAULT 0.08,
      platform_fee REAL DEFAULT 0,
      provider_payout REAL DEFAULT 0,
      sop_step INTEGER DEFAULT 0, -- 0:待派单, 1:已接单, 2:已达接手点, 3:院内陪诊中, 4:已传医嘱报告, 5:已交接完成, -1:已退改取消
      live_note TEXT DEFAULT '等待完成患者授权确认后指派陪诊师',
      refund_amount REAL DEFAULT 0,
      settled INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS order_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      title TEXT NOT NULL,
      detail TEXT NOT NULL,
      operator TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS medical_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      order_no TEXT NOT NULL,
      patient_name TEXT NOT NULL,
      hospital_dept TEXT NOT NULL,
      visit_date TEXT NOT NULL,
      escort_name TEXT NOT NULL,
      doctor_advice TEXT NOT NULL,
      recheck_date TEXT NOT NULL,
      recheck_prep TEXT NOT NULL,
      authorized_viewers TEXT NOT NULL,
      report_images TEXT NOT NULL, -- JSON array
      claim_docs TEXT NOT NULL, -- JSON array for 保险理赔资料(+)
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS medications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id INTEGER,
      patient_name TEXT NOT NULL,
      drug_name TEXT NOT NULL,
      dosage TEXT NOT NULL,
      frequency TEXT NOT NULL,
      days_total INTEGER DEFAULT 14,
      checked_today INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS health_diaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER DEFAULT 1,
      patient_name TEXT NOT NULL,
      log_date TEXT NOT NULL,
      bp_sys INTEGER NOT NULL,
      bp_dia INTEGER NOT NULL,
      blood_sugar REAL NOT NULL,
      feeling TEXT NOT NULL,
      note TEXT,
      morning_care_ok INTEGER DEFAULT 1,
      evening_care_ok INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL, -- '无障碍攻略', '时令饮食', '视频讲堂', '慢病预防'
      solar_term TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      content TEXT NOT NULL,
      recommend_dept TEXT NOT NULL,
      hospital_link TEXT DEFAULT '北京协和医院(东单院区)',
      author_name TEXT DEFAULT '李淑芬 · 金牌陪诊顾问',
      cover_tag TEXT DEFAULT '实景踩点',
      views INTEGER DEFAULT 320,
      likes INTEGER DEFAULT 86,
      liked INTEGER DEFAULT 0,
      bookmarked INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS commercial_slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slot_type TEXT NOT NULL, -- '体检推荐', '购药入口', '保险入口'
      title TEXT NOT NULL,
      subtitle TEXT NOT NULL,
      partner_name TEXT NOT NULL,
      price_tag TEXT NOT NULL,
      target_url TEXT NOT NULL,
      clicks INTEGER DEFAULT 0,
      cpc_revenue REAL DEFAULT 5.0
    );

    CREATE TABLE IF NOT EXISTS applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      apply_type TEXT NOT NULL, -- 'ORG' or 'ESCORT'
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      city TEXT NOT NULL,
      qualification TEXT NOT NULL,
      status TEXT DEFAULT 'PENDING',
      created_at TEXT NOT NULL
    );
  `);

  // Idempotent migrations for existing V1 SQLite databases
  ensureColumn('patients', 'relation', "TEXT DEFAULT '父亲'");
  ensureColumn('patients', 'care_streak', 'INTEGER DEFAULT 12');
  ensureColumn('patients', 'morning_checkin_date', "TEXT DEFAULT ''");
  ensureColumn('patients', 'evening_checkin_date', "TEXT DEFAULT ''");
  ensureColumn('orders', 'settled', 'INTEGER DEFAULT 0');
  ensureColumn('health_diaries', 'patient_id', 'INTEGER DEFAULT 1');
  ensureColumn('articles', 'hospital_link', "TEXT DEFAULT '北京协和医院(东单院区)'");
  ensureColumn('articles', 'author_name', "TEXT DEFAULT '李淑芬 · 金牌陪诊顾问'");
  ensureColumn('articles', 'cover_tag', "TEXT DEFAULT '实景干货'");
  ensureColumn('articles', 'likes', 'INTEGER DEFAULT 88');
  ensureColumn('articles', 'liked', 'INTEGER DEFAULT 0');
  ensureColumn('articles', 'bookmarked', 'INTEGER DEFAULT 0');

  const count = db.prepare('SELECT COUNT(*) AS c FROM patients').get().c;
  if (count === 0) {
    seedInitialData();
  } else {
    upgradeExistingSeedData();
  }
}

function seedInitialData() {
  const insertPatient = db.prepare(`
    INSERT INTO patients (
      name, relation, age, gender, city, birthday, days_to_birthday, weather_alert,
      mobility_level, mobility_label, chronic_tags, authorized_family, address,
      care_streak, morning_checkin_date, evening_checkin_date
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertPatient.run(
    '张建国', '父亲', 78, '男', '北京', '11月17日', 5,
    '立冬寒潮橙色预警：今日北京大幅降温 8°C (2°C~9°C)，阵风6级，需特别防范老人清晨血压波动与膝关节受凉。',
    'L2', 'L2 中度失能 · 需轮椅代借与推行 (+¥80)',
    '高血压2级, 双膝退行性骨关节炎, 冠心病史',
    '张晓敏(女儿·主决策人), 张伟(儿子·异地协同)',
    '北京市朝阳区幸福一村3号楼2单元301(老旧无电梯)',
    14, '2026-11-12', ''
  );

  insertPatient.run(
    '陈秀英', '母亲', 82, '女', '北京', '12月03日', 21,
    '干燥降温提醒：今日室内外温差大，高龄骨质疏松长辈外出复诊请穿防滑软底鞋，备好保温杯。',
    'L3', 'L3 重度受限 · 无电梯上下楼背扶协助 (+¥150)',
    '重度骨质疏松, 右髋关节置换术后, 2型糖尿病',
    '张晓敏(女儿·主决策人), 张伟(儿子·异地协同)',
    '北京市西城区新街口北大街12号院4楼(无电梯)',
    9, '', ''
  );

  const insertOrg = db.prepare(`
    INSERT INTO organizations (name, credit_code, contact_name, contact_phone, city, commission_rate, deposit_free_until, deposit_balance, escort_count, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertOrg.run('北京康护之家养老服务有限公司', '91110105MA01K8821X', '刘建国', '13910086611', '北京', 0.08, '2029-11-07', 0, 28, 'ACTIVE');
  insertOrg.run('上海颐安助医陪护中心', '91310115MA1K99234B', '周慧敏', '13701928833', '上海', 0.09, '2029-11-07', 0, 19, 'ACTIVE');

  const insertEscort = db.prepare(`
    INSERT INTO escorts (name, gender, age, phone, source_type, org_id, org_name, cert_title, health_cert_expiry, skills, hospitals, schedule_status, rating, completed_orders, total_earned)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertEscort.run('李淑芬', '女', 41, '13811223344', 'ORG', 1, '北京康护之家(B端机构)', '高级养老护理员证 + 医疗陪诊顾问证', '2027-09-15', 'L0,L1,L2', '北京协和医院,中日友好医院,朝阳医院', 'AVAILABLE', 4.99, 142, 42860);
  insertEscort.run('王建军', '男', 43, '13699887766', 'SELF', null, '平台自有培训人员', '国家开放大学医疗陪诊证 + 红十字急救证', '2027-10-20', 'L0,L1,L2,L3', '北京积水潭医院,北京协和医院,北医三院', 'AVAILABLE', 4.98, 98, 31500);
  insertEscort.run('赵敏', '女', 36, '13566778899', 'ORG', 1, '北京康护之家(B端机构)', '执业护士转岗 + 陪诊师证', '2027-08-01', 'L0,L1,L2', '四川大学华西医院,北京协和医院', 'AVAILABLE', 4.97, 76, 24120);

  const insertHospital = db.prepare(`
    INSERT INTO hospitals (name, city, level, strong_depts, official_reg_info, wheelchair_guide, lat, lng)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertHospital.run('北京协和医院(东单院区)', '北京', '三级甲等', '心内科,老年医学科,风湿免疫科,神经科', '官方“北京协和医院”App，每日下午15:00放第7天号源', '门诊楼1层大厅北侧共享轮椅点（凭身份证或押金租借），东门设无障碍落客通道', 39.9138, 116.4175);
  insertHospital.run('北京积水潭医院(新街口院区)', '北京', '三级甲等', '矫形骨科,创伤骨科,手外科,运动医学科', '京通小程序/114预约挂号，骨科专家号建议提前7天预约', '南门急诊与门诊大厅均设轮椅坡道，一楼导诊台旁可租借共享轮椅', 39.9432, 116.3731);
  insertHospital.run('四川大学华西医院(本院)', '成都', '三级甲等', '呼吸内科,心内科,老年科,骨科', '“华医通”App或微信公众号早上08:00放号', '第一门诊大楼入口右侧设便民轮椅租借处与助老服务岗', 30.6421, 104.0628);

  const insertOrder = db.prepare(`
    INSERT INTO orders (
      order_no, source_channel, patient_id, patient_name, contact_phone, city, hospital_name, department,
      visit_date, visit_time, package_name, base_price, mobility_level, mobility_fee, overtime_hours, overtime_fee,
      total_price, reg_mode, pickup_address, dropoff_address, patient_confirm_status, patient_confirm_method,
      patient_confirm_time, escort_id, escort_name, org_id, org_name, commission_rate, platform_fee, provider_payout,
      sop_step, live_note, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertOrder.run(
    'EW2026110801', '微信小程序', 1, '张建国 (78岁)', '13800138000', '北京',
    '北京协和医院(东单院区)', '心内科门诊', '2026-11-13', '08:30',
    '半天陪诊 (4小时标准服务)', 288, 'L2 需轮椅代借与推行', 80, 0, 0,
    368, '已挂好号', '朝阳区幸福一村3号楼2单元门口', '就诊结束后送回幸福一村3号楼家中交接',
    'CONFIRMED', '方式A：患者本人微信大字卡片一键确认授权', '2026-11-12 09:15',
    1, '李淑芬', 1, '北京康护之家(B端机构)', 0.08, 29.44, 338.56,
    2, '陪诊师李淑芬已到达幸福一村接手位置，已备好折叠轮椅并完成现场接手拍照打卡', '2026-11-12 08:50'
  );

  insertOrder.run(
    'EW2026110802', 'App客户端', 2, '陈秀英 (82岁)', '13911112222', '北京',
    '北京积水潭医院(新街口院区)', '矫形骨科专家门诊', '2026-11-14', '09:00',
    '半天陪诊 (4小时标准服务)', 288, 'L3 无电梯上下楼背扶协助', 150, 0, 0,
    438, '需人工协助挂号', '西城区新街口北大街12号院4楼(无电梯)', '原址4楼家中安全交接',
    'CONFIRMED', '方式B：同住家属在旁，患者同机手写签名授权', '2026-11-12 10:20',
    null, null, null, null, 0.08, 35.04, 402.96,
    0, '患者已确认授权，等待后台调度员指派具备 L3 上下楼技能的陪诊师', '2026-11-12 10:18'
  );

  seedOrderEvents();

  db.prepare(`
    INSERT INTO medical_reports (
      order_id, order_no, patient_name, hospital_dept, visit_date, escort_name,
      doctor_advice, recheck_date, recheck_prep, authorized_viewers, report_images, claim_docs, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    1, 'EW2026102509', '张建国 (78岁)', '北京协和医院(东单院区) · 心内科门诊', '2026-10-29', '李淑芬',
    '【医生原话客观记录】患者近期立冬降温后晨起血压偏高(146/88mmHg)，双下肢无明显水肿。医嘱维持苯磺酸氨氯地平片每日1片早饭后服用，新增阿托伐他汀钙片每晚1片；严格低盐饮食(每日食盐<5g)，避免清晨顶风外出；2周后空腹复查血生化、肝肾功能及动态心电图。',
    '2026-11-16',
    '检查前1天晚上22:00后禁食禁水（保持空腹抽血），携带上次心电图底单与医保卡。',
    '张晓敏(女儿), 张伟(儿子)',
    JSON.stringify(['生化全项检验报告单_20261029.jpg', '心内科门诊处方笺_20261029.jpg', '十二导联心电图报告.jpg']),
    JSON.stringify(['北京医疗门诊收费电子票据(¥426.50).pdf', '协和医院门诊病历页照片.jpg', '医保结算费用明细清单.jpg']),
    '2026-10-29 12:10'
  );

  const insertMed = db.prepare(`
    INSERT INTO medications (report_id, patient_name, drug_name, dosage, frequency, days_total, checked_today)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  insertMed.run(1, '张建国', '苯磺酸氨氯地平片 (络活喜) 5mg', '每次 1 片 · 温水送服', '每日1次 (早饭后 08:00)', 14, 1);
  insertMed.run(1, '张建国', '阿托伐他汀钙片 (立普妥) 20mg', '每次 1 片 · 睡前服用', '每日1次 (晚间 20:30)', 14, 0);
  insertMed.run(1, '陈秀英', '骨化三醇胶丸 (罗盖全) 0.25μg', '每次 1 粒 · 随早餐服', '每日1次 (早饭后 08:30)', 30, 1);

  seedSevenDayDiaries();
  seedCommunityArticles();

  const insertComm = db.prepare(`
    INSERT INTO commercial_slots (slot_type, title, subtitle, partner_name, price_tag, target_url, clicks, cpc_revenue)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertComm.run('体检推荐', '65岁+父母心脑血管与骨密度深度筛查套餐', '含颈动脉彩超、心脏彩超、双能X线骨密度、头颅CT及慢病评估', '美年大健康 · 官方合作入口', '¥599 (原价¥1280)', 'https://www.health-100.cn/', 412, 8.0);
  insertComm.run('体检推荐', '三甲医院同源·中老年胃肠早筛与肿瘤标志物套餐', '适合术后随访及消化道慢病长辈，支持体检报告自动归档家庭档案', '爱康国宾 · 尊享老年检', '¥780', 'https://www.ikang.com/', 285, 8.0);
  insertComm.run('购药入口', '慢病处方药/降压药正品极速送到家 (支持医保个账)', '自动匹配本次医嘱药品清单，30分钟同城药房闪送或次日达', '京东健康大药房 · 合作入口', '正品保障 · 满减补贴', 'https://www.jdhealth.com/', 638, 4.5);
  insertComm.run('保险入口', '“孝心安”老年人骨折意外与住院陪护津贴险 (50-85岁可保)', '涵盖就医途中跌倒骨折、救护车费及住院护工津贴(150元/天)', '中国太保/平安健康险合作入口', '¥98 / 年起', 'https://www.pingan.com/', 595, 6.0);
}

function seedSevenDayDiaries() {
  const insertDiary = db.prepare(`
    INSERT INTO health_diaries (patient_id, patient_name, log_date, bp_sys, bp_dia, blood_sugar, feeling, note, morning_care_ok, evening_care_ok)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  // Chronological order so DESC shows latest first
  const history = [
    [1, '张建国', '11-06', 146, 90, 6.8, '晨起略晕', '刚降温血压偏高，已联系女儿预约协和复查。'],
    [1, '张建国', '11-07', 142, 88, 6.5, '状态尚可', '调整了室内暖气温度，严格少盐饮食。'],
    [1, '张建国', '11-08', 139, 86, 6.3, '膝盖微酸', '贴了护膝膏药，早晚按时服络活喜与立普妥。'],
    [1, '张建国', '11-09', 136, 84, 6.2, '状态平稳', '下午在客厅慢走15分钟，睡眠改善。'],
    [1, '张建国', '11-10', 134, 82, 6.0, '精神不错', '早安关怀已确认，血压连续4天稳步回落。'],
    [1, '张建国', '11-11', 132, 81, 5.9, '状态良好', '按时服药，温水泡脚20分钟。'],
    [1, '张建国', '11-12 (今日)', 129, 79, 5.8, '状态极佳', '立冬保暖到位，今日晨起血压已恢复理想区间！']
  ];
  for (const row of history) {
    insertDiary.run(...row, 1, 1);
  }
  insertDiary.run(2, '陈秀英', '11-12 (今日)', 134, 80, 6.6, '状态平稳', '右髋术后恢复良好，等待积水潭骨科复查。', 1, 1);
}

function seedCommunityArticles() {
  const insertArticle = db.prepare(`
    INSERT INTO articles (category, solar_term, title, summary, content, recommend_dept, hospital_link, author_name, cover_tag, views, likes, liked, bookmarked)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertArticle.run(
    '无障碍攻略', '协和实测',
    '北京协和东单院区「轮椅无障碍就医」全流程避坑路线图（2026秋冬季版）',
    '东门落客即平坡、1楼北侧共享轮椅押金细节、抽血室高龄优先窗口位置一次性讲透。',
    '带腿脚不便或半失能父母去协和东单院区，切记不要停在窄胡同口！滴滴/高德直接定位「协和医院东单院区-东门无障碍通道」，下车即是缓坡。进门诊楼1层大厅右侧北端即有共享轮椅柜（建议提前备好微信免押分或身份证）。80岁以上长辈在采血中心可走助老优先窗口，陪诊员提前15分钟到院代借轮椅能省下至少200米步行体力。',
    '心内科门诊', '北京协和医院(东单院区)', '李淑芬 · 协和陪诊142单', '三甲轮椅实测', 2680, 342, 0, 1
  );

  insertArticle.run(
    '无障碍攻略', '骨科必看',
    '积水潭新街口院区带80岁老人拍X光/核磁：无电梯老小区上下楼+院内转运干货',
    '骨科拍片动线长，如何减少老人膝髋二次受力？附院内无障碍直梯点位与检查穿着建议。',
    '去积水潭看矫形骨科或创伤骨科的长辈，出门前切记穿「无金属拉链、无金属纽扣」的宽松棉质运动裤，拍X光和核磁时免去反复穿脱折腾！老旧小区无电梯建议勾选L3背扶协助，到南门后走右侧无障碍坡道直达放射科专用宽体电梯。切记携带既往半年内的胶片原片与光盘。',
    '矫形骨科门诊', '北京积水潭医院(新街口院区)', '王建军 · 红十字急救持证', '骨科少折腾指南', 1920, 256, 1, 0
  );

  insertArticle.run(
    '时令饮食', '立冬节气',
    '立冬后失能与高血压老人温补食谱：山药黑芝麻护血管、控盐5g防晨峰血压',
    '65岁以上高血压合并骨关节病变长辈，立冬进补忌老火浓肉汤，宜选温润高钙低钠食材。',
    '立冬交节后气温骤降，血管收缩易致老年晨峰高血压。每日早餐推荐铁棍山药小米粥搭配黑芝麻核桃粉，补充钾钙与不饱和脂肪酸；炖汤时严禁老火浓肉汤（防高嘌呤与隐形高盐），改用去皮鸡胸肉炖白萝卜或豆腐鲫鱼汤。若老人近期出现晨起头晕或膝关节僵硬加重，建议及时预约心内科或老年科复诊。',
    '老年医学科', '北京协和医院(东单院区)', '赵敏 · 执业护士转岗顾问', '节气药膳食养', 1540, 198, 0, 0
  );

  insertArticle.run(
    '视频讲堂', '照护实操',
    '【3分钟视频拆解】家属与陪诊员必学：半失能老人从轮椅安全转移至检查床4步法',
    '锁死轮椅双刹 → 翻起脚踏板 → 健侧30度贴靠 → 双膝抵护腰带顺势落座，零跌倒风险。',
    '在医院做心脏彩超、CT或心电图时，老人从轮椅移位到窄检查床是最易发生滑倒的环节。标准SOP四步：第一，轮椅以30~45度角斜靠检查床（优先让老人有力的一侧靠近床沿），双手务必推死左右刹车；第二，翻起双侧脚踏板防绊脚；第三，协助者双膝轻抵老人患侧膝盖作支点；第四，托扶腰带平稳旋转落座。',
    '康复医学科', '北京积水潭医院(新街口院区)', '健康来敲门 · 实训教研组', '3分钟护老视频', 1310, 215, 0, 0
  );

  insertArticle.run(
    '慢病预防', '冬季防护',
    '高龄老人冬季「空腹抽血+胃肠镜」防低血糖晕厥清单：降压药到底能不能吃？',
    '80%长辈误以为空腹抽血连降压药也停服，导致候诊室血压飙升！出发前必核对这5样物品。',
    '陪诊一线最常遇到的惊险情况，就是老人因空腹抽血擅自停吃清晨降压药，结果到了医院一量血压180/105mmHg无法做检查！除特殊医嘱外，常规长效降压药应在清晨7点前用一小口白开水（不超过30ml）送服。随身包务必装齐：糖块2颗、温水杯、软面包、当前全部药盒照片及既往化验单。',
    '心内科门诊', '北京协和医院(东单院区)', '李淑芬 · 协和陪诊142单', '诊前防晕厥清单', 1120, 164, 0, 0
  );

  insertArticle.run(
    '无障碍攻略', '华西实测',
    '成都华西医院本院带父母看呼吸/老年科：华医通放号时间与第一门诊助老通道攻略',
    '外地子女必藏！第一门诊大楼轮椅租借点、呼吸科肺功能检查楼层衔接与异地医保备案提示。',
    '异地给成都父母约华西本院，提前在国家医保服务平台办好异地就医备案（川内多已免备案直接刷码）。到院直接定位华西第一门诊大楼无障碍落客区，入口右侧助老服务岗可凭有效证件借用便民轮椅。呼吸科做肺功能吹气检查对高龄老人体力消耗大，建议预约半天4小时陪诊含全程轮椅推行。',
    '呼吸内科', '四川大学华西医院(本院)', '赵敏 · 执业护士转岗顾问', '华西无障碍攻略', 980, 143, 0, 0
  );
}

function seedOrderEvents() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM order_events').get().c;
  if (count > 0) return;
  const ins = db.prepare(`
    INSERT INTO order_events (order_id, event_type, title, detail, operator, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  ins.run(1, 'CREATED', '创建陪诊预约单', '通过微信小程序创建半天陪诊订单（L2轮椅协助），总价 ¥368', '张晓敏(家属)', '2026-11-12 08:50');
  ins.run(1, 'CONFIRMED', '完成患者本人确认(+)', '方式A：患者本人微信大字卡片一键确认授权并签署国标12+7知情同意书', '张建国(患者本人)', '2026-11-12 09:15');
  ins.run(1, 'DISPATCHED', '智能筛选并指派陪诊师', '指派给【李淑芬 · 北京康护之家(B端机构)】，撮合提成率 8% (¥29.44)', '平台调度中枢', '2026-11-12 09:20');
  ins.run(1, 'STEP_2', '第2步：已到达接手位置打卡', 'LBS核验朝阳区幸福一村3号楼2单元门口，已备好折叠轮椅完成接手核对', '李淑芬(陪诊师)', '2026-11-12 09:45');

  ins.run(2, 'CREATED', '创建陪诊预约单', '通过App客户端创建半天陪诊订单（L3无电梯上下楼背扶），总价 ¥438', '张晓敏(家属)', '2026-11-12 10:18');
  ins.run(2, 'CONFIRMED', '完成患者本人确认(+)', '方式B：同住家属在旁，患者同机手写签名授权', '陈秀英(患者本人)', '2026-11-12 10:20');
}

function upgradeExistingSeedData() {
  // Ensure 2nd family elder exists for multi-elder switching
  const pCount = db.prepare('SELECT COUNT(*) AS c FROM patients').get().c;
  if (pCount < 2) {
    db.prepare(`
      INSERT INTO patients (
        name, relation, age, gender, city, birthday, days_to_birthday, weather_alert,
        mobility_level, mobility_label, chronic_tags, authorized_family, address,
        care_streak, morning_checkin_date, evening_checkin_date
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      '陈秀英', '母亲', 82, '女', '北京', '12月03日', 21,
      '干燥降温提醒：今日室内外温差大，高龄骨质疏松长辈外出复诊请穿防滑软底鞋，备好保温杯。',
      'L3', 'L3 重度受限 · 无电梯上下楼背扶协助 (+¥150)',
      '重度骨质疏松, 右髋关节置换术后, 2型糖尿病',
      '张晓敏(女儿·主决策人), 张伟(儿子·异地协同)',
      '北京市西城区新街口北大街12号院4楼(无电梯)',
      9, '', ''
    );
  }

  // Ensure at least 7 diary entries for 7-day trend visualization
  const dCount = db.prepare('SELECT COUNT(*) AS c FROM health_diaries').get().c;
  if (dCount < 6) {
    db.exec('DELETE FROM health_diaries');
    seedSevenDayDiaries();
  }

  // Upgrade articles to 6 Xiaohongshu-style guide notes if still on 3 old articles
  const aCount = db.prepare('SELECT COUNT(*) AS c FROM articles').get().c;
  if (aCount < 6) {
    db.exec('DELETE FROM articles');
    seedCommunityArticles();
  }

  seedOrderEvents();
}

initDb();

module.exports = { db };
