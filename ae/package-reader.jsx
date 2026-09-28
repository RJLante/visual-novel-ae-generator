var VN = VN || {};

VN.PACKAGE_VERSION = 1;
VN.SUPPORTED_PACKAGE_VERSION = 1;
VN.SUPPORTED_SCHEMA_VERSION = 2;

VN.fileBaseName = function (value) {
  var text = String(value || "").replace(/\\/g, "/");
  var parts = text.split("/");
  return parts[parts.length - 1] || text;
};

VN.unsafeRelative = function (value) {
  if (!value) return true;
  var text = String(value).replace(/\\/g, "/");
  if (text.indexOf(":") !== -1) return true;
  if (text.charAt(0) === "/") return true;
  var parts = text.split("/");
  var i;
  for (i = 0; i < parts.length; i++) {
    if (parts[i] === "..") return true;
  }
  return false;
};

VN.summarizeCompiled = function (compiled) {
  var scenes = {};
  var sceneCount = 0;
  var textEventCount = 0;
  var timeline = compiled.timeline || [];
  var i;
  for (i = 0; i < timeline.length; i++) {
    var entry = timeline[i];
    if (!scenes[entry.sceneId]) {
      scenes[entry.sceneId] = true;
      sceneCount++;
    }
    if (entry.type === "dialogue" || entry.type === "narration") textEventCount++;
  }
  return {
    sceneCount: sceneCount,
    textEventCount: textEventCount,
    durationFrames: compiled.durationFrames,
    fps: compiled.fps,
    width: compiled.width,
    height: compiled.height
  };
};

VN.summaryMatches = function (summary, compiled) {
  if (!summary) return false;
  var expected = VN.summarizeCompiled(compiled);
  return summary.sceneCount === expected.sceneCount &&
    summary.textEventCount === expected.textEventCount &&
    summary.durationFrames === expected.durationFrames &&
    summary.fps === expected.fps &&
    summary.width === expected.width &&
    summary.height === expected.height;
};

VN.inspectFailure = function (message, hint, details) {
  return { ok: false, message: message, hint: hint || "", details: details || "", manifest: null, compiled: null, packageRoot: null };
};

VN.inspectPackage = function (manifestFile) {
  if (!manifestFile) return VN.inspectFailure("找不到作品包入口。", "请重新选择 vn-package.json。", "");
  if (String(manifestFile.name).toLowerCase() !== "vn-package.json") {
    return VN.inspectFailure("请选择作品包里的 vn-package.json。", "选择作品目录中的 vn-package.json。", manifestFile.fsName);
  }
  if (!manifestFile.exists) return VN.inspectFailure("找不到作品包入口。", "请重新选择 vn-package.json。", manifestFile.fsName);
  var manifest;
  try {
    manifest = VN.readJsonFile(manifestFile);
  } catch (err) {
    return VN.inspectFailure("无法导入：作品包格式无法解析。", "请重新生成完整作品包。", err.toString());
  }
  if (!manifest || manifest.packageVersion !== VN.SUPPORTED_PACKAGE_VERSION) {
    return VN.inspectFailure(
      "无法导入：作品包版本 " + (manifest ? manifest.packageVersion : "") + " 不受支持。",
      "请用当前生成器重新构建作品包。",
      "packageVersion"
    );
  }
  if (manifest.compiledSchemaVersion !== VN.SUPPORTED_SCHEMA_VERSION) {
    return VN.inspectFailure(
      "无法导入：工程数据版本 " + manifest.compiledSchemaVersion + " 不受支持。",
      "请用当前生成器重新构建作品包。",
      "compiledSchemaVersion"
    );
  }
  if (VN.unsafeRelative(manifest.entry)) {
    return VN.inspectFailure("无法导入：工程数据路径超出作品包。", "请重新生成完整作品包。", String(manifest.entry || ""));
  }
  var packageRoot = manifestFile.parent;
  var compiledFile = new File(packageRoot.fsName + "/" + manifest.entry);
  if (!compiledFile.exists) return VN.inspectFailure("无法导入：找不到 compiled.json。", "请重新生成完整作品包。", manifest.entry);
  var compiled;
  try {
    compiled = VN.readJsonFile(compiledFile);
  } catch (errCompiled) {
    return VN.inspectFailure("无法导入：工程数据无法解析。", "请重新生成完整作品包。", errCompiled.toString());
  }
  if (compiled.schemaVersion !== manifest.compiledSchemaVersion || compiled.id !== manifest.projectId || compiled.buildId !== manifest.buildId) {
    return VN.inspectFailure("无法导入：入口信息和工程数据不是同一份构建。", "请重新生成完整作品包。", compiled.id + "/" + compiled.buildId);
  }
  if (!VN.summaryMatches(manifest.summary, compiled)) {
    return VN.inspectFailure("无法导入：作品包摘要和工程数据不一致。", "请重新生成完整作品包。", "summary");
  }
  var missing = [];
  var assets = compiled.assets || [];
  var i;
  for (i = 0; i < assets.length; i++) {
    var relative = assets[i].relativePath;
    if (VN.unsafeRelative(relative)) {
      return VN.inspectFailure("无法导入：素材路径超出作品包。", "请重新生成完整作品包。", String(relative || assets[i].id));
    }
    var assetFile = new File(packageRoot.fsName + "/" + relative);
    if (!assetFile.exists) missing.push(VN.fileBaseName(relative));
  }
  if (missing.length) {
    var listed = missing.slice(0, 3).join("、");
    return VN.inspectFailure("无法导入：找不到 " + listed, "请重新生成完整作品包，或恢复缺失素材。", missing.join("\n"));
  }
  return {
    ok: true,
    message: "可以导入",
    hint: "",
    details: VN.packageDetailText(manifest, manifestFile),
    manifest: manifest,
    compiled: compiled,
    packageRoot: packageRoot
  };
};

VN.packageDetailText = function (manifest, manifestFile) {
  return [
    "作品：" + manifest.displayName,
    "版本：" + manifest.versionLabel,
    "生成时间：" + manifest.createdAt,
    "buildId：" + manifest.buildId,
    "数据格式：" + manifest.compiledSchemaVersion,
    "生成器：" + manifest.generatorVersion,
    "入口：" + manifestFile.fsName
  ].join("\n");
};

VN.formatDuration = function (frames, fps) {
  if (!fps) return frames + " 帧";
  var seconds = Math.round(frames / fps);
  if (seconds < 60) return seconds + " 秒";
  var minutes = Math.floor(seconds / 60);
  var rest = seconds % 60;
  if (!rest) return minutes + " 分";
  return minutes + " 分 " + rest + " 秒";
};
