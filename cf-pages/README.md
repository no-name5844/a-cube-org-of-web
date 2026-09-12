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

Cloudflare 官方文档明确：`_worker.js` 同时被 Wrangler 与**网页端拖拽上传**支持。

## 目录结构

```
cf-pages/
├── README.md          # 本文件（不参与部署）
└── dist/
    └── _worker.js     # ← 部署目录，拖拽/上传这个文件夹
```

`dist/_worker.js` 是 `cf-workers/worker.js` 的副本（仅多一段头部注释）。
**改后端逻辑请改 `cf-workers/worker.js`**，然后同步：

```bash
cp cf-workers/worker.js cf-pages/dist/_worker.js
```

## ⚠️ 不要走 Workers 流程

Dashboard 里 `Create application → Workers → Import a repository` 那条路（界面写着
"Configure your Worker project"、Deploy command 填 `npx wrangler deploy`）**不是我们要的**：

1. 它产出的是 `*.workers.dev` 地址 —— 正是被 SNI 封锁的那个域名，等于白做；
2. 它还会直接失败：仓库**根目录没有 `wrangler.toml` / `wrangler.jsonc`**
   （配置在 `cf-workers/` 子目录里），`npx wrangler deploy` 找不到入口点会报错。

要的是 **Pages**。

## 控制台新版 / 旧版的差异（2026-09 实测）

Cloudflare 正在把 Pages 收编进新版统一流程：

- **新版控制台**：`Create application` 的 Git 导入默认走 **Workers**，
  界面只有 `Build command` / `Deploy command`，**没有 Pages 入口、也没有
  `Build output directory` 这个设置**。
- **旧版控制台**：Pages 入口仍在，含 `Framework preset` / `Build command` /
  `Build output directory` 三项。

**解决**：直接用**旧版控制台**建 Pages 项目即可 —— 新旧只是控制台 UI 差异，
建出来的是同一种 Pages 项目，域名同样是 `*.pages.dev`，功能完全一致。
若旧版里有 **Upload assets / 拖拽上传** 入口，那是最省事的（不必配任何 build 设置）。

## 部署步骤（推荐：拖拽上传，无需 Git / 无需构建）

1. Dashboard → **Workers & Pages** → **Create application** → **Get started**
   → **Drag and drop your files**（Pages 区块，不是 Workers）
2. 项目名填 `cube-api`（或任意名字）→ 得到 `https://<项目名>.pages.dev`
3. 把 **`cf-pages/dist` 这个文件夹**拖进上传框（里面只有 `_worker.js`）
4. **Save and Deploy**
5. 进项目 → **Settings** → **Variables and Secrets**，添加 3 个**生产环境**变量：
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`（选 **Secret** 类型，勿泄露）
6. **变量改动必须重新部署才生效**：Deployments → **Create new deployment**
   → 再拖一次 `cf-pages/dist` 文件夹
7. 把分配到的 `https://<项目名>.pages.dev` 发我，我改前端配置

### 备选 A：Git 集成（改了自动部署）

入口是 **Pages** 的 `Connect to Git`，不是 Workers 的 Import a repository。

- 仓库选 `Cube-student-org/a-cube-org-of-web`
- Framework preset：`None`
- Build command：**留空**
- **Build output directory：`cf-pages/dist`**
- 环境变量同样在 Settings → Variables and Secrets 里配，配完 **Retry deployment**

### 备选 B：Wrangler 直传（本机有 Node，绕开控制台 UI 差异）

`api.cloudflare.com` 在本网络实测可达（TLS 0.81s），所以这条路不受新版/旧版控制台影响。

```bash
npx wrangler login                                    # 浏览器授权一次
npx wrangler pages project create cube-api --production-branch main
npx wrangler pages deploy cf-pages/dist --project-name cube-api
```

也可以用 API Token 免交互（免去浏览器授权）：

```bash
export CLOUDFLARE_API_TOKEN=<在 My Profile → API Tokens 创建，权限含 账户 → Cloudflare Pages → 编辑>
npx wrangler pages deploy cf-pages/dist --project-name cube-api
```

环境变量仍需在 Dashboard 里设置，`wrangler` 不会上传它们。

## 最后一步：改前端配置

把 `js/config.js` 里的 `WORKERS_BASE_URL` 改成拿到的 `https://<项目名>.pages.dev`，推送前端。

## 注意事项

- 高级模式下 `_worker.js` **接管全部请求**。本项目是纯 API 站点、无静态资源，
  所以访问 `/` 返回 `{"error":"未知端点"}` 属**正常现象**，不是故障。
- 环境变量改动后不重新部署则不生效，这是最常见的"改了没反应"原因。
- 用拖拽方式建的项目**日后不能切换成 Git 集成**，需要新建项目；若想要自动部署，
  一开始就选备选 A。
- 若日后拿到自有域名：绑到 Pages 项目（Custom domains）或绑回原 Worker 都行，
  自有域名一般不触发 SNI 封锁，是最稳的长期方案。
- 原 Worker 建议保留不动，作为备用入口；两条路跑的是同一份代码。
