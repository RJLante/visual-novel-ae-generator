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
