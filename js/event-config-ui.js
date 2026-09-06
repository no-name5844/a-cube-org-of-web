/**
 * 项目配置表单 UI
 * 渲染配置表单、模板选择、导入导出
 */

// 加载项目配置到表单
async function loadEventConfigToForm() {
    var eventId = document.getElementById('config-event-select').value;
    if (!eventId) return;
    
    var { data, error } = await db('events')
        .select('event_config, algorithm_config')
        .eq('id', eventId)
        .single();
    
    if (error) { showAlert('加载配置失败：' + error.message, 'error'); return; }
    
    // 填充 event_config 表单
    if (data.event_config) {
        renderEventConfigForm(data.event_config);
    }
    
    // 填充 algorithm_config 表单
    if (data.algorithm_config) {
        renderAlgoConfigForm(data.algorithm_config);
    }
    
    // 同步到 JSON 文本框
    syncFormToJSON();
}

// 从表单保存配置
async function saveConfigFromForm() {
    var eventId = document.getElementById('config-event-select').value;
    if (!eventId) { showAlert('请先选择项目', 'error'); return; }
    
    var eventConfig = getEventConfigFromForm();
    var algoConfig = getAlgoConfigFromForm();
    
    var { error } = await db('events')
        .update({
            event_config: eventConfig,
            algorithm_config: algoConfig
        })
        .eq('id', eventId);
    
    if (error) { showAlert('保存失败：' + error.message, 'error'); return; }
    showAlert('✅ 配置保存成功！', 'success');
}

// 渲染 event_config 表单
function renderEventConfigForm(config) {
    config = config || {};
    var schema = window.EventConfig && window.EventConfig.schema;
    if (!schema) return;
    
    var container = document.getElementById('event-config-fields');
    if (!container) return;
    
    var html = '';
    for (var key in schema) {
        var field = schema[key];
        var val = config[key] !== undefined ? config[key] : field['default'];
        html += '<div style="margin-bottom:12px;">';
        html += '<label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px;">' + field.label + '</label>';
        
        if (field.type === 'boolean') {
            html += '<select id="ecf-' + key + '" style="width:100%;padding:6px 10px;border-radius:6px;border:1px solid #ccc;">';
            html += '<option value="true"' + (val ? ' selected' : '') + '>是</option>';
            html += '<option value="false"' + (!val ? ' selected' : '') + '>否</option>';
            html += '</select>';
        } else if (field.type === 'enum') {
            html += '<select id="ecf-' + key + '" style="width:100%;padding:6px 10px;border-radius:6px;border:1px solid #ccc;">';
            field['enum'].forEach(function(opt) {
                html += '<option value="' + opt + '"' + (val === opt ? ' selected' : '') + '>' + opt + '</option>';
            });
            html += '</select>';
        } else {
            html += '<input type="text" id="ecf-' + key + '" value="' + (val || '') + '" style="width:100%;padding:6px 10px;border-radius:6px;border:1px solid #ccc;">';
        }
        
        if (field.description) {
            html += '<div style="font-size:11px;color:#888;margin-top:2px;">' + field.description + '</div>';
        }
        html += '</div>';
    }
    container.innerHTML = html;
}

// 渲染 algorithm_config 表单
function renderAlgoConfigForm(config) {
    config = config || {};
    var container = document.getElementById('algo-config-fields-inner');
    if (!container) return;
    
    var algoType = config.algorithm_type || 'single';
    var html = '<div style="margin-bottom:10px;">';
    html += '<label style="font-size:13px;font-weight:600;">算法类型</label>';
    html += '<select id="acf-algorithm-type" onchange="onAlgoTypeChange()" style="width:100%;padding:6px 10px;border-radius:6px;border:1px solid #ccc;">';
    ['single','average','mean','best_of','sub'].forEach(function(t) {
        html += '<option value="' + t + '"' + (algoType===t?' selected':'') + '>' + t + '</option>';
    });
    html += '</select></div>';
    
    if (algoType === 'average') {
        html += '<div style="margin-bottom:10px;">';
        html += '<label style="font-size:13px;">窗口大小</label>';
        html += '<input type="number" id="acf-window-size" value="' + (config.window_size||5) + '" style="width:100%;padding:6px 10px;border-radius:6px;border:1px solid #ccc;">';
        html += '</div>';
        html += '<div style="margin-bottom:10px;">';
        html += '<label style="font-size:13px;">去头尾数量</label>';
        html += '<input type="number" id="acf-trim-count" value="' + (config.trim_count||1) + '" style="width:100%;padding:6px 10px;border-radius:6px;border:1px solid #ccc;">';
        html += '</div>';
    }
    
    html += '<div style="margin-bottom:10px;">';
    html += '<label style="font-size:13px;">越小越好？</label>';
    html += '<select id="acf-is-lower-better" style="width:100%;padding:6px 10px;border-radius:6px;border:1px solid #ccc;">';
    html += '<option value="true"' + (config.is_lower_better!==false?' selected':'') + '>是</option>';
    html += '<option value="false"' + (config.is_lower_better===false?' selected':'') + '>否</option>';
    html += '</select></div>';
    
    container.innerHTML = html;
}

function onAlgoTypeChange() {
    renderAlgoConfigForm({
        algorithm_type: document.getElementById('acf-algorithm-type').value
    });
}

// 从表单获取 event_config
function getEventConfigFromForm() {
    var schema = window.EventConfig && window.EventConfig.schema;
    if (!schema) return {};
    var config = {};
    for (var key in schema) {
        var el = document.getElementById('ecf-' + key);
        if (!el) continue;
        var val = el.value;
        if (schema[key].type === 'boolean') {
            val = (val === 'true');
        }
        config[key] = val;
    }
    return config;
}

// 从表单获取 algorithm_config
function getAlgoConfigFromForm() {
    var config = {};
    var typeEl = document.getElementById('acf-algorithm-type');
    if (typeEl) config.algorithm_type = typeEl.value;
    var windowEl = document.getElementById('acf-window-size');
    if (windowEl && windowEl.value) config.window_size = parseInt(windowEl.value);
    var trimEl = document.getElementById('acf-trim-count');
    if (trimEl && trimEl.value) config.trim_count = parseInt(trimEl.value);
    var betterEl = document.getElementById('acf-is-lower-better');
    if (betterEl) config.is_lower_better = (betterEl.value === 'true');
    return config;
}

// 同步表单到 JSON 文本框
function syncFormToJSON() {
    var eventConfig = getEventConfigFromForm();
    var algoConfig = getAlgoConfigFromForm();
    var jsonBox = document.getElementById('event-config-json');
    if (jsonBox) {
        jsonBox.value = JSON.stringify({
            event_config: eventConfig,
            algorithm_config: algoConfig
        }, null, 2);
    }
}

// 模板选择
function onConfigTemplateSelected() {
    var sel = document.getElementById('config-template-select');
    if (!sel) return;
    var tid = sel.value;
    if (!tid) return;
    
    var tpl = window.EventConfig && window.EventConfig.templates && window.EventConfig.templates[tid];
    if (!tpl) return;
    
    renderEventConfigForm(tpl.event_config || {});
    renderAlgoConfigForm(tpl.algorithm_config || {});
    syncFormToJSON();
}

// 加载默认配置到表单
function onLoadDefaultConfigToForm() {
    var defaultConfig = window.EventConfig && window.EventConfig.defaults;
    if (!defaultConfig) return;
    renderEventConfigForm(defaultConfig);
    renderAlgoConfigForm({ algorithm_type: 'single' });
    syncFormToJSON();
    showAlert('✅ 已加载默认配置', 'success');
}

// 导出 JSON
function onExportConfigJSON() {
    syncFormToJSON();
    var jsonBox = document.getElementById('event-config-json');
    if (jsonBox) {
        jsonBox.style.display = 'block';
        jsonBox.focus();
        jsonBox.select();
    }
}

// 导入 JSON
function onImportConfigJSON() {
    var jsonBox = document.getElementById('event-config-json');
    if (!jsonBox || !jsonBox.value) { showAlert('请先粘贴 JSON 配置', 'error'); return; }
    try {
        var config = JSON.parse(jsonBox.value);
        if (config.event_config) renderEventConfigForm(config.event_config);
        if (config.algorithm_config) renderAlgoConfigForm(config.algorithm_config);
        showAlert('✅ 已导入配置', 'success');
    } catch(e) {
        showAlert('❌ JSON 解析失败：' + e.message, 'error');
    }
}

// 初始化模板下拉框
function initConfigTemplateSelect() {
    var sel = document.getElementById('config-template-select');
    if (!sel) return;
    var templates = window.EventConfig && window.EventConfig.templates;
    if (!templates) return;
    for (var tid in templates) {
        var opt = document.createElement('option');
        opt.value = tid;
        opt.textContent = templates[tid].name;
        sel.appendChild(opt);
    }
}
