import { COMP, EFFECT_NAMES, LOGICAL } from "./types";
import type { StyleRole } from "./types";

export function compToken(logicalId: string): string {
  return `{{comp:${logicalId}}}`;
}

function controlValue(effectName: string): string {
  return `comp("${compToken(LOGICAL.control)}").layer("${COMP.ctrlLayer}").effect("${effectName}")(1)`;
}

function styleToken(role: StyleRole): string {
  if (role === "narration") return compToken(LOGICAL.styleNarration);
  if (role === "option") return compToken(LOGICAL.styleOption);
  return compToken(LOGICAL.styleDialogue);
}

export function sourceTextExpression(role: StyleRole): string {
  const roleComp = styleToken(role);
  return [
    "var base = text.sourceText;",
    `var sizeMul = ${controlValue(EFFECT_NAMES.fontSizeMultiplier)};`,
    "if (sizeMul < 0.01) sizeMul = 0.01;",
    `var unifyFont = ${controlValue(EFFECT_NAMES.unifyFont)} > 0.5;`,
    `var unifyColor = ${controlValue(EFFECT_NAMES.unifyColor)} > 0.5;`,
    `var fontSrc = comp(unifyFont ? "${compToken(LOGICAL.styleDialogue)}" : "${roleComp}").layer("${COMP.styleLayer}").text.sourceText.style;`,
    `var colorSrc = comp(unifyColor ? "${compToken(LOGICAL.styleDialogue)}" : "${roleComp}").layer("${COMP.styleLayer}").text.sourceText.style;`,
    `var sizeSrc = comp("${roleComp}").layer("${COMP.styleLayer}").text.sourceText.style;`,
    "var styled = base.style.setText(base);",
    "styled = styled.setFont(fontSrc.font);",
    "styled = styled.setFontSize(sizeSrc.fontSize * sizeMul);",
    "styled = styled.setAutoLeading(false);",
    "styled = styled.setLeading(sizeSrc.leading * sizeMul);",
    "styled = styled.setApplyFill(true);",
    "styled = styled.setFillColor(colorSrc.fillColor);",
    "styled;",
  ].join("\n");
}

export function textOpacityExpression(): string {
  return [`var globalOp = ${controlValue(EFFECT_NAMES.globalTextOpacity)};`, "value * (globalOp / 100);"].join("\n");
}

export const CONTROL_GUIDE = [
  "这些控件不会出现在最终画面里。",
  "",
  "字号倍率：乘以对应样式层的基础字号和行距。1 为原始大小。",
  "全局文字不透明度：0 到 100，再乘每层自己的不透明度关键帧。",
  "统一字体 / 统一颜色：勾选后，全片改用「对话样式」层的字体或颜色。",
  "",
  "改样式层的字体、字号、行距、颜色会立刻作用于仍关联样式的文字。",
  "打字、逐行和淡入写在关键帧上。拖动关键帧即可改节奏。",
  "直接改对白不会被表达式写回旧文案。字数变化后，选中文字层运行 refresh_text_timing.jsx。",
  "同一生成包可以多次导入。每次导入是独立实例，控制器互不影响。",
].join("\n");
