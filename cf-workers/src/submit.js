/**
 * 成绩提交（安全敏感）
 *   - 校验调用者 JWT → 现读数据库角色 → 编辑员(editor)及以上才可提交
 *   - status 由服务端定：admin → approved 直接生效；editor/reviewer → pending 待审核
 *   - submitted_by 取服务端身份；字段白名单过滤，前端多余字段（伪造 status/submitted_by）一律丢弃
 * body: { competition_event_id, participant_id, attempt_number, solve_time, cube_type,
 *         is_dnf, is_plus_two, move_count, tps, video_url, scramble, notes }
 */
import { verifyCallerJwt, fetchUserRole, supabaseRest, json, httpError } from "./lib.js";

// 字段白名单：前端传来的数据只取这些，其余（status/submitted_by 等）一律忽略
const ALLOWED_FIELDS = [
  "competition_event_id", "participant_id", "attempt_number",
  "solve_time", "cube_type", "scramble", "move_count", "tps",
  "solve_steps", "step_comments", "is_dnf", "is_plus_two",
  "video_url", "notes",
];

export async function submitAttempt(request, env) {
  const { uid } = await verifyCallerJwt(env, request.headers.get("Authorization"));

  // 角色完全信任数据库
  const role = await fetchUserRole(env, uid);
  if (!["editor", "reviewer", "admin"].includes(role)) {
    throw httpError(403, "需要编辑员及以上权限才能提交成绩");
  }

  const body = await request.json().catch(() => null);
  if (!body || !body.competition_event_id || !body.participant_id || !body.cube_type) {
    throw httpError(400, "缺少必填字段：competition_event_id / participant_id / cube_type");
  }

  // 白名单过滤
  const record = { submitted_by: uid };
  for (const f of ALLOWED_FIELDS) {
    if (body[f] !== undefined && body[f] !== null && body[f] !== "") {
      record[f] = body[f];
    }
  }
  // status 由服务端决定
  record.status = role === "admin" ? "approved" : "pending";

  const resp = await supabaseRest(env, {
    path: "/rest/v1/attempts",
    method: "POST",
    params: "select=id,status",
    body: record,
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => null);
    throw httpError(500, (err && err.message) || "提交失败");
  }
  const inserted = await resp.json();
  const row = Array.isArray(inserted) ? inserted[0] : inserted;

  return json({ ok: true, id: row && row.id, status: row && row.status });
}
