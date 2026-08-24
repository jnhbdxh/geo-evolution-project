# GEO OS Product Slice Implementation Map V0.1

- **Status:** SUPERSEDED
- **Superseded by:** `GEO_OS_V2_Product_Scope_and_Implementation_Baseline_V1.0.md`
- **Inputs:** Commercial MVP Product Baseline V1.0 + Product Object Map V0.1 + Technical Architecture Reconciliation V1.1

> 历史说明：本文件保留早期 Slice 设计痕迹。下文已纠正三个会误导实现的错误：Slice 2 子域标题、独立 execution_attempt，以及 FAILED 与 Observation 的关系。当前状态和验收以替代基线及 `docs/product-implementation-status.yaml` 为准。

## 1. 产品导航骨架

```text
Platform Admin
└─ Tenant Provisioning

Tenant Workspace
├─ Customers
├─ Brands
├─ Projects
└─ Members & Roles

Project Workspace
├─ Overview
├─ Demand & Questions
├─ Monitoring Runs
├─ Observations
├─ Measurement
├─ Citations & Sources
├─ Intelligence
├─ Interventions
└─ Reports
```

V1 页面以桌面端管理台为主。Slice 1 只实现平台管理员与 Tenant 成员登录；`CLIENT_READONLY` 到 Slice 3 报告交付时再决定，不单独建设客户门户产品线。

## 2. Slice 1 — Workspace 与项目建档

### 产品结果

第三方 Tenant 能在隔离空间中管理成员、客户、品牌和项目，并为项目选择未来执行的默认规则版本。

| 类型     | 最小实现                                                                                                                                                                                                                                                                        |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 页面     | Tenant 列表/开通（平台内部）、成员与角色、客户列表与详情、品牌详情、项目创建、项目设置                                                                                                                                                                                          |
| API      | `POST /platform/tenants`、`/memberships`、`/customers`、`/brands`、`/projects`、`/projects/{id}/policy-bindings`、`/projects/{id}/industry-bindings`                                                                                                                            |
| 领域事件 | `TenantProvisioned`、`MembershipChanged`、`CustomerCreated`、`BrandCreated`、`ProjectCreated`、`ProjectPolicyBindingChanged`                                                                                                                                                    |
| 逻辑表   | user_identity、platform_role_assignment、tenant、membership、tenant_role_assignment、customer、brand、project、policy_definition、policy_release、industry_policy_definition、industry_policy_release、project_policy_binding、industry_pack_binding、audit_event、outbox_event |
| 权限     | 平台角色：`PLATFORM_ADMIN`；Tenant 角色：`TENANT_ADMIN`、`TENANT_MEMBER`。两套权限分离且使用固定枚举                                                                                                                                                                            |
| 关键测试 | 跨租户 ID 猜测、列表过滤、唯一约束、缓存键、对象路径、管理员越权审计                                                                                                                                                                                                            |

### 页面验收

1. 平台受控开通 Tenant。
2. Tenant Admin 创建客户、品牌和项目。
3. 数据关系固定为 `Tenant → Customer → Brand → Project`；Project 只保存 `brand_id`，Customer 通过 Brand 推导。
4. 同一 Tenant 可管理多个客户；不同 Tenant 看不到彼此对象存在性。
5. Slice 1 内置一个系统基础 `PolicyRelease`；Industry Binding 可为空。
6. 每类默认 Binding 同时最多一个当前值；变更只影响未来执行。

## 3. Slice 2 — 真实查询与不可变观测

### 产品结果（Demand、Monitoring、Execution 与 Observation 子域）

用户可以创建问题版本、发起真实 AI 查询，并得到带原始证据的不可变 Observation。

| 类型         | 最小实现                                                                                                                                                                                                  |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 页面         | 问题库、问题版本详情、Monitoring Plan、批次与 Slot、Execution 详情、原始响应证据、Observation 详情                                                                                                        |
| API          | `/questions`、`/question-versions`、`/monitoring-plans`、`/sample-batches`、`/sample-slots`、`/execution-runs`、`/observation-candidates/{id}/finalize`、`/observations/{id}`                             |
| 命令/事件    | `ScheduleSampleBatch`、`ExecuteSampleSlot`、`ExecutionStarted`、`CaptureCompleted`、`ObservationCandidateCreated`、`ObservationFinalized`                                                                 |
| 逻辑表       | demand_theme、question、question_version、monitoring_plan、monitoring_plan_version、sample_batch、sample_slot、execution_run、capture_artifact、observation_candidate、raw_observation、correction_record |
| 独立运行单元 | Core API 发命令；Real AI Query Engine 执行和捕获；Worker 完成受控解析与 Finalization 辅助                                                                                                                 |
| 关键测试     | Execution 重试不增加 Sample N、Finalization 幂等、对象上传失败恢复、FINALIZED 拒绝 UPDATE、证据 hash 校验                                                                                                 |

### 页面验收

1. 用户能看到某个 Slot 的计划上下文、实际执行上下文、原始响应和状态。
2. ExecutionRun 最终为 FAILED 不等于不存在 Observation；只要此前已有满足 A1 的用户可见响应事实，仍可在终态后 Finalize RawObservation。
3. 同一 Candidate 重复 Finalize 只返回同一个 RawObservation。
4. 纠错显示为新记录，不改变原始事实。

## 4. Slice 3 — 决议、测量与 Basic Report

### 产品结果

系统把 Observation 转为可复核 Resolution，冻结 Measurement Snapshot，并稳定生成 Basic Report。

| 类型      | 最小实现                                                                                                                                                                                                                                                             |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 页面      | Assessment 详情、Review 队列、Resolution 时间线、Snapshot 列表与详情、Basic Report                                                                                                                                                                                   |
| API       | `/assessments`、`/reviews`、`/resolutions`、`/measurement-snapshots`、`/reports`、`/report-releases`                                                                                                                                                                 |
| 命令/事件 | `AssessObservation`、`AssessmentCreated`、`ReviewRecorded`、`ResolutionPublished`、`BuildMeasurementSnapshot`、`SnapshotFinalized`、`PublishReportRelease`                                                                                                           |
| 逻辑表    | assessment、assessment_evidence、review、resolution、resolution_replacement、metric_definition、metric_release、metric_contribution、measurement_snapshot、snapshot_observation_membership、snapshot_metric_membership、snapshot_replacement、report、report_release |
| MVP 指标  | 非客户测试指标或冻结的 `ANSWER_OUTCOME`，只验证贡献、成员、决议和报告消费链                                                                                                                                                                                          |
| 关键测试  | Resolution 粒度隔离、禁止 global latest wins、Snapshot 两层 Membership、历史策略变化不影响结果、重复发布幂等                                                                                                                                                         |

### 页面验收

1. 用户可以从 Report 下钻到 Snapshot、MetricContribution、Resolution 和 RawObservation。
2. 同一 ReportRelease 重复打开结果一致。
3. 新 Assessment 不会覆盖历史 Resolution。
4. Snapshot 发生问题时显示 `IMPACTED`，并通过 Replacement Snapshot 更正。

## 5. Slice 4 — 首行业正式语义与 KPI

### 产品结果

锚点行业项目可以交付正式 Mention、Recommendation、Citation KPI，并解释资格、贡献和来源证据。

| 类型      | 最小实现                                                                                                                                                             |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 页面      | 正式 Measurement Dashboard、KPI 口径说明、Citation Explorer、Source 详情、客户正式报告                                                                               |
| API       | `/metric-releases`、`/coverage-context-releases`、`/citation-occurrences`、`/logical-citations`、`/source-bindings`、`/snapshots/{id}/metrics`                       |
| 命令/事件 | `ExtractCitationOccurrences`、`QualifyCitation`、`ResolveMention`、`ResolveRecommendation`、`CalculateFormalMetrics`                                                 |
| 逻辑表    | coverage_context_release、citation_occurrence、citation_qualification、logical_citation、source_domain、source_document、source_binding、metric_contribution_payload |
| 规则输入  | Pack B、Pack C、首行业 Coverage Context、MetricRelease、PromptRelease                                                                                                |
| 关键测试  | UNKNOWN 不转 0、Occurrence 与 LogicalCitation 分层、资格与计数分离、来源目录不跨租户泄漏、正式分母可复现                                                             |

### 页面验收

1. 每个 KPI 展示口径版本、样本量、未知/排除数量和证据下钻。
2. Citation Presence、Count 和 Source Set 不共用一个含糊状态。
3. 客户报告引用固定 Snapshot，不跟随规则升级变化。

## 6. Slice 5 — GEO Intelligence

### 产品结果

系统基于正式 Snapshot 生成可解释的差距、症状、假设和策略行动，而不是只展示分数。

| 类型       | 最小实现                                                                                                                     |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 页面       | Intelligence Overview、Gap/Symptom 列表、Hypothesis 详情、Strategy Action 列表与详情                                         |
| API        | `/diagnosis-runs`、`/gap-symptoms`、`/hypotheses`、`/strategy-actions`                                                       |
| 命令/事件  | `RunDiagnosis`、`DiagnosisCompleted`、`HypothesisCreated`、`StrategyActionReleased`                                          |
| 逻辑表     | 归因子域：diagnosis_run、gap_symptom、hypothesis；策略子域：strategy_action、strategy_action_release、strategy_evidence_link |
| 首行业内容 | 最小诊断分类、触发条件、证据要求、策略行动模板和限制说明                                                                     |
| 关键测试   | 建议引用固定 Snapshot、无证据不输出确定性结论、规则/Prompt 版本可复现、同输入同版本结果稳定                                  |

### 页面验收

1. 每项策略能回答“发现了什么、为什么、依据是什么、建议做什么”。
2. Hypothesis 明确显示 `HYPOTHESIS`，不伪装成已证实原因。
3. `StrategyAction` 是可变工作容器；发布生成不可变 `StrategyActionRelease`。规则升级不覆盖旧报告中的 Release。

## 7. Slice 6 — Intervention 与 Effect Validation

### 产品结果

用户能把策略转为行动记录，完成复测，并在不夸大因果的前提下解释变化。

| 类型        | 最小实现                                                                                                                           |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 页面        | Intervention Board、行动详情、执行证据、复测配置、Before/After Comparison、Effect Evidence、更新报告                               |
| API         | `/interventions`、`/intervention-releases`、`/intervention-executions`、`/retests`、`/retest-comparisons`、`/effect-evidence`      |
| 命令/事件   | `ReleaseInterventionPlan`、`RecordInterventionExecution`、`ScheduleRetest`、`CompareSnapshots`、`EffectEvidencePublished`          |
| 逻辑表      | intervention、intervention_release、intervention_execution、intervention_evidence、retest_plan、retest_comparison、effect_evidence |
| V1 执行方式 | 平台内记录 + 人工/半自动外部执行；不依赖 Publisher Worker                                                                          |
| 关键测试    | Before/After 口径兼容、执行证据完整、时间窗口明确、无严格因果宣称、报告绑定固定比较结果                                            |

### 页面验收

1. 用户从 StrategyAction 一键创建 Intervention 草稿。
2. 发布后的 InterventionRelease 不可修改；调整产生新版本。
3. Retest 显示可比性、差异、支持/不支持/不确定和限制。
4. 未执行、证据不足或口径不可比时，系统不会输出“行动有效”。

## 8. 共用产品组件

所有 Slice 复用以下组件，不在各模块重复实现：

- Tenant Context 与授权中间件；
- Release/Version 查看器；
- Evidence Viewer；
- Status Timeline；
- Audit Trail；
- Async Job Status 与重试状态；
- Snapshot Selector；
- Policy/Prompt/Industry Release Badge；
- Error、Unknown、Excluded、Not Applicable 的统一解释组件。

## 9. 开发顺序与可并行项

```text
Core Contracts
├─ Tenant / Identity
├─ Release / Version
├─ Outbox / Idempotency
├─ Observation Finalization
└─ Resolution / Snapshot

Slice 1 → Slice 2 → Slice 3 → Slice 4 → Slice 5 → Slice 6
              └──── 首行业规则准备可并行 ────┘
```

首行业规则、问题模板、Coverage Context、诊断分类和策略库可以与 Slice 1–3 代码并行准备，但只有到 Slice 4 才进入正式客户口径。

## 10. 历史：第一轮代码启动条件（已完成，不再适用）

以下条件仅记录首轮实施前置，不再代表当前开发恢复条件。当前退出条件见替代产品基线。

开始 Slice 1 前只需确认：

1. Tenant、UserIdentity 与 Membership 的 Access Scope / Record Semantics；
2. 固定平台角色与 Tenant 角色；`CLIENT_READONLY` 不进入 Slice 1；
3. `Tenant → Customer → Brand → Project` 单链关系；
4. ID 不重用、停用不删除与审计原则；
5. 系统基础 PolicyRelease、可空 Industry Binding、单一当前 Binding 与实际 Release 引用；
6. 跨租户隔离测试策略。

无需等待多行业规则、正式 KPI、诊断策略或 Intervention 细节全部完成。
