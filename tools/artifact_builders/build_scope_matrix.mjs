import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..", "..");
const require = createRequire(import.meta.url);
const moduleSearchPaths = process.env.GEO_OS_NODE_MODULES
  ? [path.resolve(process.env.GEO_OS_NODE_MODULES)]
  : [scriptDir, repoRoot];
const artifactToolEntry = require.resolve("@oai/artifact-tool", { paths: moduleSearchPaths });
const { SpreadsheetFile, Workbook } = await import(pathToFileURL(artifactToolEntry).href);
const outputDir = path.join(repoRoot, "outputs", "g0-01");
const previewDir = process.env.GEO_OS_QA_OUTPUT_DIR ?? path.join(repoRoot, ".build", "artifact-previews", "g0-01");
const outputPath = process.env.GEO_OS_ARTIFACT_OUTPUT ?? path.join(outputDir, "GEO_OS_G0-01_Scope_Matrix_V1.0.xlsx");

const colors = {
  navy: "#0B2545",
  blue: "#2E74B5",
  green: "#2F6B45",
  greenFill: "#E8F3EC",
  amber: "#9A6700",
  amberFill: "#FFF4CE",
  red: "#9B1C1C",
  redFill: "#FDECEC",
  gray: "#667085",
  line: "#D0D5DD",
  header: "#E8EEF5",
  light: "#F7F9FC",
  white: "#FFFFFF",
};

const scopeRows = [
  ["MOD-01", "MODULE", "Platform", "IAM & Tenant", "IN", "MVP-0 FOUNDATION", "Gate 0 / Foundation", "Technical structure", "Technical Architecture Reconciliation V1.1", "G0-02 Domain Contract + ADR/API/Schema", "受控开通 Tenant；成员、角色和租户上下文可执行；跨租户访问被拒绝并留审计。", "Platform & Security Lead", "TBD before G0-01 close", "G0-02", "不包含自助注册、代理层级、白标、计费和开放 API。"],
  ["MOD-02", "MODULE", "Core Platform", "Customer / Brand / Project", "IN", "MVP-1 WALKING SKELETON", "Walking Skeleton", "MVP scope & acceptance", "GEO_OS_需求方案定稿版_V1.0", "Technical Architecture V1.1 + Domain Contract", "Tenant Admin 可创建自有 Customer、Brand、Project；对象归属固定且可审计。", "Core Domain Lead", "TBD before G0-01 close", "G0-02", "Project Policy Binding 只提供默认值。"],
  ["MOD-03", "MODULE", "Contracts", "Contract & Policy Release", "IN", "MVP-0 FOUNDATION", "Gate 0 / Foundation", "Technical structure", "Technical Architecture Reconciliation V1.1", "ADR-008 + Policy Manifest Schema", "PolicyDefinition、不可变 PolicyRelease 与实际执行绑定可复现；V1 不建设低代码规则平台。", "Domain Architecture Lead", "TBD before G0-01 close", "G0-04/G0-06", "Execution、Assessment、Resolution、Snapshot 各自保存实际 policy_release_id。"],
  ["MOD-04", "MODULE", "Demand", "Demand & Question", "IN", "MVP-1 WALKING SKELETON", "Walking Skeleton", "MVP scope & acceptance", "GEO_OS_需求方案定稿版_V1.0", "A1 + QuestionVersion Contract", "至少支持不可变 QuestionVersion、SampleSlot 关联和首行业最小问题分类。", "Demand Domain Lead", "TBD before G0-01 close", "G0-03", "完整需求智能在 MVP-2 扩展。"],
  ["MOD-05", "MODULE", "Knowledge", "Brand Truth & Evidence", "IN", "MVP-2 COMMERCIAL COMPLETE", "Semantic Expansion", "Commercial direction", "GEO_OS_产品方案定稿版_V1.0", "Domain Contract + Evidence API", "支持最小 Target/Brand Truth 证据版本供 Pack B 使用；完整知识治理后续补齐。", "Knowledge Domain Lead", "TBD before G0-01 close", "Pack B", "Walking Skeleton 不依赖完整 Brand Truth 平台。"],
  ["MOD-06", "MODULE", "Monitoring", "Monitoring & Sampling", "IN", "MVP-1 WALKING SKELETON", "Walking Skeleton", "MVP scope & acceptance", "GEO_OS_需求方案定稿版_V1.0", "Sampling Contract + Scheduler", "QuestionVersion 产生可追踪 SampleSlot；重试不增加 Sample N；计划与执行分离。", "Monitoring Lead", "TBD before G0-01 close", "G0-05", "首阶段只支持最小调度能力。"],
  ["MOD-07", "MODULE", "Execution", "Query Execution", "IN", "MVP-1 WALKING SKELETON", "Walking Skeleton", "Technical structure", "GEO_OS_技术方案定稿版_V1.0", "A1 + Execution API/Event", "ExecutionRun 保存实际上下文、状态、幂等键与证据引用；失败不自动形成观测。", "Query Platform Lead", "TBD before G0-01 close", "G0-03/G0-05", "Real AI Query Engine 只负责执行与捕获事实。"],
  ["MOD-08", "MODULE", "Observation", "Observation Capture", "IN", "MVP-1 WALKING SKELETON", "Walking Skeleton", "Domain semantics", "Decision Pack A1/A2/A3", "Observation State Machine + DDL + Contract Tests", "实现 CAPTURING→FINALIZING→FINALIZED；原始事实不可原地修改，错误通过 CorrectionRecord 处理。", "Observation Domain Lead", "TBD before G0-01 close", "G0-03", "不得静默重分类或硬删除。"],
  ["MOD-09", "MODULE", "Decisioning", "Assessment / Review / Resolution", "IN", "MVP-1 WALKING SKELETON", "Walking Skeleton", "Domain semantics", "Decision Pack A2/A3/B/C", "ADR-005 + Envelope Schema", "通用 Envelope 与领域 Payload 分离；append-only Assessment/Review；Resolution 可确定复现。", "Assessment Domain Lead", "TBD before G0-01 close", "G0-04", "禁止万能业务大表与 global latest wins。"],
  ["MOD-10", "MODULE", "Measurement", "Measurement & Snapshot", "IN", "MVP-1 WALKING SKELETON", "Walking Skeleton", "Domain semantics", "Decision Pack A2/A3", "ADR-007 + Snapshot ERD/DDL", "Snapshot 冻结 Observation/Metric 两层 Membership、实际 Resolution Provenance 与实际 Policy Release。", "Measurement Lead", "TBD before G0-01 close", "G0-06", "Walking Skeleton 使用非客户测试指标或冻结的 ANSWER_OUTCOME。"],
  ["MOD-11", "MODULE", "Citation", "Citation & Source", "IN", "MVP-2 COMMERCIAL COMPLETE", "Semantic Expansion", "Domain semantics", "Decision Pack C", "Citation/Source Domain Contract + API", "实现 Occurrence、Qualification、LogicalCitation、SourceBinding、Resolution 分层及 Citation Presence 最小链路。", "Citation & Source Lead", "TBD before G0-01 close", "Pack C / G0-02", "不得退化为扁平 URL 数组。"],
  ["MOD-12", "MODULE", "Intelligence", "GEO Intelligence", "DEFERRED", "MVP-2 COMMERCIAL COMPLETE", "Post Walking Skeleton", "Commercial direction", "GEO_OS_产品方案定稿版_V1.0", "Open Decision OD-G01-002", "先消费冻结 Snapshot；策略建议的正式客户验收边界在 G0-01 评审前确认。", "Product Intelligence Lead", "TBD before G0-01 close", "OD-G01-002", "不阻塞基础设施和 Walking Skeleton。"],
  ["MOD-13", "MODULE", "Intervention", "Intervention & Effect Validation", "DEFERRED", "MVP-2 COMMERCIAL COMPLETE", "Post Walking Skeleton", "Commercial direction", "GEO_OS_产品方案定稿版_V1.0", "Open Decision OD-G01-003", "明确干预目录、版本化执行、前后 Snapshot 对比和最小验收边界后进入实现。", "Intervention Lead", "TBD before G0-01 close", "OD-G01-003", "不提前冻结复杂策略规则。"],
  ["MOD-14", "MODULE", "Delivery", "Report & Delivery", "IN", "MVP-1 WALKING SKELETON", "Walking Skeleton", "MVP scope & acceptance", "GEO_OS_需求方案定稿版_V1.0", "Snapshot Consumer Contract", "Basic Report 只读取指定 Snapshot 并可重复交付；正式客户 KPI 在语义准入后开放。", "Delivery Lead", "TBD before G0-01 close", "G0-06 / OD-G01-006", "不得在前端重算正式指标。"],
  ["MOD-15", "MODULE", "Operations", "Resource / Cost / Audit", "IN", "MVP-0 FOUNDATION", "Foundation", "Technical structure", "GEO_OS_技术方案定稿版_V1.0", "Audit/Event/Cost Schema", "关键操作、模型调用、执行成本和管理员跨租户访问均可追踪；经营分析延后。", "Platform Operations Lead", "TBD before G0-01 close", "G0-02/G0-05", "Redis 不保存唯一业务事实。"],
  ["X-01", "CROSS-CUTTING", "Security", "Tenant Isolation", "IN", "MVP-0 FOUNDATION", "Gate 0 / Foundation", "Technical structure", "Technical Architecture Reconciliation V1.1", "G0-02 ADR + Isolation Contract Tests", "API、查询、唯一约束、缓存键、对象路径和队列载荷均声明 tenant scope。", "Platform & Security Lead", "TBD before G0-01 close", "G0-02", "第三方仅管理自有客户。"],
  ["X-02", "CROSS-CUTTING", "Identity", "GLOBAL_IDENTITY_WITH_TENANT_CONTEXT", "IN", "MVP-0 FOUNDATION", "Gate 0 / Foundation", "Technical structure", "Technical Architecture Reconciliation V1.1", "Ownership Matrix + Hidden Directory Authorization", "全局目录不直接向租户暴露；Evidence/Binding/Relationship/Projection 通过租户上下文授权。", "Data Architecture Lead", "TBD before G0-01 close", "G0-02", "跨租户可去重但不得信息侧漏。"],
  ["X-03", "CROSS-CUTTING", "Security", "Authentication & RBAC", "IN", "MVP-0 FOUNDATION", "Foundation", "MVP scope & acceptance", "GEO_OS_需求方案定稿版_V1.0", "IAM Contract + Authorization Tests", "平台管理员、Tenant Admin、成员和客户只读角色具备明确权限边界。", "Platform & Security Lead", "TBD before G0-01 close", "G0-02", "不以 UUID 难猜代替授权。"],
  ["X-04", "CROSS-CUTTING", "Governance", "Auditability", "IN", "MVP-0 FOUNDATION", "Foundation", "Technical structure", "GEO_OS_技术方案定稿版_V1.0", "Audit Event Schema", "敏感访问与状态变更记录 actor、reason、target、tenant、trace 与时间。", "Platform Operations Lead", "TBD before G0-01 close", "G0-02/G0-05", "审计记录不可依赖应用日志替代。"],
  ["X-05", "CROSS-CUTTING", "Observation", "Immutable Fact Lifecycle", "IN", "MVP-0 FOUNDATION", "Gate 0 / Foundation", "Domain semantics", "Decision Pack A1/A3", "G0-03 State Machine + DDL", "Finalization 原子且幂等；FINALIZED 事实拒绝原地 UPDATE。", "Observation Domain Lead", "TBD before G0-01 close", "G0-03", "Correction 与 Projection 不修改事实层。"],
  ["X-06", "CROSS-CUTTING", "Decisioning", "Resolution Protocol", "IN", "MVP-0 FOUNDATION", "Gate 0 / Foundation", "Domain semantics", "Decision Pack A2/A3/B/C", "G0-04 Envelope + Resolution Tests", "粒度、上下文、证据优先级和冲突状态均可复现。", "Assessment Domain Lead", "TBD before G0-01 close", "G0-04", "领域 Payload 保持专用。"],
  ["X-07", "CROSS-CUTTING", "Reliability", "Outbox / Inbox / Idempotency", "IN", "MVP-0 FOUNDATION", "Gate 0 / Foundation", "Technical structure", "Technical Architecture Reconciliation V1.1", "G0-05 Event Contract + Failure Matrix", "业务状态与 Outbox 同事务；重复投递/消费不产生重复事实；重试和租约可恢复。", "Platform Reliability Lead", "TBD before G0-01 close", "G0-05", "BullMQ/Redis 不是事实来源。"],
  ["X-08", "CROSS-CUTTING", "Measurement", "Snapshot Contract", "IN", "MVP-0 FOUNDATION", "Gate 0 / Foundation", "Domain semantics", "Decision Pack A3", "G0-06 Membership + Replacement Contract", "Snapshot 生命周期与完整性正交；错误通过显式 Replacement 链处理。", "Measurement Lead", "TBD before G0-01 close", "G0-06", "Report 永久绑定交付时 Snapshot ID。"],
  ["X-09", "CROSS-CUTTING", "Contracts", "Actual Policy Release Binding", "IN", "MVP-0 FOUNDATION", "Gate 0 / Foundation", "Technical structure", "Technical Architecture Reconciliation V1.1", "ADR-008 + Binding Contract Tests", "项目默认配置变化不得改写历史 Execution/Assessment/Resolution/Snapshot。", "Domain Architecture Lead", "TBD before G0-01 close", "G0-04/G0-06", "实际使用版本必须落库。"],
  ["X-10", "CROSS-CUTTING", "Infrastructure", "Object Storage", "IN", "MVP-0 FOUNDATION", "Foundation", "Technical structure", "GEO_OS_技术方案定稿版_V1.0", "Storage Contract + Integrity Checks", "大对象证据按 tenant/context 路径与 hash 管理；数据库保存不可丢失引用。", "Platform Infrastructure Lead", "TBD before G0-01 close", "G0-02/G0-03", "对象上传与 Finalization 失败可恢复。"],
  ["X-11", "CROSS-CUTTING", "Operations", "Observability & Trace Context", "IN", "MVP-0 FOUNDATION", "Foundation", "Technical structure", "GEO_OS_技术方案定稿版_V1.0", "Trace/Log/Event Correlation Contract", "请求、任务、事件和模型调用共享 correlation_id/trace_id 并支持租户级排障。", "Platform Reliability Lead", "TBD before G0-01 close", "G0-05", "日志不得泄漏跨租户数据。"],
  ["X-12", "CROSS-CUTTING", "Engineering", "Monorepo / CI / Contract Tests", "IN", "MVP-0 FOUNDATION", "Foundation", "Technical structure", "Technical Architecture Reconciliation V1.1", "Repository Skeleton + CI", "TypeScript/Python 工程规范、Lint、单元/集成/契约测试和迁移检查可自动执行。", "Engineering Enablement Lead", "TBD before G0-01 close", "G0-01", "非争议部分允许并行启动。"],
  ["X-13", "CROSS-CUTTING", "Data", "Database Migrations & Constraints", "IN", "MVP-0 FOUNDATION", "Foundation", "Engineering implementation", "ADR / Domain Contract", "Migration + Schema Tests", "所有 Schema 变更通过迁移；跨租户、幂等、版本与不可变约束有数据库级防线。", "Data Architecture Lead", "TBD before G0-01 close", "G0-02~G0-06", "Gate 未关闭前不冻结最终核心表。"],
  ["X-14", "CROSS-CUTTING", "Governance", "Contract Traceability", "IN", "MVP-0 FOUNDATION", "Gate 0 / Continuous", "Engineering implementation", "Technical Architecture Reconciliation V1.1", "Traceability Matrix + Contract Test IDs", "正式交付规则可定位到对象、Schema/API/Event、代码和测试；随模块持续补齐。", "Architecture Governance Lead", "TBD before G0-01 close", "G0-01", "无需开工前一次填满全部规则。"],
  ["X-15", "CROSS-CUTTING", "Industry", "Industry Extension Interface", "IN", "MVP-1 WALKING SKELETON", "Architecture Extension", "Technical structure", "Technical Architecture Reconciliation V1.1", "Version Reference + No-hardcode Tests", "通用模型禁止行业字段硬编码；Project 可引用首行业规则版本。", "Domain Architecture Lead", "TBD before G0-01 close", "P0", "完整 IndustryPolicyPack 在第二行业前冻结。"],
  ["X-16", "CROSS-CUTTING", "Commercial", "Third-party Tenant Workspace", "IN", "MVP-2 COMMERCIAL COMPLETE", "Commercial Enablement", "Commercial direction", "冻结注释 FZ-01", "Tenant Workspace Acceptance Tests", "平台受控开通第三方 Tenant；第三方管理本机构成员和自有客户。", "Product Owner", "TBD before G0-01 close", "G0-02", "不包含代理父子层级、白标、计费、自助注册和开放 API。"],
  ["X-17", "CROSS-CUTTING", "Commercial", "Self-service / Agency Hierarchy / White-label / Billing / Open API", "OUT", "POST-MVP", "Not in V1", "Commercial direction", "GEO_OS_产品方案定稿版_V1.0", "Future Scope Change Request", "V1 不实现；任何提前引入必须作为 MVP 范围变更审批。", "Product Owner", "TBD before G0-01 close", "Change Control", "Tenant Isolation 不等于开放代理商平台。"],
  ["X-18", "CROSS-CUTTING", "Rules", "Dynamic Low-code Policy Platform", "OUT", "POST-MVP", "Not in V1", "Technical structure", "Technical Architecture Reconciliation V1.1", "Future Architecture ADR", "V1 采用版本化 Manifest、不可变 Release 和代码 Evaluator。", "Domain Architecture Lead", "TBD before G0-01 close", "Change Control", "确有运营动态配置需求后再评估。"],
  ["X-19", "CROSS-CUTTING", "Measurement", "Formal Customer Mention / Recommendation / Citation KPI", "DEFERRED", "MVP-2 COMMERCIAL COMPLETE", "After semantic gates", "Domain semantics", "Decision Pack B/C", "OD-G01-006 + KPI Contract", "Pack B/C、Coverage Context、资格与贡献规则冻结并通过契约测试后才开放客户指标。", "Measurement Lead", "TBD before G0-01 close", "OD-G01-006", "Basic Report 阶段禁止提前输出。"],
  ["X-20", "CROSS-CUTTING", "Industry", "Full Multi-industry Policy Pack", "DEFERRED", "POST-MVP", "Before second industry", "Commercial direction", "Technical Architecture Reconciliation V1.1", "IndustryPolicyPack ADR", "第二行业正式实现前冻结依赖、兼容、发布、迁移、停用和回滚机制。", "Domain Architecture Lead", "TBD before G0-01 close", "P1", "首行业 + 影子行业先验证无硬编码。"],
  ["RUN-01", "RUNTIME", "Execution", "Real AI Query Engine", "IN", "MVP-1 WALKING SKELETON", "Walking Skeleton", "Technical structure", "GEO_OS_技术方案定稿版_V1.0", "Execution Contract", "独立运行单元负责资源分配、真实端执行、响应检测、捕获与执行证据。", "Query Platform Lead", "TBD before G0-01 close", "MOD-07", "不得决定正式语义 KPI。"],
  ["RUN-02", "RUNTIME", "Processing", "AI/Data Worker", "IN", "MVP-1 WALKING SKELETON", "Walking Skeleton", "Technical structure", "GEO_OS_技术方案定稿版_V1.0", "Worker Command/Event Contract", "异步完成抽取、分类、Assessment/Resolution 辅助、Measurement 和报告任务。", "Data Processing Lead", "TBD before G0-01 close", "G0-04/G0-05", "不得覆盖 RawObservation。"],
  ["RUN-03", "RUNTIME", "Models", "Model Gateway", "IN", "MVP-0 FOUNDATION", "Foundation", "Technical structure", "GEO_OS_技术方案定稿版_V1.0", "Model Invocation Contract", "记录模型、Prompt/配置版本、成本和调用追踪；不替代真实 Surface 观测。", "Model Platform Lead", "TBD before G0-01 close", "X-11", "输出仅作为 Assessment Evidence。"],
  ["RUN-04", "RUNTIME", "Publishing", "Publisher Worker", "DEFERRED", "MVP-2 COMMERCIAL COMPLETE", "Post Walking Skeleton", "Technical structure", "GEO_OS_技术方案定稿版_V1.0", "OD-G01-004", "明确后续发布适配器与人工辅助流程是否属于 Commercial MVP。", "Publishing Lead", "TBD before G0-01 close", "OD-G01-004", "V1 不形成独立架构门禁。"],
];

const authorityRows = [
  ["Commercial direction", "GEO_OS_业务背景定稿版_V1.0 / GEO_OS_产品方案定稿版_V1.0", "商业目标、目标客户、产品边界、商业模式和路线方向", "同一领域内：正式冻结 > 草案；范围更具体 > 一般；显式替代的新版本 > 旧版本。", "冲突无法消解时提交 MVP Scope Change Request。"],
  ["MVP scope & acceptance", "GEO_OS_需求方案定稿版_V1.0", "IN/OUT、优先级、角色权限、功能验收和非功能验收", "需求方案不得修改 A/B/C 领域语义；语义变化必须进入领域契约变更。", "更新 Scope Matrix、验收 ID 和 Traceability。"],
  ["Domain semantics", "Decision Pack A1/A2/A3/B/C 最终冻结版", "Observation、Validity、Eligibility、Mention、Recommendation、Citation、Review、Snapshot 等语义", "最终冻结且更具体的决议优先；技术实现不得以既有代码惯例覆盖冻结语义。", "Breaking Contract Change + 领域批准。"],
  ["Technical structure", "Technical Architecture Reconciliation V1.1 / GEO_OS_技术方案定稿版_V1.0", "模块边界、运行单元、存储、事件、可靠性、安全和基础设施", "V1.1 对当前工程边界负责；技术方案提供上位技术背景。", "形成或升级 Architecture ADR。"],
  ["Engineering implementation", "Domain Contract / ADR / API / Schema / Event Contract / Migration / Contract Test", "可执行工程实现与版本", "必须证明对上位 Scope、领域语义和技术结构的实现，不得反向改写上位决策。", "PR 需要 Traceability 与契约测试。"],
];

const workflowRows = [
  [1, "Change Request", "提交问题、动机、拟议变化、受影响对象和期望时间。", "Request ID + 初始证据", "Requester / PM"],
  [2, "Classification", "分类为编辑性、兼容性新增、破坏性契约变更或 MVP 范围变更。", "Change Class", "Architecture Governance"],
  [3, "Impact Assessment", "评估 Scope、领域语义、API/Schema/Event、数据迁移、历史复现、安全、测试和交付影响。", "Impact Report", "Domain + Technical Owners"],
  [4, "Approval", "按决策领域路由至产品、领域、技术或项目批准人；破坏性和范围变更不得由单一开发者批准。", "Approval Record", "Designated Approver"],
  [5, "Version Upgrade", "按分类升级文档、Contract、API/Schema/Event 和 Policy Release 版本。", "Versioned Artifacts", "Artifact Owners"],
  [6, "Traceability Update", "更新 Scope Matrix、ADR、Rule→Object→Schema/API/Event→Code→Test 映射和 Open Decision。", "Updated Traceability", "Architecture Governance + QA"],
  [7, "Release", "通过迁移、兼容、回归、契约和回滚检查后发布，并保留 Release Record。", "Release Record", "Release Owner"],
];

const changeTypeRows = [
  ["EDITORIAL", "编辑性", "不改变语义、范围、字段含义或行为的文字/排版修正。", "Patch", "文档 Owner", "基础校对；引用/ID 未变化时可不重跑全量契约测试。"],
  ["COMPATIBLE_ADDITION", "兼容性新增", "新增可选字段、可选状态、兼容 API 或不影响旧消费者的新能力。", "Minor", "领域 Owner + 技术 Owner", "向后兼容测试、默认行为、Schema/API/Event 版本与 Traceability。"],
  ["BREAKING_CONTRACT", "破坏性契约变更", "改变已有语义、必填字段、状态机、唯一约束、历史复现或消费者行为。", "Major", "领域批准人 + 架构批准人", "迁移/双读写/回滚方案、历史影响、完整契约回归；必要时重开相关 Gate。"],
  ["MVP_SCOPE_CHANGE", "MVP 范围变更", "改变 IN/OUT/DEFERRED、MVP 等级、验收边界、第三方能力或正式 KPI 准入。", "Scope Baseline Version", "Product Sponsor + Project Manager", "商业影响、排期/成本、依赖、验收、风险和 Scope Matrix 全量更新。"],
];

const openDecisionRows = [
  ["OD-G01-001", "为全部 Scope Matrix 行指定具名负责人和替补负责人。", "MVP_SCOPE_CHANGE", "ALL", "Project Manager / Sponsor", new Date("2026-08-25T00:00:00+08:00"), "OPEN", "Named Owner columns completed", "当前仅填 Owner Role，未达到关闭条件。"],
  ["OD-G01-002", "确认 GEO Intelligence 正式策略输出是否属于 Commercial MVP，以及最小验收口径。", "MVP_SCOPE_CHANGE", "MOD-12", "Product Owner", new Date("2026-08-26T00:00:00+08:00"), "OPEN", "Scope decision + acceptance update", "不阻塞 Walking Skeleton。"],
  ["OD-G01-003", "确认 Intervention 与 Effect Validation 的 Commercial MVP 边界。", "MVP_SCOPE_CHANGE", "MOD-13", "Product Owner + Domain Architect", new Date("2026-08-27T00:00:00+08:00"), "OPEN", "Versioned intervention acceptance contract", "需区分代码能力完成与行业策略完善。"],
  ["OD-G01-004", "确认 Publisher Worker 在 V1 中的状态：DEFERRED 或 MVP-2。", "MVP_SCOPE_CHANGE", "RUN-04", "Technical Architect + Product Owner", new Date("2026-08-25T00:00:00+08:00"), "OPEN", "Runtime scope ADR", "当前不作为独立 Gate。"],
  ["OD-G01-005", "完成需求方案章节到 Scope ID、Acceptance ID 和 Contract Test ID 的覆盖核对。", "COMPATIBLE_ADDITION", "ALL", "Business Analyst + QA Lead", new Date("2026-08-28T00:00:00+08:00"), "OPEN", "Requirements coverage report", "用于证明没有模块或验收遗漏。"],
  ["OD-G01-006", "冻结正式客户 Mention/Recommendation/Citation KPI 的准入条件。", "BREAKING_CONTRACT", "X-19/MOD-14", "Measurement Lead + Product Owner", new Date("2026-08-27T00:00:00+08:00"), "OPEN", "KPI entry ADR + Pack B/C traceability", "Basic Report 在此之前只验证 Snapshot 消费。"],
];

function styleTitle(sheet, range, subtitleRange, text, subtitle) {
  range.merge();
  range.values = [[text]];
  range.format = {
    fill: colors.navy,
    font: { name: "Calibri", size: 20, bold: true, color: colors.white },
    verticalAlignment: "center",
    horizontalAlignment: "left",
  };
  range.format.rowHeight = 34;
  const sub = sheet.getRange(subtitleRange);
  sub.merge();
  sub.values = [[subtitle]];
  sub.format = {
    fill: colors.header,
    font: { name: "Calibri", size: 10, color: colors.navy },
    verticalAlignment: "center",
    horizontalAlignment: "left",
  };
  sub.format.rowHeight = 24;
}

function styleHeader(range) {
  range.format = {
    fill: colors.header,
    font: { name: "Calibri", size: 9, bold: true, color: colors.navy },
    borders: { preset: "all", style: "thin", color: colors.line },
    wrapText: true,
    verticalAlignment: "center",
    horizontalAlignment: "center",
  };
  range.format.rowHeight = 34;
}

function styleBody(range, fontSize = 9) {
  range.format = {
    font: { name: "Calibri", size: fontSize, color: "#1F2937" },
    borders: { preset: "all", style: "thin", color: colors.line },
    wrapText: true,
    verticalAlignment: "center",
    horizontalAlignment: "left",
  };
}

function addStatusFormatting(range) {
  range.conditionalFormats.add("containsText", { text: "IN", format: { fill: colors.greenFill, font: { bold: true, color: colors.green } } });
  range.conditionalFormats.add("containsText", { text: "OUT", format: { fill: colors.redFill, font: { bold: true, color: colors.red } } });
  range.conditionalFormats.add("containsText", { text: "DEFERRED", format: { fill: colors.amberFill, font: { bold: true, color: colors.amber } } });
}

const workbook = Workbook.create();

const scope = workbook.worksheets.add("Scope Matrix");
scope.showGridLines = false;
styleTitle(scope, scope.getRange("A1:O1"), "A2:O2", "GEO OS · G0-01 Scope Matrix V1.0", "Gate 状态：OPEN / PENDING REVIEW · Scope、MVP、权威来源、验收与负责人矩阵");
scope.getRange("A3:O3").merge();
scope.getRange("A3").values = [["关闭规则：只有全部范围项具备决策、验收、具名负责人，且 Open Decisions 清零后，才可提交 G0-01 CLOSED 审批。"]];
scope.getRange("A3:O3").format = { fill: colors.amberFill, font: { bold: true, color: colors.amber }, wrapText: true, verticalAlignment: "center" };
scope.getRange("A3:O3").format.rowHeight = 28;
const scopeHeaders = [["Scope ID", "Type", "Domain", "Capability / Module", "Scope Decision", "MVP Level", "Delivery Phase", "Authority Domain", "Primary Authority", "Implementation Authority", "Acceptance Criteria", "Owner Role", "Named Owner", "Gate / Dependency", "Notes / Limitation"]];
scope.getRange("A5:O5").values = scopeHeaders;
scope.getRange(`A6:O${5 + scopeRows.length}`).values = scopeRows;
styleHeader(scope.getRange("A5:O5"));
styleBody(scope.getRange(`A6:O${5 + scopeRows.length}`), 9);
scope.getRange(`A6:O${5 + scopeRows.length}`).format.rowHeight = 56;
scope.getRange(`E6:E${5 + scopeRows.length}`).dataValidation = { rule: { type: "list", values: ["IN", "OUT", "DEFERRED"] } };
scope.getRange(`F6:F${5 + scopeRows.length}`).dataValidation = { rule: { type: "list", values: ["MVP-0 FOUNDATION", "MVP-1 WALKING SKELETON", "MVP-2 COMMERCIAL COMPLETE", "POST-MVP"] } };
addStatusFormatting(scope.getRange(`E6:E${5 + scopeRows.length}`));
scope.getRange(`M6:M${5 + scopeRows.length}`).conditionalFormats.add("containsText", { text: "TBD", format: { fill: colors.amberFill, font: { bold: true, color: colors.amber } } });
const scopeTable = scope.tables.add(`A5:O${5 + scopeRows.length}`, true, "G001ScopeMatrix");
scopeTable.style = "TableStyleMedium2";
scope.freezePanes.freezeRows(5);
scope.freezePanes.freezeColumns(4);
const scopeWidths = [12, 16, 17, 30, 16, 24, 24, 22, 36, 38, 52, 28, 26, 22, 40];
scopeWidths.forEach((width, idx) => { scope.getRangeByIndexes(0, idx, 5 + scopeRows.length, 1).format.columnWidth = width; });

const authority = workbook.worksheets.add("Authority Map");
authority.showGridLines = false;
styleTitle(authority, authority.getRange("A1:E1"), "A2:E2", "ADR-001 · Authority by Decision Domain", "文档权威按决策领域划分，不采用简单全局排名");
authority.getRange("A3:E3").merge();
authority.getRange("A3").values = [["冲突原则：同一决策领域内，正式冻结 > 草案；范围更具体 > 一般；显式替代且版本更新 > 旧版本。跨领域冲突进入 Change Request。"]];
authority.getRange("A3:E3").format = { fill: colors.greenFill, font: { bold: true, color: colors.green }, wrapText: true };
authority.getRange("A5:E5").values = [["Decision Domain", "Primary Authority", "Applies To", "Conflict Rule", "Escalation / Required Output"]];
authority.getRange(`A6:E${5 + authorityRows.length}`).values = authorityRows;
styleHeader(authority.getRange("A5:E5"));
styleBody(authority.getRange(`A6:E${5 + authorityRows.length}`), 10);
authority.getRange(`A6:E${5 + authorityRows.length}`).format.rowHeight = 74;
[24, 44, 44, 62, 42].forEach((width, idx) => { authority.getRangeByIndexes(0, idx, 5 + authorityRows.length, 1).format.columnWidth = width; });
authority.freezePanes.freezeRows(5);

const change = workbook.worksheets.add("Change Control");
change.showGridLines = false;
styleTitle(change, change.getRange("A1:F1"), "A2:F2", "G0-01 Change Control", "Change Request → 分类 → 影响评估 → 审批 → 版本升级 → Traceability 更新 → 发布");
change.getRange("A4:E4").merge();
change.getRange("A4").values = [["流程阶段"]];
change.getRange("A4:E4").format = { fill: colors.blue, font: { bold: true, color: colors.white, size: 12 } };
change.getRange("A5:E5").values = [["Step", "Stage", "Required Work", "Output", "Accountable Role"]];
change.getRange(`A6:E${5 + workflowRows.length}`).values = workflowRows;
styleHeader(change.getRange("A5:E5"));
styleBody(change.getRange(`A6:E${5 + workflowRows.length}`), 10);
change.getRange(`A6:E${5 + workflowRows.length}`).format.rowHeight = 58;
const classStart = 8 + workflowRows.length;
change.getRange(`A${classStart}:F${classStart}`).merge();
change.getRange(`A${classStart}`).values = [["变更分类与版本影响"]];
change.getRange(`A${classStart}:F${classStart}`).format = { fill: colors.blue, font: { bold: true, color: colors.white, size: 12 } };
change.getRange(`A${classStart + 1}:F${classStart + 1}`).values = [["Code", "Class", "Definition", "Version Impact", "Required Approver", "Minimum Evidence"]];
change.getRange(`A${classStart + 2}:F${classStart + 1 + changeTypeRows.length}`).values = changeTypeRows;
styleHeader(change.getRange(`A${classStart + 1}:F${classStart + 1}`));
styleBody(change.getRange(`A${classStart + 2}:F${classStart + 1 + changeTypeRows.length}`), 10);
change.getRange(`A${classStart + 2}:F${classStart + 1 + changeTypeRows.length}`).format.rowHeight = 72;
[10, 22, 62, 22, 34, 58].forEach((width, idx) => { change.getRangeByIndexes(0, idx, classStart + 1 + changeTypeRows.length, 1).format.columnWidth = width; });
change.freezePanes.freezeRows(5);

const decisions = workbook.worksheets.add("Open Decisions");
decisions.showGridLines = false;
styleTitle(decisions, decisions.getRange("A1:I1"), "A2:I2", "G0-01 Open Decision Register", "所有已知冲突必须已解决，或登记具备负责人、期限和关闭产物的 Open Decision");
decisions.getRange("A3:I3").merge();
decisions.getRange("A3").values = [["当前状态：6 项 OPEN。G0-01 不满足关闭条件。"]];
decisions.getRange("A3:I3").format = { fill: colors.amberFill, font: { bold: true, color: colors.amber } };
decisions.getRange("A5:I5").values = [["Decision ID", "Decision", "Change Class", "Affected Scope", "Owner", "Due Date", "Status", "Closure Artifact", "Notes"]];
decisions.getRange(`A6:I${5 + openDecisionRows.length}`).values = openDecisionRows;
styleHeader(decisions.getRange("A5:I5"));
styleBody(decisions.getRange(`A6:I${5 + openDecisionRows.length}`), 9);
decisions.getRange(`A6:I${5 + openDecisionRows.length}`).format.rowHeight = 66;
decisions.getRange(`F6:F${5 + openDecisionRows.length}`).format.numberFormat = "yyyy-mm-dd";
decisions.getRange(`G6:G${5 + openDecisionRows.length}`).dataValidation = { rule: { type: "list", values: ["OPEN", "RESOLVED", "CANCELLED"] } };
decisions.getRange(`G6:G${5 + openDecisionRows.length}`).conditionalFormats.add("containsText", { text: "OPEN", format: { fill: colors.amberFill, font: { bold: true, color: colors.amber } } });
decisions.getRange(`G6:G${5 + openDecisionRows.length}`).conditionalFormats.add("containsText", { text: "RESOLVED", format: { fill: colors.greenFill, font: { bold: true, color: colors.green } } });
const decisionTable = decisions.tables.add(`A5:I${5 + openDecisionRows.length}`, true, "G001OpenDecisions");
decisionTable.style = "TableStyleMedium2";
[16, 62, 24, 22, 34, 16, 14, 40, 46].forEach((width, idx) => { decisions.getRangeByIndexes(0, idx, 5 + openDecisionRows.length, 1).format.columnWidth = width; });
decisions.freezePanes.freezeRows(5);

const summary = workbook.worksheets.add("Gate Summary");
summary.showGridLines = false;
styleTitle(summary, summary.getRange("A1:F1"), "A2:F2", "G0-01 Gate Summary", "公式驱动的关闭就绪度；当前 Gate 必须保持 OPEN");
summary.getRange("A3:F3").merge();
summary.getRange("A3").formulas = [["=IF(AND(B11=0,B12=0,B13=0),\"READY FOR REVIEW\",\"OPEN / PENDING REVIEW\")"]];
summary.getRange("A3:F3").format = { fill: colors.amberFill, font: { bold: true, size: 14, color: colors.amber }, horizontalAlignment: "center", verticalAlignment: "center" };
summary.getRange("A3:F3").format.rowHeight = 30;
summary.getRange("A5:B13").values = [
  ["Metric", "Value"],
  ["Total scope items", null],
  ["IN", null],
  ["OUT", null],
  ["DEFERRED", null],
  ["Scope decision blanks", null],
  ["Named owner unresolved", null],
  ["Open decisions", null],
  ["Past-due open decisions", null],
];
summary.getRange("B6:B13").formulas = [
  [`=COUNTA('Scope Matrix'!$A$6:$A$${5 + scopeRows.length})`],
  [`=COUNTIF('Scope Matrix'!$E$6:$E$${5 + scopeRows.length},\"IN\")`],
  [`=COUNTIF('Scope Matrix'!$E$6:$E$${5 + scopeRows.length},\"OUT\")`],
  [`=COUNTIF('Scope Matrix'!$E$6:$E$${5 + scopeRows.length},\"DEFERRED\")`],
  [`=COUNTBLANK('Scope Matrix'!$E$6:$E$${5 + scopeRows.length})`],
  [`=COUNTIF('Scope Matrix'!$M$6:$M$${5 + scopeRows.length},\"TBD before G0-01 close\")`],
  [`=COUNTIF('Open Decisions'!$G$6:$G$${5 + openDecisionRows.length},\"OPEN\")`],
  [`=COUNTIFS('Open Decisions'!$G$6:$G$${5 + openDecisionRows.length},\"OPEN\",'Open Decisions'!$F$6:$F$${5 + openDecisionRows.length},\"<\"&TODAY())`],
];
styleHeader(summary.getRange("A5:B5"));
styleBody(summary.getRange("A6:B13"), 10);
summary.getRange("A15:F15").merge();
summary.getRange("A15").values = [["G0-01 Exit Checklist"]];
summary.getRange("A15:F15").format = { fill: colors.blue, font: { bold: true, color: colors.white, size: 12 } };
summary.getRange("A16:F16").values = [["Check", "Required Evidence", "Current Result", "Owner", "Status", "Close Condition"]];
summary.getRange("A17:F22").values = [
  ["Scope coverage", "All modules + cross-cutting capabilities", `${scopeRows.length} items catalogued`, "Architecture Governance", "DRAFT COMPLETE", "Review confirms no omitted capability"],
  ["Scope fields", "IN/OUT/DEFERRED, MVP, authority, acceptance, owner", "Role owner complete; named owner unresolved", "Project Manager", "OPEN", "Named owners assigned"],
  ["Authority ADR", "Decision-domain authority + conflict rule", "ADR-001 PROPOSED", "Architecture Governance", "PENDING REVIEW", "Approved ADR version recorded"],
  ["Change control", "7 stages + 4 change classes", "Drafted", "Project Manager", "PENDING REVIEW", "Approvers and SLAs confirmed"],
  ["Known conflicts", "Resolved or registered with owner/due date", `${openDecisionRows.length} open decisions`, "Decision Owners", "OPEN", "All resolved or formally accepted"],
  ["Gate closure record", "Approver, ADR, version, closed at", "Not approved", "Gate Owner", "OPEN", "Formal review passes"],
];
styleHeader(summary.getRange("A16:F16"));
styleBody(summary.getRange("A17:F22"), 10);
summary.getRange("A17:F22").format.rowHeight = 58;
summary.getRange("E17:E22").conditionalFormats.add("containsText", { text: "OPEN", format: { fill: colors.amberFill, font: { bold: true, color: colors.amber } } });
summary.getRange("E17:E22").conditionalFormats.add("containsText", { text: "COMPLETE", format: { fill: colors.greenFill, font: { bold: true, color: colors.green } } });
[28, 58, 42, 30, 20, 48].forEach((width, idx) => { summary.getRangeByIndexes(0, idx, 22, 1).format.columnWidth = width; });
summary.freezePanes.freezeRows(5);

try {
  await fs.access(outputPath);
  throw new Error(
    `Refusing to overwrite existing artifact: ${outputPath}. ` +
    "Set GEO_OS_ARTIFACT_OUTPUT to a new versioned path.",
  );
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

await fs.mkdir(outputDir, { recursive: true });
await fs.mkdir(previewDir, { recursive: true });

const xlsx = await SpreadsheetFile.exportXlsx(workbook);
await xlsx.save(outputPath);

const previews = [
  ["Gate Summary", "A1:F22", "gate-summary.png"],
  ["Scope Matrix", `A1:O${5 + scopeRows.length}`, "scope-matrix.png"],
  ["Authority Map", "A1:E10", "authority-map.png"],
  ["Change Control", `A1:F${classStart + 1 + changeTypeRows.length}`, "change-control.png"],
  ["Open Decisions", `A1:I${5 + openDecisionRows.length}`, "open-decisions.png"],
];
for (const [sheetName, range, fileName] of previews) {
  const preview = await workbook.render({ sheetName, range, scale: 1.15, format: "png" });
  await fs.writeFile(`${previewDir}/${fileName}`, new Uint8Array(await preview.arrayBuffer()));
}

const check = await workbook.inspect({ kind: "table", range: "Gate Summary!A1:F22", include: "values,formulas", tableMaxRows: 30, tableMaxCols: 8, maxChars: 6000 });
const errors = await workbook.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A", options: { useRegex: true, maxResults: 100 }, summary: "final formula error scan" });
console.log(check.ndjson);
console.log(errors.ndjson);
console.log(outputPath);
