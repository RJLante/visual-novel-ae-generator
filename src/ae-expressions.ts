import { COMP, EFFECT_NAMES, type StyleRole } from "./types";

function controlValue(effectName: string): string {
  return `comp("${COMP.control}").layer("${COMP.ctrlLayer}").effect("${effectName}")(1)`;
}

function modeLines(presetMode: number): string[] {
  return [
    `var presetMode = ${presetMode};`,
    `var modeSlider = Math.round(${controlValue(EFFECT_NAMES.textAnimationMode)});`,
    "var mode = modeSlider === 0 ? presetMode : modeSlider;",
  ];
}

export function sourceTextExpression(role: StyleRole): string {
  const roleComp =
    role === "narration" ? COMP.styleNarration : role === "option" ? COMP.styleOption : COMP.styleDialogue;
  return [
    "var base = text.sourceText;",
    `var sizeMul = ${controlValue(EFFECT_NAMES.fontSizeMultiplier)};`,
    "if (sizeMul < 0.01) sizeMul = 0.01;",
    `var unifyFont = ${controlValue(EFFECT_NAMES.unifyFont)} > 0.5;`,
    `var unifyColor = ${controlValue(EFFECT_NAMES.unifyColor)} > 0.5;`,
    `var fontSrc = comp(unifyFont ? "${COMP.styleDialogue}" : "${roleComp}").layer("${COMP.styleLayer}").text.sourceText.style;`,
    `var colorSrc = comp(unifyColor ? "${COMP.styleDialogue}" : "${roleComp}").layer("${COMP.styleLayer}").text.sourceText.style;`,
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

export function revealExpressions(input: {
  revealFrames: number[];
  lineFrames: number[];
  presetMode: number;
  fps: number;
  holdInFrames: number;
  eventFrames: number;
}): { start: string; end: string; amount: string } {
  const start = [
    `var REVEAL_FRAMES = /*VN_REVEAL*/${JSON.stringify(input.revealFrames)}/*VN_END*/;`,
    `var LINE_FRAMES = /*VN_LINES*/${JSON.stringify(input.lineFrames)}/*VN_END*/;`,
    `var EVENT_FRAMES = /*VN_EVENT*/${input.eventFrames}/*VN_END*/;`,
    `var FPS = ${input.fps};`,
    `var HOLD_IN = ${input.holdInFrames};`,
    ...modeLines(input.presetMode),
    `var speed = ${controlValue(EFFECT_NAMES.previewSpeed)};`,
    "if (speed < 0.01) speed = 0.01;",
    "var frame = Math.floor((time - inPoint) * FPS * speed + 0.0001) - HOLD_IN;",
    "if (frame < 0) frame = 0;",
    "var count = 0;",
    "if (mode !== 2) {",
    "  var frames = mode === 3 ? LINE_FRAMES : REVEAL_FRAMES;",
    "  for (var i = 0; i < frames.length; i++) {",
    "    if (frame >= frames[i]) count++;",
    "  }",
    "}",
    "count;",
  ].join("\n");

  const end = [...modeLines(input.presetMode), "var endIndex = mode === 2 ? 0 : 100000;", "endIndex;"].join("\n");
  const amount = [...modeLines(input.presetMode), "var amount = mode === 2 ? 0 : 100;", "amount;"].join("\n");
  return { start, end, amount };
}

export function textOpacityExpression(input: {
  presetMode: number;
  fps: number;
  holdInFrames: number;
  fadeFrames: number;
  fadeWithMode: boolean;
}): string {
  if (!input.fadeWithMode) {
    return [`var globalOp = ${controlValue(EFFECT_NAMES.globalTextOpacity)};`, "value * (globalOp / 100);"].join("\n");
  }
  return [
    `var FPS = ${input.fps};`,
    `var HOLD_IN = ${input.holdInFrames};`,
    `var FADE_FRAMES = ${input.fadeFrames};`,
    ...modeLines(input.presetMode),
    `var globalOp = ${controlValue(EFFECT_NAMES.globalTextOpacity)};`,
    `var speed = ${controlValue(EFFECT_NAMES.previewSpeed)};`,
    "if (speed < 0.01) speed = 0.01;",
    "var frame = Math.floor((time - inPoint) * FPS * speed + 0.0001) - HOLD_IN;",
    "if (frame < 0) frame = 0;",
    "var anim = 100;",
    "if (mode === 2) {",
    "  anim = FADE_FRAMES <= 0 ? 100 : Math.max(0, Math.min(100, (frame / FADE_FRAMES) * 100));",
    "}",
    "value * (globalOp / 100) * (anim / 100);",
  ].join("\n");
}

export const CONTROL_GUIDE = [
  "这些控件不会出现在最终画面里。",
  "",
  "字号倍率：乘以对应样式层的基础字号和行距。1 为原始大小。",
  "全局文字不透明度：0 到 100，再乘每层自己的不透明度和动画显隐。",
  "文字动画模式：0 使用事件预设，1 打字机，2 整段淡入，3 逐行出现。",
  "预览速度：只改变文字显示快慢，不重排时间轴。正式改节奏请改配置后重新生成，新工程会回到 1。",
  "统一字体 / 统一颜色：勾选后，全片改用「对话样式」层的字体或颜色。",
  "",
  "改样式层的字体、字号、行距、颜色会立刻作用于对应文字。",
  "直接改对白不会被表达式写回旧文案。若字数变化导致打字对不上，请运行 refresh_text_timing.jsx。",
].join("\n");
