import { LONG_PAUSE_CHARS, SHORT_PAUSE_CHARS, type ScalarKeyframe, type TimingSettings } from "./types";
import { revealKeyframes, secondsToFrames } from "./timing";

export type SupportedEffect = "typewriter" | "characterFade";

export interface TextUnit {
  text: string;
  aeIndex: number;
  aeLength: number;
}

export interface PauseMark {
  afterUnit: number;
  frames: number;
}

export interface BaselineTiming {
  charactersPerSecond: number;
  fps: number;
  holdInFrames: number;
  characterFadeFrames: number;
  pauses: PauseMark[];
}

export interface FadeTrack {
  aeIndex: number;
  aeLength: number;
  keys: ScalarKeyframe[];
}

export interface AnimationPlan {
  effect: SupportedEffect;
  units: TextUnit[];
  pauses: PauseMark[];
  revealKeys: ScalarKeyframe[];
  fadeTracks: FadeTrack[];
  completionFrame: number;
  requiredFrames: number;
  fits: boolean;
}

interface CodePoint {
  value: number;
  aeLength: number;
  text: string;
  newline: boolean;
}

export function segmentText(text: string): { units: TextUnit[]; aeLength: number } {
  const points = codePoints(text.replace(/\r\n/g, "\n").replace(/\r/g, "\n"));
  const units: TextUnit[] = [];
  let aeIndex = 0;
  let index = 0;
  while (index < points.length) {
    const point = points[index];
    if (point.newline) {
      aeIndex += point.aeLength;
      index += 1;
      continue;
    }
    let aeLength = point.aeLength;
    let chunk = point.text;
    index += 1;
    while (index < points.length && continuesUnit(points[index - 1], points[index])) {
      aeLength += points[index].aeLength;
      chunk += points[index].text;
      index += 1;
    }
    units.push({ text: chunk, aeIndex, aeLength });
    aeIndex += aeLength;
  }
  return { units, aeLength: aeIndex };
}

export function pausesFromPunctuation(text: string, timing: TimingSettings, fps: number): PauseMark[] {
  const units = segmentText(text).units;
  const comma = secondsToFrames(timing.commaPauseSeconds, fps);
  const sentence = secondsToFrames(timing.sentencePauseSeconds, fps);
  const pauses: PauseMark[] = [];
  for (let index = 0; index < units.length - 1; index += 1) {
    const ch = units[index].text;
    if (LONG_PAUSE_CHARS.includes(ch)) pauses.push({ afterUnit: index, frames: sentence });
    else if (SHORT_PAUSE_CHARS.includes(ch)) pauses.push({ afterUnit: index, frames: comma });
  }
  return pauses;
}

export function buildAnimationPlan(input: {
  text: string;
  effect: SupportedEffect;
  speed: number;
  baselineTiming: BaselineTiming;
  availableTime: number;
}): AnimationPlan {
  if (!(input.speed > 0)) throw new Error("速度倍率必须大于 0");
  const segmented = segmentText(input.text);
  const pauses = input.baselineTiming.pauses || [];
  const relativeAppear = appearFrames(segmented.units, pauses, input.baselineTiming);
  const holdIn = input.baselineTiming.holdInFrames;
  const aeAppear = new Array<number>(segmented.aeLength).fill(0);
  segmented.units.forEach((unit, index) => {
    for (let offset = 0; offset < unit.aeLength; offset += 1) aeAppear[unit.aeIndex + offset] = relativeAppear[index];
  });
  for (let index = 0; index < segmented.aeLength; index += 1) {
    if (isCoveredByUnit(segmented.units, index)) continue;
    const next = segmented.units.find((unit) => unit.aeIndex > index);
    aeAppear[index] = next ? relativeAppear[segmented.units.indexOf(next)] : relativeAppear[relativeAppear.length - 1] ?? 0;
  }
  const baseReveal = revealKeyframes(aeAppear, holdIn);
  const baseFade = segmented.units.map((unit, index) =>
    fadeKeys(holdIn + relativeAppear[index], input.baselineTiming.characterFadeFrames),
  );
  const typewriterEnd = holdIn + occupiedBaseline(segmented.units, pauses, input.baselineTiming);
  const fadeCompletion =
    holdIn + (relativeAppear.length ? relativeAppear[relativeAppear.length - 1] : 0) + input.baselineTiming.characterFadeFrames;
  const boundaries = baseReveal
    .map((key) => key.frame)
    .concat(baseFade.flatMap((keys) => keys.map((key) => key.frame)), [typewriterEnd, fadeCompletion, holdIn, 0]);
  const mapped = quantizeShared(boundaries, input.speed);
  const revealKeys = remapKeys(baseReveal, mapped);
  const fadeTracks =
    input.effect === "characterFade"
      ? segmented.units.map((unit, index) => ({
          aeIndex: unit.aeIndex,
          aeLength: unit.aeLength,
          keys: remapKeys(baseFade[index], mapped),
        }))
      : [];
  const lastReveal = revealKeys.length ? revealKeys[revealKeys.length - 1].frame : 0;
  const completionFrame = input.effect === "characterFade" ? (mapped.get(fadeCompletion) ?? fadeCompletion) : lastReveal;
  const requiredFrames = input.effect === "characterFade" ? completionFrame : (mapped.get(typewriterEnd) ?? typewriterEnd);
  return {
    effect: input.effect,
    units: segmented.units,
    pauses,
    revealKeys,
    fadeTracks,
    completionFrame,
    requiredFrames,
    fits: requiredFrames <= input.availableTime,
  };
}

function occupiedBaseline(units: TextUnit[], pauses: PauseMark[], timing: BaselineTiming): number {
  const pauseFrames = pauses.reduce((sum, pause) => sum + pause.frames, 0);
  return Math.round((units.length * timing.fps) / timing.charactersPerSecond) + pauseFrames;
}

function appearFrames(units: TextUnit[], pauses: PauseMark[], timing: BaselineTiming): number[] {
  let carried = 0;
  return units.map((_unit, index) => {
    const frame = Math.round((index * timing.fps) / timing.charactersPerSecond) + carried;
    const pause = pauses.find((item) => item.afterUnit === index);
    if (pause) carried += pause.frames;
    return frame;
  });
}

function remapKeys(keys: ScalarKeyframe[], mapped: Map<number, number>): ScalarKeyframe[] {
  const byFrame = new Map<number, ScalarKeyframe>();
  for (const key of keys) {
    const frame = mapped.get(key.frame) ?? key.frame;
    byFrame.set(frame, { ...key, frame });
  }
  return [...byFrame.values()].sort((left, right) => left.frame - right.frame);
}

function fadeKeys(start: number, fadeFrames: number): ScalarKeyframe[] {
  if (fadeFrames <= 0) return [{ frame: start, value: 100, interpolation: "linear" }];
  if (start <= 0) {
    return [
      { frame: 0, value: 0, interpolation: "linear" },
      { frame: fadeFrames, value: 100, interpolation: "linear" },
    ];
  }
  return [
    { frame: 0, value: 0, interpolation: "linear" },
    { frame: start, value: 0, interpolation: "linear" },
    { frame: start + fadeFrames, value: 100, interpolation: "linear" },
  ];
}

function isCoveredByUnit(units: TextUnit[], aeIndex: number): boolean {
  return units.some((unit) => aeIndex >= unit.aeIndex && aeIndex < unit.aeIndex + unit.aeLength);
}

export function quantizeShared(frames: number[], speed: number): Map<number, number> {
  const mapped = new Map<number, number>();
  for (const frame of frames) {
    if (!mapped.has(frame)) mapped.set(frame, Math.round(frame / speed));
  }
  return mapped;
}

function continuesUnit(previous: CodePoint, next: CodePoint): boolean {
  if (next.newline || previous.newline) return false;
  if (isCombining(next.value) || isVariation(next.value)) return true;
  if (previous.value === 0x200d || next.value === 0x200d) return true;
  return false;
}

function codePoints(text: string): CodePoint[] {
  const points: CodePoint[] = [];
  for (const textPoint of Array.from(text)) {
    const value = textPoint.codePointAt(0) ?? 0;
    points.push({
      value,
      aeLength: textPoint.length,
      text: textPoint,
      newline: textPoint === "\n",
    });
  }
  return points;
}

function isCombining(value: number): boolean {
  return (
    (value >= 0x0300 && value <= 0x036f) ||
    (value >= 0x1ab0 && value <= 0x1aff) ||
    (value >= 0x1dc0 && value <= 0x1dff) ||
    (value >= 0x20d0 && value <= 0x20ff) ||
    (value >= 0xfe20 && value <= 0xfe2f)
  );
}

function isVariation(value: number): boolean {
  return value === 0xfe0e || value === 0xfe0f || (value >= 0xe0100 && value <= 0xe01ef);
}
