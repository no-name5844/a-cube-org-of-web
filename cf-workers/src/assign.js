/**
 * 用户角色管理（安全敏感）
 *   - 校验调用者 JWT → 现读数据库角色 → 管理员(admin)才可操作
 *   - 规则在服务端强制：只能授予 user/editor/reviewer（不能授 admin）；
 *     不能修改其他管理员；不能修改自己
 * body: { userId, role }
 */
import { verifyCallerJwt, fetchUserRole, supabaseRest, json, httpError } from "./lib.js";

const ASSIGNABLE_ROLES = ["user", "editor", "reviewer"];

export async function assignRole(request, env) {
  const { uid } = await verifyCallerJwt(env, request.headers.get("Authorization"));

  const myRole = await fetchUserRole(env, uid);
  if (myRole !== "admin") {
    throw httpError(403, "需要管理员权限");
  }

  const body = await request.json().catch(() => null);
  const { userId, role } = body || {};
  if (!userId || !ASSIGNABLE_ROLES.includes(role)) {
    throw httpError(400, "参数错误：role 只能是 user/editor/reviewer");
  }
  if (userId === uid) {
    throw httpError(400, "不能修改自己的角色");
  }

  // 目标用户必须存在且不是管理员
  const targetResp = await supabaseRest(env, {
    path: "/rest/v1/profiles",
    params: `select=id,role&id=eq.${userId}`,
    method: "GET",
  });
  if (!targetResp.ok) throw httpError(500, "查询目标用户失败");
  const targets = await targetResp.json();
  const target = Array.isArray(targets) ? targets[0] : null;
  if (!target) throw httpError(404, "目标用户不存在");
  if (target.role === "admin") {
    throw httpError(403, "不能修改其他管理员的角色");
  }

  const updResp = await supabaseRest(env, {
    path: "/rest/v1/profiles",
    method: "PATCH",
    params: `id=eq.${userId}`,
    body: { role, updated_at: new Date().toISOString() },
  });
  if (!updResp.ok) {
    const err = await updResp.json().catch(() => null);
    throw httpError(500, (err && err.message) || "修改角色失败");
  }

  return json({ ok: true, role });
}
