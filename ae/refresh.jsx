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
  var keys = VN.revealKeyframes(frames, meta.holdIn || 0);
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
  try {
    var compiled = VN.loadCompiled();
    if (compiled && compiled.timing) return { timing: compiled.timing, fps: compiled.fps };
  } catch (ignore) {}
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
