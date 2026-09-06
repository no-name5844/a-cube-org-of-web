/**
 * UI 辅助函数
 * 转义 / 成绩格式化 / 提示条 / 标签切换 / 条件字段 / 异步按钮守卫
 */

// 表格空状态文案（统一重复项）
var TABLE_EMPTY = '暂无数据';

// HTML 转义：所有动态数据拼进 innerHTML 前必须先过这里，防存储型 XSS
function escHtml(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// 格式化成绩时间：DNS(Did Not Start) / DNF(Did Not Finish) / 数值(+2) / 空
function formatAttemptTime(row) {
    if (row.is_dns) return 'DNS';
    if (row.is_dnf) return 'DNF';
    if (!row.solve_time && row.solve_time !== 0) return '-';
    return row.solve_time + (row.is_plus_two ? '+' : '');
}

/* ---------------- 提示条（Toast） ---------------- */

var alertTimer = null;

function showAlert(message, type) {
    var box = document.getElementById('alert-box');
    if (!box) return;
    box.className = 'alert alert-' + (type || 'info');
    box.textContent = message;
    box.style.display = 'block';
    clearTimeout(alertTimer);
    alertTimer = setTimeout(function () { box.style.display = 'none'; }, 4000);
}

// 点击提示条立即关闭
document.addEventListener('click', function (e) {
    var box = document.getElementById('alert-box');
    if (box && e.target === box) box.style.display = 'none';
});

/* ---------------- 标签页 ---------------- */

function switchTab(tabName, btn) {
    document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
    document.querySelectorAll('.tab-pane').forEach(function (p) { p.classList.remove('active'); });

    var pane = document.getElementById('tab-' + tabName);
    if (pane) pane.classList.add('active');
    if (btn && btn.classList) btn.classList.add('active');

    currentTab = tabName;
}

// 角色变化后，若当前标签页已被隐藏，自动落到第一个可见的标签页
function ensureVisibleTab() {
    var active = document.querySelector('.tab.active');
    if (active && active.style.display !== 'none') return;
    var tabs = Array.prototype.slice.call(document.querySelectorAll('.tab'));
    var first = tabs.filter(function (t) { return t.style.display !== 'none'; })[0];
    if (first) first.click();
}

/* ---------------- 条件字段 ---------------- */

// 切换智能/非智能魔方字段
function toggleSmartFields() {
    var type = document.getElementById('attempt-cube-type').value;
    document.getElementById('smart-fields').style.display = type === 'smart' ? 'block' : 'none';
    document.getElementById('non-smart-fields').style.display = type === 'non_smart' ? 'block' : 'none';
}

// 添加项目时按算法类型联动显示「窗口大小 / 去头尾」字段
function toggleEventAlgoFields() {
    var sel = document.getElementById('event-algo-type');
    if (!sel) return;
    var needsWindow = ['average', 'mean', 'best_of'].indexOf(sel.value) !== -1;
    var extra = document.getElementById('event-algo-extra');
    var trim = document.getElementById('event-trim-field');
    if (extra) extra.hidden = !needsWindow;
    if (trim) trim.hidden = (sel.value !== 'average');
}

/* ---------------- 登录守卫（写操作前提：已登录，服务端再验角色） ---------------- */

function checkDB() {
    // 已无「连接数据库」步骤；数据经 Worker /api/*。写操作需登录，这里统一拦未登录。
    if (!currentUser) {
        showAlert('⚠️ 请先登录', 'error');
        return false;
    }
    return true;
}

/* ---------------- 异步按钮守卫 ----------------
 * 用法：<button onclick="guard(this, addCompetition)">
 * 作用：防重复点击、给出加载中反馈、异常兜底提示
 * ------------------------------------------------ */

function setBusy(btn, on) {
    if (!btn) return;
    if (on) {
        if (btn.dataset.busy === '1') return;
        btn.dataset.busy = '1';
        btn._idleLabel = btn.textContent;
        btn.disabled = true;
        btn.classList.add('is-busy');
        btn.textContent = '处理中…';
    } else {
        btn.dataset.busy = '0';
        btn.disabled = false;
        btn.classList.remove('is-busy');
        if (btn._idleLabel != null) btn.textContent = btn._idleLabel;
    }
}

async function guard(btn, fn) {
    if (!btn) return fn && fn();
    if (btn.dataset.busy === '1') return;      // 已在执行，忽略重复触发
    setBusy(btn, true);
    try {
        if (typeof fn === 'function') await fn();
    } catch (err) {
        console.error(err);
        showAlert('操作失败：' + (err && err.message ? err.message : '未知错误'), 'error');
    } finally {
        setBusy(btn, false);
    }
}
