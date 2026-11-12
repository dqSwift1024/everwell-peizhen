<template>
  <view class="confirm-page">
    <view class="header-box">
      <view class="badge">国家标准 GB/T 47801—2026 核心要求</view>
      <view class="title">请选择患者本人知情确认与报告共享方式</view>
    </view>

    <view class="opt-card mint" @click="chooseMethod('方式A：转发微信无障碍大字卡片，父母一键点击同意授权')">
      <view class="opt-title">方式 A：转发微信大字确认卡给父母一键点确认（异地子女首选）</view>
      <view class="opt-desc">无需长辈打字或下载 App，微信内点击一次绿色大按钮即完成留痕。</view>
    </view>

    <view class="opt-card" @click="chooseMethod('方式B：同住家属在旁，患者已完成同机当面知情确认')">
      <view class="opt-title">方式 B：同住身边 · 患者当面同机知情确认</view>
      <view class="opt-desc">适合子女在长辈身旁协助操作手机，当面确认服务边界。</view>
    </view>

    <view class="opt-card" @click="chooseMethod('方式C：高龄重度失能豁免手机操作 · 由陪诊师第2步上门现场核验')">
      <view class="opt-title">方式 C：重度失能豁免 · 持证陪诊师上门接手现场补核验</view>
      <view class="opt-desc">不阻塞紧急派单，由陪诊师到达接手位置后当面核验患者状态。</view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { requestApi } from '../../utils/request';

declare const uni: any;
const orderId = ref<number>(1);

onLoad((q: any) => {
  if (q && q.orderId) orderId.value = Number(q.orderId);
});

async function chooseMethod(method: string) {
  await requestApi({
    url: `/api/orders/${orderId.value}/confirm-patient`,
    method: 'POST',
    data: { method }
  });
  uni.showToast({ title: '患者知情授权已完成', icon: 'success' });
  setTimeout(() => {
    uni.switchTab({ url: '/pages/index/index' });
  }, 500);
}
</script>

<style scoped>
.confirm-page { padding: 26rpx; }
.header-box { margin-bottom: 24rpx; }
.badge { font-size: 22rpx; color: #075e50; font-weight: 700; }
.title { font-size: 34rpx; font-weight: 800; margin-top: 8rpx; }
.opt-card { background: #fff; border: 1px solid #d5e0da; border-radius: 22rpx; padding: 28rpx; margin-bottom: 20rpx; }
.opt-card.mint { background: #e8f5ef; border-color: #9fd0b9; }
.opt-title { font-size: 28rpx; font-weight: 800; color: #075e50; }
.opt-desc { font-size: 24rpx; color: #566963; margin-top: 10rpx; line-height: 1.5; }
</style>
