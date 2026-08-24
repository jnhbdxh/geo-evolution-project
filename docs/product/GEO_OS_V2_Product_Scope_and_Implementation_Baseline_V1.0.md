# GEO OS V2 产品范围与实施基线 V1.0

- **状态：** ACTIVE WORKING BASELINE
- **版本库状态：** COMMITTED
- **内容基线提交：** `30e146cb2cbb64c04f08eae1653e2484c7b9bf8f`
- **激活提交：** `e7c0f510a8c642b57528e511167a5fb4171fad4c`
- **生效日期：** 2026-08-24
- **负责人上下文：** 独立开发者兼产品负责人
- **权威范围：** 产品形态、Commercial MVP IN/OUT、六个 Slice、产品结果、当前推进顺序与产品验收
- **不覆盖：** A1/A2/A3/B/C 冻结语义、冻结迁移、Slice 级详细合同

## 1. 基线决议

GEO OS 是面向受控第三方使用的 B2B 多租户 GEO 决策与优化工作系统。Commercial MVP 必须具备完整产品主链代码能力，并以一个锚点行业的正式最小规则包完成客户级交付。

实施原则为：

> 冻结跨模块结构、业务语义和历史事实边界；按 Slice 完成页面、API、领域、数据和测试的垂直闭环；模块内部字段、行业内容和高级基础设施在进入对应阶段时版本化完善。

这不允许用假数据、演示报告或单独存在的表、类、API、页面代替真实产品能力，也不要求在开发前一次设计未来所有对象和基础设施。

## 2. 产品形态与商业边界

首期产品流程为：

```text
平台受控开通 Tenant Workspace
→ 第三方管理自己的成员、客户、品牌和项目
→ 配置问题与监测计划
→ 在获得授权的真实 AI 产品端面执行问题
→ 捕获不可变观测与证据
→ 评估、复核、决议与测量
→ 形成诊断、策略和干预
→ 复测、效果验证与阶段报告
```

### 2.1 V1 范围内

- 平台受控开通 Tenant；
- Tenant 管理本机构成员及自己的 Customer、Brand、Project；
- Tenant 隔离和不可枚举性；
- 问题、监测、真实执行、不可变观测和证据回看；
- Assessment、Review、Resolution、MetricContribution 和 MeasurementSnapshot；
- Citation/Source 分层、首行业正式 KPI；
- 最小 GEO Intelligence、Intervention、Retest 和 Effect Validation；
- 可复现、可追踪、带限制说明的 ReportRelease。

### 2.2 V1 明确不做

- 自助注册；
- 代理商父子层级；
- 白标、计费、分佣；
- 开放 API 产品；
- Publisher Worker 自动代发；
- 动态低代码规则平台；
- 大规模自动策略生成与自动执行；
- 严格因果归因和跨渠道归因；
- 高级跨客户 Benchmark 产品。

全局规范身份可以存在，但跨 Tenant 的证据、关系、可见性和使用上下文不得暴露。

## 3. 完整业务链与所有权

```text
Tenant / Customer / Brand / Project
→ Demand / Question
→ Monitoring / Sampling
→ Query Execution
→ Observation
→ Assessment / Review / Resolution
→ Citation / Source Qualification and Resolution（按指标需要）
→ MetricContribution
→ MeasurementSnapshot
→ GEO Intelligence
→ Intervention
→ Retest / Effect Validation
→ ReportRelease
```

固定所有权链为：

```text
Tenant → Customer → Brand → Project
```

`OptimizationCycle` 是 Project 内的运营编排与交付周期，不是事实所有权根。它可以引用事实和发布物，但暂停、结束或归档 Cycle 不能改变 Execution、Observation、Resolution、Snapshot 或 Report 的 Project 归属，也不能破坏跨 Cycle 的复测和历史趋势。

## 4. Commercial MVP 的六个垂直 Slice

| Slice                  | 产品结果                                                                                 | 产品验收边界                                                                        | 当前状态                                                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 1 Workspace 与项目建档 | 第三方在隔离空间管理成员、客户、品牌、项目和默认 Binding                                 | 页面、API、领域、数据和隔离验收形成闭环                                             | 数据、关系命令和 DDL 已冻结；UI 未实现，产品未完整验收                                                                   |
| 2 真实查询与不可变观测 | 问题版本经真实 AI 端执行，形成可追踪、可纠错的不可变 Observation                         | 可从操作界面下钻 Execution、错误、原始回答、截图、Candidate、Observation 和实际版本 | DDL/关系命令已冻结；豆包 Web 和 Core-bound 实现已提交并通过合同验证；持久调度、正式 A1、真实 Core-bound 运行和 UI 未完成 |
| 3 决议、测量与基础报告 | Resolution 形成 MetricContribution 和固定 Snapshot，指定 Snapshot 可重复生成相同基础报告 | 当前配置变化不改写历史，错误通过 Replacement/新 Release 处理                        | 仅跨模块语义已定义，产品能力未实现                                                                                       |
| 4 首行业正式语义与 KPI | Pack B/C、Citation/Source 和首行业指标形成正式客户报告                                   | 指标有资格、证据、口径和实际 Release 说明                                           | 对象边界已定义，行业、Schema、实现和验收未完成                                                                           |
| 5 GEO Intelligence     | 从 Snapshot 形成可解释 Gap、Hypothesis 和 StrategyAction                                 | 每项诊断和建议可追溯到 Snapshot、证据和规则版本                                     | 对象边界已定义，未实现                                                                                                   |
| 6 干预与效果验证       | 记录行动、复测、可比性、变化和限制，发布更新报告                                         | 区分变化、相关性、贡献判断和因果结论                                                | 对象边界已定义，未实现                                                                                                   |

详细实现证据以 [`product-implementation-status.yaml`](../product-implementation-status.yaml) 为准。任何 Slice 都不得用单一“完成”标签掩盖 UI、集成或产品验收缺口。

## 5. Slice 2 的正式产品语义

Slice 2 覆盖 Demand、Monitoring、Execution 与 Observation，不是归因和策略子域。

每次真实重试创建新的 `ExecutionRun`，并递增 `attempt_no`；重试不新增 `SampleSlot`，也不存在独立的 `execution_attempt` 业务对象或表。队列投递次数仅属于基础设施元数据。

Execution 终态与 Observation 存在性是两件事：

```text
ExecutionRun = FAILED
不等于
不存在 RawObservation
```

例如可见回答已经出现并形成 Candidate，随后平台超时，则 ExecutionRun 可以最终为 `FAILED`，并在进入终态后 Finalize RawObservation。只有没有满足 A1 的用户可见响应事实时，才不产生 RawObservation。

## 6. 产品角色与界面对象

首期 GEO OS 界面是面向 Tenant 操作人员及获授权项目成员的桌面工作台，不把外部豆包页面视为 GEO OS 前端，也不预设独立 Customer 门户。

权限分层为：

```text
平台固定角色
Tenant 固定角色
Project Membership / Assignment
产品人物画像
系统服务身份
```

V1 固定角色保持 `PLATFORM_ADMIN`、`TENANT_ADMIN`、`TENANT_MEMBER`。项目负责人、GEO 优化师、Reviewer 和内容操作人员属于项目级授权或任务分配；`SYSTEM_WORKER` 属于服务身份。客户直接登录及 `CLIENT_READONLY` 在 Report 交付形态确定时再决议。

## 7. 当前真实推进状态

截至 2026-08-24：

- `0001/0002` 为正式冻结数据库基线，任何新结构从 `0003+` 开始；
- Slice 1 和 Slice 2 数据及关系命令基线已冻结；
- 豆包 Web Golden Query 和确定性浏览器合同已通过；
- Execution-scoped Core-bound 主链已通过相关测试，并由提交 `f8b2c38` 和 `3a980cd` 形成可引用 Git 基线；
- GEO OS 自身前端不存在；
- 六份 V1.1 是 REVIEW CANDIDATE，尚未完成标准 DOCX 渲染 QA；
- Slice 2 产品整体未完成，Slice 3—6 未实现。

## 8. 下一条垂直产品链

规范对齐退出后，立即推进：

```text
持久调度与恢复
→ 真实 Core-bound 豆包执行
→ 版本化正式 A1 Detector
→ Project / Question / Execution / Observation 查询 API
→ Tenant 操作人员与获授权项目成员检查界面
→ 证据下钻、错误、重试和异常展示
→ 自动化合同与界面验收
```

页面最小验收必须证明：

1. 操作人员可在自己的 Tenant/Project 中查看 QuestionVersion、SampleSlot 和每次 ExecutionRun；
2. 重试不会增加统计样本 N；
3. 可查看运行状态、实际平台/模型披露、失败类型和时间线；
4. 可下钻原始回答、截图、HTML/Manifest 证据、大小和 SHA-256；
5. 可区分 Candidate 首次检测事实与 RawObservation 最终响应窗口；
6. FAILED 但存在有效可见响应的运行仍可显示并访问其 RawObservation；
7. 人工验证、登录失效、页面漂移和服务错误不会显示为 AI 回答；
8. Tenant A 无法发现 Tenant B 的项目、运行、证据或对象存在性。

## 9. 规范对齐退出条件

满足以下条件即结束规范暂停并恢复开发：

1. 文档状态、权威领域和替代关系索引完成；
2. Slice 2 已知业务冲突完成纠正或明确勘误；
3. 产品 IN/OUT 与六个 Slice 完成确认；
4. 核心对象、状态、权限和 Release 命名统一；
5. Resolution—MetricContribution—Snapshot—Report 跨模块主合同完成；
6. Citation/Source 分层与 Pack C 对齐；
7. 实现状态矩阵与仓库真实状态一致；
8. 模块边界、内部命令、异步语义、大证据传输和错误分类形成可执行约束；
9. 下一条垂直链及页面验收标准明确。

完成上述事项后不得继续横向扩展治理文档。
