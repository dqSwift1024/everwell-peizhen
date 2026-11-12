<template>
  <view class="home-page">
    <!-- 多长辈健康档案切换栏 -->
    <scroll-view scroll-x class="elder-row">
      <view
        v-for="pt in patients"
        :key="pt.id"
        class="elder-chip"
        :class="{ active: currentPatient && currentPatient.id === pt.id }"
        @click="selectElder(pt)"
      >
        {{ pt.relation }}·{{ pt.name }} ({{ pt.age }}岁·{{ pt.mobility_level }})
      </view>
    </scroll-view>

    <!-- 节气生日与早晚敲门打卡卡 -->
    <view v-if="currentPatient" class="care-hero">
      <view class="hero-top">
        <text>{{ currentPatient.city }} · 节气健康守护</text>
        <text class="streak-tag">已连续守护 {{ currentPatient.care_streak || 12 }} 天</text>
      </view>
      <view class="hero-title">
        距{{ currentPatient.relation }}{{ currentPatient.name }} {{ currentPatient.age }}岁生日（{{ currentPatient.birthday }}）还有 {{ currentPatient.days_to_birthday }} 天
      </view>
      <view class="hero-alert">{{ currentPatient.weather_alert }}</view>
      <view class="checkin-grid">
        <button class="slot-btn" @click="doCareCheckin('morning')">08:00 早安量压问候</button>
        <button class="slot-btn" @click="doCareCheckin('evening')">20:00 晚安平安确认</button>
      </view>
    </view>

    <!-- 主线预约与 AI 导诊快捷入口 -->
    <view class="card">
      <view class="card-head">
        <view>
          <text class="badge-orange">双证核验护工 · 轮椅推行</text>
          <view class="sec-title">为父母预约三甲医院专人陪诊</view>
        </view>
        <button class="btn-main" @click="goTab('/pages/booking/index')">立即预约</button>
      </view>
      <view class="quick-grid">
        <view class="q-item" @click="goBookingWith('L1')">L1 搀扶 +¥50</view>
        <view class="q-item mint" @click="goBookingWith('L2')">L2 轮椅 +¥80</view>
        <view class="q-item" @click="goBookingWith('L3')">L3 背扶 +¥150</view>
        <view class="q-item warn" @click="goPage('/pages/ai-triage/index')">AI 诊前导诊</view>
      </view>
    </view>

    <!-- 实时订单进度 -->
    <view class="sec-bar">家庭陪诊订单实时进度</view>
    <view v-for="ord in orders" :key="ord.id" class="card order-card">
      <view class="ord-head">
        <text class="ord-no">#{{ ord.order_no }}</text>
        <text class="ord-price">¥{{ ord.total_price }}</text>
      </view>
      <view class="ord-hosp">{{ ord.city }} · {{ ord.hospital_name }} · {{ ord.department }}</view>
      <view class="ord-meta">就诊人：{{ ord.patient_name }} ｜ {{ ord.visit_date }} ｜ {{ ord.mobility_level }}</view>
      <view class="ord-note">{{ ord.live_note }}</view>
      <view class="ord-actions">
        <button v-if="ord.payment_status === 'UNPAID' && ord.sop_step >= 0" class="btn-pay" @click="payOrder(ord)">去微信支付</button>
        <button v-if="ord.payment_status === 'PAID' && ord.patient_confirm_status !== 'CONFIRMED'" class="btn-pay" @click="goConfirm(ord.id)">患者确认(+)</button>
        <button class="btn-sub" @click="wakeupRide(ord)">唤醒滴滴/高德</button>
      </view>
    </view>

    <!-- 父母体检推荐与适老医疗险 -->
    <view class="card">
      <view class="sec-title">父母体检推荐 &amp; 适老保险严选</view>
      <view v-for="slot in commercialSlots" :key="slot.id" class="comm-row" @click="clickCommercial(slot)">
        <view>
          <text class="comm-tag">{{ slot.slot_type }}</text>
          <text class="comm-title">{{ slot.title }}</text>
        </view>
        <text class="ord-price">{{ slot.price_tag }}</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { requestApi, requireAuth } from '../../utils/request';
import { openRideHailing } from '../../utils/platform-bridge';

declare const uni: any;

const patients = ref<any[]>([]);
const currentPatient = ref<any>(null);
const orders = ref<any[]>([]);
const commercialSlots = ref<any[]>([]);

async function loadBootstrap() {
  const res = await requestApi<{ data: any }>({ url: '/api/bootstrap' });
  patients.value = res.data.patients || [];
  currentPatient.value = patients.value[0] || null;
  orders.value = (res.data.orders || []).slice(0, 5);
  commercialSlots.value = (res.data.commercialSlots || []).slice(0, 3);
}

onShow(() => {
  loadBootstrap();
});

function selectElder(pt: any) {
  currentPatient.value = pt;
  uni.setStorageSync('ew_selected_patient', pt);
}

async function doCareCheckin(period: 'morning' | 'evening') {
  if (!requireAuth('FAMILY') || !currentPatient.value) return;
  await requestApi({
    url: `/api/patients/${currentPatient.value.id}/care-checkin`,
    method: 'POST',
    data: { period }
  });
  await loadBootstrap();
  uni.showToast({ title: '关怀打卡成功', icon: 'success' });
}

function goTab(url: string) { uni.switchTab({ url }); }
function goPage(url: string) { uni.navigateTo({ url }); }
function goBookingWith(level: string) {
  uni.setStorageSync('ew_prefill_level', level);
  uni.switchTab({ url: '/pages/booking/index' });
}
function goConfirm(orderId: number) {
  uni.navigateTo({ url: `/pages/patient-confirm/index?orderId=${orderId}` });
}

async function payOrder(ord: any) {
  if (!requireAuth('FAMILY')) return;
  await requestApi({
    url: `/api/orders/${ord.id}/pay`,
    method: 'POST',
    data: { pay_channel: '微信小程序支付' }
  });
  uni.showToast({ title: '支付成功', icon: 'success' });
  await loadBootstrap();
}

function wakeupRide(ord: any) {
  openRideHailing('amap', {
    startName: ord.pickup_address,
    endName: ord.hospital_name,
    endLat: 39.9138,
    endLng: 116.4175
  });
}

async function clickCommercial(slot: any) {
  await requestApi({ url: `/api/commercial/${slot.id}/click`, method: 'POST' });
  uni.showToast({ title: `正在前往 ${slot.partner_name}`, icon: 'none' });
}
</script>

<style scoped>
.home-page { padding: 24rpx; }
.elder-row { white-space: nowrap; margin-bottom: 20rpx; }
.elder-chip { display: inline-block; padding: 10rpx 24rpx; margin-right: 12rpx; border-radius: 999rpx; background: #e6efe9; color: #075e50; font-size: 24rpx; }
.elder-chip.active { background: #075e50; color: #fff; font-weight: 700; }
.care-hero { background: linear-gradient(135deg, #0d2e28, #075e50); color: #fff; border-radius: 28rpx; padding: 28rpx; margin-bottom: 24rpx; }
.hero-top { display: flex; justify-content: space-between; font-size: 22rpx; opacity: 0.9; }
.streak-tag { background: #d77844; padding: 4rpx 14rpx; border-radius: 999rpx; }
.hero-title { font-size: 30rpx; font-weight: 800; margin-top: 12rpx; }
.hero-alert { font-size: 23rpx; opacity: 0.88; margin-top: 8rpx; }
.checkin-grid { display: flex; gap: 16rpx; margin-top: 20rpx; }
.slot-btn { flex: 1; font-size: 23rpx; background: rgba(255,255,255,0.16); color: #fff; border-radius: 16rpx; }
.card { background: #fff; border-radius: 24rpx; padding: 26rpx; border: 1px solid #e0e8e3; margin-bottom: 22rpx; }
.card-head { display: flex; justify-content: space-between; align-items: center; }
.badge-orange { font-size: 21rpx; color: #d77844; font-weight: 700; }
.sec-title { font-size: 30rpx; font-weight: 800; color: #162a26; margin-top: 6rpx; }
.btn-main { background: #075e50; color: #fff; font-size: 24rpx; border-radius: 16rpx; padding: 0 26rpx; }
.quick-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12rpx; margin-top: 20rpx; }
.q-item { background: #faf9f5; padding: 16rpx 8rpx; border-radius: 14rpx; text-align: center; font-size: 22rpx; font-weight: 700; }
.q-item.mint { background: #e8f5ef; color: #075e50; }
.q-item.warn { background: #fdf0e7; color: #d77844; }
.sec-bar { font-size: 26rpx; font-weight: 800; color: #075e50; margin-bottom: 14rpx; }
.ord-head { display: flex; justify-content: space-between; font-weight: 800; font-size: 28rpx; }
.ord-price { color: #d77844; font-weight: 800; }
.ord-hosp { font-weight: 700; font-size: 27rpx; margin-top: 8rpx; }
.ord-meta { font-size: 23rpx; color: #5b6e68; margin-top: 6rpx; }
.ord-note { background: #faf9f5; padding: 14rpx; border-radius: 12rpx; font-size: 23rpx; margin-top: 12rpx; }
.ord-actions { display: flex; gap: 14rpx; margin-top: 16rpx; }
.btn-pay { background: #d77844; color: #fff; font-size: 23rpx; border-radius: 14rpx; }
.btn-sub { background: #eef4fb; color: #1e5aa8; font-size: 23rpx; border-radius: 14rpx; }
.comm-row { display: flex; justify-content: space-between; padding: 18rpx 0; border-bottom: 1px solid #eef2ef; font-size: 25rpx; }
.comm-tag { background: #e8f5ef; color: #075e50; padding: 4rpx 12rpx; border-radius: 8rpx; font-size: 21rpx; margin-right: 10rpx; }
</style>
