# 维护运行手册

2026-10-22，面向启动和维护Studio的人或AI。日常操作见[制作人指南](USER_GUIDE.md)，工具协议见[AI操作协议](AI_OPERATOR_GUIDE.md)，总入口见[帮助目录](INDEX.md)。本手册不授予目标工程写入或系统权限。

## 1. 启动、打开、关闭

日常双击根目录 `打开工作台.cmd`。它直接检查本机后台，使用专用 `runtime/studio-browser` 浏览器配置打开工作台并禁用该窗口的代理；不改系统代理、个人浏览器配置或模型网络。已有服务不会重复启动。该配置含本机网页会话，按 runtime 私有数据处理；原个人浏览器中的草稿和已读标记不会迁移，服务器历史不受影响。未安装 Edge/Chrome 时保留后台并显示手动地址。若 VPN 的 TUN/系统策略仍拦截回环，应在代理软件中允许本机回环，而不是重启或重复派发任务。

前置为已安装的Node.js 24、已核验Codex CLI/DSH及独立账户。查看本机版本可用 node --version，不为阅读文档自动升级依赖或工具。

在PowerShell执行：

```powershell
cd <本地路径>
.\Start-Studio.ps1
```

浏览器打开 http://127.0.0.1:3178/ 。首次部署/依赖变化用 npm ci，源码变化后用 npm run build；日常无需重复安装。

正常关闭：

```powershell
.\Stop-Studio.ps1
```

关闭返回stopping是异步退出。重启须等旧PID退出、3178不再监听再启动；“may already be running”不能当新配置已生效，不强杀进程。网页关闭不停止后台，关后台也不回滚工具副作用；进行中的任务可能变为待核对，不盲目重发。

## 2. 本地数据位置

AI规则集中在Studio根rules/，说明见[rules入口](../../rules/README.md)。网页“设置 → AI规则与技能”读取真实角色源文件并允许编辑planner/developer补充要求；旧补充备份位于runtime/rule-backups。保存不调用模型；下一次正常Turn携带新要求，界面记录加载指纹并区分待发送。基础规则由维护端修改，不能把本目录当系统权限配置。DSH规则在新任务配置中读取，旧Session不重写。部署时须携带rules目录，缺失或无效文件应报错，不能静默使用另一份隐藏规则。

下列路径相对app，默认不提交Git：

| 位置 | 内容与注意 |
|---|---|
| runtime/studio.sqlite | 任务/消息/事件/交付/验收/绑定账本，运行时不要直接改表 |
| runtime/codex-home | 独立Codex认证、原生Thread/历史/队列，不复制桌面App凭据 |
| runtime/project-config.json | 当前工程/手动Unity连接，维护者管理，网页不能修改 |
| runtime/dsh-config.json | 已核验SDK安装/计费/授权，不伪造授权标记 |
| runtime/dsh-sessions | 原生Session配置、事件及检查点，不因失败删除 |
| workspaces/executions、workspaces/executions-files | Shell/文件模式独立执行目录，不自动同步项目 |
| runtime/credentials | 令牌等私有凭据，不贴聊天或提交 |
| runtime/inbox | 可选外部设计交接JSON，不是普通聊天必需 |
| runtime/backups | SQLite一致性备份，不含完整原生会话与认证 |
| runtime/server.log、server-error.log | 后台日志，提供第三方前脱敏 |

项目根archive是私有历史归档，不参与运行/导入/检索，不作为活动工程；不要整包上传。浏览器保存草稿/入口/任务选择和未知提交标识，不用清浏览器存储来处理投递异常。

## 3. 配置工作工程（先于首次初始化）

确认用户指定目录存在、身份正确，读取根AGENTS/README。编辑runtime/project-config.json，参考[配置模板](project-config.example.json)：

```json
{
  "projectRoot":"D:/你的独立研发工程",
  "unity":{
    "enabled":false,
    "allowExecution":false,
    "endpoint":null,
    "tokenFile":null,
    "expectedVersion":null
  }
}
```

root可以是仓库根目录，须换成真实已有绝对路径；JSON用正斜杠或转义反斜杠。先备份配置和数据库，正常停服/重启，再看设置中的工作目录。archive不允许。选择路径不授予写权限。

STUDIO_PROJECT环境变量会覆盖Codex工作目录，而Unity/项目显示仍读JSON；日常不要设它，启动前确认没有意外覆盖。已有任务时不切换工程，不假定原Thread的cwd会自动跟着JSON改变。本版本没有完整项目切换向导，需维护者核对原生Thread、活动执行和授权。

本机2026-10-22初始化快照：projectRoot=<本地路径>；两位负责人idle，任务/消息/执行0，Unity关闭。见私有runtime/initialization-receipt.json。快照不是永久当前状态，也不证明副本已具备代码修改/测试闭环。正式<本地路径>未接入。

## 4. 认证与初始化

设置确认“后台已连接、认证可用”。展开“专业诊断与恢复→执行连接→初始化两位负责人”：只为缺失绑定创建两个长期Thread，read-only/never，提供中文角色规则与可信协作工具；不发送模型Turn、不自动阅读项目或派工。已有正常绑定不重建。

认证不可用时按设置显示的独立CODEX_HOME在本机终端登录；不复制桌面账户凭据、不在聊天提供令牌。然后“连接/刷新认证”核对；恢复可能派发旧队列，先看待发消息，不当作绝对只读刷新。

creation_unknown、未知投递或绑定冲突时保存错误并核对原生历史，不反复初始化、不删会话目录。空Thread受控修复不是日常入口。

## 5. 手动Unity/团结连接

这是可选接入，不是聊天前置。用户手动打开匹配版本的正确工程及现有MCP服务；Studio不启动/关闭编辑器，不安装/升级插件。

2026-10-22阻塞修复后支持双路径：projectRoot保持仓库根和负责人cwd，unity.projectPath可填写相对于仓库的Unity子工程（如UnityProject/RRPG1.0game）。子工程须实际存在且真实路径位于仓库内，不能指向其他项目；省略时保留旧的root即Unity根行为。不再通过切换负责人的工作目录解决子工程身份问题。路径配置不授予MCP或文件写入权限。

在获得配置授权并确认root后，配置形如：

```json
{
  "projectRoot":"D:/已授权工程",
  "unity":{
    "enabled":true,
    "projectPath":"UnityProject/RRPG1.0game",
    "allowExecution":false,
    "endpoint":"http://127.0.0.1:实际端口/实际MCP路径",
    "tokenFile":"credentials/unity.json",
    "expectedVersion":"2022.3.62t9"
  }
}
```

endpoint是不可直接运行的占位示例，取现有服务的实际完整回环HTTP地址，不猜端口；版本须匹配工程，不要求所有工程用示例版本。tokenFile相对runtime，文件内容为 {"token":"实际令牌"}；须位于runtime/credentials，令牌至少16字符且匹配服务，不打印或发聊天。仅允许127.0.0.1/localhost/::1，不扩大监听范围。

重启后点“设置→核对Unity连接”。Studio读取工具并执行固定只读身份检查，核对实际工程、引擎版本和编译状态。错误就停止；许可证/登录弹窗由用户处理，不循环重启。

身份核对成功不授权写入。获明确工程执行范围后维护者才可设allowExecution=true；任务还需developer、dsh、useUnity=true。同一工程有执行/运行测试或遗留锁时不抢占；未知测试先核对，不能手工删锁。

普通MCP请求15秒，只有tests-run请求660秒；插件发现600秒与官方服务自身超时是另外两层。见[Unity兼容说明](UNITY_COMPATIBILITY.md)。补丁不自动应用到新工程，旧实验成功不证明当前工程可用。

## 6. DSH与恢复

设置“DSH开发执行层→SDK状态与运行限制”查看allowed、模型/渠道、active、maxConcurrent、permissionRecoveryPending。安装指纹失败会停用DSH，保留Codex；不擅自重装、改计费渠道或伪造授权字段。

全局Shell关闭；Managed Shell只对本任务独立目录准备/回收官方Windows沙箱权限，不是完整宿主读取/网络隔离，也不授予游戏仓库写入权。文件和Shell模式均不自动复制/合并项目。最多两个并发，满额拒绝；输出/时间边界不是金额硬上限。正常阶段自动推进，结束通知原Codex负责人复核。

2026-10-22起生产默认省略SDK maxTokens，移除Studio原4096默认/8192参数上限；只有明确要求才设置正整数单次输出限制，null为不附加。模型与渠道自身上限仍有效，max-tokens仍记真实失败；原历史执行的4096参数保留，不改写证据。单执行模型等待预算为1小时（3600000ms），各阶段共享；宿主Unity验证另计超时，不保证总墙钟时间为1小时。

后台每分钟本地检查，最多每15分钟向空闲原负责人发送进展检查；有待处理/未知消息时不插入，停止/重启会清除或重建单个定时器。检查记录与去重键持久化，稳定无进展只额外核对一次，避免无意义付费轮询。终态结果仍即时回传，不由定时器自动重试。未部署前这些源码变化不影响旧进程；实际部署状态见DSH_TOKEN_REVIEW。

停止本次执行后核对permissionState=released。recovery_required会阻止新Shell；检查原清单/日志/权限，新的权限范围先问用户，不用Full Access绕过。

后台重启活动记录变unknown，先用“核对已保存执行证据”。维护API的原Session resume仅确认恢复，不发送prompt、不保证补齐历史或继续阶段。缺终态交主开发整理方案，不新建同义请求。

## 7. 设计主流程的现有交接适配（维护入口）

外部ChatGPT讨论并沉淀确认文档、再交负责人接手，是已确认的主要设计流程；制作人或其代理按[使用指南](USER_GUIDE.md)和[代理说明](PRODUCER_PROXY_GUIDE.md)操作。以下JSON适配只是现有技术实现，不要求制作人日常手写JSON，也不代表自然文档一键交接已完成。普通跨负责人协作用真实聊天工具。

确有已确认外部设计时，维护者可放UTF-8 JSON到runtime/inbox，小于200000字节。字段：id（字母数字/短横线/下划线，最多80字符）、title、content、producerConfirmed=true、provenance；每项须真实，不能用true字段假装已批准。

“扫描交接目录”只登记，核对imported/errors；相同id/内容去重，相同id改内容拒绝，新版用新id并说明关联。“通知主策划一次”会真实创建审查任务并发消息，可能消耗模型，不是预览；候选不会自动成为GameSpec。

“记录审查并交给主开发”是手工附加记录并发消息，不能冒充真实主策划审查。专业审查应由策划完成并直接工具通信。适配器仍有旧purpose=lab内部标记，属兼容遗留，不作为日常强制流程。

## 8. 备份、恢复、源码检查

设置“备份数据库”或app中npm run backup生成runtime/backups一致性SQLite。仅业务数据库，不含原生Codex/DSH会话、配置、执行文件或认证。完整备份需正常停服后私有保存runtime与必要工作目录、排除缓存并核验，认证单独保护不入Git。

npm run restore -- <app目录内的SQLite备份绝对路径>仅在原runtime内新建restored-时间戳/studio.sqlite及说明，不覆盖当前库、不自动切换。真正切换前维护者停服、检查integrity/schema、补齐工程/DSH配置及原生会话关联，保留原CODEX_HOME，核对数据epoch/队列/权限锁再启动。只换数据库不等于完整恢复，不自动导入归档。

源码检查：npm run typecheck、npm run build、npm test、npm run test:e2e。浏览器回归3199隔离库与协议夹具，不调用真实模型或编辑器，不等于真实工程验收。敏感数据和工作区排除Git，见[源码管理](SOURCE_CONTROL.md)；提交推送按用户授权。

## 9. 需用户处理的情况

账号登录/许可证、管理员或主机策略、扩大权限/计费渠道、无法确认工程身份、不可逆数据变化、正式项目接入。报告具体失败层/目录/错误码、最小方案、风险与恢复方法；普通技术问题由主开发处理。界面与本文不符时据实际记录核对，不猜功能已通过。

### DSH结果通知遇到额度不足（2026-10-27）
后台每分钟检查已失败的DSH结果通知；明确usageLimitExceeded后冷却至少一小时，仅向空闲原负责人补一次结果核查，持久去重。有未知消息/执行、活动执行或后续成功指令时不补。不会重跑DSH；再次失败需维护核对，不循环付费重试。后台未运行时此机制不工作。
