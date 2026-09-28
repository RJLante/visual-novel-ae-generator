var VN = VN || {};

VN.segmentText = function (text) {
  var units = [];
  var source = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  var aeIndex = 0;
  var i = 0;
  while (i < source.length) {
    if (source.charCodeAt(i) === 10) {
      aeIndex += 1;
      i += 1;
      continue;
    }
    var mark = VN.readCluster(source, i);
    units.push({ text: mark.text, aeIndex: aeIndex, aeLength: mark.aeLength });
    aeIndex += mark.aeLength;
    i += mark.aeLength;
  }
  return { units: units, aeLength: aeIndex };
};

VN.readCluster = function (text, index) {
  var code = text.charCodeAt(index);
  var aeLength = 1;
  var chunk = text.charAt(index);
  if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
    chunk = text.substring(index, index + 2);
    aeLength = 2;
  }
  var cursor = index + aeLength;
  while (cursor < text.length && VN.extendsCluster(text, cursor)) {
    var extra = text.charCodeAt(cursor) >= 0xd800 && text.charCodeAt(cursor) <= 0xdbff ? 2 : 1;
    chunk += text.substring(cursor, cursor + extra);
    aeLength += extra;
    cursor += extra;
  }
  return { text: chunk, aeLength: aeLength };
};

VN.extendsCluster = function (text, index) {
  var code = text.charCodeAt(index);
  if (code === 10 || code === 13) return false;
  if (code === 0x200d) return true;
  if (index > 0 && text.charCodeAt(index - 1) === 0x200d) return true;
  if (code === 0xfe0e || code === 0xfe0f) return true;
  if (code >= 0x0300 && code <= 0x036f) return true;
  if (code >= 0x1ab0 && code <= 0x1aff) return true;
  if (code >= 0x1dc0 && code <= 0x1dff) return true;
  if (code >= 0x20d0 && code <= 0x20ff) return true;
  if (code >= 0xfe20 && code <= 0xfe2f) return true;
  return false;
};

VN.pausesForText = function (text, commaFrames, sentenceFrames) {
  var units = VN.segmentText(text).units;
  var pauses = [];
  var longChars = ".?!。？！…";
  var shortChars = ",;:，；：、";
  var i;
  for (i = 0; i < units.length - 1; i++) {
    if (longChars.indexOf(units[i].text) !== -1) pauses.push({ afterUnit: i, frames: sentenceFrames });
    else if (shortChars.indexOf(units[i].text) !== -1) pauses.push({ afterUnit: i, frames: commaFrames });
  }
  return pauses;
};

VN.quantizeShared = function (frames, speed) {
  var map = {};
  var order = [];
  var i;
  for (i = 0; i < frames.length; i++) {
    var frame = frames[i];
    var key = String(frame);
    if (map[key] === undefined) {
      map[key] = Math.round(frame / speed);
      order.push(frame);
    }
  }
  return { map: map, order: order, speed: speed };
};

VN.lookupFrame = function (shared, frame) {
  var found = shared.map[String(frame)];
  if (found === undefined) return Math.round(frame / (shared.speed || 1));
  return found;
};

VN.buildAnimationPlan = function (text, effect, speed, timing, availableTime) {
  if (!(speed > 0)) throw new Error("速度倍率必须大于 0");
  var segmented = VN.segmentText(text);
  var pauses = timing.pauses || [];
  var relative = [];
  var carried = 0;
  var i;
  for (i = 0; i < segmented.units.length; i++) {
    relative.push(Math.round((i * timing.fps) / timing.charactersPerSecond) + carried);
    var p;
    for (p = 0; p < pauses.length; p++) if (pauses[p].afterUnit === i) carried += pauses[p].frames;
  }
  var aeAppear = [];
  for (i = 0; i < segmented.aeLength; i++) aeAppear.push(0);
  for (i = 0; i < segmented.units.length; i++) {
    var unit = segmented.units[i];
    var n;
    for (n = 0; n < unit.aeLength; n++) aeAppear[unit.aeIndex + n] = relative[i];
  }
  for (i = 0; i < segmented.aeLength; i++) {
    if (VN.unitCovers(segmented.units, i)) continue;
    var next = null;
    var u;
    for (u = 0; u < segmented.units.length; u++) {
      if (segmented.units[u].aeIndex > i) {
        next = segmented.units[u];
        aeAppear[i] = relative[u];
        break;
      }
    }
    if (!next && relative.length) aeAppear[i] = relative[relative.length - 1];
  }
  var holdIn = timing.holdInFrames || 0;
  var baseReveal = VN.revealKeyframes(aeAppear, holdIn);
  var fadeSpan = timing.characterFadeFrames || 0;
  var baseFade = [];
  for (i = 0; i < segmented.units.length; i++) {
    baseFade.push(VN.fadeKeys(holdIn + relative[i], fadeSpan));
  }
  var pauseSum = 0;
  for (i = 0; i < pauses.length; i++) pauseSum += pauses[i].frames;
  var typewriterEnd = holdIn + Math.round((segmented.units.length * timing.fps) / timing.charactersPerSecond) + pauseSum;
  var lastRelative = relative.length ? relative[relative.length - 1] : 0;
  var fadeCompletion = holdIn + lastRelative + fadeSpan;
  var boundaries = [typewriterEnd, fadeCompletion, holdIn, 0];
  for (i = 0; i < baseReveal.length; i++) boundaries.push(baseReveal[i].frame);
  for (i = 0; i < baseFade.length; i++) {
    for (n = 0; n < baseFade[i].length; n++) boundaries.push(baseFade[i][n].frame);
  }
  var shared = VN.quantizeShared(boundaries, speed);
  var revealKeys = VN.remapKeys(baseReveal, shared);
  var fadeTracks = [];
  if (effect === "characterFade") {
    for (i = 0; i < segmented.units.length; i++) {
      fadeTracks.push({
        aeIndex: segmented.units[i].aeIndex,
        aeLength: segmented.units[i].aeLength,
        keys: VN.remapKeys(baseFade[i], shared)
      });
    }
  }
  var lastReveal = revealKeys.length ? revealKeys[revealKeys.length - 1].frame : 0;
  var completion = effect === "characterFade" ? VN.lookupFrame(shared, fadeCompletion) : lastReveal;
  var required = effect === "characterFade" ? completion : VN.lookupFrame(shared, typewriterEnd);
  return {
    effect: effect,
    units: segmented.units,
    pauses: pauses,
    revealKeys: revealKeys,
    fadeTracks: fadeTracks,
    completionFrame: completion,
    requiredFrames: required,
    fits: required <= availableTime
  };
};

VN.fadeKeys = function (start, fadeFrames) {
  if (fadeFrames <= 0) return [{ frame: start, value: 100, interpolation: "linear" }];
  if (start <= 0) {
    return [
      { frame: 0, value: 0, interpolation: "linear" },
      { frame: fadeFrames, value: 100, interpolation: "linear" }
    ];
  }
  return [
    { frame: 0, value: 0, interpolation: "linear" },
    { frame: start, value: 0, interpolation: "linear" },
    { frame: start + fadeFrames, value: 100, interpolation: "linear" }
  ];
};

VN.remapKeys = function (keys, shared) {
  var frames = [];
  var byFrame = {};
  var i;
  for (i = 0; i < keys.length; i++) {
    var frame = VN.lookupFrame(shared, keys[i].frame);
    if (byFrame[frame] === undefined) frames.push(frame);
    byFrame[frame] = { frame: frame, value: keys[i].value, interpolation: keys[i].interpolation || "hold" };
  }
  frames.sort(function (a, b) { return a - b; });
  var out = [];
  for (i = 0; i < frames.length; i++) out.push(byFrame[frames[i]]);
  return out;
};

VN.unitCovers = function (units, aeIndex) {
  var i;
  for (i = 0; i < units.length; i++) {
    if (aeIndex >= units[i].aeIndex && aeIndex < units[i].aeIndex + units[i].aeLength) return true;
  }
  return false;
};

VN.mapBaselineFrames = function (frames, speed) {
  return VN.quantizeShared(frames, speed);
};
