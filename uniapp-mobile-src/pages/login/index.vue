<template>
  <view class="login-page">
    <view class="brand-card">
      <text class="role-badge">{{ targetRole === 'ESCORT' ? '持证陪诊师准入核验' : '家庭照护实名安全登录' }}</text>
      <view class="title">欢迎来到健康来敲门</view>
      <view class="subtitle">同步家庭长辈健康档案、医疗陪诊订单进度与加密医嘱报告</view>
    </view>

    <!-- 微信小程序端：官方手机号快捷授权组件 -->
    <!-- #ifdef MP-WEIXIN -->
    <view class="section-card">
      <button
        class="btn-wx"
        :open-type="agreedPrivacy ? 'getPhoneNumber' : ''"
        @click="checkAgreementBeforeQuick"
        @getphonenumber="onWechatGetPhoneNumber"
      >
        微信绑定手机号一键安全登录
      </button>
    </view>
    <!-- #endif -->

    <!-- iOS / Android App 端：本机运营商一键登录 + Apple 登录 (App Store 审核必配) -->
    <!-- #ifdef APP-PLUS -->
    <view class="section-card">
      <button class="btn-wx" @click="handleAppOneTapLogin">本机号码一键快捷登录</button>
      <button v-if="isIos" class="btn-apple" @click="handleAppleSignIn">通过 Apple 登录</button>
    </view>
    <!-- #endif -->

    <!-- 全端通用兜底：11位手机号 + 6位短信验证码登录 -->
    <view class="section-card">
      <view class="label">手机号短信验证码登录 / 注册</view>
      <input v-model="phone" type="number" maxlength="11" class="inp" placeholder="请输入11位中国大陆手机号" />
      <view class="sms-row">
        <input v-model="code" type="number" maxlength="6" class="inp flex-1" placeholder="请输入6位验证码" />
        <button class="btn-code" :disabled="countdown > 0" @click="handleSendCode">
          {{ countdown > 0 ? `${countdown}s后重发` : '获取验证码' }}
        </button>
      </view>
      <button class="btn-submit" @click="handleSmsLogin">立即验证登录</button>
    </view>

    <!-- 工信部与 App Store 强制合规：默认绝对不勾选，需用户主动勾选 -->
    <view class="privacy-row" @click="agreedPrivacy = !agreedPrivacy">
      <checkbox :checked="agreedPrivacy" color="#075e50" />
      <text class="privacy-text">
        我已阅读并同意《健康来敲门用户服务协议》与《医疗健康敏感个人信息保护政策》，未注册手机号验证通过后自动创建账号。
      </text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { requestApi } from '../../utils/request';

declare const uni: any;

const targetRole = ref<'FAMILY' | 'ESCORT'>('FAMILY');
const phone = ref('13800138000');
const code = ref('');
const agreedPrivacy = ref(false); // 严禁默认勾选
const countdown = ref(0);
const isIos = uni.getSystemInfoSync().platform === 'ios';

onLoad((query: any) => {
  if (query && query.role === 'ESCORT') {
    targetRole.value = 'ESCORT';
    phone.value = '13811223344';
  }
});

function checkAgreementBeforeQuick() {
  if (!agreedPrivacy.value) {
    uni.showToast({ title: '请先阅读并勾选底部隐私协议', icon: 'none' });
  }
}

async function handleSendCode() {
  if (!/^1[3-9]\d{9}$/.test(phone.value)) {
    uni.showToast({ title: '请输入有效的11位手机号', icon: 'none' });
    return;
  }
  const res = await requestApi<{ demo_code?: string; msg: string }>({
    url: '/api/auth/send-code',
    method: 'POST',
    data: { phone: phone.value }
  });
  if (res.demo_code) code.value = res.demo_code;
  uni.showToast({ title: '验证码已发送', icon: 'none' });
  countdown.value = 60;
  const timer = setInterval(() => {
    countdown.value -= 1;
    if (countdown.value <= 0) clearInterval(timer);
  }, 1000);
}

async function completeLogin(payload: Record<string, unknown>) {
  const res = await requestApi<{ token: string; user: Record<string, unknown> }>({
    url: '/api/auth/mobile-login',
    method: 'POST',
    data: payload
  });
  uni.setStorageSync('ew_mobile_token', res.token);
  uni.setStorageSync('ew_mobile_user', res.user);
  uni.showToast({ title: '登录成功', icon: 'success' });
  setTimeout(() => {
    uni.navigateBack({ fail: () => uni.switchTab({ url: '/pages/index/index' }) });
  }, 400);
}

async function onWechatGetPhoneNumber(e: any) {
  if (!agreedPrivacy.value) return;
  if (!e.detail || !e.detail.code) {
    uni.showToast({ title: '您取消了手机号授权，可使用短信验证码登录', icon: 'none' });
    return;
  }
  await completeLogin({
    mode: 'wechat_quick',
    wx_phone_code: e.detail.code,
    phone: phone.value,
    agreed_privacy: true,
    target_role: targetRole.value
  });
}

async function handleAppOneTapLogin() {
  if (!agreedPrivacy.value) {
    checkAgreementBeforeQuick();
    return;
  }
  uni.login({
    provider: 'univerify',
    success: async () => {
      await completeLogin({
        mode: 'wechat_quick',
        phone: phone.value,
        agreed_privacy: true,
        target_role: targetRole.value
      });
    },
    fail: () => {
      uni.showToast({ title: '请使用下方短信验证码登录', icon: 'none' });
    }
  });
}

async function handleAppleSignIn() {
  if (!agreedPrivacy.value) {
    checkAgreementBeforeQuick();
    return;
  }
  uni.login({
    provider: 'apple',
    success: async () => {
      await completeLogin({
        mode: 'wechat_quick',
        phone: phone.value,
        agreed_privacy: true,
        target_role: 'FAMILY'
      });
    }
  });
}

async function handleSmsLogin() {
  if (!agreedPrivacy.value) {
    checkAgreementBeforeQuick();
    return;
  }
  await completeLogin({
    mode: 'sms',
    phone: phone.value,
    code: code.value,
    agreed_privacy: true,
    target_role: targetRole.value
  });
}
</script>

<style scoped>
.login-page { padding: 28rpx; }
.brand-card { background: #075e50; color: #fff; border-radius: 28rpx; padding: 36rpx; margin-bottom: 24rpx; }
.role-badge { font-size: 22rpx; background: rgba(255,255,255,0.2); padding: 6rpx 16rpx; border-radius: 999rpx; }
.title { font-size: 40rpx; font-weight: 800; margin-top: 16rpx; }
.subtitle { font-size: 24rpx; opacity: 0.86; margin-top: 8rpx; }
.section-card { background: #fff; border-radius: 24rpx; padding: 28rpx; margin-bottom: 24rpx; border: 1px solid #e1e8e4; }
.label { font-size: 26rpx; font-weight: 700; margin-bottom: 16rpx; color: #075e50; }
.inp { background: #faf9f5; border: 1px solid #d4ded9; border-radius: 16rpx; padding: 20rpx; font-size: 28rpx; margin-bottom: 16rpx; }
.sms-row { display: flex; gap: 16rpx; align-items: center; }
.flex-1 { flex: 1; }
.btn-wx { background: #075e50; color: #fff; border-radius: 18rpx; font-size: 28rpx; font-weight: 700; }
.btn-apple { background: #111; color: #fff; border-radius: 18rpx; font-size: 28rpx; margin-top: 16rpx; }
.btn-code { font-size: 24rpx; background: #edf5f1; color: #075e50; border-radius: 16rpx; padding: 0 24rpx; height: 80rpx; line-height: 80rpx; }
.btn-submit { background: #d77844; color: #fff; border-radius: 18rpx; font-size: 28rpx; font-weight: 700; margin-top: 8rpx; }
.privacy-row { display: flex; align-items: flex-start; gap: 12rpx; padding: 12rpx 6rpx; }
.privacy-text { font-size: 23rpx; color: #5b6d67; line-height: 1.5; }
</style>
