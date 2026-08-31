// Edge Function: review-attempt
// 审核成绩（通过/驳回）。安全敏感操作，强制走云函数：
//   1. 用调用者 JWT 验明身份（Supabase 网关已先做 verify_jwt）
//   2. 从数据库现读调用者角色，要求审核员(reviewer)或管理员(admin)
//   3. reviewed_by 一律取服务端解析出的身份，前端无法伪造审核人
// 调用方式: POST /functions/v1/review-attempt  body: { attemptId, action: 'approve' | 'reject' }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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

    // SERVICE_ROLE 客户端：仅在服务端自校验之后使用，绕过 RLS 完成受控写入
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
    const { data: profile } = await admin
      .from("profiles").select("role").eq("id", uid).maybeSingle();
    const role = profile?.role as string | undefined;
    if (role !== "reviewer" && role !== "admin") {
      return json({ error: "需要审核员及以上权限" }, 403);
    }

    // 3. 参数校验
    const { attemptId, action } = await req.json();
    if (!attemptId || !["approve", "reject"].includes(action)) {
      return json({ error: "参数错误：需要 attemptId 与 action(approve/reject)" }, 400);
    }
    const status = action === "approve" ? "approved" : "rejected";

    // 4. 查目标成绩并校验：不允许审核自己提交的成绩（防自审）；只允许审核待审状态
    const { data: target } = await admin
      .from("attempts").select("id, status, submitted_by")
      .eq("id", attemptId).maybeSingle();
    if (!target) return json({ error: "成绩不存在" }, 404);
    if (target.submitted_by === uid) {
      return json({ error: "不能审核自己提交的成绩" }, 403);
    }
    if (target.status !== "pending") {
      return json({ error: "只能审核待审核状态的成绩" }, 400);
    }

    // 5. 执行审核：reviewed_by 取服务端身份，前端传什么都不算数
    const { error } = await admin
      .from("attempts")
      .update({ status, reviewed_by: uid, reviewed_at: new Date().toISOString() })
      .eq("id", attemptId)
      .eq("status", "pending"); // 双保险：仅当仍为 pending 才更新
    if (error) return json({ error: error.message }, 500);

    return json({ ok: true, status });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
