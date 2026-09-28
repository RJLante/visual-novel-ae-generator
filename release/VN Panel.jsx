// 文字冒险面板。复制到 After Effects 的 ScriptUI Panels 目录后，从「窗口」菜单打开。
// 也可以用「文件 > 脚本 > 运行脚本文件」打开浮动窗口，方便调试。
// 这个文件是工具本身，不要放进作品包。作品包通过 vn-package.json 导入。
var VN = VN || {};

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
  else if (spec.comment) VN.writeMeta(layer, VN.layerMeta(spec, ctx), spec.comment);
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
  return {
    v: 2,
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
    opacity: animation ? VN.compactKeys(animation.opacityKeys) : undefined
  };
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

VN.resolveContext = function () {
  var active = app.project.activeItem;
  var textLayers = [];
  var instanceIds = [];
  var instanceMeta = null;
  var insertTarget = VN.currentInsertTarget();

  function remember(meta) {
    var n;
    for (n = 0; n < instanceIds.length; n++) {
      if (instanceIds[n] === meta.instanceId) return;
    }
    instanceIds.push(meta.instanceId);
    if (!instanceMeta) instanceMeta = meta;
  }

  if (active instanceof CompItem && active.selectedLayers.length) {
    var i;
    for (i = 0; i < active.selectedLayers.length; i++) {
      var layer = active.selectedLayers[i];
      var meta = VN.readMeta(layer.comment);
      if (!meta || meta.v !== 2 || !meta.instanceId) continue;
      remember(meta);
      if (layer.property("ADBE Text Properties") !== null && (meta.preset === "typewriter" || meta.preset === "lines")) {
        var preview = "";
        try {
          preview = layer.property("ADBE Text Properties").property("ADBE Text Document").value.text;
        } catch (ignoreText) {}
        textLayers.push({ layer: layer, comp: active, preview: preview, meta: meta });
      }
    }
    if (instanceIds.length > 1) return { state: "ambiguous", instance: null, textLayers: textLayers, insertTarget: insertTarget };
    if (instanceIds.length === 1) {
      return { state: "instance", instance: VN.describeInstance(instanceMeta), textLayers: textLayers, insertTarget: insertTarget };
    }
  }
  if (active instanceof CompItem) {
    var own = VN.readMeta(active.comment);
    if (own && own.v === 2 && own.instanceId) {
      return { state: "instance", instance: VN.describeInstance(own), textLayers: textLayers, insertTarget: insertTarget };
    }
  }
  return { state: "empty", instance: null, textLayers: [], insertTarget: insertTarget };
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
    if (!compiled || compiled.schemaVersion !== 2) throw new Error("这份作品包的数据结构不是受支持的版本。");
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
  win.spacing = 6;
  win.margins = 10;

  var header = win.add("group");
  header.orientation = "row";
  header.alignChildren = ["left", "center"];
  header.add("statictext", undefined, "文字冒险");
  var moreButton = header.add("button", undefined, "更多");
  moreButton.alignment = ["right", "center"];
  moreButton.preferredSize.width = 64;

  var menu = win.add("group");
  menu.orientation = "column";
  menu.alignChildren = ["fill", "top"];
  menu.spacing = 2;
  var speedMenu = menu.add("button", undefined, "批量调整节奏…");
  var presetMenu = menu.add("button", undefined, "更换文字动画…");
  var unlinkMenu = menu.add("button", undefined, "独立编辑样式…");
  var checkMenu = menu.add("button", undefined, "检查当前片段");
  var infoMenu = menu.add("button", undefined, "作品包详情");
  var assetsMenu = menu.add("button", undefined, "打开素材目录");

  var packageHeading = win.add("statictext", undefined, "作品包");
  var pickRow = win.add("group");
  pickRow.orientation = "row";
  pickRow.alignChildren = ["fill", "center"];
  var chooseButton = pickRow.add("button", undefined, "选择作品包…");
  chooseButton.alignment = ["fill", "center"];
  var recent = pickRow.add("dropdownlist", undefined, ["最近使用"]);
  recent.selection = 0;
  recent.preferredSize.width = 120;

  var emptyText = win.add("statictext", undefined, "选择一个作品包开始", { multiline: true });
  emptyText.preferredSize.height = 32;

  var summary = win.add("group");
  summary.orientation = "column";
  summary.alignChildren = ["fill", "top"];
  summary.spacing = 2;
  var summaryName = summary.add("statictext", undefined, "", { multiline: true });
  summaryName.preferredSize.height = 32;
  var summaryMeta = summary.add("statictext", undefined, "", { multiline: true });
  summaryMeta.preferredSize.height = 32;
  var summaryHealth = summary.add("statictext", undefined, "", { multiline: true });
  summaryHealth.preferredSize.height = 28;

  var errorBox = win.add("group");
  errorBox.orientation = "column";
  errorBox.alignChildren = ["fill", "top"];
  var errorTitle = errorBox.add("statictext", undefined, "", { multiline: true });
  errorTitle.preferredSize.height = 36;
  var errorHint = errorBox.add("statictext", undefined, "", { multiline: true });
  errorHint.preferredSize.height = 32;
  var errorRow = errorBox.add("group");
  errorRow.orientation = "row";
  var recheckButton = errorRow.add("button", undefined, "重新检查");
  var copyButton = errorRow.add("button", undefined, "复制错误详情");

  var destinationLabel = win.add("statictext", undefined, "导入位置");
  var destination = win.add("dropdownlist", undefined, ["仅加入项目面板", "插入当前合成"]);
  destination.selection = 0;
  var targetText = win.add("statictext", undefined, "导入后可自行拖入时间轴", { multiline: true });
  targetText.preferredSize.height = 32;
  var importButton = win.add("button", undefined, "导入片段");
  var openLastButton = win.add("button", undefined, "打开主合成");

  var duplicateBox = win.add("group");
  duplicateBox.orientation = "column";
  duplicateBox.alignChildren = ["fill", "top"];
  duplicateBox.add("statictext", undefined, "本工程已导入此版本");
  var duplicateRow = duplicateBox.add("group");
  duplicateRow.orientation = "row";
  duplicateRow.alignChildren = ["fill", "center"];
  var openExistingButton = duplicateRow.add("button", undefined, "打开已导入片段");
  var copyImportButton = duplicateRow.add("button", undefined, "再导入副本");

  var currentBox = win.add("panel", undefined, "当前片段");
  currentBox.orientation = "column";
  currentBox.alignChildren = ["fill", "top"];
  currentBox.alignment = ["fill", "top"];
  currentBox.margins = 8;
  var currentPrompt = currentBox.add("statictext", undefined, "请选择一个生成的片段", { multiline: true });
  var currentName = currentBox.add("statictext", undefined, "", { multiline: true });
  currentName.preferredSize.height = 28;
  var currentRow = currentBox.add("group");
  currentRow.orientation = "row";
  currentRow.alignChildren = ["fill", "center"];
  var openMasterButton = currentRow.add("button", undefined, "打开主合成");
  var styleButton = currentRow.add("button", undefined, "全局样式");

  var textBox = win.add("panel", undefined, "文字工具");
  textBox.orientation = "column";
  textBox.alignChildren = ["fill", "top"];
  textBox.margins = 8;
  var textCount = textBox.add("statictext", undefined, "", { multiline: true });
  var textPreview = textBox.add("statictext", undefined, "", { multiline: true });
  textPreview.preferredSize.height = 32;
  var rebuildButton = textBox.add("button", undefined, "按新文案重建动画");
  textBox.add("statictext", undefined, "手动调整过的动画会跳过");

  var extraBox = win.add("panel", undefined, "批量操作");
  extraBox.orientation = "column";
  extraBox.alignChildren = ["fill", "top"];
  extraBox.margins = 8;
  var extraTitle = extraBox.add("statictext", undefined, "批量调整节奏");
  extraBox.add("statictext", undefined, "处理范围");
  var scopeList = extraBox.add("dropdownlist", undefined, ["选中文字"]);
  scopeList.selection = 0;
  var speedLabel = extraBox.add("statictext", undefined, "速度倍率");
  var speedText = extraBox.add("edittext", undefined, "1");
  var keepManual = extraBox.add("checkbox", undefined, "按现有关键帧缩放");
  var presetLabel = extraBox.add("statictext", undefined, "动画预设");
  var presetList = extraBox.add("dropdownlist", undefined, ["打字机", "逐行出现", "整段淡入"]);
  presetList.selection = 0;
  var extraRow = extraBox.add("group");
  extraRow.orientation = "row";
  var extraApply = extraRow.add("button", undefined, "应用");
  var extraClose = extraRow.add("button", undefined, "关闭");

  var detailsBox = win.add("edittext", undefined, "", { multiline: true });
  detailsBox.preferredSize.height = 72;

  var footer = win.add("group");
  footer.orientation = "row";
  footer.alignChildren = ["fill", "center"];
  var statusText = footer.add("statictext", undefined, "选择一个作品包开始", { multiline: true });
  statusText.alignment = ["fill", "center"];
  statusText.preferredSize.height = 28;

  var ui = {
    state: "empty",
    inspection: null,
    manifestFile: null,
    existing: [],
    lastResult: null,
    context: null,
    contextSignature: "",
    extraMode: "",
    menuOpen: false
  };
  VN._panel = win;

  function pinTop(item) {
    try {
      item.alignment = ["fill", "top"];
    } catch (ignorePin) {}
  }

  function layoutNow() {
    var i;
    try {
      for (i = 0; i < win.children.length; i++) pinTop(win.children[i]);
      win.layout.layout(true);
    } catch (ignoreLayout) {}
    try {
      win.update();
    } catch (ignoreUpdate) {}
  }

  function setShown(item, shown) {
    item.visible = !!shown;
    try {
      if (shown) {
        item.maximumSize = [4000, 4000];
        if (item._vnHeight) item.preferredSize = [item.preferredSize.width > 20 ? item.preferredSize.width : 240, item._vnHeight];
      } else {
        if (!item._vnHeight && item.preferredSize && item.preferredSize.height > 8) item._vnHeight = item.preferredSize.height;
        item.minimumSize = [0, 0];
        item.maximumSize = [0, 0];
      }
    } catch (ignoreSize) {}
  }

  function setLabel(field, text) {
    var value = text ? String(text) : " ";
    field.text = value;
    try {
      field.characters = value.length < 12 ? 12 : value.length;
    } catch (ignoreCharacters) {}
  }

  function setStatus(text) {
    setLabel(statusText, text);
    try {
      win.update();
    } catch (ignoreUpdate) {}
  }

  function showDetails(text, shown) {
    detailsBox.text = text || "";
    setShown(detailsBox, !!shown && !!text);
  }

  function shortText(value) {
    var text = String(value || "").replace(/\r|\n/g, " ");
    if (text.length > 28) text = text.substring(0, 28) + "…";
    return text ? "“" + text + "”" : "";
  }

  function fillRecent() {
    VN._fillingRecent = true;
    recent.removeAll();
    recent.add("item", "最近使用");
    ui.recentItems = VN.readRecentPackages();
    var i;
    for (i = 0; i < ui.recentItems.length; i++) {
      var item = ui.recentItems[i];
      var label = item.displayName || "作品包";
      if (item.versionLabel) label += " " + item.versionLabel;
      var file = new File(item.manifestPath);
      if (!file.exists) label += "（找不到）";
      recent.add("item", label);
    }
    recent.selection = 0;
    VN._fillingRecent = false;
  }

  function renderChrome() {
    var state = ui.state;
    var busy = state === "checking" || state === "importing";
    var ready = ui.inspection && ui.inspection.ok;
    chooseButton.enabled = !busy;
    recent.enabled = !busy;
    destination.enabled = ready && !busy;
    importButton.enabled = (state === "ready" || state === "success") && !busy;
    moreButton.enabled = !busy;
    setShown(emptyText, state === "empty");
    setShown(summary, !!ready);
    setShown(errorBox, state === "invalid" || state === "failed");
    setShown(destinationLabel, !!ready && state !== "importing");
    setShown(destination, !!ready && state !== "importing");
    setShown(targetText, !!ready && state !== "importing");
    setShown(importButton, state !== "duplicate");
    setShown(openLastButton, state === "success" && ui.lastResult && ui.lastResult.master);
    setShown(duplicateBox, state === "duplicate");
    setShown(menu, ui.menuOpen && !busy);
    setShown(extraBox, !!ui.extraMode && !busy);
    if (!busy && state !== "failed" && state !== "invalid") {
      if (!detailsBox.text || ui.extraMode) setShown(detailsBox, !!ui.extraMode && !!detailsBox.text);
    }
    layoutNow();
  }

  function applyInspection(inspection, manifestFile) {
    ui.inspection = inspection;
    ui.manifestFile = manifestFile || ui.manifestFile;
    ui.contextSignature = "";
    if (!inspection || !inspection.ok) {
      ui.state = inspection ? "invalid" : "empty";
      setLabel(errorTitle, inspection ? inspection.message : " ");
      setLabel(errorHint, inspection ? inspection.hint : " ");
      showDetails(inspection ? inspection.message + "\n" + inspection.hint + "\n" + inspection.details : "", !!inspection);
      setStatus(inspection ? inspection.message : "选择一个作品包开始");
      renderChrome();
      return;
    }
    var manifest = inspection.manifest;
    var summaryInfo = manifest.summary;
    setLabel(summaryName, manifest.displayName + "  " + (manifest.versionLabel || ""));
    setLabel(summaryMeta, summaryInfo.sceneCount + " 个场景 · " + summaryInfo.textEventCount + " 段文字 · " + VN.formatDuration(summaryInfo.durationFrames, summaryInfo.fps));
    setLabel(summaryHealth, "素材齐全，可以导入  ·  " + summaryInfo.width + " × " + summaryInfo.height + "  ·  " + summaryInfo.fps + " fps");
    ui.existing = VN.findBuildInstances(manifest.projectId, manifest.buildId);
    if (ui.existing.length) {
      ui.state = "duplicate";
      setStatus("此版本已存在");
      showDetails("", false);
    } else {
      ui.state = "ready";
      setStatus("可以导入");
      showDetails("", false);
    }
    renderChrome();
    syncContext();
  }

  function loadManifest(file, repairedFrom, previousUsed) {
    if (!file) return;
    try {
      ui.state = "checking";
      setStatus("正在检查素材与版本…");
      renderChrome();
      var inspection = VN.inspectPackage(file);
      if (repairedFrom && inspection.ok) {
        VN.replaceRecentPath(repairedFrom, {
          displayName: inspection.manifest.displayName,
          manifestPath: file.fsName,
          lastUsedAt: previousUsed || "",
          versionLabel: inspection.manifest.versionLabel
        });
        fillRecent();
      }
      applyInspection(inspection, file);
    } catch (err) {
      ui.state = "failed";
      setLabel(errorTitle, "无法读取作品包");
      setLabel(errorHint, String(err));
      showDetails(String(err), true);
      setStatus(String(err));
      renderChrome();
    }
  }

  function choosePackage() {
    if (VN._importing) return;
    var picked = File.openDialog("选择 vn-package.json", "JSON:*.json");
    if (!picked) return;
    loadManifest(picked, "");
  }

  function syncContext() {
    if (VN._importing) return;
    var context = VN.resolveContext();
    ui.context = context;
    var targetLabel = "导入后可自行拖入时间轴";
    if (destination.selection && destination.selection.index === 1) {
      targetLabel = context.insertTarget ? "插入到：" + context.insertTarget.name + " · " + context.insertTarget.timecode : "请先打开要插入的合成";
    }
    setLabel(targetText, targetLabel);
    var identified = context.state === "instance" && context.instance;
    setShown(currentPrompt, !identified);
    setShown(currentName, !!identified);
    setShown(currentRow, !!identified);
    if (identified) setLabel(currentName, context.instance.displayName + (context.instance.versionLabel ? "  " + context.instance.versionLabel : ""));
    var textCountValue = context.textLayers.length;
    setShown(textBox, textCountValue > 0);
    if (textCountValue > 0) {
      setLabel(textCount, "已选择 " + textCountValue + " 个可处理的文字层");
      setLabel(textPreview, shortText(context.textLayers[0].preview));
    }
    var instanceKey = identified ? context.instance.instanceId : context.state;
    var signature = instanceKey + "|" + textCountValue + "|" + targetLabel;
    if (signature === ui.contextSignature) return;
    ui.contextSignature = signature;
    layoutNow();
  }

  function showFailure(result) {
    ui.state = "failed";
    setLabel(errorTitle, result.message);
    setLabel(errorHint, result.hint || " ");
    showDetails([result.message, result.hint, result.cleanup, result.details].join("\n"), true);
    setStatus(result.message);
    renderChrome();
  }

  function beginImport(asCopy) {
    if (VN._importing || !ui.manifestFile) return;
    var inspection = VN.inspectPackage(ui.manifestFile);
    if (!inspection.ok) {
      applyInspection(inspection, ui.manifestFile);
      return;
    }
    ui.inspection = inspection;
    try {
      VN.ensureVersion();
      if (app.project.numItems > 0) VN.ensureExpressionEngineCompatible();
    } catch (err) {
      showFailure({
        message: VN.friendlyImportError(err),
        hint: "工程未被修改。",
        cleanup: "工程未被修改。",
        details: String(err)
      });
      return;
    }
    if (!asCopy) {
      var existing = VN.findBuildInstances(inspection.manifest.projectId, inspection.manifest.buildId);
      if (existing.length) {
        ui.existing = existing;
        ui.state = "duplicate";
        setStatus("此版本已存在");
        renderChrome();
        return;
      }
    }
    var destinationName = destination.selection && destination.selection.index === 1 ? "comp" : "project";
    var targetComp = null;
    var insertTime = null;
    var extendHost = false;
    if (destinationName === "comp") {
      var target = VN.currentInsertTarget();
      if (!target) {
        setStatus("请先打开要插入的合成。");
        return;
      }
      var seconds = inspection.compiled.durationFrames / inspection.compiled.fps;
      if (target.time + seconds > target.comp.duration + 0.0005) {
        var agreed = confirm("片段会超出「" + target.comp.name + "」的结尾。\n是否延长这个合成后再导入？\n\n选择「否」将取消，不会修改工程。");
        if (!agreed) {
          setStatus("已取消导入，工程没有修改。");
          return;
        }
        extendHost = true;
      }
      var again = VN.currentInsertTarget();
      if (!again || again.comp !== target.comp) {
        setStatus("当前合成已变化，导入已取消，工程没有修改。");
        return;
      }
      if (again.time + seconds <= again.comp.duration + 0.0005) extendHost = false;
      targetComp = again.comp;
      insertTime = again.time;
    }

    VN._importing = true;
    ui.state = "importing";
    ui.menuOpen = false;
    ui.extraMode = "";
    setStatus("正在检查作品包…");
    renderChrome();
    VN.onImportPhase = function (phase) {
      setStatus(phase === "assets" ? "正在导入素材…" : phase === "comps" || phase === "layers" ? "正在创建合成和图层…" : phase === "verify" ? "正在检查结果…" : "正在检查作品包…");
    };
    var result;
    try {
      result = VN.runImport({
        compiled: inspection.compiled,
        packageRoot: inspection.packageRoot,
        displayName: inspection.manifest.displayName,
        versionLabel: inspection.manifest.versionLabel,
        destination: destinationName,
        saveProject: false,
        extendHost: extendHost,
        targetComp: targetComp,
        insertTime: insertTime,
        activeItem: null,
        reportFile: new File(inspection.packageRoot.fsName + "/report.ae.json")
      });
    } finally {
      VN.onImportPhase = null;
      VN._importing = false;
    }
    ui.lastResult = result;
    if (result.ok) {
      VN.rememberSuccessfulImport({
        displayName: inspection.manifest.displayName,
        manifestPath: ui.manifestFile.fsName,
        lastUsedAt: VN.timestampNow(),
        versionLabel: inspection.manifest.versionLabel
      });
      fillRecent();
      ui.state = "success";
      setLabel(summaryHealth, "此版本已导入当前工程");
      setStatus(result.message);
      showDetails(result.hint ? result.message + "\n" + result.hint + "\n" + result.details : "", !!result.hint);
      renderChrome();
      syncContext();
      return;
    }
    showFailure(result);
  }

  function openExtra(mode) {
    ui.menuOpen = false;
    ui.extraMode = mode;
    extraTitle.text = mode === "preset" ? "更换文字动画" : mode === "unlink" ? "独立编辑样式" : "批量调整节奏";
    var context = VN.resolveContext();
    ui.context = context;
    scopeList.removeAll();
    scopeList.add("item", "选中文字 · " + context.textLayers.length + " 层");
    scopeList.add("item", "当前合成");
    scopeList.add("item", "当前片段");
    scopeList.selection = 0;
    speedText.text = "1";
    keepManual.value = false;
    presetList.selection = 0;
    setShown(speedLabel, mode === "speed");
    setShown(speedText, mode === "speed");
    setShown(keepManual, mode === "speed");
    setShown(presetLabel, mode === "preset");
    setShown(presetList, mode === "preset");
    renderChrome();
  }

  function selectedScope() {
    if (!scopeList.selection || scopeList.selection.index === 0) return "selection";
    if (scopeList.selection.index === 1) return "scene";
    return "instance";
  }

  chooseButton.onClick = choosePackage;
  recent.onChange = function () {
    if (VN._fillingRecent || !recent.selection || recent.selection.index < 1) return;
    var item = ui.recentItems[recent.selection.index - 1];
    if (!item) return;
    var file = new File(item.manifestPath);
    if (!file.exists) {
      setStatus("找不到这个作品包，请重新定位 vn-package.json。");
      var picked = File.openDialog("重新定位 vn-package.json", "JSON:*.json");
      if (!picked) return;
      loadManifest(picked, item.manifestPath, item.lastUsedAt);
      return;
    }
    loadManifest(file, "");
  };
  destination.onChange = function () {
    ui.contextSignature = "";
    syncContext();
  };
  importButton.onClick = function () {
    beginImport(false);
  };
  copyImportButton.onClick = function () {
    beginImport(true);
  };
  openExistingButton.onClick = function () {
    if (!ui.existing.length) return;
    var opened = VN.openLogicalComp(ui.existing[0].instanceId, "master");
    setStatus(opened.ok ? "已打开已导入片段" : opened.message);
  };
  openLastButton.onClick = function () {
    if (!ui.lastResult || !ui.lastResult.master) return;
    ui.lastResult.master.openInViewer();
    setStatus("已打开主合成");
    ui.contextSignature = "";
    syncContext();
  };
  openMasterButton.onClick = function () {
    var context = VN.resolveContext();
    if (!context.instance) {
      setStatus("请选择一个生成的片段");
      return;
    }
    var opened = VN.openLogicalComp(context.instance.instanceId, "master");
    setStatus(opened.ok ? "已打开主合成" : opened.message);
  };
  styleButton.onClick = function () {
    var context = VN.resolveContext();
    if (context.state === "ambiguous" || !context.instance) {
      setStatus("请选择一个生成的片段");
      return;
    }
    var opened = VN.openLogicalComp(context.instance.instanceId, "global:control");
    setStatus(opened.ok ? "已打开全局样式" : opened.message);
  };
  rebuildButton.onClick = function () {
    var result = VN.rebuildSelectedText();
    setStatus(result.message);
    showDetails(result.details, !!result.details);
    renderChrome();
  };
  recheckButton.onClick = function () {
    if (ui.manifestFile) loadManifest(ui.manifestFile, "");
  };
  copyButton.onClick = function () {
    var payload = [errorTitle.text, errorHint.text, detailsBox.text].join("\n");
    setStatus(VN.copyText(payload) ? "已复制错误详情" : "请在详情框中全选复制");
  };
  moreButton.onClick = function () {
    ui.menuOpen = !ui.menuOpen;
    renderChrome();
  };
  speedMenu.onClick = function () {
    openExtra("speed");
  };
  presetMenu.onClick = function () {
    openExtra("preset");
  };
  unlinkMenu.onClick = function () {
    openExtra("unlink");
  };
  checkMenu.onClick = function () {
    ui.menuOpen = false;
    var context = VN.resolveContext();
    if (!context.instance) {
      setStatus("请选择一个生成的片段");
      renderChrome();
      return;
    }
    var result = VN.applyToTargets("instance", "VN Check", function (layer, comp) {
      return VN.checkLayer(layer, comp);
    });
    setStatus(result.ok ? "已检查当前片段" : result.message);
    showDetails(result.notes ? result.notes.join("\n") : "", result.ok);
    renderChrome();
  };
  infoMenu.onClick = function () {
    ui.menuOpen = false;
    if (!ui.inspection || !ui.inspection.ok) {
      setStatus("请先选择作品包");
      renderChrome();
      return;
    }
    showDetails(ui.inspection.details, true);
    renderChrome();
  };
  assetsMenu.onClick = function () {
    ui.menuOpen = false;
    renderChrome();
    if (!ui.inspection || !ui.inspection.packageRoot) {
      setStatus("请先选择作品包");
      return;
    }
    var folder = new Folder(ui.inspection.packageRoot.fsName + "/assets");
    if (!folder.exists) folder = ui.inspection.packageRoot;
    folder.execute();
  };
  extraClose.onClick = function () {
    ui.extraMode = "";
    renderChrome();
  };
  extraApply.onClick = function () {
    var scopeName = selectedScope();
    var result;
    if (ui.extraMode === "speed") {
      var speed = parseFloat(speedText.text);
      if (!(speed > 0)) {
        setStatus("速度倍率必须大于 0。");
        return;
      }
      var manual = keepManual.value;
      result = VN.applyToTargets(scopeName, "VN Apply Speed", function (layer, comp) {
        return VN.applySpeedToLayer(layer, comp, speed, manual);
      });
    } else if (ui.extraMode === "preset") {
      var preset = presetList.selection && presetList.selection.index === 1 ? "lines" : presetList.selection && presetList.selection.index === 2 ? "fade" : "typewriter";
      result = VN.applyToTargets(scopeName, "VN Apply Preset", function (layer, comp) {
        return VN.applyPresetToLayer(layer, comp, preset);
      });
    } else {
      result = VN.applyToTargets(scopeName, "VN Unlink Style", function (layer, comp) {
        return VN.unlinkStyle(layer, comp);
      });
    }
    ui.extraMode = "";
    setStatus(result.ok ? "已处理 " + result.notes.length + " 个文字层" : result.message);
    showDetails(result.notes ? result.notes.join("\n") : "", !!(result.notes && result.notes.length));
    renderChrome();
  };

  try {
    win.onClose = function () {
      VN._panel = null;
      VN._polling = false;
    };
  } catch (ignoreClose) {}

  VN.syncPanelContext = syncContext;
  layoutNow();
  fillRecent();
  setShown(menu, false);
  setShown(extraBox, false);
  setShown(detailsBox, false);
  setShown(textBox, false);
  applyInspection(null, null);
  ui.state = "empty";
  setStatus("选择一个作品包开始");
  renderChrome();
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
