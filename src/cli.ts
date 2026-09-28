#!/usr/bin/env node
import path from "node:path";
import { buildProject, validateProject } from "./pipeline";

const args = process.argv.slice(2);
const command = args[0];

if (command !== "validate" && command !== "build") {
  printUsage();
  process.exit(1);
}

const projectDir = args[1];
if (!projectDir || projectDir.startsWith("--")) {
  printUsage();
  process.exit(1);
}

if (command === "validate") {
  const result = validateProject(path.resolve(projectDir));
  finish(result.ok, result.errors, result.warnings, result.ok ? describe(result.durationFrames, result.durationSeconds, result.eventCount) : "");
}

const outIndex = args.indexOf("--out");
const outDir = outIndex >= 0 ? args[outIndex + 1] : undefined;
if (!outDir || outDir.startsWith("--")) {
  console.error("build 需要 --out 输出目录。");
  printUsage();
  process.exit(1);
}

const built = buildProject(path.resolve(projectDir), path.resolve(outDir));
finish(
  built.ok,
  built.errors,
  built.warnings,
  built.ok
    ? `${describe(built.durationFrames, built.durationSeconds, built.eventCount)}\n作品包：${path.join(built.outputDir || "", "vn-package.json")}`
    : "",
);

function describe(frames?: number, seconds?: number, events?: number): string {
  if (frames === undefined || seconds === undefined) return "";
  return `事件 ${events} 条，时长 ${frames} 帧（${seconds.toFixed(2)} 秒）`;
}

function finish(ok: boolean, errors: { path: string; message: string }[], warnings: { path: string; message: string }[], summary: string): void {
  for (const warning of warnings) console.warn(`警告  ${warning.path}: ${warning.message}`);
  if (!ok) {
    for (const error of errors) console.error(`错误  ${error.path}: ${error.message}`);
    process.exit(1);
  }
  console.log(summary);
  process.exit(0);
}

function printUsage(): void {
  console.log("用法:");
  console.log("  vn-ae validate <作品目录>");
  console.log("  vn-ae build <作品目录> --out <输出目录>");
  console.log("输出 vn-package.json。请换新的 --out 目录发布新版本，不要覆盖已经导入 After Effects 的作品包。");
}
