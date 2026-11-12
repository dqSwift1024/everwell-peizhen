<template>
  <view class="post-page">
    <!-- 医嘱执行每日服药打卡 + 购药入口 -->
    <view class="card">
      <view class="head-row">
        <text class="sec-title">医嘱执行服药打卡 (+)</text>
        <button class="btn-drug" @click="goPharmacy">京东健康购药 →</button>
      </view>
      <view v-for="m in medications" :key="m.id" class="med-row" @click="toggleMed(m)">
        <view>
          <view class="med-name">{{ m.drug_name }}（{{ m.patient_name }}）</view>
          <view class="med-sub">{{ m.frequency }} · {{ m.dosage }}</view>
        </view>
        <checkbox :checked="m.checked_today === 1" color="#075e50" />
      </view>
    </view>

    <!-- 诊后结果分享报告 + 实拍检验单预览 + 复检提醒 + 理赔包 -->
    <view v-for="rep in reports" :key="rep.id" class="card">
      <view class="head-row">
        <text class="sec-title">结果分享报告 · {{ rep.visit_date }}</text>
        <text class="esc-tag">陪诊员：{{ rep.escort_name }}</text>
      </view>
      <view class="hosp">{{ rep.hospital_dept }}</view>
      <view class="advice">{{ rep.doctor_advice }}</view>

      <view v-if="rep.report_images && rep.report_images.length" class="img-row">
        <image
          v-for="(img, idx) in rep.report_images"
          :key="idx"
          :src="fullUrl(img)"
          mode="aspectFill"
          class="thumb"
          @click="previewSlip(img)"
        />
      </view>

      <view class="recheck-box">
        <view>
          <view class="rc-title">术后/诊后复检建议日：{{ rep.recheck_date }}</view>
          <view class="rc-sub">{{ rep.recheck_prep }}</view>
        </view>
        <button class="btn-rebook" @click="rebook(rep)">一键复约</button>
      </view>

      <view class="claim-box">
        <text>保险理赔资料包（{{ (rep.claim_docs || []).length }}份门诊票据凭证）</text>
        <button class="btn-claim" @click="copyClaimSummary(rep)">复制/导出清单</button>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { requestApi, requireAuth, API_BASE_URL } from '../../utils/request';

declare const uni: any;
const medications = ref<any[]>([]);
const reports = ref<any[]>([]);

async function loadPostData() {
  const res = await requestApi<{ data: any }>({ url: '/api/bootstrap' });
  medications.value = res.data.medications || [];
  reports.value = res.data.reports || [];
}

onShow(() => { loadPostData(); });

function fullUrl(u: string) {
  return u.startsWith('http') ? u : `${API_BASE_URL}${u}`;
}

async function toggleMed(m: any) {
  if (!requireAuth('FAMILY')) return;
  await requestApi({ url: `/api/medications/${m.id}/toggle`, method: 'POST' });
  await loadPostData();
}

function goPharmacy() {
  uni.showToast({ title: '已为您拉起合作医药健康平台', icon: 'none' });
}

function previewSlip(img: string) {
  uni.previewImage({ urls: [fullUrl(img)] });
}

function rebook(rep: any) {
  uni.setStorageSync('ew_ai_prefill', {
    recommendedHospital: String(rep.hospital_dept).split('·')[0].trim(),
    recommendedDept: String(rep.hospital_dept).split('·')[1] || '复查门诊'
  });
  uni.switchTab({ url: '/pages/booking/index' });
}

function copyClaimSummary(rep: any) {
  uni.setClipboardData({
    data: `订单#${rep.order_no} 理赔凭证：${(rep.claim_docs || []).join('、')}`,
    success: () => uni.showToast({ title: '理赔资料清单已复制', icon: 'success' })
  });
}
</script>

<style scoped>
.post-page { padding: 24rpx; }
.card { background: #fff; border-radius: 24rpx; padding: 26rpx; border: 1px solid #e0e8e3; margin-bottom: 22rpx; }
.head-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14rpx; }
.sec-title { font-size: 28rpx; font-weight: 800; color: #075e50; }
.btn-drug { background: #1e5aa8; color: #fff; font-size: 22rpx; border-radius: 12rpx; }
.med-row { display: flex; justify-content: space-between; align-items: center; padding: 18rpx 0; border-bottom: 1px solid #eef2ef; }
.med-name { font-size: 26rpx; font-weight: 700; }
.med-sub { font-size: 22rpx; color: #677a74; margin-top: 4rpx; }
.esc-tag { font-size: 22rpx; color: #677a74; }
.hosp { font-size: 26rpx; font-weight: 700; margin-bottom: 10rpx; }
.advice { background: #faf9f5; padding: 18rpx; border-radius: 14rpx; font-size: 24rpx; line-height: 1.6; }
.img-row { display: flex; gap: 14rpx; margin-top: 16rpx; }
.thumb { width: 150rpx; height: 110rpx; border-radius: 12rpx; border: 1px solid #d5e0da; }
.recheck-box { background: #e8f5ef; padding: 18rpx; border-radius: 16rpx; margin-top: 16rpx; display: flex; justify-content: space-between; align-items: center; }
.rc-title { font-size: 25rpx; font-weight: 800; color: #075e50; }
.rc-sub { font-size: 22rpx; color: #4c645d; margin-top: 4rpx; }
.btn-rebook { background: #075e50; color: #fff; font-size: 22rpx; border-radius: 12rpx; }
.claim-box { display: flex; justify-content: space-between; align-items: center; margin-top: 16rpx; font-size: 23rpx; color: #4f625c; }
.btn-claim { background: #162a26; color: #fff; font-size: 22rpx; border-radius: 12rpx; }
</style>
