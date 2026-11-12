<template>
  <view class="care-page">
    <!-- 健康日记录入与近7日记录 -->
    <view class="card">
      <view class="sec-title">长辈每日血压与血糖健康日记 (+)</view>
      <view class="inp-grid">
        <input v-model="bpSys" type="number" class="inp" placeholder="收缩压" />
        <input v-model="bpDia" type="number" class="inp" placeholder="舒张压" />
        <input v-model="sugar" type="digit" class="inp" placeholder="空腹血糖" />
      </view>
      <view class="note-row">
        <input v-model="note" class="inp flex-1" placeholder="体感与用药备注..." />
        <button class="btn-save" @click="saveDiary">记录</button>
      </view>
      <view v-for="d in diaries" :key="d.id" class="diary-item">
        <text>{{ d.log_date }} ｜ 血压 {{ d.bp_sys }}/{{ d.bp_dia }} ｜ 血糖 {{ d.blood_sugar }}</text>
        <text class="feel-tag">{{ d.feeling }}</text>
      </view>
    </view>

    <!-- 敲门种草攻略双列社区 -->
    <view class="sec-title" style="margin:12rpx 0;">敲门笔记 · 三甲无障碍攻略与节气食养 (+)</view>
    <view class="notes-grid">
      <view v-for="art in articles" :key="art.id" class="note-card">
        <view class="note-cover" @click="readArticle(art)">
          <text class="cat">{{ art.category }}</text>
          <view class="n-title">{{ art.title }}</view>
        </view>
        <view class="note-foot">
          <text @click="interact(art.id, 'like')">{{ art.liked ? '♥' : '♡' }} {{ art.likes }}</text>
          <text @click="interact(art.id, 'bookmark')">{{ art.bookmarked ? '★ 已藏' : '☆ 收藏' }}</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { requestApi, requireAuth } from '../../utils/request';

declare const uni: any;
const bpSys = ref('128');
const bpDia = ref('78');
const sugar = ref('5.7');
const note = ref('');
const diaries = ref<any[]>([]);
const articles = ref<any[]>([]);

async function loadCareData() {
  const res = await requestApi<{ data: any }>({ url: '/api/bootstrap' });
  diaries.value = (res.data.diaries || []).slice(0, 7);
  articles.value = res.data.articles || [];
}

onShow(() => { loadCareData(); });

async function saveDiary() {
  if (!requireAuth('FAMILY')) return;
  await requestApi({
    url: '/api/diaries',
    method: 'POST',
    data: {
      bp_sys: Number(bpSys.value),
      bp_dia: Number(bpDia.value),
      blood_sugar: Number(sugar.value),
      note: note.value
    }
  });
  note.value = '';
  await loadCareData();
  uni.showToast({ title: '体征记录已保存', icon: 'success' });
}

async function interact(id: number, action: 'like' | 'bookmark') {
  await requestApi({ url: `/api/articles/${id}/interact`, method: 'POST', data: { action } });
  await loadCareData();
}

function readArticle(art: any) {
  uni.showModal({
    title: art.title,
    content: art.content || art.summary,
    confirmText: '去约同院',
    success: (r: any) => {
      if (r.confirm) uni.switchTab({ url: '/pages/booking/index' });
    }
  });
}
</script>

<style scoped>
.care-page { padding: 24rpx; }
.card { background: #fff; border-radius: 24rpx; padding: 26rpx; border: 1px solid #e0e8e3; margin-bottom: 24rpx; }
.sec-title { font-size: 28rpx; font-weight: 800; color: #075e50; margin-bottom: 16rpx; }
.inp-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12rpx; margin-bottom: 14rpx; }
.inp { background: #faf9f5; border: 1px solid #d5e0da; border-radius: 14rpx; padding: 14rpx 18rpx; font-size: 25rpx; }
.note-row { display: flex; gap: 12rpx; margin-bottom: 16rpx; }
.flex-1 { flex: 1; }
.btn-save { background: #075e50; color: #fff; font-size: 24rpx; border-radius: 14rpx; padding: 0 28rpx; }
.diary-item { display: flex; justify-content: space-between; padding: 14rpx 0; border-bottom: 1px solid #eff3f0; font-size: 23rpx; }
.feel-tag { color: #075e50; font-weight: 700; }
.notes-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16rpx; }
.note-card { background: #fff; border-radius: 20rpx; overflow: hidden; border: 1px solid #e0e8e3; }
.note-cover { background: linear-gradient(135deg, #075e50, #1b8a75); color: #fff; padding: 22rpx; min-height: 150rpx; }
.cat { font-size: 20rpx; background: rgba(255,255,255,0.2); padding: 4rpx 12rpx; border-radius: 999rpx; }
.n-title { font-size: 25rpx; font-weight: 800; margin-top: 12rpx; line-height: 1.4; }
.note-foot { display: flex; justify-content: space-between; padding: 16rpx 20rpx; font-size: 23rpx; color: #546862; }
</style>
