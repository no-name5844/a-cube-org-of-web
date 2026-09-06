/**
 * 数据保存函数
 * 包含所有 add* 函数
 */

// 添加比赛
async function addCompetition() {
    var num = document.getElementById('comp-number').value;
    var name = document.getElementById('comp-name').value.trim();
    var date = document.getElementById('comp-date').value;
    if (!num || !name || !date) { showAlert('请填写完整信息', 'error'); return; }
    var { error } = await db('competitions').insert({
        competition_number: num,
        name: name,
        competition_date: date,
        location: document.getElementById('comp-location').value.trim(),
        notes: document.getElementById('comp-notes').value.trim()
    });
    if (error) { showAlert('添加失败：' + error.message, 'error'); return; }
    showAlert('✅ 比赛添加成功！', 'success');
    loadCompetitions();
}

// 添加项目到比赛
async function addEventToCompetition() {
    var competitionId = document.getElementById('config-competition').value;
    var eventId = document.getElementById('config-event').value;
    if (!competitionId || !eventId) {
        showAlert('请选择比赛和项目', 'error'); return;
    }
    var { data: existing } = await db('competition_events')
        .select('id')
        .eq('competition_id', competitionId)
        .eq('event_id', eventId);
    if (existing && existing.length > 0) {
        showAlert('该项目已添加到该比赛', 'info'); return;
    }
    var { data: maxData } = await db('competition_events')
        .select('event_number')
        .eq('competition_id', competitionId)
        .order('event_number', { ascending: false })
        .limit(1);
    var nextNum = (maxData && maxData.length > 0) ? maxData[0].event_number + 1 : 1;
    var { error } = await db('competition_events').insert({
        competition_id: competitionId,
        event_id: eventId,
        event_number: nextNum
    });
    if (error) { showAlert('添加失败：' + error.message, 'error'); return; }
    showAlert('✅ 项目已添加到比赛！', 'success');
    loadConfigCompetitionEvents();
}

// 添加项目
async function addEvent() {
    var parentId = document.getElementById('event-parent').value || null;
    var code = document.getElementById('event-code').value.trim();
    var name = document.getElementById('event-name').value.trim();
    if (!code || !name) { showAlert('请填写代码和名称', 'error'); return; }
    
    var algoType = document.getElementById('event-algo-type') ? 
        document.getElementById('event-algo-type').value : 'single';
    var isLower = document.getElementById('event-is-lower-better') ?
        document.getElementById('event-is-lower-better').value === 'true' : true;
    var trimCount = document.getElementById('event-trim-count') ?
        (parseInt(document.getElementById('event-trim-count').value) || 0) : 0;
    var algoConfig = {
        algorithm_type: algoType,
        is_lower_better: isLower,
        trim_count: trimCount
    };
    var windowSizeEl = document.getElementById('event-window-size');
    if (windowSizeEl && windowSizeEl.value) {
        algoConfig.window_size = parseInt(windowSizeEl.value);
    }
    
    var { error } = await db('events').insert({
        event_code: code,
        event_name: name,
        description: document.getElementById('event-desc').value.trim(),
        parent_event_id: parentId,
        is_sub_event: parentId !== null,
        algorithm_config: algoConfig
    });
    if (error) { showAlert('添加失败：' + error.message, 'error'); return; }
    showAlert('✅ 项目添加成功！', 'success');
    document.getElementById('event-code').value = '';
    document.getElementById('event-name').value = '';
    document.getElementById('event-desc').value = '';
    if (document.getElementById('event-parent')) {
        document.getElementById('event-parent').value = '';
    }
    loadEvents();
}

// 添加选手
async function addParticipant() {
    var name = document.getElementById('participant-name').value.trim();
    if (!name) { showAlert('请填写选手名称', 'error'); return; }
    var { error } = await db('participants').insert({
        name: name,
        wca_id: document.getElementById('participant-wca').value.trim()
    });
    if (error) { showAlert('添加失败：' + error.message, 'error'); return; }
    showAlert('✅ 选手添加成功！', 'success');
    loadParticipants();
}

// 提交成绩
async function addAttempt() {
    if (!checkDB()) return;
    // 账号信息完全信任数据库：提交前先从数据库刷新最新角色
    await refreshMyProfile();
    var competitionId = document.getElementById('attempt-competition').value;
    var eventId = document.getElementById('attempt-event').value;
    var participantId = document.getElementById('attempt-participant').value;
    if (!competitionId || !eventId || !participantId) {
        showAlert('请选择比赛、项目和选手', 'error'); return;
    }
    
    var { data: ceData, error: ceError } = await db('competition_events')
        .select('id')
        .eq('competition_id', competitionId)
        .eq('event_id', eventId)
        .maybeSingle();
    if (ceError) { showAlert('查询比赛项目失败：' + ceError.message, 'error'); return; }
    
    var ceId = ceData ? ceData.id : null;
    if (!ceId) {
        var { data: maxData } = await db('competition_events')
            .select('event_number')
            .eq('competition_id', competitionId)
            .order('event_number', { ascending: false })
            .limit(1);
        var nextNum = (maxData && maxData.length > 0) ? maxData[0].event_number + 1 : 1;
        var { data: newCe, error: insertError } = await db('competition_events')
            .insert({ competition_id: competitionId, event_id: eventId, event_number: nextNum })
            .select('id')
            .single();
        if (insertError) { showAlert('创建比赛项目关联失败：' + insertError.message, 'error'); return; }
        ceId = newCe.id;
    }
    
    var attemptNum = parseInt(document.getElementById('attempt-id').value) || 1;
    var cubeType = document.getElementById('attempt-cube-type').value;
    var penalty = document.getElementById('attempt-penalty').value; // none / +2 / dnf
    var isPlusTwo = penalty === '+2';
    var solveTimeRaw = document.getElementById('attempt-time').value;
    var solveTime = parseFloat(solveTimeRaw);
    // -1 → DNF，-2 → DNS 哨兵值；否则必须是非负数字
    var isDnf = false, isDns = false;
    if (penalty === 'dnf') { isDnf = true; solveTime = -1; }
    else if (penalty === 'dns') { isDns = true; solveTime = -2; }
    else if (solveTimeRaw === '-2') { isDns = true; solveTime = -2; }
    else if (solveTimeRaw === '-1') { isDnf = true; solveTime = -1; }
    if (!isDnf && !isDns && isNaN(solveTime)) { showAlert('请输入有效的时间，或用 -1(DNF) / -2(DNS)', 'error'); return; }
    
    var attemptData = {
        competition_event_id: ceId,
        participant_id: participantId,
        attempt_number: attemptNum,
        solve_time: solveTime, // 服务端会翻译 -1→DNF / -2→DNS
        cube_type: cubeType,
        is_dnf: isDnf,
        is_dns: isDns,
        is_plus_two: isPlusTwo,
        notes: ''
    };
    
    if (cubeType === 'smart') {
        attemptData.move_count = parseInt(document.getElementById('attempt-move-count').value) || null;
        attemptData.tps = parseFloat(document.getElementById('attempt-tps').value) || null;
    } else {
        attemptData.video_url = document.getElementById('attempt-video').value.trim();
    }

    // 强制走 Cloudflare Workers submit-attempt：status 与 submitted_by 由服务端按数据库角色决定，
    // 前端传的 status/submitted_by 会被 Worker 的白名单丢弃
    var res = await callWorker('/submit-attempt', attemptData);
    if (!res.ok) { showAlert('提交成绩失败：' + (res.error.message || '请确认已登录且为编辑员及以上'), 'error'); return; }
    if (res.data && res.data.status === 'pending') {
        showAlert('⏳ 成绩已提交，等待审核员审核', 'info');
    } else {
        showAlert('✅ 成绩提交成功！', 'success');
    }
    loadRecentAttempts();
    document.getElementById('attempt-time').value = '';
    if (cubeType === 'smart') {
        document.getElementById('attempt-move-count').value = '';
        document.getElementById('attempt-tps').value = '';
    } else {
        document.getElementById('attempt-video').value = '';
    }
}
