export const GENERATOR_VERSION = "0.1.0";

export const FRAME_WIDTH = 1920;
export const FRAME_HEIGHT = 1080;
export const FRAME_FPS = 30;

export const SHORT_PAUSE_CHARS = ",;:，；：、";
export const LONG_PAUSE_CHARS = ".?!。？！…";

export const DEFAULT_TIMING = {
  charactersPerSecond: 12,
  lineIntervalSeconds: 0.5,
  defaultHoldSeconds: 1.2,
  commaPauseSeconds: 0.12,
  sentencePauseSeconds: 0.3,
  fadeSeconds: 0.4,
  optionStaggerSeconds: 0.5,
  choiceWaitBeforeMoveSeconds: 0.8,
  choiceMoveSeconds: 0.2,
  choiceHoldAfterSelectSeconds: 0.6,
} as const;

export const EFFECT_NAMES = {
  fontSizeMultiplier: "字号倍率",
  globalTextOpacity: "全局文字不透明度",
  textAnimationMode: "文字动画模式",
  previewSpeed: "预览速度",
  unifyFont: "统一字体",
  unifyColor: "统一颜色",
} as const;

export const COMP = {
  master: "MASTER",
  overlay: "USER_OVERLAY",
  control: "CONTROL",
  ctrlLayer: "CTRL",
  styleLayer: "STYLE",
  styleDialogue: "STYLE_DIALOGUE",
  styleNarration: "STYLE_NARRATION",
  styleOption: "STYLE_OPTION",
} as const;

export const FOLDERS = ["ASSETS", "SOLIDS", "GLOBAL", "EVENTS", "SCENES"] as const;

export type AnimationName = "typewriter" | "fade" | "lines";
export type StyleRole = "dialogue" | "narration" | "option";

export interface Issue {
  path: string;
  message: string;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface TimingSettings {
  charactersPerSecond: number;
  lineIntervalSeconds: number;
  defaultHoldSeconds: number;
  commaPauseSeconds: number;
  sentencePauseSeconds: number;
  fadeSeconds: number;
  optionStaggerSeconds: number;
  choiceWaitBeforeMoveSeconds: number;
  choiceMoveSeconds: number;
  choiceHoldAfterSelectSeconds: number;
}

export interface TextStyle {
  font: string;
  fontSize: number;
  lineHeight: number;
  color: string;
  rgb: [number, number, number];
}

export interface ThemeLayout {
  dialogueBox: Rect;
  dialogueText: Rect;
  narrationText: Rect;
  options: {
    x: number;
    y: number;
    width: number;
    itemHeight: number;
    gap: number;
  };
}

export interface NormalizedProject {
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  timing: TimingSettings;
  theme: {
    id: string;
    assets: {
      background: string;
      dialogueFrame: string;
      cursor: string;
    };
    layout: ThemeLayout;
    styles: {
      dialogue: TextStyle;
      narration: TextStyle;
      option: TextStyle;
    };
    optionBackground: { color: string; rgb: [number, number, number]; opacity: number };
  };
  scenes: NormalizedScene[];
}

export interface NormalizedScene {
  id: string;
  events: NormalizedEvent[];
}

export type NormalizedEvent =
  | NormalizedTextEvent
  | NormalizedChoiceEvent
  | NormalizedTransitionEvent;

export interface NormalizedTextEvent {
  id: string;
  type: "dialogue" | "narration";
  text: string;
  animation: AnimationName;
  holdSeconds: number;
  durationSeconds?: number;
}

export interface NormalizedChoiceOption {
  id: string;
  text: string;
}

export interface NormalizedChoiceEvent {
  id: string;
  type: "choice";
  options: NormalizedChoiceOption[];
  initialOptionId: string;
  selectedOptionId: string;
  waitBeforeMoveSeconds: number;
  moveSeconds: number;
  holdAfterSelectSeconds: number;
  durationSeconds?: number;
}

export interface NormalizedTransitionEvent {
  id: string;
  type: "transition";
  preset: "fadeBlack";
  durationSeconds: number;
}

export interface ImageAsset {
  id: "background" | "dialogueFrame" | "cursor";
  sourceRelativePath: string;
  outputRelativePath: string;
  absoluteSourcePath: string;
  width: number;
  height: number;
}

export interface Keyframe {
  frame: number;
  value: number;
}

export interface PositionKeyframe {
  frame: number;
  x: number;
  y: number;
  interp: "hold" | "linear";
}

export interface SliderEffect {
  type: "slider";
  name: string;
  value: number;
}

export interface CheckboxEffect {
  type: "checkbox";
  name: string;
  value: boolean;
}

export type LayerEffect = SliderEffect | CheckboxEffect;

export interface RevealExpressions {
  start: string;
  end: string;
  amount: string;
}

export interface CompiledLayer {
  name: string;
  kind: "text" | "footage" | "solid" | "null" | "precomp";
  aeText?: string;
  box?: Rect;
  font?: string;
  fontSize?: number;
  lineHeight?: number;
  rgb?: [number, number, number];
  sourceTextExpression?: string;
  opacityExpression?: string;
  reveal?: RevealExpressions;
  assetId?: "background" | "dialogueFrame" | "cursor";
  fit?: Rect;
  color?: [number, number, number];
  solidWidth?: number;
  solidHeight?: number;
  compName?: string;
  effects?: LayerEffect[];
  anchor?: [number, number];
  position?: [number, number];
  opacityKeys?: Keyframe[];
  positionKeys?: PositionKeyframe[];
  inFrame?: number;
  outFrame?: number;
  comment?: string;
}

export interface CompiledComp {
  name: string;
  folder: (typeof FOLDERS)[number] | "ROOT";
  width: number;
  height: number;
  durationFrames: number;
  layers: CompiledLayer[];
}

export interface TimelineEntry {
  sceneId: string;
  id: string;
  type: string;
  startFrame: number;
  endFrame: number;
  durationFrames: number;
}

export interface CompiledProject {
  schemaVersion: 1;
  generatorVersion: string;
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  durationFrames: number;
  masterName: string;
  folders: string[];
  timing: TimingSettings & {
    fps: number;
    shortPauseChars: string;
    longPauseChars: string;
  };
  assets: Array<{
    id: ImageAsset["id"];
    relativePath: string;
    absolutePath: string;
    width: number;
    height: number;
  }>;
  timeline: TimelineEntry[];
  comps: CompiledComp[];
  saveFileName: string;
}
