# Studio 应用

第一次使用请从 [帮助目录](docs/INDEX.md)进入：制作人读 [上手与日常使用](docs/USER_GUIDE.md)，AI读 [角色和工具操作协议](docs/AI_OPERATOR_GUIDE.md)，维护者读 [启动与配置](docs/RUNBOOK.md)。

React、TypeScript、Node.js、SQLite，REST＋SSE。Codex CLI App Server 提供两位长期负责人；DSH 官方 SDK 提供有界工作包、阶段、文件操作及可选 Managed Shell。

运行：npm ci → npm run build → ./Start-Studio.ps1。关闭：./Stop-Studio.ps1。

检查：npm run typecheck、npm test、npm run test:e2e。浏览器回归使用3199独立数据库与协议夹具，不访问3178当前业务历史，不调用真实模型或编辑器。

项目配置、手动Unity连接、备份和恢复见 [运行手册](docs/RUNBOOK.md)。原型、旧会话及固定工程适配已归档，活动程序没有历史导入入口。
