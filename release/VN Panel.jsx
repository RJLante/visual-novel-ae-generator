// 文字冒险面板。复制到 After Effects 的 ScriptUI Panels 目录后，从「窗口」菜单打开。
// 也可以用「文件 > 脚本 > 运行脚本文件」打开浮动窗口，方便调试。
// 这个文件是工具本身，不要放进作品包。作品包通过 vn-package.json 导入。
var VN = VN || {};

// The business result is already decided. A failed close can leave the undo
// group open, so the report names that residue instead of ending silently.
VN.closeUndoGroup = function (message) {
  try {
    app.endUndoGroup();
  } catch (undoClose) {
    return message + " 撤销分组未能关闭：" + undoClose.toString();
  }
  return message;
};

VN.requireProp = function (group, matchName) {
  var prop = group.property(matchName);
  if (prop === null) {
    throw new Error("找不到属性 " + matchName + "。请确认这是 After Effects 2021 或更新版本。");
  }
  return prop;
};

VN.addComp = function (folder, name, width, height, frames, fps) {
  var comp = app.project.items.addComp(name, width, height, 1, Math.max(frames, 1) / fps, fps);
  comp.duration = frames * comp.frameDuration;
  if (folder && folder !== app.project.rootFolder) comp.parentFolder = folder;
  return comp;
};

VN.scriptFolder = function () {
  if (VN.packageFolder) return VN.packageFolder;
  if (!$.fileName) {
    throw new Error("请用「文件 > 脚本 > 运行脚本文件」执行，不要把脚本贴进控制台。");
  }
  return new File($.fileName).parent;
};

VN.readJsonFile = function (file) {
  if (!file.exists) throw new Error("找不到文件：" + file.fsName);
  file.encoding = "UTF-8";
  if (!file.open("r")) throw new Error("无法读取：" + file.fsName);
  var text = file.read();
  file.close();
  if (text.length && text.charCodeAt(0) === 65279) text = text.substring(1);
  if (typeof JSON === "undefined" || !JSON.parse) {
    throw new Error("脚本环境没有 JSON.parse。请使用 After Effects 2021 或更新版本。");
  }
  return JSON.parse(text);
};

VN.loadCompiled = function () {
  if (!VN.packageRoot) throw new Error("没有指定作品包。请在面板中选择 vn-package.json。");
  return VN.readJsonFile(new File(VN.packageRoot.fsName + "/compiled.json"));
};

VN.writeJsonFile = function (file, value) {
  file.encoding = "UTF-8";
  if (!file.open("w")) throw new Error("无法写入：" + file.fsName);
  file.write(JSON.stringify(value, null, 2));
  file.close();
};

VN.frameTime = function (comp, frame) {
  return frame * comp.frameDuration;
};

VN.META_BEGIN = "[[VN]]";
VN.META_END = "[[/VN]]";
VN.REVEAL_END_INDEX = 99999;
VN.MAX_ITEM_NAME = 31;

VN.bindExpression = function (expression, names) {
  if (!expression) return "";
  return String(expression).replace(/\{\{comp:([^}]+)\}\}/g, function (_all, id) {
    var name = names[id];
    if (!name) throw new Error("表达式引用了还没有创建的合成：" + id);
    return name;
  });
};

VN.stripMeta = function (comment) {
  if (!comment) return "";
  var start = comment.indexOf(VN.META_BEGIN);
  if (start === -1) return comment;
  var end = comment.indexOf(VN.META_END, start);
  if (end === -1) return comment;
  var kept = comment.substring(0, start) + comment.substring(end + VN.META_END.length);
  return kept.replace(/^\s+|\s+$/g, "");
};

VN.readMeta = function (comment) {
  if (!comment) return null;
  var start = comment.indexOf(VN.META_BEGIN);
  if (start === -1) return null;
  var end = comment.indexOf(VN.META_END, start);
  if (end === -1) return null;
  try {
    return JSON.parse(comment.substring(start + VN.META_BEGIN.length, end));
  } catch (err) {
    return null;
  }
};

VN.writeMeta = function (item, meta, userNote) {
  var note = VN.stripMeta(userNote !== undefined ? userNote : item.comment);
  var payload = VN.META_BEGIN + JSON.stringify(meta) + VN.META_END;
  item.comment = note ? note + "\n" + payload : payload;
};

VN.compactKeys = function (keys) {
  if (!keys || !keys.length) return undefined;
  var out = [];
  var i;
  for (i = 0; i < keys.length; i++) out.push([keys[i].frame, keys[i].value, keys[i].interpolation || "hold"]);
  return out;
};

VN.expandKeys = function (compact, fallback) {
  if (!compact) return [];
  var out = [];
  var i;
  for (i = 0; i < compact.length; i++) {
    out.push({ frame: compact[i][0], value: compact[i][1], interpolation: compact[i][2] || fallback || "hold" });
  }
  return out;
};

VN.interpolationType = function (name) {
  if (name === "linear") return KeyframeInterpolationType.LINEAR;
  if (name === "bezier") return KeyframeInterpolationType.BEZIER;
  return KeyframeInterpolationType.HOLD;
};

VN.interpolationName = function (kind) {
  if (kind === KeyframeInterpolationType.LINEAR) return "linear";
  if (kind === KeyframeInterpolationType.BEZIER) return "bezier";
  return "hold";
};

VN.clearKeys = function (prop) {
  while (prop.numKeys > 0) prop.removeKey(1);
};

VN.applyScalarKeysKeepingExpression = function (prop, comp, keys) {
  var expression = prop.expression;
  VN.applyScalarKeys(prop, comp, keys);
  if (expression) prop.expression = expression;
};

VN.applyScalarKeys = function (prop, comp, keys) {
  if (prop.expression) prop.expression = "";
  VN.clearKeys(prop);
  var i;
  for (i = 0; i < keys.length; i++) {
    prop.setValueAtTime(VN.frameTime(comp, keys[i].frame), keys[i].value);
  }
  for (i = 0; i < keys.length; i++) {
    var interp = VN.interpolationType(keys[i].interpolation);
    prop.setInterpolationTypeAtKey(i + 1, interp, interp);
  }
};

VN.readScalarKeys = function (prop, comp) {
  var keys = [];
  var i;
  for (i = 1; i <= prop.numKeys; i++) {
    keys.push({
      frame: Math.round(prop.keyTime(i) / comp.frameDuration),
      value: prop.keyValue(i),
      interpolation: VN.interpolationName(prop.keyInInterpolationType(i))
    });
  }
  return keys;
};

VN.keysMatch = function (live, stored) {
  if (!stored) return live.length === 0;
  if (live.length !== stored.length) return false;
  var i;
  for (i = 0; i < live.length; i++) {
    if (live[i].frame !== stored[i][0]) return false;
    if (Math.abs(live[i].value - stored[i][1]) > 0.001) return false;
    if (live[i].interpolation !== (stored[i][2] || "hold")) return false;
  }
  return true;
};

VN.usedItemNames = function () {
  var used = {};
  var i;
  for (i = 1; i <= app.project.numItems; i++) used[app.project.item(i).name] = true;
  return used;
};

VN.fitItemName = function (name, used) {
  var fitted = String(name);
  if (fitted.length > VN.MAX_ITEM_NAME) fitted = fitted.substring(0, VN.MAX_ITEM_NAME);
  var base = fitted;
  var n = 2;
  while (used[fitted]) {
    var suffix = String(n);
    var room = VN.MAX_ITEM_NAME - suffix.length;
    if (room < 1) room = 1;
    fitted = base.substring(0, room) + suffix;
    n++;
  }
  used[fitted] = true;
  return fitted;
};

VN.randomTag = function () {
  var chars = "0123456789abcdef";
  var tag = "";
  var i;
  for (i = 0; i < 4; i++) tag += chars.charAt(Math.floor(Math.random() * chars.length));
  return tag;
};

VN.projectTag = function (projectId) {
  var cleaned = String(projectId || "").replace(/[^A-Za-z0-9]/g, "");
  if (!cleaned.length) cleaned = "proj";
  if (cleaned.length >= 4) return cleaned.substring(0, 4);
  while (cleaned.length < 4) cleaned += "0";
  return cleaned;
};

VN.selectorProp = function (selector, matchName) {
  var prop = selector.property(matchName);
  if (prop === null) {
    var advanced = selector.property("ADBE Text Range Advanced");
    if (advanced !== null) prop = advanced.property(matchName);
  }
  return prop;
};

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
  ctx.schemaVersion = compiled.schemaVersion || 2;
  ctx.packageHash = compiled.packageHash || "";
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
  var instanceMeta = {
    v: ctx.schemaVersion >= 3 ? 3 : 2,
    projectId: ctx.projectId,
    buildId: ctx.buildId,
    instanceId: ctx.instanceId,
    logicalId: "instance",
    generatorVersion: ctx.generatorVersion,
    displayName: ctx.displayName,
    versionLabel: ctx.versionLabel
  };
  if (ctx.schemaVersion >= 3) {
    instanceMeta.schemaVersion = 3;
    instanceMeta.identity = {
      instanceId: ctx.instanceId,
      packageId: compiled.id,
      packageVersion: compiled.buildId,
      packageHash: ctx.packageHash,
      schemaVersion: 3
    };
    instanceMeta.baseline = compiled.baseline;
    instanceMeta.current = { speed: 1, defaultEffect: "typewriter", revision: 1 };
  }
  VN.writeMeta(root, instanceMeta, "");

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
      v: ctx.schemaVersion >= 3 ? 3 : 2,
      projectId: ctx.projectId,
      buildId: ctx.buildId,
      instanceId: ctx.instanceId,
      logicalId: spec.logicalId,
      generatorVersion: ctx.generatorVersion,
      displayName: ctx.displayName,
      versionLabel: ctx.versionLabel
    };
    if (ctx.schemaVersion >= 3) {
      compMeta.schemaVersion = 3;
      compMeta.baseline = { durationFrames: spec.durationFrames };
      compMeta.current = { revision: 1 };
    }
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

var VN = VN || {};

VN.fillComp = function (comp, spec, assets, comps, folders, report, ctx) {
  var i;
  for (i = 0; i < spec.layers.length; i++) {
    VN.addLayer(comp, spec.layers[i], assets, comps, folders, report, ctx);
  }
};

VN.addLayer = function (comp, spec, assets, comps, folders, report, ctx) {
  var layer;
  if (spec.kind === "text") layer = VN.addTextLayer(comp, spec, report);
  else if (spec.kind === "footage") layer = VN.addFootageLayer(comp, spec, assets);
  else if (spec.kind === "solid") layer = VN.addSolidLayer(comp, spec, folders, ctx);
  else if (spec.kind === "null") layer = VN.addNullLayer(comp, spec);
  else if (spec.kind === "precomp") layer = VN.addPrecompLayer(comp, spec, comps);
  else throw new Error("未知图层类型：" + spec.kind);

  layer.name = spec.name;
  VN.applyTransform(layer, comp, spec);
  VN.applyEffects(layer, spec);
  if (spec.kind === "text") VN.finishTextLayer(layer, comp, spec, report, ctx);
  else VN.writeMeta(layer, VN.layerMeta(spec, ctx), spec.comment || "");
  if (ctx.schemaVersion >= 3 && spec.kind !== "text") VN.sealLayerRecord(layer, comp);
  return layer;
};

VN.addTextLayer = function (comp, spec, report) {
  var layer = comp.layers.addBoxText([spec.box.width, spec.box.height], spec.aeText);
  var prop = VN.requireProp(VN.requireProp(layer, "ADBE Text Properties"), "ADBE Text Document");
  var doc = prop.value;
  doc.text = spec.aeText;
  doc.font = spec.font;
  doc.fontSize = spec.fontSize;
  doc.applyFill = true;
  doc.fillColor = [spec.rgb[0], spec.rgb[1], spec.rgb[2]];
  doc.autoLeading = false;
  doc.leading = spec.lineHeight;
  doc.tracking = 0;
  doc.justification = ParagraphJustification.LEFT_JUSTIFY;
  VN.setTextDocument(prop, doc, [spec.box.width, spec.box.height]);
  var actual = prop.value.font;
  if (actual !== spec.font && !VN._fonts[spec.font]) {
    VN._fonts[spec.font] = true;
    report.fonts.push({ layer: comp.name + " / " + spec.name, detail: spec.font + " -> " + actual });
  }
  return layer;
};

VN._fonts = {};

VN.setTextDocument = function (prop, doc, boxSize) {
  if (boxSize) {
    try {
      doc.boxTextSize = boxSize;
    } catch (ignoreSize) {}
  }
  try {
    prop.setValue(doc);
    return;
  } catch (err) {
    if (String(err).indexOf("boxText") === -1) throw err;
  }
  prop.setValue(doc.text);
  var current = prop.value;
  current.font = doc.font;
  current.fontSize = doc.fontSize;
  current.applyFill = true;
  current.fillColor = doc.fillColor;
  current.autoLeading = false;
  current.leading = doc.leading;
  current.tracking = doc.tracking;
  current.justification = doc.justification;
  if (boxSize) {
    try {
      current.boxTextSize = boxSize;
    } catch (ignoreSizeAgain) {}
  }
  prop.setValue(current);
};

VN.addFootageLayer = function (comp, spec, assets) {
  var footage = assets[spec.assetId];
  if (!footage) throw new Error("缺少素材：" + spec.assetId);
  var layer = comp.layers.add(footage);
  if (spec.fit) {
    var scaleX = (spec.fit.width / footage.width) * 100;
    var scaleY = (spec.fit.height / footage.height) * 100;
    VN.requireProp(VN.requireProp(layer, "ADBE Transform Group"), "ADBE Scale").setValue([scaleX, scaleY]);
  }
  return layer;
};

VN.addSolidLayer = function (comp, spec, folders, ctx) {
  var solidName = VN.fitItemName(comp.name + "_" + spec.name, ctx.used);
  var layer = comp.layers.addSolid(
    [spec.color[0], spec.color[1], spec.color[2]],
    solidName,
    spec.solidWidth,
    spec.solidHeight,
    1,
    comp.duration
  );
  if (layer.source) {
    layer.source.name = solidName;
    ctx.footage.push(layer.source);
    if (folders.SOLIDS) layer.source.parentFolder = folders.SOLIDS;
  }
  return layer;
};

VN.addNullLayer = function (comp, spec) {
  return comp.layers.addNull(comp.duration);
};

VN.addPrecompLayer = function (comp, spec, comps) {
  var source = comps[spec.compRef];
  if (!source) throw new Error("找不到合成：" + spec.compRef);
  return comp.layers.add(source);
};

VN.applyTransform = function (layer, comp, spec) {
  var transform = VN.requireProp(layer, "ADBE Transform Group");
  if (spec.anchor) VN.requireProp(transform, "ADBE Anchor Point").setValue(spec.anchor);
  if (spec.position && !spec.positionKeys) VN.requireProp(transform, "ADBE Position").setValue(spec.position);
  if (spec.kind === "text") VN.correctBoxAnchor(layer, spec);

  var start = spec.inFrame ? VN.frameTime(comp, spec.inFrame) : 0;
  var end = spec.outFrame === undefined ? comp.duration : VN.frameTime(comp, spec.outFrame);
  if (spec.kind === "precomp" || spec.inFrame !== undefined || spec.outFrame !== undefined) {
    layer.startTime = start;
    layer.inPoint = start;
    layer.outPoint = end;
  }
  VN.applyOpacityKeys(layer, comp, spec);
  VN.applyPositionKeys(layer, comp, spec);
};

VN.layerMeta = function (spec, ctx) {
  var animation = spec.textAnimation;
  var meta = {
    v: ctx.schemaVersion >= 3 ? 3 : 2,
    projectId: ctx.projectId,
    buildId: ctx.buildId,
    instanceId: ctx.instanceId,
    logicalId: spec.logicalId || "layer:" + spec.name,
    eventId: spec.eventId,
    generatorVersion: ctx.generatorVersion,
    displayName: ctx.displayName,
    versionLabel: ctx.versionLabel,
    preset: animation ? animation.preset : undefined,
    holdIn: spec.holdInFrames,
    eventFrames: spec.eventFrames,
    reveal: animation ? VN.compactKeys(animation.revealKeys) : undefined,
    opacity: animation ? VN.compactKeys(animation.opacityKeys) : undefined,
    dependency: "managed"
  };
  if (ctx.schemaVersion >= 3) {
    meta.schemaVersion = 3;
    if (animation && animation.preset === "typewriter") meta.effect = "typewriter";
    meta.baseline = {
      inFrame: spec.inFrame || 0,
      outFrame: spec.outFrame === undefined ? null : spec.outFrame,
      startFrame: spec.inFrame || 0,
      opacity: VN.compactKeys(spec.opacityKeys),
      reveal: animation ? VN.compactKeys(animation.revealKeys) : undefined,
      position: VN.compactPosition(spec.positionKeys)
    };
    meta.current = { effect: meta.effect || "", speed: 1, revision: 1 };
  }
  return meta;
};

VN.compactPosition = function (keys) {
  if (!keys || !keys.length) return undefined;
  var out = [];
  var i;
  for (i = 0; i < keys.length; i++) out.push([keys[i].frame, keys[i].x, keys[i].y, keys[i].interp || "linear"]);
  return out;
};

VN.correctBoxAnchor = function (layer, spec) {
  var transform = VN.requireProp(layer, "ADBE Transform Group");
  var anchor = VN.requireProp(transform, "ADBE Anchor Point");
  var position = VN.requireProp(transform, "ADBE Position");
  anchor.setValue([0, 0]);
  position.setValue([spec.box.x, spec.box.y]);
  var rect = layer.sourceRectAtTime(0, false);
  if (rect.left < -spec.box.width * 0.25 || rect.top < -spec.box.height * 0.25) {
    position.setValue([spec.box.x - rect.left, spec.box.y - rect.top]);
  }
};

VN.applyOpacityKeys = function (layer, comp, spec) {
  if (!spec.opacityKeys || !spec.opacityKeys.length) return;
  var opacity = VN.requireProp(VN.requireProp(layer, "ADBE Transform Group"), "ADBE Opacity");
  var i;
  for (i = 0; i < spec.opacityKeys.length; i++) {
    opacity.setValueAtTime(VN.frameTime(comp, spec.opacityKeys[i].frame), spec.opacityKeys[i].value);
  }
  for (i = 0; i < spec.opacityKeys.length; i++) {
    var interp = VN.interpolationType(spec.opacityKeys[i].interpolation || "linear");
    opacity.setInterpolationTypeAtKey(i + 1, interp, interp);
  }
};

VN.applyPositionKeys = function (layer, comp, spec) {
  if (!spec.positionKeys || spec.positionKeys.length < 2) return;
  var position = VN.requireProp(VN.requireProp(layer, "ADBE Transform Group"), "ADBE Position");
  var i;
  for (i = 0; i < spec.positionKeys.length; i++) {
    position.setValueAtTime(VN.frameTime(comp, spec.positionKeys[i].frame), [spec.positionKeys[i].x, spec.positionKeys[i].y]);
  }
  for (i = 0; i < spec.positionKeys.length; i++) {
    var interp = spec.positionKeys[i].interp === "hold" ? KeyframeInterpolationType.HOLD : KeyframeInterpolationType.LINEAR;
    position.setInterpolationTypeAtKey(i + 1, interp, interp);
  }
};

VN.applyEffects = function (layer, spec) {
  if (!spec.effects) return;
  var parade = VN.requireProp(layer, "ADBE Effect Parade");
  var i;
  for (i = 0; i < spec.effects.length; i++) {
    var effect = spec.effects[i];
    if (effect.type === "slider") {
      var slider = parade.addProperty("ADBE Slider Control");
      slider.name = effect.name;
      slider.property("ADBE Slider Control-0001").setValue(effect.value);
    } else {
      var checkbox = parade.addProperty("ADBE Checkbox Control");
      checkbox.name = effect.name;
      checkbox.property("ADBE Checkbox Control-0001").setValue(effect.value ? 1 : 0);
    }
  }
};

VN.finishTextLayer = function (layer, comp, spec, report, ctx) {
  if (spec.textAnimation) VN.measureText(layer, comp, spec, report);
  var opacity = VN.requireProp(VN.requireProp(layer, "ADBE Transform Group"), "ADBE Opacity");
  if (spec.opacityExpression) opacity.expression = VN.bindExpression(spec.opacityExpression, ctx.names);
  if (spec.sourceTextExpression) {
    VN.requireProp(VN.requireProp(layer, "ADBE Text Properties"), "ADBE Text Document").expression = VN.bindExpression(
      spec.sourceTextExpression,
      ctx.names
    );
  }
  if (spec.textAnimation && spec.textAnimation.revealKeys) VN.installRevealKeys(layer, comp, spec.textAnimation.revealKeys);
  VN.writeMeta(layer, VN.layerMeta(spec, ctx), spec.comment);
  if (ctx.schemaVersion >= 3) VN.sealLayerRecord(layer, comp);
  VN.collectExpressionErrors(layer, comp, report);
};

VN.setSelectorValue = function (selector, matchName, value) {
  var prop = selector.property(matchName);
  if (prop === null) {
    var advanced = selector.property("ADBE Text Range Advanced");
    if (advanced !== null) prop = advanced.property(matchName);
  }
  if (prop !== null) prop.setValue(value);
};

VN.installRevealKeys = function (layer, comp, keys) {
  var animators = VN.requireProp(VN.requireProp(layer, "ADBE Text Properties"), "ADBE Text Animators");
  var anim = animators.addProperty("ADBE Text Animator");
  anim.name = "REVEAL";
  VN.requireProp(anim, "ADBE Text Animator Properties").addProperty("ADBE Text Opacity").setValue(0);
  var selector = VN.requireProp(anim, "ADBE Text Selectors").addProperty("ADBE Text Selector");
  selector.name = "REVEAL_RANGE";
  VN.setSelectorValue(selector, "ADBE Text Range Units", 2);
  VN.setSelectorValue(selector, "ADBE Text Range Type2", 1);
  VN.setSelectorValue(selector, "ADBE Text Range Shape", 1);
  VN.setSelectorValue(selector, "ADBE Text Selector Smoothness", 0);
  VN.setSelectorValue(selector, "ADBE Text Levels Max Ease", 0);
  VN.setSelectorValue(selector, "ADBE Text Levels Min Ease", 0);
  var start = VN.selectorProp(selector, "ADBE Text Index Start");
  var end = VN.selectorProp(selector, "ADBE Text Index End");
  if (start === null || end === null) throw new Error("找不到文字范围选择器的 Start 或 End");
  if (end.expression) end.expression = "";
  end.setValue(VN.REVEAL_END_INDEX);
  var amount = selector.property("ADBE Text Selector Max Amount");
  if (amount !== null) {
    if (amount.expression) amount.expression = "";
    amount.setValue(100);
  }
  VN.applyScalarKeys(start, comp, keys);
};

VN.measureText = function (layer, comp, spec, report) {
  var rect;
  try {
    rect = layer.sourceRectAtTime(comp.duration > comp.frameDuration ? comp.duration - comp.frameDuration : 0, false);
  } catch (err) {
    report.overflow.push({ layer: comp.name + " / " + spec.name, detail: "无法测量文字边界：" + err.toString() });
    return;
  }
  var widthOver = rect.width > spec.box.width + 4;
  var heightOver = rect.height > spec.box.height + 4;
  if (widthOver || heightOver) {
    report.overflow.push({
      layer: comp.name + " / " + spec.name,
      textWidth: Math.round(rect.width),
      textHeight: Math.round(rect.height),
      boxWidth: spec.box.width,
      boxHeight: spec.box.height,
      detail: "文字超出文本框。请拆段或调小字号，生成器不会自动压缩。"
    });
  }
};

VN.collectExpressionErrors = function (layer, comp, report) {
  var targets = [];
  var textProp = layer.property("ADBE Text Properties");
  if (textProp !== null) {
    targets.push(textProp.property("ADBE Text Document"));
    var animators = textProp.property("ADBE Text Animators");
    if (animators !== null) {
      var a;
      for (a = 1; a <= animators.numProperties; a++) {
        var selectors = animators.property(a).property("ADBE Text Selectors");
        if (selectors === null) continue;
        var s;
        for (s = 1; s <= selectors.numProperties; s++) {
          targets.push(selectors.property(s).property("ADBE Text Index Start"));
          targets.push(selectors.property(s).property("ADBE Text Index End"));
          targets.push(selectors.property(s).property("ADBE Text Selector Max Amount"));
        }
      }
    }
  }
  var opacity = layer.property("ADBE Transform Group");
  if (opacity !== null) targets.push(opacity.property("ADBE Opacity"));
  var i;
  for (i = 0; i < targets.length; i++) {
    var prop = targets[i];
    if (prop === null || !prop.expression) continue;
    if (prop.expression.indexOf("{{comp:") !== -1) {
      report.expressionErrors.push({
        layer: comp.name + " / " + layer.name,
        property: prop.matchName,
        detail: "表达式引用没有绑定"
      });
      continue;
    }
    try {
      prop.valueAtTime(0, false);
    } catch (err) {}
    if (prop.expressionError && prop.expressionError !== "") {
      report.expressionErrors.push({
        layer: comp.name + " / " + layer.name,
        property: prop.matchName,
        detail: prop.expressionError
      });
    }
  }
};

var VN = VN || {};

// 与 src/timing.ts 的 appearFrame / planCharacters 保持同一套帧换算。
VN.isNewline = function (ch) {
  return ch === "\n" || ch === "\r";
};

VN.secondsToFrames = function (seconds, fps) {
  return Math.round(seconds * fps);
};

VN.appearFrame = function (visibleIndex, pauseFrames, charactersPerSecond, fps) {
  return Math.round((visibleIndex * fps) / charactersPerSecond) + pauseFrames;
};

VN.planCharacters = function (text, timing, fps) {
  var chars = [];
  var i;
  for (i = 0; i < text.length; i++) {
    var code = text.charCodeAt(i);
    if (code >= 0xD800 && code <= 0xDBFF) {
      throw new Error("文本含有扩展字符，无法按字符索引刷新");
    }
    chars.push(text.charAt(i));
  }

  var commaPauseFrames = VN.secondsToFrames(timing.commaPauseSeconds, fps);
  var sentencePauseFrames = VN.secondsToFrames(timing.sentencePauseSeconds, fps);
  var lineIntervalFrames = VN.secondsToFrames(timing.lineIntervalSeconds, fps);
  var fadeFrames = VN.secondsToFrames(timing.fadeSeconds, fps);
  var visible = [];
  for (i = 0; i < chars.length; i++) {
    if (!VN.isNewline(chars[i])) visible.push(i);
  }

  var revealFrames = [];
  for (i = 0; i < chars.length; i++) revealFrames.push(0);
  var pauseFrames = 0;
  var visibleIndex;
  for (visibleIndex = 0; visibleIndex < visible.length; visibleIndex++) {
    var charIndex = visible[visibleIndex];
    revealFrames[charIndex] = VN.appearFrame(visibleIndex, pauseFrames, timing.charactersPerSecond, fps);
    if (visibleIndex !== visible.length - 1) {
      var ch = chars[charIndex];
      if (timing.longPauseChars.indexOf(ch) !== -1) pauseFrames += sentencePauseFrames;
      else if (timing.shortPauseChars.indexOf(ch) !== -1) pauseFrames += commaPauseFrames;
    }
  }

  for (i = chars.length - 1; i >= 0; i--) {
    if (!VN.isNewline(chars[i])) continue;
    var nextFrame = null;
    var j;
    for (j = i + 1; j < chars.length; j++) {
      if (!VN.isNewline(chars[j])) {
        nextFrame = revealFrames[j];
        break;
      }
    }
    if (nextFrame === null) nextFrame = VN.appearFrame(visible.length, pauseFrames, timing.charactersPerSecond, fps);
    revealFrames[i] = nextFrame;
  }

  var linePlan = VN.lineCharacterFrames(chars, timing, fps, lineIntervalFrames);
  var lineFrames = linePlan.frames;
  var lineRevealFrames = linePlan.revealFrames;
  var typewriterRevealFrames = visible.length === 0 ? 0 : VN.appearFrame(visible.length, pauseFrames, timing.charactersPerSecond, fps);
  return {
    revealFrames: revealFrames,
    lineFrames: lineFrames,
    typewriterRevealFrames: typewriterRevealFrames,
    lineRevealFrames: lineRevealFrames,
    fadeFrames: fadeFrames
  };
};

VN.typeLine = function (chars, start, endExclusive, timing, fps, offset, frames) {
  var visible = [];
  var i;
  for (i = start; i < endExclusive; i++) {
    if (!VN.isNewline(chars[i])) visible.push(i);
  }
  var pauseFrames = 0;
  var commaPauseFrames = VN.secondsToFrames(timing.commaPauseSeconds, fps);
  var sentencePauseFrames = VN.secondsToFrames(timing.sentencePauseSeconds, fps);
  var visibleIndex;
  for (visibleIndex = 0; visibleIndex < visible.length; visibleIndex++) {
    var charIndex = visible[visibleIndex];
    frames[charIndex] = offset + VN.appearFrame(visibleIndex, pauseFrames, timing.charactersPerSecond, fps);
    if (visibleIndex !== visible.length - 1) {
      var ch = chars[charIndex];
      if (timing.longPauseChars.indexOf(ch) !== -1) pauseFrames += sentencePauseFrames;
      else if (timing.shortPauseChars.indexOf(ch) !== -1) pauseFrames += commaPauseFrames;
    }
  }
  if (visible.length === 0) return 0;
  return VN.appearFrame(visible.length, pauseFrames, timing.charactersPerSecond, fps);
};

VN.lineCharacterFrames = function (chars, timing, fps, lineIntervalFrames) {
  var frames = [];
  var i;
  for (i = 0; i < chars.length; i++) frames.push(0);
  var offset = 0;
  var index = 0;
  while (index < chars.length) {
    var lineStart = index;
    while (index < chars.length && !VN.isNewline(chars[index])) index += 1;
    var duration = VN.typeLine(chars, lineStart, index, timing, fps, offset, frames);
    if (index < chars.length) {
      var nextOffset = offset + duration + lineIntervalFrames;
      frames[index] = nextOffset;
      offset = nextOffset;
      index += 1;
    } else {
      offset += duration;
    }
  }
  return { frames: frames, revealFrames: offset };
};

VN.revealKeyframes = function (appearFrames, holdInFrames) {
  var keys = [];
  var countAt = function (frame) {
    var count = 0;
    var i;
    for (i = 0; i < appearFrames.length; i++) if (appearFrames[i] <= frame) count += 1;
    return count;
  };
  var push = function (frame, value) {
    var i;
    for (i = 0; i < keys.length; i++) {
      if (keys[i].frame === frame) {
        keys[i].value = value;
        return;
      }
    }
    keys.push({ frame: frame, value: value, interpolation: "hold" });
  };
  if (!appearFrames.length) {
    push(holdInFrames > 0 ? holdInFrames : 0, 0);
    return keys;
  }
  if (holdInFrames > 0) push(0, countAt(0));
  var seen = {};
  var unique = [];
  var n;
  for (n = 0; n < appearFrames.length; n++) {
    if (!seen[appearFrames[n]]) {
      seen[appearFrames[n]] = true;
      unique.push(appearFrames[n]);
    }
  }
  unique.sort(function (a, b) { return a - b; });
  for (n = 0; n < unique.length; n++) push(holdInFrames + unique[n], countAt(unique[n]));
  keys.sort(function (a, b) { return a.frame - b.frame; });
  return keys;
};

VN.fadeOpacityKeyframes = function (holdInFrames, fadeFrames) {
  if (fadeFrames <= 0) return [{ frame: 0, value: 100, interpolation: "linear" }];
  var end = holdInFrames + fadeFrames;
  if (holdInFrames <= 0) {
    return [
      { frame: 0, value: 0, interpolation: "linear" },
      { frame: end, value: 100, interpolation: "linear" }
    ];
  }
  return [
    { frame: 0, value: 0, interpolation: "linear" },
    { frame: holdInFrames, value: 0, interpolation: "linear" },
    { frame: end, value: 100, interpolation: "linear" }
  ];
};

VN.scaleKeyframeSpacing = function (keys, speed) {
  if (!(speed > 0)) throw new Error("速度倍率必须大于 0");
  var ordered = [];
  var i;
  for (i = 0; i < keys.length; i++) {
    ordered.push({
      frame: keys[i].frame,
      value: keys[i].value,
      interpolation: keys[i].interpolation || "hold"
    });
  }
  ordered.sort(function (a, b) { return a.frame - b.frame; });
  if (!ordered.length) return [];
  var anchor = ordered[0].frame;
  var byFrame = {};
  var frames = [];
  for (i = 0; i < ordered.length; i++) {
    var frame = anchor + Math.round((ordered[i].frame - anchor) / speed);
    if (byFrame[frame] === undefined) frames.push(frame);
    byFrame[frame] = { frame: frame, value: ordered[i].value, interpolation: ordered[i].interpolation };
  }
  frames.sort(function (a, b) { return a - b; });
  var out = [];
  for (i = 0; i < frames.length; i++) out.push(byFrame[frames[i]]);
  return out;
};

var VN = VN || {};

VN.segmentText = function (text) {
  var units = [];
  var source = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  var aeIndex = 0;
  var i = 0;
  while (i < source.length) {
    if (source.charCodeAt(i) === 10) {
      aeIndex += 1;
      i += 1;
      continue;
    }
    var mark = VN.readCluster(source, i);
    units.push({ text: mark.text, aeIndex: aeIndex, aeLength: mark.aeLength });
    aeIndex += mark.aeLength;
    i += mark.aeLength;
  }
  return { units: units, aeLength: aeIndex };
};

VN.readCluster = function (text, index) {
  var code = text.charCodeAt(index);
  var aeLength = 1;
  var chunk = text.charAt(index);
  if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
    chunk = text.substring(index, index + 2);
    aeLength = 2;
  }
  var cursor = index + aeLength;
  while (cursor < text.length && VN.extendsCluster(text, cursor)) {
    var extra = text.charCodeAt(cursor) >= 0xd800 && text.charCodeAt(cursor) <= 0xdbff ? 2 : 1;
    chunk += text.substring(cursor, cursor + extra);
    aeLength += extra;
    cursor += extra;
  }
  return { text: chunk, aeLength: aeLength };
};

VN.extendsCluster = function (text, index) {
  var code = text.charCodeAt(index);
  if (code === 10 || code === 13) return false;
  if (code === 0x200d) return true;
  if (index > 0 && text.charCodeAt(index - 1) === 0x200d) return true;
  if (code === 0xfe0e || code === 0xfe0f) return true;
  if (code >= 0x0300 && code <= 0x036f) return true;
  if (code >= 0x1ab0 && code <= 0x1aff) return true;
  if (code >= 0x1dc0 && code <= 0x1dff) return true;
  if (code >= 0x20d0 && code <= 0x20ff) return true;
  if (code >= 0xfe20 && code <= 0xfe2f) return true;
  return false;
};

VN.pausesForText = function (text, commaFrames, sentenceFrames) {
  var units = VN.segmentText(text).units;
  var pauses = [];
  var longChars = ".?!。？！…";
  var shortChars = ",;:，；：、";
  var i;
  for (i = 0; i < units.length - 1; i++) {
    if (longChars.indexOf(units[i].text) !== -1) pauses.push({ afterUnit: i, frames: sentenceFrames });
    else if (shortChars.indexOf(units[i].text) !== -1) pauses.push({ afterUnit: i, frames: commaFrames });
  }
  return pauses;
};

VN.quantizeShared = function (frames, speed) {
  var map = {};
  var order = [];
  var i;
  for (i = 0; i < frames.length; i++) {
    var frame = frames[i];
    var key = String(frame);
    if (map[key] === undefined) {
      map[key] = Math.round(frame / speed);
      order.push(frame);
    }
  }
  return { map: map, order: order, speed: speed };
};

VN.lookupFrame = function (shared, frame) {
  var found = shared.map[String(frame)];
  if (found === undefined) return Math.round(frame / (shared.speed || 1));
  return found;
};

VN.buildAnimationPlan = function (text, effect, speed, timing, availableTime) {
  if (!(speed > 0)) throw new Error("速度倍率必须大于 0");
  var segmented = VN.segmentText(text);
  var pauses = timing.pauses || [];
  var relative = [];
  var carried = 0;
  var i;
  for (i = 0; i < segmented.units.length; i++) {
    relative.push(Math.round((i * timing.fps) / timing.charactersPerSecond) + carried);
    var p;
    for (p = 0; p < pauses.length; p++) if (pauses[p].afterUnit === i) carried += pauses[p].frames;
  }
  var aeAppear = [];
  for (i = 0; i < segmented.aeLength; i++) aeAppear.push(0);
  for (i = 0; i < segmented.units.length; i++) {
    var unit = segmented.units[i];
    var n;
    for (n = 0; n < unit.aeLength; n++) aeAppear[unit.aeIndex + n] = relative[i];
  }
  for (i = 0; i < segmented.aeLength; i++) {
    if (VN.unitCovers(segmented.units, i)) continue;
    var next = null;
    var u;
    for (u = 0; u < segmented.units.length; u++) {
      if (segmented.units[u].aeIndex > i) {
        next = segmented.units[u];
        aeAppear[i] = relative[u];
        break;
      }
    }
    if (!next && relative.length) aeAppear[i] = relative[relative.length - 1];
  }
  var holdIn = timing.holdInFrames || 0;
  var baseReveal = VN.revealKeyframes(aeAppear, holdIn);
  var fadeSpan = timing.characterFadeFrames || 0;
  var baseFade = [];
  for (i = 0; i < segmented.units.length; i++) {
    baseFade.push(VN.fadeKeys(holdIn + relative[i], fadeSpan));
  }
  var pauseSum = 0;
  for (i = 0; i < pauses.length; i++) pauseSum += pauses[i].frames;
  var typewriterEnd = holdIn + Math.round((segmented.units.length * timing.fps) / timing.charactersPerSecond) + pauseSum;
  var lastRelative = relative.length ? relative[relative.length - 1] : 0;
  var fadeCompletion = holdIn + lastRelative + fadeSpan;
  var boundaries = [typewriterEnd, fadeCompletion, holdIn, 0];
  for (i = 0; i < baseReveal.length; i++) boundaries.push(baseReveal[i].frame);
  for (i = 0; i < baseFade.length; i++) {
    for (n = 0; n < baseFade[i].length; n++) boundaries.push(baseFade[i][n].frame);
  }
  var shared = VN.quantizeShared(boundaries, speed);
  var revealKeys = VN.remapKeys(baseReveal, shared);
  var fadeTracks = [];
  if (effect === "characterFade") {
    for (i = 0; i < segmented.units.length; i++) {
      fadeTracks.push({
        aeIndex: segmented.units[i].aeIndex,
        aeLength: segmented.units[i].aeLength,
        keys: VN.remapKeys(baseFade[i], shared)
      });
    }
  }
  var lastReveal = revealKeys.length ? revealKeys[revealKeys.length - 1].frame : 0;
  var completion = effect === "characterFade" ? VN.lookupFrame(shared, fadeCompletion) : lastReveal;
  var required = effect === "characterFade" ? completion : VN.lookupFrame(shared, typewriterEnd);
  return {
    effect: effect,
    units: segmented.units,
    pauses: pauses,
    revealKeys: revealKeys,
    fadeTracks: fadeTracks,
    completionFrame: completion,
    requiredFrames: required,
    fits: required <= availableTime
  };
};

VN.fadeKeys = function (start, fadeFrames) {
  if (fadeFrames <= 0) return [{ frame: start, value: 100, interpolation: "linear" }];
  if (start <= 0) {
    return [
      { frame: 0, value: 0, interpolation: "linear" },
      { frame: fadeFrames, value: 100, interpolation: "linear" }
    ];
  }
  return [
    { frame: 0, value: 0, interpolation: "linear" },
    { frame: start, value: 0, interpolation: "linear" },
    { frame: start + fadeFrames, value: 100, interpolation: "linear" }
  ];
};

VN.remapKeys = function (keys, shared) {
  var frames = [];
  var byFrame = {};
  var i;
  for (i = 0; i < keys.length; i++) {
    var frame = VN.lookupFrame(shared, keys[i].frame);
    if (byFrame[frame] === undefined) frames.push(frame);
    byFrame[frame] = { frame: frame, value: keys[i].value, interpolation: keys[i].interpolation || "hold" };
  }
  frames.sort(function (a, b) { return a - b; });
  var out = [];
  for (i = 0; i < frames.length; i++) out.push(byFrame[frames[i]]);
  return out;
};

VN.unitCovers = function (units, aeIndex) {
  var i;
  for (i = 0; i < units.length; i++) {
    if (aeIndex >= units[i].aeIndex && aeIndex < units[i].aeIndex + units[i].aeLength) return true;
  }
  return false;
};

VN.mapBaselineFrames = function (frames, speed) {
  return VN.quantizeShared(frames, speed);
};

var VN = VN || {};

VN.instanceFolderMeta = function (instanceId) {
  var i;
  for (i = 1; i <= app.project.numItems; i++) {
    var item = app.project.item(i);
    var meta = null;
    try {
      meta = VN.readMeta(item.comment);
    } catch (ignore) {}
    if (!meta || meta.logicalId !== "instance" || meta.instanceId !== instanceId) continue;
    return { item: item, meta: meta };
  }
  return null;
};

VN.capabilitiesFor = function (instanceId) {
  var found = VN.instanceFolderMeta(instanceId);
  var meta = found ? found.meta : null;
  var full = !!(meta && meta.v === 3 && meta.baseline && meta.baseline.events);
  var current = meta && meta.current ? meta.current : null;
  return {
    full: full,
    style: full ? "editor" : "legacy",
    effect: full,
    speed: full,
    rebuild: !!(meta && (meta.v === 2 || meta.v === 3)),
    speedValue: current && current.speed ? current.speed : 1,
    defaultEffect: current && current.defaultEffect ? current.defaultEffect : "typewriter",
    fps: full ? meta.baseline.fps : 30,
    revision: current && current.revision ? current.revision : 0,
    displayName: meta && meta.displayName ? meta.displayName : ""
  };
};

VN.effectLabel = function (effect) {
  return effect === "characterFade" ? "透明度逐字显示" : "打字机";
};

VN.isSupportedTextMeta = function (meta) {
  if (!meta || !meta.instanceId) return false;
  if (meta.effect === "typewriter" || meta.effect === "characterFade") return true;
  return meta.preset === "typewriter" || meta.preset === "lines";
};

VN.isManagedAnimatorName = function (name) {
  if (name === "REVEAL") return true;
  return /^VN_FADE_\d+$/.test(name);
};

VN.canonical = function (value) {
  return JSON.stringify(value);
};

VN.sealLayerRecord = function (layer, comp) {
  var meta = VN.readMeta(layer.comment);
  if (!meta || meta.v !== 3) return;
  meta.current = meta.current || {};
  meta.current.animationSignature = VN.animationSignature(layer, comp, meta);
  meta.current.timingSignature = VN.timingSignature(layer, comp);
  meta.current.speed = meta.current.speed || 1;
  meta.current.revision = meta.current.revision || 1;
  VN.writeMeta(layer, meta);
};

VN.animationSignature = function (layer, comp, meta) {
  var managed = [];
  var textProps = layer.property("ADBE Text Properties");
  if (textProps !== null) {
    var animators = textProps.property("ADBE Text Animators");
    if (animators !== null) {
      var i;
      for (i = 1; i <= animators.numProperties; i++) {
        var anim = animators.property(i);
        if (!VN.isManagedAnimatorName(anim.name)) continue;
        var opacity = anim.property("ADBE Text Animator Properties");
        var opacityValue = null;
        var opacityKeys = [];
        if (opacity !== null) {
          var opacityProp = opacity.property("ADBE Text Opacity");
          if (opacityProp !== null) {
            if (opacityProp.numKeys) opacityKeys = VN.readScalarKeys(opacityProp, comp);
            else opacityValue = opacityProp.value;
          }
        }
        var selector = null;
        var selectors = anim.property("ADBE Text Selectors");
        if (selectors !== null && selectors.numProperties) selector = selectors.property(1);
        var startKeys = [];
        var endValue = null;
        var amountValue = null;
        var expression = "";
        if (selector) {
          var start = VN.selectorProp(selector, "ADBE Text Index Start");
          if (start) {
            startKeys = VN.readScalarKeys(start, comp);
            expression = start.expression || "";
          }
          var end = VN.selectorProp(selector, "ADBE Text Index End");
          if (end && !end.numKeys) endValue = end.value;
          var amount = selector.property("ADBE Text Selector Max Amount");
          if (amount && !amount.numKeys) amountValue = amount.value;
        }
        managed.push({
          name: anim.name,
          opacityValue: opacityValue,
          opacityKeys: VN.compactKeys(opacityKeys) || [],
          startKeys: VN.compactKeys(startKeys) || [],
          endValue: endValue,
          amountValue: amountValue,
          expression: expression
        });
      }
    }
  }
  var opacityLayer = null;
  try {
    opacityLayer = VN.opacityProp(layer);
  } catch (ignoreOpacity) {}
  var layerOpacity = [];
  if (opacityLayer && opacityLayer.numKeys) layerOpacity = VN.compactKeys(VN.readScalarKeys(opacityLayer, comp)) || [];
  return VN.canonical({ effect: meta.effect || meta.preset || "", managed: managed, opacity: layerOpacity });
};

VN.timingSignature = function (layer, comp) {
  var remap = false;
  try {
    remap = !!layer.timeRemapEnabled;
  } catch (ignore) {}
  return VN.canonical({
    inFrame: Math.round(layer.inPoint / comp.frameDuration),
    outFrame: Math.round(layer.outPoint / comp.frameDuration),
    startFrame: Math.round(layer.startTime / comp.frameDuration),
    stretch: Math.round(layer.stretch * 1000) / 1000,
    timeRemap: remap,
    compDurationFrames: Math.round(comp.duration / comp.frameDuration)
  });
};

VN.instanceFingerprint = function (instanceId) {
  var parts = [];
  var folder = VN.instanceFolderMeta(instanceId);
  parts.push(folder ? VN.canonical(folder.meta.current || {}) : "missing");
  var i;
  for (i = 1; i <= app.project.numItems; i++) {
    var item = app.project.item(i);
    var meta = null;
    try {
      meta = VN.readMeta(item.comment);
    } catch (ignore) {}
    if (!meta || meta.instanceId !== instanceId || meta.logicalId === "instance") continue;
    parts.push(item.name + ":" + VN.canonical(meta.current || meta.preset || ""));
  }
  parts.sort();
  return parts.join("\n");
};

VN.captureLock = function (instanceId) {
  return {
    instanceId: instanceId,
    fingerprint: VN.instanceFingerprint(instanceId),
    identity: VN.instanceIdentity(instanceId)
  };
};

VN.instanceIdentity = function (instanceId) {
  var found = VN.instanceFolderMeta(instanceId);
  if (!found || !found.meta) return null;
  if (found.meta.identity) return found.meta.identity;
  return {
    instanceId: instanceId,
    packageId: found.meta.projectId || "",
    packageVersion: found.meta.buildId || "",
    packageHash: "",
    schemaVersion: found.meta.v || 2
  };
};

VN.lockMatches = function (lock) {
  if (!lock || !lock.instanceId) return false;
  var identity = VN.instanceIdentity(lock.instanceId);
  if (!identity) return false;
  var previous = lock.identity || {};
  if (previous.packageId && identity.packageId !== previous.packageId) return false;
  if (previous.packageHash && identity.packageHash !== previous.packageHash) return false;
  return VN.instanceFingerprint(lock.instanceId) === lock.fingerprint;
};

VN.eventBaseline = function (instanceId, eventId) {
  var found = VN.instanceFolderMeta(instanceId);
  if (!found || !found.meta.baseline || !found.meta.baseline.events) return null;
  var events = found.meta.baseline.events;
  var i;
  for (i = 0; i < events.length; i++) if (events[i].eventId === eventId) return { baseline: found.meta.baseline, event: events[i] };
  return { baseline: found.meta.baseline, event: null };
};

VN.masterCompFor = function (instanceId) {
  var i;
  for (i = 1; i <= app.project.numItems; i++) {
    var item = app.project.item(i);
    if (!(item instanceof CompItem)) continue;
    var meta = VN.readMeta(item.comment);
    if (meta && meta.instanceId === instanceId && meta.logicalId === "master") return item;
  }
  return null;
};

VN.compsForInstance = function (instanceId) {
  var comps = [];
  var i;
  for (i = 1; i <= app.project.numItems; i++) {
    var item = app.project.item(i);
    if (!(item instanceof CompItem)) continue;
    var meta = VN.readMeta(item.comment);
    if (meta && meta.instanceId === instanceId) comps.push({ comp: item, meta: meta });
  }
  return comps;
};

var VN = VN || {};

VN.refresh = function () {
  var comp = app.project.activeItem;
  if (!(comp instanceof CompItem)) {
    alert("请先打开含有文字层的合成，再选择要刷新的文字层。");
    return;
  }
  if (!comp.selectedLayers.length) {
    alert("请选择要刷新的文字层。");
    return;
  }

  var notes = [];
  app.beginUndoGroup("VN Refresh Text Timing");
  var i;
  for (i = 0; i < comp.selectedLayers.length; i++) {
    try {
      notes.push(VN.refreshLayer(comp.selectedLayers[i], comp));
    } catch (err) {
      notes.push(comp.selectedLayers[i].name + "：" + err.toString());
    }
  }
  app.endUndoGroup();
  alert(notes.join("\n"));
};

VN.refreshLayer = function (layer, comp) {
  var textProps = layer.property("ADBE Text Properties");
  if (textProps === null) return layer.name + "：不是文字层，已跳过";
  var meta = VN.readMeta(layer.comment);
  if (!meta || meta.v !== 2) {
    var startProbe = VN.findRevealStart(layer);
    if (startProbe && startProbe.expression && startProbe.expression.indexOf("VN_REVEAL") !== -1) {
      return layer.name + "：这是第一版表达式动画。请运行 convert_v1_text_animation.jsx";
    }
    return layer.name + "：没有第二版文字元数据，已跳过";
  }
  if (meta.preset === "fade") return layer.name + "：淡入不随字数重算，已跳过";
  if (meta.preset !== "typewriter" && meta.preset !== "lines") {
    return layer.name + "：这一层没有打字关键帧，已跳过";
  }

  var selector = VN.findRevealSelector(layer);
  if (!selector) return layer.name + "：没有找到 REVEAL_RANGE";
  var start = VN.selectorProp(selector, "ADBE Text Index Start");
  if (start === null) return layer.name + "：没有找到 Start";
  if (start.expression) return layer.name + "：Start 上仍有表达式。请先运行迁移脚本，或重新导入";
  if (!VN.keysMatch(VN.readScalarKeys(start, comp), meta.reveal)) {
    return layer.name + "：关键帧已被手工修改，已跳过";
  }

  var timingInfo = VN.instanceTiming(meta.instanceId);
  if (!timingInfo) return layer.name + "：找不到该实例保存的节奏参数";
  var raw = VN.readBaseText(layer);
  var plan = VN.planCharacters(raw, timingInfo.timing, timingInfo.fps);
  var frames = meta.preset === "lines" ? plan.lineFrames : plan.revealFrames;
  var keys = VN.scaleKeyframeSpacing(VN.revealKeyframes(frames, meta.holdIn || 0), meta.speedScale || 1);
  VN.applyScalarKeys(start, comp, keys);
  var end = VN.selectorProp(selector, "ADBE Text Index End");
  if (end !== null) {
    if (end.expression) end.expression = "";
    end.setValue(VN.REVEAL_END_INDEX);
  }
  var amount = selector.property("ADBE Text Selector Max Amount");
  if (amount !== null) {
    if (amount.expression) amount.expression = "";
    amount.setValue(100);
  }
  meta.reveal = VN.compactKeys(keys);
  VN.writeMeta(layer, meta);

  var needed = meta.preset === "lines" ? plan.lineRevealFrames : plan.typewriterRevealFrames;
  if (meta.eventFrames !== undefined && needed > meta.eventFrames) {
    return layer.name + "：已按当前文字重写关键帧，但需要 " + needed + " 帧，事件只有 " + meta.eventFrames + " 帧。请延长事件后再生成，生成器没有截断这段文字。";
  }
  return layer.name + "：已按当前文字重写打字关键帧";
};

VN.readBaseText = function (layer) {
  var source = VN.requireProp(VN.requireProp(layer, "ADBE Text Properties"), "ADBE Text Document");
  var previous = source.expression;
  try {
    source.expression = "";
    return source.value.text;
  } finally {
    source.expression = previous;
  }
};

VN.instanceTiming = function (instanceId) {
  var i;
  for (i = 1; i <= app.project.numItems; i++) {
    var item = app.project.item(i);
    if (!(item instanceof CompItem)) continue;
    var meta = VN.readMeta(item.comment);
    if (!meta || meta.instanceId !== instanceId || meta.logicalId !== "global:control" || !meta.timing) continue;
    return { timing: meta.timing, fps: meta.fps || item.frameRate };
  }
  return null;
};

VN.findRevealSelector = function (layer) {
  var textProps = layer.property("ADBE Text Properties");
  if (textProps === null) return null;
  var animators = textProps.property("ADBE Text Animators");
  if (animators === null) return null;
  var i;
  for (i = 1; i <= animators.numProperties; i++) {
    if (animators.property(i).name !== "REVEAL") continue;
    var selectors = animators.property(i).property("ADBE Text Selectors");
    if (selectors === null) return null;
    var s;
    for (s = 1; s <= selectors.numProperties; s++) {
      if (selectors.property(s).name === "REVEAL_RANGE") return selectors.property(s);
    }
  }
  return null;
};

VN.findRevealStart = function (layer) {
  var selector = VN.findRevealSelector(layer);
  if (!selector) return null;
  return VN.selectorProp(selector, "ADBE Text Index Start");
};

var VN = VN || {};

VN.scopeTargets = function (scope) {
  var active = app.project.activeItem;
  if (!(active instanceof CompItem)) return { error: "请先打开一个合成。", targets: [] };
  if (scope === "selection") {
    if (!active.selectedLayers.length) return { error: "请先选择文字层。默认只处理选中的文字。", targets: [] };
    var selected = [];
    var i;
    for (i = 0; i < active.selectedLayers.length; i++) selected.push({ layer: active.selectedLayers[i], comp: active });
    return { targets: selected };
  }
  if (scope === "scene") {
    var sceneLayers = VN.managedTextLayers(active, null);
    if (!sceneLayers.length) return { error: "当前合成里没有生成器管理的文字层。", targets: [] };
    return { targets: sceneLayers };
  }
  var instanceId = VN.instanceIdFromContext(active);
  if (!instanceId) return { error: "请选择一个生成的片段。", targets: [] };
  var found = [];
  var n;
  for (n = 1; n <= app.project.numItems; n++) {
    var item = app.project.item(n);
    if (!(item instanceof CompItem)) continue;
    var layers = VN.managedTextLayers(item, instanceId);
    var k;
    for (k = 0; k < layers.length; k++) found.push(layers[k]);
  }
  if (!found.length) return { error: "这个实例里没有生成器管理的文字层。", targets: [] };
  return { targets: found };
};

VN.instanceIdFromContext = function (comp) {
  var found = null;
  if (comp.selectedLayers && comp.selectedLayers.length) {
    var i;
    for (i = 0; i < comp.selectedLayers.length; i++) {
      var meta = VN.readMeta(comp.selectedLayers[i].comment);
      if (!meta || !meta.instanceId) continue;
      if (found && found !== meta.instanceId) return null;
      found = meta.instanceId;
    }
    if (found) return found;
  }
  var own = VN.readMeta(comp.comment);
  if (own && own.instanceId) return own.instanceId;
  return null;
};

VN.managedTextLayers = function (comp, instanceId) {
  var layers = [];
  var i;
  for (i = 1; i <= comp.numLayers; i++) {
    var layer = comp.layer(i);
    if (layer.property("ADBE Text Properties") === null) continue;
    var meta = VN.readMeta(layer.comment);
    if (!meta || meta.v !== 2) continue;
    if (instanceId && meta.instanceId !== instanceId) continue;
    layers.push({ layer: layer, comp: comp });
  }
  return layers;
};

VN.applyToTargets = function (scope, title, fn) {
  var found = VN.scopeTargets(scope);
  if (found.error) return { ok: false, message: found.error, notes: [] };
  var notes = [];
  app.beginUndoGroup(title);
  var i;
  for (i = 0; i < found.targets.length; i++) {
    var target = found.targets[i];
    try {
      notes.push(fn(target.layer, target.comp));
    } catch (err) {
      notes.push(target.layer.name + "：" + err.toString());
    }
  }
  app.endUndoGroup();
  return { ok: true, message: "", notes: notes };
};

VN.runOnTargets = function (scope, title, fn) {
  var result = VN.applyToTargets(scope, title, fn);
  if (!result.ok) {
    alert(result.message);
    return;
  }
  alert(result.notes.join("\n"));
};

VN.rebuildSelectedText = function () {
  var active = app.project.activeItem;
  if (!(active instanceof CompItem)) return { ok: false, message: "请先选择文字层。", details: "" };
  var targets = [];
  var i;
  for (i = 0; i < active.selectedLayers.length; i++) {
    var layer = active.selectedLayers[i];
    if (layer.property("ADBE Text Properties") === null) continue;
    var meta = VN.readMeta(layer.comment);
    if (!meta || meta.v !== 2) continue;
    if (meta.preset !== "typewriter" && meta.preset !== "lines") continue;
    targets.push(layer);
  }
  if (!targets.length) return { ok: false, message: "没有可重建的文字层。", details: "" };
  var notes = [];
  app.beginUndoGroup("VN 按新文案重建动画");
  for (i = 0; i < targets.length; i++) {
    try {
      notes.push(VN.refreshLayer(targets[i], active));
    } catch (err) {
      notes.push(targets[i].name + "：" + err.toString());
    }
  }
  for (i = 0; i < targets.length; i++) {
    try {
      notes.push(VN.checkLayer(targets[i], active));
    } catch (err) {
      notes.push(targets[i].name + " 检查：" + err.toString());
    }
  }
  app.endUndoGroup();
  return { ok: true, message: "已重建 " + targets.length + " 个文字层的动画", details: notes.join("\n") };
};

VN.refreshTargets = function (scope) {
  VN.runOnTargets(scope, "VN Refresh Text", function (layer, comp) {
    return VN.refreshLayer(layer, comp);
  });
};

VN.applySpeedTargets = function (scope, speed, useExisting) {
  VN.runOnTargets(scope, "VN Apply Speed", function (layer, comp) {
    return VN.applySpeedToLayer(layer, comp, speed, useExisting);
  });
};

VN.applyPresetTargets = function (scope, preset) {
  VN.runOnTargets(scope, "VN Apply Preset", function (layer, comp) {
    return VN.applyPresetToLayer(layer, comp, preset);
  });
};

VN.unlinkTargets = function (scope) {
  VN.runOnTargets(scope, "VN Unlink Style", function (layer, comp) {
    return VN.unlinkStyle(layer, comp);
  });
};

VN.checkTargets = function (scope) {
  VN.runOnTargets(scope, "VN Check", function (layer, comp) {
    return VN.checkLayer(layer, comp);
  });
};

VN.applySpeedToLayer = function (layer, comp, speed, useExisting) {
  var meta = VN.readMeta(layer.comment);
  if (!meta || meta.v !== 2) return layer.name + "：没有第二版文字元数据，已跳过";
  var channel = VN.animationChannel(layer, comp, meta);
  if (!channel) return layer.name + "：没有可缩放的动画关键帧，已跳过";
  var live = VN.readScalarKeys(channel.prop, comp);
  var matches = VN.keysMatch(live, meta[channel.field]);
  if (!matches && !useExisting) return layer.name + "：关键帧已被手工修改，已跳过";
  var source = useExisting ? live : VN.expandKeys(meta[channel.field], channel.fallback);
  if (!source.length) return layer.name + "：没有可缩放的关键帧，已跳过";
  var scaled = VN.scaleKeyframeSpacing(source, speed);
  if (channel.field === "opacity") VN.applyScalarKeysKeepingExpression(channel.prop, comp, scaled);
  else VN.applyScalarKeys(channel.prop, comp, scaled);
  var note = layer.name + "：已按 " + speed + " 倍缩放关键帧间距，起点仍在第 " + scaled[0].frame + " 帧";
  if (matches) {
    meta.speedScale = (meta.speedScale || 1) * speed;
    meta[channel.field] = VN.compactKeys(scaled);
    VN.writeMeta(layer, meta);
  } else {
    note += "。这是按现有关键帧缩放，之后刷新文案仍会跳过这一层";
  }
  if (meta.eventFrames !== undefined) {
    var limit = (meta.holdIn || 0) + meta.eventFrames;
    var last = scaled[scaled.length - 1].frame;
    if (last >= limit) note += "。最后一帧在第 " + last + " 帧，事件只到第 " + (limit - 1) + " 帧，生成器没有截断";
  }
  return note;
};

VN.applyPresetToLayer = function (layer, comp, preset) {
  var meta = VN.readMeta(layer.comment);
  if (!meta || meta.v !== 2) return layer.name + "：没有第二版文字元数据，已跳过";
  if (preset !== "typewriter" && preset !== "lines" && preset !== "fade") return layer.name + "：未知预设";
  var timingInfo = VN.instanceTiming(meta.instanceId);
  if (!timingInfo) return layer.name + "：找不到该实例保存的节奏参数";
  var raw = VN.readBaseText(layer);
  var plan = VN.planCharacters(raw, timingInfo.timing, timingInfo.fps);
  var speed = meta.speedScale || 1;
  var opacity = VN.opacityProp(layer);
  var liveOpacity = VN.readScalarKeys(opacity, comp);
  var opacityMatches = VN.keysMatch(liveOpacity, meta.opacity);
  if (preset === "fade") {
    if (liveOpacity.length && !opacityMatches) return layer.name + "：透明度关键帧已被手工修改，已跳过";
    var revealStart = VN.findRevealStart(layer);
    if (revealStart && meta.reveal && !VN.keysMatch(VN.readScalarKeys(revealStart, comp), meta.reveal)) {
      return layer.name + "：打字关键帧已被手工修改，已跳过";
    }
    VN.removeRevealAnimator(layer);
    var fadeKeys = VN.scaleKeyframeSpacing(VN.fadeOpacityKeyframes(meta.holdIn || 0, plan.fadeFrames), speed);
    VN.applyScalarKeysKeepingExpression(opacity, comp, fadeKeys);
    meta.preset = "fade";
    delete meta.reveal;
    meta.opacity = VN.compactKeys(fadeKeys);
    VN.writeMeta(layer, meta);
    return layer.name + "：已改为整段淡入";
  }
  var start = VN.findRevealStart(layer);
  if (start && meta.reveal && !VN.keysMatch(VN.readScalarKeys(start, comp), meta.reveal)) {
    return layer.name + "：关键帧已被手工修改，已跳过";
  }
  var appear = preset === "lines" ? plan.lineFrames : plan.revealFrames;
  var keys = VN.scaleKeyframeSpacing(VN.revealKeyframes(appear, meta.holdIn || 0), speed);
  if (!start) VN.installRevealKeys(layer, comp, keys);
  else VN.applyScalarKeys(start, comp, keys);
  if (opacityMatches && meta.opacity && meta.opacity.length) {
    VN.clearKeys(opacity);
    opacity.setValue(100);
  }
  meta.preset = preset;
  meta.reveal = VN.compactKeys(keys);
  delete meta.opacity;
  VN.writeMeta(layer, meta);
  var needed = preset === "lines" ? plan.lineRevealFrames : plan.typewriterRevealFrames;
  if (meta.eventFrames !== undefined && needed > meta.eventFrames) {
    return layer.name + "：已改为" + (preset === "lines" ? "逐行出现" : "打字机") + "，但需要 " + needed + " 帧，事件只有 " + meta.eventFrames + " 帧。生成器没有截断这段文字。";
  }
  return layer.name + "：已改为" + (preset === "lines" ? "逐行出现" : "打字机");
};

VN.unlinkStyle = function (layer, comp) {
  var textProps = layer.property("ADBE Text Properties");
  if (textProps === null) return layer.name + "：不是文字层，已跳过";
  var source = VN.requireProp(textProps, "ADBE Text Document");
  if (!source.expression) return layer.name + "：没有样式表达式，已跳过";
  var previous = source.expression;
  var baked;
  try {
    baked = source.valueAtTime(comp.time, false);
    source.expression = "";
    VN.setTextDocument(source, baked, null);
  } catch (err) {
    try {
      source.expression = previous;
    } catch (ignore) {}
    return layer.name + "：解除失败，样式表达式已恢复。" + err.toString();
  }
  var meta = VN.readMeta(layer.comment);
  if (meta && meta.v === 2) {
    meta.styleLinked = false;
    VN.writeMeta(layer, meta);
  }
  return layer.name + "：已把当前样式写回文字，并解除样式关联";
};

VN.checkLayer = function (layer, comp) {
  var textProps = layer.property("ADBE Text Properties");
  if (textProps === null) return layer.name + "：不是文字层，已跳过";
  var meta = VN.readMeta(layer.comment);
  if (!meta || meta.v !== 2) return layer.name + "：没有第二版文字元数据，已跳过";
  var notes = [];
  VN.collectBrokenRefs(layer, notes);
  if ((meta.preset === "typewriter" || meta.preset === "lines") && meta.reveal) {
    var start = VN.findRevealStart(layer);
    if (!start) notes.push("缺少 REVEAL 动画器");
    else if (!VN.keysMatch(VN.readScalarKeys(start, comp), meta.reveal)) notes.push("打字关键帧与上次写入不一致");
  }
  var timingInfo = VN.instanceTiming(meta.instanceId);
  if (!timingInfo) notes.push("找不到实例节奏参数");
  else if (meta.preset === "typewriter" || meta.preset === "lines" || meta.preset === "fade") {
    var raw = VN.readBaseText(layer);
    var plan = VN.planCharacters(raw, timingInfo.timing, timingInfo.fps);
    var needed = meta.preset === "lines" ? plan.lineRevealFrames : meta.preset === "fade" ? plan.fadeFrames : plan.typewriterRevealFrames;
    if (meta.eventFrames !== undefined && needed > meta.eventFrames) {
      notes.push("文案需要 " + needed + " 帧，事件只有 " + meta.eventFrames + " 帧");
    }
  }
  if (!notes.length) return layer.name + "：未发现问题";
  return layer.name + "：" + notes.join("；");
};

VN.collectBrokenRefs = function (layer, notes) {
  var props = [];
  var textProps = layer.property("ADBE Text Properties");
  if (textProps !== null) props.push(textProps.property("ADBE Text Document"));
  props.push(VN.opacityProp(layer));
  var i;
  for (i = 0; i < props.length; i++) {
    var prop = props[i];
    if (prop === null || !prop.expression) continue;
    var expression = prop.expression;
    var match = expression.match(/comp\("([^"]+)"\)/g);
    if (!match) continue;
    var n;
    for (n = 0; n < match.length; n++) {
      var name = match[n].substring(6, match[n].length - 2);
      if (!VN.projectHasComp(name) && !VN.noteHas(notes, name)) notes.push("失效引用 " + name);
    }
  }
};

VN.noteHas = function (notes, name) {
  var i;
  for (i = 0; i < notes.length; i++) if (notes[i].indexOf(name) !== -1) return true;
  return false;
};

VN.projectHasComp = function (name) {
  var i;
  for (i = 1; i <= app.project.numItems; i++) {
    var item = app.project.item(i);
    if (item instanceof CompItem && item.name === name) return true;
  }
  return false;
};

VN.animationChannel = function (layer, comp, meta) {
  if (meta.preset === "fade") {
    var opacity = VN.opacityProp(layer);
    if (!opacity.numKeys && !(meta.opacity && meta.opacity.length)) return null;
    return { prop: opacity, field: "opacity", fallback: "linear" };
  }
  if (meta.preset !== "typewriter" && meta.preset !== "lines") return null;
  var start = VN.findRevealStart(layer);
  if (!start) return null;
  return { prop: start, field: "reveal", fallback: "hold" };
};

VN.opacityProp = function (layer) {
  return VN.requireProp(VN.requireProp(layer, "ADBE Transform Group"), "ADBE Opacity");
};

VN.removeRevealAnimator = function (layer) {
  var textProps = layer.property("ADBE Text Properties");
  if (textProps === null) return;
  var animators = textProps.property("ADBE Text Animators");
  if (animators === null) return;
  var i;
  for (i = animators.numProperties; i >= 1; i--) {
    if (animators.property(i).name === "REVEAL") animators.property(i).remove();
  }
};

VN.locateControl = function () {
  var active = app.project.activeItem;
  if (!(active instanceof CompItem)) {
    alert("请选择一个生成的片段。");
    return;
  }
  var instanceId = VN.instanceIdFromContext(active);
  if (!instanceId) {
    alert("请选择一个生成的片段。");
    return;
  }
  var i;
  for (i = 1; i <= app.project.numItems; i++) {
    var item = app.project.item(i);
    if (!(item instanceof CompItem)) continue;
    var meta = VN.readMeta(item.comment);
    if (!meta || meta.instanceId !== instanceId || meta.logicalId !== "global:control") continue;
    item.openInViewer();
    return;
  }
  alert("找不到这个实例的控制合成。");
};


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
  if (manifest.compiledSchemaVersion !== 2 && manifest.compiledSchemaVersion !== 3) {
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

var VN = VN || {};

VN.pad2 = function (value) {
  var text = String(value);
  return text.length < 2 ? "0" + text : text;
};

VN.formatTimecode = function (comp) {
  var fps = Math.round(comp.frameRate);
  if (fps < 1) fps = 1;
  var frame = Math.round(comp.time / comp.frameDuration);
  if (frame < 0) frame = 0;
  var frames = frame % fps;
  var total = Math.floor(frame / fps);
  var seconds = total % 60;
  var minutes = Math.floor(total / 60) % 60;
  var hours = Math.floor(total / 3600);
  return VN.pad2(hours) + ":" + VN.pad2(minutes) + ":" + VN.pad2(seconds) + ":" + VN.pad2(frames);
};

VN.currentInsertTarget = function () {
  var active = app.project.activeItem;
  if (!(active instanceof CompItem)) return null;
  return { comp: active, time: active.time, name: active.name, timecode: VN.formatTimecode(active) };
};

VN.describeInstance = function (meta) {
  return {
    instanceId: meta.instanceId,
    projectId: meta.projectId || "",
    buildId: meta.buildId || "",
    displayName: meta.displayName || meta.instanceId,
    versionLabel: meta.versionLabel || ""
  };
};

VN.isGeneratedLogical = function (logicalId) {
  if (!logicalId) return false;
  if (logicalId === "master" || logicalId === "overlay" || logicalId === "global:control") return true;
  if (logicalId.indexOf("scene:") === 0 || logicalId.indexOf("event:") === 0 || logicalId.indexOf("style:") === 0) return true;
  return false;
};

VN.listHas = function (list, value) {
  var i;
  for (i = 0; i < list.length; i++) if (list[i] === value) return true;
  return false;
};

VN.resolveContext = function () {
  var active = app.project.activeItem;
  var textLayers = [];
  if (!(active instanceof CompItem)) {
    return { status: "none", instanceId: "", instanceIds: [], textLayers: [], instance: null, message: "" };
  }
  textLayers = VN.supportedSelection(active);
  var own = VN.readMeta(active.comment);
  if (own && own.instanceId && VN.isGeneratedLogical(own.logicalId)) {
    return {
      status: "unique",
      instanceId: own.instanceId,
      instanceIds: [own.instanceId],
      textLayers: textLayers,
      instance: VN.describeInstance(own),
      message: ""
    };
  }
  var ids = [];
  var i;
  for (i = 1; i <= active.numLayers; i++) {
    var layer = active.layer(i);
    var meta = VN.readMeta(layer.comment);
    if (meta && meta.instanceId) {
      if (!VN.listHas(ids, meta.instanceId)) ids.push(meta.instanceId);
    }
    try {
      if (layer.source instanceof CompItem) {
        var sourceMeta = VN.readMeta(layer.source.comment);
        if (sourceMeta && sourceMeta.instanceId && !VN.listHas(ids, sourceMeta.instanceId)) ids.push(sourceMeta.instanceId);
      }
    } catch (ignoreSource) {}
  }
  if (!ids.length) {
    for (i = 0; i < textLayers.length; i++) {
      if (!VN.listHas(ids, textLayers[i].meta.instanceId)) ids.push(textLayers[i].meta.instanceId);
    }
  }
  if (ids.length > 1) {
    return {
      status: "ambiguous",
      instanceId: "",
      instanceIds: ids,
      textLayers: textLayers,
      instance: null,
      message: "这里有多份片段。请打开要编辑的生成合成。"
    };
  }
  if (ids.length === 1) {
    var folder = VN.instanceFolderMeta(ids[0]);
    var described = folder ? VN.describeInstance(folder.meta) : { instanceId: ids[0], projectId: "", buildId: "", displayName: ids[0], versionLabel: "" };
    return { status: "unique", instanceId: ids[0], instanceIds: ids, textLayers: textLayers, instance: described, message: "" };
  }
  return { status: "none", instanceId: "", instanceIds: [], textLayers: [], instance: null, message: "" };
};

VN.findBuildInstances = function (projectId, buildId) {
  var found = [];
  var i;
  for (i = 1; i <= app.project.numItems; i++) {
    var item = app.project.item(i);
    var meta = null;
    try {
      meta = VN.readMeta(item.comment);
    } catch (ignoreComment) {}
    if (!meta || meta.logicalId !== "instance") continue;
    if (meta.projectId !== projectId || meta.buildId !== buildId) continue;
    found.push({ instanceId: meta.instanceId, item: item, meta: meta });
  }
  return found;
};

VN.openLogicalComp = function (instanceId, logicalId) {
  if (!instanceId) return { ok: false, message: "请选择一个生成的片段" };
  var i;
  for (i = 1; i <= app.project.numItems; i++) {
    var item = app.project.item(i);
    if (!(item instanceof CompItem)) continue;
    var meta = VN.readMeta(item.comment);
    if (!meta || meta.instanceId !== instanceId || meta.logicalId !== logicalId) continue;
    item.openInViewer();
    return { ok: true, message: "", comp: item };
  }
  return { ok: false, message: logicalId === "master" ? "找不到这个片段的主合成。" : "找不到这个片段的全局样式。" };
};

var VN = VN || {};

VN.itemResult = function (status, reason, instanceId, message, layer, eventId) {
  return {
    status: status,
    reason: reason,
    instanceId: instanceId || "",
    eventId: eventId || "",
    layerName: layer ? layer.name : "",
    message: message
  };
};

VN.finishOperation = function (operation, items, extra) {
  var updated = 0;
  var skipped = 0;
  var failed = 0;
  var i;
  for (i = 0; i < items.length; i++) {
    if (items[i].status === "updated") updated += 1;
    else if (items[i].status === "skipped") skipped += 1;
    else failed += 1;
  }
  var status = "failed";
  if (updated && !skipped && !failed) status = "updated";
  else if (updated) status = "partial";
  else if (!failed && skipped) status = "skipped";
  var applied = status === "updated" || status === "partial" ? extra : null;
  return {
    status: status,
    operation: operation,
    items: items,
    appliedSpeed: applied ? extra.appliedSpeed : undefined,
    durationFrames: applied ? extra.durationFrames : undefined,
    message: VN.operationMessage(operation, status, updated, skipped, failed, items, extra || {})
  };
};

VN.operationMessage = function (operation, status, updated, skipped, failed, items, extra) {
  if (operation === "speed") {
    if (status === "updated" || status === "partial") return "速度已调整为 " + extra.appliedSpeed + " 倍。";
    return items.length ? items[0].message : "未调整速度：片段保持原样。";
  }
  if (operation === "effect") {
    if (!updated) return items.length ? items[0].message : "效果没有改变。";
    if (!skipped && !failed) return "效果已应用到 " + updated + " 段。";
    return "效果已应用到 " + updated + " 段；" + (skipped + failed) + " 段保留原效果。";
  }
  if (operation === "rebuild") {
    if (updated && !skipped && !failed) return "已更新 " + updated + " 段文字。";
    if (updated && skipped && !failed) {
      var manual = 0;
      var n;
      for (n = 0; n < items.length; n++) if (items[n].status === "skipped" && items[n].reason === "manual_edit") manual += 1;
      if (manual === skipped) return "已更新 " + updated + " 段，跳过 " + manual + " 段手动动画。";
      return "已更新 " + updated + " 段，跳过 " + skipped + " 段。";
    }
    if (updated) return "已更新 " + updated + " 段，" + failed + " 段失败。";
    return items.length ? items[0].message : "未更新。";
  }
  if (status === "updated") return "样式已更新。";
  return items.length ? items[0].message : "样式没有写入。";
};

VN.timedLogical = function (logicalId) {
  if (!logicalId) return false;
  if (logicalId === "master" || logicalId === "overlay") return true;
  if (logicalId.indexOf("scene:") === 0 || logicalId.indexOf("event:") === 0) return true;
  return false;
};

VN.supportedSelection = function (comp) {
  var layers = [];
  if (!comp || !comp.selectedLayers) return layers;
  var i;
  for (i = 0; i < comp.selectedLayers.length; i++) {
    var layer = comp.selectedLayers[i];
    if (layer.property("ADBE Text Properties") === null) continue;
    var meta = VN.readMeta(layer.comment);
    if (!VN.isSupportedTextMeta(meta)) continue;
    layers.push({ layer: layer, comp: comp, meta: meta });
  }
  return layers;
};

VN.modernTextLayers = function (instanceId) {
  var found = [];
  var comps = VN.compsForInstance(instanceId);
  var i;
  for (i = 0; i < comps.length; i++) {
    var comp = comps[i].comp;
    var n;
    for (n = 1; n <= comp.numLayers; n++) {
      var layer = comp.layer(n);
      if (layer.property("ADBE Text Properties") === null) continue;
      var meta = VN.readMeta(layer.comment);
      if (!meta || meta.instanceId !== instanceId) continue;
      if (meta.effect !== "typewriter" && meta.effect !== "characterFade") continue;
      found.push({ layer: layer, comp: comp, meta: meta });
    }
  }
  return found;
};

VN.availableFrames = function (layer, comp, instanceId) {
  var remap = false;
  try {
    remap = !!layer.timeRemapEnabled;
  } catch (ignore) {}
  if (remap || Math.abs(layer.stretch - 100) > 0.01) return { ok: false, reason: "unreliable_time" };
  var frames = Math.round((layer.outPoint - layer.inPoint) / comp.frameDuration);
  var parent = VN.parentWindow(comp, instanceId, {});
  if (!parent.ok) return parent;
  if (parent.frames !== null && parent.frames < frames) frames = parent.frames;
  return { ok: true, frames: frames };
};

VN.parentWindow = function (comp, instanceId, seen) {
  if (seen[comp.id]) return { ok: false, reason: "unreliable_time" };
  seen[comp.id] = true;
  var parents = [];
  var i;
  for (i = 1; i <= app.project.numItems; i++) {
    var item = app.project.item(i);
    if (!(item instanceof CompItem) || item === comp) continue;
    var host = VN.readMeta(item.comment);
    if (!host || host.instanceId !== instanceId) continue;
    var n;
    for (n = 1; n <= item.numLayers; n++) {
      var layer = item.layer(n);
      if (layer.source !== comp) continue;
      parents.push({ layer: layer, comp: item });
    }
  }
  if (parents.length > 1) return { ok: false, reason: "unreliable_time" };
  if (!parents.length) return { ok: true, frames: null };
  var parent = parents[0];
  var remap = false;
  try {
    remap = !!parent.layer.timeRemapEnabled;
  } catch (ignoreRemap) {}
  if (remap || parent.layer.stretch < 0 || Math.abs(parent.layer.stretch - 100) > 0.01) return { ok: false, reason: "unreliable_time" };
  var frames = Math.round((parent.layer.outPoint - parent.layer.inPoint) / parent.comp.frameDuration);
  var above = VN.parentWindow(parent.comp, instanceId, seen);
  if (!above.ok) return above;
  if (above.frames !== null && above.frames < frames) frames = above.frames;
  return { ok: true, frames: frames };
};

VN.animationChanged = function (layer, comp, meta) {
  if (!meta.current || !meta.current.animationSignature) return meta.v === 3;
  return VN.animationSignature(layer, comp, meta) !== meta.current.animationSignature;
};

VN.timingChanged = function (layer, comp, meta) {
  if (!meta.current || !meta.current.timingSignature) return true;
  return VN.timingSignature(layer, comp) !== meta.current.timingSignature;
};

VN.snapshotAnimators = function (layer, comp) {
  var saved = [];
  var textProps = layer.property("ADBE Text Properties");
  if (textProps === null) return saved;
  var animators = textProps.property("ADBE Text Animators");
  if (animators === null) return saved;
  var i;
  for (i = 1; i <= animators.numProperties; i++) {
    var anim = animators.property(i);
    if (!VN.isManagedAnimatorName(anim.name)) continue;
    var opacityKeys = [];
    var opacityValue = 0;
    var group = anim.property("ADBE Text Animator Properties");
    if (group !== null) {
      var opacity = group.property("ADBE Text Opacity");
      if (opacity !== null) {
        if (opacity.numKeys) opacityKeys = VN.readScalarKeys(opacity, comp);
        else opacityValue = opacity.value;
      }
    }
    var startKeys = [];
    var endValue = VN.REVEAL_END_INDEX;
    var amountValue = 100;
    var selectors = anim.property("ADBE Text Selectors");
    if (selectors !== null && selectors.numProperties) {
      var selector = selectors.property(1);
      var start = VN.selectorProp(selector, "ADBE Text Index Start");
      if (start) startKeys = VN.readScalarKeys(start, comp);
      var end = VN.selectorProp(selector, "ADBE Text Index End");
      if (end && !end.numKeys) endValue = end.value;
      var amount = selector.property("ADBE Text Selector Max Amount");
      if (amount && !amount.numKeys) amountValue = amount.value;
    }
    saved.push({ name: anim.name, opacityKeys: opacityKeys, opacityValue: opacityValue, startKeys: startKeys, endValue: endValue, amountValue: amountValue });
  }
  return saved;
};

VN.restoreAnimators = function (layer, comp, saved) {
  VN.removeManagedAnimators(layer);
  var i;
  for (i = 0; i < saved.length; i++) {
    var item = saved[i];
    if (item.name === "REVEAL") VN.installRevealKeys(layer, comp, item.startKeys);
    else VN.installFadeAnimator(layer, comp, item);
  }
};

VN.removeManagedAnimators = function (layer) {
  var textProps = layer.property("ADBE Text Properties");
  if (textProps === null) return;
  var animators = textProps.property("ADBE Text Animators");
  if (animators === null) return;
  var i;
  for (i = animators.numProperties; i >= 1; i--) {
    if (VN.isManagedAnimatorName(animators.property(i).name)) animators.property(i).remove();
  }
};

VN.foreignAnimatorConflict = function (layer) {
  var textProps = layer.property("ADBE Text Properties");
  if (textProps === null) return false;
  var animators = textProps.property("ADBE Text Animators");
  if (animators === null) return false;
  var i;
  for (i = 1; i <= animators.numProperties; i++) {
    var anim = animators.property(i);
    if (VN.isManagedAnimatorName(anim.name)) continue;
    var group = anim.property("ADBE Text Animator Properties");
    if (group !== null && group.property("ADBE Text Opacity") !== null) return true;
    if (anim.property("ADBE Text Selectors") !== null) return true;
  }
  return false;
};

VN.installFadeAnimator = function (layer, comp, track) {
  var animators = VN.requireProp(VN.requireProp(layer, "ADBE Text Properties"), "ADBE Text Animators");
  var anim = animators.addProperty("ADBE Text Animator");
  anim.name = track.name || "VN_FADE_0";
  var opacity = VN.requireProp(anim, "ADBE Text Animator Properties").addProperty("ADBE Text Opacity");
  if (track.opacityKeys && track.opacityKeys.length) VN.applyScalarKeys(opacity, comp, track.opacityKeys);
  else opacity.setValue(track.opacityValue === undefined ? 0 : track.opacityValue);
  var selector = VN.requireProp(anim, "ADBE Text Selectors").addProperty("ADBE Text Selector");
  selector.name = "RANGE";
  VN.setSelectorValue(selector, "ADBE Text Range Units", 2);
  VN.setSelectorValue(selector, "ADBE Text Range Type2", 1);
  VN.setSelectorValue(selector, "ADBE Text Range Shape", 1);
  var end = VN.selectorProp(selector, "ADBE Text Index End");
  var start = VN.selectorProp(selector, "ADBE Text Index Start");
  if (start) start.setValue(track.aeIndex === undefined ? 0 : track.aeIndex);
  if (end) end.setValue(track.endValue !== undefined ? track.endValue : (track.aeIndex || 0) + (track.aeLength || 1));
  if (track.startKeys && track.startKeys.length && start) VN.applyScalarKeys(start, comp, track.startKeys);
  var amount = selector.property("ADBE Text Selector Max Amount");
  if (amount) amount.setValue(track.amountValue === undefined ? 100 : track.amountValue);
};

VN.writePlan = function (layer, comp, plan) {
  VN.removeManagedAnimators(layer);
  if (plan.effect === "characterFade") {
    var i;
    for (i = 0; i < plan.fadeTracks.length; i++) {
      var track = plan.fadeTracks[i];
      VN.installFadeAnimator(layer, comp, {
        name: "VN_FADE_" + i,
        aeIndex: track.aeIndex,
        aeLength: track.aeLength,
        opacityKeys: track.keys,
        opacityValue: 0
      });
    }
    return;
  }
  VN.installRevealKeys(layer, comp, plan.revealKeys);
};

VN.rebuildModern = function (target) {
  var layer = target.layer;
  var comp = target.comp;
  var meta = VN.readMeta(layer.comment);
  if (VN.foreignAnimatorConflict(layer)) {
    return VN.itemResult("skipped", "manual_edit", meta.instanceId, layer.name + "：有无法判断的动画，已跳过。", layer, meta.eventId);
  }
  if (VN.animationChanged(layer, comp, meta)) {
    return VN.itemResult("skipped", "manual_edit", meta.instanceId, layer.name + "：动画已被手动修改，已跳过。", layer, meta.eventId);
  }
  var time = VN.availableFrames(layer, comp, meta.instanceId);
  if (!time.ok) {
    return VN.itemResult("skipped", "unreliable_time", meta.instanceId, layer.name + "：无法确定这段文字的可用时间。", layer, meta.eventId);
  }
  var located = VN.eventBaseline(meta.instanceId, meta.eventId);
  if (!located || !located.event) {
    return VN.itemResult("failed", "unsupported_schema", meta.instanceId, layer.name + "：没有导入基准，不能重算。", layer, meta.eventId);
  }
  var text = VN.readBaseText(layer);
  var pauses = VN.pausesForText(text, located.baseline.commaPauseFrames || 0, located.baseline.sentencePauseFrames || 0);
  var speed = located.baseline && VN.capabilitiesFor(meta.instanceId).speedValue;
  var plan = VN.buildAnimationPlan(text, meta.effect || "typewriter", speed || 1, {
    charactersPerSecond: located.event.charactersPerSecond,
    fps: located.baseline.fps,
    holdInFrames: located.event.animationStartFrame || 0,
    characterFadeFrames: located.event.characterFadeFrames || 0,
    pauses: pauses
  }, time.frames);
  if (!plan.fits) {
    return VN.itemResult("skipped", "insufficient_duration", meta.instanceId, "未更新：这段文字需要更长的显示时间。请延长片段后重试。", layer, meta.eventId);
  }
  var saved = VN.snapshotAnimators(layer, comp);
  var previous = layer.comment;
  try {
    VN.writePlan(layer, comp, plan);
    meta.effect = plan.effect;
    meta.reveal = VN.compactKeys(plan.revealKeys);
    meta.current = meta.current || {};
    meta.current.effect = plan.effect;
    VN.writeMeta(layer, meta);
    VN.sealLayerRecord(layer, comp);
    return VN.itemResult("updated", null, meta.instanceId, layer.name + "：已更新。", layer, meta.eventId);
  } catch (err) {
    try {
      VN.restoreAnimators(layer, comp, saved);
      layer.comment = previous;
    } catch (rollback) {
      return VN.itemResult("failed", "rollback_failed", meta.instanceId, layer.name + "：恢复失败。" + rollback.toString(), layer, meta.eventId);
    }
    return VN.itemResult("failed", "write_failed", meta.instanceId, layer.name + "：写入失败，已恢复。" + err.toString(), layer, meta.eventId);
  }
};

VN.rebuildLegacy = function (target) {
  var layer = target.layer;
  var comp = target.comp;
  var meta = VN.readMeta(layer.comment);
  if (meta.preset !== "typewriter" && meta.preset !== "lines") {
    return VN.itemResult("skipped", "unsupported_schema", meta.instanceId, layer.name + "：这个效果不能按新文案重建。", layer, meta.eventId);
  }
  var start = VN.findRevealStart(layer);
  if (!start || !VN.keysMatch(VN.readScalarKeys(start, comp), meta.reveal)) {
    return VN.itemResult("skipped", "manual_edit", meta.instanceId, layer.name + "：动画已被手动修改，已跳过。", layer, meta.eventId);
  }
  var timingInfo = VN.instanceTiming(meta.instanceId);
  if (!timingInfo) return VN.itemResult("failed", "unsupported_schema", meta.instanceId, layer.name + "：找不到节奏参数。", layer, meta.eventId);
  var raw = VN.readBaseText(layer);
  var plan = VN.planCharacters(raw, timingInfo.timing, timingInfo.fps);
  var needed = meta.preset === "lines" ? plan.lineRevealFrames : plan.typewriterRevealFrames;
  if (meta.eventFrames !== undefined && needed > meta.eventFrames) {
    return VN.itemResult("skipped", "insufficient_duration", meta.instanceId, "未更新：这段文字需要更长的显示时间。请延长片段后重试。", layer, meta.eventId);
  }
  var saved = VN.snapshotAnimators(layer, comp);
  var previous = layer.comment;
  try {
    var frames = meta.preset === "lines" ? plan.lineFrames : plan.revealFrames;
    var keys = VN.scaleKeyframeSpacing(VN.revealKeyframes(frames, meta.holdIn || 0), meta.speedScale || 1);
    VN.applyScalarKeys(start, comp, keys);
    meta.reveal = VN.compactKeys(keys);
    VN.writeMeta(layer, meta);
    return VN.itemResult("updated", null, meta.instanceId, layer.name + "：已更新。", layer, meta.eventId);
  } catch (err) {
    try {
      VN.restoreAnimators(layer, comp, saved);
      layer.comment = previous;
    } catch (rollback) {
      return VN.itemResult("failed", "rollback_failed", meta.instanceId, layer.name + "：恢复失败。", layer, meta.eventId);
    }
    return VN.itemResult("failed", "write_failed", meta.instanceId, layer.name + "：写入失败，已恢复。", layer, meta.eventId);
  }
};

VN.executeRebuild = function (lock) {
  if (!lock || !lock.instanceId) return VN.finishOperation("rebuild", [VN.itemResult("failed", "missing_target", "", "没有可更新的文字。")]);
  if (!VN.lockMatches(lock)) return VN.finishOperation("rebuild", [VN.itemResult("failed", "stale_context", lock.instanceId, "片段已变化，请重试。")]);
  var active = app.project.activeItem;
  var targets = VN.supportedSelection(active);
  var mine = [];
  var i;
  for (i = 0; i < targets.length; i++) if (targets[i].meta.instanceId === lock.instanceId) mine.push(targets[i]);
  if (!mine.length) return VN.finishOperation("rebuild", [VN.itemResult("failed", "missing_target", lock.instanceId, "没有可更新的文字。")]);
  var items = [];
  app.beginUndoGroup("VN 更新文字动画");
  try {
    for (i = 0; i < mine.length; i++) {
      if (!VN.lockMatches(lock)) {
        items.push(VN.itemResult("failed", "stale_context", lock.instanceId, "片段已变化，请重试。", mine[i].layer));
        break;
      }
      var meta = mine[i].meta;
      if (meta.effect === "typewriter" || meta.effect === "characterFade") items.push(VN.rebuildModern(mine[i]));
      else items.push(VN.rebuildLegacy(mine[i]));
    }
  } finally {
    app.endUndoGroup();
  }
  return VN.finishOperation("rebuild", items);
};

VN.executeEffect = function (lock, effect) {
  if (effect !== "typewriter" && effect !== "characterFade") {
    return VN.finishOperation("effect", [VN.itemResult("failed", "invalid_input", lock ? lock.instanceId : "", "未知的动画效果。")]);
  }
  if (!lock || !VN.lockMatches(lock)) return VN.finishOperation("effect", [VN.itemResult("failed", "stale_context", "", "片段已变化，请重试。")]);
  var caps = VN.capabilitiesFor(lock.instanceId);
  if (!caps.effect) return VN.finishOperation("effect", [VN.itemResult("failed", "unsupported_schema", lock.instanceId, "这个片段没有效果基准，不能切换效果。")]);
  var targets = VN.modernTextLayers(lock.instanceId);
  if (!targets.length) return VN.finishOperation("effect", [VN.itemResult("skipped", "missing_target", lock.instanceId, "没有可切换的文字。")]);
  var items = [];
  var updated = 0;
  app.beginUndoGroup("VN 切换文字效果");
  try {
    var i;
    for (i = 0; i < targets.length; i++) {
      var target = targets[i];
      var meta = VN.readMeta(target.layer.comment);
      if (VN.foreignAnimatorConflict(target.layer) || VN.animationChanged(target.layer, target.comp, meta)) {
        items.push(VN.itemResult("skipped", "manual_edit", lock.instanceId, target.layer.name + "：保留原效果。", target.layer, meta.eventId));
        continue;
      }
      var time = VN.availableFrames(target.layer, target.comp, lock.instanceId);
      if (!time.ok) {
        items.push(VN.itemResult("skipped", time.reason, lock.instanceId, target.layer.name + "：保留原效果。", target.layer, meta.eventId));
        continue;
      }
      var located = VN.eventBaseline(lock.instanceId, meta.eventId);
      if (!located || !located.event) {
        items.push(VN.itemResult("skipped", "unsupported_schema", lock.instanceId, target.layer.name + "：保留原效果。", target.layer, meta.eventId));
        continue;
      }
      var text = VN.readBaseText(target.layer);
      var pauses = VN.pausesForText(text, located.baseline.commaPauseFrames || 0, located.baseline.sentencePauseFrames || 0);
      var timing = {
        charactersPerSecond: located.event.charactersPerSecond,
        fps: located.baseline.fps,
        holdInFrames: located.event.animationStartFrame || 0,
        characterFadeFrames: located.event.characterFadeFrames || 0,
        pauses: pauses
      };
      var plan = VN.buildAnimationPlan(text, effect, caps.speedValue || 1, timing, time.frames);
      if (!plan.fits) {
        items.push(VN.itemResult("skipped", "insufficient_duration", lock.instanceId, target.layer.name + "：显示时间不够，保留原效果。", target.layer, meta.eventId));
        continue;
      }
      var saved = VN.snapshotAnimators(target.layer, target.comp);
      var previous = target.layer.comment;
      try {
        VN.writePlan(target.layer, target.comp, plan);
        var basePlan = VN.buildAnimationPlan(text, effect, 1, timing, time.frames);
        meta.effect = effect;
        meta.preset = effect === "characterFade" ? "characterFade" : "typewriter";
        meta.reveal = VN.compactKeys(basePlan.revealKeys);
        meta.baseline = meta.baseline || {};
        meta.baseline.fadeTracks = effect === "characterFade" ? basePlan.fadeTracks : [];
        meta.current = meta.current || {};
        meta.current.effect = effect;
        VN.writeMeta(target.layer, meta);
        VN.sealLayerRecord(target.layer, target.comp);
        updated += 1;
        items.push(VN.itemResult("updated", null, lock.instanceId, target.layer.name + "：已切换效果。", target.layer, meta.eventId));
      } catch (err) {
        try {
          VN.restoreAnimators(target.layer, target.comp, saved);
          target.layer.comment = previous;
          items.push(VN.itemResult("failed", "write_failed", lock.instanceId, target.layer.name + "：写入失败，已恢复。", target.layer, meta.eventId));
        } catch (rollback) {
          items.push(VN.itemResult("failed", "rollback_failed", lock.instanceId, target.layer.name + "：恢复失败。", target.layer, meta.eventId));
        }
      }
    }
    if (updated) {
      var folder = VN.instanceFolderMeta(lock.instanceId);
      if (folder) {
        folder.meta.current = folder.meta.current || {};
        folder.meta.current.defaultEffect = effect;
        folder.meta.current.revision = (folder.meta.current.revision || 1) + 1;
        VN.writeMeta(folder.item, folder.meta);
      }
    }
  } finally {
    app.endUndoGroup();
  }
  return VN.finishOperation("effect", items, { defaultEffect: effect });
};

VN.classifyLayer = function (layer, meta) {
  if (meta && meta.dependency === "nonsync-music") return "nonsync-music";
  var source = null;
  try {
    source = layer.source;
  } catch (ignore) {}
  if (source && source.mainSource && source.mainSource.isStill === false) return "video";
  try {
    if (layer.hasAudio && (!meta || meta.dependency !== "nonsync-music")) return "sync";
  } catch (ignoreAudio) {}
  if (!meta) return "unclassified";
  return "managed";
};

VN.speedPreflight = function (instanceId, speed, currentSpeed) {
  if (!(speed >= 0.5 && speed <= 2)) return { ok: false, reason: "invalid_input", message: "速度需要在 0.5 到 2 之间。" };
  if (Math.abs(speed - currentSpeed) < 0.001) return { ok: false, reason: "no_change", message: "速度没有变化。" };
  var comps = VN.compsForInstance(instanceId);
  var i;
  for (i = 0; i < comps.length; i++) {
    var meta = comps[i].meta;
    if (!VN.timedLogical(meta.logicalId)) continue;
    if (meta.logicalId !== "master") {
      var hosts = VN.externalHosts(comps[i].comp, instanceId);
      if (hosts.length) return { ok: false, reason: "unsupported_dependency", message: "未调整速度：" + comps[i].comp.name + " 被片段外的合成复用。" };
    }
    var n;
    for (n = 1; n <= comps[i].comp.numLayers; n++) {
      var layer = comps[i].comp.layer(n);
      var layerMeta = VN.readMeta(layer.comment);
      var kind = VN.classifyLayer(layer, layerMeta);
      if (kind === "video") return { ok: false, reason: "unsupported_dependency", message: "未调整速度：" + layer.name + " 是视频，当前版本不能伸缩时间。" };
      if (kind === "sync" && Math.abs(speed - 1) > 0.001) {
        return { ok: false, reason: "unsupported_dependency", message: "未调整速度：此片段包含同步配音，当前版本不支持同步变速。" };
      }
      if (kind === "unclassified") return { ok: false, reason: "unsupported_dependency", message: "未调整速度：无法确认 " + layer.name + " 能否安全变速。" };
      if (layerMeta && layerMeta.v === 3 && VN.timingChanged(layer, comps[i].comp, layerMeta)) {
        return { ok: false, reason: "manual_edit", message: "未调整速度：发现手动调整的事件，片段保持原样。" };
      }
      if (layerMeta && layerMeta.v === 3 && VN.animationChanged(layer, comps[i].comp, layerMeta)) {
        return { ok: false, reason: "manual_edit", message: "未调整速度：发现手动调整的事件，片段保持原样。" };
      }
      var remap = false;
      try {
        remap = !!layer.timeRemapEnabled;
      } catch (ignore) {}
      if (remap || Math.abs(layer.stretch - 100) > 0.01) {
        return { ok: false, reason: "unreliable_time", message: "未调整速度：时间结构无法可靠换算，片段保持原样。" };
      }
    }
  }
  return { ok: true, reason: null, message: "" };
};

VN.externalHosts = function (comp, instanceId) {
  var hosts = [];
  var i;
  for (i = 1; i <= app.project.numItems; i++) {
    var item = app.project.item(i);
    if (!(item instanceof CompItem)) continue;
    var meta = VN.readMeta(item.comment);
    if (meta && meta.instanceId === instanceId) continue;
    var n;
    for (n = 1; n <= item.numLayers; n++) {
      try {
        if (item.layer(n).source === comp) hosts.push(item);
      } catch (ignore) {}
    }
  }
  return hosts;
};

VN.mapLocalFrame = function (origin, frame, speed) {
  return Math.round((origin + frame) / speed) - Math.round(origin / speed);
};

VN.compOrigin = function (logicalId, baseline) {
  if (!logicalId || logicalId === "master" || logicalId === "overlay") return 0;
  var id = logicalId;
  if (id.indexOf("event:") === 0) id = id.substring(6);
  if (id.indexOf("scene:") === 0) id = id.substring(6);
  var deps = baseline.dependencies || [];
  var i;
  for (i = 0; i < deps.length; i++) if (deps[i].id === id) return deps[i].startFrame || 0;
  return 0;
};

VN.mappedCompFrames = function (compMeta, baseline, speed) {
  var duration = compMeta.baseline ? compMeta.baseline.durationFrames : null;
  if (compMeta.logicalId === "master" || compMeta.logicalId === "overlay") duration = baseline.masterDurationFrames;
  if (duration === null || duration === undefined) return null;
  return VN.mapLocalFrame(VN.compOrigin(compMeta.logicalId, baseline), duration, speed);
};

VN.snapshotSpeed = function (instanceId) {
  var shots = [];
  var comps = VN.compsForInstance(instanceId);
  var i;
  for (i = 0; i < comps.length; i++) {
    if (!VN.timedLogical(comps[i].meta.logicalId)) continue;
    var comp = comps[i].comp;
    var layers = [];
    var n;
    for (n = 1; n <= comp.numLayers; n++) {
      var layer = comp.layer(n);
      var opacity = null;
      try {
        opacity = VN.opacityProp(layer);
      } catch (ignore) {}
      layers.push({
        layer: layer,
        inPoint: layer.inPoint,
        outPoint: layer.outPoint,
        startTime: layer.startTime,
        comment: layer.comment,
        animators: VN.snapshotAnimators(layer, comp),
        opacity: opacity ? VN.readScalarKeys(opacity, comp) : null
      });
    }
    shots.push({
      comp: comp,
      meta: comps[i].meta,
      duration: comp.duration,
      workStart: comp.workAreaStart,
      workDuration: comp.workAreaDuration,
      comment: comp.comment,
      layers: layers
    });
  }
  var folder = VN.instanceFolderMeta(instanceId);
  return { shots: shots, folderComment: folder ? folder.item.comment : "" };
};

VN.restoreSpeed = function (snapshot) {
  var i;
  for (i = 0; i < snapshot.shots.length; i++) {
    var shot = snapshot.shots[i];
    shot.comp.duration = shot.duration;
    try {
      shot.comp.workAreaStart = shot.workStart;
      shot.comp.workAreaDuration = shot.workDuration;
    } catch (ignoreWork) {}
    shot.comp.comment = shot.comment;
    var n;
    for (n = 0; n < shot.layers.length; n++) {
      var layerShot = shot.layers[n];
      layerShot.layer.startTime = layerShot.startTime;
      layerShot.layer.inPoint = layerShot.inPoint;
      layerShot.layer.outPoint = layerShot.outPoint;
      layerShot.layer.comment = layerShot.comment;
      if (layerShot.opacity && layerShot.opacity.length) {
        try {
          VN.applyScalarKeysKeepingExpression(VN.opacityProp(layerShot.layer), shot.comp, layerShot.opacity);
        } catch (ignoreOpacity) {}
      }
      VN.restoreAnimators(layerShot.layer, shot.comp, layerShot.animators);
    }
  }
};

VN.mappedFrameTime = function (comp, frame, shared) {
  return VN.lookupFrame(shared, frame) * comp.frameDuration;
};

VN.executeSpeed = function (lock, speed) {
  speed = Math.round(Number(speed) * 100) / 100;
  if (!lock || !lock.instanceId) return VN.finishOperation("speed", [VN.itemResult("failed", "missing_target", "", "请先打开一个生成片段。")]);
  var caps = VN.capabilitiesFor(lock.instanceId);
  if (!caps.speed) return VN.finishOperation("speed", [VN.itemResult("failed", "unsupported_schema", lock.instanceId, "这个片段没有时间基准，不能调整速度。")]);
  var check = VN.speedPreflight(lock.instanceId, speed, caps.speedValue);
  if (!check.ok) return VN.finishOperation("speed", [VN.itemResult(check.reason === "no_change" ? "skipped" : "failed", check.reason, lock.instanceId, check.message)]);
  if (!VN.lockMatches(lock)) return VN.finishOperation("speed", [VN.itemResult("failed", "stale_context", lock.instanceId, "片段已变化，请重试。")]);
  var folder = VN.instanceFolderMeta(lock.instanceId);
  var baseline = folder.meta.baseline;
  var frames = [0, baseline.masterDurationFrames];
  var e;
  for (e = 0; e < baseline.events.length; e++) {
    frames.push(baseline.events[e].startFrame);
    frames.push(baseline.events[e].startFrame + baseline.events[e].durationFrames);
  }
  for (e = 0; e < baseline.dependencies.length; e++) {
    frames.push(baseline.dependencies[e].startFrame);
    frames.push(baseline.dependencies[e].startFrame + baseline.dependencies[e].durationFrames);
  }
  var shared = VN.mapBaselineFrames(frames, speed);
  var masterFrames = VN.lookupFrame(shared, baseline.masterDurationFrames) - VN.lookupFrame(shared, 0);
  var snapshot = VN.snapshotSpeed(lock.instanceId);
  var external = [];
  app.beginUndoGroup("VN 调整播放速度");
  try {
    var comps = VN.compsForInstance(lock.instanceId);
    var i;
    for (i = 0; i < comps.length; i++) {
      var compMeta = comps[i].meta;
      if (!VN.timedLogical(compMeta.logicalId)) continue;
      var comp = comps[i].comp;
      var baseDuration = VN.mappedCompFrames(compMeta, baseline, speed);
        if (baseDuration !== null) {
        var nextDuration = baseDuration * comp.frameDuration;
        var covered = comp.workAreaStart <= comp.frameDuration && Math.abs(comp.workAreaStart + comp.workAreaDuration - comp.duration) <= comp.frameDuration * 2;
        if (nextDuration < comp.duration && !covered) {
          var room = nextDuration - comp.workAreaStart;
          if (room < comp.frameDuration) room = comp.frameDuration;
          comp.workAreaDuration = room;
        }
        comp.duration = Math.max(comp.frameDuration, nextDuration);
        if (covered) {
          comp.workAreaStart = 0;
          comp.workAreaDuration = comp.duration;
        }
      }
      if (compMeta.logicalId === "master") external = VN.externalHosts(comp, lock.instanceId);
      var n;
      for (n = 1; n <= comp.numLayers; n++) {
        var layer = comp.layer(n);
        var layerMeta = VN.readMeta(layer.comment);
        if (!layerMeta || !layerMeta.baseline) continue;
        VN.applyLayerSpeed(layer, comp, layerMeta, speed, VN.compOrigin(compMeta.logicalId, baseline));
      }
    }
    folder.meta.current = folder.meta.current || {};
    folder.meta.current.speed = speed;
    folder.meta.current.revision = (folder.meta.current.revision || 1) + 1;
    VN.writeMeta(folder.item, folder.meta);
    var master = VN.masterCompFor(lock.instanceId);
    if (!master || Math.abs(Math.round(master.duration / master.frameDuration) - masterFrames) > 1) {
      throw new Error("写入后的长度和计划不一致");
    }
  } catch (err) {
    try {
      VN.restoreSpeed(snapshot);
      if (folder) folder.item.comment = snapshot.folderComment;
    } catch (rollback) {
      return VN.finishOperation("speed", [VN.itemResult("failed", "rollback_failed", lock.instanceId, VN.closeUndoGroup("速度调整失败，而且未能恢复。" + rollback.toString()))]);
    }
    return VN.finishOperation("speed", [VN.itemResult("failed", "write_failed", lock.instanceId, VN.closeUndoGroup("未调整速度：写入失败，片段已恢复。" + err.toString()))]);
  }
  app.endUndoGroup();
  var message = "速度已调整为 " + speed + " 倍。";
  if (external.length) message += "片段已延长；外部时间轴中的引用可能需要延长出点。";
  var result = VN.finishOperation("speed", [VN.itemResult("updated", null, lock.instanceId, message)], { appliedSpeed: speed, durationFrames: masterFrames });
  result.message = message;
  return result;
};

VN.applyLayerSpeed = function (layer, comp, meta, speed, origin) {
  var base = meta.baseline;
  if (base.outFrame === null || base.outFrame === undefined) {
    if (!base.inFrame) layer.outPoint = comp.duration;
  } else {
    var startFrame = base.startFrame === undefined || base.startFrame === null ? base.inFrame : base.startFrame;
    layer.startTime = VN.mapLocalFrame(origin, startFrame, speed) * comp.frameDuration;
    layer.inPoint = VN.mapLocalFrame(origin, base.inFrame, speed) * comp.frameDuration;
    layer.outPoint = VN.mapLocalFrame(origin, base.outFrame, speed) * comp.frameDuration;
  }
  if (base.opacity && base.opacity.length) {
    var opacity = VN.opacityProp(layer);
    VN.applyScalarKeysKeepingExpression(opacity, comp, VN.scaleStoredKeys(base.opacity, speed, origin));
  }
  if (base.position && base.position.length) VN.applyStoredPosition(layer, comp, base.position, speed, origin);
  if (meta.effect === "characterFade" && base.fadeTracks && base.fadeTracks.length) {
    var faded = VN.buildStoredFade(base.fadeTracks, speed, origin);
    VN.removeManagedAnimators(layer);
    var i;
    for (i = 0; i < faded.length; i++) {
      VN.installFadeAnimator(layer, comp, {
        name: "VN_FADE_" + i,
        aeIndex: faded[i].aeIndex,
        aeLength: faded[i].aeLength,
        opacityKeys: faded[i].keys
      });
    }
  } else if (base.reveal && base.reveal.length && (meta.effect === "typewriter" || meta.preset === "typewriter" || meta.preset === "lines")) {
    var startProp = VN.findRevealStart(layer);
    var keys = VN.scaleStoredKeys(base.reveal, speed, origin);
    if (!startProp) VN.installRevealKeys(layer, comp, keys);
    else VN.applyScalarKeys(startProp, comp, keys);
  }
  meta.current = meta.current || {};
  meta.current.speed = speed;
  VN.writeMeta(layer, meta);
  VN.sealLayerRecord(layer, comp);
};

VN.applyStoredPosition = function (layer, comp, compact, speed, origin) {
  var position = VN.requireProp(VN.requireProp(layer, "ADBE Transform Group"), "ADBE Position");
  if (position.expression) position.expression = "";
  VN.clearKeys(position);
  var i;
  for (i = 0; i < compact.length; i++) {
    position.setValueAtTime(VN.mapLocalFrame(origin, compact[i][0], speed) * comp.frameDuration, [compact[i][1], compact[i][2]]);
  }
  for (i = 0; i < compact.length; i++) {
    var interp = compact[i][3] === "hold" ? KeyframeInterpolationType.HOLD : KeyframeInterpolationType.LINEAR;
    position.setInterpolationTypeAtKey(i + 1, interp, interp);
  }
};

VN.scaleStoredKeys = function (compact, speed, origin) {
  var keys = [];
  var i;
  for (i = 0; i < compact.length; i++) {
    keys.push({ frame: VN.mapLocalFrame(origin || 0, compact[i][0], speed), value: compact[i][1], interpolation: compact[i][2] || "hold" });
  }
  return keys;
};

VN.buildStoredFade = function (tracks, speed, origin) {
  var out = [];
  var i;
  var n;
  for (i = 0; i < tracks.length; i++) {
    var keys = [];
    for (n = 0; n < tracks[i].keys.length; n++) {
      keys.push({
        frame: VN.mapLocalFrame(origin || 0, tracks[i].keys[n].frame, speed),
        value: tracks[i].keys[n].value,
        interpolation: tracks[i].keys[n].interpolation || "linear"
      });
    }
    out.push({ aeIndex: tracks[i].aeIndex, aeLength: tracks[i].aeLength, keys: keys });
  }
  return out;
};

VN.readStyleDocument = function (layer) {
  var source = VN.requireProp(VN.requireProp(layer, "ADBE Text Properties"), "ADBE Text Document");
  var value = source.value;
  return {
    source: source,
    font: value.font,
    fontSize: value.fontSize,
    autoLeading: !!value.autoLeading,
    leading: value.leading,
    fillColor: [value.fillColor[0], value.fillColor[1], value.fillColor[2]]
  };
};

VN.applyStylePatch = function (lock, layers, patch) {
  if (!lock || !VN.lockMatches(lock)) return VN.finishOperation("style", [VN.itemResult("failed", "stale_context", lock ? lock.instanceId : "", "片段已变化，请重试。")]);
  if (!layers.length) return VN.finishOperation("style", [VN.itemResult("failed", "missing_target", lock.instanceId, "找不到要修改的样式层。")]);
  if (patch.fontSize !== undefined && !(patch.fontSize > 0)) {
    return VN.finishOperation("style", [VN.itemResult("failed", "invalid_input", lock.instanceId, "字号必须大于 0。")]);
  }
  if (patch.leading && patch.leading.mode === "explicit" && !(patch.leading.value > 0)) {
    return VN.finishOperation("style", [VN.itemResult("failed", "invalid_input", lock.instanceId, "行距必须大于 0。")]);
  }
  var snapshots = [];
  var i;
  for (i = 0; i < layers.length; i++) {
    if (!layers[i] || !(layers[i] instanceof TextLayer)) {
      return VN.finishOperation("style", [VN.itemResult("failed", "missing_target", lock.instanceId, "样式层已经不存在。")]);
    }
    snapshots.push(VN.readStyleDocument(layers[i]));
  }
  app.beginUndoGroup("VN 修改文字样式");
  try {
    for (i = 0; i < layers.length; i++) {
      var prop = snapshots[i].source;
      var doc = prop.value;
      if (patch.font !== undefined) doc.font = patch.font;
      if (patch.fontSize !== undefined) doc.fontSize = patch.fontSize;
      if (patch.leading) {
        if (patch.leading.mode === "auto") doc.autoLeading = true;
        else {
          doc.autoLeading = false;
          doc.leading = patch.leading.value;
        }
      }
      if (patch.fillColor) {
        doc.applyFill = true;
        doc.fillColor = [patch.fillColor[0], patch.fillColor[1], patch.fillColor[2]];
      }
      prop.setValue(doc);
    }
  } catch (err) {
    try {
      for (i = 0; i < snapshots.length; i++) {
        var current = snapshots[i].source.value;
        current.font = snapshots[i].font;
        current.fontSize = snapshots[i].fontSize;
        current.autoLeading = snapshots[i].autoLeading;
        current.leading = snapshots[i].leading;
        current.applyFill = true;
        current.fillColor = snapshots[i].fillColor;
        snapshots[i].source.setValue(current);
      }
    } catch (rollback) {
      return VN.finishOperation("style", [VN.itemResult("failed", "rollback_failed", lock.instanceId, VN.closeUndoGroup("样式恢复失败。" + rollback.toString()))]);
    }
    return VN.finishOperation("style", [VN.itemResult("failed", "write_failed", lock.instanceId, VN.closeUndoGroup("样式没有写入，已恢复。" + err.toString()))]);
  }
  app.endUndoGroup();
  return VN.finishOperation("style", [VN.itemResult("updated", null, lock.instanceId, "样式已更新。")]);
};

var VN = VN || {};

VN.compByLogical = function (instanceId, logicalId) {
  var i;
  for (i = 1; i <= app.project.numItems; i++) {
    var item = app.project.item(i);
    if (!(item instanceof CompItem)) continue;
    var meta = VN.readMeta(item.comment);
    if (meta && meta.instanceId === instanceId && meta.logicalId === logicalId) return item;
  }
  return null;
};

VN.styleTargets = function (instanceId, scope) {
  var logicals = ["style:dialogue", "style:narration", "style:option"];
  if (scope === "dialogue") logicals = ["style:dialogue"];
  if (scope === "narration") logicals = ["style:narration"];
  if (scope === "option") logicals = ["style:option"];
  var layers = [];
  var i;
  for (i = 0; i < logicals.length; i++) {
    var comp = VN.compByLogical(instanceId, logicals[i]);
    if (!comp) continue;
    var n;
    for (n = 1; n <= comp.numLayers; n++) {
      if (comp.layer(n).name === "STYLE") layers.push(comp.layer(n));
    }
  }
  return layers;
};

VN.scopeInfluence = function (scope) {
  if (scope === "dialogue") return "影响此片段中的对白";
  if (scope === "narration") return "影响此片段中的旁白";
  if (scope === "option") return "影响此片段中的选项";
  return "影响此片段中的全部文字";
};

VN.colorHex = function (color) {
  function part(value) {
    var num = Math.round(Math.max(0, Math.min(1, value)) * 255);
    var hex = num.toString(16);
    return hex.length < 2 ? "0" + hex : hex;
  }
  return "#" + part(color[0]) + part(color[1]) + part(color[2]);
};

VN.parseHexColor = function (text) {
  var value = String(text || "").replace(/^\s+|\s+$/g, "");
  if (value.charAt(0) === "#") value = value.substring(1);
  if (value.length !== 6) return null;
  var i;
  for (i = 0; i < 6; i++) {
    var code = value.charCodeAt(i);
    var ok = (code >= 48 && code <= 57) || (code >= 65 && code <= 70) || (code >= 97 && code <= 102);
    if (!ok) return null;
  }
  return [parseInt(value.substring(0, 2), 16) / 255, parseInt(value.substring(2, 4), 16) / 255, parseInt(value.substring(4, 6), 16) / 255];
};

VN.revealStyleLayer = function (instanceId, scope) {
  var logical = "style:dialogue";
  if (scope === "narration") logical = "style:narration";
  if (scope === "option") logical = "style:option";
  var comp = VN.compByLogical(instanceId, logical);
  if (!comp) return false;
  comp.openInViewer();
  var i;
  for (i = 1; i <= comp.numLayers; i++) comp.layer(i).selected = comp.layer(i).name === "STYLE";
  return true;
};

VN.fontNames = function () {
  var names = [];
  try {
    if (!(app.fonts && app.fonts.allFonts)) return names;
    var fonts = app.fonts.allFonts;
    var i;
    for (i = 0; i < fonts.length; i++) {
      var name = fonts[i].postScriptName || fonts[i].name;
      if (name) names.push(String(name));
    }
  } catch (ignore) {}
  return names;
};

VN.openStyleEditor = function (instanceId) {
  var caps = VN.capabilitiesFor(instanceId);
  if (caps.style !== "editor") {
    var legacy = VN.openLogicalComp(instanceId, "global:control");
    return { ok: legacy.ok, message: legacy.ok ? "已打开原有样式控制" : legacy.message };
  }
  var lock = VN.captureLock(instanceId);
  var folder = VN.instanceFolderMeta(instanceId);
  var display = folder && folder.meta.displayName ? folder.meta.displayName : instanceId;
  var win = new Window("dialog", "文字样式");
  win.orientation = "column";
  win.alignChildren = ["fill", "top"];
  win.margins = 12;
  win.spacing = 8;
  win.preferredSize.width = 340;
  win.add("statictext", undefined, "修改：" + display);
  var influence = win.add("statictext", undefined, "影响此片段中的全部文字", { multiline: true });
  influence.preferredSize.height = 32;
  var scopeList = win.add("dropdownlist", undefined, ["全部文字", "对白", "旁白", "选项"]);
  scopeList.selection = 0;
  var fontLabel = win.add("statictext", undefined, "字体");
  var fontList = win.add("dropdownlist", undefined, ["当前字体"]);
  var fontStatic = win.add("statictext", undefined, "", { multiline: true });
  var fontButton = win.add("button", undefined, "在 AE 字符面板修改字体");
  var sizeLabel = win.add("statictext", undefined, "字号");
  var sizeText = win.add("edittext", undefined, "");
  var leadingLabel = win.add("statictext", undefined, "行距");
  var leadingMode = win.add("dropdownlist", undefined, ["自动行距", "指定行距"]);
  var leadingText = win.add("edittext", undefined, "");
  var colorLabel = win.add("statictext", undefined, "颜色");
  var colorText = win.add("edittext", undefined, "");
  var row = win.add("group");
  row.orientation = "row";
  row.alignChildren = ["fill", "center"];
  var applyButton = row.add("button", undefined, "应用");
  var closeButton = row.add("button", undefined, "关闭");
  var dirty = { font: false, fontSize: false, leading: false, color: false };
  var filling = false;
  var fonts = VN.fontNames();
  var canListFonts = fonts.length > 0;
  fontList.visible = canListFonts;
  fontStatic.visible = !canListFonts;

  function scopeName() {
    if (!scopeList.selection || scopeList.selection.index === 0) return "all";
    if (scopeList.selection.index === 1) return "dialogue";
    if (scopeList.selection.index === 2) return "narration";
    return "option";
  }

  function hasDirty() {
    return dirty.font || dirty.fontSize || dirty.leading || dirty.color;
  }

  function fill() {
    filling = true;
    dirty = { font: false, fontSize: false, leading: false, color: false };
    var scope = scopeName();
    influence.text = VN.scopeInfluence(scope);
    var layers = VN.styleTargets(lock.instanceId, scope);
    if (!layers.length) {
      sizeText.text = "";
      colorText.text = "";
      filling = false;
      return;
    }
    var docs = [];
    var i;
    for (i = 0; i < layers.length; i++) docs.push(VN.readStyleDocument(layers[i]));
    var fontValue = docs[0].font;
    var sizeValue = String(docs[0].fontSize);
    var leadMode = docs[0].autoLeading ? "自动行距" : "指定行距";
    var leadValue = String(docs[0].leading);
    var colorValue = VN.colorHex(docs[0].fillColor);
    for (i = 1; i < docs.length; i++) {
      if (docs[i].font !== docs[0].font) fontValue = "多种值";
      if (String(docs[i].fontSize) !== String(docs[0].fontSize)) sizeValue = "多种值";
      var mode = docs[i].autoLeading ? "自动行距" : "指定行距";
      if (mode !== leadMode || String(docs[i].leading) !== String(docs[0].leading)) {
        leadMode = "多种值";
        leadValue = "多种值";
      }
      if (VN.colorHex(docs[i].fillColor) !== colorValue) colorValue = "多种值";
    }
    if (canListFonts) {
      fontList.removeAll();
      if (fontValue === "多种值") fontList.add("item", "多种值");
      for (i = 0; i < fonts.length; i++) fontList.add("item", fonts[i]);
      var picked = 0;
      for (i = 0; i < fontList.items.length; i++) if (fontList.items[i].text === fontValue) picked = i;
      fontList.selection = picked;
    } else {
      fontStatic.text = fontValue;
    }
    sizeText.text = sizeValue;
    if (leadMode === "多种值") {
      leadingMode.selection = 0;
      leadingText.text = "多种值";
    } else {
      leadingMode.selection = leadMode === "自动行距" ? 0 : 1;
      leadingText.text = docs[0].autoLeading ? "" : leadValue;
    }
    colorText.text = colorValue;
    filling = false;
  }

  function askSwitch() {
    var ask = new Window("dialog", "未应用的修改");
    ask.orientation = "column";
    ask.alignChildren = ["fill", "top"];
    ask.add("statictext", undefined, "切换作用对象前，当前修改还没有应用。", { multiline: true });
    var buttons = ask.add("group");
    var apply = buttons.add("button", undefined, "应用后切换");
    var drop = buttons.add("button", undefined, "放弃修改");
    var stay = buttons.add("button", undefined, "继续编辑");
    var choice = "stay";
    apply.onClick = function () { choice = "apply"; ask.close(); };
    drop.onClick = function () { choice = "drop"; ask.close(); };
    stay.onClick = function () { choice = "stay"; ask.close(); };
    ask.show();
    return choice;
  }

  var previousScope = 0;
  scopeList.onChange = function () {
    if (filling) return;
    if (scopeList.selection && scopeList.selection.index === previousScope) return;
    if (hasDirty()) {
      var choice = askSwitch();
      if (choice === "stay") {
        filling = true;
        scopeList.selection = previousScope;
        filling = false;
        return;
      }
      if (choice === "apply") {
        var applied = commit();
        if (!applied) {
          filling = true;
          scopeList.selection = previousScope;
          filling = false;
          return;
        }
      }
    }
    previousScope = scopeList.selection ? scopeList.selection.index : 0;
    fill();
  };
  fontList.onChange = function () { if (!filling) dirty.font = true; };
  sizeText.onChanging = function () { if (!filling) dirty.fontSize = true; };
  leadingMode.onChange = function () { if (!filling) dirty.leading = true; };
  leadingText.onChanging = function () { if (!filling) dirty.leading = true; };
  colorText.onChanging = function () { if (!filling) dirty.color = true; };
  fontButton.onClick = function () {
    var scope = scopeName();
    if (scope === "all") {
      alert("每一类文字使用自己的样式层。接下来定位对白样式层；旁白和选项需要分别打开。");
      VN.revealStyleLayer(lock.instanceId, "dialogue");
      return;
    }
    VN.revealStyleLayer(lock.instanceId, scope);
  };

  function commit() {
    if (!VN.lockMatches(lock)) {
      alert("片段已变化，请关闭窗口后重试。");
      return false;
    }
    var patch = {};
    if (dirty.font && canListFonts && fontList.selection && fontList.selection.text !== "多种值") patch.font = fontList.selection.text;
    if (dirty.font && canListFonts && fontList.selection && fontList.selection.text === "多种值") {
      alert("字体仍是多种值，不能写回。");
      return false;
    }
    if (dirty.fontSize) {
      if (sizeText.text === "多种值") {
        alert("字号仍是多种值，不能写回。");
        return false;
      }
      var size = parseFloat(sizeText.text);
      if (!(size > 0)) {
        alert("字号必须大于 0。");
        return false;
      }
      patch.fontSize = size;
    }
    if (dirty.leading) {
      if (leadingText.text === "多种值") {
        alert("行距仍是多种值，不能写回。");
        return false;
      }
      if (leadingMode.selection && leadingMode.selection.index === 0) patch.leading = { mode: "auto" };
      else {
        var leading = parseFloat(leadingText.text);
        if (!(leading > 0)) {
          alert("行距必须大于 0。");
          return false;
        }
        patch.leading = { mode: "explicit", value: leading };
      }
    }
    if (dirty.color) {
      if (colorText.text === "多种值") {
        alert("颜色仍是多种值，不能写回。");
        return false;
      }
      var color = VN.parseHexColor(colorText.text);
      if (!color) {
        alert("颜色请使用 #RRGGBB。");
        return false;
      }
      patch.fillColor = color;
    }
    if (!patch.font && patch.fontSize === undefined && !patch.leading && !patch.fillColor) return true;
    var layers = VN.styleTargets(lock.instanceId, scopeName());
    var result = VN.applyStylePatch(lock, layers, patch);
    if (result.status !== "updated") {
      alert(result.message);
      return false;
    }
    lock = VN.captureLock(instanceId);
    dirty = { font: false, fontSize: false, leading: false, color: false };
    return true;
  }

  applyButton.onClick = function () {
    if (commit()) fill();
  };
  closeButton.onClick = function () {
    if (hasDirty()) {
      var choice = askSwitch();
      if (choice === "stay") return;
      if (choice === "apply" && !commit()) return;
    }
    win.close();
  };
  fill();
  win.show();
  return { ok: true, message: "样式窗口已关闭" };
};

var VN = VN || {};

VN.PREFS_SECTION = "VNTextAdventure";
VN.PREFS_RECENT = "recentPackages";
VN.RECENT_LIMIT = 5;

VN.readRecentPackages = function () {
  try {
    if (!app.settings.haveSetting(VN.PREFS_SECTION, VN.PREFS_RECENT)) return [];
    var parsed = JSON.parse(app.settings.getSetting(VN.PREFS_SECTION, VN.PREFS_RECENT));
    if (!(parsed instanceof Array)) return [];
    return parsed;
  } catch (ignore) {
    return [];
  }
};

VN.writeRecentPackages = function (items) {
  app.settings.saveSetting(VN.PREFS_SECTION, VN.PREFS_RECENT, JSON.stringify(items));
};

VN.rememberSuccessfulImport = function (entry) {
  try {
    var items = VN.readRecentPackages();
    var next = [entry];
    var i;
    for (i = 0; i < items.length; i++) {
      if (VN.samePath(items[i].manifestPath, entry.manifestPath)) continue;
      next.push(items[i]);
      if (next.length >= VN.RECENT_LIMIT) break;
    }
    VN.writeRecentPackages(next);
  } catch (ignoreRemember) {}
};

VN.replaceRecentPath = function (previousPath, entry) {
  var items = VN.readRecentPackages();
  var next = [];
  var replaced = false;
  var i;
  for (i = 0; i < items.length; i++) {
    if (!replaced && VN.samePath(items[i].manifestPath, previousPath)) {
      next.push(entry);
      replaced = true;
    } else if (!VN.samePath(items[i].manifestPath, entry.manifestPath)) {
      next.push(items[i]);
    }
    if (next.length >= VN.RECENT_LIMIT) break;
  }
  if (!replaced) next.unshift(entry);
  VN.writeRecentPackages(next.slice(0, VN.RECENT_LIMIT));
};

VN.timestampNow = function () {
  var date = new Date();
  function pad(value) {
    return value < 10 ? "0" + value : String(value);
  }
  return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()) + " " + pad(date.getHours()) + ":" + pad(date.getMinutes());
};

VN.samePath = function (left, right) {
  return String(left || "").replace(/\\/g, "/").toLowerCase() === String(right || "").replace(/\\/g, "/").toLowerCase();
};

VN.copyText = function (text) {
  var file = new File(Folder.temp.fsName + "/vn-panel-clipboard.txt");
  file.encoding = "UTF-8";
  if (!file.open("w")) return false;
  file.write(String(text || ""));
  file.close();
  if (String($.os).indexOf("Windows") === -1) return false;
  var literal = file.fsName.replace(/'/g, "''");
  var command = "powershell -NoProfile -Command \"Get-Content -LiteralPath '" + literal + "' -Raw -Encoding UTF8 | Set-Clipboard\"";
  try {
    system.callSystem(command);
    return true;
  } catch (ignore) {
    return false;
  }
};

var VN = VN || {};

VN.blankReport = function () {
  return {
    ok: false,
    mode: "",
    saved: "",
    instanceId: "",
    inserted: "",
    errors: [],
    warnings: [],
    fonts: [],
    overflow: [],
    expressionErrors: []
  };
};

VN.blankImportResult = function () {
  return {
    ok: false,
    message: "",
    hint: "",
    details: "",
    cleanup: "",
    instanceId: "",
    displayName: "",
    master: null,
    report: null
  };
};

VN.suppressDialogs = function () {
  var suppressed = false;
  try {
    app.beginSuppressDialogs();
    suppressed = true;
  } catch (ignore) {}
  return function () {
    if (!suppressed) return;
    suppressed = false;
    try {
      app.endSuppressDialogs(false);
    } catch (ignoreEnd) {}
  };
};

VN.removeInserted = function (ctx) {
  if (!ctx) return;
  var inserted = ctx.insertedLayers || [];
  var n;
  for (n = inserted.length - 1; n >= 0; n--) {
    try {
      inserted[n].remove();
    } catch (ignoreInsert) {}
  }
  ctx.insertedLayers = [];
};

VN.cleanupFailedImport = function (ctx, extended, host, previousDuration) {
  var created = ctx && ((ctx.folders && ctx.folders.length) || (ctx.comps && ctx.comps.length) || (ctx.footage && ctx.footage.length) || (ctx.insertedLayers && ctx.insertedLayers.length));
  var cleaned = true;
  try {
    if (extended && host && previousDuration !== null && previousDuration !== undefined) host.duration = previousDuration;
  } catch (ignoreDuration) {
    cleaned = false;
  }
  try {
    if (ctx) VN.rollbackImport(ctx);
  } catch (ignoreRollback) {
    cleaned = false;
  }
  if (!created && !extended) return "工程未被修改。";
  return cleaned ? "已删除本次新增的内容。" : "清理未完成。请使用撤销，或检查项目面板里是否留下本次的 VN_ 文件夹。";
};

VN.friendlyImportError = function (err) {
  var text = String(err && err.message ? err.message : err);
  if (text.indexOf("Error: ") === 0) text = text.substring(7);
  if (text.indexOf("无法导入") === 0) return text;
  return "无法导入：" + text;
};

VN.hintForError = function (message) {
  if (message.indexOf("找不到") !== -1) return "请重新生成完整作品包，或恢复缺失素材。";
  return "可以查看详情后重试。";
};

VN.formatReport = function (report, extra) {
  var lines = [];
  lines.push("实例：" + (report.instanceId || "（未创建）"));
  if (report.saved) lines.push("已保存：" + report.saved);
  if (report.inserted) lines.push("已插入：" + report.inserted);
  lines.push("字体缺失 " + report.fonts.length);
  lines.push("文字溢出 " + report.overflow.length);
  lines.push("表达式错误 " + report.expressionErrors.length);
  var i;
  for (i = 0; i < report.errors.length; i++) lines.push(report.errors[i]);
  for (i = 0; i < report.warnings.length; i++) lines.push("警告：" + report.warnings[i]);
  for (i = 0; i < report.fonts.length; i++) lines.push("字体：" + report.fonts[i].layer + " " + report.fonts[i].detail);
  for (i = 0; i < report.overflow.length; i++) lines.push("溢出：" + report.overflow[i].layer + " " + report.overflow[i].detail);
  for (i = 0; i < report.expressionErrors.length; i++) lines.push("表达式：" + report.expressionErrors[i].layer + " " + report.expressionErrors[i].detail);
  if (extra) lines.push(extra);
  return lines.join("\n");
};

VN.tryWriteReport = function (file, report) {
  try {
    VN.writeJsonFile(file, report);
    return "";
  } catch (err) {
    return "检查报告没有写入：" + err.toString();
  }
};

VN.runImport = function (options) {
  var result = VN.blankImportResult();
  var report = VN.blankReport();
  var ctx = null;
  var master = null;
  var extended = false;
  var host = options.targetComp;
  var previousDuration = null;
  var undo = false;
  var release = VN.suppressDialogs();
  VN.packageRoot = options.packageRoot;
  try {
    VN.notifyPhase("check");
    VN.ensureVersion();
    if (typeof JSON === "undefined") throw new Error("这个 After Effects 的脚本环境无法解析 JSON。");
    var compiled = options.compiled;
    if (!compiled || (compiled.schemaVersion !== 2 && compiled.schemaVersion !== 3)) throw new Error("这份作品包的数据结构不是受支持的版本。");
    var empty = app.project.numItems === 0;
    report.mode = empty ? "create" : "append";
    if (!empty) VN.ensureExpressionEngineCompatible();

    app.beginUndoGroup("VN 导入片段");
    undo = true;
    if (empty) VN.setExpressionEngine();
    ctx = {};
    ctx.displayName = options.displayName || compiled.name;
    ctx.versionLabel = options.versionLabel || "";
    VN.prepareInstance(ctx, compiled);
    report.instanceId = ctx.instanceId;
    master = VN.buildProject(compiled, report, ctx);
    VN.notifyPhase("verify");
    if (options.saveProject) {
      var saved = VN.saveProject(compiled);
      report.saved = saved.fsName;
    }
    if (options.destination === "comp") {
      if (!(host instanceof CompItem)) throw new Error("请先打开要插入的合成。");
      var start = options.insertTime;
      if (start === undefined || start === null) start = host.time;
      var end = start + master.duration;
      if (end > host.duration + 0.0005) {
        if (options.extendHost) {
          previousDuration = host.duration;
          host.duration = end;
          extended = true;
        } else {
          report.warnings.push("未延长宿主合成。超出结尾的画面不会显示。");
        }
      }
      VN.placeInstanceLayer(host, master, ctx, report, start, null, compiled);
    }
    release();
    if (options.destination === "legacy" && report.mode === "append" && report.expressionErrors.length === 0) {
      try {
        VN.offerInsert(options.activeItem, master, compiled, ctx, report);
      } catch (insertErr) {
        VN.removeInserted(ctx);
        report.errors.push("插入当前合成失败，实例已保留：" + insertErr.toString());
      }
    }
    if (undo) {
      app.endUndoGroup();
      undo = false;
    }
    result.ok = report.errors.length === 0;
    result.instanceId = ctx.instanceId;
    result.displayName = ctx.displayName;
    result.master = master;
    result.report = report;
    result.message = result.ok ? "已导入：" + (ctx.displayName || compiled.name) : "无法导入：" + report.errors.join(" ");
    result.hint = "";
    if (result.ok && (report.fonts.length || report.overflow.length || report.expressionErrors.length)) {
      result.hint = "导入已完成。字体、文字范围或表达式仍有需要留意的项目。";
    }
    var reportNote = "";
    if (options.reportFile) reportNote = VN.tryWriteReport(options.reportFile, report);
    result.cleanup = result.ok ? "" : "实例已保留。";
    result.details = VN.formatReport(report, reportNote);
    return result;
  } catch (err) {
    var cleanup = "工程未被修改。";
    if (ctx || extended) cleanup = VN.cleanupFailedImport(ctx, extended, host, previousDuration);
    if (undo) {
      try {
        app.endUndoGroup();
      } catch (ignoreUndo) {}
    }
    release();
    report.errors.push(String(err));
    result.ok = false;
    result.message = VN.friendlyImportError(err);
    result.hint = VN.hintForError(result.message);
    result.cleanup = cleanup;
    result.report = report;
    result.displayName = options.displayName || "";
    var failureNote = options.reportFile ? VN.tryWriteReport(options.reportFile, report) : "";
    result.details = VN.formatReport(report, [cleanup, failureNote].join("\n"));
    return result;
  }
};

var VN = VN || {};

VN.buildPanel = function (thisObj) {
  var hosted = false;
  try {
    hosted = thisObj instanceof Panel;
  } catch (ignoreHost) {}
  var win = hosted ? thisObj : new Window("palette", "文字冒险", undefined, { resizeable: true });
  if (hosted && win.children && win.children.length) {
    var clearGuard = win.children.length + 2;
    while (win.children.length && clearGuard > 0) {
      clearGuard -= 1;
      try {
        win.remove(win.children[0]);
      } catch (ignoreRemove) {
        break;
      }
    }
  }
  win.orientation = "column";
  win.alignChildren = ["fill", "top"];
  win.spacing = 8;
  win.margins = 10;
  win.preferredSize = [340, 480];

  var clipBox = win.add("panel", undefined, "片段");
  clipBox.orientation = "column";
  clipBox.alignChildren = ["fill", "top"];
  clipBox.margins = 8;
  var chooseButton = clipBox.add("button", undefined, "选择作品包");
  var summaryName = clipBox.add("statictext", undefined, "选择一个作品包开始", { multiline: true });
  summaryName.preferredSize.height = 36;
  var summaryMeta = clipBox.add("statictext", undefined, " ", { multiline: true });
  summaryMeta.preferredSize.height = 32;
  var instancePick = clipBox.add("dropdownlist", undefined, ["已有片段"]);
  var primaryButton = clipBox.add("button", undefined, "导入片段");

  var playBox = win.add("panel", undefined, "文字样式与播放");
  playBox.orientation = "column";
  playBox.alignChildren = ["fill", "top"];
  playBox.margins = 8;
  var playName = playBox.add("statictext", undefined, " ", { multiline: true });
  playName.preferredSize.height = 32;
  var playDuration = playBox.add("statictext", undefined, " ", { multiline: true });
  playDuration.preferredSize.height = 32;
  var styleButton = playBox.add("button", undefined, "修改文字样式");
  var effectList = playBox.add("dropdownlist", undefined, ["打字机", "透明度逐字显示"]);
  effectList.selection = 0;
  var effectButton = playBox.add("button", undefined, "应用效果");
  var effectNote = playBox.add("statictext", undefined, " ", { multiline: true });
  effectNote.preferredSize.height = 32;
  var speedLabel = playBox.add("statictext", undefined, "播放速度");
  var speedSlider = playBox.add("slider", undefined, 1, 0.5, 2);
  var speedValue = playBox.add("edittext", undefined, "1");
  var speedPreview = playBox.add("statictext", undefined, " ", { multiline: true });
  speedPreview.preferredSize.height = 28;

  var textBox = win.add("panel", undefined, "文字动画");
  textBox.orientation = "column";
  textBox.alignChildren = ["fill", "top"];
  textBox.margins = 8;
  var textCount = textBox.add("statictext", undefined, " ", { multiline: true });
  var rebuildButton = textBox.add("button", undefined, "更新文字动画");

  var errorBox = win.add("group");
  errorBox.orientation = "column";
  errorBox.alignChildren = ["fill", "top"];
  var errorTitle = errorBox.add("statictext", undefined, " ", { multiline: true });
  errorTitle.preferredSize.height = 36;
  var errorRow = errorBox.add("group");
  var copyButton = errorRow.add("button", undefined, "复制错误");
  var assetsButton = errorRow.add("button", undefined, "打开素材目录");

  var statusText = win.add("statictext", undefined, "选择一个作品包开始", { multiline: true });
  statusText.preferredSize.height = 36;
  var detailsBox = win.add("edittext", undefined, "", { multiline: true });
  detailsBox.preferredSize.height = 72;

  var ui = {
    inspection: null,
    manifestFile: null,
    existing: [],
    context: null,
    signature: "",
    busy: false,
    fillingSpeed: false,
    speedLock: null,
    dragging: false
  };
  VN._panel = win;

  function pinTop(item) {
    try {
      item.alignment = ["fill", "top"];
    } catch (ignorePin) {}
  }

  function layoutNow() {
    try {
      var i;
      for (i = 0; i < win.children.length; i++) pinTop(win.children[i]);
      win.layout.layout(true);
    } catch (ignoreLayout) {}
  }

  function setShown(item, shown) {
    item.visible = !!shown;
    try {
      if (shown) item.maximumSize = [4000, 4000];
      else {
        item.minimumSize = [0, 0];
        item.maximumSize = [0, 0];
      }
    } catch (ignoreSize) {}
  }

  function setLabel(field, text) {
    field.text = text ? String(text) : " ";
  }

  function setStatus(text, details) {
    setLabel(statusText, text);
    detailsBox.text = details || "";
    setShown(detailsBox, !!details);
    layoutNow();
  }

  function speedNumber(value) {
    var number = Math.round(Number(value) * 100) / 100;
    if (!(number >= 0.5 && number <= 2)) return null;
    return number;
  }

  function predictedText(instanceId, speed) {
    var folder = VN.instanceFolderMeta(instanceId);
    if (!folder || !folder.meta.baseline) return "";
    var frames = Math.round(folder.meta.baseline.masterDurationFrames / speed);
    return "预计：" + VN.formatDuration(frames, folder.meta.baseline.fps);
  }

  function currentText(instanceId) {
    var caps = VN.capabilitiesFor(instanceId);
    var master = VN.masterCompFor(instanceId);
    if (!master) return "当前片段";
    var frames = Math.round(master.duration / master.frameDuration);
    return "当前片段：" + VN.formatDuration(frames, master.frameRate) + " · " + caps.speedValue + " 倍速";
  }

  function fillInstances() {
    instancePick.removeAll();
    var i;
    for (i = 0; i < ui.existing.length; i++) {
      var meta = ui.existing[i].meta || {};
      instancePick.add("item", meta.displayName || ui.existing[i].instanceId);
    }
    if (instancePick.items.length) instancePick.selection = 0;
  }

  function renderChrome() {
    var busy = ui.busy;
    var ready = ui.inspection && ui.inspection.ok;
    var count = ui.existing.length;
    chooseButton.enabled = !busy;
    primaryButton.enabled = !busy && ((ready && count === 0) || count > 0);
    primaryButton.text = count ? "打开片段" : "导入片段";
    setShown(instancePick, count > 1);
    setShown(summaryName, true);
    setShown(summaryMeta, !!ready);
    setShown(errorBox, ui.inspection && !ui.inspection.ok);
    var context = ui.context;
    var unique = context && context.status === "unique";
    setShown(playBox, !!unique && !busy);
    setShown(textBox, !!(context && context.textLayers && context.textLayers.length) && !busy);
    if (!unique && context && context.status === "ambiguous") setLabel(statusText, context.message);
    layoutNow();
  }

  function applyInspection(inspection, manifestFile) {
    ui.inspection = inspection;
    ui.manifestFile = manifestFile || ui.manifestFile;
    ui.signature = "";
    if (!inspection || !inspection.ok) {
      setLabel(summaryName, inspection ? inspection.message : "选择一个作品包开始");
      setLabel(summaryMeta, " ");
      setLabel(errorTitle, inspection ? inspection.message : " ");
      ui.existing = [];
      setStatus(inspection ? inspection.message : "选择一个作品包开始", inspection ? inspection.details : "");
      setShown(assetsButton, !!(inspection && inspection.message && inspection.message.indexOf("找不到") !== -1));
      renderChrome();
      return;
    }
    var manifest = inspection.manifest;
    var summaryInfo = manifest.summary;
    setLabel(summaryName, manifest.displayName || "作品");
    setLabel(summaryMeta, summaryInfo.textEventCount + " 段文字 · " + VN.formatDuration(summaryInfo.durationFrames, summaryInfo.fps));
    ui.existing = VN.findBuildInstances(manifest.projectId, manifest.buildId);
    fillInstances();
    setStatus(ui.existing.length ? "此版本已在工程中" : "可以导入", "");
    renderChrome();
    syncContext();
  }

  function loadManifest(file) {
    if (!file) return;
    try {
      ui.busy = true;
      setStatus("正在检查素材与版本…", "");
      renderChrome();
      var inspection = VN.inspectPackage(file);
      ui.busy = false;
      applyInspection(inspection, file);
    } catch (err) {
      ui.busy = false;
      ui.inspection = { ok: false, message: "无法读取作品包", details: String(err) };
      applyInspection(ui.inspection, file);
    }
  }

  function selectedExisting() {
    if (!ui.existing.length) return null;
    if (ui.existing.length === 1) return ui.existing[0];
    var index = instancePick.selection ? instancePick.selection.index : 0;
    return ui.existing[index] || ui.existing[0];
  }

  function openExisting() {
    var chosen = selectedExisting();
    if (!chosen) return;
    var opened = VN.openLogicalComp(chosen.instanceId, "master");
    setStatus(opened.ok ? "已打开片段" : opened.message, "");
    ui.signature = "";
    syncContext();
  }

  function beginImport() {
    if (ui.busy || !ui.manifestFile) return;
    var inspection = VN.inspectPackage(ui.manifestFile);
    if (!inspection.ok) {
      applyInspection(inspection, ui.manifestFile);
      return;
    }
    ui.existing = VN.findBuildInstances(inspection.manifest.projectId, inspection.manifest.buildId);
    if (ui.existing.length) {
      fillInstances();
      renderChrome();
      openExisting();
      return;
    }
    try {
      VN.ensureVersion();
      if (app.project.numItems > 0) VN.ensureExpressionEngineCompatible();
    } catch (err) {
      setStatus(VN.friendlyImportError(err), String(err));
      return;
    }
    ui.busy = true;
    renderChrome();
    var result;
    try {
      result = VN.runImport({
        compiled: inspection.compiled,
        packageRoot: inspection.packageRoot,
        displayName: inspection.manifest.displayName,
        versionLabel: inspection.manifest.versionLabel,
        destination: "project",
        saveProject: false,
        extendHost: false,
        targetComp: null,
        insertTime: null,
        activeItem: null,
        reportFile: new File(inspection.packageRoot.fsName + "/report.ae.json")
      });
    } finally {
      ui.busy = false;
    }
    if (result.ok) {
      try {
        VN.rememberSuccessfulImport({
          displayName: inspection.manifest.displayName,
          manifestPath: ui.manifestFile.fsName,
          lastUsedAt: VN.timestampNow(),
          versionLabel: inspection.manifest.versionLabel
        });
      } catch (ignoreRemember) {}
      if (result.master) {
        try {
          result.master.openInViewer();
        } catch (ignoreOpen) {}
      }
      ui.existing = VN.findBuildInstances(inspection.manifest.projectId, inspection.manifest.buildId);
      fillInstances();
      setStatus(result.message || "已导入并打开片段", result.hint || "");
      renderChrome();
      ui.signature = "";
      syncContext();
      return;
    }
    setStatus(result.message, [result.hint, result.cleanup, result.details].join("\n"));
    renderChrome();
  }

  function syncSpeed(instanceId) {
    var caps = VN.capabilitiesFor(instanceId);
    ui.fillingSpeed = true;
    speedSlider.value = caps.speedValue;
    speedValue.text = String(caps.speedValue);
    effectList.selection = caps.defaultEffect === "characterFade" ? 1 : 0;
    ui.fillingSpeed = false;
    setLabel(playDuration, currentText(instanceId));
    setLabel(speedPreview, " ");
    setLabel(effectNote, "默认效果：" + VN.effectLabel(caps.defaultEffect));
    var enabled = !!caps.full;
    effectList.enabled = enabled;
    effectButton.enabled = enabled;
    speedSlider.enabled = enabled;
    speedValue.enabled = enabled;
    styleButton.text = caps.style === "editor" ? "修改文字样式" : "打开原有样式控制";
  }

  function syncContext() {
    if (ui.busy || ui.dragging) return;
    var context = VN.resolveContext();
    ui.context = context;
    var textCountValue = context.textLayers ? context.textLayers.length : 0;
    var instanceKey = context.status === "unique" ? context.instanceId : context.status;
    var signature = instanceKey + "|" + textCountValue + "|" + (ui.existing.length) + "|" + (context.message || "");
    var changed = signature !== ui.signature;
    if (context.status === "unique") {
      var folder = VN.instanceFolderMeta(context.instanceId);
      var name = context.instance && context.instance.displayName ? context.instance.displayName : context.instanceId;
      if (folder && folder.meta.displayName) name = folder.meta.displayName;
      setLabel(playName, name);
      if (changed) syncSpeed(context.instanceId);
      else setLabel(playDuration, currentText(context.instanceId));
    }
    if (textCountValue) setLabel(textCount, "已选中 " + textCountValue + " 段文字");
    if (!changed) return;
    ui.signature = signature;
    renderChrome();
  }

  function selectionInstance() {
    var context = VN.resolveContext();
    ui.context = context;
    if (!context.textLayers || !context.textLayers.length) return "";
    var id = context.textLayers[0].meta.instanceId;
    var i;
    for (i = 1; i < context.textLayers.length; i++) {
      if (context.textLayers[i].meta.instanceId !== id) return "";
    }
    return id;
  }

  function commitSpeed(raw) {
    var context = ui.context;
    if (!context || context.status !== "unique") return;
    var speed = speedNumber(raw);
    if (speed === null) {
      setStatus("速度需要在 0.5 到 2 之间。", "");
      syncSpeed(context.instanceId);
      return;
    }
    var caps = VN.capabilitiesFor(context.instanceId);
    if (Math.abs(speed - caps.speedValue) < 0.001) {
      setLabel(speedPreview, " ");
      return;
    }
    var lock = ui.speedLock || VN.captureLock(context.instanceId);
    ui.busy = true;
    speedSlider.enabled = false;
    speedValue.enabled = false;
    effectButton.enabled = false;
    var result = VN.executeSpeed(lock, speed);
    ui.busy = false;
    ui.speedLock = null;
    ui.dragging = false;
    syncSpeed(context.instanceId);
    setStatus(result.message, result.status === "failed" ? result.message : "");
    renderChrome();
  }

  chooseButton.onClick = function () {
    if (ui.busy) return;
    var picked = File.openDialog("选择 vn-package.json", "JSON:*.json");
    if (!picked) return;
    loadManifest(picked);
  };
  primaryButton.onClick = function () {
    if (ui.existing.length) openExisting();
    else beginImport();
  };
  styleButton.onClick = function () {
    var context = VN.resolveContext();
    if (!context || context.status !== "unique") {
      setStatus("请先打开一个生成片段。", "");
      return;
    }
    var result = VN.openStyleEditor(context.instanceId);
    setStatus(result.message, "");
  };
  effectButton.onClick = function () {
    var context = VN.resolveContext();
    if (!context || context.status !== "unique") {
      setStatus("请先打开一个生成片段。", "");
      return;
    }
    var effect = effectList.selection && effectList.selection.index === 1 ? "characterFade" : "typewriter";
    var lock = VN.captureLock(context.instanceId);
    ui.busy = true;
    renderChrome();
    var result = VN.executeEffect(lock, effect);
    ui.busy = false;
    var retained = 0;
    var i;
    for (i = 0; i < result.items.length; i++) if (result.items[i].status !== "updated") retained += 1;
    if (result.status === "updated" || result.status === "partial") {
      setLabel(effectNote, "默认效果：" + VN.effectLabel(effect) + (retained ? "\n" + retained + " 段保留原效果" : ""));
    }
    setStatus(result.message, result.status === "failed" || result.status === "partial" ? result.message : "");
    ui.signature = "";
    syncContext();
  };
  speedSlider.onChanging = function () {
    if (ui.fillingSpeed) return;
    var context = ui.context;
    if (!context || context.status !== "unique") return;
    if (!ui.speedLock) ui.speedLock = VN.captureLock(context.instanceId);
    ui.dragging = true;
    var speed = speedNumber(speedSlider.value) || speedSlider.value;
    speedValue.text = String(Math.round(speedSlider.value * 100) / 100);
    setLabel(speedPreview, predictedText(context.instanceId, speedSlider.value));
  };
  speedSlider.onChange = function () {
    if (ui.fillingSpeed) return;
    ui.dragging = false;
    commitSpeed(speedSlider.value);
  };
  speedValue.onChange = function () {
    if (ui.fillingSpeed) return;
    ui.speedLock = ui.context && ui.context.status === "unique" ? VN.captureLock(ui.context.instanceId) : null;
    commitSpeed(speedValue.text);
  };
  rebuildButton.onClick = function () {
    var instanceId = selectionInstance();
    if (!instanceId) {
      setStatus("请选中同一个片段里的文字。", "");
      return;
    }
    var lock = VN.captureLock(instanceId);
    ui.busy = true;
    renderChrome();
    var result = VN.executeRebuild(lock);
    ui.busy = false;
    var details = "";
    var i;
    for (i = 0; i < result.items.length; i++) {
      if (result.items[i].status !== "updated" && result.items[i].message) details += result.items[i].message + "\n";
    }
    setStatus(result.message, details);
    renderChrome();
  };
  copyButton.onClick = function () {
    var payload = errorTitle.text + "\n" + detailsBox.text;
    setStatus(VN.copyText(payload) ? "已复制错误详情" : "请在详情框中全选复制", detailsBox.text);
  };
  assetsButton.onClick = function () {
    if (!ui.inspection || !ui.inspection.packageRoot) {
      setStatus("请先选择作品包", "");
      return;
    }
    var folder = new Folder(ui.inspection.packageRoot.fsName + "/assets");
    if (!folder.exists) folder = ui.inspection.packageRoot;
    folder.execute();
  };

  try {
    win.onResize = function () { layoutNow(); };
    win.onResizing = function () { layoutNow(); };
  } catch (ignoreResize) {}
  try {
    win.onClose = function () {
      VN._panel = null;
      VN._polling = false;
    };
  } catch (ignoreClose) {}

  VN.syncPanelContext = syncContext;
  setShown(playBox, false);
  setShown(textBox, false);
  setShown(errorBox, false);
  setShown(detailsBox, false);
  setShown(instancePick, false);
  layoutNow();
  applyInspection(null, null);
  syncContext();
  VN.ensurePolling();
  if (!hosted) {
    win.center();
    win.show();
  }
  return win;
};

VN.ensurePolling = function () {
  if (VN._polling) return;
  VN._polling = true;
  try {
    app.scheduleTask("VN.pollPanel()", 500, false);
  } catch (ignoreSchedule) {
    VN._polling = false;
  }
};

VN.pollPanel = function () {
  var alive = false;
  try {
    alive = !!(VN._panel && VN._panel.visible);
  } catch (ignoreAlive) {
    VN._panel = null;
  }
  if (!alive) {
    VN._polling = false;
    return;
  }
  try {
    if (VN.syncPanelContext) VN.syncPanelContext();
  } catch (ignoreSync) {}
  try {
    app.scheduleTask("VN.pollPanel()", 500, false);
  } catch (ignoreReschedule) {
    VN._polling = false;
  }
};

VN.buildPanel(this);
