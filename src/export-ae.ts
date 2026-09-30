import fs from "node:fs";
import path from "node:path";
import { assertCanWritePackage, createPackageManifest, inspectManifestFile, PACKAGE_ENTRY_NAME } from "./package-manifest";
import type { CompiledProject, ImageAsset, Issue } from "./types";

const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

export function exportBuild(input: {
  projectDir: string;
  outputDir: string;
  projectFile: string;
  themeFile: string;
  scriptFile: string;
  compiled: CompiledProject;
  assets: ImageAsset[];
  warnings: Issue[];
}): void {
  const outputDir = path.resolve(input.outputDir);
  const projectDir = path.resolve(input.projectDir);
  if (outputDir === projectDir) {
    throw new Error("输出目录不能和作品目录相同");
  }
  assertCanWritePackage(outputDir, input.compiled.buildId);
  fs.mkdirSync(path.join(outputDir, "source"), { recursive: true });
  fs.copyFileSync(input.projectFile, path.join(outputDir, "source", "project.json"));
  fs.copyFileSync(input.themeFile, path.join(outputDir, "source", "theme.json"));
  fs.copyFileSync(input.scriptFile, path.join(outputDir, "source", "script.json"));
  for (const asset of input.assets) {
    const target = path.join(outputDir, asset.outputRelativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(asset.absoluteSourcePath, target);
  }

  const compiledPath = path.join(outputDir, "compiled.json");
  fs.writeFileSync(compiledPath, `${JSON.stringify(input.compiled, null, 2)}\n`, "utf8");
  writeJsx(
    path.join(outputDir, "generate_project.jsx"),
    `${header(input.compiled, "兼容入口：在 After Effects 里用「文件 > 脚本 > 运行脚本文件」执行。空项目会另存为新工程；已有工程会追加一个独立实例。日常导入请安装一次「文字冒险」面板，再选择 vn-package.json。")}\n${readAe("lib.jsx")}\n${readAe("project.jsx")}\n${readAe("layers.jsx")}\n${readAe("package-reader.jsx")}\n${readAe("import-service.jsx")}\n${readAe("bootstrap.jsx")}\nVN.main();\n`,
  );
  writeJsx(
    path.join(outputDir, "refresh_text_timing.jsx"),
    `${header(input.compiled, "选中第二版文字层后运行。按当前文案重写打字关键帧；手工改过的关键帧会跳过。")}\n${readAe("lib.jsx")}\n${readAe("timing.jsx")}\n${readAe("refresh.jsx")}\nVN.refresh();\n`,
  );
  writeJsx(
    path.join(outputDir, "convert_v1_text_animation.jsx"),
    `${header(input.compiled, "打开第一版工程中的合成后运行。把生成器管理的动画表达式采样成关键帧，保留样式表达式。")}\n${readAe("lib.jsx")}\n${readAe("migrate-v1.jsx")}\nVN.migrate();\n`,
  );
  const report = {
    ok: true,
    stage: "node",
    projectId: input.compiled.id,
    name: input.compiled.name,
    durationFrames: input.compiled.durationFrames,
    durationSeconds: input.compiled.durationFrames / input.compiled.fps,
    sceneCount: input.compiled.timeline.reduce((ids, entry) => ids.add(entry.sceneId), new Set<string>()).size,
    eventCount: input.compiled.timeline.length,
    errors: [],
    warnings: input.warnings,
    timeline: input.compiled.timeline,
    ae: {
      status: "pending",
      note: "用「文字冒险」面板选择 vn-package.json 导入。面板不会自动保存工程。兼容脚本 generate_project.jsx 在空项目里仍会另存为新工程。",
    },
    outputs: [
      PACKAGE_ENTRY_NAME,
      "compiled.json",
      "source/project.json",
      "source/theme.json",
      "source/script.json",
      "report.json",
      "generate_project.jsx",
      "refresh_text_timing.jsx",
      "convert_v1_text_animation.jsx",
    ],
  };
  fs.writeFileSync(path.join(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const manifest = createPackageManifest(input.compiled, new Date());
  const manifestPath = path.join(outputDir, PACKAGE_ENTRY_NAME);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const inspection = inspectManifestFile(manifestPath);
  if (!inspection.ok) {
    fs.rmSync(manifestPath, { force: true });
    throw new Error(inspection.message);
  }
}

function header(compiled: CompiledProject, usage: string): string {
  return [
    "// Visual Novel AE Generator " + compiled.generatorVersion,
    "// " + usage,
    "// 目标：After Effects 2021（18.0）或更新版本，JavaScript 表达式引擎，Windows。",
    "",
  ].join("\n");
}

function readAe(name: string): string {
  return fs.readFileSync(path.join(__dirname, "..", "ae", name), "utf8").replace(/^\uFEFF/, "");
}

function writeJsx(filePath: string, contents: string): void {
  fs.writeFileSync(filePath, Buffer.concat([BOM, Buffer.from(contents, "utf8")]));
}
