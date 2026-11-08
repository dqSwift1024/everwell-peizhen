/**
 * 健康来敲门 Everwell · 小程序与 App 跨端差异化原生能力桥接层 (Uni-app Vue3 + TypeScript)
 * 支持条件编译：#ifdef MP-WEIXIN (微信小程序) / #ifdef APP-PLUS (iOS/Android App) / #ifdef H5
 */

export interface RideWakeupParams {
  pickupAddress: string;
  hospitalName: string;
  lat: number;
  lng: number;
}

/**
 * 功能 5：位置选择 · 跳转滴滴高德 (+)
 * 自动根据当前运行终端（微信小程序 vs 原生App vs H5）唤醒滴滴出行或高德打车并传入起终点坐标
 */
export function wakeupRideService(provider: 'DIDI' | 'AMAP', params: RideWakeupParams): void {
  const { pickupAddress, hospitalName, lat, lng } = params;

  // #ifdef MP-WEIXIN
  if (provider === 'DIDI') {
    // 唤醒滴滴出行微信小程序
    ( globalThis as any ).wx?.navigateToMiniProgram({
      appId: 'wxaf35009675aa0b2a',
      path: `pages/index/index?toName=${encodeURIComponent(hospitalName)}&toLat=${lat}&toLng=${lng}&fromName=${encodeURIComponent(pickupAddress)}`,
      fail: () => {
        console.log('开发环境提示：已模拟拉起滴滴出行小程序并带入接手点与医院经纬度');
      }
    });
  } else {
    // 唤醒高德打车微信小程序
    ( globalThis as any ).wx?.navigateToMiniProgram({
      appId: 'wxbc97f0f99d643963',
      path: `pages/index/index?endName=${encodeURIComponent(hospitalName)}&endLat=${lat}&endLng=${lng}`
    });
  }
  // #endif

  // #ifdef APP-PLUS
  const plusRuntime = ( globalThis as any ).plus?.runtime;
  if (plusRuntime) {
    const schemeUrl = provider === 'DIDI'
      ? `diditaxi://taxi?to_name=${encodeURIComponent(hospitalName)}&to_lat=${lat}&to_lng=${lng}`
      : `iosamap://path?sourceApplication=everwell&dlat=${lat}&dlon=${lng}&dname=${encodeURIComponent(hospitalName)}&dev=0&t=0`;
    plusRuntime.openURL(schemeUrl, () => {
      plusRuntime.openURL(`https://uri.amap.com/navigation?to=${lng},${lat},${encodeURIComponent(hospitalName)}&mode=car&src=everwell`);
    });
  }
  // #endif
}

/**
 * 功能 6 & 7：患者确认 (+) 与 结果分享 (+) 微信原生卡片生成
 */
export function buildPatientConfirmShareCard(orderNo: string, patientName: string, hospitalName: string) {
  return {
    title: `【健康来敲门】请 ${patientName} 确认前往 ${hospitalName} 的陪诊服务安排`,
    path: `/pages/patient-confirm/index?orderNo=${orderNo}&mode=ELDER_LARGE_BTN`,
    imageUrl: '/static/share-patient-confirm.png'
  };
}
