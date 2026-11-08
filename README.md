# 健康来敲门 Everwell · 陪诊服务平台全栈系统

本工程严格依据 **《健康来敲门 Everwell · 商业计划书 V9.1》** 与 **《社会化陪同就医服务基本要求》（GB/T 47801—2026）** 国家标准研发，完整实现 **Web 品牌官网端、小程序/App（C端家庭模式与陪诊师接单双模式）、平台总控与B端合作机构 RBAC 管理后台** 四端实时协同及 **15项 `+` 必做功能**。

---

## 一、 工程目录结构

```text
/Users/SEI/.gemini/antigravity/scratch/everwell-peizhen/
├── package.json                       # 项目配置与启动脚本
├── data/
│   └── everwell.sqlite                # SQLite 关系型持久化数据库文件 (自动初始化与种子数据)
├── server/
│   ├── db.js                          # 数据库 Schema 定义 (11张核心表) 与初始业务数据种子
│   ├── index.js                       # Node.js 全功能 RESTful API 服务与静态资源网关
│   └── test-e2e.js                    # 端到端全链路自动化验收测试脚本 (覆盖15项+核心闭环)
├── public/
│   ├── index.html                     # 四端合一全栈实时联调工作台视图 (Web官网 / 小程序·App C端 / 陪诊师接单端 / 管理后台)
│   └── app.js                         # 前端状态同步、计费计算器、5步SOP打卡与后台RBAC交互逻辑
└── uniapp-mobile-src/                 # 小程序与 iOS/Android App 跨端编译源码配置 (Uni-app Vue3 + TS)
    ├── manifest.json                  # App URL Scheme (滴滴/高德唤醒) 与微信小程序跳转白名单配置
    ├── pages.json                     # 移动端路由与导航栏主题配置
    └── utils/
        └── platform-bridge.ts         # 条件编译 (#ifdef MP-WEIXIN / #ifdef APP-PLUS) 原生能力桥接层
```

---

## 二、 快速启动与运行

1. **启动全栈服务**：
   ```bash
   cd /Users/SEI/.gemini/antigravity/scratch/everwell-peizhen
   npm start
   ```
   服务默认运行在：`http://localhost:3080`

2. **运行端到端自动化验收测试**：
   ```bash
   npm test
   ```
