/**
 * 应用启动（原「连接 Supabase」已移除——浏览器不再持有 URL/Key）
 * 数据访问与认证全部经 Cloudflare Workers。页面加载即自动：
 *   1) 探测 Worker 可达性（匿名读公开数据，确认后端就绪）
 *   2) 恢复本地会话（登录态）
 *   3) 加载业务数据
 */
var currentTab = 'stats';

/**
 * 应用启动：探测 Worker → 恢复会话 → 加载数据。
 * 由页面末尾 <script> 调用一次即可。
 */
async function bootApp() {
  // 探测 Worker 可用性（读取公开数据走 RLS 匿名通道；匿名用户本就可读 competitions）
  var reachable = false;
  try {
    var { data, error } = await db('competitions').select('id').limit(1);
    reachable = !error;
  } catch (e) { reachable = false; }

  if (!reachable) {
    showAlert('⚠️ 无法连接后端服务，请确认 Worker 已部署且可用', 'error');
    return;
  }

  // 恢复登录态（本地已有会话则作为对应用户，否则匿名）
  await initAuth();
  // 加载业务数据
  await loadAllData();
}
