import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildProject, validateProject } from "../src/pipeline";

test("build 输出 JSX、编排、配置快照和检查报告", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vn-ae-"));
  const projectDir = path.join(root, "video");
  const outputDir = path.join(root, "out");
  writeMiniProject(projectDir);
  const validated = validateProject(projectDir);
  assert.equal(validated.ok, true, validated.errors.map((error) => error.message).join("\n"));
  const built = buildProject(projectDir, outputDir);
  assert.equal(built.ok, true, built.errors.map((error) => error.message).join("\n"));
  for (const name of [
    "vn-package.json",
    "generate_project.jsx",
    "refresh_text_timing.jsx",
    "convert_v1_text_animation.jsx",
    "compiled.json",
    "report.json",
  ]) {
    assert.equal(fs.existsSync(path.join(outputDir, name)), true, name);
  }
  assert.equal(fs.existsSync(path.join(outputDir, "vn_panel.jsx")), false);
  const jsx = fs.readFileSync(path.join(outputDir, "generate_project.jsx"));
  assert.deepEqual([jsx[0], jsx[1], jsx[2]], [0xef, 0xbb, 0xbf]);
  const jsxText = jsx.toString("utf8");
  assert.match(jsxText, /VN\.main\(\)/);
  assert.match(jsxText, /VN\.runImport\(/);
  assert.match(jsxText, /saveProject: app\.project\.numItems === 0/);
  assert.match(jsxText, /After Effects 2021/);
  assert.match(jsxText, /ensureExpressionEngineCompatible/);
  assert.equal(jsxText.includes('scriptFolder().fsName + "/compiled.json"'), false);
  assert.equal(jsxText.includes("ensureEmptyProject"), false);
  assert.equal(jsxText.includes("2022"), false);
  assert.match(fs.readFileSync(path.join(outputDir, "refresh_text_timing.jsx"), "utf8"), /VN\.refresh\(\)/);
  assert.match(fs.readFileSync(path.join(outputDir, "convert_v1_text_animation.jsx"), "utf8"), /VN\.migrate\(\)/);
  const compiled = JSON.parse(fs.readFileSync(path.join(outputDir, "compiled.json"), "utf8")) as {
    schemaVersion: number;
    buildId: string;
    durationFrames: number;
    assets: { absolutePath: string; relativePath: string }[];
    timeline: unknown[];
  };
  const manifest = JSON.parse(fs.readFileSync(path.join(outputDir, "vn-package.json"), "utf8")) as {
    packageVersion: number;
    entry: string;
    buildId: string;
    summary: { sceneCount: number; textEventCount: number; durationFrames: number };
  };
  assert.equal(manifest.packageVersion, 1);
  assert.equal(manifest.entry, "compiled.json");
  assert.equal(manifest.buildId, compiled.buildId);
  assert.equal(manifest.summary.durationFrames, compiled.durationFrames);
  assert.equal(manifest.summary.textEventCount, 1);
  assert.equal(compiled.schemaVersion, 2);
  assert.equal(compiled.assets[0].relativePath, "assets/background.png");
  assert.match(compiled.assets[0].absolutePath, /assets\/background\.png$/);
  assert.equal(fs.existsSync(path.join(outputDir, "source", "script.json")), true);
  assert.equal(fs.existsSync(path.join(outputDir, "assets", "cursor.png")), true);
  const report = JSON.parse(fs.readFileSync(path.join(outputDir, "report.json"), "utf8")) as { ae: { status: string } };
  assert.equal(report.ae.status, "pending");
  assert.ok(compiled.timeline.length > 0);
});

test("示例样片落在 30 到 60 秒", () => {
  const result = validateProject(path.join(__dirname, "..", "examples", "connection-test"));
  assert.equal(result.ok, true, result.errors.map((error) => `${error.path}: ${error.message}`).join("\n"));
  assert.ok(result.durationSeconds !== undefined);
  assert.ok(result.durationSeconds >= 30 && result.durationSeconds <= 60, `实际 ${result.durationSeconds} 秒`);
});

function writeMiniProject(dir: string): void {
  fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
  fs.writeFileSync(path.join(dir, "assets", "background.png"), PNG);
  fs.writeFileSync(path.join(dir, "assets", "dialogue-frame.png"), PNG);
  fs.writeFileSync(path.join(dir, "assets", "cursor.png"), PNG);
  fs.writeFileSync(
    path.join(dir, "project.json"),
    JSON.stringify({
      schemaVersion: 1,
      id: "mini",
      name: "迷你",
      width: 1920,
      height: 1080,
      fps: 30,
      theme: "theme.json",
      script: "script.json",
      timing: { charactersPerSecond: 12, lineIntervalSeconds: 0.5, defaultHoldSeconds: 0.4 },
    }),
  );
  fs.writeFileSync(
    path.join(dir, "theme.json"),
    JSON.stringify({
      id: "terminal",
      assets: {
        background: "assets/background.png",
        dialogueFrame: "assets/dialogue-frame.png",
        cursor: "assets/cursor.png",
      },
      layout: {
        dialogueBox: { x: 100, y: 700, width: 1600, height: 250 },
        dialogueText: { x: 150, y: 740, width: 1400, height: 160 },
        narrationText: { x: 200, y: 300, width: 1400, height: 300 },
        options: { x: 400, y: 300, width: 800, itemHeight: 80, gap: 16 },
      },
      styles: {
        dialogue: { font: "MicrosoftYaHei", fontSize: 42, lineHeight: 60, color: "#E9F6FF" },
        narration: { font: "MicrosoftYaHei", fontSize: 46, lineHeight: 68, color: "#FFFFFF" },
        option: { font: "MicrosoftYaHei", fontSize: 40, lineHeight: 56, color: "#D8ECFF" },
      },
    }),
  );
  fs.writeFileSync(
    path.join(dir, "script.json"),
    JSON.stringify({
      scenes: [
        {
          id: "scene_01",
          events: [
            { id: "d001", type: "dialogue", text: "你好。", animation: "typewriter" },
            {
              id: "c001",
              type: "choice",
              options: [
                { id: "a", text: "留下" },
                { id: "b", text: "离开" },
              ],
              initialOptionId: "a",
              selectedOptionId: "b",
            },
          ],
        },
      ],
    }),
  );
}

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
