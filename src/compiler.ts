import { createHash } from "node:crypto";
import path from "node:path";
import {
  COMP,
  EFFECT_NAMES,
  eventLogicalId,
  FOLDERS,
  FRAME_HEIGHT,
  FRAME_WIDTH,
  GENERATOR_VERSION,
  LOGICAL,
  LONG_PAUSE_CHARS,
  sceneLogicalId,
  SHORT_PAUSE_CHARS,
  textLogicalId,
  type CompiledComp,
  type CompiledLayer,
  type CompiledProject,
  type ImageAsset,
  type InstanceBaseline,
  type Issue,
  type Keyframe,
  type NormalizedChoiceEvent,
  type NormalizedEvent,
  type NormalizedProject,
  type NormalizedTextEvent,
  type PositionKeyframe,
  type StyleRole,
  type TimelineEntry,
} from "./types";
import { CONTROL_GUIDE, sourceTextExpression, textOpacityExpression } from "./ae-expressions";
import { pausesFromPunctuation } from "./animation-plan";
import {
  fadeOpacityKeyframes,
  planCharacters,
  revealFramesFor,
  revealKeyframes,
  secondsToFrames,
  type CharacterPlan,
} from "./timing";

interface TimedEvent {
  source: NormalizedEvent;
  logicalStart: number;
  durationFrames: number;
  holdInFrames: number;
  holdOutFrames: number;
  fadeOutFrames?: number;
  fadeInFrames?: number;
  holdBlack?: boolean;
  plan?: CharacterPlan;
}

interface TimedScene {
  id: string;
  logicalStart: number;
  durationFrames: number;
  leadFrames: number;
  fadeInFrames: number;
  fadeInFrom?: string;
  events: TimedEvent[];
}

export function compile(
  project: NormalizedProject,
  assets: ImageAsset[],
  outputDir: string,
): { compiled?: CompiledProject; errors: Issue[]; warnings: Issue[] } {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  warnLayout(project, warnings);

  const scenes = timeScenes(project, errors);
  if (errors.length > 0) return { errors, warnings };

  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const comps: CompiledComp[] = [];
  comps.push(controlComp(project));
  comps.push(styleComp(COMP.styleDialogue, "对话样式", project.theme.styles.dialogue, project));
  comps.push(styleComp(COMP.styleNarration, "旁白样式", project.theme.styles.narration, project));
  comps.push(styleComp(COMP.styleOption, "选项样式", project.theme.styles.option, project));

  const timeline: TimelineEntry[] = [];
  for (const scene of scenes) {
    for (const event of scene.events) {
      if (event.source.type === "transition") {
        comps.push(transitionComp(event, project));
      } else if (event.source.type === "choice") {
        comps.push(choiceComp(event, event.source, project, assetById, errors));
      } else {
        comps.push(textEventComp(event, event.source, project, errors));
      }
      timeline.push({
        sceneId: scene.id,
        id: event.source.id,
        type: event.source.type,
        startFrame: scene.logicalStart + event.logicalStart,
        endFrame: scene.logicalStart + event.logicalStart + event.durationFrames,
        durationFrames: event.durationFrames,
      });
    }
    comps.push(sceneComp(scene, project, errors));
  }
  if (errors.length > 0) return { errors, warnings };

  const durationFrames = scenes.reduce((sum, scene) => sum + scene.durationFrames, 0);
  const identity = contentIdentity(project);
  comps.push({
    logicalId: LOGICAL.overlay,
    name: COMP.overlay,
    folder: "ROOT",
    width: project.width,
    height: project.height,
    durationFrames,
    layers: [],
  });
  comps.push(masterComp(scenes, durationFrames, project));

  return {
    errors,
    warnings,
    compiled: {
      schemaVersion: 3,
      packageHash: identity,
      baseline: baselineFor(scenes, project, durationFrames),
      generatorVersion: GENERATOR_VERSION,
      id: project.id,
      buildId: identity.slice(0, 8),
      name: project.name,
      width: project.width,
      height: project.height,
      fps: project.fps,
      durationFrames,
      masterName: COMP.master,
      folders: [...FOLDERS],
      timing: {
        ...project.timing,
        fps: project.fps,
        shortPauseChars: SHORT_PAUSE_CHARS,
        longPauseChars: LONG_PAUSE_CHARS,
      },
      assets: assets.map((asset) => ({
        id: asset.id,
        relativePath: asset.outputRelativePath,
        absolutePath: toSlash(path.join(outputDir, asset.outputRelativePath)),
        width: asset.width,
        height: asset.height,
      })),
      timeline,
      comps,
      saveFileName: `${project.id}.aep`,
    },
  };
}

function timeScenes(project: NormalizedProject, errors: Issue[]): TimedScene[] {
  const scenes: TimedScene[] = [];
  let globalFrame = 0;
  for (const scene of project.scenes) {
    let local = 0;
    const events: TimedEvent[] = [];
    for (const source of scene.events) {
      const durationFrames = eventDuration(source, project, errors);
      if (durationFrames === undefined) continue;
      events.push({
        source,
        logicalStart: local,
        durationFrames,
        holdInFrames: 0,
        holdOutFrames: 0,
      });
      local += durationFrames;
    }
    scenes.push({
      id: scene.id,
      logicalStart: globalFrame,
      durationFrames: local,
      leadFrames: 0,
      fadeInFrames: 0,
      events,
    });
    globalFrame += local;
  }
  applyTransitionHolds(scenes);
  for (const scene of scenes) {
    for (const event of scene.events) {
      const inFrame = scene.leadFrames + event.logicalStart - event.holdInFrames;
      const outFrame = scene.leadFrames + event.logicalStart + event.durationFrames + event.holdOutFrames;
      const compDuration = scene.leadFrames + scene.durationFrames;
      if (inFrame < 0 || outFrame > compDuration) {
        errors.push({
          path: `event ${event.source.id}`,
          message: `转场衔接超出场景范围：${inFrame}–${outFrame}，场景长度 ${compDuration}`,
        });
      }
    }
    if (scene.logicalStart < scene.leadFrames) {
      errors.push({
        path: `scene ${scene.id}`,
        message: "跨场景淡入比前一段转场更长，无法放到总时间轴上",
      });
    }
  }
  return scenes;
}

function applyTransitionHolds(scenes: TimedScene[]): void {
  scenes.forEach((scene, sceneIndex) => {
    scene.events.forEach((event, eventIndex) => {
      if (event.source.type !== "transition") return;
      const fadeOutFrames = Math.round(event.durationFrames / 2);
      const fadeInFrames = event.durationFrames - fadeOutFrames;
      event.fadeOutFrames = fadeOutFrames;
      event.fadeInFrames = fadeInFrames;
      const previous = scene.events[eventIndex - 1];
      const next = scene.events[eventIndex + 1];
      if (previous && previous.source.type !== "transition") previous.holdOutFrames += fadeOutFrames;
      if (next && next.source.type !== "transition") {
        next.holdInFrames += fadeInFrames;
        event.holdBlack = false;
        return;
      }
      event.holdBlack = true;
      const following = scenes[sceneIndex + 1];
      if (!next && following) {
        following.leadFrames = Math.max(following.leadFrames, fadeInFrames);
        following.fadeInFrames = Math.max(following.fadeInFrames, fadeInFrames);
        following.fadeInFrom = event.source.id;
        const firstContent = following.events.find((item) => item.source.type !== "transition");
        if (firstContent) firstContent.holdInFrames += fadeInFrames;
      }
    });
  });
}

function eventDuration(event: NormalizedEvent, project: NormalizedProject, errors: Issue[]): number | undefined {
  const fps = project.fps;
  if (event.type === "transition") {
    const frames = secondsToFrames(event.durationSeconds, fps);
    if (frames < 2) {
      errors.push({ path: `event ${event.id}`, message: "转场至少需要 2 帧" });
      return undefined;
    }
    return frames;
  }
  if (event.type === "choice") {
    const stagger = secondsToFrames(project.timing.optionStaggerSeconds, fps);
    const revealEnd = (event.options.length - 1) * stagger;
    const animation =
      revealEnd +
      secondsToFrames(event.waitBeforeMoveSeconds, fps) +
      secondsToFrames(event.moveSeconds, fps) +
      secondsToFrames(event.holdAfterSelectSeconds, fps);
    return overrideDuration(event.id, event.durationSeconds, animation, animation, fps, errors);
  }
  const plan = planCharacters(event.text, project.timing, fps);
  const reveal = revealFramesFor(event.animation, plan);
  const hold = secondsToFrames(event.holdSeconds, fps);
  return overrideDuration(event.id, event.durationSeconds, reveal, reveal + hold, fps, errors);
}

function overrideDuration(
  id: string,
  durationSeconds: number | undefined,
  minimumFrames: number,
  naturalFrames: number,
  fps: number,
  errors: Issue[],
): number | undefined {
  if (durationSeconds === undefined) return naturalFrames;
  const frames = secondsToFrames(durationSeconds, fps);
  if (frames < minimumFrames) {
    errors.push({
      path: `event ${id}`,
      message: `durationSeconds 只有 ${frames} 帧，不足以容纳 ${minimumFrames} 帧动画`,
    });
    return undefined;
  }
  return frames;
}

function textEventComp(event: TimedEvent, source: NormalizedTextEvent, project: NormalizedProject, errors: Issue[]): CompiledComp {
  const plan = planCharacters(source.text, project.timing, project.fps);
  const role: StyleRole = source.type === "narration" ? "narration" : "dialogue";
  const box = source.type === "narration" ? project.theme.layout.narrationText : project.theme.layout.dialogueText;
  const style = project.theme.styles[role];
  const layers: CompiledLayer[] = [];
  if (source.type === "dialogue") {
    layers.push({
      name: "DIALOGUE_FRAME",
      kind: "footage",
      assetId: "dialogueFrame",
      fit: project.theme.layout.dialogueBox,
      anchor: [0, 0],
      position: [project.theme.layout.dialogueBox.x, project.theme.layout.dialogueBox.y],
    });
  }
  layers.push(bodyTextLayer(`TEXT_${source.id}`, source.text, box, style, role, source.animation, plan, event, true, undefined, errors));
  return eventComp(event, project, layers, errors);
}

function choiceComp(
  event: TimedEvent,
  source: NormalizedChoiceEvent,
  project: NormalizedProject,
  assets: Map<ImageAsset["id"], ImageAsset>,
  errors: Issue[],
): CompiledComp {
  const cursor = assets.get("cursor");
  const layout = project.theme.layout.options;
  const stagger = secondsToFrames(project.timing.optionStaggerSeconds, project.fps);
  const fadeFrames = secondsToFrames(project.timing.fadeSeconds, project.fps);
  const revealEnd = (source.options.length - 1) * stagger;
  const moveStart = revealEnd + secondsToFrames(source.waitBeforeMoveSeconds, project.fps);
  const moveEnd = moveStart + secondsToFrames(source.moveSeconds, project.fps);
  const layers: CompiledLayer[] = [];
  const rows = source.options.map((option, index) => {
    const y = layout.y + index * (layout.itemHeight + layout.gap);
    return {
      option,
      index,
      bg: { x: layout.x, y, width: layout.width, height: layout.itemHeight },
      text: {
        x: layout.x + 36,
        y,
        width: Math.max(1, layout.width - 72),
        height: layout.itemHeight,
      },
    };
  });
  if (layout.width <= 72) {
    errors.push({ path: `event ${source.id}`, message: "选项宽度扣除内边距后没有剩余空间" });
  }
  for (const row of rows) {
    const selected = row.option.id === source.selectedOptionId;
    const appear = event.holdInFrames + row.index * stagger;
    const shown = appear + fadeFrames;
    const selectFrame = event.holdInFrames + moveEnd;
    const baseOpacity = project.theme.optionBackground.opacity;
    const opacityKeys = uniqueKeys(
      !selected
        ? [
            [appear, 0],
            [shown, baseOpacity],
          ]
        : selectFrame <= shown
          ? [
              [appear, 0],
              [shown, 100],
            ]
          : [
              [appear, 0],
              [shown, baseOpacity],
              [selectFrame, 100],
            ],
    );
    layers.push({
      name: `OPTION_${row.option.id}_BG`,
      kind: "solid",
      color: project.theme.optionBackground.rgb,
      solidWidth: row.bg.width,
      solidHeight: row.bg.height,
      anchor: [0, 0],
      position: [row.bg.x, row.bg.y],
      opacityKeys,
    });
    const plan = planCharacters(row.option.text, project.timing, project.fps);
    layers.push(
      bodyTextLayer(
        `OPTION_${row.option.id}_TEXT`,
        row.option.text,
        row.text,
        project.theme.styles.option,
        "option",
        "fade",
        plan,
        event,
        false,
        uniqueKeys([
          [appear, 0],
          [shown, 100],
        ]),
        errors,
      ),
    );
  }
  if (cursor) {
    const initial = rows.find((row) => row.option.id === source.initialOptionId) ?? rows[0];
    const selected = rows.find((row) => row.option.id === source.selectedOptionId) ?? rows[0];
    const x = layout.x - cursor.width - 16;
    const fromY = initial.bg.y + (layout.itemHeight - cursor.height) / 2;
    const toY = selected.bg.y + (layout.itemHeight - cursor.height) / 2;
    if (x < 0 || fromY < 0 || toY < 0) {
      errors.push({ path: `event ${source.id}`, message: "光标位置超出画面，请把选项右移或换更小的光标图" });
    }
    const from = { x, y: fromY };
    const to = { x, y: toY };
    const positionKeys: PositionKeyframe[] =
      moveStart > 0
        ? [
            { frame: event.holdInFrames, ...from, interp: "hold" },
            { frame: event.holdInFrames + moveStart, ...from, interp: "linear" },
            { frame: event.holdInFrames + moveEnd, ...to, interp: "linear" },
          ]
        : [
            { frame: event.holdInFrames, ...from, interp: "linear" },
            { frame: event.holdInFrames + moveEnd, ...to, interp: "linear" },
          ];
    layers.push({
      name: "CURSOR",
      kind: "footage",
      assetId: "cursor",
      anchor: [0, 0],
      position: [from.x, from.y],
      positionKeys: uniquePositionKeys(positionKeys),
    });
  }
  return eventComp(event, project, layers, errors);
}

function transitionComp(event: TimedEvent, project: NormalizedProject): CompiledComp {
  const fadeOut = event.fadeOutFrames ?? Math.round(event.durationFrames / 2);
  const keys = uniqueKeys([
    [0, 0],
    [fadeOut, 100],
    [event.durationFrames, event.holdBlack ? 100 : 0],
  ]);
  return {
    logicalId: eventLogicalId(event.source.id),
    name: `EVENT_${event.source.id}`,
    folder: "EVENTS",
    width: project.width,
    height: project.height,
    durationFrames: eventCompFrames(event),
    layers: [
      {
        name: "BLACK",
        kind: "solid",
        color: [0, 0, 0],
        solidWidth: project.width,
        solidHeight: project.height,
        anchor: [0, 0],
        position: [0, 0],
        opacityKeys: keys,
      },
    ],
  };
}

function bodyTextLayer(
  name: string,
  text: string,
  box: { x: number; y: number; width: number; height: number },
  style: NormalizedProject["theme"]["styles"]["dialogue"],
  role: StyleRole,
  animation: "typewriter" | "fade" | "lines",
  plan: CharacterPlan,
  event: TimedEvent,
  ownFade: boolean,
  opacityKeys: Keyframe[] | undefined,
  errors: Issue[],
): CompiledLayer {
  const revealKeys =
    animation === "fade" ? undefined : revealKeyframes(animation === "lines" ? plan.lineFrames : plan.revealFrames, event.holdInFrames);
  const fadeKeys: Keyframe[] | undefined =
    animation === "fade" && ownFade ? fadeOpacityKeyframes(event.holdInFrames, plan.fadeFrames) : opacityKeys;
  const layer: CompiledLayer = {
    name,
    logicalId: textLogicalId(name),
    eventId: event.source.id,
    holdInFrames: event.holdInFrames,
    eventFrames: event.durationFrames,
    kind: "text",
    aeText: text.replace(/\n/g, "\r"),
    box,
    font: style.font,
    fontSize: style.fontSize,
    lineHeight: style.lineHeight,
    rgb: style.rgb,
    anchor: [0, 0],
    position: [box.x, box.y],
    sourceTextExpression: sourceTextExpression(role),
    opacityExpression: textOpacityExpression(),
    opacityKeys: fadeKeys,
    textAnimation: {
      preset: animation,
      revealKeys,
      opacityKeys: fadeKeys?.map((key) => ({
        frame: key.frame,
        value: key.value,
        interpolation: key.interpolation ?? "linear",
      })),
    },
  };
  const durationFrames = eventCompFrames(event);
  if (revealKeys && revealKeys.length > 0 && revealKeys[revealKeys.length - 1].frame >= durationFrames) {
    const last = revealKeys[revealKeys.length - 1].frame;
    errors.push({
      path: name,
      message: `最后一个文字关键帧在第 ${last} 帧，事件合成只有 ${durationFrames} 帧`,
    });
  }
  return layer;
}

function eventComp(event: TimedEvent, project: NormalizedProject, layers: CompiledLayer[], errors: Issue[]): CompiledComp {
  const durationFrames = eventCompFrames(event);
  if (durationFrames < 1) {
    errors.push({ path: `event ${event.source.id}`, message: "事件长度小于 1 帧" });
  }
  return {
    logicalId: eventLogicalId(event.source.id),
    name: `EVENT_${event.source.id}`,
    folder: "EVENTS",
    width: project.width,
    height: project.height,
    durationFrames,
    layers,
  };
}

function sceneComp(scene: TimedScene, project: NormalizedProject, errors: Issue[]): CompiledComp {
  const durationFrames = scene.leadFrames + scene.durationFrames;
  const layers: CompiledLayer[] = [
    {
      name: "BACKGROUND",
      kind: "footage",
      assetId: "background",
      fit: { x: 0, y: 0, width: project.width, height: project.height },
      anchor: [0, 0],
      position: [0, 0],
    },
  ];
  const content = scene.events.filter((event) => event.source.type !== "transition");
  const transitions = scene.events.filter((event) => event.source.type === "transition");
  for (const event of [...content, ...transitions]) {
    const inFrame = scene.leadFrames + event.logicalStart - event.holdInFrames;
    const outFrame = scene.leadFrames + event.logicalStart + event.durationFrames + event.holdOutFrames;
    if (outFrame - inFrame !== eventCompFrames(event)) {
      errors.push({ path: `event ${event.source.id}`, message: "事件合成长度和场景中的摆放长度不一致" });
    }
    layers.push({
      name: `EVENT_${event.source.id}`,
      kind: "precomp",
      compName: `EVENT_${event.source.id}`,
      compRef: eventLogicalId(event.source.id),
      inFrame,
      outFrame,
    });
  }
  if (scene.fadeInFrames > 0) {
    layers.push({
      name: scene.fadeInFrom ? `FADE_IN_${scene.fadeInFrom}` : "FADE_IN",
      kind: "solid",
      color: [0, 0, 0],
      solidWidth: project.width,
      solidHeight: project.height,
      anchor: [0, 0],
      position: [0, 0],
      inFrame: 0,
      outFrame: scene.fadeInFrames,
      opacityKeys: uniqueKeys([
        [0, 100],
        [scene.fadeInFrames, 0],
      ]),
    });
  }
  return {
    logicalId: sceneLogicalId(scene.id),
    name: `SCENE_${scene.id}`,
    folder: "SCENES",
    width: project.width,
    height: project.height,
    durationFrames,
    layers,
  };
}

function masterComp(scenes: TimedScene[], durationFrames: number, project: NormalizedProject): CompiledComp {
  return {
    logicalId: LOGICAL.master,
    name: COMP.master,
    folder: "ROOT",
    width: project.width,
    height: project.height,
    durationFrames,
    layers: [
      ...scenes.map((scene) => ({
        name: `SCENE_${scene.id}`,
        kind: "precomp" as const,
        compName: `SCENE_${scene.id}`,
        compRef: sceneLogicalId(scene.id),
        inFrame: scene.logicalStart - scene.leadFrames,
        outFrame: scene.logicalStart + scene.durationFrames,
      })),
      {
        name: COMP.overlay,
        kind: "precomp" as const,
        compName: COMP.overlay,
        compRef: LOGICAL.overlay,
        inFrame: 0,
        outFrame: durationFrames,
      },
    ],
  };
}

function controlComp(project: NormalizedProject): CompiledComp {
  return {
    logicalId: LOGICAL.control,
    name: COMP.control,
    folder: "GLOBAL",
    width: project.width,
    height: project.height,
    durationFrames: project.fps,
    layers: [
      {
        name: COMP.ctrlLayer,
        kind: "null",
        position: [project.width / 2, project.height / 2],
        effects: [{ type: "slider", name: EFFECT_NAMES.globalTextOpacity, value: 100 }],
      },
      {
        name: "说明",
        kind: "text",
        aeText: CONTROL_GUIDE.replace(/\n/g, "\r"),
        box: { x: 80, y: 80, width: 1760, height: 900 },
        font: project.theme.styles.narration.font,
        fontSize: 28,
        lineHeight: 40,
        rgb: [0.85, 0.92, 0.96],
        anchor: [0, 0],
        position: [80, 80],
        comment: "生成器说明，不参与画面",
      },
    ],
  };
}

function styleComp(
  name: string,
  label: string,
  style: NormalizedProject["theme"]["styles"]["dialogue"],
  project: NormalizedProject,
): CompiledComp {
  return {
    logicalId: styleLogicalId(name),
    name,
    folder: "GLOBAL",
    width: project.width,
    height: project.height,
    durationFrames: project.fps,
    layers: [
      {
        name: COMP.styleLayer,
        kind: "text",
        aeText: label,
        box: { x: 80, y: 80, width: 1200, height: 240 },
        font: style.font,
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
        rgb: style.rgb,
        anchor: [0, 0],
        position: [80, 80],
        comment: "直接改这一层的字体、字号、行距和颜色",
      },
    ],
  };
}

function styleLogicalId(name: string): string {
  if (name === COMP.styleNarration) return LOGICAL.styleNarration;
  if (name === COMP.styleOption) return LOGICAL.styleOption;
  return LOGICAL.styleDialogue;
}

function contentIdentity(project: NormalizedProject): string {
  return createHash("sha256").update(JSON.stringify({ id: project.id, timing: project.timing, scenes: project.scenes })).digest("hex");
}

function baselineFor(scenes: TimedScene[], project: NormalizedProject, durationFrames: number): InstanceBaseline {
  const events: InstanceBaseline["events"] = [];
  const dependencies: InstanceBaseline["dependencies"] = [];
  for (const scene of scenes) {
    const sceneStart = scene.logicalStart - scene.leadFrames;
    const sceneDuration = scene.leadFrames + scene.durationFrames;
    dependencies.push({
      id: scene.id,
      kind: "scene-boundary",
      sync: "managed",
      startFrame: sceneStart,
      durationFrames: sceneDuration,
    });
    dependencies.push({
      id: `${scene.id}:background`,
      kind: "background",
      sync: "managed",
      startFrame: sceneStart,
      durationFrames: sceneDuration,
    });
    for (const event of scene.events) {
      const source = event.source;
      const text = source.type === "dialogue" || source.type === "narration" ? source.text : "";
      events.push({
        eventId: source.id,
        sceneId: scene.id,
        startFrame: scene.logicalStart + event.logicalStart,
        durationFrames: event.durationFrames,
        animationStartFrame: event.holdInFrames,
        characterIntervalFrames: Math.max(1, Math.round(project.fps / project.timing.charactersPerSecond)),
        charactersPerSecond: project.timing.charactersPerSecond,
        characterFadeFrames: secondsToFrames(project.timing.fadeSeconds, project.fps),
        pauses: text ? pausesFromPunctuation(text, project.timing, project.fps) : [],
      });
      dependencies.push({
        id: source.id,
        kind: source.type === "transition" ? "transition" : "scene-boundary",
        sync: "managed",
        startFrame: scene.logicalStart + event.logicalStart - event.holdInFrames,
        durationFrames: event.holdInFrames + event.durationFrames + event.holdOutFrames,
      });
    }
  }
  dependencies.push({
    id: "overlay",
    kind: "overlay",
    sync: "managed",
    startFrame: 0,
    durationFrames,
  });
  return {
    fps: project.fps,
    masterDurationFrames: durationFrames,
    commaPauseFrames: secondsToFrames(project.timing.commaPauseSeconds, project.fps),
    sentencePauseFrames: secondsToFrames(project.timing.sentencePauseSeconds, project.fps),
    events,
    dependencies,
  };
}

function eventCompFrames(event: TimedEvent): number {
  return event.holdInFrames + event.durationFrames + event.holdOutFrames;
}

function uniquePositionKeys(keys: PositionKeyframe[]): PositionKeyframe[] | undefined {
  const values = new Map<number, PositionKeyframe>();
  for (const key of keys) values.set(key.frame, key);
  const ordered = [...values.values()].sort((a, b) => a.frame - b.frame);
  return ordered.length >= 2 ? ordered : undefined;
}

function uniqueKeys(pairs: Array<[number, number]>): Keyframe[] {
  const values = new Map<number, number>();
  for (const [frame, value] of pairs) values.set(frame, value);
  return [...values.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([frame, value]) => ({ frame, value, interpolation: "linear" as const }));
}

function warnLayout(project: NormalizedProject, warnings: Issue[]): void {
  const rects: Array<[string, { x: number; y: number; width: number; height: number }]> = [
    ["theme.json.layout.dialogueBox", project.theme.layout.dialogueBox],
    ["theme.json.layout.dialogueText", project.theme.layout.dialogueText],
    ["theme.json.layout.narrationText", project.theme.layout.narrationText],
  ];
  for (const [label, rect] of rects) warnRect(label, rect, warnings);
  const options = project.theme.layout.options;
  warnRect("theme.json.layout.options", { x: options.x, y: options.y, width: options.width, height: options.itemHeight }, warnings);
}

function warnRect(label: string, rect: { x: number; y: number; width: number; height: number }, warnings: Issue[]): void {
  if (rect.x < 0 || rect.y < 0 || rect.x + rect.width > FRAME_WIDTH || rect.y + rect.height > FRAME_HEIGHT) {
    warnings.push({ path: label, message: "布局超出 1920×1080，仍会按坐标放置" });
  }
}

function toSlash(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}
