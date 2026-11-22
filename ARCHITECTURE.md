# 当前架构

文档身份：技术职责和边界总览；模块定位见[代码地图](docs/CODE_MAP.md)，验证见[状态与证据](docs/STATUS.md)。运行时还须核对构建版本和私有配置，本文不代替接口schema。

单package：React制作人界面 → REST/SSE → SQLite账本、Codex App Server、DSH官方SDK。两位负责人各有一个长期Thread，显式初始化绑定，消息来源从原生工具调用身份推导。

DSH保留两个执行槽位、任务级reasoningEffort、可选maxTokens、有界阶段和检查点。独立执行目录位于Studio管理的workspaces内；明确授权的工程接入另由project-workspace及项目文件工具核对，不因配置路径自动获权。Managed Shell沿用官方Windows沙箱及定向权限准备/回收，全局Shell关闭。普通用户进程不等于完整文件系统/网络隔离。

Unity仅连接显式配置、用户手动打开的工程，核对路径和版本；工程锁避免冲突，未知测试结果保留锁，不重发、不杀用户编辑器。通用tests-run保留真实计数和错误详情，仅测试请求使用长HTTP预算。

工程授权支持私有配置的精确taskIds与显式taskTreeRoots。后者仅用于已获制作人授权的目标及其同负责人子工作包，派发时检查父链、状态、用途和循环；普通组织关系不自动获权。执行记录保存授权根，SDK启动复核配置授权仍有效。workspace=project委派若未绑定则启动模型前拒绝，Unity测试阶段未启用Unity也提前拒绝，避免执行结束后才发现能力缺失。

archive、凭据和历史快照与活动数据分离，归档路径被项目文件入口拒绝。正式研发工程不会自动接入；本机工程以私有runtime/project-config.json和设置的实际状态为准。
