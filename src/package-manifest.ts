import fs from "node:fs";
import path from "node:path";
import type { CompiledProject } from "./types";

export const PACKAGE_VERSION = 1;
export const SUPPORTED_PACKAGE_VERSIONS = [1] as const;
export const SUPPORTED_COMPILED_SCHEMA_VERSIONS = [2] as const;
export const PACKAGE_ENTRY_NAME = "vn-package.json";

export interface PackageSummary {
  sceneCount: number;
  textEventCount: number;
  durationFrames: number;
  fps: number;
  width: number;
  height: number;
}

export interface PackageManifest {
  packageVersion: number;
  projectId: string;
  buildId: string;
  displayName: string;
  versionLabel: string;
  createdAt: string;
  generatorVersion: string;
  compiledSchemaVersion: number;
  entry: string;
  summary: PackageSummary;
}

export interface PackageInspection {
  ok: boolean;
  message: string;
  hint: string;
  details: string;
  manifest?: PackageManifest;
  packageRoot?: string;
}

export function summarizeCompiled(compiled: CompiledProject): PackageSummary {
  const scenes = new Set<string>();
  let textEventCount = 0;
  for (const entry of compiled.timeline) {
    scenes.add(entry.sceneId);
    if (entry.type === "dialogue" || entry.type === "narration") textEventCount += 1;
  }
  return {
    sceneCount: scenes.size,
    textEventCount,
    durationFrames: compiled.durationFrames,
    fps: compiled.fps,
    width: compiled.width,
    height: compiled.height,
  };
}

export function formatVersionLabel(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function createPackageManifest(compiled: CompiledProject, createdAt: Date): PackageManifest {
  return {
    packageVersion: PACKAGE_VERSION,
    projectId: compiled.id,
    buildId: compiled.buildId,
    displayName: compiled.name,
    versionLabel: formatVersionLabel(createdAt),
    createdAt: createdAt.toISOString(),
    generatorVersion: compiled.generatorVersion,
    compiledSchemaVersion: compiled.schemaVersion,
    entry: "compiled.json",
    summary: summarizeCompiled(compiled),
  };
}

export function safePackageRelative(relativePath: string): string | undefined {
  if (typeof relativePath !== "string" || relativePath.trim() === "") return undefined;
  if (relativePath.includes("\0") || relativePath.includes(":")) return undefined;
  const normalized = path.posix.normalize(relativePath.replaceAll("\\", "/"));
  if (
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.startsWith("/") ||
    path.posix.isAbsolute(normalized)
  ) {
    return undefined;
  }
  return normalized;
}

export function existingPackageBuildId(outputDir: string): string | undefined {
  for (const name of [PACKAGE_ENTRY_NAME, "compiled.json"]) {
    const filePath = path.join(outputDir, name);
    if (!fs.existsSync(filePath)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "")) as { buildId?: unknown };
      if (typeof data.buildId === "string" && data.buildId.length > 0) return data.buildId;
    } catch {
      return "unreadable";
    }
    return "unreadable";
  }
  return undefined;
}

export function assertCanWritePackage(outputDir: string, buildId: string): void {
  const existing = existingPackageBuildId(outputDir);
  if (!existing || existing === buildId) return;
  if (existing === "unreadable") {
    throw new Error("输出目录里已有无法识别的工程文件。请换一个目录，避免覆盖 After Effects 正在引用的素材。");
  }
  throw new Error(`输出目录已有另一版本的作品包（${existing}）。请换一个 --out 目录，避免覆盖 After Effects 正在引用的素材。`);
}

export function inspectPackageDirectory(dir: string): PackageInspection {
  return inspectManifestFile(path.join(dir, PACKAGE_ENTRY_NAME));
}

export function inspectManifestFile(manifestPath: string): PackageInspection {
  const resolved = path.resolve(manifestPath);
  if (path.basename(resolved) !== PACKAGE_ENTRY_NAME) {
    return inspectionFailure("请选择作品包里的 vn-package.json。", "选择作品目录中的 vn-package.json。", resolved);
  }
  if (!fs.existsSync(resolved)) {
    return inspectionFailure("找不到作品包入口。", "请重新选择 vn-package.json。", resolved);
  }
  let manifestRaw: unknown;
  try {
    manifestRaw = JSON.parse(fs.readFileSync(resolved, "utf8").replace(/^\uFEFF/, "")) as unknown;
  } catch (error) {
    return inspectionFailure("无法导入：作品包格式无法解析。", "请重新生成完整作品包。", error instanceof Error ? error.message : String(error));
  }
  const checked = validateManifest(manifestRaw, path.dirname(resolved));
  if (!checked.ok) return checked;
  return {
    ok: true,
    message: "可以导入",
    hint: "",
    details: detailLines(checked.manifest as PackageManifest, resolved),
    manifest: checked.manifest,
    packageRoot: path.dirname(resolved),
  };
}

function validateManifest(value: unknown, packageRoot: string): PackageInspection & { manifest?: PackageManifest } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return inspectionFailure("无法导入：作品包格式无法解析。", "请重新生成完整作品包。", "根节点必须是对象");
  }
  const manifest = value as Partial<PackageManifest>;
  if (!SUPPORTED_PACKAGE_VERSIONS.includes(manifest.packageVersion as (typeof SUPPORTED_PACKAGE_VERSIONS)[number])) {
    return inspectionFailure(
      `无法导入：作品包版本 ${String(manifest.packageVersion)} 不受支持。`,
      "请用当前生成器重新构建作品包。",
      `packageVersion=${String(manifest.packageVersion)}`,
    );
  }
  if (!SUPPORTED_COMPILED_SCHEMA_VERSIONS.includes(manifest.compiledSchemaVersion as (typeof SUPPORTED_COMPILED_SCHEMA_VERSIONS)[number])) {
    return inspectionFailure(
      `无法导入：工程数据版本 ${String(manifest.compiledSchemaVersion)} 不受支持。`,
      "请用当前生成器重新构建作品包。",
      `compiledSchemaVersion=${String(manifest.compiledSchemaVersion)}`,
    );
  }
  const entry = safePackageRelative(typeof manifest.entry === "string" ? manifest.entry : "");
  if (!entry) {
    return inspectionFailure("无法导入：工程数据路径超出作品包。", "请重新生成完整作品包。", String(manifest.entry || ""));
  }
  const compiledPath = path.join(packageRoot, entry);
  if (!fs.existsSync(compiledPath)) {
    return inspectionFailure("无法导入：找不到 compiled.json。", "请重新生成完整作品包。", entry);
  }
  let compiled: CompiledProject;
  try {
    compiled = JSON.parse(fs.readFileSync(compiledPath, "utf8").replace(/^\uFEFF/, "")) as CompiledProject;
  } catch (error) {
    return inspectionFailure("无法导入：工程数据无法解析。", "请重新生成完整作品包。", error instanceof Error ? error.message : String(error));
  }
  if (compiled.schemaVersion !== manifest.compiledSchemaVersion || compiled.id !== manifest.projectId || compiled.buildId !== manifest.buildId) {
    return inspectionFailure("无法导入：入口信息和工程数据不是同一份构建。", "请重新生成完整作品包。", `${compiled.id}/${compiled.buildId}`);
  }
  if (!summaryMatches(manifest.summary, compiled)) {
    return inspectionFailure("无法导入：作品包摘要和工程数据不一致。", "请重新生成完整作品包。", "summary");
  }
  const missing: string[] = [];
  for (const asset of compiled.assets || []) {
    const relative = safePackageRelative(asset.relativePath || "");
    if (!relative) {
      return inspectionFailure("无法导入：素材路径超出作品包。", "请重新生成完整作品包。", asset.relativePath || asset.id);
    }
    if (!fs.existsSync(path.join(packageRoot, relative))) missing.push(path.posix.basename(relative));
  }
  if (missing.length > 0) {
    const listed = missing.slice(0, 3).join("、");
    return inspectionFailure(
      `无法导入：找不到 ${listed}`,
      "请重新生成完整作品包，或恢复缺失素材。",
      missing.join("\n"),
    );
  }
  return { ok: true, message: "", hint: "", details: "", manifest: manifest as PackageManifest };
}

function summaryMatches(summary: PackageSummary | undefined, compiled: CompiledProject): boolean {
  if (!summary) return false;
  const expected = summarizeCompiled(compiled);
  return (
    summary.sceneCount === expected.sceneCount &&
    summary.textEventCount === expected.textEventCount &&
    summary.durationFrames === expected.durationFrames &&
    summary.fps === expected.fps &&
    summary.width === expected.width &&
    summary.height === expected.height
  );
}

function detailLines(manifest: PackageManifest, manifestPath: string): string {
  return [
    `作品：${manifest.displayName}`,
    `版本：${manifest.versionLabel}`,
    `生成时间：${manifest.createdAt}`,
    `buildId：${manifest.buildId}`,
    `数据格式：${manifest.compiledSchemaVersion}`,
    `生成器：${manifest.generatorVersion}`,
    `入口：${manifestPath}`,
  ].join("\n");
}

function inspectionFailure(message: string, hint: string, details: string): PackageInspection {
  return { ok: false, message, hint, details };
}
