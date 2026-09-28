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
      try { app.endUndoGroup(); } catch (ignore) {}
      return VN.finishOperation("speed", [VN.itemResult("failed", "rollback_failed", lock.instanceId, "速度调整失败，而且未能恢复。" + rollback.toString())]);
    }
    try { app.endUndoGroup(); } catch (ignoreEnd) {}
    return VN.finishOperation("speed", [VN.itemResult("failed", "write_failed", lock.instanceId, "未调整速度：写入失败，片段已恢复。" + err.toString())]);
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
      try { app.endUndoGroup(); } catch (ignore) {}
      return VN.finishOperation("style", [VN.itemResult("failed", "rollback_failed", lock.instanceId, "样式恢复失败。" + rollback.toString())]);
    }
    try { app.endUndoGroup(); } catch (ignoreEnd) {}
    return VN.finishOperation("style", [VN.itemResult("failed", "write_failed", lock.instanceId, "样式没有写入，已恢复。" + err.toString())]);
  }
  app.endUndoGroup();
  return VN.finishOperation("style", [VN.itemResult("updated", null, lock.instanceId, "样式已更新。")]);
};
