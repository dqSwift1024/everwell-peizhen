/**
 * 健康来敲门 Everwell · 跨端统一网络请求与鉴权拦截器 (Bearer Token + 401 按需拉起登录)
 */
declare const uni: any;

export const API_BASE_URL = 'https://103.119.1.142'; // 本地调试可切换为 http://localhost:3080

export interface RequestOptions {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  data?: Record<string, unknown>;
  silent?: boolean;
}

export function clearAuthSession(): void {
  uni.removeStorageSync('ew_mobile_token');
  uni.removeStorageSync('ew_mobile_user');
}

export function requireAuth(targetRole: 'FAMILY' | 'ESCORT' = 'FAMILY'): boolean {
  const token = uni.getStorageSync('ew_mobile_token');
  const user = uni.getStorageSync('ew_mobile_user');
  if (token && user) {
    if (targetRole === 'ESCORT' && user.role !== 'ESCORT') {
      uni.navigateTo({ url: '/pages/login/index?role=ESCORT' });
      return false;
    }
    return true;
  }
  uni.navigateTo({ url: `/pages/login/index?role=${targetRole}` });
  return false;
}

export function requestApi<T = any>(opts: RequestOptions): Promise<T> {
  return new Promise((resolve, reject) => {
    const token = uni.getStorageSync('ew_mobile_token');
    const header: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (token) {
      header['Authorization'] = `Bearer ${token}`;
    }

    uni.request({
      url: opts.url.startsWith('http') ? opts.url : `${API_BASE_URL}${opts.url}`,
      method: opts.method || 'GET',
      data: opts.data,
      header,
      timeout: 8500,
      success: (res: any) => {
        const body = res.data || {};
        if (res.statusCode === 401) {
          clearAuthSession();
          if (!opts.silent) {
            uni.navigateTo({ url: '/pages/login/index' });
          }
          reject(new Error(body.msg || '请先登录'));
          return;
        }
        if (res.statusCode >= 400 || body.ok === false) {
          if (!opts.silent) {
            uni.showToast({ title: body.msg || '操作未成功', icon: 'none' });
          }
          reject(new Error(body.msg || `HTTP ${res.statusCode}`));
          return;
        }
        resolve(body as T);
      },
      fail: (err: any) => {
        if (!opts.silent) {
          uni.showToast({ title: '网络波动，请检查连接', icon: 'none' });
        }
        reject(err);
      }
    });
  });
}
