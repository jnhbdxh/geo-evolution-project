# GEO OS 工程边界、交互与发布合同 V1.0

- **状态：** WORKING BASELINE
- **版本库状态：** IMPLEMENTED_IN_WORKTREE
- **生效日期：** 2026-08-24
- **权威范围：** 模块边界、API、内部认证、持久化、事件、幂等、错误分类、证据传输、测试与发布门禁
- **已实施数据库基线：** FROZEN `0001 + 0002`
- **当前内部路由：** `/v1/internal/execution-runs/:executionRunId/...`

## 1. 架构边界

当前技术方向保持：

- Node.js 24、TypeScript、Fastify、PostgreSQL 17、Redis、MinIO/COS、Playwright、Vitest、Zod 和 pnpm workspace；
- Core API 为模块化单体，负责身份、命令、关系校验、业务事务和正式事实；
- Query Engine 为独立进程，负责真实 AI 产品端面适配、浏览器运行和 UI Truth 捕获；
- AI/Data Worker 后续独立，负责抽取、评估、测量、诊断和报告等异步计算；
- 浏览器自动化不进入 Core API 进程；
- 当前不切换 NestJS、不全面微服务化、不引入 Temporal、不用重 ORM 重写 SQL；
- 同一业务规则不在 TypeScript 和 Python 中重复实现。

## 2. 数据与写能力所有权

| 组件                                | 可以持有                                         | 禁止持有或执行                                  |
| ----------------------------------- | ------------------------------------------------ | ----------------------------------------------- |
| Core API Repository/Command Service | PostgreSQL 业务写凭证、事务、Audit/Outbox 写入   | 绕过关系、权限和状态机的通用写入                |
| Core 查询能力                       | 受 Tenant Context/RLS 保护的只读能力             | 跨 Tenant 枚举或泄露对象存在性                  |
| Query Engine                        | Execution-scoped Token、页面会话、短期执行上下文 | PostgreSQL 凭证、直接业务表写入、Token 签名密钥 |
| AI/Data Worker                      | Scoped command/query token、任务输入             | PostgreSQL 业务写凭证、跨模块直接写表           |
| Redis/BullMQ                        | 缓存、队列、租约、投递元数据                     | 作为唯一业务事实源                              |
| Object Storage                      | 大证据对象字节                                   | 作为唯一业务清单或授权来源                      |

PostgreSQL 当前采用物理零外键。Repository/Command Service 必须在同一事务内完成相关对象存在性、Tenant/Project 一致性、父对象状态、Actor 权限和必要并发锁校验。RLS 只负责租户行隔离，不替代关系完整性。

## 3. API 命名与交互

### 3.1 外部/用户 API

产品 API 使用 `/v1/...`。Tenant Context 由认证身份和明确上下文共同确定。错误响应保持统一结构，不以 404/403 差异暴露跨 Tenant 对象存在性。

### 3.2 内部服务 API

已实现的 Query Engine 边界固定为：

```text
/v1/internal/execution-runs/:executionRunId/assignment
/v1/internal/execution-runs/:executionRunId/start
/v1/internal/execution-runs/:executionRunId/capture-artifacts
/v1/internal/execution-runs/:executionRunId/observation-candidates
/v1/internal/execution-runs/:executionRunId/complete
/v1/internal/execution-runs/:executionRunId/fail
/v1/internal/execution-runs/:executionRunId/cancel
/v1/internal/execution-runs/:executionRunId/finalize
```

未经正式决议不得改写为 `/internal/v1`。完整 OpenAPI 发布可以按产品依赖安排，但请求/响应 Schema、错误和合同测试不得延后。

## 4. Execution-scoped 内部身份

内部 Token 与用户 JWT 使用不同密钥。Token 固定：

- issuer；
- audience；
- service identity；
- `tenant_id`；
- `execution_run_id`；
- token ID、签发时间和过期时间。

Token 默认十分钟，最长十五分钟。Token 不重复携带 `project_id`；Core 根据 ExecutionRun 和 Tenant 关系解析并验证 Project，避免 Token 声明与数据库事实不一致。

Query Engine 只接收和呈现 Token，不持有签名密钥。跨 ExecutionRun 使用 Token 必须拒绝。内部命令记录实际 Service Identity，不冒充排队运行的 Tenant 用户。

## 5. Core-bound 执行顺序

```text
Core assignment
→ Query Engine 校验 canonical QuestionVersion、prompt/hash 和 planned context
→ Web runtime ready
→ Core Start ExecutionRun
→ Adapter 点击发送
→ Capture UI Truth
→ 创建 A1 Candidate
→ ExecutionRun 进入终态
→ Core 回读对象字节并验证 size/SHA-256
→ Finalize RawObservation
```

- Tenant Queue 不接受实际运行上下文字段；
- 页面准备完成但 Core Start 失败时不得点击发送；
- Adapter 记录页面实际披露的模型；未披露时使用 `UNDISCLOSED` 类值，不推测隐藏模型；
- 人工验证、登录失效、页面漂移和服务异常是 operational error，不是 response outcome；
- Adapter 只捕获链接候选，不执行 A2、Citation Qualification 或 KPI 计算。

## 6. 证据传输与对象存储

- Capture 通过 provider-neutral `EvidenceObjectStore`；本地/测试使用 MinIO，生产使用腾讯云 COS；
- 对象私有，路径包含 Tenant/Project/Execution 范围，凭证不暴露给 Query Engine；
- CaptureArtifact 注册保存真实 size、SHA-256、media type 和 storage ref；
- Finalize 前必须重新读取对象字节验证 size 和 SHA-256；
- 同内容确定性对象在请求链失败时不做同步删除；孤儿至少保留 24 小时，再由独立清扫流程重新检查引用后处理；
- 当前内部 JSON/Base64 单对象解码上限为 10 MiB，是受控阶段边界；
- 生产大证据路径在实际需要前定义预签名流式直传，保持相同身份、哈希、幂等和 Finalize 校验语义。

## 7. 事件、调度、幂等与恢复

### 7.1 事实与投递

- 业务事实、Audit 和 Outbox 在一个 PostgreSQL 事务中提交；
- Persistent Outbox Dispatcher 读取未投递事件并写入队列；
- 队列投递至少一次，消费者必须幂等；
- 是否建立名为 `inbox` 的物理表由消费端事务和查询需求决定，当前只冻结去重语义；
- Redis/BullMQ 丢失不能丢失唯一业务事实。

### 7.2 幂等标识

幂等键必须绑定命令语义、Tenant 和目标对象。相同键相同语义返回同一业务结果；相同键不同语义返回冲突。队列重投不创建新的业务 Attempt，真实重试才创建新的 ExecutionRun。

### 7.3 Ambiguous side effect

浏览器在发送后、确认前丢失时，系统不得盲目重发。恢复合同至少需要保存提交前后阶段、页面会话/消息标识和可判定证据，并将无法确定的运行送入显式异常状态或人工复核，而不是伪造成功、失败或回答。

## 8. 错误分类

错误至少按以下维度分类：

| 类别                               | 示例                       | 产品语义               |
| ---------------------------------- | -------------------------- | ---------------------- |
| `AUTHENTICATION`                   | Token 无效、登录失效       | 无 AI 回答             |
| `AUTHORIZATION`                    | 跨 Tenant/Execution 访问   | 隐藏对象存在性并审计   |
| `VALIDATION`                       | prompt/hash/context 不一致 | 发送前拒绝             |
| `HUMAN_VERIFICATION_REQUIRED`      | CAPTCHA/人工校验           | 运行错误，不是回答     |
| `SURFACE_DRIFT`                    | DOM 能力不匹配             | 停止运行并触发能力复核 |
| `PLATFORM_UNAVAILABLE`             | 外部服务异常               | 可按策略重试           |
| `QUESTION_RESPONSE_BINDING_FAILED` | 无法唯一绑定本次问答       | 不创建虚假 Observation |
| `AMBIGUOUS_SIDE_EFFECT`            | 发送后进程丢失、结果未知   | 不自动盲重发           |
| `EVIDENCE_INTEGRITY`               | 对象缺失、size/hash 不一致 | 禁止 Finalize          |
| `INTERNAL_CONSISTENCY`             | 状态、关系或幂等冲突       | 回滚并告警             |

Operational outcome 与 AI-visible response outcome 必须分别记录。

## 9. 发布和验证门禁

规范、实现和验收分别记录。一个能力从 WORKING 升级为 ACTIVE/COMMITTED 前至少满足：

1. 权威合同和适用版本明确；
2. 变更文件归属清楚，没有混入用户交付物或无关修改；
3. 请求/响应 Schema、事件、错误和幂等语义有可执行测试；
4. 相关默认、数据库、对象存储和浏览器合同测试通过；
5. TypeScript、ESLint、Prettier 和 Build 通过；
6. 冻结迁移 SHA-256 未变化；
7. 安全边界测试证明 Query Engine/Worker 无数据库写凭证；
8. 实现状态矩阵记录环境、证据、已知缺口和 repository state；
9. 产品验收结论由产品负责人明确给出，不从测试自动推导。

仓库提供以下可重复命令：

```text
pnpm docs:validate
pnpm docs:validate:sources
pnpm test:db
pnpm test:capture
pnpm audit:prod
```

`docs:validate` 在 CI 中验证 YAML 解析/格式、索引路径、冻结迁移哈希、Decision Registry 固定声明、过期冲突短语和状态一致性。外部冻结 DOCX 不存在于 GitHub Runner；在能够访问正式源文件的受控环境中，使用 `docs:validate:sources` 额外逐字节验证五份决议包 SHA-256。CI 不得把“外部源未挂载”误报为已完成字节验证。

生产发布还需要按实际部署范围完成密钥管理、私有对象存储、日志/指标/告警、备份恢复、安全扫描、SBOM、容量与灰度策略。浏览器端面需具备会话隔离、速率控制、能力版本、漂移 Canary 和停止开关。

## 10. 当前完成边界

Core-bound API、Execution-scoped Token、豆包 Web Adapter、Capture/Candidate/Terminal/Finalize 传输已通过相关测试，并由提交 `f8b2c38` 和 `3a980cd` 形成实现基线。

以下仍未完成：

- Persistent Outbox Dispatcher 和正式队列交付；
- 消费端持久去重方案；
- 版本化生产 A1 Detector；
- 一次真实 PostgreSQL + MinIO/COS-compatible Core-bound 豆包运行；
- ambiguous browser side effect 恢复；
- Tenant 操作人员与获授权项目成员的检查 UI；
- 生产可观测性、部署、备份恢复和容量验收。
