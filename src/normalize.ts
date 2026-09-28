import {
  DEFAULT_TIMING,
  FRAME_FPS,
  FRAME_HEIGHT,
  FRAME_WIDTH,
  LONG_PAUSE_CHARS,
  SHORT_PAUSE_CHARS,
  type AnimationName,
  type Issue,
  type NormalizedChoiceEvent,
  type NormalizedEvent,
  type NormalizedProject,
  type NormalizedScene,
  type NormalizedTextEvent,
  type NormalizedTransitionEvent,
  type TextStyle,
  type TimingSettings,
} from "./types";

const ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const COMBINING_RANGES: Array<[number, number]> = [
  [0x0300, 0x036f],
  [0x1ab0, 0x1aff],
  [0x1dc0, 0x1dff],
  [0x20d0, 0x20ff],
  [0xfe20, 0xfe2f],
];

export function normalizeProject(rawProject: unknown, rawTheme: unknown, rawScript: unknown): {
  project?: NormalizedProject;
  errors: Issue[];
} {
  const errors: Issue[] = [];
  const project = asObject(rawProject, "project.json", errors);
  const theme = asObject(rawTheme, "theme.json", errors);
  const script = asObject(rawScript, "script.json", errors);
  if (!project || !theme || !script) return { errors };

  const schemaVersion = readNumber(project, "schemaVersion", "project.json", errors);
  if (schemaVersion !== undefined && schemaVersion !== 1) {
    errors.push({ path: "project.json.schemaVersion", message: "第一版只接受 schemaVersion = 1" });
  }

  const id = readId(project, "id", "project.json", errors);
  const name = readNonEmptyString(project, "name", "project.json", errors);
  const width = readNumber(project, "width", "project.json", errors);
  const height = readNumber(project, "height", "project.json", errors);
  const fps = readNumber(project, "fps", "project.json", errors);
  if (width !== undefined && width !== FRAME_WIDTH) {
    errors.push({ path: "project.json.width", message: "第一版画面宽度固定为 1920" });
  }
  if (height !== undefined && height !== FRAME_HEIGHT) {
    errors.push({ path: "project.json.height", message: "第一版画面高度固定为 1080" });
  }
  if (fps !== undefined && fps !== FRAME_FPS) {
    errors.push({ path: "project.json.fps", message: "第一版帧率固定为 30" });
  }

  const timing = readTiming(project.timing, errors);
  const themeId = readId(theme, "id", "theme.json", errors);
  const assets = readAssets(theme.assets, errors);
  const layout = readLayout(theme.layout, errors);
  const styles = readStyles(theme.styles, errors);
  const optionBackground = readOptionBackground(theme.styles, errors);
  const scenes = readScenes(script.scenes, timing, errors);

  if (errors.length > 0 || !id || !name || !themeId || !assets || !layout || !styles || !optionBackground) {
    return { errors };
  }

  return {
    errors,
    project: {
      id,
      name,
      width: FRAME_WIDTH,
      height: FRAME_HEIGHT,
      fps: FRAME_FPS,
      timing,
      theme: {
        id: themeId,
        assets,
        layout,
        styles,
        optionBackground,
      },
      scenes,
    },
  };
}

export function normalizeText(raw: string, path: string, errors: Issue[]): string | undefined {
  const nfc = raw.normalize("NFC").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const text = nfc.endsWith("\n") ? nfc.slice(0, -1) : nfc;
  if (text.length === 0) {
    errors.push({ path, message: "文本不能为空" });
    return undefined;
  }
  for (const ch of text) {
    const reason = unsafeCharReason(ch);
    if (reason) {
      errors.push({ path, message: `文本含有不支持的字符（${reason}）：${JSON.stringify(ch)}` });
      return undefined;
    }
  }
  if (![...text].some((ch) => ch !== "\n")) {
    errors.push({ path, message: "文本至少要有一个可见字符" });
    return undefined;
  }
  return text;
}

function readTiming(raw: unknown, errors: Issue[]): TimingSettings {
  const timing = { ...DEFAULT_TIMING };
  if (raw === undefined) return timing;
  const obj = asObject(raw, "project.json.timing", errors);
  if (!obj) return timing;
  assignPositive(obj, "charactersPerSecond", "project.json.timing", timing, errors);
  assignNonNegative(obj, "lineIntervalSeconds", "project.json.timing", timing, errors);
  assignNonNegative(obj, "defaultHoldSeconds", "project.json.timing", timing, errors);
  assignNonNegative(obj, "commaPauseSeconds", "project.json.timing", timing, errors);
  assignNonNegative(obj, "sentencePauseSeconds", "project.json.timing", timing, errors);
  assignNonNegative(obj, "fadeSeconds", "project.json.timing", timing, errors);
  const staggerExplicit = obj.optionStaggerSeconds !== undefined;
  assignNonNegative(obj, "optionStaggerSeconds", "project.json.timing", timing, errors);
  if (!staggerExplicit) timing.optionStaggerSeconds = timing.lineIntervalSeconds;
  assignNonNegative(obj, "choiceWaitBeforeMoveSeconds", "project.json.timing", timing, errors);
  assignNonNegative(obj, "choiceMoveSeconds", "project.json.timing", timing, errors);
  assignNonNegative(obj, "choiceHoldAfterSelectSeconds", "project.json.timing", timing, errors);
  if (timing.charactersPerSecond <= 0) {
    errors.push({ path: "project.json.timing.charactersPerSecond", message: "每秒字符数必须大于 0" });
  }
  return timing;
}

function readAssets(raw: unknown, errors: Issue[]): NormalizedProject["theme"]["assets"] | undefined {
  const obj = asObject(raw, "theme.json.assets", errors);
  if (!obj) return undefined;
  const background = readNonEmptyString(obj, "background", "theme.json.assets", errors);
  const dialogueFrame = readNonEmptyString(obj, "dialogueFrame", "theme.json.assets", errors);
  const cursor = readNonEmptyString(obj, "cursor", "theme.json.assets", errors);
  if (!background || !dialogueFrame || !cursor) return undefined;
  return { background, dialogueFrame, cursor };
}

function readLayout(raw: unknown, errors: Issue[]): NormalizedProject["theme"]["layout"] | undefined {
  const obj = asObject(raw, "theme.json.layout", errors);
  if (!obj) return undefined;
  const dialogueBox = readRect(obj.dialogueBox, "theme.json.layout.dialogueBox", errors);
  const dialogueText = readRect(obj.dialogueText, "theme.json.layout.dialogueText", errors);
  const narrationText = readRect(obj.narrationText, "theme.json.layout.narrationText", errors);
  const optionsObj = asObject(obj.options, "theme.json.layout.options", errors);
  if (!dialogueBox || !dialogueText || !narrationText || !optionsObj) return undefined;
  const x = readNumber(optionsObj, "x", "theme.json.layout.options", errors);
  const y = readNumber(optionsObj, "y", "theme.json.layout.options", errors);
  const width = readNumber(optionsObj, "width", "theme.json.layout.options", errors);
  const itemHeight = readNumber(optionsObj, "itemHeight", "theme.json.layout.options", errors);
  const gap = readNumber(optionsObj, "gap", "theme.json.layout.options", errors);
  if ([x, y, width, itemHeight, gap].some((value) => value === undefined)) return undefined;
  if (width! <= 0 || itemHeight! <= 0 || gap! < 0) {
    errors.push({ path: "theme.json.layout.options", message: "选项宽度和行高必须大于 0，间距不能为负" });
    return undefined;
  }
  return {
    dialogueBox,
    dialogueText,
    narrationText,
    options: { x: x!, y: y!, width: width!, itemHeight: itemHeight!, gap: gap! },
  };
}

function readStyles(raw: unknown, errors: Issue[]): NormalizedProject["theme"]["styles"] | undefined {
  const obj = asObject(raw, "theme.json.styles", errors);
  if (!obj) return undefined;
  const dialogue = readStyle(obj.dialogue, "theme.json.styles.dialogue", errors);
  const narration = readStyle(obj.narration, "theme.json.styles.narration", errors);
  const option = readStyle(obj.option, "theme.json.styles.option", errors);
  if (!dialogue || !narration || !option) return undefined;
  return { dialogue, narration, option };
}

function readOptionBackground(
  rawStyles: unknown,
  errors: Issue[],
): NormalizedProject["theme"]["optionBackground"] | undefined {
  const fallback = { color: "#102433", rgb: [16 / 255, 36 / 255, 51 / 255] as [number, number, number], opacity: 80 };
  if (!rawStyles || typeof rawStyles !== "object") return fallback;
  const styles = rawStyles as Record<string, unknown>;
  if (styles.optionBackground === undefined) return fallback;
  const obj = asObject(styles.optionBackground, "theme.json.styles.optionBackground", errors);
  if (!obj) return undefined;
  const color = readColor(obj, "color", "theme.json.styles.optionBackground", errors);
  const opacity = obj.opacity === undefined ? 80 : readNumber(obj, "opacity", "theme.json.styles.optionBackground", errors);
  if (!color || opacity === undefined) return undefined;
  if (opacity < 0 || opacity > 100) {
    errors.push({ path: "theme.json.styles.optionBackground.opacity", message: "不透明度必须在 0 到 100 之间" });
    return undefined;
  }
  return { color: color.hex, rgb: color.rgb, opacity };
}

function readScenes(raw: unknown, timing: TimingSettings, errors: Issue[]): NormalizedScene[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    errors.push({ path: "script.json.scenes", message: "至少要有一个场景" });
    return [];
  }
  const scenes: NormalizedScene[] = [];
  const seen = new Set<string>();
  raw.forEach((sceneRaw, sceneIndex) => {
    const path = `script.json.scenes[${sceneIndex}]`;
    const scene = asObject(sceneRaw, path, errors);
    if (!scene) return;
    const id = readId(scene, "id", path, errors);
    if (id && seen.has(id)) errors.push({ path: `${path}.id`, message: `场景 ID 重复：${id}` });
    if (id) seen.add(id);
    const events = readEvents(scene.events, `${path}.events`, timing, errors);
    if (id) scenes.push({ id, events });
  });
  const eventIds = new Set<string>();
  for (const scene of scenes) {
    for (const event of scene.events) {
      if (eventIds.has(event.id)) {
        errors.push({ path: `script.json event ${event.id}`, message: `事件 ID 重复：${event.id}` });
      }
      eventIds.add(event.id);
    }
  }
  return scenes;
}

function readEvents(raw: unknown, path: string, timing: TimingSettings, errors: Issue[]): NormalizedEvent[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    errors.push({ path, message: "场景至少要有一个事件" });
    return [];
  }
  const events: NormalizedEvent[] = [];
  raw.forEach((eventRaw, index) => {
    const eventPath = `${path}[${index}]`;
    const event = asObject(eventRaw, eventPath, errors);
    if (!event) return;
    const id = readId(event, "id", eventPath, errors);
    const type = readNonEmptyString(event, "type", eventPath, errors);
    if (!id || !type) return;
    if (type === "dialogue" || type === "narration") {
      const parsed = readTextEvent(event, eventPath, id, type, timing, errors);
      if (parsed) events.push(parsed);
      return;
    }
    if (type === "choice") {
      const parsed = readChoiceEvent(event, eventPath, id, timing, errors);
      if (parsed) events.push(parsed);
      return;
    }
    if (type === "transition") {
      const parsed = readTransitionEvent(event, eventPath, id, errors);
      if (parsed) events.push(parsed);
      return;
    }
    errors.push({ path: `${eventPath}.type`, message: `不支持的事件类型：${type}` });
  });
  return events;
}

function readTextEvent(
  event: Record<string, unknown>,
  path: string,
  id: string,
  type: "dialogue" | "narration",
  timing: TimingSettings,
  errors: Issue[],
): NormalizedTextEvent | undefined {
  const rawText = readNonEmptyString(event, "text", path, errors);
  const text = rawText ? normalizeText(rawText, `${path}.text`, errors) : undefined;
  const animation = readAnimation(event.animation, `${path}.animation`, type === "dialogue" ? "typewriter" : "fade", errors);
  const holdSeconds = readOptionalSeconds(event, "holdSeconds", path, timing.defaultHoldSeconds, errors);
  const durationSeconds = readOptionalOverride(event, path, errors);
  if (!text || animation === undefined || holdSeconds === undefined) return undefined;
  return { id, type, text, animation, holdSeconds, ...(durationSeconds === undefined ? {} : { durationSeconds }) };
}

function readChoiceEvent(
  event: Record<string, unknown>,
  path: string,
  id: string,
  timing: TimingSettings,
  errors: Issue[],
): NormalizedChoiceEvent | undefined {
  if (!Array.isArray(event.options) || event.options.length < 2) {
    errors.push({ path: `${path}.options`, message: "选项事件至少要有两个选项" });
    return undefined;
  }
  const options: NormalizedChoiceEvent["options"] = [];
  const seen = new Set<string>();
  event.options.forEach((optionRaw, index) => {
    const optionPath = `${path}.options[${index}]`;
    const option = asObject(optionRaw, optionPath, errors);
    if (!option) return;
    const optionId = readId(option, "id", optionPath, errors);
    const rawText = readNonEmptyString(option, "text", optionPath, errors);
    const text = rawText ? normalizeText(rawText, `${optionPath}.text`, errors) : undefined;
    if (!optionId || !text) return;
    if (seen.has(optionId)) errors.push({ path: `${optionPath}.id`, message: `选项 ID 重复：${optionId}` });
    seen.add(optionId);
    options.push({ id: optionId, text });
  });
  const initialOptionId = readNonEmptyString(event, "initialOptionId", path, errors);
  const selectedOptionId = readNonEmptyString(event, "selectedOptionId", path, errors);
  if (initialOptionId && !seen.has(initialOptionId)) {
    errors.push({ path: `${path}.initialOptionId`, message: `初始选项不存在：${initialOptionId}` });
  }
  if (selectedOptionId && !seen.has(selectedOptionId)) {
    errors.push({ path: `${path}.selectedOptionId`, message: `选中选项不存在：${selectedOptionId}` });
  }
  const waitBeforeMoveSeconds = readOptionalSeconds(
    event,
    "waitBeforeMoveSeconds",
    path,
    timing.choiceWaitBeforeMoveSeconds,
    errors,
  );
  const moveSeconds = readOptionalSeconds(event, "moveSeconds", path, timing.choiceMoveSeconds, errors);
  const holdAfterSelectSeconds = readOptionalSeconds(
    event,
    "holdAfterSelectSeconds",
    path,
    timing.choiceHoldAfterSelectSeconds,
    errors,
  );
  const durationSeconds = readOptionalOverride(event, path, errors);
  if (
    options.length < 2 ||
    !initialOptionId ||
    !selectedOptionId ||
    waitBeforeMoveSeconds === undefined ||
    moveSeconds === undefined ||
    holdAfterSelectSeconds === undefined
  ) {
    return undefined;
  }
  return {
    id,
    type: "choice",
    options,
    initialOptionId,
    selectedOptionId,
    waitBeforeMoveSeconds,
    moveSeconds,
    holdAfterSelectSeconds,
    ...(durationSeconds === undefined ? {} : { durationSeconds }),
  };
}

function readTransitionEvent(
  event: Record<string, unknown>,
  path: string,
  id: string,
  errors: Issue[],
): NormalizedTransitionEvent | undefined {
  const preset = event.preset === undefined ? "fadeBlack" : event.preset;
  if (preset !== "fadeBlack") {
    errors.push({ path: `${path}.preset`, message: "第一版只支持 fadeBlack 转场" });
    return undefined;
  }
  const durationSeconds = readNumber(event, "durationSeconds", path, errors);
  if (durationSeconds === undefined) return undefined;
  if (durationSeconds <= 0) {
    errors.push({ path: `${path}.durationSeconds`, message: "转场时长必须大于 0" });
    return undefined;
  }
  return { id, type: "transition", preset: "fadeBlack", durationSeconds };
}

function readAnimation(raw: unknown, path: string, fallback: AnimationName, errors: Issue[]): AnimationName | undefined {
  if (raw === undefined) return fallback;
  if (raw === "typewriter" || raw === "fade" || raw === "lines") return raw;
  errors.push({ path, message: "动画必须是 typewriter、fade 或 lines" });
  return undefined;
}

function readStyle(raw: unknown, path: string, errors: Issue[]): TextStyle | undefined {
  const obj = asObject(raw, path, errors);
  if (!obj) return undefined;
  const font = readNonEmptyString(obj, "font", path, errors);
  const fontSize = readNumber(obj, "fontSize", path, errors);
  const lineHeight = readNumber(obj, "lineHeight", path, errors);
  const color = readColor(obj, "color", path, errors);
  if (!font || fontSize === undefined || lineHeight === undefined || !color) return undefined;
  if (fontSize <= 0 || lineHeight <= 0) {
    errors.push({ path, message: "字号和行距必须大于 0" });
    return undefined;
  }
  return { font, fontSize, lineHeight, color: color.hex, rgb: color.rgb };
}

function readRect(raw: unknown, path: string, errors: Issue[]): { x: number; y: number; width: number; height: number } | undefined {
  const obj = asObject(raw, path, errors);
  if (!obj) return undefined;
  const x = readNumber(obj, "x", path, errors);
  const y = readNumber(obj, "y", path, errors);
  const width = readNumber(obj, "width", path, errors);
  const height = readNumber(obj, "height", path, errors);
  if ([x, y, width, height].some((value) => value === undefined)) return undefined;
  if (width! <= 0 || height! <= 0) {
    errors.push({ path, message: "宽度和高度必须大于 0" });
    return undefined;
  }
  return { x: x!, y: y!, width: width!, height: height! };
}

function readColor(
  obj: Record<string, unknown>,
  key: string,
  path: string,
  errors: Issue[],
): { hex: string; rgb: [number, number, number] } | undefined {
  const value = obj[key];
  if (typeof value !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(value)) {
    errors.push({ path: `${path}.${key}`, message: "颜色必须是 #RRGGBB" });
    return undefined;
  }
  const hex = value.toUpperCase();
  const r = Number.parseInt(hex.slice(1, 3), 16) / 255;
  const g = Number.parseInt(hex.slice(3, 5), 16) / 255;
  const b = Number.parseInt(hex.slice(5, 7), 16) / 255;
  return { hex, rgb: [r, g, b] };
}

function readOptionalSeconds(
  obj: Record<string, unknown>,
  key: string,
  path: string,
  fallback: number,
  errors: Issue[],
): number | undefined {
  if (obj[key] === undefined) return fallback;
  const value = readNumber(obj, key, path, errors);
  if (value === undefined) return undefined;
  if (value < 0) {
    errors.push({ path: `${path}.${key}`, message: "时间不能为负" });
    return undefined;
  }
  return value;
}

function readOptionalOverride(obj: Record<string, unknown>, path: string, errors: Issue[]): number | undefined {
  if (obj.durationSeconds === undefined) return undefined;
  const value = readNumber(obj, "durationSeconds", path, errors);
  if (value === undefined) return undefined;
  if (value <= 0) {
    errors.push({ path: `${path}.durationSeconds`, message: "覆盖时长必须大于 0" });
    return undefined;
  }
  return value;
}

function unsafeCharReason(ch: string): string | undefined {
  const cp = ch.codePointAt(0)!;
  if (ch === "\n") return undefined;
  if (ch === "\t") return "制表符";
  if (cp > 0xffff) return "需要用代理对表示，字符索引会和 AE 不一致";
  if (cp >= 0xfe00 && cp <= 0xfe0f) return "变体选择符";
  if (cp === 0x200d || cp === 0xfeff || (cp >= 0x200b && cp <= 0x200f) || (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2060 && cp <= 0x2064)) {
    return "零宽或方向控制符";
  }
  if (COMBINING_RANGES.some(([start, end]) => cp >= start && cp <= end)) return "组合附加符号";
  return undefined;
}

function asObject(raw: unknown, path: string, errors: Issue[]): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    errors.push({ path, message: "必须是对象" });
    return undefined;
  }
  return raw as Record<string, unknown>;
}

function readId(obj: Record<string, unknown>, key: string, path: string, errors: Issue[]): string | undefined {
  const value = readNonEmptyString(obj, key, path, errors);
  if (!value) return undefined;
  if (!ID_PATTERN.test(value)) {
    errors.push({ path: `${path}.${key}`, message: "ID 只能包含字母、数字、下划线和连字符" });
    return undefined;
  }
  return value;
}

function readNonEmptyString(obj: Record<string, unknown>, key: string, path: string, errors: Issue[]): string | undefined {
  const value = obj[key];
  if (typeof value !== "string" || value.trim() === "") {
    errors.push({ path: `${path}.${key}`, message: "必须是非空字符串" });
    return undefined;
  }
  return value;
}

function readNumber(obj: Record<string, unknown>, key: string, path: string, errors: Issue[]): number | undefined {
  const value = obj[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors.push({ path: `${path}.${key}`, message: "必须是有限数字" });
    return undefined;
  }
  return value;
}

function assignPositive(
  obj: Record<string, unknown>,
  key: keyof TimingSettings,
  path: string,
  timing: TimingSettings,
  errors: Issue[],
): void {
  if (obj[key] === undefined) return;
  const value = readNumber(obj, key, path, errors);
  if (value === undefined) return;
  if (value <= 0) {
    errors.push({ path: `${path}.${key}`, message: "必须大于 0" });
    return;
  }
  timing[key] = value;
}

function assignNonNegative(
  obj: Record<string, unknown>,
  key: keyof TimingSettings,
  path: string,
  timing: TimingSettings,
  errors: Issue[],
): void {
  if (obj[key] === undefined) return;
  const value = readNumber(obj, key, path, errors);
  if (value === undefined) return;
  if (value < 0) {
    errors.push({ path: `${path}.${key}`, message: "不能为负" });
    return;
  }
  timing[key] = value;
}

export function pauseCharacterTable(): { shortPauseChars: string; longPauseChars: string } {
  return { shortPauseChars: SHORT_PAUSE_CHARS, longPauseChars: LONG_PAUSE_CHARS };
}
