-- ============================================
-- 数据库精简：删除已废弃的表
-- 适用：在 Supabase 后台 SQL Editor 执行（或 psql）
-- 背景：Gamma MLE 预测、算法配置、统计定义等功能已从前端移除，
--       以下 4 张表当前前端(js/)与 worker(worker.js) 均已不再引用，
--       属于废弃残留，可安全删除以“压缩数据库到最简”。
-- 安全：全部使用 IF EXISTS，重复执行不会报错；
--       DROP TABLE 会一并移除这些表上的 RLS 策略，无需单独 DROP POLICY。
-- ============================================

-- 1) mle_predictions：Gamma MLE 预测结果（仅旧版 index-v3.html 写过，现版不引用）
DROP TABLE IF EXISTS mle_predictions;

-- 2) event_algorithms：项目算法配置（algorithm_config 表单相关，已精简保留）
DROP TABLE IF EXISTS event_algorithms;

-- 3) statistics_definitions：统计定义（仅旧版引用）
DROP TABLE IF EXISTS statistics_definitions;

-- 4) participant_statistics：选手统计（仅旧版引用）
DROP TABLE IF EXISTS participant_statistics;

-- 备注：若后续需要重建这些表，schema 历史文件（schema-v5.sql 等）仍保留在仓库，
--       且 git 历史可随时恢复；本删除仅作用于当前运行库。
