/**
 * 数据加载函数
 * 包含所有 load* 函数
 */

// 表格实例（Tabulator），在多个 load* 函数之间共享。
// 必须显式声明并初始化为 null：各 load* 函数开头都有 `if (xTable) xTable.destroy()`，
// 这是「先读取、后赋值」，若没有声明会直接抛 ReferenceError（viewTable is not defined）。
var competitionsTable = null;
var eventsTable = null;
var participantsTable = null;
var attemptsTable = null;
var viewTable = null;

// 加载所有数据
async function loadAllData() {
    // 初始化配置模板下拉框（来自本地 EventConfig，不依赖数据库）
    if (typeof initConfigTemplateSelect === 'function') initConfigTemplateSelect();
    await Promise.all([
        loadCompetitions(),
        loadEvents(),
        loadParticipants(),
        loadCompetitionsForSelect('view-competition'),
        loadCompetitionsForSelect('attempt-competition'),
        loadEventsForSelect('config-event'),
        loadParticipantsForSelect('attempt-participant'),
        loadParentEvents(),
        loadRecentAttempts()
    ]);
}

// 选择比赛后联动刷新「项目」下拉（成绩录入 / 成绩查询）
function loadCompetitionEventsForAttempt() {
    loadCompetitionEvents(document.getElementById('attempt-competition').value, 'attempt-event');
}

function loadCompetitionEventsForView() {
    loadCompetitionEvents(document.getElementById('view-competition').value, 'view-event');
}

// 加载比赛列表
async function loadCompetitions() {
    var { data, error } = await db('competitions').select('*').order('competition_number');
    if (error) { showAlert('加载比赛失败：' + error.message, 'error'); return; }
    if (competitionsTable) competitionsTable.destroy();
    var columns = [
        { title: '编号', field: 'competition_number', width: 140 },
        { title: '名称', field: 'name', minWidth: 150 },
        { title: '日期', field: 'competition_date', width: 120, formatter: function(cell) { return cell.getValue() ? cell.getValue().split('T')[0] : ''; } },
        { title: '地点', field: 'location', width: 120 }
    ];
    // 删除按钮仅编辑员及以上可见
    if (isEditorOrAbove()) {
        columns.push({ title: '操作', width: 100, formatter: function() { return '<button class="btn btn-danger" style="padding:5px 10px;">删除</button>'; }, cellClick: function(e, cell) { deleteCompetition(cell.getRow().getData().id); } });
    }
    competitionsTable = new Tabulator('#competitions-table', {
        data: data,
        layout: 'fitColumns',
        rowHeight: 26,
        headerHeight: 28,
        placeholder: TABLE_EMPTY,
        columns: columns
    });
    loadCompetitionsForSelect('config-competition');
}

// 加载比赛已配置的项目列表
async function loadConfigCompetitionEvents() {
    var competitionId = document.getElementById('config-competition').value;
    var container = document.getElementById('config-competition-events');
    if (!competitionId) {
        container.innerHTML = '请先选择比赛';
        return;
    }
    var { data, error } = await db('competition_events')
        .select('*, events(*)')
        .eq('competition_id', competitionId)
        .order('event_number');
    if (error) { container.innerHTML = '加载失败：' + error.message; return; }
    if (!data || data.length === 0) {
        container.innerHTML = '<span style="color: #999;">该比赛尚未配置任何项目</span>';
        return;
    }
    var html = '<ul style="margin:0; padding-left:20px;">';
    data.forEach(function(ce) {
        html += '<li>' + escHtml(ce.events.event_code) + ' - ' + escHtml(ce.events.event_name) + '</li>';
    });
    html += '</ul>';
    container.innerHTML = html;
}

// 加载项目列表
async function loadEvents() {
    var { data, error } = await db('events')
        .select('*, parent:parent_event_id(event_code, event_name)')
        .order('parent_event_id', { ascending: true })
        .order('sort_order', { ascending: true })
        .order('event_code', { ascending: true });
    
    if (error) {
        showAlert('加载项目失败：' + error.message, 'error');
        return;
    }
    
    if (eventsTable) eventsTable.destroy();
    
    eventsTable = new Tabulator('#events-table', {
        data: data,
        layout: 'fitDataFill',
        maxHeight: 360,
        rowHeight: 26,
        headerHeight: 28,
        placeholder: TABLE_EMPTY,
        columns: [
            {
                title: '项目代码',
                field: 'event_code',
                width: 110,
                formatter: function(cell) {
                    var row = cell.getRow().getData();
                    if (row.parent_event_id) {
                        return '  ↳ ' + cell.getValue();
                    }
                    return cell.getValue();
                }
            },
            {
                title: '项目名称',
                field: 'event_name',
                width: 160,
                formatter: function(cell) {
                    var row = cell.getRow().getData();
                    if (row.parent_event_id) {
                        return '<span style="color: #667eea;">' + cell.getValue() + '</span>';
                    }
                    return '<strong>' + cell.getValue() + '</strong>';
                }
            },
            {
                title: '父项目',
                field: 'parent',
                width: 140,
                formatter: function(cell) {
                    var parent = cell.getValue();
                    if (parent) {
                        return parent.event_code + ' - ' + parent.event_name;
                    }
                    return '<span style="color:#999;font-size:12px;">顶级</span>';
                }
            },
            { title: '描述', field: 'description', width: 160 },
            {
                title: '算法',
                field: 'algorithm_config',
                width: 80,
                formatter: function(cell) {
                    var config = cell.getValue();
                    if (config && config.algorithm_type) {
                        return config.algorithm_type;
                    }
                    return '-';
                }
            }
        ]
    });
    
    loadEventsForConfigSelect();
}

// 更新项目配置下拉框（包含层级信息）
async function loadEventsForConfigSelect() {
    var { data, error } = await db('events')
        .select('id, event_code, event_name, parent_event_id')
        .order('parent_event_id', { ascending: true })
        .order('sort_order', { ascending: true });
    
    if (error) return;
    
    var select = document.getElementById('config-event-select');
    select.innerHTML = '<option value="">-- 请选择项目 --</option>';
    
    data.forEach(function(event) {
        var option = document.createElement('option');
        option.value = event.id;
        if (event.parent_event_id) {
            option.textContent = '  ↳ ' + event.event_code + ' - ' + event.event_name;
        } else {
            option.textContent = event.event_code + ' - ' + event.event_name;
        }
        select.appendChild(option);
    });
}

// 加载项目到下拉框（通用）
async function loadEventsForSelect(selectId) {
    var { data, error } = await db('events')
        .select('id, event_code, event_name, parent_event_id')
        .order('parent_event_id', { ascending: true })
        .order('sort_order', { ascending: true });
    
    if (error) return;
    
    var select = document.getElementById(selectId);
    if (!select) return;
    select.innerHTML = '<option value="">-- 请选择项目 --</option>';
    
    data.forEach(function(event) {
        var option = document.createElement('option');
        option.value = event.id;
        if (event.parent_event_id) {
            option.textContent = '  ↳ ' + event.event_code + ' - ' + event.event_name;
        } else {
            option.textContent = event.event_code + ' - ' + event.event_name;
        }
        select.appendChild(option);
    });
}

// 加载选手列表
async function loadParticipants() {
    var { data, error } = await db('participants').select('*').order('name');
    if (error) return;
    if (participantsTable) participantsTable.destroy();
    participantsTable = new Tabulator('#participants-table', {
        data: data,
        layout: 'fitColumns',
        rowHeight: 26,
        headerHeight: 28,
        placeholder: TABLE_EMPTY,
        columns: [
            { title: '名称', field: 'name' },
            { title: 'WCA ID', field: 'wca_id' },
            { title: '备注', field: 'notes' }
        ]
    });
}

// 加载比赛到下拉框
async function loadCompetitionsForSelect(selectId) {
    var { data } = await db('competitions').select('*').order('competition_number');
    var sel = document.getElementById(selectId);
    if (!sel) return;
    sel.innerHTML = '<option value="">-- 选择比赛 --</option>';
    (data || []).forEach(function(c) {
        sel.innerHTML += '<option value="' + c.id + '">' + escHtml(c.competition_number) + ' - ' + escHtml(c.name) + '</option>';
    });
}

// 加载选手到下拉框
async function loadParticipantsForSelect(selectId) {
    var { data } = await db('participants').select('*').order('name');
    var sel = document.getElementById(selectId);
    if (!sel) return;
    sel.innerHTML = '<option value="">-- 选择选手 --</option>';
    (data || []).forEach(function(p) {
        sel.innerHTML += '<option value="' + p.id + '">' + escHtml(p.name) + '</option>';
    });
}

// 加载最近成绩
async function loadRecentAttempts() {
    var { data, error } = await db('attempts')
        .select('*, participants(name), competition_events(competitions(name), events(event_name))')
        .order('created_at', { ascending: false })
        .limit(50);
    if (error) return;
    if (attemptsTable) attemptsTable.destroy();
    attemptsTable = new Tabulator('#attempts-table', {
        data: data,
        layout: 'fitColumns',
        rowHeight: 26,
        headerHeight: 28,
        placeholder: TABLE_EMPTY,
        columns: [
            { title: '选手', field: 'participants.name' },
            { title: '项目', field: 'competition_events.events.event_name' },
            { title: '比赛', field: 'competition_events.competitions.name' },
            { title: '次数', field: 'attempt_number', width: 80 },
            { title: '时间', formatter: function(cell) {
                return formatAttemptTime(cell.getRow().getData());
            }},
            { title: '魔方', field: 'cube_type', width: 100 },
            { title: 'TPS', field: 'tps', width: 80 },
            { title: '状态', width: 100, formatter: function(cell) {
                var status = cell.getRow().getData().status || 'approved';
                var label = { pending: '⏳ 待审核', approved: '✅ 已通过', rejected: '❌ 已驳回' }[status] || status;
                return '<span class="status-badge status-' + status + '">' + label + '</span>';
            }}
        ]
    });
}

// 渲染查询摘要（有效成绩数 / 最快 / 平均）
function renderStatsSummary(rows) {
    var box = document.getElementById('stats-summary');
    if (!box) return;

    var all = rows || [];
    // 有效成绩：非 DNF / DNS，且时间为正数；+2 已计入
    var times = all.filter(function (r) {
        return !r.is_dnf && !r.is_dns && typeof r.solve_time === 'number' && r.solve_time > 0;
    }).map(function (r) {
        return r.solve_time + (r.is_plus_two ? 2 : 0);
    });

    var best = times.length ? Math.min.apply(null, times) : null;
    var avg = times.length ? times.reduce(function (a, b) { return a + b; }, 0) / times.length : null;
    var fmt = function (v) { return v == null ? '—' : v.toFixed(3) + 's'; };

    box.innerHTML = [
        { label: '有效成绩', value: times.length + ' / ' + all.length },
        { label: '最快', value: fmt(best) },
        { label: '平均', value: fmt(avg) }
    ].map(function (c) {
        return '<div class="stat"><div class="stat__label">' + escHtml(c.label) + '</div>' +
               '<div class="stat__value">' + escHtml(c.value) + '</div></div>';
    }).join('');
}

// 加载查看数据
async function loadViewData() {
    var competitionId = document.getElementById('view-competition').value;
    var eventId = document.getElementById('view-event').value;
    if (!competitionId || !eventId) {
        if (viewTable) { viewTable.destroy(); viewTable = null; }
        renderStatsSummary([]);
        document.getElementById('view-table').innerHTML = '<p class="empty">请先选择比赛和项目</p>';
        return;
    }
    
    var { data: ceData, error: ceError } = await db('competition_events')
        .select('id')
        .eq('competition_id', competitionId)
        .eq('event_id', eventId)
        .single();
    
    if (ceError) { showAlert('查询失败：' + ceError.message, 'error'); return; }
    
    var { data, error } = await db('attempts')
        .select('*, participants(name)')
        .eq('competition_event_id', ceData.id)
        .eq('status', 'approved')
        .order('attempt_number');
    
    if (error) { showAlert('加载数据失败：' + error.message, 'error'); return; }
    
    if (viewTable) viewTable.destroy();
    renderStatsSummary(data);
    viewTable = new Tabulator('#view-table', {
        data: data,
        layout: 'fitColumns',
        rowHeight: 26,
        headerHeight: 28,
        placeholder: '该项目暂无已通过审核的成绩',
        columns: [
            { title: '选手', field: 'participants.name' },
            { title: '次数', field: 'attempt_number', width: 80 },
            { title: '时间', formatter: function(cell) {
                return formatAttemptTime(cell.getRow().getData());
            }},
            { title: '魔方类型', field: 'cube_type', width: 100 },
            { title: '步数', field: 'move_count', width: 80 },
            { title: 'TPS', field: 'tps', width: 80 },
            { title: '打乱', field: 'scramble', width: 150 },
            { title: '备注', formatter: function(cell) {
                var row = cell.getRow().getData();
                return row.is_dnf ? 'DNF' : (row.is_dns ? 'DNS' : (row.is_plus_two ? '+2' : ''));
            }, width: 80 }
        ]
    });
}

// 加载比赛中的项目
async function loadCompetitionEvents(competitionId, selectId) {
    if (!competitionId) {
        document.getElementById(selectId).innerHTML = '<option value="">-- 先选择比赛 --</option>';
        return;
    }
    var { data } = await db('competition_events')
        .select('*, events(*)')
        .eq('competition_id', competitionId);
    var sel = document.getElementById(selectId);
    sel.innerHTML = '<option value="">-- 选择项目 --</option>';
    (data || []).forEach(function(ce) {
        sel.innerHTML += '<option value="' + ce.event_id + '">' + escHtml(ce.events.event_code) + ' - ' + escHtml(ce.events.event_name) + '</option>';
    });
}

// 加载父项目
async function loadParentEvents() {
    var { data, error } = await db('events')
        .select('id, event_code, event_name')
        .is('parent_event_id', null)
        .order('sort_order');
    if (error) return;
    var sel = document.getElementById('event-parent');
    if (!sel) return;
    sel.innerHTML = '<option value="">-- 顶级项目（无父项目）--</option>';
    (data || []).forEach(function(e) {
        sel.innerHTML += '<option value="' + e.id + '">' + escHtml(e.event_code) + ' - ' + escHtml(e.event_name) + '</option>';
    });
}
