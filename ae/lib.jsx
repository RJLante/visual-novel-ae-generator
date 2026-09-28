var VN = VN || {};

VN.requireProp = function (group, matchName) {
  var prop = group.property(matchName);
  if (prop === null) {
    throw new Error("找不到属性 " + matchName + "。请确认这是 After Effects 2021 或更新版本。");
  }
  return prop;
};

VN.addComp = function (folder, name, width, height, frames, fps) {
  var comp = app.project.items.addComp(name, width, height, 1, Math.max(frames, 1) / fps, fps);
  comp.duration = frames * comp.frameDuration;
  if (folder && folder !== app.project.rootFolder) comp.parentFolder = folder;
  return comp;
};

VN.scriptFolder = function () {
  if (!$.fileName) {
    throw new Error("请用「文件 > 脚本 > 运行脚本文件」执行，不要把脚本贴进控制台。");
  }
  return new File($.fileName).parent;
};

VN.readJsonFile = function (file) {
  if (!file.exists) throw new Error("找不到文件：" + file.fsName);
  file.encoding = "UTF-8";
  if (!file.open("r")) throw new Error("无法读取：" + file.fsName);
  var text = file.read();
  file.close();
  if (text.length && text.charCodeAt(0) === 65279) text = text.substring(1);
  if (typeof JSON === "undefined" || !JSON.parse) {
    throw new Error("脚本环境没有 JSON.parse。请使用 After Effects 2021 或更新版本。");
  }
  return JSON.parse(text);
};

VN.loadCompiled = function () {
  var file = new File(VN.scriptFolder().fsName + "/compiled.json");
  return VN.readJsonFile(file);
};

VN.writeJsonFile = function (file, value) {
  file.encoding = "UTF-8";
  if (!file.open("w")) throw new Error("无法写入：" + file.fsName);
  file.write(JSON.stringify(value, null, 2));
  file.close();
};

VN.frameTime = function (comp, frame) {
  return frame * comp.frameDuration;
};

VN.META_BEGIN = "[[VN]]";
VN.META_END = "[[/VN]]";
VN.REVEAL_END_INDEX = 99999;
VN.MAX_ITEM_NAME = 31;

VN.bindExpression = function (expression, names) {
  if (!expression) return "";
  return String(expression).replace(/\{\{comp:([^}]+)\}\}/g, function (_all, id) {
    var name = names[id];
    if (!name) throw new Error("表达式引用了还没有创建的合成：" + id);
    return name;
  });
};

VN.stripMeta = function (comment) {
  if (!comment) return "";
  var start = comment.indexOf(VN.META_BEGIN);
  if (start === -1) return comment;
  var end = comment.indexOf(VN.META_END, start);
  if (end === -1) return comment;
  var kept = comment.substring(0, start) + comment.substring(end + VN.META_END.length);
  return kept.replace(/^\s+|\s+$/g, "");
};

VN.readMeta = function (comment) {
  if (!comment) return null;
  var start = comment.indexOf(VN.META_BEGIN);
  if (start === -1) return null;
  var end = comment.indexOf(VN.META_END, start);
  if (end === -1) return null;
  try {
    return JSON.parse(comment.substring(start + VN.META_BEGIN.length, end));
  } catch (err) {
    return null;
  }
};

VN.writeMeta = function (item, meta, userNote) {
  var note = VN.stripMeta(userNote !== undefined ? userNote : item.comment);
  var payload = VN.META_BEGIN + JSON.stringify(meta) + VN.META_END;
  item.comment = note ? note + "\n" + payload : payload;
};

VN.compactKeys = function (keys) {
  if (!keys || !keys.length) return undefined;
  var out = [];
  var i;
  for (i = 0; i < keys.length; i++) out.push([keys[i].frame, keys[i].value, keys[i].interpolation || "hold"]);
  return out;
};

VN.expandKeys = function (compact, fallback) {
  if (!compact) return [];
  var out = [];
  var i;
  for (i = 0; i < compact.length; i++) {
    out.push({ frame: compact[i][0], value: compact[i][1], interpolation: compact[i][2] || fallback || "hold" });
  }
  return out;
};

VN.interpolationType = function (name) {
  if (name === "linear") return KeyframeInterpolationType.LINEAR;
  if (name === "bezier") return KeyframeInterpolationType.BEZIER;
  return KeyframeInterpolationType.HOLD;
};

VN.interpolationName = function (kind) {
  if (kind === KeyframeInterpolationType.LINEAR) return "linear";
  if (kind === KeyframeInterpolationType.BEZIER) return "bezier";
  return "hold";
};

VN.clearKeys = function (prop) {
  while (prop.numKeys > 0) prop.removeKey(1);
};

VN.applyScalarKeys = function (prop, comp, keys) {
  if (prop.expression) prop.expression = "";
  VN.clearKeys(prop);
  var i;
  for (i = 0; i < keys.length; i++) {
    prop.setValueAtTime(VN.frameTime(comp, keys[i].frame), keys[i].value);
  }
  for (i = 0; i < keys.length; i++) {
    var interp = VN.interpolationType(keys[i].interpolation);
    prop.setInterpolationTypeAtKey(i + 1, interp, interp);
  }
};

VN.readScalarKeys = function (prop, comp) {
  var keys = [];
  var i;
  for (i = 1; i <= prop.numKeys; i++) {
    keys.push({
      frame: Math.round(prop.keyTime(i) / comp.frameDuration),
      value: prop.keyValue(i),
      interpolation: VN.interpolationName(prop.keyInInterpolationType(i))
    });
  }
  return keys;
};

VN.keysMatch = function (live, stored) {
  if (!stored) return live.length === 0;
  if (live.length !== stored.length) return false;
  var i;
  for (i = 0; i < live.length; i++) {
    if (live[i].frame !== stored[i][0]) return false;
    if (Math.abs(live[i].value - stored[i][1]) > 0.001) return false;
    if (live[i].interpolation !== (stored[i][2] || "hold")) return false;
  }
  return true;
};

VN.usedItemNames = function () {
  var used = {};
  var i;
  for (i = 1; i <= app.project.numItems; i++) used[app.project.item(i).name] = true;
  return used;
};

VN.fitItemName = function (name, used) {
  var fitted = String(name);
  if (fitted.length > VN.MAX_ITEM_NAME) fitted = fitted.substring(0, VN.MAX_ITEM_NAME);
  var base = fitted;
  var n = 2;
  while (used[fitted]) {
    var suffix = String(n);
    var room = VN.MAX_ITEM_NAME - suffix.length;
    if (room < 1) room = 1;
    fitted = base.substring(0, room) + suffix;
    n++;
  }
  used[fitted] = true;
  return fitted;
};

VN.randomTag = function () {
  var chars = "0123456789abcdef";
  var tag = "";
  var i;
  for (i = 0; i < 4; i++) tag += chars.charAt(Math.floor(Math.random() * chars.length));
  return tag;
};

VN.projectTag = function (projectId) {
  var cleaned = String(projectId || "").replace(/[^A-Za-z0-9]/g, "");
  if (!cleaned.length) cleaned = "proj";
  if (cleaned.length >= 4) return cleaned.substring(0, 4);
  while (cleaned.length < 4) cleaned += "0";
  return cleaned;
};

VN.selectorProp = function (selector, matchName) {
  var prop = selector.property(matchName);
  if (prop === null) {
    var advanced = selector.property("ADBE Text Range Advanced");
    if (advanced !== null) prop = advanced.property(matchName);
  }
  return prop;
};
