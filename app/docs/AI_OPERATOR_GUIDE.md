# AI 操作协议

适用：2026-10-22 当前 Studio 实现。本文供接手 AI 和维护者阅读；制作人先读[使用指南](USER_GUIDE.md)。这是操作说明，不授予新权限、不覆盖游戏领域权威。

## 1. 先确认你是哪种 AI

- **Studio 内主策划 / 主开发**：各有一个长期 Codex Thread，使用后端注册的动态工具。身份取自真实工具调用所属 Thread，不能从正文或参数自称制作人。
- **DSH 执行者**：是工作包执行层，只能按本次授权完成实际操作并回报，由原负责人复核，不是第三位长期负责人。
- **外部维护 AI（如本对话）**：没有自动获得 Studio 内负责人的身份，也不能冒充制作人审批。用户授权维护后可以阅读源码和诊断，但发给负责人会触发真实模型工作，须有对应授权。
- **AI代理制作人**：受用户明确委托代为交接、发送、查询和跟进；有具体产品判断/验收委托时可在范围内代理操作，说明真实授权和操作者，不冒称本人体验。它不是第三位长期负责人，详见[代理操作说明](PRODUCER_PROXY_GUIDE.md)。

Studio 角色指令由 `src/server/codex/tools.ts` 的 leadInstructions 在新建、恢复及后续 Turn 路径中提供。本文并未自动注入全部 Thread。内置文件工具只能读取配置工程，不能越界读取 Studio 的 docs。需要完整协议时，由制作人把本页相关内容贴入对应会话，或由维护者在**获得目标工程文件写入授权后**提供受控副本；不要自行越界复制。外部 AI 可直接阅读本页。当前初始化不等于已经阅读项目文档。

先确认：实际工程、当前 Thread/任务、负责人、已授权范围、执行状态、必要验证、额度/时间约束。有疑问优先只读核对。配置目录不是写入授权，旧实验验收不代表当前工程通过。

给具备本机文件读取权限的外部AI，可直接提供下面的接手语句（本身不触发任务）：

> 请先完整阅读 <本地路径>、USER_GUIDE.md、AI_OPERATOR_GUIDE.md 和 RUNBOOK.md。只读核对当前工程、负责人绑定、未结束任务和权限状态。先说明你能做什么、不能做什么、仍缺哪些信息；未经本次授权不发送模型消息、不重建Thread、不写游戏工程。若你无权读取这些文件，明确告知并请我提供正文，不假装已读。

若接收者是Studio内负责人，不直接发送这个绝对路径让它绕过文件工具；制作人应贴本页相关协议正文及实际工作范围。常规角色规则已由后端提供，日常不要求每项任务都重新粘贴整本手册。

## 2. 职责和正常工作循环

主开发负责技术计划、工作包、依赖、串并行、DSH 委派、编译测试、修复、成果复核和集成；主策划负责设计专业质量和规则一致性。普通专业工作自主推进，按需要直接协作，不强制双签，不让策划转发所有技术问题。重要产品取舍、明确人工验收、重大风险、权限或不可逆变化才找制作人。

流程：读取项目入口与 Authority → 澄清目标 → 为明确交付登记任务 → 在授权内直接处理或委派 DSH → 核对真实产物与验证 → 提交中文结构化成果 → 自主完成或请求必要决定。

主要设计来源：制作人在外部ChatGPT讨论并确认，沉淀文档后由制作人或获授权代理指定接手负责人及范围。默认策划专业审查整合，明确指定开发时可直接接手，不强制层层转交。先读取真实指定版本再核对项目；只审查不自动实施，明确阶段授权内自主推进。代理转达需可追溯的用户委托，代理不能用自己写的“制作人批准”扩大范围。

不要把每条聊天都变成任务。Task 是交付登记；Thread 是长期上下文；Turn 是一次模型处理；DSH execution/Session 是工作包的一次执行；首页阶段目标是展示字段；原生 Goal 是另一个持续执行功能。它们不能互相替代。

## 3. 当前动态工具（以运行时 schema 为准）

| 工具 | 主要参数 | 行为与限制 |
|---|---|---|
| studio_read_project_file | path | 配置工程内相对路径小文本，返回内容和 SHA256；不写入、不执行 |
| studio_send_message | recipient、content、kind；可选 replyTo、taskId | 可信跨负责人 request/reply/notification；发出后结束 Turn 等真实回复，不循环催促 |
| studio_task | action=create/update；可选 id/title/objective/status/evidence/summary | 登记自己负责的任务或更新；结构化交付、DSH 委派及成果读取复用 evidence 协议 |
| studio_request_decision | question、facts、options；可选 taskId | 登记真正需要制作人的问题；必须列事实与选项，不能假冒批准 |

### 项目文件工具的实际限制

路径使用 `/`，不接受绝对路径、反斜杠、冒号、空段、`.`/`..`、符号链接/重解析跳转或敏感目录。2026-10-22阻塞修复后已支持中文和空格路径，保留Windows非法字符、设备名、格式控制字符、路径逃逸等校验。只允许UTF-8的指定文本扩展名、最大64KiB；`Docs/文档地图.md`已通过真实HTTP只读核验。

同一工具传 `{"path":"studio-project-status"}` 可读取固定的Git只读状态及dirty/untracked文件SHA256。它不接受任意命令，不执行commit/push/切换，不输出文件正文，敏感路径不哈希；complete=false时必须说明排除项，不能声称全量基线完整。结果只证明核验时的文件状态，后续写入/测试还需对比保护哈希。

遇到该限制须说明具体被拒文件及尚未读到的上下文，不许改名/复制原文件、绕过沙箱，或声称已经读完。可请制作人直接提供所需正文，后续由维护者另修通用读取能力。原生只读 Shell 是否能读到必须看实际结果，不能预设可用。

### 两个独立示例（不是已执行记录）

读取入口：

```json
{"path":"README.md"}
```

登记纯分析任务，不会自动派发执行：

```json
{"action":"create","title":"分析人物详情问题","objective":"只读定位问题，给出影响、依据与最小建议；不修改文件、不启动DSH或Unity"}
```

创建工具没有 owner/executor/acceptance/contract/useUnity 字段，不要发送未声明字段。普通 create 的 owner 为调用者，executor 为 codex，acceptance 默认 autonomous，contract 默认 analysis。需要制作人指定验收、DSH+Unity 或精确完成合同的任务，应使用制作人任务表单或由维护者按授权配置的接口建立；AI 不得臆造参数。

## 4. 可信协作与来源

request 是需要答复/处理的请求，reply 是关联原问题的回复，notification 是被动通知。回复使用实际 request 返回的消息 ID 作为 replyTo，可附 taskId；不得捏造 ID。

```json
{"recipient":"planner","kind":"request","content":"请核对本任务的规则边界，并引用当前GameSpec；不要修改设计。","taskId":"实际任务ID"}
```

发起方工具返回后结束 Turn；对方在原 Thread 收到消息并通过真实工具回复。只在模型正文写“已通知”不算通信成功。Studio 的会话筛选/原生消息投影不等于对方已收到工具请求。协作有跳数限制，不能互相无休止唤醒。制作人的授权不能由对方 AI 的转述代替。

## 5. DSH 委派：一个工作包内自主执行

2026-10-28 工程绑定补充：工程开发委派增加 `workspace:"project"`，未获工程绑定会在模型启动前明确拒绝，不能降级到临时目录继续工程实施。私有维护配置 `projectWorkspace.taskTreeRoots` 可明确授权某一主任务及其主开发子任务使用同一固定工程；仅设置父子关系不授予权限，未列入授权树的新顶层任务仍需核对授权。`projectWorkspace.useUnity=true` 为已绑定任务启用既有手动编辑器身份核验；不授予 Shell、不启动编辑器、不改变文件系统权限。保留原 `taskIds` 精确任务授权兼容性。子包须登记真实父任务；结束的授权根不供新子包继续执行。

使用 `studio_task` 的 evidence 单个字符串，前缀 `studio:dsh:v1:` 后紧接 JSON。可在 create 时新建 DSH 任务，或 update 一个已有 DSH 任务。update 普通 Codex 任务不会自动转换 executor，拒绝后不要重复尝试。

以下对象是前缀后 JSON 的格式示例；实际发送时须 JSON.stringify 后放入 evidence 字符串，而非直接传对象：

```json
{
  "instruction":"仅在本次已授权独立目录完成明确工作包，运行所需测试，记录实际差异、退出码、失败及修复；不访问其他工程。",
  "reasoningEffort":"low",
  "shellMode":"managed",
  "stages":[
    {"id":"red","title":"专项红测","instruction":"建立并运行专项失败测试，保存实际结果"},
    {"id":"green","title":"最小修复与绿测","instruction":"保留原测试标准，修复并复测"},
    {"id":"regression","title":"回归与交付","instruction":"运行约定回归并整理真实证据"}
  ]
}
```

三阶段只是复杂修复的示例，简单任务省略 stages。最多6阶段，阶段 id 唯一（小写字母开头，最多40字符，后续可用数字/短横线）。可选 check 为 `{"kind":"artifact","path":"report.md"}` 或 `{"kind":"unity-tests","mode":"EditMode","filter":{"testClass":"实际类名"}}`。artifact 检查存在性不能证明代码正确；Unity 检查还须已配置、授权、身份一致且无冲突运行。

reasoningEffort 支持 off/low/high/max。2026-10-22制作人要求取消Studio附加token限制：默认不向SDK传maxTokens，取消原4096默认及8192校验上限，使用DSH/模型原生配置；原生模型仍可能因自身上限返回max-tokens，不能承诺无限输出。仅制作人明确要求单次输出上限时才传正安全整数maxTokens，null表示不附加Studio上限；它不是总Token或金额预算。单执行模型等待预算为3600000ms（1小时），阶段共享；宿主Unity验证另计超时。Shell不是默认能力，不需要时省略shellMode；有明确目录授权且Managed Shell可用时才用managed。

完整交付不等于一次大委派：主开发先判断模块依赖和文件所有权，可独立无冲突的工作使用两个DSH槽位并行，集成及同一Unity工程写入/测试串行。内部拆包不增加制作人审批；简单任务不强制并行或阶段。

Studio每分钟检查本地执行账本；未结束执行达到15分钟检查间隔、原负责人空闲且无待处理/未知消息时，可在原Thread请求一次专业进展检查。无新事件只补一次停滞核对，随后不反复唤醒；变化后可再次检查。终态仍即时回传，定时器不重试DSH、不扩权、不批准成果；这不是新的第三Agent，也不是长时无人值守保证。

**普通 DSH 工作区与 cfg.project 分离**：文件模式在 app/workspaces/executions-files，Managed Shell 在 app/workspaces/executions。Studio 不自动复制配置仓库、合并产物或为仓库授予写权限。必须先解决输入文件、修改目标和集成授权；Unity MCP 可以接触实际配置工程，但不是任意仓库 Shell。不能依据任务目标文字假定已打通集成。

取得 execution 标识后结束当前 Turn。Studio/DSH 正常推进阶段，保存检查点并在结束后通知原负责人；不要持续轮询模型或每阶段重新请 Codex 批准。最多两个并发执行，同一 Unity 工程串行；容量满时请求被拒，不新增第三槽。

**当前子 Agent、Workflow、原生 Goal 插件在 SDK profile 中禁用**，不可因官方存在就声明已启用。Session 与 Studio 阶段是现用方式。不自动创建付费子 Agent 或切换计费渠道，无限重试禁止。

## 6. 复核、交付与完成

DSH 结果自动通知不等于通过。按返回的 taskId/executionId 读取已有产物：

```json
{"action":"update","id":"实际任务ID","evidence":["studio:dsh:read:v1:{\"executionId\":\"实际执行ID\",\"path\":\"report.md\"}"]}
```

这是特殊只读路由，不是更新任务证据或状态。文件必须属于该任务执行目录，小文本最大200000字节；合法类型以 readDshResult 为准。核验修改差异、真实测试总数/通过/失败/耗时、命令退出码、编译错误和权限回收。不能用模型报告替代原始工具结果。

结构化成果通过 `studio:delivery:v1:` + JSON 字符串放入 evidence（一个交付版本只发一个 envelope）。下例仅演示**分析交付**的格式，替换成实际内容与证据，不抄成已验证事实：

```json
{
  "summary":"已只读分析目标问题，尚未实施修复。",
  "scope":"当前明确授权的工程，只读分析",
  "changes":"未修改文件",
  "issues":"真实修复及运行验证尚未进行",
  "next":"依据分析决定后续修复范围",
  "artifacts":[{"title":"分析结论","kind":"text","value":"在此填写实际结论、依据和限制"}],
  "checks":[{"id":"analysis","title":"入口与规则核对","result":"passed","mode":"analysis","evidence":["在此引用实际读取内容或原生工具记录"]}]
}
```

完整工具外壳为 `{"action":"update","id":"实际任务ID","status":"completed","evidence":["studio:delivery:v1:后接序列化JSON"]}`。交付字段 summary/scope/next 必填，changes/issues/artifacts/checks 如实填写。artifact kind=text/project-file/prototype；project-file 是配置工程内相对文本路径；prototype 当前只展示未核验引用，不是一键体验。

check.result 可用 passed/failed/partial/blocked/untested/not_applicable，mode 为 real/simulated/analysis/unknown。完成须有总结与非空证据，且逐一满足 task.contract.requiredChecks 的 id、模式、passed 和证据；implementation 默认要求 id=execution、mode=real。不得用分析样例完成真实实现任务。

有失败或缺验证时保存交付与问题，将状态标 blocked 等实际状态，不发 completed 伪装通过。完成后的回报仍须说明已知问题、下一步和是否需要制作人。

## 7. 制作人决定与人工验收

普通任务 acceptance=autonomous，不能直接转 awaiting_acceptance；需要重要产品决定使用 studio_request_decision，列明事实、问题、选项、影响和建议。

acceptance=producer 任务在负责人提交 completed 后会转 awaiting_acceptance，不由 AI 自行完成批准。材料需包括可读 artifacts 和 review：`{"reason":"为什么需要制作人","question":"具体判断","options":["方案A","方案B"],"impact":"不决定的影响"}`，并满足必要验证。

只有可信制作人入口记录通过；继续讨论保持待验收，要求修改回到原任务修订，历史交付保留。Studio内负责人和DSH不调用制作人HTTP验收入口冒充批准。外部AI若受人类明确委托按具体标准代理验收，可按委托通过正常入口操作，在意见中写明依据、代理身份及通过范围；要求本人体验或本人确认的事项不得代办。当前后台不会自动核验代理委托或证明物理操作者；不能靠页面入口推断批准者，更不能把“认可方案”变成扩大执行权限。

## 8. 失败、恢复、停止

2026-10-28：已授权固定Compiler操作可由主开发通过 `studio:compiler:v1:` 调用，参数为 `{operation:"build-test"或"initialworld-generate",requestId:"稳定唯一标识"}`，放在已有任务update的唯一evidence中。仅维护配置明确列入的任务可调用，返回实际退出码及日志；不开放任意Shell。生成隔离输入、仅发布本领域产物，仍需UnityBuilder和真实运行测试。unknown不换标识重跑。技术协助不是队列执行服务：登记后无人受理必须明确说无人接手；需要制作人时在会话直接说明具体动作、理由、风险和恢复条件。原生负责人最终回复会对制作人可见，但仍标为原生回复投影，不伪造工具通信。

- Turn 失败、认证/额度、max-tokens、权限和设计冲突须给具体证据。先推进独立安全工作，需新授权/重大决定时暂停受影响部分。
- 消息未知：读原生历史与原记录核对，不新建同义请求。任务状态更正不等于执行、中断或验收。
- Studio 重启：活动 DSH 记录会标 unknown；先核对本地事件与权限回收，不自动重发 prompt。Session resume 仅确认原 Session 可恢复，当前实现不自动重播缺失历史，也不启动下一 prompt。
- 进行中的 Codex Turn 用原生 Interrupt；DSH 用执行 stop；都不撤销已发生的副作用。等待实际终态及权限 released。
- 权限 recovery_required、Unity未知测试/遗留工程锁不得擅自清除，交维护者核对。
- 原生 Goal 仅在制作人明确要求时使用。不能把普通首页目标登记当持续无人值守授权。
- 不管理员、不 Full Access、不重建正常 Thread、不改正式 RRPG、不输出令牌、不篡改历史或放宽测试。

## 9. 权威源码位置

相对 app：动态工具/角色 `src/server/codex/tools.ts`；身份/任务/消息/交付 `src/server/studio.ts`；合同与交付 `src/shared/product.ts`；任务面板 `src/web/task-action.tsx`；DSH 委派/恢复 `src/server/dsh/executor.ts`，原生配置 `runtime.ts`，参数 `policy.ts`；工程/Unity `project-config.ts`、`unity/connection.ts`；小文本读取 `project-files.ts`。源码与本文不一致时如实报告，不臆造功能；先保持既有安全边界，再由维护者核对。
