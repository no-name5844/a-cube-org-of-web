/**
 * 审核成绩（安全敏感）
 *   - 校验调用者 JWT → 现读数据库角色 → 审核员(reviewer)/管理员(admin)才可审核
 *   - 防自审：不能审核自己提交的成绩（submitted_by = uid 拒绝）
 *   - 只能审核 pending 状态；reviewed_by 取服务端身份，前端无法伪造审核人
 * body: { attemptId, action: 'approve' | 'reject' }
 */
import { verifyCallerJwt, fetchUserRole, supabaseRest, json, httpError } from "./lib.js";

export async function reviewAttempt(request, env) {
  const { uid } = await verifyCallerJwt(env, request.headers.get("Authorization"));

  const role = await fetchUserRole(env, uid);
  if (role !== "reviewer" && role !== "admin") {
    throw httpError(403, "需要审核员及以上权限");
  }

  const body = await request.json().catch(() => null);
  const { attemptId, action } = body || {};
  if (!attemptId || !["approve", "reject"].includes(action)) {
    throw httpError(400, "参数错误：需要 attemptId 与 action(approve/reject)");
  }
  const status = action === "approve" ? "approved" : "rejected";

  // 查目标成绩并校验
  const targetResp = await supabaseRest(env, {
    path: "/rest/v1/attempts",
    params: `select=id,status,submitted_by&id=eq.${attemptId}`,
    method: "GET",
  });
  if (!targetResp.ok) throw httpError(500, "查询成绩失败");
  const targets = await targetResp.json();
  const target = Array.isArray(targets) ? targets[0] : null;
  if (!target) throw httpError(404, "成绩不存在");
  if (target.submitted_by === uid) {
    throw httpError(403, "不能审核自己提交的成绩");
  }
  if (target.status !== "pending") {
    throw httpError(400, "只能审核待审核状态的成绩");
  }

  // 执行审核（双保险：仅当仍为 pending 才更新）
  const updResp = await supabaseRest(env, {
    path: "/rest/v1/attempts",
    method: "PATCH",
    params: `id=eq.${attemptId}&status=eq.pending`,
    body: { status, reviewed_by: uid, reviewed_at: new Date().toISOString() },
  });
  if (!updResp.ok) {
    const err = await updResp.json().catch(() => null);
    throw httpError(500, (err && err.message) || "审核失败");
  }

  return json({ ok: true, status });
}
