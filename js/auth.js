/**
 * 认证与角色管理
 * 五个角色：匿名用户(anon) → 普通用户(user) → 编辑员(editor) → 审核员(reviewer) → 管理员(admin)
 */

// 角色等级（数值越大权限越高）
var ROLE_RANK = { anon: 0, user: 1, editor: 2, reviewer: 3, admin: 4 };
var ROLE_LABELS = {
    anon: '匿名用户',
    user: '普通用户',
    editor: '编辑员',
    reviewer: '审核员',
    admin: '管理员'
};

// 当前登录状态
var currentUser = null;      // supabase auth user 对象
var currentProfile = null;   // profiles 表记录
var currentRole = 'anon';    // 当前角色

// ---- 角色判断 ----
function roleAtLeast(role) {
    return ROLE_RANK[currentRole] >= (ROLE_RANK[role] || 0);
}
function isEditorOrAbove() { return roleAtLeast('editor'); }
function isReviewerOrAbove() { return roleAtLeast('reviewer'); }
function isAdmin() { return currentRole === 'admin'; }

// ---- 初始化（在 connectDB 成功后调用）----
async function initAuth() {
    if (!dbClient) return;

    var { data } = await dbClient.auth.getSession();
    if (data && data.session && data.session.user) {
        await setAuthUser(data.session.user);
    } else {
        setAuthUser(null);
    }

    // 监听登录状态变化（含 token 刷新、登出）
    dbClient.auth.onAuthStateChange(function (_event, session) {
        setAuthUser(session ? session.user : null);
    });

    // 账号信息完全信任数据库：窗口聚焦时同步一次
    window.addEventListener('focus', refreshMyProfile);
    // 并每 60 秒从数据库同步一次角色/资料（管理员改角色无需重新登录即生效）
    setInterval(refreshMyProfile, 60000);
}

// 从数据库重新读取当前用户的资料与角色（数据库是唯一可信来源）
async function refreshMyProfile() {
    if (!dbClient || !currentUser) return;
    var { data: profile, error } = await dbClient
        .from('profiles')
        .select('*')
        .eq('id', currentUser.id)
        .maybeSingle();
    if (error || !profile) return;

    var roleChanged = profile.role !== currentRole;
    currentProfile = profile;
    currentRole = profile.role || 'user';
    renderAuthUI();
    if (roleChanged) applyRoleUI();
}

// 设置当前用户并加载角色
async function setAuthUser(user) {
    currentUser = user;
    currentProfile = null;
    currentRole = 'anon';

    if (user && dbClient) {
        var { data: profile, error } = await dbClient
            .from('profiles')
            .select('*')
            .eq('id', user.id)
            .maybeSingle();
        if (!error && profile) {
            currentProfile = profile;
            currentRole = profile.role || 'user';
        } else {
            // profile 尚未由触发器创建（或读取失败），按普通用户对待
            currentRole = 'user';
        }
    }

    renderAuthUI();
    applyRoleUI();
}

// ---- 登录 / 注册 / 登出 ----
async function signIn() {
    if (!checkDB()) return;
    var code = document.getElementById('auth-code').value.trim();
    var password = document.getElementById('auth-password').value;
    if (!code || !password) { showAlert('请输入用户ID和密码', 'error'); return; }
    // 登录ID → 确定的 auth email（与 worker 建号时的映射 code@cube.local 一致）
    var email = code + '@cube.local';

    var { error } = await dbClient.auth.signInWithPassword({ email: email, password: password });
    if (error) { showAlert('登录失败：' + error.message, 'error'); return; }
    showAlert('✅ 登录成功！', 'success');
}

async function signOutNow() {
    if (!dbClient) return;
    await dbClient.auth.signOut();
    showAlert('已退出登录，当前为匿名用户', 'info');
}

// ---- 渲染 ----
function renderAuthUI() {
    var loginForm = document.getElementById('auth-login-form');
    var userInfo = document.getElementById('auth-user-info');
    if (!loginForm || !userInfo) return;

    if (currentUser) {
        loginForm.style.display = 'none';
        userInfo.style.display = 'flex';
        var name = (currentProfile && (currentProfile.username || currentProfile.user_code)) || '用户';
        // 展示专属用户 ID（如 U000001）；不再回退到内部 email（code@cube.local）
        if (currentProfile && currentProfile.user_code) {
            name += '（ID: ' + currentProfile.user_code + '）';
        }
        document.getElementById('auth-user-name').textContent = name;
        var badge = document.getElementById('auth-role-badge');
        badge.textContent = ROLE_LABELS[currentRole] || currentRole;
        badge.className = 'role-badge role-' + currentRole;
    } else {
        loginForm.style.display = 'flex';
        userInfo.style.display = 'none';
    }
}

// 按角色显隐页面元素：带 data-minrole 的元素按最低角色显隐
function applyRoleUI() {
    var rank = ROLE_RANK[currentRole] || 0;
    document.querySelectorAll('[data-minrole]').forEach(function (el) {
        var need = ROLE_RANK[el.getAttribute('data-minrole')] || 0;
        el.style.display = (rank >= need) ? '' : 'none';
    });
    // 权限足够时才刷新对应数据
    if (dbClient) {
        if (rank >= ROLE_RANK.user && typeof loadMyProfile === 'function') loadMyProfile();
        if (isReviewerOrAbove() && typeof loadPendingAttempts === 'function') loadPendingAttempts();
        if (isAdmin() && typeof loadProfiles === 'function') loadProfiles();
    }
}
