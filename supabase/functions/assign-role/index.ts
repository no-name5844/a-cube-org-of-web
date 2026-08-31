// Edge Function: assign-role
// 用户角色管理。安全敏感操作，强制走云函数：
//   1. 验明调用者身份并从数据库现读角色，要求管理员(admin)
//   2. 规则在服务端强制：只能授予 user/editor/reviewer，不能授予 admin；
//      不能修改其他管理员；不能修改自己（管理员不可被任何人改，含自己）
// 调用方式: POST /functions/v1/assign-role  body: { userId, role }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ASSIGNABLE_ROLES = ["user", "editor", "reviewer"];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "未登录" }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1. 验明调用者身份
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData.user) return json({ error: "身份验证失败" }, 401);
    const uid = userData.user.id;

    // 2. 角色完全信任数据库
    const { data: myProfile } = await admin
      .from("profiles").select("role").eq("id", uid).maybeSingle();
    if (myProfile?.role !== "admin") {
      return json({ error: "需要管理员权限" }, 403);
    }

    // 3. 参数校验：授予的角色必须低于管理员
    const { userId, role } = await req.json();
    if (!userId || !ASSIGNABLE_ROLES.includes(role)) {
      return json({ error: "参数错误：role 只能是 user/editor/reviewer" }, 400);
    }
    if (userId === uid) {
      return json({ error: "不能修改自己的角色" }, 400);
    }

    // 4. 目标用户必须存在且不是管理员
    const { data: target, error: targetErr } = await admin
      .from("profiles").select("id, role").eq("id", userId).maybeSingle();
    if (targetErr || !target) return json({ error: "目标用户不存在" }, 404);
    if (target.role === "admin") {
      return json({ error: "不能修改其他管理员的角色" }, 403);
    }

    // 5. 执行修改
    const { error } = await admin
      .from("profiles").update({ role, updated_at: new Date().toISOString() })
      .eq("id", userId);
    if (error) return json({ error: error.message }, 500);

    return json({ ok: true, role });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
