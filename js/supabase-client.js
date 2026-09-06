/**
 * Supabase 客户端初始化
 * 从 config-bar 读取 URL 和 Key，存储到 localStorage
 */

var dbClient = null;
var currentTab = 'competitions';

/**
 * 连接数据库
 */
async function connectDB() {
    var url = document.getElementById('supabase-url').value.trim();
    var key = document.getElementById('supabase-key').value.trim();
    
    if (!url || !key) {
        showAlert('请输入 Supabase URL 和 Anon Key', 'error');
        return;
    }
    
    try {
        dbClient = supabase.createClient(url, key);

        // 测试连接
        var { data, error } = await dbClient.from('competitions').select('id').limit(1);
        if (error) throw error;

        // 保存到 localStorage
        localStorage.setItem('supabase_url', url);
        localStorage.setItem('supabase_key', key);

        showAlert('✅ 数据库连接成功！', 'success');
        collapseSetup();   // 连接成功后收起设置条，页头显示「已连接 · 更改」

        // 初始化登录状态（恢复会话、加载角色、按角色显隐界面）
        await initAuth();

        // 加载所有数据
        await loadAllData();

    } catch (err) {
        dbClient = null;
        console.error('数据库连接失败：', err);
        showAlert('❌ 连接失败：' + err.message, 'error');
        openSetup();       // 失败时重新展开设置条，便于修正凭据
    }
}

/**
 * 展开数据库连接设置条（供「已连接 · 更改」按钮与连接失败时使用）
 */
function openSetup() {
    var bar = document.getElementById('setup-bar');
    var btn = document.getElementById('btn-reconnect');
    if (bar) bar.hidden = false;
    if (btn) btn.hidden = true;
}

/**
 * 收起数据库连接设置条，改为显示「已连接 · 更改」按钮
 */
function collapseSetup() {
    var bar = document.getElementById('setup-bar');
    var btn = document.getElementById('btn-reconnect');
    if (bar) bar.hidden = true;
    if (btn) btn.hidden = false;
}
