var VN = VN || {};

// 与 src/timing.ts 的 appearFrame / planCharacters 保持同一套帧换算。
VN.isNewline = function (ch) {
  return ch === "\n" || ch === "\r";
};

VN.secondsToFrames = function (seconds, fps) {
  return Math.round(seconds * fps);
};

VN.appearFrame = function (visibleIndex, pauseFrames, charactersPerSecond, fps) {
  return Math.round((visibleIndex * fps) / charactersPerSecond) + pauseFrames;
};

VN.planCharacters = function (text, timing, fps) {
  var chars = [];
  var i;
  for (i = 0; i < text.length; i++) {
    var code = text.charCodeAt(i);
    if (code >= 0xD800 && code <= 0xDBFF) {
      throw new Error("文本含有扩展字符，无法按字符索引刷新");
    }
    chars.push(text.charAt(i));
  }

  var commaPauseFrames = VN.secondsToFrames(timing.commaPauseSeconds, fps);
  var sentencePauseFrames = VN.secondsToFrames(timing.sentencePauseSeconds, fps);
  var lineIntervalFrames = VN.secondsToFrames(timing.lineIntervalSeconds, fps);
  var fadeFrames = VN.secondsToFrames(timing.fadeSeconds, fps);
  var visible = [];
  for (i = 0; i < chars.length; i++) {
    if (!VN.isNewline(chars[i])) visible.push(i);
  }

  var revealFrames = [];
  for (i = 0; i < chars.length; i++) revealFrames.push(0);
  var pauseFrames = 0;
  var visibleIndex;
  for (visibleIndex = 0; visibleIndex < visible.length; visibleIndex++) {
    var charIndex = visible[visibleIndex];
    revealFrames[charIndex] = VN.appearFrame(visibleIndex, pauseFrames, timing.charactersPerSecond, fps);
    if (visibleIndex !== visible.length - 1) {
      var ch = chars[charIndex];
      if (timing.longPauseChars.indexOf(ch) !== -1) pauseFrames += sentencePauseFrames;
      else if (timing.shortPauseChars.indexOf(ch) !== -1) pauseFrames += commaPauseFrames;
    }
  }

  for (i = chars.length - 1; i >= 0; i--) {
    if (!VN.isNewline(chars[i])) continue;
    var nextFrame = null;
    var j;
    for (j = i + 1; j < chars.length; j++) {
      if (!VN.isNewline(chars[j])) {
        nextFrame = revealFrames[j];
        break;
      }
    }
    if (nextFrame === null) nextFrame = VN.appearFrame(visible.length, pauseFrames, timing.charactersPerSecond, fps);
    revealFrames[i] = nextFrame;
  }

  var linePlan = VN.lineCharacterFrames(chars, timing, fps, lineIntervalFrames);
  var lineFrames = linePlan.frames;
  var lineRevealFrames = linePlan.revealFrames;
  var typewriterRevealFrames = visible.length === 0 ? 0 : VN.appearFrame(visible.length, pauseFrames, timing.charactersPerSecond, fps);
  return {
    revealFrames: revealFrames,
    lineFrames: lineFrames,
    typewriterRevealFrames: typewriterRevealFrames,
    lineRevealFrames: lineRevealFrames,
    fadeFrames: fadeFrames
  };
};

VN.typeLine = function (chars, start, endExclusive, timing, fps, offset, frames) {
  var visible = [];
  var i;
  for (i = start; i < endExclusive; i++) {
    if (!VN.isNewline(chars[i])) visible.push(i);
  }
  var pauseFrames = 0;
  var commaPauseFrames = VN.secondsToFrames(timing.commaPauseSeconds, fps);
  var sentencePauseFrames = VN.secondsToFrames(timing.sentencePauseSeconds, fps);
  var visibleIndex;
  for (visibleIndex = 0; visibleIndex < visible.length; visibleIndex++) {
    var charIndex = visible[visibleIndex];
    frames[charIndex] = offset + VN.appearFrame(visibleIndex, pauseFrames, timing.charactersPerSecond, fps);
    if (visibleIndex !== visible.length - 1) {
      var ch = chars[charIndex];
      if (timing.longPauseChars.indexOf(ch) !== -1) pauseFrames += sentencePauseFrames;
      else if (timing.shortPauseChars.indexOf(ch) !== -1) pauseFrames += commaPauseFrames;
    }
  }
  if (visible.length === 0) return 0;
  return VN.appearFrame(visible.length, pauseFrames, timing.charactersPerSecond, fps);
};

VN.lineCharacterFrames = function (chars, timing, fps, lineIntervalFrames) {
  var frames = [];
  var i;
  for (i = 0; i < chars.length; i++) frames.push(0);
  var offset = 0;
  var index = 0;
  while (index < chars.length) {
    var lineStart = index;
    while (index < chars.length && !VN.isNewline(chars[index])) index += 1;
    var duration = VN.typeLine(chars, lineStart, index, timing, fps, offset, frames);
    if (index < chars.length) {
      var nextOffset = offset + duration + lineIntervalFrames;
      frames[index] = nextOffset;
      offset = nextOffset;
      index += 1;
    } else {
      offset += duration;
    }
  }
  return { frames: frames, revealFrames: offset };
};

VN.revealKeyframes = function (appearFrames, holdInFrames) {
  var keys = [];
  var countAt = function (frame) {
    var count = 0;
    var i;
    for (i = 0; i < appearFrames.length; i++) if (appearFrames[i] <= frame) count += 1;
    return count;
  };
  var push = function (frame, value) {
    var i;
    for (i = 0; i < keys.length; i++) {
      if (keys[i].frame === frame) {
        keys[i].value = value;
        return;
      }
    }
    keys.push({ frame: frame, value: value, interpolation: "hold" });
  };
  if (!appearFrames.length) {
    push(holdInFrames > 0 ? holdInFrames : 0, 0);
    return keys;
  }
  if (holdInFrames > 0) push(0, countAt(0));
  var seen = {};
  var unique = [];
  var n;
  for (n = 0; n < appearFrames.length; n++) {
    if (!seen[appearFrames[n]]) {
      seen[appearFrames[n]] = true;
      unique.push(appearFrames[n]);
    }
  }
  unique.sort(function (a, b) { return a - b; });
  for (n = 0; n < unique.length; n++) push(holdInFrames + unique[n], countAt(unique[n]));
  keys.sort(function (a, b) { return a.frame - b.frame; });
  return keys;
};
