import assert from "node:assert/strict";
import test from "node:test";
import { buildAnimationPlan, pausesFromPunctuation, segmentText } from "../src/animation-plan";
import { summarizeOperation } from "../src/operation-result";
import { stylePatchFromDirty } from "../src/style-patch";
import { edgesStayJoined, planSpeed, preflightInstanceSpeed, roundTripFromBaseline } from "../src/time-plan";
import { planCharacters, revealKeyframes } from "../src/timing";
import { DEFAULT_TIMING } from "../src/types";

const timing = { ...DEFAULT_TIMING };
const text = "连接已建立。\n是否继续？";

test("可见字符、空格和组合字符按单元计时，换行不单独占单元", () => {
  const chinese = segmentText(text);
  assert.equal(chinese.units.length, 11);
  assert.equal(chinese.aeLength, 12);
  assert.equal(chinese.units[6].aeIndex, 7);

  const spaced = segmentText("A B");
  assert.deepEqual(spaced.units.map((unit) => unit.text), ["A", " ", "B"]);

  const combined = segmentText("e\u0301\n你");
  assert.equal(combined.units.length, 2);
  assert.equal(combined.units[0].text, "e\u0301");
  assert.equal(combined.units[0].aeLength, 2);
  assert.equal(combined.units[1].aeIndex, 3);
});

test("标点间隔与普通字符相同，剧本停顿单独记录", () => {
  const pauses = pausesFromPunctuation("A,B。C", timing, 30);
  assert.deepEqual(pauses, [
    { afterUnit: 1, frames: 4 },
    { afterUnit: 3, frames: 9 },
  ]);
  const without = buildAnimationPlan({
    text: "A,B",
    effect: "typewriter",
    speed: 1,
    baselineTiming: { charactersPerSecond: 12, fps: 30, holdInFrames: 0, characterFadeFrames: 12, pauses: [] },
    availableTime: 30,
  });
  assert.deepEqual(without.units.map((_unit, index) => without.revealKeys.find((key) => key.value === index + 1)?.frame), [0, 3, 5]);
});

test("打字机关键帧与原有字符计划一致，末字显现后才完成", () => {
  const plan = planCharacters(text, timing, 30);
  const animation = buildAnimationPlan({
    text,
    effect: "typewriter",
    speed: 1,
    baselineTiming: {
      charactersPerSecond: timing.charactersPerSecond,
      fps: 30,
      holdInFrames: 0,
      characterFadeFrames: plan.fadeFrames,
      pauses: pausesFromPunctuation(text, timing, 30),
    },
    availableTime: 73,
  });
  assert.deepEqual(
    animation.revealKeys.map((key) => [key.frame, key.value]),
    revealKeyframes(plan.revealFrames, 0).map((key) => [key.frame, key.value]),
  );
  assert.equal(animation.completionFrame, 34);
  assert.equal(animation.requiredFrames, 37);
  assert.equal(animation.fits, true);
  assert.equal(animation.fadeTracks.length, 0);
});

test("逐字淡入使用同一分段，最后一字淡完才算完成", () => {
  const pauses = pausesFromPunctuation(text, timing, 30);
  const typed = buildAnimationPlan({
    text,
    effect: "typewriter",
    speed: 1,
    baselineTiming: { charactersPerSecond: 12, fps: 30, holdInFrames: 0, characterFadeFrames: 12, pauses },
    availableTime: 80,
  });
  const faded = buildAnimationPlan({
    text,
    effect: "characterFade",
    speed: 1,
    baselineTiming: { charactersPerSecond: 12, fps: 30, holdInFrames: 0, characterFadeFrames: 12, pauses },
    availableTime: 80,
  });
  assert.equal(faded.units.length, typed.units.length);
  assert.equal(faded.fadeTracks.length, 11);
  assert.equal(faded.completionFrame, 46);
  assert.equal(faded.fadeTracks[10].keys[faded.fadeTracks[10].keys.length - 1].value, 100);
  assert.equal(faded.fits, true);
  const short = buildAnimationPlan({
    text,
    effect: "characterFade",
    speed: 1,
    baselineTiming: { charactersPerSecond: 12, fps: 30, holdInFrames: 0, characterFadeFrames: 12, pauses },
    availableTime: 40,
  });
  assert.equal(short.fits, false);
});

test("实例变速从导入基准换算，共享边界不会拆开", () => {
  const edges = [
    { id: "a", startFrame: 0, endFrame: 35 },
    { id: "b", startFrame: 35, endFrame: 70 },
  ];
  assert.equal(edgesStayJoined(edges, 0.5), true);
  assert.equal(edgesStayJoined(edges, 2), true);
  const back = roundTripFromBaseline([0, 35, 70], 1050, [0.5, 2, 1]);
  assert.deepEqual(back, [0, 35, 70]);
  const half = planSpeed([0, 1050], 1050, 0.5);
  assert.equal(half.durationFrames, 2100);
  const blocked = preflightInstanceSpeed(0.5, 1, [
    { id: "配音", sync: "sync", manual: false, timeRemap: false, sharedOutside: false, classified: true, loop: false },
  ]);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, "unsupported_dependency");
  const manual = preflightInstanceSpeed(2, 1, [
    { id: "d001", sync: "managed", manual: true, timeRemap: false, sharedOutside: false, classified: true, loop: false },
  ]);
  assert.equal(manual.reason, "manual_edit");
});

test("样式补丁只包含改过的字段，结果只统计成功写入", () => {
  const patch = stylePatchFromDirty({
    font: { dirty: true, value: "MicrosoftYaHei" },
    fontSize: { dirty: false, value: 10 },
  });
  assert.deepEqual(patch, { font: "MicrosoftYaHei" });
  const result = summarizeOperation("rebuild", [
    { status: "updated", reason: null, instanceId: "a", message: "" },
    { status: "skipped", reason: "manual_edit", instanceId: "a", message: "跳过" },
  ]);
  assert.equal(result.status, "partial");
  assert.equal(result.message, "已更新 1 段，跳过 1 段手动动画。");
  const speed = summarizeOperation("speed", [
    { status: "failed", reason: "manual_edit", instanceId: "a", message: "未调整速度：发现手动调整的事件，片段保持原样。" },
  ]);
  assert.equal(speed.status, "failed");
  assert.equal(speed.appliedSpeed, undefined);
});
