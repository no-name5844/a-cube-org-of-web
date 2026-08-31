// Edge Function: submit-attempt
// 成绩提交。安全敏感操作，强制走云函数：
//   1. 验明调用者身份并从数据库现读角色
//   2. 只有编辑员(editor)/审核员(reviewer)/管理员(admin)可提交；普通用户与匿名拒绝
//   3. status 由服务端决定：admin → approved 直接生效；editor/reviewer → pending 待审核
//   4. submitted_by 取服务端身份；字段白名单过滤，前端多余字段一律丢弃
// 调用方式: POST /functions/v1/submit-attempt
// body: { competition_event_id, participant_id, attempt_number, solve_time, cube_type,
//         is_dnf, is_plus_two, move_count, tps, video_url, scramble, notes }

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

// 字段白名单：前端传来的数据只取这些字段，其余（如 status/submitted_by）一律忽略
const ALLOWED_FIELDS = [
  "competition_event_id", "participant_id", "attempt_number",
  "solve_time", "cube_type", "scramble", "move_count", "tps",
  "solve_steps", "step_comments", "is_dnf", "is_plus_two",
  "video_url", "notes",
] as const;

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

    // 2. 角色完全信任数据库：编辑员及以上才可提交
    const { data: profile } = await admin
      .from("profiles").select("role").eq("id", uid).maybeSingle();
    const role = profile?.role as string | undefined;
    if (!["editor", "reviewer", "admin"].includes(role ?? "")) {
      return json({ error: "需要编辑员及以上权限才能提交成绩" }, 403);
    }

    // 3. 白名单过滤 + 必填校验
    const body = await req.json();
    if (!body.competition_event_id || !body.participant_id || !body.cube_type) {
      return json({ error: "缺少必填字段：competition_event_id / participant_id / cube_type" }, 400);
    }
    const record: Record<string, unknown> = { submitted_by: uid };
    for (const f of ALLOWED_FIELDS) {
      if (body[f] !== undefined && body[f] !== null && body[f] !== "") {
        record[f] = body[f];
      }
    }

    // 4. status 由服务端按数据库角色决定，前端传什么都不算数
    record.status = role === "admin" ? "approved" : "pending";

    // 5. 写入
    const { data, error } = await admin
      .from("attempts").insert(record).select("id, status").single();
    if (error) return json({ error: error.message }, 500);

    return json({ ok: true, id: data.id, status: data.status });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
