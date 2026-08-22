from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from build_business_architecture_v2 import (
    ACCENT,
    ACCENT_PALE,
    BACKGROUND,
    HAIRLINE,
    INK,
    MUTED,
    PAPER,
    EditorialCanvas,
)


REPO_ROOT = Path(__file__).resolve().parents[2]
OUTPUT_DIR = Path(
    os.environ.get(
        "GEO_OS_DETAILED_BUSINESS_ARCH_OUTPUT_DIR",
        str(REPO_ROOT / "outputs" / "product-architecture-detailed-v3"),
    )
).resolve()
SVG_OUTPUT = OUTPUT_DIR / "GEO_OS_详细业务架构图_模块逻辑与处理链路_V3.0.svg"
PNG_OUTPUT = OUTPUT_DIR / "GEO_OS_详细业务架构图_模块逻辑与处理链路_V3.0.png"

CANVAS_WIDTH = 2800
CANVAS_HEIGHT = 1800


@dataclass(frozen=True)
class SupportModule:
    number: str
    title: str
    english: str
    purpose: str
    chain: tuple[str, ...]
    objects: str
    collaboration: str


@dataclass(frozen=True)
class LoopStep:
    number: str
    title: str
    english: str
    purpose: str
    inputs: str
    process: tuple[str, ...]
    output: str
    rules: tuple[str, ...]


def accent_bar(canvas: EditorialCanvas, x: int, y: int, height: int) -> None:
    canvas.draw.rounded_rectangle((x, y, x + 5, y + height), radius=3, fill=ACCENT)
    canvas.svg.append(f'<rect x="{x}" y="{y}" width="5" height="{height}" rx="3" fill="{ACCENT}"/>')


def pill(canvas: EditorialCanvas, x: int, y: int, width: int, label: str) -> None:
    canvas.rounded_rect(
        x,
        y,
        width,
        32,
        fill=ACCENT_PALE,
        outline=ACCENT_PALE,
        radius=16,
        stroke_width=1,
    )
    canvas.text(x + width / 2, y + 6, label, size=13, color=ACCENT, bold=True, anchor="ma")


def support_card(canvas: EditorialCanvas, x: int, y: int, module: SupportModule) -> None:
    width, height = 500, 238
    canvas.rounded_rect(
        x,
        y,
        width,
        height,
        fill=PAPER,
        outline=HAIRLINE,
        radius=14,
        stroke_width=2,
    )
    accent_bar(canvas, x + 20, y + 22, height - 44)
    pill(canvas, x + 44, y + 20, 72, module.number)
    canvas.text(x + 132, y + 21, module.title, size=24, color=INK, bold=True)
    canvas.text(x + 132, y + 56, module.english, size=12, color=MUTED)
    canvas.text(x + 44, y + 88, module.purpose, size=15, color=INK)
    canvas.line([(x + 44, y + 118), (x + width - 28, y + 118)], color=HAIRLINE, width=1)
    canvas.text(x + 44, y + 133, "处理链路", size=13, color=ACCENT, bold=True)
    chain_y = y + 158
    for line in module.chain:
        canvas.text(x + 44, chain_y, line, size=14, color=INK)
        chain_y += 23
    canvas.text(x + 44, y + 207, f"对象  {module.objects}", size=12, color=MUTED)
    canvas.text(x + width - 28, y + 207, module.collaboration, size=12, color=ACCENT, bold=True, anchor="ra")


def loop_card(canvas: EditorialCanvas, x: int, y: int, step: LoopStep, *, active: bool = False) -> None:
    width, height = 500, 326
    canvas.rounded_rect(
        x,
        y,
        width,
        height,
        fill=PAPER,
        outline=ACCENT if active else HAIRLINE,
        radius=15,
        stroke_width=2,
        shadow=active,
    )
    accent_bar(canvas, x + 20, y + 22, height - 44)
    pill(canvas, x + 44, y + 22, 62, step.number)
    canvas.text(x + 122, y + 20, step.title, size=27, color=INK, bold=True)
    canvas.text(x + 122, y + 58, step.english, size=12, color=MUTED)
    canvas.text(x + 44, y + 91, step.purpose, size=15, color=INK)
    canvas.line([(x + 44, y + 121), (x + width - 28, y + 121)], color=HAIRLINE, width=1)

    canvas.text(x + 44, y + 138, "输入", size=13, color=ACCENT, bold=True)
    canvas.text(x + 104, y + 138, step.inputs, size=14, color=MUTED)

    canvas.text(x + 44, y + 170, "处理", size=13, color=ACCENT, bold=True)
    process_y = y + 170
    for line in step.process:
        canvas.text(x + 104, process_y, line, size=14, color=INK)
        process_y += 24

    canvas.text(x + 44, y + 225, "产出", size=13, color=ACCENT, bold=True)
    canvas.text(x + 104, y + 225, step.output, size=14, color=INK)

    canvas.line([(x + 44, y + 254), (x + width - 28, y + 254)], color=HAIRLINE, width=1)
    canvas.text(x + 44, y + 270, "关键规则", size=13, color=ACCENT, bold=True)
    rule_y = y + 270
    for line in step.rules:
        canvas.text(x + 122, rule_y, line, size=13, color=MUTED)
        rule_y += 22


def draw_header(canvas: EditorialCanvas) -> None:
    canvas.text(100, 58, "GEO OS  /  详细业务架构", size=16, color=ACCENT, bold=True)
    canvas.text(100, 101, "从真实观测到持续优化", size=54, color=INK, bold=True)
    canvas.text(
        100,
        182,
        "独立业务模块通过事实、证据、决议、快照和版本化行动协同，形成可复测、可复盘、可持续演进的客户价值闭环。",
        size=22,
        color=MUTED,
    )
    canvas.text(2660, 56, "08", size=72, color=ACCENT, bold=True, anchor="ra")
    canvas.text(2552, 76, "核心步骤", size=15, color=INK, bold=True, anchor="ra")
    canvas.text(2552, 102, "CONTINUOUS LOOP", size=12, color=MUTED, anchor="ra")
    canvas.line([(100, 250), (2700, 250)], color=INK, width=2)


def draw_support_modules(canvas: EditorialCanvas) -> None:
    canvas.text(100, 280, "独立业务模块  /  INDEPENDENT BUSINESS DOMAINS", size=14, color=ACCENT, bold=True)
    modules = (
        SupportModule(
            "M01",
            "项目与权限",
            "Workspace & Project",
            "建立客户经营空间，并固定项目适用的品牌、成员与规则版本。",
            ("受控开通 → 成员与角色 → 客户/品牌", "项目建立 → 默认规则与行业版本绑定"),
            "Tenant · Customer · Brand · Project",
            "支撑全链路",
        ),
        SupportModule(
            "M02",
            "需求洞察",
            "Demand Intelligence",
            "把用户需求转成可版本化、可重复执行的监测问题。",
            ("需求主题 → 问题候选 → 正式问题", "问题版本 → 监测目标与采样入口"),
            "DemandTheme · QuestionVersion",
            "进入步骤 01",
        ),
        SupportModule(
            "M03",
            "品牌事实与证据",
            "Brand Truth & Evidence",
            "维护可核验品牌事实，为判断、归因和策略提供可信上下文。",
            ("文件/数据源 → 证据条目 → 事实声明", "冲突识别 → 事实确认 → 事实快照"),
            "Evidence · FactClaim · TruthSnapshot",
            "支撑 03 / 05 / 06",
        ),
        SupportModule(
            "M04",
            "信源洞察",
            "Source Intelligence",
            "识别引用出现、引用资格与信源身份，不暴露租户私有证据。",
            ("引用出现 → 资格判断 → 逻辑引用", "信源绑定 → 类型/关系分析 → 信源结论"),
            "Citation · Qualification · SourceBinding",
            "支撑 03 / 05",
        ),
        SupportModule(
            "M05",
            "报告交付",
            "Reporting & Delivery",
            "只消费已冻结版本，交付指标、归因、策略与复测结论。",
            ("选择快照 → 组装指标/洞察/策略", "版本发布 → 客户查看 → 后续复测更新"),
            "Report · Dashboard · ReportRelease",
            "消费 04—08",
        ),
    )
    for index, module in enumerate(modules):
        support_card(canvas, 100 + index * 525, 316, module)

    canvas.text(
        1400,
        575,
        "模块独立拥有对象、规则与版本历史；跨模块只通过显式契约传递结果。",
        size=14,
        color=MUTED,
        anchor="ma",
    )


def draw_loop(canvas: EditorialCanvas) -> None:
    canvas.text(100, 618, "核心业务闭环  /  CORE BUSINESS LOOP", size=14, color=ACCENT, bold=True)
    steps = (
        LoopStep(
            "01",
            "定义监测",
            "Monitoring Design",
            "把业务目标转成可执行、可复现的采样计划。",
            "项目目标、问题版本、平台范围",
            ("问题版本 → 监测计划版本", "计划版本 → 样本批次 → 样本位"),
            "可执行监测任务与预期样本数",
            ("计划变更必须产生新版本", "样本位定义唯一预期样本"),
        ),
        LoopStep(
            "02",
            "真实执行",
            "Real Execution",
            "在真实 AI 端面完成查询，并保留执行上下文和原始证据。",
            "样本位、问题文本、执行上下文",
            ("调度 → 查询引擎 → 响应检测", "捕获文本/截图/上下文 → 执行记录"),
            "ExecutionRun、响应证据或失败原因",
            ("失败不制造观测", "重试始终服务同一个样本位"),
        ),
        LoopStep(
            "03",
            "形成观测",
            "Observation Finalization",
            "只把用户真正看到且满足最低质量要求的结果登记为事实。",
            "执行记录、响应内容、截图与上下文",
            ("观测候选 → 存在/质量判断", "最终化 → 原始观测；纠错另建记录"),
            "RawObservation 与可追溯 Evidence",
            ("最终化事实不可覆盖", "纠错追加，不改写历史原文"),
        ),
        LoopStep(
            "04",
            "冻结快照",
            "Resolution & Snapshot",
            "将可替换判断解析为确定口径，并冻结一次可复现测量。",
            "原始观测、规则版本、判断结果",
            ("评估 → 复核 → 决议 → 指标贡献", "两层成员关系 → 测量快照"),
            "MeasurementSnapshot 与指标底稿",
            ("报告只读取指定快照", "错误通过替代快照修正"),
        ),
        LoopStep(
            "05",
            "归因分析",
            "Attribution Analysis",
            "解释指标差距可能由什么造成，并保留证据与不确定性。",
            "测量快照、品牌事实、信源与覆盖上下文",
            ("异常信号 → 差距症状 → 证据聚合", "形成原因假设 → 记录支持/反证/限制"),
            "归因结论、证据链与已知限制",
            ("表达可能原因，不宣称严格因果", "每条结论必须回溯证据"),
        ),
        LoopStep(
            "06",
            "制定策略",
            "Strategy Planning",
            "把归因结论转成有优先级、可执行、可验证的优化动作。",
            "归因结论、业务目标、规则与资源约束",
            ("规则匹配 → 策略候选 → 价值/成本排序", "动作拆解 → 发布策略版本"),
            "StrategyActionRelease 与成功判据",
            ("策略与证据/规则版本绑定", "新方案发布新版本，不覆盖旧版"),
        ),
        LoopStep(
            "07",
            "执行优化",
            "Intervention Execution",
            "实施内容、技术或信源动作，并记录真实执行证据。",
            "已发布策略、负责人、时间窗与目标",
            ("动作 → 干预草案 → 干预发布", "人工/半自动执行 → 留存变更与证据"),
            "InterventionRelease 与执行记录",
            ("发布后的计划不可静默修改", "记录实际动作、时间和证据"),
        ),
        LoopStep(
            "08",
            "复测复盘",
            "Retest & Effect Review",
            "在可比条件下复测，判断变化是否支持策略并决定下一步。",
            "干预证据、基线快照与复测计划",
            ("复测计划 → 同口径测量 → 前后对比", "效果证据 → 结论/限制 → 更新报告"),
            "EffectEvidence 与下一轮监测建议",
            ("明确可比性与限制", "仅给支持/不支持/不确定结论"),
        ),
    )

    positions = (
        (130, 662),
        (810, 662),
        (1490, 662),
        (2170, 662),
        (2170, 1088),
        (1490, 1088),
        (810, 1088),
        (130, 1088),
    )
    for step, position in zip(steps, positions):
        loop_card(canvas, *position, step, active=step.number in {"01", "06", "08"})

    # Clockwise business flow and the explicit contract passed between stages.
    horizontal_top = (
        (630, 825, 810, "监测任务"),
        (1310, 825, 1490, "响应与证据"),
        (1990, 825, 2170, "不可变事实"),
    )
    for x1, y, x2, label in horizontal_top:
        canvas.line([(x1, y), (x2, y)], color=ACCENT, width=4, arrow=True)
        canvas.text((x1 + x2) / 2, y - 30, label, size=13, color=ACCENT, bold=True, anchor="ma")

    canvas.line([(2420, 988), (2420, 1088)], color=ACCENT, width=4, arrow=True)
    canvas.text(2450, 1015, "测量快照", size=13, color=ACCENT, bold=True)

    horizontal_bottom = (
        (2170, 1251, 1990, "归因结论"),
        (1490, 1251, 1310, "策略方案"),
        (810, 1251, 630, "动作与证据"),
    )
    for x1, y, x2, label in horizontal_bottom:
        canvas.line([(x1, y), (x2, y)], color=ACCENT, width=4, arrow=True)
        canvas.text((x1 + x2) / 2, y - 30, label, size=13, color=ACCENT, bold=True, anchor="ma")

    canvas.line([(130, 1251), (78, 1251), (78, 825), (130, 825)], color=ACCENT, width=4, arrow=True)
    canvas.text(92, 1011, "复盘结论", size=12, color=ACCENT, bold=True)
    canvas.text(92, 1032, "下一轮计划", size=12, color=ACCENT, bold=True)

    canvas.text(1400, 1011, "行动不是终点", size=28, color=INK, bold=True, anchor="ma")
    canvas.text(
        1400,
        1050,
        "复测结果回到监测设计，驱动下一轮归因、策略与优化",
        size=16,
        color=MUTED,
        anchor="ma",
    )


def draw_semantic_layers(canvas: EditorialCanvas) -> None:
    canvas.line([(100, 1464), (2700, 1464)], color=INK, width=2)
    canvas.text(100, 1492, "跨模块语义层  /  CROSS-MODULE SEMANTICS", size=14, color=ACCENT, bold=True)
    layer_y = 1530
    layers = (
        (
            100,
            "事实层",
            "FACT LAYER",
            "执行记录 · 原始观测 · 证据",
            "回答“发生了什么”；追加与保留历史，不被后续判断覆盖。",
        ),
        (
            980,
            "判断层",
            "DECISION LAYER",
            "评估 · 复核 · 决议 · 归因",
            "回答“如何解释”；允许新版本替代，但每次判断可追溯。",
        ),
        (
            1860,
            "发布层",
            "RELEASE LAYER",
            "测量快照 · 策略发布 · 干预发布 · 报告发布",
            "回答“客户看到与执行哪一版”；发布后固定，错误以新版本替代。",
        ),
    )
    for x, title, english, objects, description in layers:
        canvas.rounded_rect(x, layer_y, 840, 126, fill=ACCENT_PALE, outline=HAIRLINE, radius=12, stroke_width=1)
        canvas.text(x + 28, layer_y + 20, title, size=21, color=INK, bold=True)
        canvas.text(x + 145, layer_y + 25, english, size=11, color=MUTED)
        canvas.text(x + 28, layer_y + 55, objects, size=14, color=ACCENT, bold=True)
        canvas.text(x + 28, layer_y + 84, description, size=13, color=MUTED)

    canvas.rounded_rect(100, 1680, 2600, 58, fill=INK, outline=INK, radius=12, stroke_width=1)
    canvas.text(128, 1697, "全链路约束", size=14, color="#FFFDF9", bold=True)
    canvas.text(
        275,
        1697,
        "租户与项目上下文  ·  实际版本绑定  ·  审计留痕  ·  异步幂等与重试  ·  历史替代而非覆盖",
        size=14,
        color="#F2E9E2",
    )
    canvas.text(2670, 1762, "GEO OS · 详细业务架构 · V3.0", size=13, color=MUTED, anchor="ra")


def build_diagram() -> None:
    canvas = EditorialCanvas(CANVAS_WIDTH, CANVAS_HEIGHT)
    draw_header(canvas)
    draw_support_modules(canvas)
    draw_loop(canvas)
    draw_semantic_layers(canvas)
    canvas.save(png_output=PNG_OUTPUT, svg_output=SVG_OUTPUT)


def main() -> None:
    outputs = (SVG_OUTPUT, PNG_OUTPUT)
    existing = [path for path in outputs if path.exists()]
    if existing:
        details = "\n".join(f"- {path}" for path in existing)
        raise FileExistsError(
            "Refusing to overwrite existing detailed business architecture artifacts. Set "
            "GEO_OS_DETAILED_BUSINESS_ARCH_OUTPUT_DIR to a new directory.\n"
            f"Existing files:\n{details}"
        )
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    build_diagram()
    print(SVG_OUTPUT)
    print(PNG_OUTPUT)


if __name__ == "__main__":
    main()
