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
