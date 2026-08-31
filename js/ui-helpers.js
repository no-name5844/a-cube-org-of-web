/**
 * UI 辅助函数
 * showAlert, switchTab, toggleSmartFields, checkDB, escHtml, formatAttemptTime
 */

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

function showAlert(message, type) {
    var alertBox = document.getElementById('alertBox');
    alertBox.className = 'alert alert-' + type;
    alertBox.textContent = message;
    alertBox.style.display = 'block';
    setTimeout(function() { alertBox.style.display = 'none'; }, 5000);
}

// 切换标签页
function switchTab(tabName) {
    var tabs = document.querySelectorAll('.tab');
    tabs.forEach(function(t) { t.classList.remove('active'); });
    event.target.classList.add('active');
    var contents = document.querySelectorAll('.tab-content');
    contents.forEach(function(c) { c.classList.remove('active'); });
    document.getElementById('tab-' + tabName).classList.add('active');
}

// 切换智能/非智能魔方字段
function toggleSmartFields() {
    var type = document.getElementById('attempt-cube-type').value;
    document.getElementById('smart-fields').style.display = type === 'smart' ? 'block' : 'none';
    document.getElementById('non-smart-fields').style.display = type === 'non_smart' ? 'block' : 'none';
}

// 检查数据库是否已连接
function checkDB() {
    if (typeof dbClient === 'undefined' || !dbClient) {
        showAlert('⚠️ 请先连接数据库', 'error');
        return false;
    }
    return true;
}
