# 执行机制（Harness）

DSH是已接入的官方模型执行环境。Studio负责业务任务、身份、消息、持久化、结果验证和工程边界，两者共同构成实际运行链路。

这些机制由代码和明确配置控制，不因角色文字或Skill发生自动改变。本文件不启用新的权限、工作流或重试机制。

| 机制 | 当前源码 |
|---|---|
| 双Thread身份、派发、工具回执与任务 | app/src/server/studio.ts |
| 两位负责人原生工具schema | app/src/server/codex/tools.ts |
| DSH官方SDK、阶段与结果 | app/src/server/dsh/executor.ts、sdk.ts、runtime.ts |
| DSH进度检查 | app/src/server/dsh/supervisor.ts |
| Unity身份、独占、测试结果与保护 | app/src/server/unity/connection.ts、test-journal.ts |
| 项目读取边界 | app/src/server/project-files.ts |
| 角色文本读取、补充保存与版本 | app/src/server/rules.ts |

上表路径相对Studio根目录。运行工程、模型和凭据在私有runtime配置，不能把敏感配置复制进rules。

当前待改进：测试失败后同DSH Session有界修复尚未形成通用闭环；正常进度检查和负责人上下文开销仍需优化。不要把此说明或未来规划当已实现功能。
