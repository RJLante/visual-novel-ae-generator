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
