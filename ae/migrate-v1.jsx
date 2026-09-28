var VN = VN || {};

VN.migrate = function () {
  var comp = app.project.activeItem;
  if (!(comp instanceof CompItem)) {
    alert("请先打开要迁移的合成。");
    return;
  }
  var layers = [];
  var i;
  if (comp.selectedLayers.length) {
    for (i = 0; i < comp.selectedLayers.length; i++) layers.push(comp.selectedLayers[i]);
  } else {
    for (i = 1; i <= comp.numLayers; i++) layers.push(comp.layer(i));
  }

  var notes = [];
  app.beginUndoGroup("VN Migrate V1 Text");
  for (i = 0; i < layers.length; i++) {
    try {
      notes.push(VN.migrateLayer(layers[i], comp));
    } catch (err) {
      notes.push(layers[i].name + "：" + err.toString());
    }
  }
  app.endUndoGroup();
  alert(notes.join("\n"));
};

VN.migrateLayer = function (layer, comp) {
  if (layer.property("ADBE Text Properties") === null) return layer.name + "：不是文字层，已跳过";
  var existing = VN.readMeta(layer.comment);
  if (existing && existing.v === 2) return layer.name + "：已经是第二版关键帧，已跳过";
  var selector = VN.findRevealSelector(layer);
  if (!selector) return layer.name + "：没有第一版 REVEAL 动画器，已跳过";
  var start = VN.selectorProp(selector, "ADBE Text Index Start");
  var end = VN.selectorProp(selector, "ADBE Text Index End");
  var amount = selector.property("ADBE Text Selector Max Amount");
  if (start === null || !start.expression || start.expression.indexOf("VN_REVEAL") === -1) {
    return layer.name + "：不是第一版生成器写入的打字表达式，已跳过";
  }
  if (start.numKeys > 0) return layer.name + "：Start 上已有关键帧，已跳过";

  var revealFrames = VN.parseMarked(start.expression, "VN_REVEAL");
  var lineFrames = VN.parseMarked(start.expression, "VN_LINES");
  var preset = VN.parseNumber(start.expression, "presetMode");
  var fps = VN.parseNumber(start.expression, "FPS");
  var holdIn = VN.parseNumber(start.expression, "HOLD_IN");
  if (!revealFrames || !lineFrames || preset === null || !fps) return layer.name + "：进度标记无法读取，已跳过";

  var control = VN.controlFromExpression(start.expression);
  var samples = VN.sampleFrames(layer, comp);
  var computed = [];
  var s;
  for (s = 0; s < samples.length; s++) {
    var mode = VN.modeAt(control, samples[s], preset);
    var speed = VN.speedAt(control, samples[s]);
    var local = Math.floor((samples[s] - layer.inPoint) * fps * speed + 0.0001) - holdIn;
    if (local < 0) local = 0;
    var frames = mode === 3 ? lineFrames : revealFrames;
    var count = 0;
    if (mode !== 2) {
      var n;
      for (n = 0; n < frames.length; n++) if (local >= frames[n]) count += 1;
    }
    var actual = start.valueAtTime(samples[s], false);
    if (Math.abs(actual - count) > 0.51) {
      return layer.name + "：采样和第一版公式不一致，没有改动";
    }
    computed.push({ time: samples[s], frame: Math.round(samples[s] / comp.frameDuration), value: count, mode: mode });
  }

  var backup = {
    start: start.expression,
    end: end ? end.expression : "",
    amount: amount ? amount.expression : ""
  };
  var opacity = VN.requireProp(VN.requireProp(layer, "ADBE Transform Group"), "ADBE Opacity");
  backup.opacity = opacity.expression;
  var opacityPlan = VN.planOpacityMigration(opacity, backup.opacity, control, layer, fps, holdIn, computed);
  try {
    var startKeys = VN.holdChanges(computed);
    VN.applyScalarKeys(start, comp, startKeys);
    VN.applyModeChannels(end, amount, comp, computed);
    if (opacityPlan) {
      if (opacityPlan.keys) VN.applyScalarKeys(opacity, comp, opacityPlan.keys);
      opacity.expression = opacityPlan.expression;
    }
    if (!VN.verifyStart(start, computed) || (opacityPlan && !VN.verifyOpacity(opacity, opacityPlan))) {
      throw new Error("转换后的采样和转换前不一致");
    }
  } catch (err) {
    VN.restoreProperty(start, backup.start);
    if (end) VN.restoreProperty(end, backup.end);
    if (amount) VN.restoreProperty(amount, backup.amount);
    VN.restoreProperty(opacity, backup.opacity);
    return layer.name + "：迁移失败，已恢复表达式。" + err.toString();
  }
  return layer.name + "：已把动画表达式转成关键帧，样式表达式仍保留";
};

VN.parseMarked = function (expression, marker) {
  var match = expression.match(new RegExp("/\\*" + marker + "\\*/([\\s\\S]*?)/\\*VN_END\\*/"));
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch (err) {
    return null;
  }
};

VN.parseNumber = function (expression, name) {
  var match = expression.match(new RegExp("var " + name + " = (-?\\d+)"));
  if (!match) return null;
  return parseInt(match[1], 10);
};

VN.controlFromExpression = function (expression) {
  var match = expression.match(/comp\("([^"]+)"\)/);
  if (!match) return null;
  var i;
  for (i = 1; i <= app.project.numItems; i++) {
    var item = app.project.item(i);
    if (item instanceof CompItem && item.name === match[1]) {
      var layer;
      var n;
      for (n = 1; n <= item.numLayers; n++) {
        layer = item.layer(n);
        if (layer.name === "CTRL") return layer;
      }
    }
  }
  return null;
};

VN.effectAt = function (control, effectName, time, fallback) {
  if (!control) return fallback;
  var parade = control.property("ADBE Effect Parade");
  if (parade === null) return fallback;
  var i;
  for (i = 1; i <= parade.numProperties; i++) {
    if (parade.property(i).name !== effectName) continue;
    var prop = parade.property(i).property(1);
    if (prop === null) return fallback;
    return prop.valueAtTime(time, false);
  }
  return fallback;
};

VN.modeAt = function (control, time, preset) {
  var slider = Math.round(VN.effectAt(control, "文字动画模式", time, 0));
  return slider === 0 ? preset : slider;
};

VN.speedAt = function (control, time) {
  var speed = VN.effectAt(control, "预览速度", time, 1);
  if (speed < 0.01) speed = 0.01;
  return speed;
};

VN.sampleFrames = function (layer, comp) {
  var times = [];
  var t = layer.inPoint;
  var guard = 0;
  while (t < layer.outPoint - comp.frameDuration * 0.25 && guard < 100000) {
    times.push(t);
    t += comp.frameDuration;
    guard += 1;
  }
  if (!times.length) times.push(layer.inPoint);
  return times;
};

VN.holdChanges = function (samples) {
  var keys = [];
  var i;
  for (i = 0; i < samples.length; i++) {
    if (i > 0 && samples[i].value === samples[i - 1].value && samples[i].frame === samples[i - 1].frame) continue;
    if (i > 0 && samples[i].value === samples[i - 1].value) continue;
    keys.push({ frame: samples[i].frame, value: samples[i].value, interpolation: "hold" });
  }
  if (!keys.length) keys.push({ frame: 0, value: 0, interpolation: "hold" });
  return keys;
};

VN.applyModeChannels = function (end, amount, comp, samples) {
  var endKeys = [];
  var amountKeys = [];
  var i;
  for (i = 0; i < samples.length; i++) {
    var endValue = samples[i].mode === 2 ? 0 : VN.REVEAL_END_INDEX;
    var amountValue = samples[i].mode === 2 ? 0 : 100;
    if (!endKeys.length || endKeys[endKeys.length - 1].value !== endValue) {
      endKeys.push({ frame: samples[i].frame, value: endValue, interpolation: "hold" });
    }
    if (!amountKeys.length || amountKeys[amountKeys.length - 1].value !== amountValue) {
      amountKeys.push({ frame: samples[i].frame, value: amountValue, interpolation: "hold" });
    }
  }
  if (end) {
    if (endKeys.length <= 1) {
      if (end.expression) end.expression = "";
      VN.clearKeys(end);
      end.setValue(endKeys.length ? endKeys[0].value : VN.REVEAL_END_INDEX);
    } else VN.applyScalarKeys(end, comp, endKeys);
  }
  if (amount) {
    if (amountKeys.length <= 1) {
      if (amount.expression) amount.expression = "";
      VN.clearKeys(amount);
      amount.setValue(amountKeys.length ? amountKeys[0].value : 100);
    } else VN.applyScalarKeys(amount, comp, amountKeys);
  }
};

VN.planOpacityMigration = function (opacity, expression, control, layer, fps, holdIn, computed) {
  if (!expression || expression.indexOf("FADE_FRAMES") === -1) return null;
  var fadeFrames = VN.parseNumber(expression, "FADE_FRAMES");
  if (fadeFrames === null) return null;
  if (opacity.numKeys > 0) return null;
  var base = opacity.value;
  var call = 'comp("CONTROL").layer("CTRL").effect("全局文字不透明度")(1)';
  var match = expression.match(/comp\("([^"]+)"\)\.layer\("([^"]+)"\)\.effect\("全局文字不透明度"\)\(1\)/);
  if (match) call = 'comp("' + match[1] + '").layer("' + match[2] + '").effect("全局文字不透明度")(1)';
  var keys = [];
  var expected = [];
  var times = [];
  var i;
  var varies = false;
  for (i = 0; i < computed.length; i++) {
    var speed = VN.speedAt(control, computed[i].time);
    var local = Math.floor((computed[i].time - layer.inPoint) * fps * speed + 0.0001) - holdIn;
    if (local < 0) local = 0;
    var anim = 100;
    if (computed[i].mode === 2) anim = fadeFrames <= 0 ? 100 : Math.max(0, Math.min(100, (local / fadeFrames) * 100));
    if (Math.abs(anim - 100) > 0.001) varies = true;
    var value = base * (anim / 100);
    if (!keys.length || Math.abs(keys[keys.length - 1].value - value) > 0.001) {
      keys.push({ frame: computed[i].frame, value: value, interpolation: "hold" });
    }
    var globalOp = VN.effectAt(control, "全局文字不透明度", computed[i].time, 100);
    expected.push(base * (globalOp / 100) * (anim / 100));
    times.push(computed[i].time);
  }
  return {
    keys: varies ? keys : null,
    expression: "var globalOp = " + call + ";\nvalue * (globalOp / 100);",
    expected: expected,
    times: times
  };
};

VN.verifyStart = function (start, computed) {
  var i;
  for (i = 0; i < computed.length; i++) {
    if (Math.abs(start.valueAtTime(computed[i].time, false) - computed[i].value) > 0.51) return false;
  }
  return true;
};

VN.verifyOpacity = function (opacity, plan) {
  var i;
  for (i = 0; i < plan.expected.length; i++) {
    if (Math.abs(opacity.valueAtTime(plan.times[i], false) - plan.expected[i]) > 0.75) return false;
  }
  return true;
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

VN.restoreProperty = function (prop, expression) {
  if (!prop) return;
  VN.clearKeys(prop);
  prop.expression = expression || "";
};
