/**
 * Cloudflare Workers 共享工具
 * 安全模型（与 Supabase Edge Functions 一致）：
 *   1. 前端带 Supabase 登录 JWT（Authorization: Bearer <token>）
 *   2. Worker 用 Supabase Auth 的 /auth/v1/user 接口校验 JWT → 拿到调用者身份
 *   3. 角色完全信任数据库：从 profiles 表现读调用者角色（用 service_role key，绕过 RLS）
 *   4. 校验通过后，用 service_role key 执行受控写库（前端无法伪造身份/状态/审核人）
 * 关键点：SERVICE_ROLE_KEY 只存在 Worker 环境变量里，绝不下发前端。
 */

// 用调用者 JWT 向 Supabase Auth 换取用户身份
// 返回 { uid } 或抛出带状态码的错误
export async function verifyCallerJwt(env, authHeader) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw httpError(401, "未登录");
  }
  const token = authHeader.slice("Bearer ".length);
  const resp = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: env.SUPABASE_ANON_KEY,
    },
  });
  if (!resp.ok) {
    throw httpError(401, "身份验证失败");
  }
  const user = await resp.json();
  if (!user || !user.id) throw httpError(401, "身份验证失败");
  return { uid: user.id };
}

// 从数据库现读调用者角色（用 service_role 绕过 RLS，但仅读角色）
// 返回角色字符串，如 'user' | 'editor' | 'reviewer' | 'admin'；找不到返回 null
export async function fetchUserRole(env, uid) {
  const resp = await supabaseRest(env, {
    path: "/rest/v1/profiles",
    params: `select=role&id=eq.${uid}`,
    method: "GET",
  });
  const rows = await resp.json();
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows[0].role || null;
}

// 调用 Supabase REST（PostgREST），统一附加 service_role key + apikey
// opts: { path, method, params(可选 query), body(可选对象) }
export async function supabaseRest(env, { path, method = "GET", params = "", body } = {}) {
  const headers = {
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    "Content-Type": "application/json",
  };
  if (body !== undefined) headers["Prefer"] = "return=representation";
  const resp = await fetch(`${env.SUPABASE_URL}${path}?${params}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return resp;
}

// 统一的 JSON 响应
export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      // 开发期可放宽，生产建议收敛到具体域名
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });
}

// 构造一个带状态码的错误对象
export function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

// 统一处理 OPTIONS 预检
export function handleOptions(req) {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" } });
  }
  return null;
}

// 从错误对象安全提取信息（不泄露堆栈/内部细节）
export function errorBody(e) {
  const status = e.status || 500;
  const message = status === 500 ? "服务器内部错误" : e.message;
  return json({ error: message }, status);
}
