import fs from "node:fs";
import path from "node:path";
import { compile } from "./compiler";
import { exportBuild } from "./export-ae";
import { readImageSize } from "./image-size";
import { normalizeProject } from "./normalize";
import type { CompiledProject, ImageAsset, Issue, NormalizedProject } from "./types";

export interface RunResult {
  ok: boolean;
  errors: Issue[];
  warnings: Issue[];
  durationFrames?: number;
  durationSeconds?: number;
  eventCount?: number;
  outputDir?: string;
  compiled?: CompiledProject;
}

export function validateProject(projectDir: string): RunResult {
  return run(projectDir, projectDir, false);
}

export function buildProject(projectDir: string, outputDir: string): RunResult {
  return run(projectDir, outputDir, true);
}

function run(projectDir: string, outputDir: string, write: boolean): RunResult {
  const loaded = loadProject(projectDir, outputDir);
  if (!loaded.ok || !loaded.compiled) {
    return { ok: false, errors: loaded.errors, warnings: loaded.warnings };
  }
  if (write) {
    exportBuild({
      projectDir,
      outputDir,
      projectFile: loaded.projectFile!,
      themeFile: loaded.themeFile!,
      scriptFile: loaded.scriptFile!,
      compiled: loaded.compiled,
      assets: loaded.assets!,
      warnings: loaded.warnings,
    });
  }
  return {
    ok: true,
    errors: [],
    warnings: loaded.warnings,
    durationFrames: loaded.compiled.durationFrames,
    durationSeconds: loaded.compiled.durationFrames / loaded.compiled.fps,
    eventCount: loaded.compiled.timeline.length,
    outputDir: write ? outputDir : undefined,
    compiled: loaded.compiled,
  };
}

function loadProject(projectDir: string, outputDir: string): {
  ok: boolean;
  errors: Issue[];
  warnings: Issue[];
  compiled?: CompiledProject;
  assets?: ImageAsset[];
  projectFile?: string;
  themeFile?: string;
  scriptFile?: string;
} {
  const errors: Issue[] = [];
  const root = path.resolve(projectDir);
  const projectFile = path.join(root, "project.json");
  if (!fs.existsSync(projectFile)) {
    return { ok: false, errors: [{ path: "project.json", message: "找不到 project.json" }], warnings: [] };
  }
  let projectRaw: Record<string, unknown>;
  try {
    projectRaw = readJson(projectFile);
  } catch (error) {
    return { ok: false, errors: [{ path: "project.json", message: `JSON 无法解析：${messageOf(error)}` }], warnings: [] };
  }
  const themeRel = typeof projectRaw.theme === "string" ? projectRaw.theme : "theme.json";
  const scriptRel = typeof projectRaw.script === "string" ? projectRaw.script : "script.json";
  const themeFile = resolveInside(root, themeRel, "project.json.theme", errors);
  const scriptFile = resolveInside(root, scriptRel, "project.json.script", errors);
  if (!themeFile || !scriptFile) return { ok: false, errors, warnings: [] };

  let themeRaw: unknown;
  let scriptRaw: unknown;
  try {
    themeRaw = readJson(themeFile);
  } catch (error) {
    errors.push({ path: themeRel, message: `JSON 无法解析：${messageOf(error)}` });
  }
  try {
    scriptRaw = readJson(scriptFile);
  } catch (error) {
    errors.push({ path: scriptRel, message: `JSON 无法解析：${messageOf(error)}` });
  }
  if (errors.length > 0 || themeRaw === undefined || scriptRaw === undefined) return { ok: false, errors, warnings: [] };

  const normalized = normalizeProject(projectRaw, themeRaw, scriptRaw);
  if (!normalized.project || normalized.errors.length > 0) {
    return { ok: false, errors: normalized.errors, warnings: [] };
  }
  const assets = resolveAssets(root, normalized.project, errors);
  if (!assets) return { ok: false, errors, warnings: [] };

  const compiledResult = compile(normalized.project, assets, path.resolve(outputDir));
  return {
    ok: compiledResult.errors.length === 0 && compiledResult.compiled !== undefined,
    errors: compiledResult.errors,
    warnings: compiledResult.warnings,
    compiled: compiledResult.compiled,
    assets,
    projectFile,
    themeFile,
    scriptFile,
  };
}

function resolveAssets(projectDir: string, project: NormalizedProject, errors: Issue[]): ImageAsset[] | undefined {
  const entries: Array<["background" | "dialogueFrame" | "cursor", string]> = [
    ["background", project.theme.assets.background],
    ["dialogueFrame", project.theme.assets.dialogueFrame],
    ["cursor", project.theme.assets.cursor],
  ];
  const assets: ImageAsset[] = [];
  for (const [id, relativePath] of entries) {
    const absolute = resolveInside(projectDir, relativePath, `theme.json.assets.${id}`, errors);
    if (!absolute) continue;
    try {
      const size = readImageSize(absolute);
      assets.push({
        id,
        sourceRelativePath: relativePath.replace(/\\/g, "/"),
        outputRelativePath: relativePath.replace(/\\/g, "/"),
        absoluteSourcePath: absolute,
        width: size.width,
        height: size.height,
      });
    } catch (error) {
      errors.push({ path: `theme.json.assets.${id}`, message: messageOf(error) });
    }
  }
  return errors.length > 0 ? undefined : assets;
}

function resolveInside(root: string, relativePath: string, label: string, errors: Issue[]): string | undefined {
  if (typeof relativePath !== "string" || relativePath.trim() === "") {
    errors.push({ path: label, message: "路径必须是非空字符串" });
    return undefined;
  }
  if (path.isAbsolute(relativePath)) {
    errors.push({ path: label, message: "请使用相对作品目录的路径" });
    return undefined;
  }
  const absolute = path.resolve(root, relativePath);
  const relative = path.relative(root, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    errors.push({ path: label, message: "路径不能跳出作品目录" });
    return undefined;
  }
  if (!fs.existsSync(absolute)) {
    errors.push({ path: label, message: `找不到文件：${relativePath}` });
    return undefined;
  }
  return absolute;
}

function readJson(filePath: string): Record<string, unknown> {
  const text = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  const value = JSON.parse(text) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("根节点必须是对象");
  }
  return value as Record<string, unknown>;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
