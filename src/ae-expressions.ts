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
    `var styleSrc = comp("${roleComp}").layer("${COMP.styleLayer}").text.sourceText.style;`,
    "var styled = base.style.setText(base);",
    "styled = styled.setFont(styleSrc.font);",
    "styled = styled.setFontSize(styleSrc.fontSize);",
    "styled = styled.setAutoLeading(!!styleSrc.autoLeading);",
    "if (!styleSrc.autoLeading) styled = styled.setLeading(styleSrc.leading);",
    "styled = styled.setApplyFill(true);",
    "styled = styled.setFillColor(styleSrc.fillColor);",
    "styled;",
  ].join("\n");
}

export function textOpacityExpression(): string {
  return [`var globalOp = ${controlValue(EFFECT_NAMES.globalTextOpacity)};`, "value * (globalOp / 100);"].join("\n");
}

export const CONTROL_GUIDE = [
  "这些控件不会出现在最终画面里。",
  "",
  "全局文字不透明度：0 到 100，再乘每层自己的不透明度关键帧。",
  "字体、字号、行距和颜色写在对应的样式层上，对白、旁白、选项各自独立。",
  "",
  "打字和逐字淡入写在关键帧上。拖动关键帧即可改单层节奏。",
  "直接改对白不会被表达式写回旧文案。字数变化后，在「文字冒险」面板里选中文字层，更新文字动画。",
  "播放速度从导入时的时间基准重算，不会在当前时长上反复相除。",
  "同一作品包版本再次导入会打开已有片段。新版本会新建实例。",
].join("\n");
