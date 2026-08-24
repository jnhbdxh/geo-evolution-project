# GEO OS 核心领域、生命周期与权限合同 V1.0

- **状态：** ACTIVE WORKING BASELINE
- **版本库状态：** COMMITTED
- **内容基线提交：** `30e146cb2cbb64c04f08eae1653e2484c7b9bf8f`
- **激活提交：** `e7c0f510a8c642b57528e511167a5fb4171fad4c`
- **生效日期：** 2026-08-24
- **权威范围：** 对象身份、所有权、关系、生命周期、不可变性、Release、权限分层和模块数据所有权
- **下级合同：** Slice 1 Domain Contract V0.1、Slice 2 Observation Domain Contract V0.1 及其 Addendum
- **不覆盖：** A1/A2/A3/B/C 冻结规则语义和 `0001/0002` 物理 DDL

## 1. 领域建模原则

每个对象必须分别声明访问归属和记录语义，两个维度不得混用。

### 1.1 Access Scope

| 类型                                  | 含义                        | Tenant 约束                                                                  |
| ------------------------------------- | --------------------------- | ---------------------------------------------------------------------------- |
| `PLATFORM_PRIVATE`                    | 平台内部定义或身份          | 不向 Tenant 暴露目录、关系或跨租户统计                                       |
| `TENANT_ROOT`                         | Tenant 访问边界根           | Tenant 表不携带指向自身的 `tenant_id`                                        |
| `TENANT_OWNED`                        | Tenant 创建或在其上下文产生 | 直接携带不可变 `tenant_id`；Project 事实同时携带 `project_id`                |
| `GLOBAL_IDENTITY_WITH_TENANT_CONTEXT` | 可全局规范化的身份          | Tenant 只能通过自己的 Binding/Evidence/Projection 使用，不能枚举其他租户关系 |

### 1.2 Record Semantics

| 类型                | 含义                         | 生命周期                                                         |
| ------------------- | ---------------------------- | ---------------------------------------------------------------- |
| `MUTABLE_ENTITY`    | 稳定身份或工作容器           | 受控更新、停用不删除、ID 不重用                                  |
| `PROJECT_FACT`      | 项目上下文中的事实或决策记录 | append-only 或受限状态机；Tenant/Project 不可迁移                |
| `RELEASED_ARTIFACT` | 已发布、可引用、可复现版本   | 发布后不原地修改；通过新 Release、Correction 或 Replacement 演进 |

## 2. 所有权与运营编排

固定所有权链：

```text
Tenant → Customer → Brand → Project
```

- Project 只保存 `brand_id`，Customer 通过 Brand 推导；
- 项目事实直接保存 `tenant_id` 和 `project_id`，不能以当前父对象配置代替历史归属；
- 对象不能跨 Tenant 或 Project 转移；需要迁移业务时创建新对象并保留显式关联；
- `OptimizationCycle` 只负责编排目标、任务、复测和交付，不拥有事实对象；
- Cycle 状态变化不得改写 Execution、Observation、Resolution、Snapshot 或 Report 的归属和历史。

## 3. 核心对象目录

### 3.1 已进入冻结 DDL 的对象

```text
Identity / Workspace
  UserIdentity, PlatformRoleAssignment, Tenant, Membership,
  TenantRoleAssignment, Customer, Brand, Project

Rules and bindings
  PolicyDefinition, PolicyRelease,
  IndustryPolicyDefinition, IndustryPolicyRelease,
  ProjectPolicyBinding, ProjectIndustryBinding

Planning and observation
  DemandTheme, Question, QuestionVersion,
  MonitoringPlan, MonitoringPlanVersion, MonitoringPlanVersionQuestion,
  SampleBatch, SampleSlot, ExecutionRun,
  CaptureArtifact, ObservationCandidate, RawObservation, CorrectionRecord

System facts
  AuditEvent, OutboxEvent
```

这些对象的物理身份只由冻结的 `0001/0002` 和 Freeze Record 定义。本合同不修改其 DDL。

### 3.2 跨模块概念已确认、尚未自动落库的对象

```text
Assessment, AssessmentEvidence, Review, Resolution, ResolutionReplacement
CitationOccurrence, CitationQualification, LogicalCitation
SourceDomain, SourceDocument, SourceBinding
MetricDefinition, MetricRelease, MetricContribution
MeasurementSnapshot, ObservationMembership, MetricMembership, SnapshotReplacement
Report, ReportRelease
DiagnosisRun, GapSymptom, Hypothesis
StrategyAction, StrategyActionRelease
Intervention, InterventionRelease, InterventionExecution
RetestPlan, RetestComparison, EffectEvidence
OptimizationCycle
```

概念进入目录不等于需要立即创建表。只有进入对应 Slice，且需要系统内查询、管理、审计或运行时引用时，才通过 `0003+` 前向迁移落库。

### 3.3 候选 Release 概念

- `ProjectConfigurationRelease`：只引用会影响执行或结果解释的项目配置及其他 Release，不承载人员职责；
- `PlatformCapabilityRelease`：在平台端面能力进入生产调度管理前确定；
- `ComparabilityPolicyRelease`：在 Measurement/Effect Slice 前确定；
- `ReportTemplateRelease`：在 Report Slice 前确定；
- `AcceptanceBaseline`、`AcceptanceRun`、`ValidationIssue`：当前优先作为版本库验收资产，不自动建表。

`ProjectConfigurationRelease` 可以引用地区、语言、默认执行面、Policy/Industry Release、MonitoringPlanVersion 及其有序 QuestionVersion Membership、报告和复测配置，但不得嵌入项目负责人、优化师、Reviewer、联系方式或临时任务分工。当前不引入独立 `QuestionSet/QuestionSetVersion` 对象；未来若出现独立于 MonitoringPlan 的复用需求，再单独决议。

## 4. 关键生命周期

### 4.1 发布物

通用发布物状态：

```text
DRAFT → PUBLISHED → DEPRECATED
```

`PUBLISHED` 后业务字段不可变。弃用只影响未来选择，不能使历史引用失效。

### 4.2 ExecutionRun

```text
QUEUED → RUNNING → COMPLETED | FAILED | CANCELLED
QUEUED → FAILED | CANCELLED
```

- Tenant Queue 不得声明实际平台、模型、端面或运行上下文；
- 实际运行上下文由受认证 Query Engine 在 Start 时一次性写入；
- 可见响应结果要求 `started_at`；启动前失败可以没有响应结果；
- 终态失败可以与此前已出现的可见响应事实共存；
- 每次真实重试创建新的 ExecutionRun，引用可重试的前序运行并递增 `attempt_no`；
- 重试不增加 SampleSlot，也不存在独立 `execution_attempt` 业务对象。

### 4.3 Observation

```text
first visible response signal
→ ObservationCandidate(CAPTURING)
→ ExecutionRun terminal
→ byte verification
→ Finalize RawObservation
```

Candidate 保存首次检测事实，RawObservation 保存完整捕获后的最终响应窗口和最终形态。Finalize 只允许 ExecutionRun 已为 `COMPLETED/FAILED/CANCELLED` 且存在 `completed_at`，并要求 `response_last_seen_at <= completed_at`。

### 4.4 Assessment、Review、Resolution

- Assessment 是带领域 Payload、规则/Prompt 版本和证据的判断记录；
- Review 是人工或系统复核事实，保存实际 Actor/Service Identity 和依据；
- Resolution 是指定 Subject、Context 和优先级下的正式决议；
- 多个判断不能使用不限定范围的“最新结果优先”；
- 错误或新证据通过显式 ResolutionReplacement 或新 Resolution 处理。

### 4.5 Snapshot 与 Report

- MeasurementSnapshot 是已发布的固定测量事实；
- Snapshot 生命周期与完整性状态是独立状态轴；
- Snapshot 固定实际 Observation、Resolution、MetricContribution、规则和可比性版本；
- ReportRelease 固定引用指定 Snapshot，不在展示层重新计算正式指标；
- 错误通过 SnapshotReplacement 或新 ReportRelease 处理。

## 5. 多状态轴原则

业务对象不得用一个大枚举混合下列含义：

- lifecycle：草稿、运行、终态、发布、弃用；
- validity：有效、无效、未知；
- eligibility：有资格、无资格、未知；
- completeness：完整、部分、不完整；
- review：未复核、复核中、已决议；
- comparability：可比、部分可比、不可比、未知；
- publication：未发布、已发布、已替代。

每个状态轴只回答自己的业务问题；UNKNOWN 不得折叠为 false 或 0。

## 6. 权限与身份分层

### 6.1 平台固定角色

- `PLATFORM_ADMIN`：平台受控开通、暂停和治理 Tenant；
- 平台角色与 Tenant 权限完全分离。

### 6.2 Tenant 固定角色

- `TENANT_ADMIN`：管理本 Tenant 成员及业务对象；
- `TENANT_MEMBER`：进入 Tenant 上下文，具体项目能力由项目授权限定。

### 6.3 Project Membership / Assignment

项目负责人、GEO 优化师、Reviewer、内容操作人员等属于项目级授权或任务分配，不在当前阶段全部硬编码为 Tenant 全局角色。项目配置 Release 不保存人员职责。

### 6.4 产品人物画像

人物画像用于页面、工作流和需求表达，不自动等于权限枚举。

### 6.5 系统服务身份

Query Engine、AI/Data Worker、Dispatcher 等使用服务身份。`SYSTEM_WORKER` 不是用户角色。历史命令保存实际 Actor UserIdentity 或 Service Identity，不允许服务冒充发起执行的 Tenant 用户。

## 7. 数据所有权与写入口

- PostgreSQL 是业务事实来源；Redis、BullMQ、缓存和对象存储清单不能成为唯一业务事实；
- 每个模块拥有自己的 Repository/Command Service 写入口；跨模块不得直接写表；
- Query Engine 和 Worker 不持有 PostgreSQL 写凭证；
- 零外键不等于无关系校验；Repository 在事务中验证存在性、Tenant/Project 一致性、父对象状态、授权和并发锁；
- RLS 提供行隔离，但不替代关系完整性；
- 已发布事实、决议和发布物不开放通用 UPDATE/DELETE。

## 8. 版本与历史引用

Project 当前 Binding 只影响未来执行。Execution、Assessment、Resolution、MetricContribution、Snapshot、Diagnosis、Strategy 和 Report 必须保存实际使用的 Release/Version ID。

禁止：

- 用当前项目配置解释历史执行；
- 用规则新版本覆盖旧 Snapshot；
- 用最大时间戳替代显式 Replacement；
- 删除被历史事实引用的对象；
- 跨 Tenant 暴露全局身份的关系、证据或使用情况。
