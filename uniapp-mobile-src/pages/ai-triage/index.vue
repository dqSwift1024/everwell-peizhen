<template>
  <view class="ai-page">
    <view class="notice">
      GB/T 47801—2026 合规说明：本助手仅提供诊前携带资料清单与三甲医院科室/轮椅路线推荐，不作疾病诊断。
    </view>

    <view class="card">
      <view class="title">描述长辈年龄、不适表现与楼层情况</view>
      <textarea v-model="query" class="area" placeholder="例如：父亲78岁左膝盖剧痛无法自己下无电梯3楼，想看北京骨科" />
      <button class="btn-run" @click="runTriage">生成诊前准备清单与推荐科室</button>
    </view>

    <view v-if="reply" class="card res-card">
      <view class="hosp">{{ reply.recommendedCity }} · {{ reply.recommendedHospital }}</view>
      <view class="dept">推荐科室：{{ reply.recommendedDept }} ｜ 建议分级：{{ reply.recommendedMobilityLevel }}</view>
      <view class="tips">
        <view v-for="(tip, idx) in reply.prepTips" :key="idx" class="tip-row">{{ idx + 1 }}. {{ tip }}</view>
      </view>
      <view class="guide">轮椅指引：{{ reply.wheelchairGuide }}</view>
      <button class="btn-apply" @click="applyToBooking">一键带入预约下单页 →</button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { requestApi } from '../../utils/request';

declare const uni: any;
const query = ref('我爸78岁，最近两周左膝盖剧痛无法自己下3楼，想看北京骨科');
const reply = ref<any>(null);

async function runTriage() {
  const res = await requestApi<{ reply: any }>({
    url: '/api/ai/triage',
    method: 'POST',
    data: { query: query.value }
  });
  reply.value = res.reply;
}

function applyToBooking() {
  if (!reply.value) return;
  uni.setStorageSync('ew_ai_prefill', reply.value);
  uni.switchTab({ url: '/pages/booking/index' });
}
</script>

<style scoped>
.ai-page { padding: 24rpx; }
.notice { background: #e8f5ef; color: #075e50; padding: 20rpx; border-radius: 18rpx; font-size: 23rpx; margin-bottom: 20rpx; }
.card { background: #fff; padding: 26rpx; border-radius: 24rpx; border: 1px solid #e0e8e3; margin-bottom: 22rpx; }
.title { font-size: 28rpx; font-weight: 800; color: #075e50; margin-bottom: 14rpx; }
.area { width: 100%; height: 180rpx; background: #faf9f5; padding: 18rpx; border-radius: 16rpx; font-size: 26rpx; box-sizing: border-box; }
.btn-run { background: #075e50; color: #fff; font-size: 27rpx; font-weight: 700; border-radius: 16rpx; margin-top: 18rpx; }
.hosp { font-size: 30rpx; font-weight: 800; color: #075e50; }
.dept { font-size: 25rpx; color: #d77844; font-weight: 700; margin-top: 8rpx; }
.tips { background: #faf9f5; padding: 18rpx; border-radius: 16rpx; margin-top: 16rpx; font-size: 24rpx; line-height: 1.6; }
.guide { font-size: 23rpx; color: #596c66; margin-top: 14rpx; }
.btn-apply { background: #d77844; color: #fff; font-size: 27rpx; font-weight: 700; border-radius: 16rpx; margin-top: 20rpx; }
</style>
