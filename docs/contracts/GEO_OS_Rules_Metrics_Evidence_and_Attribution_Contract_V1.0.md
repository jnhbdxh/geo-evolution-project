# GEO OS 规则、指标、证据与归因合同 V1.0

- **状态：** WORKING BASELINE
- **版本库状态：** IMPLEMENTED_IN_WORKTREE
- **生效日期：** 2026-08-24
- **权威范围：** 冻结规则工程映射、指标贡献、证据分层、Snapshot、可比性、归因与报告表述
- **上游权威：** A1/A2/A3/B/C 冻结决议包
- **机器映射：** `docs/decision-registry/*.yaml`

## 1. 权威边界

本合同负责索引、组合并约束冻结决议的工程实现，不重写或隐式替代 A1/A2/A3/B/C。发生冲突时，以对应冻结决议包为该语义领域的权威来源，并将代码或测试差异记录为不符合项。

```text
Frozen Decision Pack
→ version-controlled Manifest
→ Code Evaluator
→ immutable runtime Release reference
→ Contract Test
```

Decision Registry 不是动态规则平台。当前不建设规则编辑器、表达式引擎、可视化编排、规则运营后台或热更新平台。

## 2. A1、A2 与正式贡献必须分离

### 2.1 A1：Observation Existence

A1 只回答是否存在用户可见响应事实。Candidate 在首次有效可见响应信号出现时创建。ExecutionRun 最终失败不否定此前已出现的响应事实。

### 2.2 A2：Validity 与 Metric Eligibility

A2 在已经存在 Observation 的前提下，分别判断有效性和指标资格。不存在、无效、无资格和未知必须保持不同语义。

### 2.3 MetricContribution

正式贡献只能来自明确的 Resolution 和实际 Metric/Policy/Industry Release。最小贡献语义为：

```text
VALUE_1
VALUE_0
NO_CONTRIBUTION
UNKNOWN
```

- `VALUE_0` 是有资格且正式判断为 0；
- `NO_CONTRIBUTION` 表示不进入该口径的分子或分母；
- `UNKNOWN` 表示缺少足够事实或决议；
- INVALID、INELIGIBLE 和 UNKNOWN 不得转换为 0；
- SampleSlot 是计划样本 N，ExecutionRun 重试不增加 N。

## 3. 证据分层

### 3.1 原始执行证据

CaptureArtifact 保存真实对象字节的 storage ref、media type、size 和 SHA-256。RawObservation Finalize 前必须重新读取并验证对象字节，不能只信任上传请求或对象清单。

### 3.2 Observation 证据

- Candidate 保存首次检测事实；
- RawObservation 保存完整响应的最终时间窗、形态和证据集合；
- CorrectionRecord 解释错误或替代投影，不修改原始事实；
- 人工验证、登录失效、页面漂移和服务异常属于运行错误，不是 AI 回答。

### 3.3 Citation 与 Source

```text
visible link candidate
→ CitationOccurrence
→ CitationQualification
→ LogicalCitation
→ Source identity
→ Tenant-scoped SourceBinding
→ Resolution / MetricContribution
```

页面链接只能先成为候选证据，不能直接成为正式 Citation。出现位置、资格判断、逻辑引用、来源身份和 Tenant 关系必须分层。

全局 LogicalCitation、SourceDomain 或 SourceDocument 身份可以去重，但 Tenant 不得枚举其他租户的出现、资格、Binding、指标或证据。

## 4. Resolution—MetricContribution—Snapshot—Report 主合同

### 4.1 Resolution

Resolution 至少固定：

- Subject 类型和 ID；
- Tenant/Project Context；
- 被采用和被拒绝的 Assessment/Review 依据；
- 实际 Policy、Industry、Coverage、Prompt 或 Evaluator 版本；
- 决议值、有效性、资格、冲突和未知状态；
- 实际 Actor/Service Identity 和决议时间；
- Replacement 关系。

### 4.2 MetricContribution

每条 MetricContribution 必须能追溯到：

- 一个计划样本单位或明确聚合成员；
- 实际 RawObservation；
- 实际 Resolution；
- MetricRelease 及其依赖的规则版本；
- 贡献值或非贡献原因；
- 可选的 Citation/Source 资格证据。

展示层不得自行从原始文本重新推断正式贡献。

### 4.3 MeasurementSnapshot

Snapshot 发布时固定：

- Project 和测量窗口；
- 计划样本成员及缺失成员；
- ObservationMembership 和 Resolution provenance；
- MetricMembership；
- 实际 Policy/Industry/Metric/Coverage/Comparability Release；
- 完整性和可比性状态；
- 生成时间、发布身份和 Replacement 链。

新数据、补跑、规则升级或人工纠错不得原地改写已发布 Snapshot。

### 4.4 ReportRelease

ReportRelease 必须引用指定 Snapshot 和其实际版本链。报告可以消费已发布 Diagnosis、Strategy、Intervention 和 EffectEvidence，但不得在页面或模板中重新计算正式 KPI。

相同 ReportRelease 输入必须可重复得到相同正式数字。报告模板变化产生新 ReportRelease，不覆盖历史交付物。

## 5. 可比性合同

前后对比至少固定：

- QuestionVersion 及 MonitoringPlanVersion 固定的有序 QuestionVersion Membership；
- 计划样本定义和 N；
- 平台、端面、模型披露和地区/语言；
- 执行模式和时间窗口；
- Policy、Industry、Metric、Coverage 和 Comparability Release；
- 缺失、失败、UNKNOWN、INVALID、INELIGIBLE 的处理；
- 允许的偏差及其影响。

可比性状态至少区分：

```text
COMPARABLE
PARTIALLY_COMPARABLE
NOT_COMPARABLE
UNKNOWN
```

不可比时不得输出无条件的“提升/下降”效果结论。部分可比时必须披露差异及限制。

## 6. 归因与报告语言

报告必须区分：

1. 观测事实：实际看到了什么；
2. 指标变化：冻结口径下数字如何变化；
3. 相关变化：变化与行动在时间或范围上相关；
4. 诊断假设：可能的解释，尚未被证实；
5. 贡献判断：证据支持行动对变化有贡献；
6. 因果结论：需要单独的因果设计和证据，MVP 默认不宣称。

禁止把“优化后发生变化”直接写成“本次优化导致变化”。EffectEvidence 必须允许 `SUPPORTS`、`DOES_NOT_SUPPORT`、`INCONCLUSIVE` 和限制说明。

## 7. 规则升级与历史

- Manifest 记录冻结源文件 SHA-256、语义边界和工程映射；
- Evaluator 代码和 Contract Test 必须版本化；
- 运行时结果保存实际 Release/Evaluator 版本；
- 规则升级创建新 Release，不能重算并覆盖历史结果；
- 若需要按新规则重新解释历史 Observation，应产生新的 Assessment、Resolution、Contribution 和 Snapshot，并保留与旧结果的关系；
- Decision Registry 的 Manifest 是冻结源的机器可读投影，不是新的独立业务权威。

## 8. 对应 Slice 的设计深度

本合同只冻结跨模块输入输出、溯源和语义边界。Assessment、Resolution、Metric、Snapshot、Citation、Report 等对象的详细字段、表、API、页面和内部算法，在进入相应 Slice 时设计并通过 `0003+` 前向迁移实现。
