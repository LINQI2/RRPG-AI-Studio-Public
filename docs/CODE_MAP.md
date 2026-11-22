# 代码、规则与运行数据地图

用于维护者定位实现，不要求制作人阅读代码。路径相对仓库；按 2026-10-25 文件结构核对。

| 要查/改什么 | 入口 | 注意 |
|---|---|---|
| 一键打开、代理与后台就绪 | [启动脚本](../app/scripts/open-studio.mjs) | 根 cmd 调用它；不等于重启部署 |
| HTTP 接口、网页会话与 CSRF | [http.ts](../app/src/server/http.ts) | 写入操作不能只改前端 |
| 任务、两位负责人、消息与工具处理 | [studio.ts](../app/src/server/studio.ts) | 保持原身份、关联和未知投递语义 |
| 数据表与迁移 | [db.ts](../app/src/server/db.ts) | 数据库是运行事实，不靠改文档清状态 |
| Codex 提供的工具字段 | [codex/tools.ts](../app/src/server/codex/tools.ts) | 现有 Thread 的 schema 兼容性仍需核对 |
| 角色文件读取、生效与补充保存 | [rules.ts](../app/src/server/rules.ts) → [rules 目录](../rules/README.md) | 不能建立第二份角色文本镜像 |
| DSH SDK 调用与阶段执行 | [runtime.ts](../app/src/server/dsh/runtime.ts)、[executor.ts](../app/src/server/dsh/executor.ts)、[sdk.ts](../app/src/server/dsh/sdk.ts) | 模型终态、阶段验证和交付是不同事实 |
| DSH 进展、原生证据与恢复 | [supervisor.ts](../app/src/server/dsh/supervisor.ts)、[session-journal.ts](../app/src/server/dsh/session-journal.ts) | 检查进展不等于自动重跑 |
| 受限工程文件与工作区 | [project-files.ts](../app/src/server/project-files.ts)、[project-workspace.ts](../app/src/server/dsh/project-workspace.ts) | 配置和历史通过不能扩大本轮授权 |
| Unity 连接、真实测试和持久回执 | [connection.ts](../app/src/server/unity/connection.ts)、[mcp.ts](../app/src/server/unity/mcp.ts)、[test-journal.ts](../app/src/server/unity/test-journal.ts) | 用户手动打开；核对工程，防止并发冲突 |
| 四入口与界面组件 | [main.tsx](../app/src/web/main.tsx)、[product-views.tsx](../app/src/web/product-views.tsx) | 专题组件在同目录，不把展示文案当真实执行状态 |
| 任务树、活动与通知 | [task-tree.tsx](../app/src/web/task-tree.tsx)、[execution-history.tsx](../app/src/web/execution-history.tsx)、[notifications.tsx](../app/src/web/notifications.tsx) | 层级、执行次数、模型轮次不能混为一类 |
| 配置及当前部署版本 | [config.ts](../app/src/server/config.ts)、[project-config.ts](../app/src/server/project-config.ts)、[runtime-status.ts](../app/src/server/runtime-status.ts) | 磁盘源码与运行构建可能不同 |
| 回归与命令 | [package.json](../app/package.json)、[tests](../app/tests)、[app README](../app/README.md) | 浏览器夹具不算真实模型或 Unity 验收 |

`app/runtime` 保存私有数据库、配置、原生 Session、认证和回执；具体位置查[运行手册](../app/docs/RUNBOOK.md)。`app/workspaces` 保存执行工作区，`app/dist` 为构建产物。不要手工修改构建产物来替代源码修复，也不要把执行工作区当正式源码自动合并。
