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
