# GEO OS Commercial MVP Product Baseline V1.0

- **Status:** SUPERSEDED
- **Superseded by:** `GEO_OS_V2_Product_Scope_and_Implementation_Baseline_V1.0.md`
- **Date:** 2026-08-21
- **Owner context:** 独立开发者兼产品负责人
- **Purpose:** 将项目主线从组织治理切回产品闭环、Commercial MVP 范围与可实施顺序。

> 历史说明：本文件保留为 2026-08-21 的产品收敛证据。当前产品范围、Slice 状态和下一步以替代基线及 `docs/product-implementation-status.yaml` 为准。

## 1. 决策结论

GEO OS 的 Commercial MVP 定义为：

> 完成可供受控第三方 Tenant 使用的 GEO 决策闭环产品代码，并使用一个锚点行业的最小正式规则包完成客户级交付；后续行业扩展以新增和升级规则包为主，不重构核心业务模型。

这意味着：

- MVP 不是只有基础设施、测试指标和演示报告。
- 核心产品模块的代码能力需要完整存在，并能够端到端协同。
- 归因、策略、行业分类等内容型规则，MVP 只需先完成一个行业的可用版本。
- 核心对象、状态机、版本引用、扩展接口和历史复现能力必须从第一版正确建立。
- 后续允许补规则、补策略、补行业深度，但不允许通过改写历史事实或重做核心表来扩展。

## 2. 产品形态

GEO OS 是一个面向企业和服务商的、多租户 GEO 决策与行动操作系统，不是单纯的监控看板、关键词工具或内容发布器。

V1 产品形态为：

- 平台方受控开通第三方 Tenant Workspace。
- 每个 Tenant 管理本机构成员及自己的 Customer、Brand、Project。
- Project 组织问题、采样、真实 AI 查询、观测事实、判断、指标、诊断、行动和报告。
- 所有正式结果绑定明确的事实、决议、规则版本和 Measurement Snapshot。
- 客户看到的是可解释、可复测、可追踪的诊断与改进行动，而不是孤立分数。

V1 不包含自助注册、代理父子层级、白标、计费、分佣和开放 API。

## 3. 客户价值闭环

```text
Tenant Workspace
→ Customer / Brand / Project
→ Demand / Question Set
→ Monitoring Plan / Sample Slot
→ AI Query Execution
→ Immutable Observation
→ Assessment / Review / Resolution
→ Metric Contribution / Measurement Snapshot
→ GEO Diagnosis / Strategy Action
→ Intervention Record / Retest
→ Effect Evidence
→ Customer Report
```

客户购买的不是某一次查询结果，而是以下持续能力：

1. 知道品牌在目标 AI 场景中是否被看见、如何被理解、为什么形成当前结果。
2. 找到可以执行的优化方向，并保留每次策略和行动的版本。
3. 在相同口径下复测，比较行动前后的 Snapshot 和证据。
4. 区分事实、模型判断、人工复核、规则决议与产品建议。

## 4. Commercial MVP 范围

### 4.1 必须完成的产品代码能力

| 产品域                     | MVP 必须具备的代码能力                                                | 首行业最小规则内容                  |
| -------------------------- | --------------------------------------------------------------------- | ----------------------------------- |
| Tenant Workspace           | 受控开通、成员、角色、Tenant Context、隔离审计                        | 不依赖行业规则                      |
| Customer / Brand / Project | 客户、品牌、项目、目标与配置版本                                      | 首行业项目模板                      |
| Demand & Question          | 需求主题、问题集、不可变 QuestionVersion                              | 首行业问题分类与模板                |
| Monitoring & Sampling      | 计划、SampleSlot、批次、重试不增加样本量                              | 首行业采样参数默认值                |
| Query Execution            | 真实 AI 端执行、上下文记录、失败与证据捕获                            | 首批目标平台配置                    |
| Observation                | Candidate、Finalization、不可变 RawObservation、Correction            | 行业无关                            |
| Assessment / Resolution    | 通用 Envelope、领域 Payload、复核、最终决议                           | A/B/C 决议与首行业 Coverage Context |
| Citation & Source          | Occurrence、Qualification、LogicalCitation、SourceBinding、Resolution | 首行业来源分类与资格规则            |
| Measurement & Snapshot     | MetricContribution、两层 Membership、Resolution Provenance、替代链    | 首行业正式 KPI 口径                 |
| GEO Intelligence           | Gap、Symptom、Hypothesis、StrategyAction 的生成、版本和证据引用       | 首行业诊断与策略库                  |
| Intervention               | 计划、行动记录、版本、负责人字段、执行状态和证据                      | 首行业行动模板                      |
| Effect Validation          | 前后 Snapshot 对比、窗口、影响证据和限制说明                          | 首行业复测窗口与解释规则            |
| Report & Delivery          | 指定 Snapshot 报告、诊断、行动、复测对比和历史版本                    | 首行业客户报告模板                  |

### 4.2 分阶段开放，不等于整体延后

| 能力              | Walking Skeleton                      | Commercial MVP                                     |
| ----------------- | ------------------------------------- | -------------------------------------------------- |
| Measurement       | 非客户测试指标或冻结的 ANSWER_OUTCOME | 首行业正式 Mention / Recommendation / Citation KPI |
| GEO Intelligence  | 验证 Snapshot 可被诊断引擎消费        | 最小正式诊断、假设和策略行动                       |
| Intervention      | 骨架对象和状态流                      | 人工/半自动行动记录、版本和复测                    |
| Effect Validation | 技术性前后 Snapshot 对比              | 客户可读的影响证据；不宣称严格因果                 |
| Report            | Basic Report 验证消费链               | 正式客户报告与历史版本                             |

### 4.3 延后能力

- 完整多行业 Policy Pack 与运营后台。
- 动态低代码规则平台。
- 大规模自动策略生成与自动执行。
- 严格因果归因模型和跨渠道归因。
- Publisher Worker 与大规模渠道自动发布。
- 自助注册、代理层级、白标、计费、分佣和开放 API。
- 高级 Source Intelligence、经营分析和跨客户 Benchmark 产品。

## 5. 不可返工的核心产品契约

后续模块可以逐个完善，但以下契约必须先统一，否则会跨模块返工：

1. **Tenant 与对象归属**：每类对象明确是全局身份、Tenant 上下文还是 Tenant 私有事实。
2. **不可变事实**：Execution Evidence、RawObservation 和已发布 Snapshot 不允许被当前配置覆盖。
3. **版本绑定**：Execution、Assessment、Resolution、Metric、Snapshot、Strategy 和 Report 保存实际使用的 release/version ID。
4. **Assessment / Review / Resolution**：判断过程与最终决议分离；通用 Envelope 不替代领域 Payload。
5. **Snapshot**：冻结实际成员、决议来源、规则版本和完整性状态；错误通过 Replacement 处理。
6. **行业扩展**：核心模型禁止行业字段硬编码；行业差异通过版本化规则包、分类表和 Evaluator 接口注入。
7. **异步一致性**：任务可重试、可幂等、可恢复；Redis 和队列不保存唯一业务事实。

这些是产品整体性约束，不是多人审批流程。

## 6. 模块实施顺序

不采用“每个模块完全做完后再集成”，而采用六个可运行产品切片：

### Slice 1 — Workspace 与项目建档

```text
Tenant → Member → Customer → Brand → Project → Policy Binding
```

验收：第三方只能管理自己的客户和项目，项目配置可版本化。

### Slice 2 — 真实查询与不可变观测

```text
QuestionVersion → Monitoring Plan → SampleSlot → ExecutionRun
→ Capture Evidence → RawObservation Finalization
```

验收：一次真实 AI 查询可形成不可变、可追踪、可纠错的观测事实。

### Slice 3 — 决议、测量与基础报告

```text
Assessment → Review → Resolution → MetricContribution
→ MeasurementSnapshot → Basic Report
```

验收：同一 Snapshot 可重复生成同一基础报告，当前项目配置变化不改写历史。

### Slice 4 — 首行业正式语义与 KPI

```text
Pack B / Pack C → Coverage Context → Citation / Mention / Recommendation
→ Formal Metric → Customer Report
```

验收：锚点行业可输出具有资格说明、证据和口径版本的正式客户 KPI。

### Slice 5 — 诊断与策略

```text
Snapshot → Gap / Symptom → Hypothesis → StrategyAction
```

验收：每项诊断和建议可追溯到 Snapshot、证据和策略规则版本。

### Slice 6 — 干预与效果验证

```text
StrategyAction → Intervention → Execution Evidence
→ Retest Snapshot → Effect Evidence → Updated Report
```

验收：客户可看到做了什么、何时做、基于什么建议、复测发生了什么变化以及结论限制。

## 7. 产品级验收场景

Commercial MVP 至少通过以下真实场景：

1. 平台受控开通一个第三方 Tenant，该 Tenant 创建自己的客户、品牌和项目。
2. 项目选择锚点行业规则版本，创建问题集并执行真实 AI 查询。
3. 系统保留完整执行证据，并形成不可变 Observation。
4. 系统完成 Mention、Recommendation、Citation 等首行业正式判断与指标计算。
5. 系统发布可复现的 Measurement Snapshot 和客户报告。
6. 系统基于 Snapshot 形成诊断、假设和可执行策略。
7. 用户记录一次干预，完成复测并生成前后对比及限制说明。
8. Tenant A 无法发现或读取 Tenant B 的客户、任务、观测、文件、缓存和报告。
9. 修改 Project 当前配置后，历史 Execution、Resolution、Snapshot 和 Report 保持不变。
10. 重复消息、任务重试和 Worker 重启不会产生重复业务事实。

## 8. 技术实现对齐结论

当前总体技术方向与本产品基线基本对齐，无需推倒重来：

- 核心业务采用模块化单体，适合独立开发者控制复杂度并保持跨模块事务一致性。
- Real AI Query Engine 独立，隔离真实端面执行、资源和失败模式。
- AI/Data Worker 独立，承载抽取、分类、评估、测量、诊断和报告等异步任务。
- PostgreSQL 是业务事实与历史复现来源；对象存储保存大证据；Redis 只做缓存、队列和租约。
- Policy Release、Snapshot、Outbox、幂等和 Trace Context 是跨模块基础能力。

需要修正的是产品范围表达，而不是技术架构主干：

- `GEO Intelligence` 从“整体 DEFERRED”调整为“最小产品能力 IN，高级策略规则 DEFERRED”。
- `Intervention & Effect Validation` 从“整体 DEFERRED”调整为“最小闭环 IN，自动化与严格归因 DEFERRED”。
- 正式客户 KPI 在 Walking Skeleton 阶段关闭，但在 Commercial MVP 的锚点行业阶段必须开放。
- Publisher Worker 继续 DEFERRED，不影响客户通过人工或半自动方式执行策略。

## 9. 轻量个人项目控制

本项目不再以多人角色、替补负责人、会议签署和逐项 Owner 确认为开发前置条件。

只保留四项轻量记录：

- 决策是什么；
- 为什么这样决策；
- 影响哪些对象、接口、数据和测试；
- 从哪个版本开始生效。

现有 G0-01 治理材料保留为历史评审资料，但其中依赖多人组织结构的 Owner/Approver 关闭条件不作为当前开发阻塞。真正的开发前置条件以本文件第 5 节的核心产品契约为准。

## 10. 历史下一步（已被当前实施基线替代）

以下条目记录本文件生效时的实施顺序，不再代表当前执行项：

1. 冻结 Slice 1 Domain Contract V0.1：Tenant/UserIdentity、Customer–Brand–Project、固定角色、Policy/Industry Binding、停用与隔离语义。
2. 搭建 Monorepo、CI、迁移、Authentication Skeleton、Tenant Context、Audit 与 Outbox 基础设施。
3. 实现 Slice 1 的最小 API 与跨租户/关系约束测试。
4. 并行准备 Slice 2 Observation Contract，不等待锚点行业规则或正式 KPI。
