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

        // 初始化登录状态（恢复会话、加载角色、按角色显隐界面）
        await initAuth();

        // 加载所有数据
        await loadAllData();
        
    } catch (err) {
        console.error('数据库连接失败：', err);
        showAlert('❌ 连接失败：' + err.message, 'error');
    }
}

/**
 * 检查数据库是否已连接
 */
function checkDB() {
    if (!dbClient) {
        showAlert('⚠️ 请先连接数据库', 'error');
        return false;
    }
    return true;
}
