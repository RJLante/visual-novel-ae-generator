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

  var compiled;
  try {
    compiled = VN.loadCompiled();
  } catch (err) {
    alert(err.toString());
    return;
  }

  var notes = [];
  app.beginUndoGroup("VN Refresh Text Timing");
  var i;
  for (i = 0; i < comp.selectedLayers.length; i++) {
    try {
      notes.push(VN.refreshLayer(comp.selectedLayers[i], compiled));
    } catch (err) {
      notes.push(comp.selectedLayers[i].name + "：" + err.toString());
    }
  }
  app.endUndoGroup();
  alert(notes.join("\n"));
};

VN.refreshLayer = function (layer, compiled) {
  var textProps = layer.property("ADBE Text Properties");
  if (textProps === null) return layer.name + "：不是文字层，已跳过";
  var source = textProps.property("ADBE Text Document");
  var previous = source.expression;
  source.expression = "";
  var raw = source.value.text;
  source.expression = previous;

  var plan = VN.planCharacters(raw, compiled.timing, compiled.fps);
  var animators = textProps.property("ADBE Text Animators");
  var animator = null;
  var i;
  for (i = 1; i <= animators.numProperties; i++) {
    if (animators.property(i).name === "REVEAL") animator = animators.property(i);
  }
  if (animator === null) return layer.name + "：没有找到 REVEAL 动画器";
  var selectors = animator.property("ADBE Text Selectors");
  var selector = null;
  for (i = 1; i <= selectors.numProperties; i++) {
    if (selectors.property(i).name === "REVEAL_RANGE") selector = selectors.property(i);
  }
  if (selector === null) return layer.name + "：没有找到 REVEAL_RANGE";
  var start = selector.property("ADBE Text Index Start");
  if (start === null || !start.expression) return layer.name + "：打字进度表达式不存在";

  var eventMatch = start.expression.match(/\/\*VN_EVENT\*\/(\d+)\/\*VN_END\*\//);
  if (!eventMatch) return layer.name + "：这不是生成器写入的文字层";
  var eventFrames = parseInt(eventMatch[1], 10);
  var next = VN.replaceMarker(start.expression, "VN_REVEAL", VN.frameList(plan.revealFrames));
  next = VN.replaceMarker(next, "VN_LINES", VN.frameList(plan.lineFrames));
  if (next === null) return layer.name + "：进度标记已损坏，请重新生成工程";
  start.expression = next;

  var warnings = [];
  if (plan.typewriterRevealFrames > eventFrames) {
    warnings.push("打字需要 " + plan.typewriterRevealFrames + " 帧，事件只有 " + eventFrames + " 帧");
  }
  if (plan.lineRevealFrames > eventFrames) {
    warnings.push("逐行需要 " + plan.lineRevealFrames + " 帧，事件只有 " + eventFrames + " 帧");
  }
  if (warnings.length) return layer.name + "：已刷新进度，但时长不足，请重新生成工程。 " + warnings.join("；");
  return layer.name + "：已按当前文字刷新打字进度";
};

VN.frameList = function (frames) {
  return "[" + frames.join(",") + "]";
};

VN.replaceMarker = function (expression, marker, literal) {
  var pattern = new RegExp("/\\*" + marker + "\\*/\\[[^\\]]*\\]/\\*VN_END\\*/");
  if (!pattern.test(expression)) return null;
  return expression.replace(pattern, "/*" + marker + "*/" + literal + "/*VN_END*/");
};
