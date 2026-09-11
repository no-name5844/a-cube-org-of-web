/**
 * 我的档案：账号信息（ID/昵称/密码）+ 个人比赛记录
 * 账户 = ID（唯一标识 user_code）+ 昵称 + 密码（Supabase Auth 管理）+ 比赛记录
 */

var myAttemptsTable = null;

// 加载我的档案（登录后由 applyRoleUI 触发）
async function loadMyProfile() {
    if (!currentUser) return;

    // 1. 刷新最新 profile（防止别处改动后过期）
    var { data: profile } = await db('profiles')
        .select('*')
        .eq('id', currentUser.id)
        .maybeSingle();
    if (profile) {
        currentProfile = profile;
        currentRole = profile.role || 'user';
    }

    // 2. 填充账号信息
    var codeEl = document.getElementById('my-user-code');
    var nickEl = document.getElementById('my-nickname');
    if (codeEl) codeEl.value = currentProfile ? (currentProfile.user_code || '-') : '-';
    if (nickEl) nickEl.value = currentProfile ? (currentProfile.username || '') : '';

    // 角色徽章 + 注册时间（账号元信息）
    var roleBadge = document.getElementById('my-role-badge');
    if (roleBadge) {
        roleBadge.textContent = ROLE_LABELS[currentRole] || currentRole;
        roleBadge.className = 'role-badge role-' + currentRole;
    }
    var sinceEl = document.getElementById('my-created-at');
    if (sinceEl) {
        sinceEl.textContent = (currentProfile && currentProfile.created_at)
            ? ('注册于 ' + String(currentProfile.created_at).split('T')[0])
            : '';
    }

    // 3. 加载比赛记录
    loadMyAttempts();
}

// 我的比赛记录：自己提交过的所有成绩，按比赛分组展示
async function loadMyAttempts() {
    if (!currentProfile) return;
    var { data, error } = await db('attempts')
        .select('*, participants(name), competition_events(competitions(id, name, competition_date), events(event_name))')
        .eq('submitted_by', currentProfile.id)
        .order('created_at', { ascending: false });
    if (error) { showAlert('加载比赛记录失败：' + error.message, 'error'); return; }

    // 按比赛分组
    var today = new Date().toISOString().split('T')[0];
    var byComp = {};
    (data || []).forEach(function (a) {
        var ce = a.competition_events || {};
        var comp = ce.competitions || {};
        var compId = comp.id || 'unknown';
        if (!byComp[compId]) {
            byComp[compId] = {
                name: comp.name || '未知比赛',
                date: comp.competition_date || '',
                events: {},
                count: 0,
                status: (comp.competition_date && comp.competition_date >= today) ? '进行中' : '已结束'
            };
        }
        var evName = (ce.events && ce.events.event_name) || '-';
        byComp[compId].events[evName] = true;
        byComp[compId].count++;
    });

    var rows = Object.keys(byComp).map(function (id) {
        var c = byComp[id];
        var events = Object.keys(c.events).join('、');
        return {
            name: c.name,
            date: c.date ? c.date.split('T')[0] : '-',
            status: c.status,
            events: events,
            count: c.count
        };
    }).sort(function (a, b) { return b.date.localeCompare(a.date); });

    if (myAttemptsTable) myAttemptsTable.destroy();
    myAttemptsTable = new Tabulator('#my-attempts-table', {
        data: rows,
        layout: 'fitColumns',
        rowHeight: 26,
        headerHeight: 28,
        columns: [
            { title: '比赛', field: 'name', minWidth: 150 },
            { title: '日期', field: 'date', width: 110 },
            { title: '状态', width: 90, formatter: function (cell) {
                var s = cell.getValue();
                var cls = s === '进行中' ? 'status-pending' : 'status-approved';
                return '<span class="status-badge ' + cls + '">' + s + '</span>';
            }},
            { title: '参加项目', field: 'events', minWidth: 150 },
            { title: '成绩数', field: 'count', width: 80 }
        ],
        placeholder: '暂无比赛记录——去「成绩录入」提交你的成绩吧'
    });
}

// 保存昵称
async function saveNickname() {
    if (!currentUser) { showAlert('请先登录', 'error'); return; }
    var nickname = document.getElementById('my-nickname').value.trim();
    if (!nickname) { showAlert('昵称不能为空', 'error'); return; }

    var { error } = await db('profiles')
        .update({ username: nickname })
        .eq('id', currentUser.id);
    if (error) { showAlert('保存昵称失败：' + error.message, 'error'); return; }

    if (currentProfile) currentProfile.username = nickname;
    renderAuthUI();
    showAlert('✅ 昵称已保存', 'success');
}

// 修改密码
async function changeMyPassword() {
    if (!currentUser) { showAlert('请先登录', 'error'); return; }
    var newPwd = document.getElementById('my-new-password').value;
    var confirmEl = document.getElementById('my-confirm-password');
    var confirmPwd = confirmEl ? confirmEl.value : newPwd;
    if (!newPwd || newPwd.length < 6) { showAlert('新密码至少 6 位', 'error'); return; }
    if (newPwd !== confirmPwd) {
        showAlert('两次输入的新密码不一致', 'error');
        if (confirmEl) confirmEl.focus();
        return;
    }

    // 改密码经 Worker /api/auth/password（服务端带登录 JWT 调 Supabase Auth）
    var res = await callWorker('/api/auth/password', { new_password: newPwd });
    if (!res.ok) { showAlert('修改密码失败：' + (res.error && res.error.message ? res.error.message : '请确认已登录'), 'error'); return; }
    document.getElementById('my-new-password').value = '';
    if (confirmEl) confirmEl.value = '';
    showAlert('✅ 密码已修改', 'success');
}
