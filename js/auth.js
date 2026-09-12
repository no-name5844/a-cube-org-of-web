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

// ---- 初始化（connectDB 探测 worker 成功后调用）----
async function initAuth() {
  // 从本地会话恢复登录态（token 经 Worker /api/auth/* 取得并持久化）
  await setAuthUser(session.user() || null);

  // 账号信息完全信任数据库：窗口聚焦时同步一次（切回页面即刷新，最及时）
  window.addEventListener('focus', refreshMyProfile);
  // 兜底轮询放宽到 5 分钟一次（角色变更靠 focus 即可即时生效，无需高频轮询）
  setInterval(refreshMyProfile, 300000);
}

// 从数据库重新读取当前用户的资料与角色（数据库是唯一可信来源）
async function refreshMyProfile() {
  if (!currentUser) return;
  var { data: profile, error } = await db('profiles')
    .select('*')
    .eq('id', currentUser.id)
    .maybeSingle();
  if (error || !profile) return;

  var newRole = profile.role || 'user';
  var roleChanged = newRole !== currentRole;
  var nameChanged = !currentProfile ||
      currentProfile.username !== profile.username ||
      currentProfile.user_code !== profile.user_code;
  currentProfile = profile;
  currentRole = newRole;
  // 只有角色 / 昵称真的变了才重渲染，避免每次轮询都无谓写 DOM
  if (roleChanged || nameChanged) renderAuthUI();
  if (roleChanged) applyRoleUI();
}

// 设置当前用户并加载角色
async function setAuthUser(user) {
  currentUser = user;
  currentProfile = null;
  currentRole = 'anon';

  if (user) {
    var { data: profile, error } = await db('profiles')
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

// ---- 登录 / 登出 ----

// 登录错误就地提示：显示在表单正下方（比顶部 toast 更贴近触发点），并把焦点移回用户ID
function showAuthError(msg) {
  var box = document.getElementById('auth-error');
  if (!box) { showAlert(msg, 'error'); return; }
  box.textContent = msg;
  box.hidden = false;
  var code = document.getElementById('auth-code');
  if (code) code.focus();
}

function clearAuthError() {
  var box = document.getElementById('auth-error');
  if (box) { box.hidden = true; box.textContent = ''; }
}

async function signIn() {
  clearAuthError();
  var code = document.getElementById('auth-code').value.trim();
  var password = document.getElementById('auth-password').value;
  if (!code || !password) { showAuthError('请输入用户ID和密码'); return; }

  // 登录经 Worker /api/auth/login（code → code@cube.local 映射在服务端完成）
  var res = await callWorkerAuth('login', { code: code, password: password }, true);
  if (!res.ok) {
    showAuthError('登录失败：' + (res.error && res.error.message ? res.error.message : '请检查ID和密码'));
    return;
  }
  if (!res.data || !res.data.access_token) {
    showAuthError('登录失败：未取得会话');
    return;
  }
  session.set(res.data);
  await setAuthUser(session.user());
  clearAuthError();
  var pwdEl = document.getElementById('auth-password');
  if (pwdEl) pwdEl.value = '';
  showAlert('✅ 登录成功！', 'success');
}

async function signOutNow() {
  var storedRefresh = localStorage.getItem('wb_refresh');
  if (storedRefresh) await callWorkerAuth('logout', { refresh_token: storedRefresh }, true);
  session.clear();
  currentUser = null;
  currentProfile = null;
  currentRole = 'anon';
  clearAuthError();
  renderAuthUI();
  applyRoleUI();
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
        // 展示专属用户 ID（如 u00000001）；不再回退到内部 email（code@cube.local）
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
    // 权限足够时才刷新对应数据（数据经 Worker /api/*，无需连接态即可匿名读公开数据）
    if (rank >= ROLE_RANK.user && typeof loadMyProfile === 'function') loadMyProfile();
    if (isReviewerOrAbove() && typeof loadPendingAttempts === 'function') loadPendingAttempts();
    if (isAdmin() && typeof loadProfiles === 'function') loadProfiles();
    // 登出/被降权后，若当前面板已不可见，自动落到第一个可见标签页（避免停在越权空白页）
    if (typeof ensureVisibleTab === 'function') ensureVisibleTab();
}
