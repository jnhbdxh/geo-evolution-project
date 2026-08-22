from __future__ import annotations

import html
import math
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

from PIL import Image, ImageDraw, ImageFont


REPO_ROOT = Path(__file__).resolve().parents[2]
OUTPUT_DIR = Path(
    os.environ.get(
        "GEO_OS_BUSINESS_ARCH_OUTPUT_DIR",
        str(REPO_ROOT / "outputs" / "product-architecture-v2.5"),
    )
).resolve()
SVG_OUTPUT = OUTPUT_DIR / "GEO_OS_业务架构图_极浅暖白专题版_V2.5.svg"
PNG_OUTPUT = OUTPUT_DIR / "GEO_OS_业务架构图_极浅暖白专题版_V2.5.png"

FONT_REGULAR = Path(r"C:\Windows\Fonts\msyh.ttc")
FONT_BOLD = Path(r"C:\Windows\Fonts\msyhbd.ttc")

CANVAS_WIDTH = 2400
CANVAS_HEIGHT = 1500

BACKGROUND = "#FFFDF9"
PAPER = "#FFFFFF"
INK = "#24211F"
MUTED = "#716961"
HAIRLINE = "#E9DFD6"
ACCENT = "#B65F43"
ACCENT_PALE = "#FBF1E9"


@dataclass(frozen=True)
class Card:
    x: int
    y: int
    width: int
    height: int
    eyebrow: str
    title: str
    lines: tuple[str, ...]
    tone: str = "paper"


class EditorialCanvas:
    def __init__(self, width: int, height: int) -> None:
        self.width = width
        self.height = height
        self.image = Image.new("RGB", (width, height), BACKGROUND)
        self.draw = ImageDraw.Draw(self.image)
        self.svg: list[str] = [
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">',
            "<defs>",
            '<marker id="arrow" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto" markerUnits="strokeWidth">',
            f'<path d="M 0 0 L 12 6 L 0 12 z" fill="{ACCENT}"/>',
            "</marker>",
            '<marker id="arrow-muted" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto" markerUnits="strokeWidth">',
            f'<path d="M 0 0 L 12 6 L 0 12 z" fill="{HAIRLINE}"/>',
            "</marker>",
            '<filter id="paper-shadow" x="-10%" y="-20%" width="120%" height="150%">',
            '<feDropShadow dx="0" dy="10" stdDeviation="18" flood-color="#2A211D" flood-opacity="0.065"/>',
            "</filter>",
            "</defs>",
            f'<rect width="{width}" height="{height}" fill="{BACKGROUND}"/>',
        ]
        self._font_cache: dict[tuple[int, bool], ImageFont.FreeTypeFont] = {}

    def font(self, size: int, *, bold: bool = False) -> ImageFont.FreeTypeFont:
        key = (size, bold)
        if key not in self._font_cache:
            font_path = FONT_BOLD if bold else FONT_REGULAR
            self._font_cache[key] = ImageFont.truetype(str(font_path), size)
        return self._font_cache[key]

    def text(
        self,
        x: float,
        y: float,
        value: str,
        *,
        size: int,
        color: str = INK,
        bold: bool = False,
        anchor: str = "la",
    ) -> None:
        font = self.font(size, bold=bold)
        self.draw.text((x, y), value, font=font, fill=color, anchor=anchor)
        svg_anchor = {"la": "start", "ma": "middle", "ra": "end"}.get(anchor, "start")
        weight = "600" if bold else "400"
        family = "Microsoft YaHei, Arial, sans-serif"
        self.svg.append(
            f'<text x="{x}" y="{y}" fill="{color}" font-family="{family}" font-size="{size}" '
            f'font-weight="{weight}" text-anchor="{svg_anchor}" dominant-baseline="hanging">{html.escape(value)}</text>'
        )

    def line(
        self,
        points: Sequence[tuple[float, float]],
        *,
        color: str = HAIRLINE,
        width: int = 2,
        dashed: bool = False,
        arrow: bool = False,
    ) -> None:
        self.draw.line(points, fill=color, width=width, joint="curve")
        if dashed:
            self._draw_dashed_polyline(points, color=color, width=width)
        if arrow:
            self._draw_arrowhead(points[-2], points[-1], color=color, size=13)

        path_data = "M " + " L ".join(f"{x} {y}" for x, y in points)
        dash = ' stroke-dasharray="8 10"' if dashed else ""
        marker_id = "arrow" if color == ACCENT else "arrow-muted"
        marker = f' marker-end="url(#{marker_id})"' if arrow else ""
        self.svg.append(
            f'<path d="{path_data}" fill="none" stroke="{color}" stroke-width="{width}" '
            f'stroke-linecap="round" stroke-linejoin="round"{dash}{marker}/>'
        )

    def _draw_dashed_polyline(
        self,
        points: Sequence[tuple[float, float]],
        *,
        color: str,
        width: int,
    ) -> None:
        # Paint the background over the solid helper line, then redraw each dash.
        self.draw.line(points, fill=BACKGROUND, width=width + 2, joint="curve")
        for start, end in zip(points, points[1:]):
            x1, y1 = start
            x2, y2 = end
            distance = math.hypot(x2 - x1, y2 - y1)
            if distance == 0:
                continue
            ux = (x2 - x1) / distance
            uy = (y2 - y1) / distance
            cursor = 0.0
            while cursor < distance:
                dash_end = min(cursor + 8, distance)
                self.draw.line(
                    (
                        x1 + ux * cursor,
                        y1 + uy * cursor,
                        x1 + ux * dash_end,
                        y1 + uy * dash_end,
                    ),
                    fill=color,
                    width=width,
                )
                cursor += 18

    def _draw_arrowhead(
        self,
        start: tuple[float, float],
        end: tuple[float, float],
        *,
        color: str,
        size: int,
    ) -> None:
        x1, y1 = start
        x2, y2 = end
        angle = math.atan2(y2 - y1, x2 - x1)
        spread = math.pi / 7
        points = [
            (x2, y2),
            (x2 - size * math.cos(angle - spread), y2 - size * math.sin(angle - spread)),
            (x2 - size * math.cos(angle + spread), y2 - size * math.sin(angle + spread)),
        ]
        self.draw.polygon(points, fill=color)

    def rounded_rect(
        self,
        x: int,
        y: int,
        width: int,
        height: int,
        *,
        fill: str,
        outline: str,
        radius: int = 16,
        stroke_width: int = 2,
        shadow: bool = False,
    ) -> None:
        if shadow:
            shadow_layer = Image.new("RGBA", self.image.size, (0, 0, 0, 0))
            shadow_draw = ImageDraw.Draw(shadow_layer)
            shadow_draw.rounded_rectangle(
                (x, y + 8, x + width, y + height + 8),
                radius=radius,
                fill=(42, 33, 29, 14),
            )
            self.image.paste(shadow_layer, (0, 0), shadow_layer)
            self.draw = ImageDraw.Draw(self.image)
        self.draw.rounded_rectangle(
            (x, y, x + width, y + height),
            radius=radius,
            fill=fill,
            outline=outline,
            width=stroke_width,
        )
        filter_attr = ' filter="url(#paper-shadow)"' if shadow else ""
        self.svg.append(
            f'<rect x="{x}" y="{y}" width="{width}" height="{height}" rx="{radius}" '
            f'fill="{fill}" stroke="{outline}" stroke-width="{stroke_width}"{filter_attr}/>'
        )

    def card(self, card: Card, *, active: bool = False) -> None:
        fill = ACCENT_PALE if card.tone == "foundation" else PAPER
        outline = ACCENT if active else HAIRLINE
        self.rounded_rect(
            card.x,
            card.y,
            card.width,
            card.height,
            fill=fill,
            outline=outline,
            radius=14,
            stroke_width=2,
            shadow=active,
        )
        self.draw.rounded_rectangle(
            (card.x + 20, card.y + 22, card.x + 25, card.y + card.height - 22),
            radius=3,
            fill=ACCENT,
        )
        self.svg.append(
            f'<rect x="{card.x + 20}" y="{card.y + 22}" width="5" height="{card.height - 44}" rx="3" fill="{ACCENT}"/>'
        )
        self.text(card.x + 46, card.y + 22, card.eyebrow, size=14, color=ACCENT, bold=True)
        self.text(card.x + 46, card.y + 50, card.title, size=25, color=INK, bold=True)
        line_y = card.y + 93
        for line in card.lines:
            self.text(card.x + 46, line_y, line, size=16, color=MUTED)
            line_y += 27

    def save(
        self,
        *,
        png_output: Path = PNG_OUTPUT,
        svg_output: Path = SVG_OUTPUT,
    ) -> None:
        self.svg.append("</svg>")
        self.image.save(png_output, format="PNG", optimize=True)
        svg_output.write_text("\n".join(self.svg), encoding="utf-8")


def add_arrow_label(canvas: EditorialCanvas, x: int, y: int, value: str, *, anchor: str = "ma") -> None:
    canvas.text(x, y, value, size=14, color=MUTED, anchor=anchor)


def draw_foundation_modules(canvas: EditorialCanvas) -> None:
    canvas.text(110, 292, "独立支撑模块  /  SUPPORTING MODULES", size=15, color=ACCENT, bold=True)
    modules = [
        Card(110, 330, 380, 150, "支撑模块 01", "项目与权限", ("管理客户、品牌、项目和策略", "Tenant · Project · Policy"), "foundation"),
        Card(560, 330, 380, 150, "支撑模块 02", "需求洞察", ("明确用户真正关心的问题", "DemandSignal · QuestionVersion"), "foundation"),
        Card(1010, 330, 380, 150, "支撑模块 03", "品牌事实与证据", ("维护可核验的品牌事实", "Evidence · FactClaim"), "foundation"),
        Card(1460, 330, 380, 150, "支撑模块 04", "信源洞察", ("分析引用与信源结构", "Citation · Source · Relationship"), "foundation"),
        Card(1910, 330, 380, 150, "支撑模块 05", "报告交付", ("展示快照与复测结论", "Report · Dashboard · Brief"), "foundation"),
    ]
    for module in modules:
        canvas.card(module)

    canvas.line([(170, 525), (2230, 525)], color=HAIRLINE, width=2)
    canvas.text(
        1200,
        503,
        "模块各自管理数据和规则，通过明确的版本、证据、决议与快照协同",
        size=15,
        color=MUTED,
        anchor="ma",
    )


def draw_optimization_loop(canvas: EditorialCanvas) -> None:
    canvas.text(110, 566, "核心业务闭环  /  CORE BUSINESS LOOP", size=15, color=ACCENT, bold=True)

    monitoring = Card(170, 610, 420, 170, "第 1 步", "定义监测", ("决定问什么、在哪问、何时问", "SamplingDesign · SampleSlot"))
    execution = Card(680, 610, 420, 170, "第 2 步", "真实执行", ("在真实 AI 端面提问并留证", "ExecutionRun · Context"))
    observation = Card(1190, 610, 420, 170, "第 3 步", "形成观测", ("只记录用户真正看到的结果", "RawObservation · Evidence"))
    measurement = Card(1700, 610, 420, 170, "第 4 步", "冻结快照", ("按规则汇总有效结果并冻结", "Assessment · Resolution · Snapshot"), "paper")
    attribution = Card(1700, 930, 420, 170, "第 5 步", "归因分析", ("识别可能原因，不宣称严格因果", "Attribution Analysis · Hypothesis"))
    strategy = Card(1190, 930, 420, 170, "第 6 步", "制定策略", ("选择优化方向、动作和优先级", "StrategyAction · Priority"))
    intervention = Card(680, 930, 420, 170, "第 7 步", "执行优化", ("记录内容、技术或信源动作", "Intervention · ActionVersion"), "paper")
    validation = Card(170, 930, 420, 170, "第 8 步", "复测复盘", ("对比变化并决定下一步", "EffectValidation · Evidence"))

    for card in (monitoring, execution, observation, measurement, attribution, strategy, intervention, validation):
        canvas.card(card, active=card in (monitoring, strategy, validation))

    # Clockwise primary flow.
    canvas.line([(590, 695), (680, 695)], color=ACCENT, width=4, arrow=True)
    canvas.line([(1100, 695), (1190, 695)], color=ACCENT, width=4, arrow=True)
    canvas.line([(1610, 695), (1700, 695)], color=ACCENT, width=4, arrow=True)
    canvas.line([(1910, 780), (1910, 930)], color=ACCENT, width=4, arrow=True)
    canvas.line([(1700, 1015), (1610, 1015)], color=ACCENT, width=4, arrow=True)
    canvas.line([(1190, 1015), (1100, 1015)], color=ACCENT, width=4, arrow=True)
    canvas.line([(680, 1015), (590, 1015)], color=ACCENT, width=4, arrow=True)

    add_arrow_label(canvas, 635, 664, "生成任务")
    add_arrow_label(canvas, 1145, 664, "留存证据")
    add_arrow_label(canvas, 1655, 664, "规则计算")
    add_arrow_label(canvas, 1950, 842, "快照（Snapshot）", anchor="la")
    add_arrow_label(canvas, 1655, 1045, "归因结论")
    add_arrow_label(canvas, 1145, 1045, "策略方案")
    add_arrow_label(canvas, 635, 1045, "执行动作")

    # Feedback closes the loop: validation becomes the next monitoring plan.
    feedback = [(170, 1015), (130, 1015), (130, 695), (170, 695)]
    canvas.line(feedback, color=ACCENT, width=4, arrow=True)
    canvas.text(175, 1135, "进入下一轮  /  NEXT CYCLE", size=15, color=ACCENT, bold=True)
    canvas.text(175, 1165, "复盘结论 → 更新问题与监测设计 → 定制下一步优化动作", size=22, color=INK, bold=True)

    # Contextual modules feed the loop without owning its downstream facts.
    canvas.line([(750, 480), (750, 560), (380, 560), (380, 610)], color=HAIRLINE, width=2, dashed=True, arrow=True)
    canvas.line([(1200, 480), (1200, 560), (1400, 560), (1400, 610)], color=HAIRLINE, width=2, dashed=True, arrow=True)
    canvas.line([(1650, 480), (1650, 880), (1810, 880), (1810, 930)], color=HAIRLINE, width=2, dashed=True, arrow=True)
    canvas.line([(2100, 610), (2245, 610), (2245, 480), (2100, 480)], color=HAIRLINE, width=2, dashed=True, arrow=True)

    # Central editorial annotation rather than another component card.
    canvas.text(1200, 830, "行动不是终点", size=30, color=INK, bold=True, anchor="ma")
    canvas.text(1200, 872, "每一次行动都触发新的监测、复盘与下一轮优化", size=18, color=MUTED, anchor="ma")


def draw_footer(canvas: EditorialCanvas) -> None:
    canvas.line([(110, 1270), (2290, 1270)], color=HAIRLINE, width=2)
    canvas.text(110, 1310, "模块边界  /  MODULE OWNERSHIP", size=14, color=ACCENT, bold=True)
    canvas.text(
        110,
        1340,
        "每个模块独立拥有职责、核心对象与版本历史；跨模块只传递显式契约、证据、决议与快照。",
        size=18,
        color=INK,
    )
    canvas.text(2290, 1310, "GEO OS · 业务架构 · V2.5", size=14, color=MUTED, anchor="ra")
    canvas.text(2290, 1340, "产品基线仍为 V1.0", size=16, color=MUTED, anchor="ra")


def build_diagram() -> None:
    canvas = EditorialCanvas(CANVAS_WIDTH, CANVAS_HEIGHT)
    canvas.text(110, 74, "GEO OS  /  产品业务架构", size=16, color=ACCENT, bold=True)
    canvas.text(2190, 78, "持续优化步骤", size=15, color=INK, bold=True, anchor="ra")
    canvas.text(2190, 105, "CONTINUOUS LOOP", size=13, color=MUTED, anchor="ra")
    canvas.text(2290, 58, "08", size=72, color=ACCENT, bold=True, anchor="ra")
    canvas.text(110, 118, "独立模块，持续优化闭环", size=56, color=INK, bold=True)
    canvas.text(
        110,
        202,
        "围绕同一客户目标，各领域模块保持清晰边界；监测、行动与复盘循环推进，而不是一次性交付。",
        size=24,
        color=MUTED,
    )
    canvas.line([(110, 258), (2290, 258)], color=INK, width=2)

    draw_foundation_modules(canvas)
    draw_optimization_loop(canvas)
    draw_footer(canvas)
    canvas.save()


def main() -> None:
    outputs = (SVG_OUTPUT, PNG_OUTPUT)
    existing = [path for path in outputs if path.exists()]
    if existing:
        details = "\n".join(f"- {path}" for path in existing)
        raise FileExistsError(
            "Refusing to overwrite existing architecture artifacts. Set "
            "GEO_OS_BUSINESS_ARCH_OUTPUT_DIR to a new directory.\n"
            f"Existing files:\n{details}"
        )
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    build_diagram()
    print(SVG_OUTPUT)
    print(PNG_OUTPUT)


if __name__ == "__main__":
    main()
