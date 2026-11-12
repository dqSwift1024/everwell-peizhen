/* ==========================================================================
   健康来敲门 Everwell · 应用2：C端家庭照护独立移动应用增强脚本 (public/app/c-app.js)
   ========================================================================== */

async function refreshAppData() {
  const json = await apiRequest('/api/bootstrap');
  if (json) showToast('已同步最新陪诊订单与家庭照护进度');
}

function applyHashTab() {
  const raw = (window.location.hash || '').replace(/^#/, '').trim();
  if (['home', 'ai', 'book', 'post', 'care', 'mine'].includes(raw)) {
    switchCAppTab(raw);
  }
}

window.addEventListener('hashchange', applyHashTab);
window.addEventListener('DOMContentLoaded', () => {
  applyHashTab();
});
