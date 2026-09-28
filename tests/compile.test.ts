import assert from "node:assert/strict";
import test from "node:test";
import { compile } from "../src/compiler";
import { normalizeProject } from "../src/normalize";
import type { ImageAsset } from "../src/types";

const assets: ImageAsset[] = [
  asset("background", 1920, 1080),
  asset("dialogueFrame", 1600, 250),
  asset("cursor", 48, 32),
];

test("样例剧本按帧首尾相接，转场独占时长", () => {
  const compiled = compileSample(sampleScript());
  assert.deepEqual(
    compiled.timeline.map((entry) => [entry.id, entry.startFrame, entry.durationFrames]),
    [
      ["d001", 0, 73],
      ["n001", 73, 57],
      ["c001", 130, 63],
      ["t001", 193, 18],
    ],
  );
  assert.equal(compiled.durationFrames, 211);
  assert.equal(compiled.timeline[3].startFrame, compiled.timeline[2].startFrame + compiled.timeline[2].durationFrames);
});

test("转场会延长上一事件并让黑场盖住中点", () => {
  const compiled = compileSample(sampleScript());
  const choice = comp(compiled, "EVENT_c001");
  const scene = comp(compiled, "SCENE_scene_01");
  const choiceLayer = layer(scene, "EVENT_c001");
  assert.equal(choice.durationFrames, 72);
  assert.equal(choiceLayer.inFrame, 130);
  assert.equal(choiceLayer.outFrame, 202);
  const black = layer(comp(compiled, "EVENT_t001"), "BLACK");
  assert.deepEqual(
    black.opacityKeys?.map((key) => [key.frame, key.value]),
    [
      [0, 0],
      [9, 100],
      [18, 100],
    ],
  );
});

test("选项光标从初始项移到预选结果，文字表达式不写死文案", () => {
  const compiled = compileSample(sampleScript());
  const cursor = layer(comp(compiled, "EVENT_c001"), "CURSOR");
  assert.equal(cursor.positionKeys?.[0].interp, "hold");
  assert.ok((cursor.positionKeys?.[0].y ?? 0) > (cursor.positionKeys?.[2].y ?? 0));
  const text = layer(comp(compiled, "EVENT_d001"), "TEXT_d001");
  assert.match(text.sourceTextExpression ?? "", /setText\(base\)/);
  assert.match(text.sourceTextExpression ?? "", /预览速度|字号倍率/);
  assert.equal(text.sourceTextExpression?.includes("连接已建立"), false);
  assert.match(text.reveal?.start ?? "", /\/\*VN_REVEAL\*\/\[0,3,5/);
  assert.equal(text.aeText, "连接已建立。\r是否继续？");
});

test("工程结构保留全局控制，并且不把控制合成放进主合成", () => {
  const compiled = compileSample(sampleScript());
  const master = comp(compiled, "MASTER");
  assert.deepEqual(
    master.layers.map((item) => item.name),
    ["SCENE_scene_01", "USER_OVERLAY"],
  );
  const control = comp(compiled, "CONTROL");
  const names = control.layers[0].effects?.map((effect) => effect.name);
  assert.deepEqual(names, ["字号倍率", "全局文字不透明度", "文字动画模式", "预览速度", "统一字体", "统一颜色"]);
  assert.equal(comp(compiled, "EVENT_d001").layers.map((item) => item.name).join(","), "DIALOGUE_FRAME,TEXT_d001");
  assert.equal(layer(comp(compiled, "EVENT_c001"), "OPTION_continue_TEXT").name, "OPTION_continue_TEXT");
});

test("跨场景淡入占用转场后半段，总时长不额外增加", () => {
  const script = sampleScript();
  script.scenes.push({
    id: "scene_02",
    events: [
      {
        id: "d002",
        type: "dialogue",
        text: "已经过来了。",
        animation: "fade",
        holdSeconds: 1.2,
      },
    ],
  });
  const compiled = compileSample(script);
  assert.equal(compiled.durationFrames, 211 + 12 + 36);
  const scene2 = comp(compiled, "SCENE_scene_02");
  const masterLayer = layer(comp(compiled, "MASTER"), "SCENE_scene_02");
  assert.equal(scene2.durationFrames - 9, masterLayer.outFrame! - 211);
  assert.equal(masterLayer.inFrame, 211 - 9);
  assert.equal(masterLayer.outFrame! - masterLayer.inFrame!, scene2.durationFrames);
  assert.equal(layer(scene2, "FADE_IN_t001").name, "FADE_IN_t001");
});

test("时长盖不住动画时失败，重复 ID 和错误选项也会失败", () => {
  const tooShort = sampleScript();
  tooShort.scenes[0].events[0].durationSeconds = 0.2;
  const normalized = normalizeProject(projectJson(), themeJson(), tooShort);
  assert.equal(normalized.errors.length, 0);
  const compiled = compile(normalized.project!, assets, "G:/exports/demo");
  assert.match(compiled.errors.map((error) => error.message).join("\n"), /不足以容纳/);

  const duplicated = sampleScript();
  duplicated.scenes[0].events.push({ ...duplicated.scenes[0].events[0], text: "另一句。" });
  assert.match(messages(tryCompile(duplicated)), /重复/);

  const missingOption = sampleScript();
  missingOption.scenes[0].events[2].selectedOptionId = "missing";
  assert.match(messages(tryCompile(missingOption)), /选中选项不存在/);

  const emoji = sampleScript();
  emoji.scenes[0].events[0].text = "你好😀";
  assert.match(messages(tryCompile(emoji)), /不支持的字符/);
});

function messages(result: { errors: { message: string }[] }): string {
  return result.errors.map((error) => error.message).join("\n");
}

function compileSample(script: Record<string, unknown>) {
  const result = tryCompile(script);
  assert.equal(result.errors.map((error) => `${error.path}: ${error.message}`).join("\n"), "");
  assert.ok(result.project);
  const compiled = compile(result.project!, assets, "G:/exports/demo");
  assert.deepEqual(compiled.errors, []);
  assert.ok(compiled.compiled);
  return compiled.compiled!;
}

function tryCompile(script: Record<string, unknown>) {
  return normalizeProject(projectJson(), themeJson(), script);
}

function comp(compiled: { comps: { name: string; durationFrames: number; layers: CompiledLayer[] }[] }, name: string) {
  const found = compiled.comps.find((item) => item.name === name);
  assert.ok(found, name);
  return found!;
}

function layer(item: { layers: CompiledLayer[] }, name: string) {
  const found = item.layers.find((entry) => entry.name === name);
  assert.ok(found, name);
  return found!;
}

interface CompiledLayer {
  name: string;
  durationFrames?: number;
  inFrame?: number;
  outFrame?: number;
  opacityKeys?: { frame: number; value: number }[];
  positionKeys?: { frame: number; y: number; interp: string }[];
  sourceTextExpression?: string;
  reveal?: { start: string };
  aeText?: string;
  effects?: { name: string }[];
}

function asset(id: ImageAsset["id"], width: number, height: number): ImageAsset {
  return {
    id,
    width,
    height,
    sourceRelativePath: `assets/${id}.png`,
    outputRelativePath: `assets/${id}.png`,
    absoluteSourcePath: `G:/video/assets/${id}.png`,
  };
}

function projectJson(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: "demo",
    name: "连接测试",
    width: 1920,
    height: 1080,
    fps: 30,
    theme: "theme.json",
    script: "script.json",
    timing: {
      charactersPerSecond: 12,
      lineIntervalSeconds: 0.5,
      defaultHoldSeconds: 1.2,
      commaPauseSeconds: 0.12,
      sentencePauseSeconds: 0.3,
    },
  };
}

function themeJson(): Record<string, unknown> {
  return {
    id: "terminal",
    assets: {
      background: "assets/background.png",
      dialogueFrame: "assets/dialogue-frame.png",
      cursor: "assets/cursor.png",
    },
    layout: {
      dialogueBox: { x: 160, y: 730, width: 1600, height: 250 },
      dialogueText: { x: 210, y: 775, width: 1500, height: 160 },
      narrationText: { x: 260, y: 380, width: 1400, height: 300 },
      options: { x: 460, y: 360, width: 1000, itemHeight: 90, gap: 20 },
    },
    styles: {
      dialogue: { font: "MicrosoftYaHei", fontSize: 42, lineHeight: 60, color: "#E9F6FF" },
      narration: { font: "MicrosoftYaHei", fontSize: 46, lineHeight: 68, color: "#FFFFFF" },
      option: { font: "MicrosoftYaHei", fontSize: 40, lineHeight: 56, color: "#D8ECFF" },
    },
  };
}

function sampleScript(): { scenes: Array<{ id: string; events: Array<Record<string, unknown>> }> } {
  return {
    scenes: [
      {
        id: "scene_01",
        events: [
          { id: "d001", type: "dialogue", text: "连接已建立。\n是否继续？", animation: "typewriter", holdSeconds: 1.2 },
          { id: "n001", type: "narration", text: "屏幕闪烁了一下。", animation: "fade", holdSeconds: 1.5 },
          {
            id: "c001",
            type: "choice",
            options: [
              { id: "continue", text: "继续连接" },
              { id: "disconnect", text: "断开连接" },
            ],
            initialOptionId: "disconnect",
            selectedOptionId: "continue",
            waitBeforeMoveSeconds: 0.8,
            moveSeconds: 0.2,
            holdAfterSelectSeconds: 0.6,
          },
          { id: "t001", type: "transition", preset: "fadeBlack", durationSeconds: 0.6 },
        ],
      },
    ],
  };
}
