import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildProject } from "../src/pipeline";
import { inspectManifestFile, inspectPackageDirectory } from "../src/package-manifest";

test("作品包可移动，摘要被改过或素材缺失时不能导入", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vn-pkg-"));
  const projectDir = path.join(root, "video");
  const outputDir = path.join(root, "作品 包");
  writeMiniProject(projectDir, "第一句。");
  const built = buildProject(projectDir, outputDir);
  assert.equal(built.ok, true, built.errors.map((error) => error.message).join("\n"));

  const moved = path.join(root, "moved pack");
  copyDir(outputDir, moved);
  const movedInspection = inspectPackageDirectory(moved);
  assert.equal(movedInspection.ok, true, movedInspection.message);

  const manifestPath = path.join(outputDir, "vn-package.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { summary: { sceneCount: number }; packageVersion: number; buildId: string };
  manifest.summary.sceneCount += 1;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  const mismatch = inspectManifestFile(manifestPath);
  assert.equal(mismatch.ok, false);
  assert.match(mismatch.message, /摘要/);

  manifest.summary.sceneCount -= 1;
  manifest.packageVersion = 99;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  const unsupported = inspectManifestFile(manifestPath);
  assert.equal(unsupported.ok, false);
  assert.match(unsupported.message, /不受支持/);

  const rebuilt = buildProject(projectDir, outputDir);
  assert.equal(rebuilt.ok, true, rebuilt.errors.map((error) => error.message).join("\n"));
  fs.rmSync(path.join(outputDir, "assets", "dialogue-frame.png"));
  const missing = inspectPackageDirectory(outputDir);
  assert.equal(missing.ok, false);
  assert.match(missing.message, /dialogue-frame\.png/);
  assert.match(missing.hint, /恢复缺失素材/);

  const compiled = JSON.parse(fs.readFileSync(path.join(moved, "compiled.json"), "utf8")) as { assets: { relativePath: string }[] };
  compiled.assets[0].relativePath = "../secret.png";
  fs.writeFileSync(path.join(moved, "compiled.json"), JSON.stringify(compiled));
  const escaped = inspectPackageDirectory(moved);
  assert.equal(escaped.ok, false);
  assert.match(escaped.message, /超出作品包|不是同一份构建|摘要/);
});

test("新版本不会覆盖已经生成的作品包目录", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vn-ver-"));
  const projectDir = path.join(root, "video");
  const outputDir = path.join(root, "out");
  writeMiniProject(projectDir, "第一句。");
  const first = buildProject(projectDir, outputDir);
  assert.equal(first.ok, true, first.errors.map((error) => error.message).join("\n"));
  const firstId = JSON.parse(fs.readFileSync(path.join(outputDir, "vn-package.json"), "utf8")).buildId as string;

  writeMiniProject(projectDir, "完全不同的第二句。");
  const second = buildProject(projectDir, outputDir);
  assert.equal(second.ok, false);
  assert.match(second.errors.map((error) => error.message).join("\n"), /另一版本/);
  const still = JSON.parse(fs.readFileSync(path.join(outputDir, "vn-package.json"), "utf8")).buildId as string;
  assert.equal(still, firstId);
});

test("独立面板不从脚本目录寻找作品包", () => {
  execFileSync(process.execPath, ["scripts/build-panel.mjs"], { cwd: path.join(__dirname, "..") });
  const panelPath = path.join(__dirname, "..", "release", "VN Panel.jsx");
  const panel = fs.readFileSync(panelPath);
  assert.deepEqual([panel[0], panel[1], panel[2]], [0xef, 0xbb, 0xbf]);
  const text = panel.toString("utf8");
  assert.match(text, /VN\.buildPanel\(this\)/);
  assert.match(text, /VN\.inspectPackage/);
  assert.match(text, /saveProject: false/);
  assert.match(text, /选择一个作品包开始/);
  assert.match(text, /按新文案重建动画/);
  assert.equal(text.includes("=>"), false);
  assert.equal(text.includes("VN.migrate"), false);
  assert.equal(text.includes('scriptFolder().fsName + "/compiled.json"'), false);
});

function copyDir(from: string, to: string): void {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(source, target);
    else fs.copyFileSync(source, target);
  }
}

function writeMiniProject(dir: string, line: string): void {
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
      scenes: [{ id: "scene_01", events: [{ id: "d001", type: "dialogue", text: line, animation: "typewriter" }] }],
    }),
  );
}

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
