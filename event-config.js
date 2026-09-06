/**
 * 魔方比赛项目配置系统
 * 定义所有项目类型的配置字段说明和常用模板
 * 使用方法：在 index.html 中 <script src="event-config.js"></script>
 */

var EventConfig = (function() {

    // ======================== 配置字段定义 ========================
    var schema = {
        // ---- 硬件与记录 ----
        supports_smart_cube: {
            type: 'boolean',
            default: false,
            label: '支持智能魔方',
            description: '是否支持通过智能魔方（魔域、GAN等）自动记录成绩。开启后录入界面会显示连接魔方选项。'
        },
        record_steps: {
            type: 'boolean',
            default: false,
            label: '记录步数',
            description: '是否记录复原步数。开启后录入界面显示步数输入框，用于步数统计和分析。'
        },
        record_tps: {
            type: 'boolean',
            default: false,
            label: '记录TPS',
            description: '是否记录每秒转动次数（Turns Per Second）。开启后根据成绩和步数自动计算TPS。'
        },
        record_video: {
            type: 'boolean',
            default: false,
            label: '记录视频',
            description: '是否要求记录尝试过程视频。开启后录入界面显示视频链接输入框，用于成绩验证。'
        },
        record_algorithm: {
            type: 'boolean',
            default: false,
            label: '记录公式/解法',
            description: '是否记录复原公式或解法。适用于FMC（最少步数）等项目。'
        },

        // ---- 尝试编号 ----
        attempt_id_type: {
            type: 'enum',
            enum: ['number', 'letter', 'custom'],
            default: 'number',
            label: '尝试编号类型',
            description: '尝试编号格式：number=数字(1,2,3…)，letter=字母(A,B,C…)，custom=自定义文本。'
        },
        attempt_id_label: {
            type: 'string',
            default: '尝试编号',
            label: '尝试编号标签',
            description: '录入界面中"尝试编号"字段的显示名称，可自定义为"轮次"、"局"等。'
        },
        max_attempts: {
            type: 'number',
            default: 5,
            label: '最大尝试次数',
            description: '每位选手在该项目中的最大尝试次数。WCA标准：盲拧3次，其他通常5次。'
        },
        best_of: {
            type: 'number',
            default: 1,
            label: '取最好成绩数',
            description: '从所有尝试中取最好的N个成绩计入统计。通常为1（只取最好的一次）。'
        },

        // ---- 惩罚规则 ----
        penalty_types: {
            type: 'array',
            default: ['none', '+2', 'DNF'],
            label: '允许的惩罚类型',
            description: '该项目允许的惩罚类型列表。可选值：none（无惩罚）、+2（+2秒惩罚）、DNF（未完成）。'
        },
        allow_plus_two: {
            type: 'boolean',
            default: true,
            label: '允许 +2 惩罚',
            description: '是否允许+2秒惩罚。部分非WCA项目可能不采用+2规则。盲拧项目应关闭。'
        },
        allow_dnf: {
            type: 'boolean',
            default: true,
            label: '允许 DNF',
            description: '是否允许DNF（Did Not Finish，未完成）。关闭后选手必须完成每次尝试。'
        },

        // ---- 算法配置 ----
        algorithm_type: {
            type: 'enum',
            enum: ['single', 'average', 'mean', 'best_of', 'sub'],
            default: 'single',
            label: '算法类型',
            description: '计算成绩所用算法：single=单次成绩；average=去头尾平均（WCA标准）；mean=算术平均；best_of=取最好N次；sub=低于阈值的比例统计。'
        },
        window_size: {
            type: 'number',
            default: 5,
            label: '算法窗口大小',
            description: 'average/mean算法中的窗口大小，即取最近N次成绩计算。AO5=5，AO12=12。'
        },
        trim_count: {
            type: 'number',
            default: 1,
            label: '修剪次数（去头尾）',
            description: 'average算法中去掉最高和最低成绩的数量（每边）。WCA标准：AO5和AO12都是去1个最高和1个最低。'
        },
        is_lower_better: {
            type: 'boolean',
            default: true,
            label: '越低越好',
            description: '成绩是否越低越好。魔方计时项目为true（越快越好）。注意FMC也是越低（步数少）越好。'
        },
        threshold: {
            type: 'number',
            default: null,
            label: '阈值（SUB-X，秒）',
            description: 'sub算法中的阈值（秒）。统计低于该阈值的成绩比例。例如threshold=10.000时，统计SUB-10的比例。仅 algorithm_type=sub 时有效。'
        },
        inherit_from_parent: {
            type: 'boolean',
            default: false,
            label: '继承父项目配置',
            description: '是否继承父项目的配置。子项目（如3x3-ao5）可继承父项目（如3x3）的硬件和记录配置，避免重复填写。'
        },

        // ---- 比赛规则 ----
        use_wca_rules: {
            type: 'boolean',
            default: true,
            label: '使用WCA规则',
            description: '是否采用WCA官方比赛规则（包括+2惩罚判定、DNF判定、计时器精度等）。'
        },
        timer_precision: {
            type: 'enum',
            enum: ['0.001', '0.01', '0.1'],
            default: '0.001',
            label: '计时精度（秒）',
            description: '计时器精度，单位秒。WCA标准：0.001秒（千分位）。部分非正式比赛可能用0.01秒。'
        },
        inspection_time: {
            type: 'number',
            default: 15,
            label: '观察时间（秒）',
            description: '允许的观察时间。WCA标准：15秒。盲拧项目通常为0（无单独观察时间）。'
        },
        cumulative_time: {
            type: 'boolean',
            default: false,
            label: '累计计时（盲拧）',
            description: '是否采用累计计时（盲拧项目专用）。开启后观察时间会计入总成绩。'
        },

        // ---- 显示设置 ----
        sort_order: {
            type: 'number',
            default: 0,
            label: '排序权重',
            description: '项目在列表中的排序权重，数值越小越靠前。用于自定义项目显示顺序。'
        },
        show_in_leaderboard: {
            type: 'boolean',
            default: true,
            label: '显示在排行榜',
            description: '该项目是否显示在公开排行榜中。AO50/AO100等训练统计通常不显示。'
        },
        is_official_wca: {
            type: 'boolean',
            default: true,
            label: 'WCA官方项目',
            description: '是否为WCA官方比赛项目。影响是否采用WCA标准规则默认值。'
        }
    };

    // ======================== 配置模板 ========================
    var templates = {

        // ---- WCA 标准单次项目 ----
        '3x3_single': {
            name: '三阶速拧 - 单次',
            description: 'WCA标准三阶速拧单次成绩',
            icon: '🎲',
            event_config: {
                supports_smart_cube: true,
                record_steps: true,
                record_tps: true,
                record_video: false,
                record_algorithm: false,
                attempt_id_type: 'number',
                attempt_id_label: '尝试',
                max_attempts: 5,
                best_of: 1,
                penalty_types: ['none', '+2', 'DNF'],
                allow_plus_two: true,
                allow_dnf: true,
                use_wca_rules: true,
                timer_precision: '0.001',
                inspection_time: 15,
                cumulative_time: false,
                sort_order: 10,
                show_in_leaderboard: true,
                is_official_wca: true
            },
            algorithm_config: {
                algorithm_type: 'single',
                is_lower_better: true
            }
        },

        '2x2_single': {
            name: '二阶速拧 - 单次',
            description: 'WCA标准二阶速拧单次成绩',
            icon: '🎲',
            event_config: {
                supports_smart_cube: true,
                record_steps: true,
                record_tps: true,
                record_video: false,
                record_algorithm: false,
                attempt_id_type: 'number',
                attempt_id_label: '尝试',
                max_attempts: 5,
                best_of: 1,
                penalty_types: ['none', '+2', 'DNF'],
                allow_plus_two: true,
                allow_dnf: true,
                use_wca_rules: true,
                timer_precision: '0.001',
                inspection_time: 15,
                cumulative_time: false,
                sort_order: 20,
                show_in_leaderboard: true,
                is_official_wca: true
            },
            algorithm_config: {
                algorithm_type: 'single',
                is_lower_better: true
            }
        },

        '4x4_single': {
            name: '四阶速拧 - 单次',
            description: 'WCA标准四阶速拧单次成绩',
            icon: '🎲',
            event_config: {
                supports_smart_cube: false,
                record_steps: true,
                record_tps: true,
                record_video: false,
                record_algorithm: false,
                attempt_id_type: 'number',
                attempt_id_label: '尝试',
                max_attempts: 5,
                best_of: 1,
                penalty_types: ['none', '+2', 'DNF'],
                allow_plus_two: true,
                allow_dnf: true,
                use_wca_rules: true,
                timer_precision: '0.001',
                inspection_time: 15,
                cumulative_time: false,
                sort_order: 30,
                show_in_leaderboard: true,
                is_official_wca: true
            },
            algorithm_config: {
                algorithm_type: 'single',
                is_lower_better: true
            }
        },

        '5x5_single': {
            name: '五阶速拧 - 单次',
            description: 'WCA标准五阶速拧单次成绩',
            icon: '🎲',
            event_config: {
                supports_smart_cube: false,
                record_steps: true,
                record_tps: true,
                record_video: false,
                record_algorithm: false,
                attempt_id_type: 'number',
                attempt_id_label: '尝试',
                max_attempts: 5,
                best_of: 1,
                penalty_types: ['none', '+2', 'DNF'],
                allow_plus_two: true,
                allow_dnf: true,
                use_wca_rules: true,
                timer_precision: '0.001',
                inspection_time: 15,
                cumulative_time: false,
                sort_order: 40,
                show_in_leaderboard: true,
                is_official_wca: true
            },
            algorithm_config: {
                algorithm_type: 'single',
                is_lower_better: true
            }
        },

        '6x6_single': {
            name: '六阶速拧 - 单次',
            description: 'WCA标准六阶速拧单次成绩',
            icon: '🎲',
            event_config: {
                supports_smart_cube: false,
                record_steps: false,
                record_tps: false,
                record_video: false,
                record_algorithm: false,
                attempt_id_type: 'number',
                attempt_id_label: '尝试',
                max_attempts: 3,
                best_of: 1,
                penalty_types: ['none', '+2', 'DNF'],
                allow_plus_two: true,
                allow_dnf: true,
                use_wca_rules: true,
                timer_precision: '0.001',
                inspection_time: 15,
                cumulative_time: false,
                sort_order: 50,
                show_in_leaderboard: true,
                is_official_wca: true
            },
            algorithm_config: {
                algorithm_type: 'single',
                is_lower_better: true
            }
        },

        '7x7_single': {
            name: '七阶速拧 - 单次',
            description: 'WCA标准七阶速拧单次成绩',
            icon: '🎲',
            event_config: {
                supports_smart_cube: false,
                record_steps: false,
                record_tps: false,
                record_video: false,
                record_algorithm: false,
                attempt_id_type: 'number',
                attempt_id_label: '尝试',
                max_attempts: 3,
                best_of: 1,
                penalty_types: ['none', '+2', 'DNF'],
                allow_plus_two: true,
                allow_dnf: true,
                use_wca_rules: true,
                timer_precision: '0.001',
                inspection_time: 15,
                cumulative_time: false,
                sort_order: 60,
                show_in_leaderboard: true,
                is_official_wca: true
            },
            algorithm_config: {
                algorithm_type: 'single',
                is_lower_better: true
            }
        },

        // ---- 平均项目（子项目）----
        '3x3_ao5': {
            name: '三阶 - AO5（平均5次）',
            description: '三阶速拧平均5次成绩，去掉最高最低各1个后取平均',
            icon: '📊',
            event_config: {
                supports_smart_cube: true,
                record_steps: true,
                record_tps: true,
                record_video: false,
                record_algorithm: false,
                attempt_id_type: 'number',
                attempt_id_label: '尝试',
                max_attempts: 5,
                best_of: 1,
                penalty_types: ['none', '+2', 'DNF'],
                allow_plus_two: true,
                allow_dnf: true,
                use_wca_rules: true,
                timer_precision: '0.001',
                inspection_time: 15,
                cumulative_time: false,
                inherit_from_parent: true,
                sort_order: 11,
                show_in_leaderboard: true,
                is_official_wca: true
            },
            algorithm_config: {
                algorithm_type: 'average',
                window_size: 5,
                trim_count: 1,
                is_lower_better: true,
                inherit_from_parent: true
            }
        },

        '3x3_ao12': {
            name: '三阶 - AO12（平均12次）',
            description: '三阶速拧平均12次成绩，去掉最高最低各1个后取平均',
            icon: '📊',
            event_config: {
                supports_smart_cube: true,
                record_steps: true,
                record_tps: true,
                record_video: false,
                record_algorithm: false,
                attempt_id_type: 'number',
                attempt_id_label: '尝试',
                max_attempts: 12,
                best_of: 1,
                penalty_types: ['none', '+2', 'DNF'],
                allow_plus_two: true,
                allow_dnf: true,
                use_wca_rules: true,
                timer_precision: '0.001',
                inspection_time: 15,
                cumulative_time: false,
                inherit_from_parent: true,
                sort_order: 12,
                show_in_leaderboard: true,
                is_official_wca: true
            },
            algorithm_config: {
                algorithm_type: 'average',
                window_size: 12,
                trim_count: 1,
                is_lower_better: true,
                inherit_from_parent: true
            }
        },

        '3x3_ao50': {
            name: '三阶 - AO50（平均50次）',
            description: '三阶速拧平均50次成绩，用于训练统计',
            icon: '📊',
            event_config: {
                supports_smart_cube: true,
                record_steps: true,
                record_tps: true,
                record_video: false,
                record_algorithm: false,
                attempt_id_type: 'number',
                attempt_id_label: '尝试',
                max_attempts: 50,
                best_of: 1,
                penalty_types: ['none', '+2', 'DNF'],
                allow_plus_two: true,
                allow_dnf: true,
                use_wca_rules: true,
                timer_precision: '0.001',
                inspection_time: 15,
                cumulative_time: false,
                inherit_from_parent: true,
                sort_order: 13,
                show_in_leaderboard: false,
                is_official_wca: false
            },
            algorithm_config: {
                algorithm_type: 'average',
                window_size: 50,
                trim_count: 1,
                is_lower_better: true,
                inherit_from_parent: true
            }
        },

        '3x3_ao100': {
            name: '三阶 - AO100（平均100次）',
            description: '三阶速拧平均100次成绩，用于训练统计',
            icon: '📊',
            event_config: {
                supports_smart_cube: true,
                record_steps: true,
                record_tps: true,
                record_video: false,
                record_algorithm: false,
                attempt_id_type: 'number',
                attempt_id_label: '尝试',
                max_attempts: 100,
                best_of: 1,
                penalty_types: ['none', '+2', 'DNF'],
                allow_plus_two: true,
                allow_dnf: true,
                use_wca_rules: true,
                timer_precision: '0.001',
                inspection_time: 15,
                cumulative_time: false,
                inherit_from_parent: true,
                sort_order: 14,
                show_in_leaderboard: false,
                is_official_wca: false
            },
            algorithm_config: {
                algorithm_type: 'average',
                window_size: 100,
                trim_count: 1,
                is_lower_better: true,
                inherit_from_parent: true
            }
        },

        // ---- 单手项目 ----
        '3x3_oh_single': {
            name: '三阶单手 - 单次',
            description: 'WCA标准三阶单手速拧单次成绩',
            icon: '🤚',
            event_config: {
                supports_smart_cube: true,
                record_steps: true,
                record_tps: true,
                record_video: false,
                record_algorithm: false,
                attempt_id_type: 'number',
                attempt_id_label: '尝试',
                max_attempts: 5,
                best_of: 1,
                penalty_types: ['none', '+2', 'DNF'],
                allow_plus_two: true,
                allow_dnf: true,
                use_wca_rules: true,
                timer_precision: '0.001',
                inspection_time: 15,
                cumulative_time: false,
                sort_order: 70,
                show_in_leaderboard: true,
                is_official_wca: true
            },
            algorithm_config: {
                algorithm_type: 'single',
                is_lower_better: true
            }
        },

        '3x3_oh_ao5': {
            name: '三阶单手 - AO5',
            description: '三阶单手速拧平均5次成绩',
            icon: '🤚',
            event_config: {
                supports_smart_cube: true,
                record_steps: true,
                record_tps: true,
                record_video: false,
                record_algorithm: false,
                attempt_id_type: 'number',
                attempt_id_label: '尝试',
                max_attempts: 5,
                best_of: 1,
                penalty_types: ['none', '+2', 'DNF'],
                allow_plus_two: true,
                allow_dnf: true,
                use_wca_rules: true,
                timer_precision: '0.001',
                inspection_time: 15,
                cumulative_time: false,
                inherit_from_parent: true,
                sort_order: 71,
                show_in_leaderboard: true,
                is_official_wca: true
            },
            algorithm_config: {
                algorithm_type: 'average',
                window_size: 5,
                trim_count: 1,
                is_lower_better: true,
                inherit_from_parent: true
            }
        },

        // ---- 盲拧项目 ----
        '3x3_bld': {
            name: '三阶盲拧',
            description: 'WCA标准三阶盲拧（3次尝试取最好）',
            icon: '🙈',
            event_config: {
                supports_smart_cube: false,
                record_steps: false,
                record_tps: false,
                record_video: true,
                record_algorithm: false,
                attempt_id_type: 'number',
                attempt_id_label: '尝试',
                max_attempts: 3,
                best_of: 1,
                penalty_types: ['none', 'DNF'],
                allow_plus_two: false,
                allow_dnf: true,
                use_wca_rules: true,
                timer_precision: '0.001',
                inspection_time: 0,
                cumulative_time: true,
                sort_order: 80,
                show_in_leaderboard: true,
                is_official_wca: true
            },
            algorithm_config: {
                algorithm_type: 'single',
                is_lower_better: true
            }
        },

        '4x4_bld': {
            name: '四阶盲拧',
            description: 'WCA标准四阶盲拧',
            icon: '🙈',
            event_config: {
                supports_smart_cube: false,
                record_steps: false,
                record_tps: false,
                record_video: true,
                record_algorithm: false,
                attempt_id_type: 'number',
                attempt_id_label: '尝试',
                max_attempts: 3,
                best_of: 1,
                penalty_types: ['none', 'DNF'],
                allow_plus_two: false,
                allow_dnf: true,
                use_wca_rules: true,
                timer_precision: '0.001',
                inspection_time: 0,
                cumulative_time: true,
                sort_order: 81,
                show_in_leaderboard: true,
                is_official_wca: true
            },
            algorithm_config: {
                algorithm_type: 'single',
                is_lower_better: true
            }
        },

        '5x5_bld': {
            name: '五阶盲拧',
            description: 'WCA标准五阶盲拧',
            icon: '🙈',
            event_config: {
                supports_smart_cube: false,
                record_steps: false,
                record_tps: false,
                record_video: true,
                record_algorithm: false,
                attempt_id_type: 'number',
                attempt_id_label: '尝试',
                max_attempts: 3,
                best_of: 1,
                penalty_types: ['none', 'DNF'],
                allow_plus_two: false,
                allow_dnf: true,
                use_wca_rules: true,
                timer_precision: '0.001',
                inspection_time: 0,
                cumulative_time: true,
                sort_order: 82,
                show_in_leaderboard: true,
                is_official_wca: true
            },
            algorithm_config: {
                algorithm_type: 'single',
                is_lower_better: true
            }
        },

        '3x3_multibld': {
            name: '三阶多盲（MBLD）',
            description: 'WCA标准三阶多盲，比谁在限定时间内还原的数量多',
            icon: '🙉',
            event_config: {
                supports_smart_cube: false,
                record_steps: false,
                record_tps: false,
                record_video: true,
                record_algorithm: false,
                attempt_id_type: 'number',
                attempt_id_label: '尝试',
                max_attempts: 3,
                best_of: 1,
                penalty_types: ['none', 'DNF'],
                allow_plus_two: false,
                allow_dnf: true,
                use_wca_rules: true,
                timer_precision: '0.001',
                inspection_time: 0,
                cumulative_time: true,
                sort_order: 83,
                show_in_leaderboard: true,
                is_official_wca: true
            },
            algorithm_config: {
                algorithm_type: 'single',
                is_lower_better: false
            }
        },

        // ---- 最少步数 ----
        '3x3_fmc': {
            name: '三阶最少步数（FMC）',
            description: 'WCA标准三阶最少步数，比谁用的步数少',
            icon: '📐',
            event_config: {
                supports_smart_cube: false,
                record_steps: true,
                record_tps: false,
                record_video: false,
                record_algorithm: true,
                attempt_id_type: 'number',
                attempt_id_label: '尝试',
                max_attempts: 3,
                best_of: 1,
                penalty_types: ['none'],
                allow_plus_two: false,
                allow_dnf: false,
                use_wca_rules: true,
                timer_precision: '0.001',
                inspection_time: 0,
                cumulative_time: false,
                sort_order: 90,
                show_in_leaderboard: true,
                is_official_wca: true
            },
            algorithm_config: {
                algorithm_type: 'single',
                is_lower_better: true
            }
        },

        // ---- 脚拧 ----
        '3x3_with_feet': {
            name: '三阶脚拧',
            description: 'WCA标准三阶脚拧',
            icon: '🦶',
            event_config: {
                supports_smart_cube: false,
                record_steps: true,
                record_tps: true,
                record_video: false,
                record_algorithm: false,
                attempt_id_type: 'number',
                attempt_id_label: '尝试',
                max_attempts: 5,
                best_of: 1,
                penalty_types: ['none', '+2', 'DNF'],
                allow_plus_two: true,
                allow_dnf: true,
                use_wca_rules: true,
                timer_precision: '0.001',
                inspection_time: 15,
                cumulative_time: false,
                sort_order: 100,
                show_in_leaderboard: true,
                is_official_wca: true
            },
            algorithm_config: {
                algorithm_type: 'single',
                is_lower_better: true
            }
        },

        // ---- SUB-X 统计项目 ----
        '3x3_sub10': {
            name: '三阶 SUB-10 统计',
            description: '统计三阶单次成绩中低于10秒的比例',
            icon: '📈',
            event_config: {
                supports_smart_cube: true,
                record_steps: false,
                record_tps: false,
                record_video: false,
                record_algorithm: false,
                attempt_id_type: 'number',
                attempt_id_label: '尝试',
                max_attempts: 100,
                best_of: 0,
                penalty_types: ['none', '+2', 'DNF'],
                allow_plus_two: true,
                allow_dnf: true,
                use_wca_rules: false,
                timer_precision: '0.001',
                inspection_time: 15,
                cumulative_time: false,
                sort_order: 200,
                show_in_leaderboard: false,
                is_official_wca: false
            },
            algorithm_config: {
                algorithm_type: 'sub',
                threshold: 10.000,
                is_lower_better: true
            }
        },

        '3x3_sub15': {
            name: '三阶 SUB-15 统计',
            description: '统计三阶单次成绩中低于15秒的比例',
            icon: '📈',
            event_config: {
                supports_smart_cube: true,
                record_steps: false,
                record_tps: false,
                record_video: false,
                record_algorithm: false,
                attempt_id_type: 'number',
                attempt_id_label: '尝试',
                max_attempts: 100,
                best_of: 0,
                penalty_types: ['none', '+2', 'DNF'],
                allow_plus_two: true,
                allow_dnf: true,
                use_wca_rules: false,
                timer_precision: '0.001',
                inspection_time: 15,
                cumulative_time: false,
                sort_order: 201,
                show_in_leaderboard: false,
                is_official_wca: false
            },
            algorithm_config: {
                algorithm_type: 'sub',
                threshold: 15.000,
                is_lower_better: true
            }
        },

        // ---- 非WCA趣味项目 ----
        '3x3_relay': {
            name: '三阶接力',
            description: '非WCA趣味项目，连续复原多个魔方计时',
            icon: '🏃',
            event_config: {
                supports_smart_cube: true,
                record_steps: false,
                record_tps: false,
                record_video: false,
                record_algorithm: false,
                attempt_id_type: 'number',
                attempt_id_label: '局',
                max_attempts: 3,
                best_of: 1,
                penalty_types: ['none', 'DNF'],
                allow_plus_two: false,
                allow_dnf: true,
                use_wca_rules: false,
                timer_precision: '0.001',
                inspection_time: 15,
                cumulative_time: false,
                sort_order: 300,
                show_in_leaderboard: true,
                is_official_wca: false
            },
            algorithm_config: {
                algorithm_type: 'single',
                is_lower_better: true
            }
        }
    };

    // ======================== 工具函数 ========================

    /**
     * 获取所有模板列表（用于下拉选择）
     */
    function getTemplateList() {
        var list = [];
        for (var key in templates) {
            if (templates.hasOwnProperty(key)) {
                list.push({
                    key: key,
                    name: templates[key].name,
                    description: templates[key].description,
                    icon: templates[key].icon || '📌'
                });
            }
        }
        return list;
    }

    /**
     * 应用模板，返回 {event_config, algorithm_config}
     */
    function applyTemplate(templateKey) {
        var t = templates[templateKey];
        if (!t) return null;
        return {
            event_config: JSON.parse(JSON.stringify(t.event_config)),
            algorithm_config: JSON.parse(JSON.stringify(t.algorithm_config))
        };
    }

    /**
     * 用 schema 默认值填充配置（只填充未定义字段）
     */
    function fillDefaults(config, configType) {
        config = config || {};
        var targetSchema = configType === 'algorithm' ? getAlgorithmSchema() : schema;
        for (var field in targetSchema) {
            if (targetSchema.hasOwnProperty(field) && config[field] === undefined) {
                config[field] = targetSchema[field].default;
            }
        }
        return config;
    }

    /**
     * 获取算法配置的 schema（独立定义，因为 algorithm_config 字段较少）
     */
    function getAlgorithmSchema() {
        return {
            algorithm_type: schema.algorithm_type,
            window_size: schema.window_size,
            trim_count: schema.trim_count,
            is_lower_better: schema.is_lower_better,
            threshold: schema.threshold,
            inherit_from_parent: schema.inherit_from_parent
        };
    }

    /**
     * 验证配置对象
     * @param {object} config - 要验证的配置
     * @param {string} configType - 'event' 或 'algorithm'
     * @returns {object} {valid, errors}
     */
    function validateConfig(config, configType) {
        var errors = [];
        var targetSchema = configType === 'algorithm' ? getAlgorithmSchema() : schema;

        for (var field in targetSchema) {
            if (!targetSchema.hasOwnProperty(field)) continue;
            var def = targetSchema[field];
            var val = config[field];

            if (val === undefined) continue;  // 允许未定义，会用默认值填充

            if (def.type === 'boolean' && typeof val !== 'boolean') {
                errors.push(label + '「' + def.label + '」应为布尔值（true/false）');
            } else if (def.type === 'number' && typeof val !== 'number') {
                errors.push('字段「' + def.label + '」应为数字');
            } else if (def.type === 'string' && typeof val !== 'string') {
                errors.push('字段「' + def.label + '」应为文本');
            } else if (def.type === 'enum' && def.enum && def.enum.indexOf(val) === -1) {
                errors.push('字段「' + def.label + '」应为以下值之一：' + def.enum.join(' / '));
            } else if (def.type === 'array' && !Array.isArray(val)) {
                errors.push('字段「' + def.label + '」应为数组');
            }
        }
        return { valid: errors.length === 0, errors: errors };
    }

    // ======================== 公开 API ========================
    return {
        schema: schema,
        templates: templates,
        defaults: fillDefaults({}, 'event'),
        getTemplateList: getTemplateList,
        applyTemplate: applyTemplate,
        fillDefaults: fillDefaults,
        validateConfig: validateConfig,
        getAlgorithmSchema: getAlgorithmSchema
    };

})();
