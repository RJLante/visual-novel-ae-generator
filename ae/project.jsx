var VN = VN || {};

VN.ensureVersion = function () {
  var major = parseInt(app.version, 10);
  if (isNaN(major) || major < 18) {
    throw new Error("需要 After Effects 2021 或更新版本。当前版本号是 " + app.version + "。");
  }
};

VN.setExpressionEngine = function () {
  if (app.project.expressionEngine === undefined) {
    throw new Error("无法读取表达式引擎。After Effects 2021 需要 JavaScript 引擎，文字样式表达式才会生效。");
  }
  app.project.expressionEngine = "javascript-1.0";
};

VN.ensureExpressionEngineCompatible = function () {
  if (app.project.expressionEngine === undefined) {
    throw new Error("无法读取表达式引擎。After Effects 2021 需要 JavaScript 引擎，文字样式表达式才会生效。");
  }
  if (app.project.expressionEngine !== "javascript-1.0") {
    throw new Error(
      "当前工程的表达式引擎是 " +
        app.project.expressionEngine +
        "。追加导入不会切换引擎，否则会改变已有表达式。请在项目设置里改用 JavaScript，或从空项目生成新工程。"
    );
  }
};

VN.prepareInstance = function (ctx, compiled) {
  var used = VN.usedItemNames();
  var projectTag = VN.projectTag(compiled.id);
  var tag = "";
  var folderName = "";
  var guard = 0;
  do {
    tag = VN.randomTag();
    folderName = "VN_" + projectTag + "_" + tag;
    guard += 1;
  } while (used[folderName] && guard < 50);
  if (used[folderName]) throw new Error("无法分配不重复的实例名称。");
  ctx.used = used;
  ctx.instanceTag = tag;
  ctx.folderName = folderName;
  ctx.instanceId = folderName;
  ctx.projectId = compiled.id;
  ctx.buildId = compiled.buildId;
  ctx.generatorVersion = compiled.generatorVersion;
  if (!ctx.displayName) ctx.displayName = compiled.name || "";
  if (!ctx.versionLabel) ctx.versionLabel = "";
  ctx.names = {};
  ctx.folders = [];
  ctx.footage = [];
  ctx.comps = [];
  ctx.insertedLayers = [];
  used[folderName] = true;
};

VN.compNameFor = function (ctx, suffix) {
  var prefix = "VN_" + ctx.instanceTag + "_";
  var name = prefix + suffix;
  if (name.length > VN.MAX_ITEM_NAME) {
    var hash = 0;
    var i;
    for (i = 0; i < suffix.length; i++) hash = (hash * 33 + suffix.charCodeAt(i)) % 65535;
    var tail = hash.toString(16);
    while (tail.length < 4) tail = "0" + tail;
    var room = VN.MAX_ITEM_NAME - prefix.length - tail.length;
    if (room < 1) room = 1;
    name = prefix + suffix.substring(0, room) + tail;
  }
  return VN.fitItemName(name, ctx.used);
};

VN.resolveAssetFile = function (asset) {
  if (!VN.packageRoot) throw new Error("没有指定作品包目录，无法解析素材。");
  if (!asset.relativePath || VN.unsafeRelative(asset.relativePath)) {
    throw new Error("素材路径超出作品包：" + (asset.relativePath || asset.id || ""));
  }
  var relative = new File(VN.packageRoot.fsName + "/" + asset.relativePath);
  if (relative.exists) return relative;
  throw new Error("找不到 " + VN.fileBaseName(asset.relativePath));
};

VN.buildProject = function (compiled, report, ctx) {
  var root = app.project.items.addFolder(ctx.folderName);
  ctx.folders.push(root);
  VN.writeMeta(root, {
    v: 2,
    projectId: ctx.projectId,
    buildId: ctx.buildId,
    instanceId: ctx.instanceId,
    logicalId: "instance",
    generatorVersion: ctx.generatorVersion,
    displayName: ctx.displayName,
    versionLabel: ctx.versionLabel
  }, "");

  var folders = { ROOT: root };
  var i;
  for (i = 0; i < compiled.folders.length; i++) {
    var child = app.project.items.addFolder(compiled.folders[i]);
    child.parentFolder = root;
    ctx.folders.push(child);
    folders[compiled.folders[i]] = child;
  }

  VN.notifyPhase("assets");
  var assets = {};
  for (i = 0; i < compiled.assets.length; i++) {
    var asset = compiled.assets[i];
    var file = VN.resolveAssetFile(asset);
    var options = new ImportOptions(file);
    if (!options.canImportAs(ImportAsType.FOOTAGE)) throw new Error("无法作为素材导入：" + file.fsName);
    options.importAs = ImportAsType.FOOTAGE;
    var footage = app.project.importFile(options);
    footage.name = VN.compNameFor(ctx, asset.id);
    footage.parentFolder = folders.ASSETS;
    ctx.footage.push(footage);
    assets[asset.id] = footage;
  }

  VN.notifyPhase("comps");
  var comps = {};
  for (i = 0; i < compiled.comps.length; i++) {
    var spec = compiled.comps[i];
    var aeName = VN.compNameFor(ctx, spec.name);
    ctx.names[spec.logicalId] = aeName;
    var comp = VN.addComp(folders[spec.folder] || folders.ROOT, aeName, spec.width, spec.height, spec.durationFrames, compiled.fps);
    ctx.comps.push(comp);
    var compMeta = {
      v: 2,
      projectId: ctx.projectId,
      buildId: ctx.buildId,
      instanceId: ctx.instanceId,
      logicalId: spec.logicalId,
      generatorVersion: ctx.generatorVersion,
      displayName: ctx.displayName,
      versionLabel: ctx.versionLabel
    };
    if (spec.logicalId === "global:control") {
      compMeta.fps = compiled.fps;
      compMeta.timing = compiled.timing;
    }
    VN.writeMeta(comp, compMeta, "");
    comps[spec.logicalId] = comp;
  }

  VN.notifyPhase("layers");
  for (i = 0; i < compiled.comps.length; i++) {
    VN.fillComp(comps[compiled.comps[i].logicalId], compiled.comps[i], assets, comps, folders, report, ctx);
  }
  return comps.master;
};

VN.rollbackImport = function (ctx) {
  if (!ctx) return;
  var i;
  var inserted = ctx.insertedLayers || [];
  for (i = inserted.length - 1; i >= 0; i--) {
    try {
      inserted[i].remove();
    } catch (ignoreLayer) {}
  }
  ctx.insertedLayers = [];
  var comps = ctx.comps || [];
  for (i = comps.length - 1; i >= 0; i--) {
    try {
      comps[i].remove();
    } catch (ignoreComp) {}
  }
  ctx.comps = [];
  var footage = ctx.footage || [];
  for (i = footage.length - 1; i >= 0; i--) {
    try {
      footage[i].remove();
    } catch (ignoreFootage) {}
  }
  ctx.footage = [];
  var folders = ctx.folders || [];
  for (i = folders.length - 1; i >= 0; i--) {
    try {
      folders[i].remove();
    } catch (ignoreFolder) {}
  }
  ctx.folders = [];
};

VN.isOurComp = function (ctx, item) {
  var i;
  for (i = 0; i < ctx.comps.length; i++) {
    if (ctx.comps[i] === item) return true;
  }
  return false;
};

VN.layerByName = function (comp, name) {
  var i;
  for (i = 1; i <= comp.numLayers; i++) {
    if (comp.layer(i).name === name) return comp.layer(i);
  }
  return null;
};

VN.hasSceneLayer = function (comp) {
  var i;
  for (i = 1; i <= comp.numLayers; i++) {
    if (comp.layer(i).name.indexOf("SCENE_") === 0) return true;
  }
  return false;
};

VN.findExistingMaster = function (ctx) {
  var i;
  for (i = 1; i <= app.project.numItems; i++) {
    var item = app.project.item(i);
    if (!(item instanceof CompItem) || item.name !== "MASTER") continue;
    if (VN.isOurComp(ctx, item)) continue;
    var overlay = VN.layerByName(item, "USER_OVERLAY");
    if (!overlay || !VN.hasSceneLayer(item)) continue;
    return { comp: item, overlay: overlay };
  }
  return null;
};

VN.offerInsert = function (active, master, compiled, ctx, report) {
  if (!master) return;
  var target = VN.findExistingMaster(ctx);
  var host = target ? target.comp : null;
  var overlay = target ? target.overlay : null;
  if (!host) {
    if (active && active instanceof CompItem && !VN.isOurComp(ctx, active) && active.name !== "USER_OVERLAY") host = active;
    else {
      report.warnings.push("没有找到带 USER_OVERLAY 和场景层的 MASTER。新实例只留在项目面板里。");
      return;
    }
  }
  var place = confirm(
    overlay
      ? "已导入独立实例 " +
          ctx.folderName +
          "。\n是否把它放进「" +
          host.name +
          "」，紧挨在 USER_OVERLAY 下面，与场景层并列？\n选择「否」则只在项目面板里保留新合成。"
      : "已导入独立实例 " +
          ctx.folderName +
          "。\n是否把 MASTER 插入当前合成「" +
          host.name +
          "」的播放头？\n选择「否」则只在项目面板里保留新合成。"
  );
  if (!place) return;
  var start = host.time;
  var end = start + master.duration;
  if (end > host.duration + 0.0005) {
    var extend = confirm(
      "片段将结束于 " + end.toFixed(3) + " 秒，当前合成时长是 " + host.duration.toFixed(3) + " 秒。是否延长当前合成？"
    );
    if (extend) host.duration = end;
    else report.warnings.push("未延长宿主合成。超出结尾的画面不会显示。");
  }
  VN.placeInstanceLayer(host, master, ctx, report, start, overlay, compiled);
};

VN.placeInstanceLayer = function (host, master, ctx, report, start, overlay, compiled) {
  if (compiled && Math.abs(host.frameRate - compiled.fps) > 0.01) {
    report.warnings.push("宿主合成帧率是 " + host.frameRate + "，生成片段是 " + compiled.fps + "。未改宿主帧率，嵌套合成保持自己的帧率。");
  }
  if (compiled && (host.width !== compiled.width || host.height !== compiled.height)) {
    report.warnings.push("宿主合成分辨率与生成片段不同。已按 100% 放入，没有拉伸。");
  }
  var layer = host.layers.add(master);
  layer.name = ctx.folderName;
  if (overlay) layer.moveAfter(overlay);
  layer.startTime = start;
  layer.inPoint = start;
  var outPoint = Math.min(start + master.duration, host.duration);
  if (outPoint < layer.inPoint) outPoint = layer.inPoint;
  layer.outPoint = outPoint;
  ctx.insertedLayers.push(layer);
  report.inserted = overlay ? host.name + " / " + layer.name + "（USER_OVERLAY 下面）" : host.name + " @ " + start.toFixed(3) + "s";
  return layer;
};

VN.saveProject = function (compiled) {
  if (!VN.packageRoot) throw new Error("没有指定作品包目录，无法保存工程。");
  var out = new File(VN.packageRoot.fsName + "/" + compiled.saveFileName);
  app.project.save(out);
  return out;
};

VN.notifyPhase = function (phase) {
  if (!VN.onImportPhase) return;
  try {
    VN.onImportPhase(phase);
  } catch (ignorePhase) {}
};
