# 历史证据目录

报告回答“那次做了什么、证明到哪里”，现行手册回答“现在怎么操作”。先选主题和日期，再读原报告；不要把旧恢复命令当成当前授权。

## app/docs 中的既有记录

逐份身份见[文件职责清单](CATALOG.md)。保留原路径和原文，避免已有引用失效：

- 2026-10-22：[清理交接](../app/docs/HANDOFF.md)、[阻塞恢复](../app/docs/BLOCK_RECOVERY_20261022.md)、[输出限制与检查机制](../app/docs/DSH_TOKEN_REVIEW.md)。
- 2026-10-23：[活动时间](../app/docs/DSH_ACTIVITY_TIME_20261023.md)、[字体恢复](../app/docs/FONT_RECOVERY_20261023.md)、[测试恢复](../app/docs/UNITY_TEST_RECOVERY_20261023.md)、[测试生命周期](../app/docs/TEST_LIFECYCLE_ACCEPTANCE_20261023.md)。
- 文档治理：[原规划差异](../app/docs/PLAN_DIFF_REVIEW.md)、[使用说明核对](../app/docs/DOCUMENTATION_CHECK.md)。候选建议不能代替之后的制作人决定。

## 2026-10-24 起本机专项报告

以下位于本机 reports，默认不随 Git 分发。新克隆缺失时应明确“本机证据未随仓库提供”，不能声称已经读取。

| 主题 | 资料 |
|---|---|
| 任务详情 | [调查](../reports/2026-10-24-task-detail-review/TASK_DETAIL_REVIEW.md)、[验收](../reports/2026-10-24-task-detail-review/FIX_ACCEPTANCE.md) |
| 负责人状态 | [记录](../reports/2026-10-24-task-detail-review/AGENT_STATUS_READABILITY.md) |
| 任务树 | [验收](../reports/2026-10-24-task-detail-review/TASK_TREE_ACCEPTANCE.md) |
| 最近成果 | [验收](../reports/2026-10-24-task-detail-review/RECENT_OUTCOMES_ACCEPTANCE.md) |
| 执行历史 | [验收](../reports/2026-10-24-task-detail-review/EXECUTION_HISTORY_ACCEPTANCE.md) |
| 决策与通知 | [验收](../reports/2026-10-24-task-detail-review/DECISION_NOTIFICATIONS_ACCEPTANCE.md) |
| 启动与续接 | [启动修复](../reports/2026-10-24-task-detail-review/LAUNCHER_AND_BLOCK_RECOVERY.md)、[续接结果](../reports/2026-10-24-task-detail-review/RESUME_RESULT.md) |
| DSH执行编排 | [过程调查](../reports/2026-10-24-task-detail-review/DSH_EXECUTION_PROCESS_AUDIT.md) |
| 规则入口 | [验收](../reports/2026-10-24-task-detail-review/AI_RULE_CENTER_ACCEPTANCE.md) |
| 最近Unity阶段失败 | [根因调查](../reports/2026-10-24-task-detail-review/LATEST_UNITY_BLOCK_CAUSES_20261025.md) |

## 更早归档和原始回执

2026-10-31 原生客户端：[同会话真实验证](../reports/2026-10-30-native-bridge-review/SAME_SESSION_VALIDATION.md)、[原生询问设置与验收状态](development-history/APPROVAL_AND_QUESTIONS.md)。规则发送与真实工具调用已核对；面板交互和用户选择须继续真人验收，不等于完整双向自动协作已完成。

2026-10-30 原生客户端与连接器：[复用调查](../reports/2026-10-30-native-bridge-review/REPORT.md)、[首选桥固定版本源码复核](../reports/2026-10-30-native-bridge-review/SOURCE_REVIEW.md)。仅调查及无模型启动原语验证，未安装或切换执行链。

`archive/2026-10-22-studio-experiments/` 是私有历史归档，不默认递归读取、不参与工作台运行。追溯旧规划或实验时先定位目标文件。

原生测试回执、执行事件、数据库备份的位置由具体报告和[运行手册](../app/docs/RUNBOOK.md)指出，本索引不复制它们。报告通过数只对应当时用例和版本，不与之后的失败互相抵消。
