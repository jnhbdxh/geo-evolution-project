# GEO OS Product Object Map V0.1

- **Status:** SUPERSEDED
- **Superseded by:** `../contracts/GEO_OS_Core_Domain_Lifecycle_and_Authorization_Contract_V1.0.md`
- **Aligned baseline:** GEO_OS_Commercial_MVP_Product_Baseline_V1.0
- **Purpose:** 在逐模块实现前，统一端到端产品对象、归属、不变性、版本和下游关系。

> 历史说明：本文件保留对象设计演进记录。当前对象身份、生命周期、权限和 Release 语义以替代合同为准。

## 1. 对象分层

```text
Workspace Context
├─ UserIdentity / PlatformRoleAssignment
├─ Tenant / Membership / TenantRoleAssignment
├─ Customer / Brand / Project
├─ Policy Binding / Industry Pack Binding
│
Planning Context
├─ Demand Theme / Question / QuestionVersion
├─ Monitoring Plan / Sample Batch / SampleSlot
│
Execution & Fact
├─ ExecutionRun / CaptureArtifact / ObservationCandidate
├─ RawObservation / CorrectionRecord
│
Decision & Evidence
├─ Assessment / Review / Resolution
├─ CitationOccurrence / LogicalCitation / SourceBinding
│
Measurement & Publication
├─ MetricContribution / MeasurementSnapshot / SnapshotMembership
├─ Report / ReportRelease
│
Intelligence & Action
├─ Attribution: GapSymptom / Hypothesis
├─ Strategy: StrategyAction / StrategyActionRelease
├─ Intervention / InterventionExecution / EffectEvidence
└─ RetestPlan / RetestComparison
```

## 2. 双轴对象分类

Access Scope 只回答访问归属和 `tenant_id` 放置；Record Semantics 只回答记录性质和生命周期。两者不得再混在同一字段中。

### 2.1 Access Scope

| Access Scope                          | 含义                                      | `tenant_id` 规则                                                             |
| ------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------- |
| `PLATFORM_PRIVATE`                    | 平台内部全局定义                          | 不直接向 Tenant 暴露目录或跨租户统计                                         |
| `TENANT_ROOT`                         | Tenant 本身，是访问边界根                 | Tenant 表不携带指向自己的 `tenant_id`                                        |
| `TENANT_OWNED`                        | Tenant 创建或在 Tenant 上下文中产生的对象 | 原则上直接携带不可变 `tenant_id`；即使可经父对象推导，也保留数据库级隔离防线 |
| `GLOBAL_IDENTITY_WITH_TENANT_CONTEXT` | 可全局去重的规范身份                      | Tenant 只能通过自己的 Binding/Evidence/Projection 使用和查看                 |

### 2.2 Record Semantics

| Record Semantics    | 含义                               | 生命周期约束                                                            |
| ------------------- | ---------------------------------- | ----------------------------------------------------------------------- |
| `MUTABLE_ENTITY`    | 业务身份或工作容器                 | 允许受控更新/停用，不允许重用 ID；已被历史事实引用的记录不硬删除        |
| `PROJECT_FACT`      | 在项目上下文中发生的事实或决策记录 | append-only 或受限状态机；不得迁移 Tenant/Project，不以当前配置改写历史 |
| `RELEASED_ARTIFACT` | 已发布、可引用、可复现的版本       | 发布后不原地修改；通过新 Release 或显式 Replacement 替代                |

## 3. 核心对象目录

### 3.1 Workspace 与产品上下文

| 对象                     | Access Scope     | Record Semantics | 关键关系                        | 核心约束                                                                |
| ------------------------ | ---------------- | ---------------- | ------------------------------- | ----------------------------------------------------------------------- |
| `UserIdentity`           | PLATFORM_PRIVATE | MUTABLE_ENTITY   | 平台级登录身份                  | 登录身份不属于任何单个 Tenant；停用后保留历史 actor 引用                |
| `PlatformRoleAssignment` | PLATFORM_PRIVATE | MUTABLE_ENTITY   | UserIdentity + 固定平台角色     | 与 Tenant 权限完全分离；V1 仅 `PLATFORM_ADMIN`                          |
| `Tenant`                 | TENANT_ROOT      | MUTABLE_ENTITY   | 访问边界根                      | V1 仅平台受控开通；不拥有自身；ID 不重用                                |
| `Membership`             | TENANT_OWNED     | MUTABLE_ENTITY   | Tenant + UserIdentity           | 同一身份可加入多个 Tenant；唯一键为 tenant + user identity              |
| `TenantRoleAssignment`   | TENANT_OWNED     | MUTABLE_ENTITY   | Membership + 固定 Tenant 角色   | V1 仅 `TENANT_ADMIN`、`TENANT_MEMBER`；`CLIENT_READONLY` 延至 Slice 3   |
| `Customer`               | TENANT_OWNED     | MUTABLE_ENTITY   | Tenant                          | 停用不删除；不允许跨 Tenant 转移                                        |
| `Brand`                  | TENANT_OWNED     | MUTABLE_ENTITY   | Customer                        | V1 完全 Tenant 私有；不引入全局 BrandIdentity                           |
| `Project`                | TENANT_OWNED     | MUTABLE_ENTITY   | Brand                           | 只保存 `brand_id`；Customer 通过 Brand 推导，避免关系不一致             |
| `ProjectPolicyBinding`   | TENANT_OWNED     | PROJECT_FACT     | Project + PolicyRelease         | 每类 Binding 同时最多一个当前值；变更只影响未来执行并保留历史           |
| `IndustryPackBinding`    | TENANT_OWNED     | PROJECT_FACT     | Project + IndustryPolicyRelease | 锚点行业包完成前允许无当前 Binding；正式行业计算必须保存实际 release ID |

### 3.2 规则、行业与发布

| 对象                       | Access Scope     | Record Semantics  | 关键关系                       | 核心约束                                                       |
| -------------------------- | ---------------- | ----------------- | ------------------------------ | -------------------------------------------------------------- |
| `PolicyDefinition`         | PLATFORM_PRIVATE | MUTABLE_ENTITY    | 多个 Release                   | 定义稳定语义身份                                               |
| `PolicyRelease`            | PLATFORM_PRIVATE | RELEASED_ARTIFACT | Definition + Manifest          | Slice 1 内置一个系统基础 Release；发布后不修改，可弃用但不删除 |
| `IndustryPolicyDefinition` | PLATFORM_PRIVATE | MUTABLE_ENTITY    | 行业扩展接口                   | 核心表不出现行业专有字段                                       |
| `IndustryPolicyRelease`    | PLATFORM_PRIVATE | RELEASED_ARTIFACT | 分类、阈值、策略、模板         | Slice 1 可无种子；锚点行业包完成后再绑定                       |
| `CoverageContextRelease`   | PLATFORM_PRIVATE | RELEASED_ARTIFACT | Pack B/C + Project/Metric      | 正式 KPI 必须引用实际版本                                      |
| `PromptRelease`            | PLATFORM_PRIVATE | RELEASED_ARTIFACT | Worker/Assessment/Intelligence | 模型输出可复现所需输入之一                                     |

### 3.3 Demand、Question 与 Sampling

| 对象                    | Access Scope | Record Semantics  | 关键关系                              | 核心约束                                                 |
| ----------------------- | ------------ | ----------------- | ------------------------------------- | -------------------------------------------------------- |
| `DemandTheme`           | TENANT_OWNED | MUTABLE_ENTITY    | Project                               | 业务主题，不直接等同统计样本                             |
| `Question`              | TENANT_OWNED | MUTABLE_ENTITY    | Project + DemandTheme                 | 当前编辑入口                                             |
| `QuestionVersion`       | TENANT_OWNED | RELEASED_ARTIFACT | Question                              | 同时是 Tenant 所有和不可变发布物；Execution 绑定具体版本 |
| `MonitoringPlan`        | TENANT_OWNED | MUTABLE_ENTITY    | Project                               | 当前编辑入口，修改产生新 PlanVersion                     |
| `MonitoringPlanVersion` | TENANT_OWNED | RELEASED_ARTIFACT | MonitoringPlan + QuestionVersion 集合 | 固定频率、平台、模型、地域和采样规则                     |
| `SampleBatch`           | TENANT_OWNED | PROJECT_FACT      | PlanVersion                           | 一次计划实例                                             |
| `SampleSlot`            | TENANT_OWNED | PROJECT_FACT      | Batch + QuestionVersion               | 重试不增加统计样本 N                                     |

### 3.4 Execution 与不可变观测

| 对象                   | Access Scope | Record Semantics  | 关键关系                     | 核心约束                                               |
| ---------------------- | ------------ | ----------------- | ---------------------------- | ------------------------------------------------------ |
| `ExecutionRun`         | TENANT_OWNED | PROJECT_FACT      | SampleSlot + actual releases | 幂等键唯一；记录实际模型/平台/策略版本                 |
| `CaptureArtifact`      | TENANT_OWNED | PROJECT_FACT      | ExecutionRun + ObjectStorage | 保存 hash、media type、size、storage ref               |
| `ObservationCandidate` | TENANT_OWNED | PROJECT_FACT      | ExecutionRun                 | 只有满足存在性条件才可 Finalize                        |
| `RawObservation`       | TENANT_OWNED | RELEASED_ARTIFACT | Candidate + CaptureManifest  | `CAPTURING → FINALIZING → FINALIZED`；最终化原子且幂等 |
| `CorrectionRecord`     | TENANT_OWNED | PROJECT_FACT      | RawObservation               | 说明错误和替代投影，不修改原事实                       |

### 3.5 Assessment、Review 与 Resolution

| 对象                    | Access Scope | Record Semantics  | 关键关系                          | 核心约束                                |
| ----------------------- | ------------ | ----------------- | --------------------------------- | --------------------------------------- |
| `Assessment`            | TENANT_OWNED | PROJECT_FACT      | Subject + Policy/Prompt Release   | 通用 Envelope + 领域专用 Payload        |
| `AssessmentEvidence`    | TENANT_OWNED | PROJECT_FACT      | Assessment + Observation/Artifact | 不把模型输出当作原始事实                |
| `Review`                | TENANT_OWNED | PROJECT_FACT      | Assessment/Resolution             | 人工或系统复核均保留 actor 与依据       |
| `Resolution`            | TENANT_OWNED | RELEASED_ARTIFACT | Subject + assessments/reviews     | 明确粒度、上下文、优先级和冲突状态      |
| `ResolutionReplacement` | TENANT_OWNED | PROJECT_FACT      | old/new Resolution                | 禁止 global latest wins；替代关系显式化 |

### 3.6 Citation 与 Source

| 对象                    | Access Scope                        | Record Semantics | 关键关系                           | 核心约束                               |
| ----------------------- | ----------------------------------- | ---------------- | ---------------------------------- | -------------------------------------- |
| `CitationOccurrence`    | TENANT_OWNED                        | PROJECT_FACT     | RawObservation + position/span     | 一次响应中的实际出现，不等同逻辑引用   |
| `CitationQualification` | TENANT_OWNED                        | PROJECT_FACT     | Occurrence + Assessment/Resolution | 保存资格判断和规则版本                 |
| `LogicalCitation`       | GLOBAL_IDENTITY_WITH_TENANT_CONTEXT | MUTABLE_ENTITY   | 多个 Occurrence                    | Tenant 不可枚举其他租户关系            |
| `SourceDomain`          | GLOBAL_IDENTITY_WITH_TENANT_CONTEXT | MUTABLE_ENTITY   | LogicalCitation                    | 全局去重不等于跨租户可见               |
| `SourceDocument`        | GLOBAL_IDENTITY_WITH_TENANT_CONTEXT | MUTABLE_ENTITY   | SourceDomain                       | 文档身份与某次抓取证据分离             |
| `SourceBinding`         | TENANT_OWNED                        | PROJECT_FACT     | LogicalCitation + Source identity  | 在 Tenant Context 内解释来源关系与证据 |

### 3.7 Measurement、Snapshot 与 Report

| 对象                    | Access Scope     | Record Semantics  | 关键关系                               | 核心约束                                            |
| ----------------------- | ---------------- | ----------------- | -------------------------------------- | --------------------------------------------------- |
| `MetricDefinition`      | PLATFORM_PRIVATE | MUTABLE_ENTITY    | 多个 MetricRelease                     | 稳定指标身份                                        |
| `MetricRelease`         | PLATFORM_PRIVATE | RELEASED_ARTIFACT | Definition + evaluator                 | 正式 KPI 引用 Pack B/C 与 Coverage Context          |
| `MetricContribution`    | TENANT_OWNED     | PROJECT_FACT      | Observation/Resolution + MetricRelease | 保存资格、分子/分母贡献及排除原因                   |
| `MeasurementSnapshot`   | TENANT_OWNED     | RELEASED_ARTIFACT | Project + context releases             | 生命周期与完整性状态分离                            |
| `ObservationMembership` | TENANT_OWNED     | RELEASED_ARTIFACT | Snapshot + RawObservation + Resolution | 冻结实际 Observation 层成员与 Resolution provenance |
| `MetricMembership`      | TENANT_OWNED     | RELEASED_ARTIFACT | Snapshot + MetricContribution          | 冻结实际指标层成员                                  |
| `SnapshotReplacement`   | TENANT_OWNED     | PROJECT_FACT      | old/new Snapshot                       | 错误通过显式替代，不覆盖已交付历史                  |
| `Report`                | TENANT_OWNED     | MUTABLE_ENTITY    | Project                                | 报告业务身份                                        |
| `ReportRelease`         | TENANT_OWNED     | RELEASED_ARTIFACT | Report + exact Snapshot                | 前端不得重新计算正式指标                            |

### 3.8 Intelligence、Intervention 与效果验证

| 对象                    | Access Scope | Record Semantics  | 子域     | 关键关系与核心约束                                       |
| ----------------------- | ------------ | ----------------- | -------- | -------------------------------------------------------- |
| `DiagnosisRun`          | TENANT_OWNED | PROJECT_FACT      | 归因     | 固定 Snapshot、PolicyRelease 和 PromptRelease            |
| `GapSymptom`            | TENANT_OWNED | PROJECT_FACT      | 归因     | 描述可观察差距，不直接宣称原因                           |
| `Hypothesis`            | TENANT_OWNED | PROJECT_FACT      | 归因     | 假设与已证实事实分离                                     |
| `StrategyAction`        | TENANT_OWNED | MUTABLE_ENTITY    | 策略     | 建议工作容器；当前编辑入口                               |
| `StrategyActionRelease` | TENANT_OWNED | RELEASED_ARTIFACT | 策略     | 固定 Hypothesis、StrategyRuleRelease、证据和建议内容     |
| `Intervention`          | TENANT_OWNED | MUTABLE_ENTITY    | 干预     | 计划容器，引用 StrategyActionRelease，允许人工执行       |
| `InterventionRelease`   | TENANT_OWNED | RELEASED_ARTIFACT | 干预     | 固定目标、范围、计划和验证窗口                           |
| `InterventionExecution` | TENANT_OWNED | PROJECT_FACT      | 干预     | 记录实际动作、时间、对象和证据                           |
| `RetestPlan`            | TENANT_OWNED | MUTABLE_ENTITY    | 效果验证 | 定义复测范围、窗口、基线 Snapshot 与目标口径             |
| `RetestComparison`      | TENANT_OWNED | PROJECT_FACT      | 效果验证 | 固定 RetestPlan 与 before/after Snapshot，显式记录可比性 |
| `EffectEvidence`        | TENANT_OWNED | PROJECT_FACT      | 效果验证 | 记录支持/不支持/不确定及限制；MVP 不宣称严格因果         |

## 4. 跨模块引用规则

1. 下游对象引用上游不可变 ID 或 Release ID，不复制“当前值”作为历史依据。
2. 所有 `TENANT_OWNED` 对象直接携带不可变 `tenant_id`；项目上下文对象还携带 `project_id`，Customer 通过 `Project → Brand → Customer` 推导。
3. 全局身份对象不直接携带 Tenant 业务结论；结论位于 Tenant-scoped Binding、Evidence、Assessment 或 Projection。
4. Report 只消费指定 Snapshot、Diagnosis 和 Intervention Release，不在展示层重算。
5. 队列重投复用幂等结果；只有真实业务重试才创建新的 ExecutionRun，且不产生新的 SampleSlot 或独立 execution_attempt 对象。
6. 所有替代关系显式记录 `supersedes/replaces`，不得以最大时间戳解释业务真相。

## 5. Slice 依赖

| Slice          | 新增核心对象                        | 必须复用的既有契约                            | 可独立验收的产品结果                  |
| -------------- | ----------------------------------- | --------------------------------------------- | ------------------------------------- |
| 1 Workspace    | UserIdentity 至 IndustryPackBinding | Tenant Context、ID、Audit、基础 PolicyRelease | 第三方建立隔离的客户项目空间          |
| 2 Observation  | QuestionVersion 至 RawObservation   | Policy Release、Outbox、Object Storage        | 真实查询形成不可变观测                |
| 3 Measurement  | Assessment 至 ReportRelease         | Resolution Protocol、Snapshot Contract        | 指定 Snapshot 可重复生成 Basic Report |
| 4 Formal KPI   | Citation、Source、MetricRelease     | Pack B/C、Coverage Context                    | 锚点行业正式 KPI 与客户报告           |
| 5 Intelligence | DiagnosisRun 至 StrategyAction      | Snapshot、Prompt/Policy Release               | 可解释诊断与策略行动                  |
| 6 Intervention | Intervention 至 EffectEvidence      | Snapshot Replacement、ReportRelease           | 行动、复测、对比和限制说明闭环        |

## 6. 后续 Slice 的产品问题

这些问题不阻塞 Slice 1；在对应 Slice 开始前明确即可：

1. 锚点行业是什么，以及首行业正式规则包的最小覆盖范围。
2. V1 首批支持哪些 AI 平台、模型和地区/语言上下文。
3. Mention、Recommendation、Citation KPI 的客户报告最小集合。
4. GEO Intelligence 首行业最小诊断分类和策略行动类型。
5. Intervention 的执行方式：仅人工记录，还是包含平台内任务协作。
6. 复测窗口和 Effect Evidence 的最低证据标准。
7. `CLIENT_READONLY` 不进入 Slice 1 固定角色；到 Slice 3 再决定客户直接登录或由 Tenant 导出/分享报告。
