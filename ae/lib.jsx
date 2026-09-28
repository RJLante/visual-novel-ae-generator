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
