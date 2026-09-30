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

