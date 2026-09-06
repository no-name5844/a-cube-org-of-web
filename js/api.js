/**
 * 业务数据访问统一走 Cloudflare Workers（云函数）的通用 /api/* 代理。
 * 浏览器不再直连 Supabase 数据表——所有表的读取/增删改都经过 Worker，
 * 由数据库 RLS 在库层强制权限。
 *
 * 登录 JWT 由本地会话层（session.js + config.js）管理——登录经 Worker 的
 * /api/auth/* 换取 access token；数据访问随请求带 Authorization 发给 Worker，
 * Worker 以调用者身份转发到 PostgREST，由 RLS 在库层强制权限。
 *
 * 设计：db(table) 返回链式构建器，语法尽量对齐 supabase-js，便于从
 *   dbClient.from('t').select('*').order('c')
 * 平滑迁移为
 *   db('t').select('*').order('c')
 * 统一返回 { data, error } 形态。
 */

/**
 * 从本地会话取登录 JWT（仅用于发给 Worker；token 由 config/session 层管理）。
 * 返回空串 = 匿名（读公开数据仍可走 Worker 匿名通道）。
 */
async function getApiToken() {
  try {
    var token = await authToken();
    return token || "";
  } catch (e) { return ""; }
}

/**
 * 底层请求：发到 Worker 的 /api/<restPath>
 * @param {string} method  GET/POST/PATCH/DELETE
 * @param {string} restPath 如 "competitions?select=*&order=competition_number"
 * @param {object} [body]  写操作请求体
 * @returns {Promise<any>} 解析后的 JSON（数组或对象）
 */
async function apiFetch(method, restPath, body) {
  var token = await getApiToken();
  var headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = "Bearer " + token;
  if (body !== undefined) headers["Prefer"] = "return=representation";

  var resp = await fetch(WORKERS_BASE_URL + "/api/" + restPath, {
    method: method,
    headers: headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  var data = await resp.json().catch(function () { return null; });
  if (!resp.ok) {
    var msg = (data && (data.error || data.message)) || ("请求失败(" + resp.status + ")");
    var err = new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
    err.status = resp.status;
    err.data = data;
    throw err;
  }
  return data;
}

/**
 * 链式数据构建器（对齐 supabase-js 常用用法）
 *   db("competitions").select("*").order("competition_number")
 *   db("competitions").insert({ ... })
 *   db("competitions").update({ ... }).eq("id", id)
 *   db("competitions").delete().eq("id", id)
 * await 后返回 { data, error }
 */
function db(table) {
  var q = {
    table: table, method: "GET", select: "*",
    filters: [], orders: [], limit: null, single: false, body: undefined,
  };

  function buildQuery() {
    var parts = [];
    if (q.select) parts.push("select=" + encodeURIComponent(q.select.replace(/\s+/g, "")));
    for (var i = 0; i < q.filters.length; i++) parts.push(q.filters[i]);
    if (q.orders.length) {
      var ord = q.orders.map(function (o) { return o.col + "." + o.dir; });
      parts.push("order=" + encodeURIComponent(ord.join(",")));
    }
    if (q.limit != null) parts.push("limit=" + q.limit);
    return parts.join("&");
  }

  async function exec() {
    try {
      var query = buildQuery();
      var path;
      if (q.method === "GET") {
        path = q.table + (query ? "?" + query : "");
      } else {
        // 写操作：定位条件拼到 query（PostgREST 用 ?id=eq.x 定位目标行）
        path = q.table + (q.filters.length ? "?" + q.filters.join("&") : "");
      }
      var data = await apiFetch(q.method, path, q.body);
      // .single()/.maybeSingle()：supabase 返回单对象，这里取数组首项近似
      if (q.single && Array.isArray(data)) data = data.length ? data[0] : null;
      return { data: data, error: null };
    } catch (e) {
      return { data: null, error: { message: e.message, status: e.status } };
    }
  }

  var api = {
    select: function (cols) { q.select = cols || "*"; return api; },
    // order(col, { ascending: false }) 支持降序；可多次调用形成多段排序
    order: function (col, opts) {
      var dir = (opts && opts.ascending === false) ? "desc" : "asc";
      q.orders.push({ col: col, dir: dir });
      return api;
    },
    limit: function (n) { q.limit = n; return api; },
    eq: function (col, val) { q.filters.push(col + "=eq." + val); return api; },
    is: function (col, val) { q.filters.push(col + "=is." + val); return api; },
    single: function () { q.single = true; return api; },
    maybeSingle: function () { q.single = true; return api; },
    insert: function (row) { q.method = "POST"; q.body = row; return api; },
    update: function (row) { q.method = "PATCH"; q.body = row; return api; },
    delete: function () { q.method = "DELETE"; return api; },
    // 让构建器可被 await：触发执行并返回 { data, error }
    then: function (resolve, reject) { return exec().then(resolve, reject); },
  };
  return api;
}
