/**
 * 全局配置
 * WORKERS_BASE_URL：Cloudflare Workers 的基础 URL（后端安全逻辑）
 *   - 部署 Workers 后把这里替换成你的实际域名，例如：
 *     const WORKERS_BASE_URL = 'https://cube-permissions.你的子域.workers.dev';
 *   - 当前为占位值，本地/开发时可用 wrangler dev 的本地地址 http://127.0.0.1:8787
 */
var WORKERS_BASE_URL = 'https://silent-voice-7c84.3135320879.workers.dev'; // Cloudflare Workers 部署域名（HTTPS，供 GitHub Pages 前端调用）

// 读取存储的 Supabase anon key（连接时存入 localStorage）
function getAnonKey() {
    return localStorage.getItem('supabase_key') || '';
}

/**
 * 调用 Cloudflare Workers 端点（带 Supabase 登录 JWT）
 * @param {string} path - 端点路径，如 '/submit-attempt'
 * @param {object} body - 请求体
 * @returns {Promise<{ok:boolean, data:object, error:object|null}>}
 */
async function callWorker(path, body) {
    try {
        var session = await dbClient.auth.getSession();
        var token = session && session.data && session.data.session
            ? session.data.session.access_token
            : '';
        var resp = await fetch(WORKERS_BASE_URL + path, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token,
                'apikey': getAnonKey()
            },
            body: JSON.stringify(body)
        });
        var data = await resp.json().catch(function () { return {}; });
        if (!resp.ok) {
            return { ok: false, data: data, error: { message: data.error || '请求失败(' + resp.status + ')' } };
        }
        return { ok: true, data: data, error: null };
    } catch (e) {
        return { ok: false, data: {}, error: { message: '无法连接后端服务：' + e.message } };
    }
}
