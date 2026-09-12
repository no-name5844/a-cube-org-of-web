/**
 * ⚠️ 本文件是 cf-workers/worker.js 的副本，用于 Cloudflare **Pages 高级模式** 部署。
 *    改代码请改 cf-workers/worker.js，然后执行：
 *        cp cf-workers/worker.js cf-pages/_worker.js
 *
 * 为什么要有这份：本机/国内网络对 *.workers.dev 是「DNS 污染 + SNI 阻断」双重封锁
 * （TCP 能连上但 TLS 握手被掐断，改 hosts 无效），而实测 *.pages.dev 完全可用。
 * Pages 高级模式接受与 Worker 完全相同的 Module 语法（export default { fetch }），
 * 因此同一份代码无需改动即可迁移，得到国内可访问的 <项目名>.pages.dev 域名。
 *
 * 部署方式见 cf-pages/README.md。
 *
 * ---------------------------------------------------------------------------
 *
 * 魔方比赛成绩系统 - Cloudflare Workers 单文件版
 * 适用于 Cloudflare 网页控制台的在线编辑器（单文件 Worker，无 import 依赖）。
 *
 * 四个安全端点（同域名下不同路径）：
 *   POST /submit-attempt      成绩提交（编辑员以上，服务端定状态）
 *   POST /review-attempt      审核成绩（审核员+，防自审）
 *   POST /assign-role         角色管理（管理员，只能授低于管理员的角色）
 *   POST /admin-create-user   管理员建号（仅管理员；用 service_role 调 Auth Admin 建 auth.users）
 *
 * 通用数据代理（业务表 CRUD 全部经此，浏览器不再直连 Supabase 数据表）：
 *   GET  /api/<table>?<rest查询>    读取（匿名可访问公开数据，RLS 生效）
 *   POST /api/<table>               插入（要求登录 JWT，RLS 生效）
 *   PATCH/DELETE /api/<table>?<筛选> 更新/删除（要求登录 JWT，RLS 生效）
 *   —— 所有请求以调用者 JWT 身份转发到 PostgREST，权限由数据库 RLS 强制。
 *
 * 认证代理（浏览器不引入 supabase-js、不持有 Supabase URL/Key）：
 *   POST /api/auth/login     {code,password} → 换 access/refresh token
 *   POST /api/auth/refresh   {refresh_token} → 刷新 access token
 *   POST /api/auth/logout    {refresh_token} → 使会话失效
 *   POST /api/auth/password  Bearer + {new_password} → 修改密码
 *   GET  /api/auth/user      Bearer → 当前用户信息
 *   —— 前端持久化 token，并随 /api/* 请求带 Authorization: Bearer <access>。
 *
 * 环境变量（在 Worker → Settings → Variables 配置）：
 *   SUPABASE_URL              如 https://xxxx.supabase.co
 *   SUPABASE_ANON_KEY        Supabase Anon Key（公开可下发；仅作 apikey 头，权限由 RLS 强制）
 *   SUPABASE_SERVICE_ROLE_KEY Supabase Service Role Key（仅服务端用，绝不下发浏览器；
 *                            且只用于 /admin-create-user 调 Auth Admin API 建号；
 *                            数据面操作仍走调用者 JWT + RLS，不被 service_role 绕过）
 *
 * 安全说明：本 Worker 的【数据面】操作（提交/审核/改角色）均以调用者的登录 JWT 身份执行，
 * 由数据库 RLS 在数据库层强制权限。SERVICE_ROLE_KEY 仅用于管理员建号这一天然高权限动作，
 * 永不下发到浏览器，因此 Workers 环境不存在可滥用数据面的高权限凭证。
 *
 * 部署：Cloudflare 控制台 → Workers & Pages → Create → 粘贴本文件 → Save and deploy
 */

// ============ 工具函数 ============

// 用调用者 JWT 向 Supabase Auth 换取用户身份 → { uid } 或抛错
async function verifyCallerJwt(env, authHeader) {
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
  if (!resp.ok) throw httpError(401, "身份验证失败");
  const user = await resp.json();
  if (!user || !user.id) throw httpError(401, "身份验证失败");
  return { uid: user.id, token };
}

// 从数据库现读调用者角色（以调用者身份走 RLS，profiles 策略允许登录用户读 role）→ 角色或 null
async function fetchUserRole(env, uid, token) {
  const resp = await supabaseRest(env, token, "/rest/v1/profiles", "GET", `select=role&id=eq.${uid}`);
  const rows = await resp.json();
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows[0].role || null;
}

// 调用 Supabase REST（PostgREST），以调用者身份（userToken）执行，RLS 生效
// 参数顺序：env, userToken, path, method, params(查询串), body(可选对象)
async function supabaseRest(env, userToken, path, method = "GET", params = "", body) {
  const headers = {
    Authorization: `Bearer ${userToken}`,
    apikey: env.SUPABASE_ANON_KEY,
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

// 调用 Supabase Auth Admin API（仅用于建号），以 service_role 身份执行。
// 注意：service_role 仅存在于 Worker 服务端环境变量，永不下发浏览器；
// 且只用于 Auth Admin（创建用户），数据面操作仍走调用者 JWT + RLS。
async function supabaseAdminRest(env, path, method = "POST", body) {
  const headers = {
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    "Content-Type": "application/json",
  };
  const resp = await fetch(`${env.SUPABASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return resp;
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, content-type, apikey, prefer",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: Object.assign({ "Content-Type": "application/json" }, corsHeaders()),
  });
}

/**
 * 自定义 HTTP 错误类型
 * @typedef {Error & {httpStatus: number}} HttpError
 */

/**
 * 构造一个带 HTTP 状态码的错误对象
 * @param {number} status HTTP 状态码
 * @param {string} message 错误信息
 * @returns {HttpError}
 */
function httpError(status, message) {
  // 用 Object.assign 构造，让 TS 推断出带 httpStatus 的对象（避免 Error 赋值兼容性报错）
  return Object.assign(new Error(message), { httpStatus: status });
}

/**
 * 从错误对象安全提取信息（不泄露堆栈/内部细节）
 * @param {unknown} e
 */
function errorBody(e) {
  const err = /** @type {HttpError} */ (e);
  const status = err.httpStatus || 500;
  const message = status === 500 ? "服务器内部错误" : err.message;
  return json({ error: message }, status);
}

// ============ 端点 1：成绩提交 ============
const SUBMIT_ALLOWED_FIELDS = [
  "competition_event_id", "participant_id", "attempt_number",
  "solve_time", "cube_type", "scramble", "move_count", "tps",
  "solve_steps", "step_comments", "is_dnf", "is_plus_two",
  "is_dns", "video_url", "notes",
];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CUBE_TYPES = ["smart", "non_smart"];

/** 校验 UUID 格式，非法返回 false */
function isUuid(v) {
  return typeof v === "string" && UUID_RE.test(v);
}

async function submitAttempt(request, env) {
  const { uid, token } = await verifyCallerJwt(env, request.headers.get("Authorization"));
  const role = await fetchUserRole(env, uid, token);
  if (!["editor", "reviewer", "admin"].includes(role)) {
    throw httpError(403, "需要编辑员及以上权限才能提交成绩");
  }
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    throw httpError(400, "请求体必须是 JSON 对象");
  }

  // 严格输入校验
  if (!isUuid(body.competition_event_id) || !isUuid(body.participant_id)) {
    throw httpError(400, "competition_event_id / participant_id 必须是合法 UUID");
  }
  if (!CUBE_TYPES.includes(body.cube_type)) {
    throw httpError(400, "cube_type 只能是 smart 或 non_smart");
  }
  // attempt_number：转字符串后非空（数据库为 TEXT）
  if (body.attempt_number === undefined || body.attempt_number === null || String(body.attempt_number).trim() === "") {
    throw httpError(400, "attempt_number 不能为空");
  }
  // solve_time：-1 → DNF，-2 → DNS（哨兵值），否则必须为非负数
  let solveTime = null;
  let isDnf = false;
  let isDns = false;
  if (body.solve_time !== undefined && body.solve_time !== null && body.solve_time !== "") {
    const t = Number(body.solve_time);
    if (!Number.isFinite(t)) {
      throw httpError(400, "solve_time 必须是非负数字，或 -1(DNF) / -2(DNS)");
    }
    if (t === -1) { isDnf = true; }
    else if (t === -2) { isDns = true; }
    else if (t < 0) { throw httpError(400, "solve_time 非法：只能用 -1(DNF) / -2(DNS) 或非负数"); }
    else { solveTime = t; }
  }
  // move_count / tps：若非空则须为有限非负数值
  for (const nf of ["move_count", "tps"]) {
    if (body[nf] !== undefined && body[nf] !== null && body[nf] !== "") {
      const v = Number(body[nf]);
      if (!Number.isFinite(v) || v < 0) {
        throw httpError(400, `${nf} 必须是非负数`);
      }
    }
  }
  // is_dnf / is_plus_two：布尔或"true"/"false"
  for (const bf of ["is_dnf", "is_plus_two"]) {
    if (body[bf] !== undefined && body[bf] !== null && body[bf] !== "") {
      const s = String(body[bf]).toLowerCase();
      if (s !== "true" && s !== "false") {
        throw httpError(400, `${bf} 必须是布尔值`);
      }
    }
  }

  const record = { submitted_by: uid };
  for (const f of SUBMIT_ALLOWED_FIELDS) {
    // solve_time 由哨兵值单独处理，跳过；is_dnf/is_dns 由哨兵翻译后覆盖
    if (f === "solve_time") continue;
    if (body[f] !== undefined && body[f] !== null && body[f] !== "") record[f] = body[f];
  }
  // 哨兵翻译：-1 → DNF，-2 → DNS；有哨兵时 solve_time 存 null
  if (isDnf) {
    record.solve_time = null;
    record.is_dnf = true;
    record.is_dns = false;
  } else if (isDns) {
    record.solve_time = null;
    record.is_dns = true;
    record.is_dnf = false;
  } else if (solveTime !== null) {
    record.solve_time = solveTime;
  }
  // 规范化数值类型
  if (record.move_count !== undefined) record.move_count = Number(record.move_count);
  if (record.tps !== undefined) record.tps = Number(record.tps);
  record.attempt_number = String(record.attempt_number);
  record.status = role === "admin" ? "approved" : "pending";

  const resp = await supabaseRest(env, token, "/rest/v1/attempts", "POST", "select=id,status", record);
  if (!resp.ok) {
    const err = await resp.json().catch(() => null);
    throw httpError(500, (err && err.message) || "提交失败");
  }
  const inserted = await resp.json();
  const row = Array.isArray(inserted) ? inserted[0] : inserted;
  return json({ ok: true, id: row && row.id, status: row && row.status });
}

// ============ 端点 2：审核成绩 ============
async function reviewAttempt(request, env) {
  const { uid, token } = await verifyCallerJwt(env, request.headers.get("Authorization"));
  const role = await fetchUserRole(env, uid, token);
  if (role !== "reviewer" && role !== "admin") throw httpError(403, "需要审核员及以上权限");

  const body = await request.json().catch(() => null);
  const { attemptId, action } = body || {};
  if (!isUuid(attemptId) || !["approve", "reject"].includes(action)) {
    throw httpError(400, "参数错误：attemptId 必须是合法 UUID，action 只能是 approve/reject");
  }
  const status = action === "approve" ? "approved" : "rejected";

  const targetResp = await supabaseRest(env, token, "/rest/v1/attempts", "GET", `select=id,status,submitted_by&id=eq.${attemptId}`);
  if (!targetResp.ok) throw httpError(500, "查询成绩失败");
  const targets = await targetResp.json();
  const target = Array.isArray(targets) ? targets[0] : null;
  if (!target) throw httpError(404, "成绩不存在");
  if (target.submitted_by === uid) throw httpError(403, "不能审核自己提交的成绩");
  if (target.status !== "pending") throw httpError(400, "只能审核待审核状态的成绩");

  // 乐观锁：PATCH 带 status=eq.pending 过滤，若已被其他审核员先处理则影响 0 行 → 拒绝
  // （解决并发 approve/reject 相互覆盖）
  const updResp = await supabaseRest(env, token, "/rest/v1/attempts", "PATCH", `id=eq.${attemptId}&status=eq.pending&select=id`, { status, reviewed_by: uid, reviewed_at: new Date().toISOString() });
  if (!updResp.ok) {
    const err = await updResp.json().catch(() => null);
    throw httpError(500, (err && err.message) || "审核失败");
  }
  const updated = await updResp.json();
  const updatedRow = Array.isArray(updated) ? updated[0] : updated;
  if (!updatedRow || !updatedRow.id) {
    throw httpError(409, "该成绩已被处理，请刷新后重试"); // 并发下未命中（0 行）→ 冲突
  }
  return json({ ok: true, status });
}

// ============ 端点 3：角色管理 ============
const ASSIGNABLE_ROLES = ["user", "editor", "reviewer"];

async function assignRole(request, env) {
  const { uid, token } = await verifyCallerJwt(env, request.headers.get("Authorization"));
  const myRole = await fetchUserRole(env, uid, token);
  if (myRole !== "admin") throw httpError(403, "需要管理员权限");

  const body = await request.json().catch(() => null);
  const { userId, role } = body || {};
  if (!isUuid(userId) || !ASSIGNABLE_ROLES.includes(role)) {
    throw httpError(400, "参数错误：userId 必须是合法 UUID，role 只能是 user/editor/reviewer");
  }
  if (userId === uid) throw httpError(400, "不能修改自己的角色");

  const targetResp = await supabaseRest(env, token, "/rest/v1/profiles", "GET", `select=id,role&id=eq.${userId}`);
  if (!targetResp.ok) throw httpError(500, "查询目标用户失败");
  const targets = await targetResp.json();
  const target = Array.isArray(targets) ? targets[0] : null;
  if (!target) throw httpError(404, "目标用户不存在");
  if (target.role === "admin") throw httpError(403, "不能修改其他管理员的角色");

  // 若目标用户在查询后被删除，PATCH 影响 0 行 → 检测并返回错误（避免虚假成功）
  const updResp = await supabaseRest(env, token, "/rest/v1/profiles", "PATCH", `id=eq.${userId}&select=id`, { role, updated_at: new Date().toISOString() });
  if (!updResp.ok) {
    const err = await updResp.json().catch(() => null);
    throw httpError(500, (err && err.message) || "修改角色失败");
  }
  const updated = await updResp.json();
  const updatedRow = Array.isArray(updated) ? updated[0] : updated;
  if (!updatedRow || !updatedRow.id) {
    throw httpError(404, "目标用户不存在或已被删除"); // 查询后删除 → 0 行受影响
  }
  return json({ ok: true, role });
}

// ============ 端点 4：管理员建号 ============
const CREATE_ALLOWED_ROLES = ["user", "editor", "reviewer"]; // 管理员不能创建管理员

// 登录ID → 确定的 auth email（与前端 signIn 映射一致）
function loginCodeToEmail(code) {
  return code + "@cube.local";
}

async function adminCreateUser(request, env) {
  const { uid, token } = await verifyCallerJwt(env, request.headers.get("Authorization"));
  const role = await fetchUserRole(env, uid, token);
  if (role !== "admin") throw httpError(403, "需要管理员权限");

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") throw httpError(400, "请求体必须是 JSON 对象");

  const { user_code, password, role: newRole, nickname } = body;
  if (!user_code || typeof user_code !== "string" || user_code.trim() === "") {
    throw httpError(400, "用户ID不能为空");
  }
  const code = user_code.trim();
  if (!/^[A-Za-z0-9_]{1,32}$/.test(code)) {
    throw httpError(400, "用户ID只能包含字母/数字/下划线，最长32位");
  }
  if (!password || typeof password !== "string" || password.length < 6) {
    throw httpError(400, "初始密码至少6位");
  }
  if (!CREATE_ALLOWED_ROLES.includes(newRole)) {
    throw httpError(400, "角色只能是 user/editor/reviewer（管理员不可由他人创建）");
  }

  // 1) 用 Auth Admin API 创建 auth.users（service_role，仅服务端）
  const email = loginCodeToEmail(code);
  const createResp = await supabaseAdminRest(env, "/auth/v1/admin/users", "POST", {
    email: email,
    password: password,
    email_confirm: true,
    user_metadata: { username: nickname || code },
  });
  if (!createResp.ok) {
    let msg = "创建账号失败";
    try {
      const e = await createResp.json();
      if (e && e.message) msg = e.message;
      else if (e && e.msg) msg = e.msg;
    } catch (_) {}
    if (createResp.status === 422) msg = "该用户ID已存在";
    throw httpError(createResp.status === 422 ? 409 : (createResp.status || 500), msg);
  }
  const created = await createResp.json();
  const newId = created && created.id;
  if (!newId) throw httpError(500, "创建账号失败：未返回用户ID");

  // 2) 覆盖默认 user_code / role / 昵称（handle_new_user 触发器已建 profile，这里更新）
  const updResp = await supabaseAdminRest(env, `/rest/v1/profiles?id=eq.${newId}`, "PATCH", {
    user_code: code,
    role: newRole,
    username: nickname || code,
    updated_at: new Date().toISOString(),
  });
  if (!updResp.ok) {
    let msg = "账号已创建，但资料（ID/角色/昵称）未完全写入，请到用户管理重试或手动修正";
    try { const e = await updResp.json(); if (e && e.message) msg = e.message; } catch (_) {}
    throw httpError(500, msg);
  }
  return json({ ok: true, id: newId, user_code: code, role: newRole });
}

// ============ 通用数据代理（业务表 CRUD 全部经此）============
// 路径 /api/<table>?<rest查询> → Supabase REST /rest/v1/<table>?<rest查询>
// 读取(GET) 允许匿名（公开数据由 RLS 控制）；写操作(POST/PATCH/DELETE) 要求登录 JWT，
// 以调用者身份转发，权限由数据库 RLS 强制。所有请求只使用服务端 anon key 作为 apikey 头。
async function apiProxy(request, env) {
  const url = new URL(request.url);
  const tail = url.pathname.slice("/api/".length) + url.search; // 含查询串，如 "competitions?select=*&order=x"
  const method = request.method;
  const authHeader = request.headers.get("Authorization");

  let userToken = null;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const v = await verifyCallerJwt(env, authHeader); // 校验 JWT；非法则 401
    userToken = v.token;
  }

  // 写操作必须已登录（RLS 依赖 auth.uid()）；读操作允许匿名访问公开数据
  if (method !== "GET" && !userToken) {
    throw httpError(401, "需要登录");
  }

  let body;
  if (method === "POST" || method === "PATCH") {
    body = await request.json().catch(() => null);
  }

  const headers = {
    apikey: env.SUPABASE_ANON_KEY,
    "Content-Type": "application/json",
  };
  if (userToken) headers["Authorization"] = "Bearer " + userToken;
  if (body !== undefined) headers["Prefer"] = "return=representation";

  const resp = await fetch(`${env.SUPABASE_URL}/rest/v1/${tail}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await resp.text();
  return new Response(text, {
    status: resp.status,
    headers: Object.assign({ "Content-Type": "application/json" }, corsHeaders()),
  });
}

// ============ 认证代理（/api/auth/*）============
// 前端不再引入 supabase-js、不持有任何 Supabase URL/Key。
// 登录/刷新/登出/改密码/取用户全部经此代理到 Supabase Auth（服务端用 anon key 作 apikey），
// 成功返回浏览器需要的 access_token / refresh_token，由前端自行持久化并随后续请求发回。
// 数据面（/api/*、submit/review/assign）仍以调用者 JWT 身份走 RLS，本层不改变数据权限。
async function authProxy(request, env) {
  const url = new URL(request.url);
  const action = url.pathname.slice("/api/auth/".length);
  const method = request.method;
  const body = await request.json().catch(() => null);

  // 统一转发到 Supabase Auth
  const authFetch = async (authPath, payload) => {
    const resp = await fetch(`${env.SUPABASE_URL}/auth/v1${authPath}`, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const text = await resp.text();
    let data = null;
    try { data = JSON.parse(text); } catch (_) {}
    if (!resp.ok) {
      const msg = (data && (data.msg || data.error_description || data.message))
        || `认证失败(${resp.status})`;
      throw httpError(resp.status === 400 ? 401 : (resp.status || 500), msg);
    }
    return data;
  };

  if (method === "POST") {
    if (action === "login") {
      if (!body || typeof body.code !== "string" || typeof body.password !== "string") {
        throw httpError(400, "缺少 code 或 password");
      }
      const code = body.code.trim();
      if (!/^[A-Za-z0-9_]{1,32}$/.test(code)) {
        throw httpError(400, "用户ID只能包含字母/数字/下划线，最长32位");
      }
      // 登录ID → 确定的 auth email（与建号映射一致）
      const email = loginCodeToEmail(code);
      const data = await authFetch("/token?grant_type=password", {
        email, password: body.password,
      });
      return json({ ok: true, ...data });
    }
    if (action === "refresh") {
      if (!body || typeof body.refresh_token !== "string") throw httpError(400, "缺少 refresh_token");
      const data = await authFetch("/token?grant_type=refresh_token", { refresh_token: body.refresh_token });
      return json({ ok: true, ...data });
    }
    if (action === "logout") {
      // 使当前 refresh_token 失效（可传 refresh_token 字段）
      if (body && body.refresh_token) {
        await authFetch("/logout", { refresh_token: body.refresh_token });
      }
      return json({ ok: true });
    }
    if (action === "password") {
      // 改密码：需要登录态（access_token 在 Authorization）
      const authHeader = request.headers.get("Authorization");
      if (!authHeader || !authHeader.startsWith("Bearer ")) throw httpError(401, "未登录");
      if (!body || typeof body.new_password !== "string" || body.new_password.length < 6) {
        throw httpError(400, "新密码至少6位");
      }
      const resp = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
        method: "PUT",
        headers: {
          apikey: env.SUPABASE_ANON_KEY,
          Authorization: authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ password: body.new_password }),
      });
      const text = await resp.text();
      if (!resp.ok) {
        let d = null; try { d = JSON.parse(text); } catch (_) {}
        const msg = (d && (d.msg || d.message)) || `修改密码失败(${resp.status})`;
        throw httpError(resp.status, msg);
      }
      return json({ ok: true });
    }
  }

  if (action === "user" && method === "GET") {
    // 用 access_token 换当前用户身份
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) throw httpError(401, "未登录");
    const resp = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      method: "GET",
      headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: authHeader },
    });
    const text = await resp.text();
    if (!resp.ok) throw httpError(401, "身份验证失败");
    const user = JSON.parse(text);
    return json(user);
  }

  throw httpError(404, "未知认证端点");
}

// ============ 主入口：路由 ============
export default {
  async fetch(request, env) {
    // 处理 CORS 预检
    if (request.method === "OPTIONS") {
      return new Response("ok", { status: 204, headers: corsHeaders() });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "");

    try {
      // 认证代理：/api/auth/<action>（login/refresh/logout/user/password）
      if (path.startsWith("/api/auth/")) return await authProxy(request, env);
      // 通用数据代理：所有业务表 CRUD 经此转发到 PostgREST（RLS 在库层强制）
      if (path.startsWith("/api/")) return await apiProxy(request, env);

      switch (path) {
        case "/submit-attempt": return await submitAttempt(request, env);
        case "/review-attempt": return await reviewAttempt(request, env);
        case "/assign-role":    return await assignRole(request, env);
        case "/admin-create-user": return await adminCreateUser(request, env);
        default: return json({ error: "未知端点" }, 404);
      }
    } catch (e) {
      return errorBody(e);
    }
  },
};
