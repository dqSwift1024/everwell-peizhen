<template>
  <view class="book-page">
    <view class="card">
      <view class="sec-title">1. 就诊长辈与目标医院</view>
      <input v-model="patientName" class="inp" placeholder="就诊长辈姓名与年龄" />
      <input v-model="contactPhone" type="number" maxlength="11" class="inp" placeholder="11位联系手机号" />
      <picker :range="hospitals" :value="hospIdx" @change="onHospChange">
        <view class="inp">目标医院：{{ hospitals[hospIdx] }}</view>
      </picker>
      <input v-model="department" class="inp" placeholder="门诊挂号科室" />
      <picker mode="date" :value="visitDate" @change="onDateChange">
        <view class="inp">期望就诊日期：{{ visitDate }}</view>
      </picker>
    </view>

    <view class="card">
      <view class="sec-title">2. 时长套餐与失能分级护理</view>
      <picker :range="pkgLabels" :value="pkgIdx" @change="(e: any) => pkgIdx = Number(e.detail.value)">
        <view class="inp">时长套餐：{{ pkgLabels[pkgIdx] }}</view>
      </picker>
      <picker :range="mobLabels" :value="mobIdx" @change="(e: any) => mobIdx = Number(e.detail.value)">
        <view class="inp">失能分级：{{ mobLabels[mobIdx] }}</view>
      </picker>
    </view>

    <view class="card">
      <view class="sec-title">3. 接送交接位置与助老打车衔接</view>
      <input v-model="pickupAddress" class="inp" placeholder="上门接手详细地址" />
      <input v-model="dropoffAddress" class="inp" placeholder="结束送回交接地址" />
    </view>

    <view class="pay-bar">
      <view>
        <view class="sub">透明计费总额</view>
        <view class="total">¥{{ totalPrice }}</view>
      </view>
      <button class="btn-submit" @click="submitOrder">提交并调起支付 →</button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { requestApi, requireAuth } from '../../utils/request';

declare const uni: any;

const hospitals = ['北京协和医院(东单院区)', '北京积水潭医院(新街口院区)', '四川大学华西医院(本院)'];
const hospIdx = ref(0);
const patientName = ref('张建国 (78岁)');
const contactPhone = ref('13800138000');
const department = ref('心内科门诊');
const visitDate = ref('2026-11-18');
const pickupAddress = ref('北京市朝阳区幸福一村3号楼2单元301');
const dropoffAddress = ref('就诊结束后安全送回原址家中交接');

const pkgs = [
  { price: 288, name: '半天陪诊 (4小时标准服务)' },
  { price: 498, name: '全天陪诊 (8小时深度陪同)' }
];
const pkgLabels = pkgs.map(p => `${p.name} ¥${p.price}`);
const pkgIdx = ref(0);

const mobs = [
  { fee: 0, label: 'L0 患者基本自理' },
  { fee: 50, label: 'L1 需全程搀扶看护' },
  { fee: 80, label: 'L2 需轮椅代借与推行' },
  { fee: 150, label: 'L3 无电梯上下楼背扶' }
];
const mobLabels = mobs.map(m => `${m.label} (+¥${m.fee})`);
const mobIdx = ref(2);

const totalPrice = computed(() => pkgs[pkgIdx.value].price + mobs[mobIdx.value].fee);

onShow(() => {
  const ai = uni.getStorageSync('ew_ai_prefill');
  if (ai) {
    const hi = hospitals.findIndex(h => h === ai.recommendedHospital);
    if (hi >= 0) hospIdx.value = hi;
    department.value = String(ai.recommendedDept || '').split('/')[0].trim();
    uni.removeStorageSync('ew_ai_prefill');
  }
});

function onHospChange(e: any) { hospIdx.value = Number(e.detail.value); }
function onDateChange(e: any) { visitDate.value = e.detail.value; }

async function submitOrder() {
  if (!requireAuth('FAMILY')) return;
  const created = await requestApi<{ order: any }>({
    url: '/api/orders',
    method: 'POST',
    data: {
      source_channel: '微信小程序/App',
      patient_name: patientName.value,
      contact_phone: contactPhone.value,
      hospital_name: hospitals[hospIdx.value],
      department: department.value,
      visit_date: visitDate.value,
      package_name: pkgs[pkgIdx.value].name,
      base_price: pkgs[pkgIdx.value].price,
      mobility_level: mobs[mobIdx.value].label,
      mobility_fee: mobs[mobIdx.value].fee,
      pickup_address: pickupAddress.value,
      dropoff_address: dropoffAddress.value,
      require_cashier: true
    }
  });

  // 确认收银台支付并跳转患者本人知情确认页
  await requestApi({
    url: `/api/orders/${created.order.id}/pay`,
    method: 'POST',
    data: { pay_channel: '微信支付' }
  });
  uni.navigateTo({ url: `/pages/patient-confirm/index?orderId=${created.order.id}` });
}
</script>

<style scoped>
.book-page { padding: 24rpx; }
.card { background: #fff; border-radius: 24rpx; padding: 26rpx; border: 1px solid #e0e8e3; margin-bottom: 22rpx; }
.sec-title { font-size: 28rpx; font-weight: 800; color: #075e50; margin-bottom: 16rpx; }
.inp { background: #faf9f5; border: 1px solid #d4ded9; border-radius: 14rpx; padding: 18rpx 20rpx; font-size: 26rpx; margin-bottom: 14rpx; }
.pay-bar { background: #fff; border: 2px solid #075e50; border-radius: 24rpx; padding: 22rpx 26rpx; display: flex; justify-content: space-between; align-items: center; }
.sub { font-size: 22rpx; color: #697b75; }
.total { font-size: 40rpx; font-weight: 800; color: #d77844; }
.btn-submit { background: #075e50; color: #fff; font-size: 27rpx; font-weight: 700; border-radius: 16rpx; padding: 0 32rpx; }
</style>
