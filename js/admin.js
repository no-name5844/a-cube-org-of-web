/**
 * 管理功能：审核队列（审核员+）与用户管理（管理员）
 */

// var 用于审核队列与用户表的全局表格实例
var reviewTable = null;
var usersTable = null;

// ============================================
// 审核队列（审核员 / 管理员）
// ============================================

// 加载待审核成绩
async function loadPendingAttempts() {
    if (!isReviewerOrAbove()) return;
    var { data, error } = await db('attempts')
        .select('*, participants(name), competition_events(competitions(name), events(event_name))')
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
    if (error) { showAlert('加载待审核成绩失败：' + error.message, 'error'); return; }

    if (reviewTable) reviewTable.destroy();
    reviewTable = new Tabulator('#review-table', {
        data: data,
        layout: 'fitColumns',
        rowHeight: 26,
        headerHeight: 28,
        columns: [
            { title: '选手', field: 'participants.name' },
            { title: '项目', field: 'competition_events.events.event_name' },
            { title: '比赛', field: 'competition_events.competitions.name' },
            { title: '次数', field: 'attempt_number', width: 70 },
            { title: '时间', width: 90, formatter: function (cell) {
                var row = cell.getRow().getData();
                if (row.is_dnf) return 'DNF';
                if (!row.solve_time) return '-';
                return row.solve_time + (row.is_plus_two ? '+' : '');
            }},
            { title: '魔方', field: 'cube_type', width: 90 },
            { title: '操作', width: 150, formatter: function () {
                return '<button class="btn btn-success" style="padding:5px 10px;">✅ 通过</button>' +
                       '<button class="btn btn-danger" style="padding:5px 10px;margin-left:4px;">❌ 驳回</button>';
            }, cellClick: function (e, cell) {
                // 根据点击的按钮决定通过还是驳回
                var isApprove = e.target && e.target.textContent.indexOf('通过') !== -1;
                reviewAttempt(cell.getRow().getData().id, isApprove ? 'approved' : 'rejected');
            }}
        ]
    });
    var count = data ? data.length : 0;
    document.getElementById('review-count').textContent =
        count > 0 ? ('共 ' + count + ' 条待审核') : '暂无待审核成绩';
}

// 审核成绩：强制走 Cloudflare Workers review-attempt（服务端验身份、定审核人，前端无法伪造）
async function reviewAttempt(attemptId, status) {
    if (!currentUser) { showAlert('请先登录', 'error'); return; }
    var action = status === 'approved' ? 'approve' : 'reject';
    var res = await callWorker('/review-attempt', { attemptId: attemptId, action: action });
    if (!res.ok) { showAlert('审核操作失败：' + (res.error.message || '请确认已登录且具备审核权限'), 'error'); return; }
    showAlert(res.data && res.data.status === 'approved' ? '✅ 已通过' : '❌ 已驳回', 'success');
    loadPendingAttempts();
    if (typeof loadRecentAttempts === 'function') loadRecentAttempts();
}

// ============================================
// 用户管理（管理员）
// ============================================

// 加载用户列表
async function loadProfiles() {
    if (!isAdmin()) return;
    var { data, error } = await db('profiles')
        .select('*')
        .order('created_at', { ascending: true });
    if (error) { showAlert('加载用户失败：' + error.message, 'error'); return; }

    if (usersTable) usersTable.destroy();
    usersTable = new Tabulator('#users-table', {
        data: data,
        layout: 'fitColumns',
        rowHeight: 26,
        headerHeight: 28,
        columns: [
            { title: '用户ID', field: 'user_code', width: 110, formatter: function (cell) {
                return '<code>' + (cell.getValue() || '-') + '</code>';
            }},
            { title: '用户名', field: 'username' },
            { title: '角色', width: 160, formatter: function (cell) {
                var role = cell.getValue();
                return '<span class="role-badge role-' + role + '">' + (ROLE_LABELS[role] || role) + '</span>';
            }},
            { title: '改为', width: 180, formatter: function (cell) {
                var role = cell.getRow().getData().role;
                // 管理员身份不可修改，且只能授予低于管理员的角色
                if (role === 'admin') return '<span style="color:#999;font-size:12px;">—</span>';
                var options = ['user', 'editor', 'reviewer'].map(function (r) {
                    return '<option value="' + r + '"' + (r === role ? ' selected' : '') + '>' +
                           (ROLE_LABELS[r]) + '</option>';
                }).join('');
                return '<select class="role-select" onchange="changeUserRole(\'' +
                       cell.getRow().getData().id + '\', this.value, this)">' + options + '</select>';
            }},
            { title: '注册时间', field: 'created_at', width: 160, formatter: function (cell) {
                return cell.getValue() ? cell.getValue().split('T')[0] : '';
            }}
        ]
    });
}

// 修改用户角色（仅能操作低于管理员的人，且新角色必须低于管理员）
var ASSIGNABLE_ROLES = ['user', 'editor', 'reviewer'];

async function changeUserRole(userId, newRole, sel) {
    if (!isAdmin()) { showAlert('需要管理员权限', 'error'); return; }

    // 取该行原角色，失败时就地回退下拉框（不再整表重载，避免打断管理员操作）
    var prevRole = null;
    if (usersTable) {
        var row = usersTable.getRow(userId);
        if (row) prevRole = row.getData().role;
    }
    var revert = function () {
        if (!sel) return;
        if (prevRole) sel.value = prevRole;
        sel.classList.add('is-error');
        setTimeout(function () { sel.classList.remove('is-error'); }, 1500);
    };

    if (ASSIGNABLE_ROLES.indexOf(newRole) === -1) {
        showAlert('不能授予管理员及以上角色', 'error');
        revert();
        return;
    }
    // 强制走 Cloudflare Workers assign-role：服务端验管理员身份并强制「只能授低于管理员的角色」
    var res = await callWorker('/assign-role', { userId: userId, role: newRole });
    if (!res.ok) { showAlert('修改角色失败：' + (res.error.message || '请确认已登录且为管理员'), 'error'); revert(); return; }
    showAlert('✅ 角色已更新为「' + (ROLE_LABELS[newRole] || newRole) + '」', 'success');
    loadProfiles();
}

// 管理员创建账号（ID + 初始密码 + 角色 + 昵称），走 worker 的 admin-create-user
async function createAccount() {
    if (!currentUser) { showAlert('请先登录', 'error'); return; }
    if (!isAdmin()) { showAlert('需要管理员权限', 'error'); return; }
    var code = document.getElementById('new-user-code').value.trim();
    var password = document.getElementById('new-user-password').value;
    var nickname = document.getElementById('new-user-nickname').value.trim();
    var role = document.getElementById('new-user-role').value;
    if (!code || !password) { showAlert('用户ID和初始密码必填', 'error'); return; }

    var res = await callWorker('/admin-create-user', {
        user_code: code, password: password, nickname: nickname, role: role
    });
    if (!res.ok) { showAlert('创建失败：' + (res.error && res.error.message ? res.error.message : '未知错误'), 'error'); return; }
    showAlert('✅ 账号「' + code + '」已创建（角色：' + (ROLE_LABELS[role] || role) + '）', 'success');
    document.getElementById('new-user-password').value = '';
    loadProfiles();
}
