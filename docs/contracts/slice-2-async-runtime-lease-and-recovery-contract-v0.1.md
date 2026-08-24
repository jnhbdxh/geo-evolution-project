# GEO OS Slice 2 异步运行、租约与恢复合同 V0.1

- **状态：** ACTIVE
- **版本库状态：** COMMITTED
- **内容基线提交：** `02ff463138f679d8f7d5ba0735e3ef1a4c3c0af2`
- **激活记录：** `THIS_DOCUMENT_COMMIT`
- **适用阶段：** Slice 2 真实查询与不可变观测闭环
- **父合同：** `GEO_OS_Engineering_Boundaries_Interaction_and_Release_Contract_V1.0.md`
- **权威范围：** Outbox 到队列投递、Worker 运行时、执行与身份租约、消费者幂等、异常恢复、可观测性和部署验收
- **不改变：** FROZEN `0001/0002`、A1/A2/A3/B/C 冻结语义、ExecutionRun 既有业务状态含义
- **生效日期：** 2026-08-24

## 1. 目的与边界

本合同把“持久调度与恢复”拆成可以开发、测试和验收的运行时能力，保证单进程实现未来可以扩展为多 API、多 Dispatcher、多 Query Engine 和多 Worker，而不改变正式业务事实及其所有权。

本合同解决：

- 业务事务成功后任务不会因 Redis、进程或节点故障永久丢失；
- 至少一次投递不会产生重复业务事实；
- 同一 AI 平台身份不会被多个节点无授权并发使用；
- Worker 宕机、超时、重启和发布期间可以恢复或进入明确异常；
- 从用户请求到队列、浏览器、证据和 Observation 可以使用统一标识追踪；
- 当前单机运行方式可以演进为多实例部署，而不提前引入全面微服务化或 Kubernetes。

本合同不负责：

- A1/A2、Citation、指标、归因或报告的业务判断语义；
- 自动向外部渠道代发内容的业务 `Publisher Worker`；
- Kubernetes、Service Mesh、数据库分片、多地域双活等高级基础设施；
- 通过基础设施重投伪造新的 SampleSlot、ExecutionRun 或业务 Attempt。

本合同分成两个互不混淆的验收里程碑：

- **里程碑 A — 垂直链运行闭环：** 完成 Dispatcher 最小权限、严格有界发布、BullMQ 投递、最小持久消费幂等、单实例 Worker 和一次真实 Core-bound 运行；用于证明产品运行链真实成立；
- **里程碑 B — 生产启用门禁：** 完成多实例租约/Fencing、完整恢复、跨进程可观测性、备份和容量验收；B 不阻断 A，但未完成 B 不得启用生产多实例运行。

## 2. 名词消歧

| 名称                          | 本合同含义                                                      | V1 范围  |
| ----------------------------- | --------------------------------------------------------------- | -------- |
| Outbox Publisher / Dispatcher | 将 PostgreSQL Outbox 事实可靠投递至 BullMQ 的基础设施组件       | 必须做   |
| Queue Consumer / Worker       | 领取队列任务并通过受控 Core API 提交结果的运行进程              | 必须做   |
| Publisher Worker 自动代发     | 将策略内容自动发布至第三方内容渠道的业务能力                    | 明确不做 |
| 基础设施重投                  | 同一事件或任务因投递不确定而再次交付，复用原业务事实和幂等结果  | 允许     |
| 真实业务重试                  | 经状态和策略判断后创建新的 ExecutionRun，`attempt_no` 递增      | 受控允许 |
| 执行租约                      | 一个 Worker 在有限时间内处理一个任务的排他运行权                | 必须做   |
| 平台身份租约                  | 一个 Query Engine 在有限时间内使用某个 AI 平台身份/会话的排他权 | 必须做   |

## 3. 可独立部署单元与权限

| 部署单元            | 主要职责                                           | 可以持有                                                  | 禁止持有或执行                                       | 扩容维度               |
| ------------------- | -------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------- | ---------------------- |
| Core API            | 用户/内部 API、权限、状态机、正式业务事实          | PostgreSQL 业务写凭证、对象存储受控服务凭证、租约校验能力 | 浏览器运行、无边界后台轮询                           | HTTP 请求与数据库容量  |
| Outbox Dispatcher   | 跨 Tenant 领取 Outbox、投递 BullMQ、回写投递元数据 | 独立最小权限数据库凭证、独立连接池、BullMQ 发布凭证       | 写入其他业务表、Audit 或消费业务任务                 | Outbox 积压            |
| Query Engine Worker | 使用平台身份执行真实查询并捕获 UI Truth            | Execution-scoped Token、短期身份租约和会话                | PostgreSQL 凭证、Token 签名密钥                      | 平台、身份池、队列长度 |
| AI/Data Worker      | A2、抽取、评估、测量、诊断和报告等异步计算         | Scoped command/query Token、任务输入                      | 直接决定 A1 Candidate、PostgreSQL 业务写、跨模块写表 | 任务类型、CPU/内存     |
| Migration Job       | 以单实例、受控身份执行数据库迁移                   | Migration 凭证                                            | 对外提供长期服务                                     | 不横向扩容             |
| Redis/BullMQ        | 可重建队列、租约镜像和投递元数据                   | 短期运行状态                                              | 作为业务事实、租约或 Fencing Token 的权威源          | 队列和吞吐             |
| MinIO/COS           | 私有证据对象字节                                   | 大对象和受控生命周期                                      | 决定 Tenant 授权或 Observation 是否成立              | 容量和带宽             |

第一阶段允许 Core API 保持模块化单体。只有当独立负载、故障隔离、发布频率或团队所有权得到实际证据支持时，才评审进一步拆分 Core 内部模块。

### 3.1 Dispatcher 数据库权限分阶段决议

- 提交 `ceed736` 的既有实现使用 `geo_os_app + app.outbox_dispatcher_context + RLS Policy`，只形成代码级/上下文级隔离；提交 `824d0e0` 通过前向 `0004`、独立连接配置和独立数据库适配器关闭该缺口，两者的历史状态不得混写；
- 里程碑 A 以及 Outbox 数据库访问迁移集合冻结前，必须建立独立 `geo_os_outbox_dispatcher` 登录角色、独立 `OUTBOX_DATABASE_URL` 和独立连接池；Dispatcher RLS Policy 必须使用 `TO geo_os_outbox_dispatcher` 或等价数据库身份约束，不能只依赖任意会话都可设置的自定义 GUC；
- 独立角色只获得 Outbox 必要 SELECT，以及指定投递状态、重试时间和脱敏失败诊断字段的 UPDATE 权限，不得访问或修改 Tenant、Project、Execution、Observation、Audit 等其他业务事实；
- 迁移后必须关闭共享 `geo_os_app` 的 Dispatcher 交付路径；即使该角色主动设置 `app.outbox_dispatcher_context`，也不得命中 Dispatcher Policy，且必须撤销其对 `status/attempts/available_at/published_at` 的列级更新权；
- 自动化数据库权限测试必须同时证明：独立角色无法越权读取/写入其他业务表或插入、删除 Outbox 事实；共享 `geo_os_app` 无法通过 Dispatcher GUC 跨 Tenant 读取，也无法更新本 Tenant 的 Dispatcher 交付状态。

### 3.2 A1 与异步评估责任

A1 Candidate Detector 保持现有 Core-bound 同步时序和版本化 Provider 边界：

```text
Capture UI Truth
→ 同步调用版本化 A1 Candidate Provider
→ 创建 Candidate
→ ExecutionRun 进入终态
→ Finalize RawObservation
```

AI/Data Worker 负责 A2、抽取、评估、测量、诊断和报告等后续异步任务，不直接替代 A1 Candidate Provider。未来如将 A1 Provider 独立部署，必须另行定义同步调用、超时、失败和不确定结果语义；Provider 故障不得解释为“没有 AI 回答”。

## 4. Outbox 到 BullMQ 的可靠投递

### 4.1 事实顺序

```text
业务命令
→ 同一 PostgreSQL 事务提交业务事实 + Audit + Outbox
→ Dispatcher 领取可用 Outbox
→ BullMQ 至少一次投递
→ Consumer 幂等处理
→ 通过 Core 命令写入正式结果
```

- Redis/BullMQ 丢失不得删除或覆盖 PostgreSQL 中的 Outbox 事实；
- `event_id` 是队列投递去重键，事件 Envelope 必须包含 `event_id`、`event_type`、`schema_version`、`tenant_id`、`aggregate_type`、`aggregate_id`、`trace_id` 和 `occurred_at`；
- 队列任务可以包含路由和重试元数据，但不得产生与 Outbox Envelope 冲突的第二份业务事实；
- 发布成功但数据库未确认属于正常的至少一次不确定窗口，恢复时允许重复发布，Consumer 必须去重；
- 发布失败达到上限后进入可查询的失败状态，不得静默丢弃；Dispatcher 只更新投递元数据，不直接写 Audit 或其他业务表。

### 4.2 领取、锁和网络等待

生产实现不得在不可控的队列网络等待期间无限持有 PostgreSQL 事务、连接或行锁。进入正式队列交付前必须选择并以测试固定一种方式：

1. 在现有行锁事务内使用严格、可配置且有界的发布超时，并用容量测试证明不会耗尽连接；或
2. 使用短事务 Claim/Lease 后提交，再发布并以第二事务回写结果；节点丢失后按租约恢复。

提交 `ceed736` 只证明 PostgreSQL 领取、并发排他、attempts 和退避语义。提交 `824d0e0` 选择方案 1：Publisher 默认五秒超时、独立 Dispatcher 连接池和更长的 PostgreSQL `idle_in_transaction_session_timeout`；重试只向 Repository 传递退避时长，由 PostgreSQL 在失败落库时以 `clock_timestamp() + retry delay` 生成 `available_at`，领取判断同样使用数据库时间。自动化测试证明 Publisher 耗时超过基础退避时，事务仍会退出、锁会释放，且下一 Dispatcher 在新的真实重试期限前只能得到 `idle`。真实 BullMQ Adapter 仍须采用受控 Redis 命令超时，并在正式队列交付前补充连接预算和容量证据。

### 4.3 失败恢复

- Retry 采用有界指数退避并允许加入抖动；
- 最大重试次数和最大退避必须配置化；
- Failed Event 必须支持授权人员查看、诊断、重新投递或终止；这些恢复动作通过 Core 管理命令执行，由 Core 校验权限并在业务事务中记录 Actor/Service Identity、原因、Audit 和必要 Outbox；
- Failed Event 必须通过 `0004+` 前向迁移或等价 Outbox 投递诊断模型持久保存最后失败时间、attempt、脱敏错误类别和稳定错误码；可选诊断文本必须有长度上限，不得保存 Token、Cookie、连接串、原始敏感回答或完整任务 Payload；
- 重新投递沿用原 `event_id`，除非新的业务命令明确产生新事件；
- `0003 + 0004` 迁移集合的冻结只取决于数据库访问合同：旧 GUC Policy 的前向替换、跨 Tenant 领取、并发 `SKIP LOCKED`、允许更新列、角色限定的 Dispatcher Policy、独立角色/GRANT、共享角色反向拒绝和其他越权拒绝；
- BullMQ、Redis 丢失、Consumer 去重和 Failed Event 恢复测试属于能力验收，不作为 `0003` 单独冻结条件。

## 5. Consumer 幂等与 Worker 运行时

### 5.1 幂等要求

- 幂等键至少绑定 Tenant、任务语义、目标对象和规则/能力版本；
- 相同键和相同语义返回原结果；相同键但语义不同必须报冲突；
- Consumer 在确认队列完成前必须取得 Core 已接受结果或可重放的终态；
- 是否使用物理 Inbox 表由具体任务事务边界决定，但每个 Consumer 必须提供持久去重证据；
- 进程内 `Map`、内存缓存或 BullMQ 自身去重不能单独承担业务幂等。

### 5.2 统一 Worker 生命周期

里程碑 A 的单实例 Query Engine Worker 至少实现：

```text
启动
→ 领取任务
→ 校验 Envelope、版本和 Scoped Token
→ 执行并提交阶段/结果
→ 幂等确认
→ 确认队列
```

- A 阶段并发数可以固定为 1，但必须通过持久幂等证明重复投递或进程重启不会创建重复业务事实；
- Worker 不得在无法确认 Core 接受结果时直接确认队列成功；
- 任务取消必须通过 Core 当前状态确认，不能只依赖 Redis 标记；
- Worker 版本、任务 Schema 版本和规则/平台能力版本必须进入执行记录或证据 Manifest。

里程碑 B 再补充多实例 Worker 的心跳、租约、超时接管、Fencing、可配置并发和 Graceful Drain。收到停止信号后停止领取新任务，正在运行的任务在受控窗口内完成、移交或进入恢复。

## 6. 执行租约与 AI 平台身份租约

本节属于里程碑 B 生产启用门禁，不阻断里程碑 A 的单实例真实运行。

### 6.1 租约最小字段

租约实现至少能够表达：

- `lease_id`；
- `resource_type` 与 `resource_id`；
- `execution_run_id`；
- `worker_instance_id`；
- 单调递增的 `fencing_token`；
- `acquired_at`、`heartbeat_at`、`expires_at`；
- `status` 与释放/失效原因。

PostgreSQL 是租约、单调 Fencing Token 和恢复检查点的权威事实源。上述字段通过 `0004+` 前向迁移落地，不修改 FROZEN `0001/0002`。Redis 可以保存租约镜像和调度加速状态，但 Redis 丢失后必须以 PostgreSQL 当前事实恢复，不能重置或回退 Fencing Token。

### 6.2 排他与恢复规则

- 同一 AI 平台身份的并发上限由身份能力配置决定，默认不得由多个 Worker 同时使用；
- Core 或受控调度服务通过 PostgreSQL 事务授予/续期/失效租约；Query Engine 的进程内忙碌标记只能作为本地保护；
- 心跳超时后新 Worker 可以取得更高 `fencing_token`；旧 Worker 恢复后提交必须被拒绝；
- 平台登录状态进入受控私有存储或节点安全挂载，不得作为普通仓库文件、队列消息或日志内容传播；
- 登录失效、账号限制和人工验证应停用或冷却对应身份，不得误记为 AI 空回答；
- 账号池容量、平台速率和身份冷却必须可观测，并作为 Query Engine 扩容依据。

### 6.3 Core 命令校验点

租约启用后，所有 Query Engine 发起的业务写命令至少携带 `execution_run_id`、`lease_id`、`fencing_token` 和 `worker_instance_id`，包括 Start、Capture 注册、Candidate、Complete/Fail、Finalize，以及 Worker 发起的 Cancel。

Core 在每个业务写事务开始阶段锁定 ExecutionRun/Lease，校验 Tenant、Execution、租约状态、到期时间和当前 Fencing Token，再执行状态变更。Capture 在接收大对象前可以预检租约，但注册 CaptureArtifact 时必须在数据库事务内再次校验；过期 Worker 上传但未注册的对象只能作为孤儿候选处理。

## 7. 浏览器不确定副作用恢复

运行时阶段至少区分：

```text
ASSIGNED
→ RUNTIME_READY
→ CORE_STARTED
→ SUBMISSION_PREPARED
→ SUBMISSION_OBSERVED
→ RESPONSE_BOUND
→ EVIDENCE_CAPTURED
→ CORE_FINALIZED
```

上述阶段是恢复元数据，不自动增加或改写 ExecutionRun 的冻结业务状态枚举。进入里程碑 B 时，阶段、页面会话/消息标识、最后心跳和不确定原因必须持久保存在 PostgreSQL 恢复记录中；Redis 或进程内存只能保存副本。

- `SUBMISSION_PREPARED` 前失败可以按策略安全重试；
- 点击发送后但未观察到唯一用户消息时进入 `AMBIGUOUS_SIDE_EFFECT`，不得盲目重发；
- 已观察用户消息但无法唯一绑定回答时记录 `QUESTION_RESPONSE_BINDING_FAILED`；
- 已捕获回答但 Core 提交失败时，恢复必须复用相同 ExecutionRun、证据哈希和幂等键；
- 无法自动判定时进入操作人员检查队列，保留页面/消息标识、时间、会话身份、证据和最后心跳；
- 恢复动作不得把 operational error 改写成 AI-visible response outcome。

## 8. 可观测性合同

里程碑 A 只要求 `trace_id/event_id/job_id/execution_run_id` 能够关联真实运行和失败日志；本节完整指标、告警和跨进程追踪属于里程碑 B。

### 8.1 统一关联字段

日志、事件、队列和错误至少在适用时携带：

- `trace_id`、`event_id`、`job_id`；
- `tenant_id`、`project_id`；
- `execution_run_id`、`sample_slot_id`；
- `worker_instance_id`、`lease_id`、`fencing_token`；
- `platform`、`surface`、`identity_id` 的非敏感标识；
- `adapter_version`、`capability_version`、`rule_release_id`；
- `attempts`、`duration_ms`、错误类别和最终处置。

Token、Cookie、浏览器 Storage State、对象存储密钥、原始敏感回答和客户机密不得进入普通日志。

### 8.2 最低指标与告警

| 指标/告警                            | 最低目的                       |
| ------------------------------------ | ------------------------------ |
| Outbox pending/failed 和最老等待时间 | 判断事实是否未投递             |
| 各队列 waiting/active/failed         | 判断任务积压和消费能力         |
| Worker 在线数、心跳年龄和任务耗时    | 判断节点故障、卡死和容量       |
| 租约过期、冲突和过期提交拒绝数       | 判断重复执行和身份调度风险     |
| 平台登录失效、人工验证、漂移错误率   | 判断身份与页面能力是否需要停止 |
| Capture/Finalize 失败和哈希不一致    | 判断证据完整性风险             |
| Ambiguous side effect 数量           | 判断需要人工检查的运行         |

阈值在真实客户链路和容量测试后确定，不在缺少数据时写死为生产承诺。

## 9. 健康检查、配置与部署

本节完整要求属于里程碑 B。里程碑 A 只需单实例 Worker 具备可重复启动、受控停止和明确失败输出。

每个长期运行进程必须提供或暴露等价能力：

- Liveness：进程事件循环和核心执行线程仍可响应；
- Readiness：必要配置已加载，依赖可用，且当前允许接收新任务；
- Dependency Health：PostgreSQL、Redis/BullMQ、对象存储和 Core 内部接口分别报告；
- Graceful Drain：停止接单、等待受控任务窗口、释放或失效租约后退出。

部署要求：

- Core API、Dispatcher、Query Engine 和 AI/Data Worker 分别提供可复现镜像与启动入口；
- 开发、测试和生产配置分离，密钥只从受控环境或 Secret Manager 注入；
- JWT、内部 Token 和平台身份密钥支持轮换，旧新密钥并存窗口必须受控；
- 数据库连接池大小、连接/语句超时和每进程并发可配置；
- 所有实例的数据库连接总预算不得超过数据库安全上限；达到多实例阈值时评审 PgBouncer；
- 第一阶段允许 Docker/云容器多实例部署，不把 Kubernetes 作为 Slice 2 验收前置条件。

## 10. 证据传输、备份与容量边界

- 当前 JSON/Base64 单对象 10 MiB 边界保留为阶段性实现；
- 当真实证据达到该边界、API 内存/带宽成为瓶颈或进入多 Query Engine 生产部署前，启用预签名流式直传；
- 直传仍需 Execution-scoped 授权、对象路径范围、声明哈希、Finalize 回读校验和幂等注册；
- 生产启用前定义 PostgreSQL 和对象存储备份频率、保留周期、RPO、RTO 与恢复演练；
- Redis/BullMQ 不进入唯一事实备份范围，但必须证明能从 PostgreSQL 事实恢复未完成投递；
- 容量测试至少覆盖 API 并发、数据库连接、Outbox 积压、队列吞吐、浏览器内存、证据带宽和对象存储失败。

预签名直传按真实证据大小触发；备份 RPO/RTO、恢复演练和完整容量验收属于里程碑 B，不阻断里程碑 A 使用当前受控证据边界完成真实运行。

## 11. Slice 2 技术验收矩阵

| 里程碑 | 场景                                 | 必须证明的结果                                                                                         |
| ------ | ------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| A      | 业务事务回滚                         | 不产生孤立 Audit 或 Outbox                                                                             |
| A      | Redis 在发布前不可用                 | Outbox 保持可恢复，按策略重试                                                                          |
| A      | 发布成功但状态回写前 Dispatcher 宕机 | 允许重复发布，Consumer 不产生重复业务事实                                                              |
| A      | 同一任务重复交付或单实例 Worker 重启 | 返回同一幂等结果，不新增 ExecutionRun                                                                  |
| A      | 点击发送前退出                       | 可以安全重试                                                                                           |
| A      | 点击发送后结果未知                   | 至少停止盲目重发并进入明确异常/人工检查                                                                |
| A      | 一次真实 Core-bound 豆包运行         | PostgreSQL、BullMQ、Query Engine、对象存储和 Core Finalize 全链可追踪                                  |
| B      | 两个 Dispatcher 并发                 | 不同时占有同一领取权，不静默丢失事件                                                                   |
| B      | Worker 执行中退出并被接管            | 租约到期后可恢复；旧 Fencing Token 提交被拒绝                                                          |
| B      | 两个 Query Engine 竞争同一平台身份   | 只有符合并发上限的 PostgreSQL 权威租约成功                                                             |
| B      | 回答已捕获但 Core 暂不可用           | 复用相同证据、检查点和幂等键恢复                                                                       |
| B      | Token、租约或 Tenant 不匹配          | 拒绝、隐藏跨 Tenant 对象存在性并审计                                                                   |
| B      | Redis 数据全部丢失                   | 从 PostgreSQL Outbox、租约/Fencing 和正式业务状态恢复                                                  |
| B      | 收到 SIGTERM                         | 停止领取新任务，在退出窗口内完成、移交或记录恢复状态                                                   |
| A      | Dispatcher 使用独立数据库登录角色    | 只能访问必要 Outbox 投递元数据；其他业务表读写被拒绝，`geo_os_app` 设置 Dispatcher GUC 仍无法跨 Tenant |
| A      | Publisher 永不返回                   | 在配置上限内退出事务并释放锁和连接；同一事件可被后续 Dispatcher 重领                                   |

## 12. 实施顺序与退出条件

### 12.1 里程碑 A — 垂直链运行闭环

```text
独立 Dispatcher 数据库角色、连接池与有界发布
→ BullMQ Publisher 与常驻 Dispatcher
→ 最小 Consumer 持久去重
→ 单实例 Query Engine Worker
→ 一次真实 Core-bound 豆包端到端运行
```

达到以下条件记录 `VERTICAL_CHAIN_READY`，随后按产品权威顺序继续生产 A1、查询 API 和操作界面；不要求先完成里程碑 B：

1. 独立 Dispatcher 角色、角色限定 Policy、共享角色反向拒绝、专用连接池和有界发布测试通过；
2. Outbox 事件能够投递 BullMQ，Redis 短暂失败不丢 PostgreSQL 事实；
3. 单实例 Consumer 的持久幂等、重复投递和重启测试通过；
4. Query Engine 无 PostgreSQL 凭证，并通过 Core-bound 命令提交全部结果；
5. 一次真实豆包运行形成可验证证据、Candidate、终态 ExecutionRun 和 RawObservation；
6. 点击发送后的不确定状态至少停止盲目重发并可由操作人员识别；
7. 基础 Trace 标识可关联 Outbox、Job、Execution、证据和 Observation。

### 12.2 里程碑 B — 生产启用门禁

```text
PostgreSQL 权威执行/身份租约与 Fencing
→ 持久浏览器恢复检查点和完整 ambiguous recovery
→ 多实例 Worker、健康检查和 Graceful Drain
→ 跨进程 Trace、指标和告警
→ 备份恢复、故障注入和容量验收
```

达到以下条件记录 `PRODUCTION_ENABLEMENT_READY`，也是本合同整体能力可标记 `COMPLETE` 的前提：

1. Dispatcher 独立角色、角色限定 Policy、共享角色反向拒绝、租约/Fencing、恢复检查点及必要 `0004+` 迁移已提交并验证；
2. Query Engine/AI/Data Worker 仍无 PostgreSQL 业务写凭证；
3. 里程碑 B 场景具有自动化或受控实测证据；
4. PostgreSQL 与对象存储的备份、RPO/RTO、恢复演练通过评审；
5. 生产密钥、告警、容量、灰度和停止开关通过评审；
6. 产品验收仍由产品负责人单独给出，不由技术测试自动推导。

### 12.3 `0003` 独立冻结门禁

`0003 + 0004` 或承载同一 Outbox 访问合同的迁移集合，只按数据库权限、RLS、安全和并发领取合同冻结。里程碑 A/B 的队列、Worker 和恢复验收不自动决定迁移冻结；迁移冻结也不自动证明运行时能力完成。

## 13. 明确延期及触发条件

以下能力记录为 `DEFERRED`，不进入当前 Slice 2 开发范围：

- Kubernetes：当普通多实例部署无法满足高可用、滚动发布或节点调度要求时评审；
- Service Mesh：当服务数量和零信任通信复杂度产生实际证据时评审；
- PostgreSQL 分库分表：当连接、容量或单库性能达到已测安全阈值时评审；
- 读写分离/分析库：当读负载影响事务写入或报告查询达到容量瓶颈时评审；
- 多地域双活：当正式 RTO/RPO 和业务连续性要求无法由单地域备份恢复满足时评审；
- 自动无限扩缩容：在获得真实队列、浏览器和平台限速数据后再定义策略。

延期项不得反向阻塞当前模块化单体、独立 Query Engine/Worker 和可恢复异步运行底座的完成。
