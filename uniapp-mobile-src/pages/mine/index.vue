<template>
  <view class="mine-page">
    <!-- 顶部账户卡片：支持游客态与已登录实名态 -->
    <view class="profile-card">
      <view v-if="user">
        <view class="name">{{ user.display_name }}</view>
        <view class="meta">绑定手机：{{ user.masked_phone }} ｜ 身份：{{ user.role === 'ESCORT' ? '持证陪诊师' : '家庭主照护人' }}</view>
      </view>
      <view v-else>
        <view class="name">未登录 · 游客浏览模式</view>
        <view class="meta">支持先浏览医院价格与攻略，下单时按需安全登录</view>
      </view>
      <button v-if="!user" class="btn-login" @click="goLogin('FAMILY')">一键登录</button>
    </view>

    <!-- 业务与家庭管理菜单 -->
    <view class="menu-group">
      <view class="menu-item" @click="goEscortWorkbench">
        <text>切换至「持证陪诊师接单工作台」</text>
        <text class="arrow">认证准入 →</text>
      </view>
      <view class="menu-item" @click="callEmergency">
        <text class="danger">突发医疗状况求助 (120急救 / 7×24h平台值班专线)</text>
        <text class="danger">直呼 →</text>
      </view>
    </view>

    <!-- 审核必备：用户协议、医疗隐私政策、退出与永久注销账号 -->
    <view class="menu-group">
      <view class="menu-item" @click="showAgreement('user')">
        <text>《健康来敲门用户服务协议》</text><text class="arrow">查阅 →</text>
      </view>
      <view class="menu-item" @click="showAgreement('privacy')">
        <text>《医疗健康敏感个人信息保护政策》</text><text class="arrow">查阅 →</text>
      </view>
      <view class="menu-item" @click="showAgreement('gb')">
        <text>《GB/T 47801—2026 陪诊12准做7严禁边界》</text><text class="arrow">查阅 →</text>
      </view>
    </view>

    <view v-if="user" class="auth-actions">
      <button class="btn-logout" @click="handleLogout">退出当前登录</button>
      <button class="btn-delete" @click="handleDeleteAccount">永久注销账号并清理个人数据</button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { requestApi, clearAuthSession, requireAuth } from '../../utils/request';

declare const uni: any;
const user = ref<any>(null);

onShow(() => {
  user.value = uni.getStorageSync('ew_mobile_user') || null;
});

function goLogin(role: 'FAMILY' | 'ESCORT') {
  uni.navigateTo({ url: `/pages/login/index?role=${role}` });
}

function goEscortWorkbench() {
  if (requireAuth('ESCORT')) {
    uni.navigateTo({ url: '/pages/escort-workbench/index' });
  }
}

function callEmergency() {
  uni.showActionSheet({
    itemList: ['拨打 120 急救中心', '拨打平台 24h 应急值班长 400-890-2026'],
    success: (res: any) => {
      uni.makePhoneCall({ phoneNumber: res.tapIndex === 0 ? '120' : '4008902026' });
    }
  });
}

function showAgreement(type: string) {
  const content = type === 'privacy'
    ? '我们严格遵守《个人信息保护法》，医疗检验报告与医嘱仅对授权家庭成员加密展示，绝不用于第三方商业营销。'
    : '本平台严格执行国家标准《GB/T 47801—2026》，仅提供非医疗性质就医陪同、轮椅推行与医生原话客观记录。';
  uni.showModal({ title: '平台合规法律声明', content, showCancel: false });
}

async function handleLogout() {
  await requestApi({ url: '/api/auth/logout', method: 'POST', silent: true }).catch(() => {});
  clearAuthSession();
  user.value = null;
  uni.showToast({ title: '已安全退出登录', icon: 'none' });
}

function handleDeleteAccount() {
  uni.showModal({
    title: '确认永久注销账号？',
    content: '注销后将立即销毁您的全部登录凭证并脱敏清理个人身份数据（符合 App Store 与工信部合规要求）。',
    confirmColor: '#c53939',
    success: async (res: any) => {
      if (!res.confirm) return;
      await requestApi({ url: '/api/auth/delete-account', method: 'POST' });
      clearAuthSession();
      user.value = null;
      uni.showToast({ title: '账号已完成永久注销', icon: 'none' });
    }
  });
}
</script>

<style scoped>
.mine-page { padding: 24rpx; }
.profile-card { background: linear-gradient(135deg, #0d2b26, #075e50); color: #fff; border-radius: 28rpx; padding: 34rpx; display: flex; justify-content: space-between; align-items: center; margin-bottom: 24rpx; }
.name { font-size: 34rpx; font-weight: 800; }
.meta { font-size: 22rpx; opacity: 0.85; margin-top: 8rpx; }
.btn-login { background: #d77844; color: #fff; font-size: 24rpx; border-radius: 999rpx; padding: 8rpx 26rpx; }
.menu-group { background: #fff; border-radius: 24rpx; border: 1px solid #e1e8e4; margin-bottom: 24rpx; overflow: hidden; }
.menu-item { display: flex; justify-content: space-between; padding: 28rpx; border-bottom: 1px solid #eff3f0; font-size: 27rpx; font-weight: 600; }
.arrow { color: #71837d; font-size: 24rpx; }
.danger { color: #c53939; }
.auth-actions { display: flex; flex-direction: column; gap: 16rpx; }
.btn-logout { background: #f2f5f3; color: #2b3e39; font-size: 27rpx; border-radius: 18rpx; }
.btn-delete { background: #fff5f5; color: #c53939; border: 1px solid #f5caca; font-size: 26rpx; border-radius: 18rpx; }
</style>
