<script setup lang="ts">
import { onLaunch } from '@dcloudio/uni-app';
import { requestApi, clearAuthSession } from './utils/request';

onLaunch(async () => {
  // 严格遵循微信与 App Store「先逛后登（Lazy Login）」规范：启动绝不强制拦截跳登录页
  const token = uni.getStorageSync('ew_mobile_token');
  if (!token) return;
  try {
    const res = await requestApi<{ authenticated: boolean; user?: Record<string, unknown> }>({
      url: '/api/auth/me',
      method: 'GET',
      silent: true
    });
    if (!res.authenticated) {
      clearAuthSession();
    } else if (res.user) {
      uni.setStorageSync('ew_mobile_user', res.user);
    }
  } catch (_) {
    // 离线弱网保留本地浏览缓存
  }
});
</script>

<style>
page {
  background-color: #faf9f5;
  color: #162a26;
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif;
}
</style>
