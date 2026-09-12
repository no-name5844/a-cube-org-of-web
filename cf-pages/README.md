# 后端迁移到 Cloudflare Pages（绕开 workers.dev 封锁）

## 为什么要迁移

国内网络对 `*.workers.dev` 是**双重封锁**（2026-09-12 实测）：

| 层面 | 现象 | 结论 |
|---|---|---|
| DNS | `silent-voice-7c84.…workers.dev` 解析到 `157.240.1.9` / `2a03:2880:f112:83:face:b00c:0:25de` | 被投毒，返回 Facebook IP 段 |
| TCP | 指定真实 IP `172.67.139.214` 后 TCP 握手成功（0.21s） | 网络层可达 |
| TLS | 同一连接上 `schannel: failed to receive handshake` | **SNI 被识别后掐断** |

因为拦在 **SNI 层**，改 hosts、换 DNS 都没用，必须换域名。

实测 `*.pages.dev` 完全可用（同网络下）：

```
vite.pages.dev        HTTP 200   TLS 0.72s
astro.pages.dev       HTTP 200   TLS 0.65s
svelte.pages.dev      HTTP 200   TLS 0.63s
```

且 `pages.dev` 的 DNS 干净（随机子域返回 NXDOMAIN，而 `*.workers.dev` 随机子域会返回伪造 AAAA 记录）。

## 迁移为什么几乎零成本

Pages 的**高级模式**接受与 Worker **完全相同**的 Module 语法（`export default { fetch(request, env) }`）。
本项目 `cf-workers/worker.js` 用的正是这套语法，所以复制过来即可，**代码一行都不用改**。

`_worker.js` 是 `cf-workers/worker.js` 的副本。**改代码请改 `cf-workers/worker.js`**，然后同步：

```bash
cp cf-workers/worker.js cf-pages/_worker.js
```

## 部署步骤（网页端，Git 集成）

1. Cloudflare Dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**
2. 选择仓库 `no-name5844/a-cube-org-of-web`
3. 构建设置（**关键**）：
   - Framework preset：`None`
   - Build command：**留空**
   - Build output directory：`cf-pages`
4. **Save and Deploy**，等首次部署完成
5. 打开该项目 → **Settings** → **Variables and Secrets**，添加 3 个**生产环境**变量：
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`（用 Secret 类型，勿泄露）
6. **改完变量必须重新部署一次**（Deployments → 最近一次 → Retry deployment），否则变量不生效
7. 记下分配到的域名，形如 `https://<项目名>.pages.dev`

### 备选：Wrangler 直传

```bash
npx wrangler pages deploy cf-pages --project-name <项目名>
```

环境变量同样要在 Dashboard 里设置，`wrangler` 不会上传它们。

## 最后一步：改前端配置

把 `js/config.js` 里的 `WORKERS_BASE_URL` 改成第 7 步拿到的 `https://<项目名>.pages.dev`，推送前端即可。

## 注意事项

- 高级模式下 `_worker.js` **接管全部请求**。本项目是纯 API 站点、无静态资源，
  所以访问 `/` 返回 `{"error":"未知端点"}` 属**正常现象**，不是故障。
- 环境变量改动后不重新部署则不生效，这是最常见的"改了没反应"原因。
- 若日后拿到自有域名：绑到 Pages 项目（Custom domains）或绑回原 Worker 都行，
  自有域名一般不触发 SNI 封锁，是最稳的长期方案。
- 原 Worker 建议保留不动，作为备用入口；两条路跑的是同一份代码。
