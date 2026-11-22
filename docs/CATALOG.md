# 文件职责清单

核对日期：2026-10-25。覆盖根规划、全部现有 app/docs 文件和 rules 文本；源码按模块见[代码地图](CODE_MAP.md)。本清单区分文件身份，不宣布其所有内容均已重新验收。

## 长期入口与规则

| 文件 | 回答的问题 / 维护方式 |
|---|---|
| [根 README](../README.md) | 是什么、怎么打开、从哪开始；不堆阶段日志 |
| [AGENTS](../AGENTS.md) | 外部 AI 如何接手；导航不替代角色和领域规则 |
| [PRD](../PRD.md) | 已确认产品边界；需求改变时更新，不把测试通过写成需求 |
| [ARCHITECTURE](../ARCHITECTURE.md) | 组件职责和安全边界；实现变化后核对同步 |
| [IMPLEMENTATION_PLAN](../IMPLEMENTATION_PLAN.md) | 当前工作入口及未完成方向；不重新授权历史任务 |
| [app README](../app/README.md) | 应用开发、运行与测试命令 |
| [rules README](../rules/README.md) | 实际规则加载和编辑入口 |
| [主策划基础规则](../rules/roles/planner.md)、[主开发基础规则](../rules/roles/developer.md)、[DSH 基础规则](../rules/roles/dsh.md) | 程序实际读取；修改会影响后续模型行为，不能当普通说明随意搬动 |
| [主策划补充](../rules/preferences/planner.md)、[主开发补充](../rules/preferences/developer.md) | 制作人偏好；网页可编辑，不授予系统权限 |
| [Skill 入口](../rules/skills/README.md) | 实际启用情况；目录存在不等于自动加载 |
| [Harness 入口](../rules/harness/README.md) | 执行机制的代码导航，不是权限配置文件 |

## 现行使用与维护资料：app/docs

| 文件 | 身份与用途 |
|---|---|
| [INDEX](../app/docs/INDEX.md) | 使用说明目录；全仓资料转到本目录 README |
| [USER_GUIDE](../app/docs/USER_GUIDE.md) | 制作人的操作流程、成果阅读、任务树和通知 |
| [PRODUCER_PROXY_GUIDE](../app/docs/PRODUCER_PROXY_GUIDE.md) | AI 代理制作人的委托边界与操作流程 |
| [AI_OPERATOR_GUIDE](../app/docs/AI_OPERATOR_GUIDE.md) | 工具使用和协作协议；具体参数以实际 schema 为准 |
| [RUNBOOK](../app/docs/RUNBOOK.md) | 启停、配置、连接、数据位置和恢复；其中日期化快照不是实时状态 |
| [SOURCE_CONTROL](../app/docs/SOURCE_CONTROL.md) | Git 范围、敏感数据排除与提交前检查 |
| [UNITY_COMPATIBILITY](../app/docs/UNITY_COMPATIBILITY.md) | 版本相关补丁适用条件，不是所有工程已应用的证明 |
| [project-config.example.json](../app/docs/project-config.example.json) | 配置示例，不是活动配置，不应填入真实凭据 |

## 历史核对 / 交付资料：保留原路径

这些文件不是当前操作指南；不因文件名带 HANDOFF、REVIEW 或 ACCEPTANCE 就获得当前状态的优先级。原文保留，以免破坏证据及引用。

| 文件 | 保存的事情 |
|---|---|
| [HANDOFF](../app/docs/HANDOFF.md) | 2026-10-22 空白工作台收尾；其中“未绑定、零历史”是当时状态 |
| [DOCUMENTATION_CHECK](../app/docs/DOCUMENTATION_CHECK.md) | 使用说明核对及后续补记；不是全系统当前验收报告 |
| [PLAN_DIFF_REVIEW](../app/docs/PLAN_DIFF_REVIEW.md) | 原规划与当时实现的差异；后续已确认流程查 PRD，缺口须回读代码 |
| [BLOCK_RECOVERY_20261022](../app/docs/BLOCK_RECOVERY_20261022.md) | Pilot 接入阻塞与当时解除记录 |
| [DSH_TOKEN_REVIEW](../app/docs/DSH_TOKEN_REVIEW.md) | 输出限制和检查机制的历史修改记录 |
| [DSH_ACTIVITY_TIME_20261023](../app/docs/DSH_ACTIVITY_TIME_20261023.md) | 执行活动时间显示的交付记录 |
| [FONT_RECOVERY_20261023](../app/docs/FONT_RECOVERY_20261023.md) | 字体保护与恢复的专项证据 |
| [UNITY_TEST_RECOVERY_20261023](../app/docs/UNITY_TEST_RECOVERY_20261023.md) | Unity 中断核对与补测记录 |
| [TEST_LIFECYCLE_ACCEPTANCE_20261023](../app/docs/TEST_LIFECYCLE_ACCEPTANCE_20261023.md) | 测试生命周期修订及分层验收 |

更多本机报告见[证据目录](EVIDENCE.md)。旧文档不搬迁、不删原文；新阶段报告统一进入 reports 的日期目录，避免继续混入使用手册。

## 主开发规则分层补记（2026-10-25）

[protocols/developer.md](../rules/protocols/developer.md)是主开发的实际工具协议，与基础角色和补充要求合并发送；网页独立折叠查看。职责正文已按制作人确认精简，协议缺失时不发送对话。

[主策划协议](../rules/protocols/planner.md)与主策划角色分别维护，由后端合并发送；不能只修改正文而遗漏工具协议。
