/**
 * 全局配置
 * WORKERS_BASE_URL：Cloudflare Workers 的基础 URL（唯一后端入口）。
 * 浏览器不持有任何 Supabase URL/Key——数据库访问与认证全部经此 Worker，
 * 由数据库 RLS 在库层强制权限。
 */
var WORKERS_BASE_URL = 'https://silent-voice-7c84.3135320879.workers.dev'; // Cloudflare Workers 部署域名

/**
 * 取得当前可用的 access token（本地未过期则直接用，否则用 refresh token 换新）。
 * @returns {Promise<string|null>} 未登录或刷新失败返回 null
 */
async function authToken() {
  var cur = session.access();
  if (cur) return cur;
  return await session.ensureFresh();
}

/**
 * 底层请求 Worker（POST，业务/认证端点通用）。
 * 自动附带 Authorization: Bearer <access>（若已登录）。
 * @param {string} path - 如 '/submit-attempt' 或 '/api/auth/login'
 * @param {object} [body]
 * @param {boolean} [anonymous] - true 时不附 Authorization（如登录本身）
 * @returns {Promise<{ok:boolean, data:object, error:object|null}>}
 */
async function callWorker(path, body, anonymous) {
  try {
    var token = anonymous ? null : await authToken();
    var headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    var resp = await fetch(WORKERS_BASE_URL + path, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body || {})
    });
    var data = await resp.json().catch(function () { return {}; });
    if (!resp.ok) {
      return { ok: false, data: data, error: { message: data.error || data.msg || ('请求失败(' + resp.status + ')') } };
    }
    return { ok: true, data: data, error: null };
  } catch (e) {
    return { ok: false, data: {}, error: { message: '无法连接后端服务：' + e.message } };
  }
}

/**
 * 认证端点便捷调用：/api/auth/<action>
 * login 用 code+password（无会话）；logout/password/user 带当前会话 token。
 * @param {string} action - login/refresh/logout/user/password
 * @param {object} [body]
 * @param {boolean} [anonymous]
 */
async function callWorkerAuth(action, body, anonymous) {
  return callWorker('/api/auth/' + action, body || {}, anonymous);
}
