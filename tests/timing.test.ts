import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_TIMING, type TimingSettings } from "../src/types";
import { fadeOpacityKeyframes, planCharacters, revealFramesFor, revealKeyframes, secondsToFrames } from "../src/timing";

const timing: TimingSettings = { ...DEFAULT_TIMING };
const fps = 30;

test("秒到帧按四舍五入，停顿落在稳定的整数帧上", () => {
  assert.equal(secondsToFrames(0.12, fps), 4);
  assert.equal(secondsToFrames(0.3, fps), 9);
  assert.equal(secondsToFrames(0.5, fps), 15);
  assert.equal(secondsToFrames(1.2, fps), 36);
  assert.equal(secondsToFrames(1.5, fps), 45);
  assert.equal(secondsToFrames(0.4, fps), 12);
});

test("打字机：换行不耗时，句末标点不再额外停顿", () => {
  const text = "连接已建立。\n是否继续？";
  const plan = planCharacters(text, timing, fps);
  assert.deepEqual(plan.revealFrames, [0, 3, 5, 8, 10, 13, 24, 24, 27, 29, 32, 34]);
  assert.equal(plan.typewriterRevealFrames, 37);
  assert.equal(plan.revealFrames[6], plan.revealFrames[7]);
  assert.equal(revealFramesFor("typewriter", plan), 37);
});

test("空格推进字符，逗号才增加短停顿", () => {
  const spaced = planCharacters("A B", timing, fps);
  assert.deepEqual(spaced.revealFrames, [0, 3, 5]);
  assert.equal(spaced.typewriterRevealFrames, 8);

  const comma = planCharacters("A,B", timing, fps);
  assert.deepEqual(comma.revealFrames, [0, 3, 9]);
  assert.equal(comma.typewriterRevealFrames, 12);
});

test("只有非末尾句号才加入长停顿", () => {
  const ending = planCharacters("Hi.", timing, fps);
  assert.deepEqual(ending.revealFrames, [0, 3, 5]);
  assert.equal(ending.typewriterRevealFrames, 8);

  const middle = planCharacters("Hi.A", timing, fps);
  assert.deepEqual(middle.revealFrames, [0, 3, 5, 17]);
  assert.equal(middle.typewriterRevealFrames, 19);
});

test("打字机关键帧在第 0 帧显示 1 个字符，同帧合并", () => {
  const plan = planCharacters("连接已建立。\n是否继续？", timing, fps);
  assert.deepEqual(
    revealKeyframes(plan.revealFrames, 0).map((key) => [key.frame, key.value, key.interpolation]),
    [
      [0, 1, "hold"],
      [3, 2, "hold"],
      [5, 3, "hold"],
      [8, 4, "hold"],
      [10, 5, "hold"],
      [13, 6, "hold"],
      [24, 8, "hold"],
      [27, 9, "hold"],
      [29, 10, "hold"],
      [32, 11, "hold"],
      [34, 12, "hold"],
    ],
  );
});

test("转场提前进入时，第 0 帧先停在首字，正文关键帧再后移", () => {
  const keys = revealKeyframes([0, 3], 9);
  assert.deepEqual(
    keys.map((key) => [key.frame, key.value]),
    [
      [0, 1],
      [9, 1],
      [12, 2],
    ],
  );
});

test("空文本和一帧内完成的文本各留一个计数关键帧", () => {
  assert.deepEqual(revealKeyframes([], 0), [{ frame: 0, value: 0, interpolation: "hold" }]);
  assert.deepEqual(revealKeyframes([0, 0, 0], 0), [{ frame: 0, value: 3, interpolation: "hold" }]);
});

test("淡入关键帧从提前进入的黑场保持到淡入结束", () => {
  assert.deepEqual(fadeOpacityKeyframes(0, 12), [
    { frame: 0, value: 0, interpolation: "linear" },
    { frame: 12, value: 100, interpolation: "linear" },
  ]);
  assert.deepEqual(fadeOpacityKeyframes(9, 12), [
    { frame: 0, value: 0, interpolation: "linear" },
    { frame: 9, value: 0, interpolation: "linear" },
    { frame: 21, value: 100, interpolation: "linear" },
  ]);
  assert.deepEqual(fadeOpacityKeyframes(4, 0), [{ frame: 0, value: 100, interpolation: "linear" }]);
});

test("逐行先逐字打完一行，再隔行距开始下一行", () => {
  const plan = planCharacters("第一行\n第二行\n第三行", timing, fps);
  assert.deepEqual(plan.lineFrames, [0, 3, 5, 23, 23, 26, 28, 46, 46, 49, 51]);
  assert.equal(plan.lineRevealFrames, 54);
  assert.equal(plan.fadeFrames, 12);
  assert.equal(revealFramesFor("lines", plan), 54);
  assert.equal(revealFramesFor("fade", plan), 12);
});
