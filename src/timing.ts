import {
  LONG_PAUSE_CHARS,
  SHORT_PAUSE_CHARS,
  type AnimationName,
  type ScalarKeyframe,
  type TimingSettings,
} from "./types";

export function secondsToFrames(seconds: number, fps: number): number {
  if (!Number.isFinite(seconds) || !Number.isFinite(fps) || fps <= 0) {
    throw new Error("无法把时间换成帧");
  }
  return Math.round(seconds * fps);
}

export function splitChars(text: string): string[] {
  return Array.from(text);
}

export function isNewline(ch: string): boolean {
  return ch === "\n" || ch === "\r";
}

export interface CharacterPlan {
  revealFrames: number[];
  lineFrames: number[];
  typewriterRevealFrames: number;
  lineRevealFrames: number;
  fadeFrames: number;
}

export function planCharacters(text: string, timing: TimingSettings, fps: number): CharacterPlan {
  const chars = splitChars(text);
  const commaPauseFrames = secondsToFrames(timing.commaPauseSeconds, fps);
  const sentencePauseFrames = secondsToFrames(timing.sentencePauseSeconds, fps);
  const lineIntervalFrames = secondsToFrames(timing.lineIntervalSeconds, fps);
  const fadeFrames = secondsToFrames(timing.fadeSeconds, fps);

  const visibleIndexes: number[] = [];
  for (let i = 0; i < chars.length; i += 1) {
    if (!isNewline(chars[i])) visibleIndexes.push(i);
  }

  const revealFrames = new Array<number>(chars.length).fill(0);
  let pauseFrames = 0;
  visibleIndexes.forEach((charIndex, visibleIndex) => {
    revealFrames[charIndex] = appearFrame(visibleIndex, pauseFrames, timing.charactersPerSecond, fps);
    const isLast = visibleIndex === visibleIndexes.length - 1;
    if (!isLast) {
      const ch = chars[charIndex];
      if (LONG_PAUSE_CHARS.includes(ch)) pauseFrames += sentencePauseFrames;
      else if (SHORT_PAUSE_CHARS.includes(ch)) pauseFrames += commaPauseFrames;
    }
  });

  for (let i = chars.length - 1; i >= 0; i -= 1) {
    if (!isNewline(chars[i])) continue;
    const next = nextVisibleFrame(chars, revealFrames, i);
    revealFrames[i] = next ?? appearFrame(visibleIndexes.length, pauseFrames, timing.charactersPerSecond, fps);
  }

  const lines = lineCharacterFrames(chars, timing, fps, lineIntervalFrames);
  const lineFrames = lines.frames;
  const lineRevealFrames = lines.revealFrames;
  const typewriterRevealFrames =
    visibleIndexes.length === 0
      ? 0
      : appearFrame(visibleIndexes.length, pauseFrames, timing.charactersPerSecond, fps);

  return {
    revealFrames,
    lineFrames,
    typewriterRevealFrames,
    lineRevealFrames,
    fadeFrames,
  };
}

export function revealFramesFor(animation: AnimationName, plan: CharacterPlan): number {
  if (animation === "typewriter") return plan.typewriterRevealFrames;
  if (animation === "lines") return plan.lineRevealFrames;
  return plan.fadeFrames;
}

function appearFrame(visibleIndex: number, pauseFrames: number, charactersPerSecond: number, fps: number): number {
  return Math.round((visibleIndex * fps) / charactersPerSecond) + pauseFrames;
}

function nextVisibleFrame(chars: string[], revealFrames: number[], from: number): number | null {
  for (let i = from + 1; i < chars.length; i += 1) {
    if (!isNewline(chars[i])) return revealFrames[i];
  }
  return null;
}

function lineCharacterFrames(
  chars: string[],
  timing: TimingSettings,
  fps: number,
  lineIntervalFrames: number,
): { frames: number[]; revealFrames: number } {
  const frames = new Array<number>(chars.length).fill(0);
  let offset = 0;
  let index = 0;
  while (index < chars.length) {
    const lineStart = index;
    while (index < chars.length && !isNewline(chars[index])) index += 1;
    const duration = typeLine(chars, lineStart, index, timing, fps, offset, frames);
    if (index < chars.length) {
      const nextOffset = offset + duration + lineIntervalFrames;
      frames[index] = nextOffset;
      offset = nextOffset;
      index += 1;
    } else {
      offset += duration;
    }
  }
  return { frames, revealFrames: offset };
}

function typeLine(
  chars: string[],
  start: number,
  endExclusive: number,
  timing: TimingSettings,
  fps: number,
  offset: number,
  frames: number[],
): number {
  const visible: number[] = [];
  for (let i = start; i < endExclusive; i += 1) {
    if (!isNewline(chars[i])) visible.push(i);
  }
  let pauseFrames = 0;
  visible.forEach((charIndex, visibleIndex) => {
    frames[charIndex] = offset + appearFrame(visibleIndex, pauseFrames, timing.charactersPerSecond, fps);
    const isLast = visibleIndex === visible.length - 1;
    if (!isLast) {
      const ch = chars[charIndex];
      if (LONG_PAUSE_CHARS.includes(ch)) pauseFrames += secondsToFrames(timing.sentencePauseSeconds, fps);
      else if (SHORT_PAUSE_CHARS.includes(ch)) pauseFrames += secondsToFrames(timing.commaPauseSeconds, fps);
    }
  });
  if (visible.length === 0) return 0;
  return appearFrame(visible.length, pauseFrames, timing.charactersPerSecond, fps);
}

export function revealKeyframes(appearFrames: number[], holdInFrames: number): ScalarKeyframe[] {
  const countAt = (frame: number) => appearFrames.reduce((count, appear) => count + (appear <= frame ? 1 : 0), 0);
  const keys: ScalarKeyframe[] = [];
  const push = (frame: number, value: number) => {
    const existing = keys.find((key) => key.frame === frame);
    if (existing) existing.value = value;
    else keys.push({ frame, value, interpolation: "hold" });
  };
  if (appearFrames.length === 0) {
    push(Math.max(0, holdInFrames), 0);
    return keys;
  }
  if (holdInFrames > 0) push(0, countAt(0));
  const unique = [...new Set(appearFrames)].sort((a, b) => a - b);
  for (const frame of unique) push(holdInFrames + frame, countAt(frame));
  return keys.sort((a, b) => a.frame - b.frame);
}

export function fadeOpacityKeyframes(holdInFrames: number, fadeFrames: number): ScalarKeyframe[] {
  if (fadeFrames <= 0) return [{ frame: 0, value: 100, interpolation: "linear" }];
  const end = holdInFrames + fadeFrames;
  if (holdInFrames <= 0) {
    return [
      { frame: 0, value: 0, interpolation: "linear" },
      { frame: end, value: 100, interpolation: "linear" },
    ];
  }
  return [
    { frame: 0, value: 0, interpolation: "linear" },
    { frame: holdInFrames, value: 0, interpolation: "linear" },
    { frame: end, value: 100, interpolation: "linear" },
  ];
}

