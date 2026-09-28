import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_TIMING, type TimingSettings } from "../src/types";
import { planCharacters, revealFramesFor, secondsToFrames } from "../src/timing";

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

test("逐行先逐字打完一行，再隔行距开始下一行", () => {
  const plan = planCharacters("第一行\n第二行\n第三行", timing, fps);
  assert.deepEqual(plan.lineFrames, [0, 3, 5, 23, 23, 26, 28, 46, 46, 49, 51]);
  assert.equal(plan.lineRevealFrames, 54);
  assert.equal(plan.fadeFrames, 12);
  assert.equal(revealFramesFor("lines", plan), 54);
  assert.equal(revealFramesFor("fade", plan), 12);
});
