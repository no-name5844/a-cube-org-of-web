/**
 * 单一 Worker 入口：路由到三个安全操作
 *   POST /submit-attempt   成绩提交（编辑员以上，服务端定状态）
 *   POST /review-attempt   审核成绩（审核员+，防自审）
 *   POST /assign-role      角色管理（管理员，只能授低于管理员的角色）
 *
 * 部署：wrangler deploy（Cloudflare Dashboard 配对应路由）
 */
import { handleOptions, json, errorBody } from "./lib.js";
import { submitAttempt } from "./submit.js";
import { reviewAttempt } from "./review.js";
import { assignRole } from "./assign.js";

export default {
  async fetch(request, env, ctx) {
    const preflight = handleOptions(request);
    if (preflight) return preflight;

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "");

    try {
      switch (path) {
        case "/submit-attempt":
          return await submitAttempt(request, env);
        case "/review-attempt":
          return await reviewAttempt(request, env);
        case "/assign-role":
          return await assignRole(request, env);
        default:
          return json({ error: "未知端点" }, 404);
      }
    } catch (e) {
      return errorBody(e);
    }
  },
};
