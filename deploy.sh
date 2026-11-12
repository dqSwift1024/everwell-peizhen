#!/usr/bin/env bash
set -e

SERVER_IP="${1:-103.119.1.142}"
SSH_PORT="${2:-5026}"
SSH_USER="${3:-root}"
REMOTE_DIR="/opt/everwell-peizhen"
APP_PORT="3080"

echo "========================================================"
echo "🚀 开始部署【健康来敲门 Everwell】至 ${SSH_USER}@${SERVER_IP}:${SSH_PORT}"
echo "========================================================"

# 1. 本地打包项目源码
cd "$(dirname "$0")"
TAR_FILE="/tmp/everwell-peizhen-deploy.tar.gz"
tar --exclude='.git' --exclude='node_modules' --exclude='data' -czf "$TAR_FILE" .
echo "✅ 1. 本地源码打包完成: $TAR_FILE"

# 2. 上传代码包至目标服务器
echo "📤 2. 正在上传代码包至服务器 ${SERVER_IP}:${SSH_PORT} ..."
scp -P "$SSH_PORT" -o StrictHostKeyChecking=accept-new "$TAR_FILE" "${SSH_USER}@${SERVER_IP}:/tmp/everwell-peizhen-deploy.tar.gz"

# 3. 远端解压、环境检查、配置 systemd 常驻守护服务并启动
echo "⚙️  3. 正在远端服务器配置环境与 systemd 守护服务..."
ssh -p "$SSH_PORT" "${SSH_USER}@${SERVER_IP}" "bash -s" <<EOF
set -e
mkdir -p ${REMOTE_DIR}
tar -xzf /tmp/everwell-peizhen-deploy.tar.gz -C ${REMOTE_DIR}
rm -f /tmp/everwell-peizhen-deploy.tar.gz

# 检查 Node.js 版本 (需 >= 22.5 支持内置 node:sqlite)
if ! command -v node >/dev/null 2>&1 || [ "\$(node -v | cut -d. -f1 | tr -d 'v')" -lt 22 ]; then
  echo "⏳ 正在安装 Node.js v22 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - 2>/dev/null || curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
  (apt-get install -y nodejs 2>/dev/null || yum install -y nodejs || dnf install -y nodejs)
fi

NODE_BIN=\$(command -v node)
echo "✅ 远端 Node 版本: \$(\$NODE_BIN -v) (\$NODE_BIN)"

# 写入 systemd 守护进程配置
cat > /etc/systemd/system/everwell-peizhen.service <<SERVICE
[Unit]
Description=Everwell Medical Escort Platform Full-Stack Server
After=network.target

[Service]
Type=simple
WorkingDirectory=${REMOTE_DIR}
Environment=PORT=${APP_PORT}
Environment=NODE_ENV=production
ExecStart=\${NODE_BIN} --no-warnings ${REMOTE_DIR}/server/index.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable everwell-peizhen.service
systemctl restart everwell-peizhen.service

# 放行防火墙端口 (若启用了 firewalld 或 ufw)
if command -v firewall-cmd >/dev/null 2>&1 && systemctl is-active --quiet firewalld; then
  firewall-cmd --permanent --add-port=${APP_PORT}/tcp >/dev/null 2>&1 || true
  firewall-cmd --reload >/dev/null 2>&1 || true
fi
if command -v ufw >/dev/null 2>&1; then
  ufw allow ${APP_PORT}/tcp >/dev/null 2>&1 || true
fi

sleep 1
systemctl status everwell-peizhen.service --no-pager | head -n 12
echo ""
echo "🎉 部署成功！公网访问地址: http://${SERVER_IP}:${APP_PORT}"
EOF
