-- ============================================
-- schema.sql（自包含部署脚本，可直接在空 Supabase 项目执行一次）
-- 权限系统升级：五个角色
--   匿名用户（未登录）→ 普通用户(user) → 编辑员(editor) → 审核员(reviewer) → 管理员(admin)
-- 已改为「自包含」：先建基础业务表（attempts/competitions/events/competition_events/participants），
-- 再叠加 profiles 与角色/RLS 层。所有 CREATE TABLE 用 IF NOT EXISTS，可重复执行、与已部署库兼容。
-- ============================================

-- ============================================
-- 0. 基础业务表（base tables）
-- 列定义取自前端真实读写字段（data-saver.js / data-loader.js / worker.js）。
-- 旧版冗余表 event_algorithms / statistics_definitions / mle_predictions /
-- participant_statistics（Gamma MLE + 算法配置遗留）已不再创建；
-- 若库中仍有这些表，请用 db-cleanup.sql 单独 DROP。
-- ============================================
CREATE TABLE IF NOT EXISTS competitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    competition_number INT,
    name TEXT NOT NULL,
    competition_date DATE,
    location TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_code TEXT,
    event_name TEXT,
    description TEXT,
    parent_event_id UUID REFERENCES events(id) ON DELETE SET NULL,
    is_sub_event BOOLEAN DEFAULT FALSE,
    event_config JSONB DEFAULT '{}'::jsonb,
    algorithm_config JSONB DEFAULT '{}'::jsonb,
    sort_order INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS competition_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    competition_id UUID REFERENCES competitions(id) ON DELETE CASCADE,
    event_id UUID REFERENCES events(id) ON DELETE CASCADE,
    event_number INT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    wca_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    competition_event_id UUID REFERENCES competition_events(id) ON DELETE CASCADE,
    participant_id UUID REFERENCES participants(id) ON DELETE CASCADE,
    attempt_number TEXT,
    solve_time DECIMAL(10,3),
    cube_type TEXT,
    scramble TEXT,
    move_count INT,
    tps DECIMAL(10,3),
    solve_steps TEXT,
    step_comments TEXT,
    is_dnf BOOLEAN DEFAULT FALSE,
    is_plus_two BOOLEAN DEFAULT FALSE,
    is_dns BOOLEAN DEFAULT FALSE,
    video_url TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 1. profiles 表：用户资料与角色
-- 每个用户拥有独属的短编号 user_code（如 U000001），注册时自动生成、全局唯一
-- ============================================
CREATE SEQUENCE IF NOT EXISTS user_code_seq START 1;

CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    user_code TEXT UNIQUE DEFAULT 'U' || lpad(nextval('user_code_seq')::text, 6, '0'),
    username TEXT,
    role TEXT NOT NULL DEFAULT 'user'
        CHECK (role IN ('user', 'editor', 'reviewer', 'admin')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 存量用户回填 user_code
UPDATE profiles SET user_code = 'U' || lpad(nextval('user_code_seq')::text, 6, '0')
WHERE user_code IS NULL;

COMMENT ON TABLE profiles IS '用户资料与角色（匿名用户不在此表，未登录即匿名）';
COMMENT ON COLUMN profiles.user_code IS '用户专属编号（如 U000001），全局唯一，注册/建号时自动生成；即登录标识';
COMMENT ON COLUMN profiles.role IS '角色：user=普通用户, editor=编辑员, reviewer=审核员, admin=管理员';

-- 新注册用户自动创建 profile，默认普通用户
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO profiles (id, username)
    VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)))
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================
-- 2. 角色辅助函数（SECURITY DEFINER，避免 RLS 递归）
-- ============================================
CREATE OR REPLACE FUNCTION get_my_role()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT role FROM profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION is_editor_or_above()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT COALESCE(get_my_role() IN ('editor', 'reviewer', 'admin'), FALSE);
$$;

CREATE OR REPLACE FUNCTION is_reviewer_or_above()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT COALESCE(get_my_role() IN ('reviewer', 'admin'), FALSE);
$$;

CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT COALESCE(get_my_role() = 'admin', FALSE);
$$;

-- 是否还没有任何管理员（用于首位管理员自助提升）
CREATE OR REPLACE FUNCTION has_no_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT NOT EXISTS (SELECT 1 FROM profiles WHERE role = 'admin');
$$;

-- ============================================
-- 3. attempts 表增加审核状态字段
-- （基础表已含 is_dnf / is_plus_two / is_dns；此处补齐 v6 审核流字段）
-- ============================================
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'approved'
    CHECK (status IN ('pending', 'approved', 'rejected'));
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS submitted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

COMMENT ON COLUMN attempts.status IS '审核状态：pending=待审核, approved=已通过, rejected=已驳回。存量数据默认 approved';
COMMENT ON COLUMN attempts.submitted_by IS '提交者（普通用户提交时记录）';
COMMENT ON COLUMN attempts.reviewed_by IS '审核人';
COMMENT ON COLUMN attempts.reviewed_at IS '审核时间';
COMMENT ON COLUMN attempts.is_dns IS '是否 DNS（Did Not Start，未开始）；solve_time=-2 哨兵转此标志';
COMMENT ON COLUMN attempts.is_dnf IS '是否 DNF（Did Not Finish，未完成）；solve_time=-1 哨兵转此标志';

CREATE INDEX IF NOT EXISTS idx_attempts_status ON attempts(status);

-- ============================================
-- 4. 移除旧的「所有人可读写」策略（仅清理仍可能存在的旧策略）
-- ============================================
DROP POLICY IF EXISTS "Allow all access on competitions" ON competitions;
DROP POLICY IF EXISTS "Allow all access on events" ON events;
DROP POLICY IF EXISTS "Allow all access on competition_events" ON competition_events;
DROP POLICY IF EXISTS "Allow all access on participants" ON participants;
DROP POLICY IF EXISTS "Allow all access on attempts" ON attempts;

DROP POLICY IF EXISTS "Allow public insert access on competitions" ON competitions;
DROP POLICY IF EXISTS "Allow public update access on competitions" ON competitions;
DROP POLICY IF EXISTS "Allow public insert access on participants" ON participants;
DROP POLICY IF EXISTS "Allow public insert access on attempts" ON attempts;
DROP POLICY IF EXISTS "Allow public update access on attempts" ON attempts;

-- ============================================
-- 5. 启用 RLS 并创建角色策略
-- 权限矩阵：
--   匿名用户   ：只读（已通过的成绩 + 基础数据）→ 可看统计
--   普通用户   ：与匿名相同，只读（无录入权）
--   编辑员     ：+ 管理比赛/项目/选手/赛事项目，提交成绩（进入待审核，过审后生效）
--   审核员     ：+ 审核通过/驳回待审成绩（无直接录入权，提交同样进待审核）
--   管理员     ：最高权限（超级管理员），可直接录入已生效成绩，+ 用户角色管理
-- 覆盖表：competitions, events, competition_events, participants, attempts, profiles
-- （event_algorithms / statistics_definitions / mle_predictions / participant_statistics
--  为已删除的废弃表，不再在此处理；若库中仍有，请用 db-cleanup.sql 清理。）
-- ============================================

-- ---------- profiles ----------
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles select authenticated" ON profiles;
CREATE POLICY "profiles select authenticated" ON profiles
    FOR SELECT TO authenticated USING (true);

-- 管理员只能改「身份比自己低」的用户，且赋予的角色也必须低于管理员：
-- 不能操作其他管理员，不能把任何人（含自己）提为管理员
DROP POLICY IF EXISTS "profiles admin update" ON profiles;
CREATE POLICY "profiles admin update" ON profiles
    FOR UPDATE TO authenticated
    USING (is_admin() AND role <> 'admin')
    WITH CHECK (is_admin() AND role <> 'admin');

-- 普通用户只能改自己的 username，不能改角色（除非系统还没有管理员——首位管理员自助提升）
DROP POLICY IF EXISTS "profiles self update" ON profiles;
CREATE POLICY "profiles self update" ON profiles
    FOR UPDATE TO authenticated
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id AND (role = get_my_role() OR has_no_admin()));

-- ---------- 只读表（匿名可读，编辑员以上可写）----------
ALTER TABLE competitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE competition_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE participants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public read competitions" ON competitions;
CREATE POLICY "public read competitions" ON competitions
    FOR SELECT USING (true);
DROP POLICY IF EXISTS "editor write competitions" ON competitions;
CREATE POLICY "editor write competitions" ON competitions
    FOR ALL TO authenticated
    USING (is_editor_or_above()) WITH CHECK (is_editor_or_above());

DROP POLICY IF EXISTS "public read events" ON events;
CREATE POLICY "public read events" ON events
    FOR SELECT USING (true);
DROP POLICY IF EXISTS "editor write events" ON events;
CREATE POLICY "editor write events" ON events
    FOR ALL TO authenticated
    USING (is_editor_or_above()) WITH CHECK (is_editor_or_above());

DROP POLICY IF EXISTS "public read competition_events" ON competition_events;
CREATE POLICY "public read competition_events" ON competition_events
    FOR SELECT USING (true);
DROP POLICY IF EXISTS "editor write competition_events" ON competition_events;
CREATE POLICY "editor write competition_events" ON competition_events
    FOR ALL TO authenticated
    USING (is_editor_or_above()) WITH CHECK (is_editor_or_above());

DROP POLICY IF EXISTS "public read participants" ON participants;
CREATE POLICY "public read participants" ON participants
    FOR SELECT USING (true);
DROP POLICY IF EXISTS "editor write participants" ON participants;
CREATE POLICY "editor write participants" ON participants
    FOR ALL TO authenticated
    USING (is_editor_or_above()) WITH CHECK (is_editor_or_above());

-- ---------- attempts（核心审核流）----------
ALTER TABLE attempts ENABLE ROW LEVEL SECURITY;

-- 读：已通过的对所有人可见；待审/已驳回仅审核员以上和提交者本人可见
DROP POLICY IF EXISTS "attempts read" ON attempts;
CREATE POLICY "attempts read" ON attempts
    FOR SELECT USING (
        status = 'approved'
        OR is_reviewer_or_above()
        OR (auth.uid() IS NOT NULL AND submitted_by = auth.uid())
    );

-- 写：仅管理员可直接录入已通过成绩（最高权限）；
--     编辑员/审核员提交必须进入待审核，由审核流程通过后生效；普通用户与匿名无录入权
--     submitted_by 强制等于调用者（堵住"插入后查不到"的路径）
DROP POLICY IF EXISTS "attempts insert" ON attempts;
CREATE POLICY "attempts insert" ON attempts
    FOR INSERT TO authenticated WITH CHECK (
        ((is_admin() AND status = 'approved')
        OR (is_editor_or_above() AND NOT is_admin() AND status = 'pending'))
        AND submitted_by = auth.uid()
    );

-- 改：审核员以上可改任何成绩（含审核状态）；
--     编辑员可修正已通过的成绩但不能改审核状态，也可改自己的待审提交；
--     普通用户无写入权
DROP POLICY IF EXISTS "attempts update" ON attempts;
CREATE POLICY "attempts update" ON attempts
    FOR UPDATE TO authenticated
    USING (
        is_reviewer_or_above()
        OR (is_editor_or_above() AND status = 'approved')
        OR (is_editor_or_above() AND auth.uid() IS NOT NULL AND submitted_by = auth.uid() AND status = 'pending')
    )
    WITH CHECK (
        is_reviewer_or_above()
        OR (is_editor_or_above() AND status = 'approved')
        OR (is_editor_or_above() AND auth.uid() IS NOT NULL AND submitted_by = auth.uid() AND status = 'pending')
    );

-- 删：编辑员以上；编辑员只能删自己的待审提交
DROP POLICY IF EXISTS "attempts delete" ON attempts;
CREATE POLICY "attempts delete" ON attempts
    FOR DELETE TO authenticated USING (
        is_reviewer_or_above()
        OR (is_editor_or_above() AND auth.uid() IS NOT NULL AND submitted_by = auth.uid() AND status = 'pending')
    );

-- ============================================
-- 5b. 攻击测试修复（第二层防线 / 触发器）
-- ============================================

-- ① 防自审：任何角色都不能审核自己提交的成绩（含触发器层面的 final 防线）
CREATE OR REPLACE FUNCTION prevent_self_review()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.submitted_by IS NOT NULL AND NEW.submitted_by = auth.uid() THEN
        RAISE EXCEPTION '不能审核自己提交的成绩';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_prevent_self_review ON attempts;
CREATE TRIGGER trg_prevent_self_review
    BEFORE UPDATE ON attempts
    FOR EACH ROW
    WHEN (NEW.status IS DISTINCT FROM OLD.status)
    EXECUTE FUNCTION prevent_self_review();

-- ② 列级保护：普通用户/编辑员 UPDATE 成绩时禁止改写审核轨迹列（reviewed_by / reviewed_at）
--    实现方式：若新值非空则校验写入者必须是审核员以上
CREATE OR REPLACE FUNCTION protect_review_columns()
RETURNS TRIGGER AS $$
BEGIN
    IF (NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by
        OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at) THEN
        IF NOT is_reviewer_or_above() THEN
            RAISE EXCEPTION '无权修改审核轨迹（reviewed_by / reviewed_at）';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_protect_review_columns ON attempts;
CREATE TRIGGER trg_protect_review_columns
    BEFORE UPDATE ON attempts
    FOR EACH ROW
    EXECUTE FUNCTION protect_review_columns();

-- ③ 直插补归属：客户端（含云函数以调用者 JWT 身份）直接往 attempts 插入待审成绩时，
--    若未带 submitted_by 则自动补当前用户（auth.uid()），堵住"插入了却查不到"的路径。
--    注意：云函数现已改用调用者 JWT（不再用 service_role），auth.uid() 正确，本触发器会正常生效。
CREATE OR REPLACE FUNCTION backfill_submitted_by()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.submitted_by IS NULL AND auth.uid() IS NOT NULL THEN
        NEW.submitted_by = auth.uid();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_backfill_submitted_by ON attempts;
CREATE TRIGGER trg_backfill_submitted_by
    BEFORE INSERT ON attempts
    FOR EACH ROW
    EXECUTE FUNCTION backfill_submitted_by();

-- ④ 防父项目自环（DoS）：不允许把某项目的 parent_event_id 直接/间接指向自己
CREATE OR REPLACE FUNCTION prevent_event_cycle()
RETURNS TRIGGER AS $$
DECLARE
    cur UUID := NEW.parent_event_id;
    hops INT := 0;
BEGIN
    IF cur IS NULL OR cur = NEW.id THEN
        IF cur = NEW.id THEN
            RAISE EXCEPTION '项目不能以自身为父项目';
        END IF;
        RETURN NEW;
    END IF;
    -- 沿父链向上走，最多 50 层，防止循环
    WHILE cur IS NOT NULL AND hops < 50 LOOP
        IF cur = NEW.id THEN
            RAISE EXCEPTION '父项目关系形成循环，已拒绝';
        END IF;
        SELECT parent_event_id INTO cur FROM events WHERE id = cur;
        hops := hops + 1;
        IF NOT FOUND THEN
            RETURN NEW; -- 父链未发现环
        END IF;
    END LOOP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_prevent_event_cycle ON events;
CREATE TRIGGER trg_prevent_event_cycle
    BEFORE INSERT OR UPDATE OF parent_event_id ON events
    FOR EACH ROW
    EXECUTE FUNCTION prevent_event_cycle();

-- ============================================
-- 6. 存量函数加固（v4 遗留的安全问题）
-- 问题：get_event_full_config / calculate_statistic 原为 SECURITY DEFINER，会绕过 RLS；
--       且未设 search_path，有函数劫持风险。
-- 修复：改为 SECURITY INVOKER + 固定 search_path；calculate_statistic 重写为只统计
--       status='approved' 的成绩（与前端统计口径一致）。
-- 附带：删除三个未使用的匿名可读统计视图（competition_stats / participant_stats /
--       event_config_view），它们会绕过 RLS 把 pending 成绩数暴露给匿名用户；
--       前端已不使用这些视图（统计走浏览器端 + calculate_statistic），故直接删除。
-- ============================================

DROP VIEW IF EXISTS competition_stats;
DROP VIEW IF EXISTS participant_stats;
DROP VIEW IF EXISTS event_config_view;

-- 获取项目完整配置（自动继承父项目，子项目覆盖父项目同名键）
-- 先 DROP 再 CREATE：库中可能已存在老签名 get_event_full_config(event_id UUID)，
-- CREATE OR REPLACE 不允许改参数名，故显式删除（CASCADE 会顺带移除依赖它的旧
-- calculate_statistic，下方会重建，无副作用）。
DROP FUNCTION IF EXISTS get_event_full_config(UUID) CASCADE;
CREATE OR REPLACE FUNCTION get_event_full_config(p_event_id UUID)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
WITH RECURSIVE chain AS (
    SELECT id, parent_event_id, COALESCE(event_config, '{}'::jsonb) AS cfg, 0 AS depth
    FROM events WHERE id = p_event_id
    UNION ALL
    SELECT e.id, e.parent_event_id, COALESCE(e.event_config, '{}'::jsonb), c.depth + 1
    FROM events e JOIN chain c ON e.id = c.parent_event_id
)
SELECT COALESCE(
    (SELECT jsonb_object_agg(k, v)
     FROM (SELECT cfg FROM chain ORDER BY depth DESC) s, jsonb_each(cfg) AS t(k, v)),
    '{}'::jsonb
);
$$;

DROP FUNCTION IF EXISTS calculate_statistic(UUID, UUID, JSONB) CASCADE;
CREATE OR REPLACE FUNCTION calculate_statistic(
    p_participant_id UUID,
    p_event_id UUID,
    p_algorithm_config JSONB DEFAULT NULL
)
RETURNS DECIMAL(10,3) AS $$
DECLARE
    config JSONB;
    algo_type TEXT;
    window_size INT;
    trim_count INT;
    is_lower_better BOOLEAN;
    result DECIMAL(10,3);
    times DECIMAL(10,3)[];
BEGIN
    IF p_algorithm_config IS NULL THEN
        SELECT get_event_full_config(p_event_id) INTO config;
    ELSE
        config = p_algorithm_config;
    END IF;

    algo_type = config->>'algorithm_type';
    window_size = (config->>'window_size')::INT;
    trim_count = COALESCE((config->>'trim_count')::INT, 0);
    is_lower_better = COALESCE((config->>'is_lower_better')::BOOLEAN, TRUE);

    -- 参数校验（攻击测试修复）：拒绝负值/非法配置，防止统计失真
    IF trim_count < 0 OR trim_count > 100 THEN
        RAISE EXCEPTION 'trim_count 必须在 0~100 之间';
    END IF;
    IF window_size IS NOT NULL AND window_size < 1 THEN
        RAISE EXCEPTION 'window_size 必须为正整数';
    END IF;
    IF window_size IS NOT NULL AND window_size > 10000 THEN
        RAISE EXCEPTION 'window_size 过大';
    END IF;

    -- 只取已审核通过的成绩
    SELECT ARRAY_AGG(solve_time ORDER BY created_at)
    INTO times
    FROM attempts a
    JOIN competition_events ce ON a.competition_event_id = ce.id
    WHERE a.participant_id = p_participant_id
      AND ce.event_id = p_event_id
      AND a.status = 'approved'
      AND a.is_dnf = FALSE
      AND a.is_dns = FALSE
      AND a.is_plus_two = FALSE
      AND a.solve_time IS NOT NULL;

    IF times IS NULL OR array_length(times, 1) = 0 THEN
        RETURN NULL;
    END IF;

    IF algo_type = 'single' THEN
        SELECT MIN(unnest) INTO result FROM unnest(times);
    ELSIF algo_type = 'average' THEN
        IF window_size IS NOT NULL AND array_length(times, 1) >= window_size THEN
            WITH recent_times AS (
                SELECT unnest(times[array_length(times, 1) - window_size + 1 : array_length(times, 1)]) AS t
            )
            SELECT
                CASE
                    WHEN trim_count > 0 AND COUNT(t) > 2 * trim_count THEN
                        (SUM(t) - MAX(t) - MIN(t)) / (COUNT(t) - 2 * trim_count)
                    ELSE
                        AVG(t)
                END
            INTO result
            FROM recent_times;
        ELSE
            SELECT
                CASE
                    WHEN trim_count > 0 AND COUNT(*) > 2 * trim_count THEN
                        (SUM(t) - MAX(t) - MIN(t)) / (COUNT(t) - 2 * trim_count)
                    ELSE
                        AVG(t)
                END
            INTO result
            FROM unnest(times) AS t;
        END IF;
    ELSIF algo_type = 'mean' THEN
        SELECT AVG(unnest) INTO result FROM unnest(times);
    ELSIF algo_type = 'best_of' THEN
        SELECT MIN(unnest) INTO result FROM unnest(times);
    ELSIF algo_type = 'sub' THEN
        DECLARE
            threshold DECIMAL(10,3);
            sub_count INT;
            total_count INT;
        BEGIN
            threshold = (config->>'threshold')::DECIMAL;
            SELECT COUNT(*), array_length(times, 1)
            INTO sub_count, total_count
            FROM unnest(times) AS t
            WHERE t <= threshold;
            IF total_count > 0 THEN
                result = (sub_count::DECIMAL / total_count::DECIMAL) * 100;
            ELSE
                result = 0;
            END IF;
        END;
    END IF;

    RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER SET search_path = public;

-- ============================================
-- 7. 完成提示
-- ============================================
SELECT '权限系统（v6，自包含）部署完成！请先手动在 Supabase 建首位管理员账号（见部署手册），登录后可在「用户管理」给其他账号分配角色' AS status;
