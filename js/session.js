/**
 * 会话管理层（替代 supabase-js auth）
 * 登录/刷新/登出/改密码/取用户全部经 Cloudflare Workers 的 /api/auth/* 代理，
 * 浏览器不持有任何 Supabase URL/Key。token 持久化在 localStorage，
 * 随 /api/* 请求带 Authorization: Bearer <access>，由数据库 RLS 决定权限。
 */
var SESSION_KEYS = {
  access: 'wb_access',
  refresh: 'wb_refresh',
  user: 'wb_user',
};

var session = (function () {
  var accessToken = null;
  var refreshToken = null;
  var currentUser = null;

  function readStored() {
    accessToken = localStorage.getItem(SESSION_KEYS.access) || null;
    refreshToken = localStorage.getItem(SESSION_KEYS.refresh) || null;
    try { currentUser = JSON.parse(localStorage.getItem(SESSION_KEYS.user) || 'null'); }
    catch (e) { currentUser = null; }
  }
  readStored();

  function persist() {
    if (accessToken) localStorage.setItem(SESSION_KEYS.access, accessToken);
    else localStorage.removeItem(SESSION_KEYS.access);
    if (refreshToken) localStorage.setItem(SESSION_KEYS.refresh, refreshToken);
    else localStorage.removeItem(SESSION_KEYS.refresh);
    if (currentUser) localStorage.setItem(SESSION_KEYS.user, JSON.stringify(currentUser));
    else localStorage.removeItem(SESSION_KEYS.user);
  }

  return {
    /** 同步返回当前 access token（可能已过期，需要时先 ensureFresh） */
    access: function () { return accessToken; },
    /** 当前登录用户对象或 null */
    user: function () { return currentUser; },
    /** 是否有已保存的会话 */
    hasSession: function () { return !!(accessToken && refreshToken); },
    /** 登录成功后写入 token 与用户 */
    set: function (data) {
      accessToken = data.access_token || null;
      refreshToken = data.refresh_token || null;
      currentUser = data.user || null;
      persist();
    },
    /** 登出/失效：清空本地会话 */
    clear: function () {
      accessToken = null; refreshToken = null; currentUser = null;
      persist();
    },
    /**
     * 确保 access token 可用：若本地 refresh token 存在，尝试用 refresh 换新 access。
     * 返回当前 access token（可能为 null = 未登录/刷新失败）。
     */
    ensureFresh: async function () {
      if (accessToken) return accessToken;
      if (refreshToken) {
        try {
          var r = await callWorker('/api/auth/refresh', { refresh_token: refreshToken }, true);
          if (r.ok && r.data && r.data.access_token) {
            session.set(r.data);
            return accessToken;
          }
        } catch (e) { /* 刷新失败则视为未登录 */ }
        session.clear();
      }
      return null;
    },
  };
})();
