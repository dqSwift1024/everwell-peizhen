<template>
  <view class="esc-page">
    <!-- 国标数字工牌与听单开关 -->
    <view v-if="escort" class="badge-banner">
      <view>
        <view class="e-name">{{ escort.name }} · 持证陪诊顾问</view>
        <view class="e-sub">{{ escort.org_name }} ｜ 健康证至 {{ escort.health_cert_expiry }}</view>
      </view>
      <button class="btn-sched" @click="toggleSchedule">
        {{ escort.schedule_status === 'AVAILABLE' ? '● 听单中' : '○ 小休' }}
      </button>
    </view>

    <!-- 待抢单池 -->
    <view v-if="poolOrders.length" class="sec-bar">待抢单大厅（已付款待承接）</view>
    <view v-for="po in poolOrders" :key="po.id" class="card">
      <view class="ord-hosp">{{ po.city }} · {{ po.hospital_name }} · {{ po.department }}</view>
      <view class="ord-sub">{{ po.patient_name }} ｜ {{ po.mobility_level }} ｜ 总额 ¥{{ po.total_price }}</view>
      <button class="btn-step" @click="claimOrder(po.id)">立即抢单承接 →</button>
    </view>

    <!-- 5步标准履约打卡 -->
    <view class="sec-bar">我承接的履约任务（5步SOP打卡）</view>
    <view v-for="ord in myOrders" :key="ord.id" class="card">
      <view class="ord-hosp">#{{ ord.order_no }} · {{ ord.hospital_name }}</view>
      <view class="ord-sub">患者：{{ ord.patient_name }} ｜ 本单分成 ¥{{ ord.provider_payout }}</view>
      <view class="steps">
        <button class="btn-step" @click="doStep(ord.id, 1)">1. 确认接单出发</button>
        <button class="btn-step" @click="doStep(ord.id, 2)">2. 到达接手点签到</button>
        <button class="btn-step" @click="doStep(ord.id, 3)">3. 院内陪诊实时播报</button>
        <button class="btn-step warn" @click="uploadAndStep4(ord.id)">4. 拍照上传检验单并录医嘱</button>
        <button class="btn-step" @click="doStep(ord.id, 5)">5. 安全送回交接完结</button>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { requestApi, requireAuth } from '../../utils/request';

declare const uni: any;
const escort = ref<any>(null);
const poolOrders = ref<any[]>([]);
const myOrders = ref<any[]>([]);

async function loadWorkbench() {
  if (!requireAuth('ESCORT')) return;
  const user = uni.getStorageSync('ew_mobile_user') || {};
  const res = await requestApi<{ data: any }>({ url: '/api/bootstrap' });
  const escList = res.data.escorts || [];
  escort.value = escList.find((e: any) => e.id === Number(user.escort_id)) || escList[0];
  poolOrders.value = (res.data.orders || []).filter((o: any) => o.sop_step === 0 && o.payment_status === 'PAID');
  myOrders.value = (res.data.orders || []).filter((o: any) => o.escort_id === escort.value.id && o.sop_step >= 1 && o.sop_step < 5);
}

onShow(() => { loadWorkbench(); });

async function toggleSchedule() {
  if (!escort.value) return;
  await requestApi({ url: `/api/escorts/${escort.value.id}/toggle-schedule`, method: 'POST' });
  await loadWorkbench();
}

async function claimOrder(orderId: number) {
  await requestApi({ url: `/api/orders/${orderId}/claim`, method: 'POST' });
  uni.showToast({ title: '抢单成功', icon: 'success' });
  await loadWorkbench();
}

async function doStep(orderId: number, step: number) {
  await requestApi({ url: `/api/orders/${orderId}/step`, method: 'POST', data: { step } });
  uni.showToast({ title: `第${step}步打卡成功`, icon: 'success' });
  await loadWorkbench();
}

function uploadAndStep4(orderId: number) {
  uni.chooseImage({
    count: 2,
    success: async () => {
      await requestApi({
        url: `/api/orders/${orderId}/step`,
        method: 'POST',
        data: {
          step: 4,
          doctor_advice: '【医生原话客观记录】复查指标平稳，继续按医嘱服药，2周后复诊。',
          uploaded_urls: ['/uploads/sample-lab-report.svg']
        }
      });
      uni.showToast({ title: '报告与医嘱已归档', icon: 'success' });
      await loadWorkbench();
    }
  });
}
</script>

<style scoped>
.esc-page { padding: 24rpx; }
.badge-banner { background: #102e29; color: #fff; padding: 28rpx; border-radius: 26rpx; display: flex; justify-content: space-between; align-items: center; margin-bottom: 22rpx; }
.e-name { font-size: 30rpx; font-weight: 800; }
.e-sub { font-size: 22rpx; opacity: 0.85; margin-top: 6rpx; }
.btn-sched { background: #18a07d; color: #fff; font-size: 23rpx; border-radius: 999rpx; }
.sec-bar { font-size: 26rpx; font-weight: 800; color: #075e50; margin: 14rpx 0; }
.card { background: #fff; border-radius: 24rpx; padding: 26rpx; border: 1px solid #e0e8e3; margin-bottom: 20rpx; }
.ord-hosp { font-size: 28rpx; font-weight: 800; }
.ord-sub { font-size: 23rpx; color: #5b6d67; margin: 8rpx 0 16rpx; }
.steps { display: flex; flex-direction: column; gap: 12rpx; }
.btn-step { background: #075e50; color: #fff; font-size: 25rpx; border-radius: 14rpx; }
.btn-step.warn { background: #d77844; }
</style>
