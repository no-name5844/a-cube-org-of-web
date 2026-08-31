/**
 * 魔方比赛成绩系统 - Cloudflare Workers 单文件版
 * 适用于 Cloudflare 网页控制台的在线编辑器（单文件 Worker，无 import 依赖）。
 *
 * 三个安全端点（同域名下不同路径）：
 *   POST /submit-attempt   成绩提交（编辑员以上，服务端定状态）
 *   POST /review-attempt   审核成绩（审核员+，防自审）
 *   POST /assign-role      角色管理（管理员，只能授低于管理员的角色）
 *
 * 环境变量（在 Worker → Settings → Variables 配置）：
 *   SUPABASE_URL        如 https://xxxx.supabase.co
 *   SUPABASE_ANON_KEY   Supabase Anon Key（公开可下发；仅作 apikey 头，权限由 RLS 强制）
 *
 * 安全说明：本 Worker 不持有 SERVICE_ROLE_KEY。所有数据库操作均以调用者的登录
 * JWT 身份执行，由数据库 RLS 在数据库层强制权限，故 Workers 环境不存在可绕过 RLS
 * 的高权限凭证，泄露面降到最低。
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

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
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
  "solve_steps", "step_comments", "is_dnf", "is_dns", "is_plus_two",
  "video_url", "notes",
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

// ============ 主入口：路由 ============
export default {
  async fetch(request, env) {
    // 处理 CORS 预检
    if (request.method === "OPTIONS") {
      return new Response("ok", {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "authorization, content-type",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
        },
      });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "");

    try {
      switch (path) {
        case "/submit-attempt": return await submitAttempt(request, env);
        case "/review-attempt": return await reviewAttempt(request, env);
        case "/assign-role":    return await assignRole(request, env);
        default: return json({ error: "未知端点" }, 404);
      }
    } catch (e) {
      return errorBody(e);
    }
  },
};
