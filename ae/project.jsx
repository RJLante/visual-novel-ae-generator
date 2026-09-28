var VN = VN || {};

VN.ensureVersion = function () {
  var major = parseInt(app.version, 10);
  if (isNaN(major) || major < 18) {
    throw new Error("需要 After Effects 2021 或更新版本。当前版本号是 " + app.version + "。");
  }
};

VN.ensureEmptyProject = function () {
  if (app.project.numItems === 0) return;
  var names = [];
  var limit = Math.min(app.project.numItems, 8);
  var i;
  for (i = 1; i <= limit; i++) names.push(app.project.item(i).name);
  var suffix = app.project.numItems > limit ? " 等，共 " + app.project.numItems + " 项" : "";
  throw new Error("请从空项目运行。当前项目里已有：" + names.join("、") + suffix + "。请用「文件 > 新建 > 新建项目」，确认项目面板是空的后再运行。不要用「新建合成」。");
};

VN.setExpressionEngine = function () {
  if (app.project.expressionEngine === undefined) {
    throw new Error("无法切换 JavaScript 表达式引擎。After Effects 2021 需要这个引擎，文字样式表达式才会生效。");
  }
  app.project.expressionEngine = "javascript-1.0";
};

VN.buildProject = function (compiled, report) {
  var folders = { ROOT: app.project.rootFolder };
  var i;
  for (i = 0; i < compiled.folders.length; i++) {
    folders[compiled.folders[i]] = app.project.items.addFolder(compiled.folders[i]);
  }

  var assets = {};
  for (i = 0; i < compiled.assets.length; i++) {
    var asset = compiled.assets[i];
    var file = new File(asset.absolutePath);
    if (!file.exists) throw new Error("素材不存在：" + asset.absolutePath);
    var options = new ImportOptions(file);
    if (!options.canImportAs(ImportAsType.FOOTAGE)) throw new Error("无法作为素材导入：" + asset.absolutePath);
    options.importAs = ImportAsType.FOOTAGE;
    var footage = app.project.importFile(options);
    footage.name = asset.id;
    footage.parentFolder = folders.ASSETS;
    assets[asset.id] = footage;
  }

  var comps = {};
  for (i = 0; i < compiled.comps.length; i++) {
    var spec = compiled.comps[i];
    var comp = VN.addComp(folders[spec.folder] || folders.ROOT, spec.name, spec.width, spec.height, spec.durationFrames, compiled.fps);
    comps[spec.name] = comp;
    VN.fillComp(comp, spec, assets, comps, folders, report);
  }
  return comps[compiled.masterName];
};

VN.saveProject = function (compiled) {
  var out = new File(VN.scriptFolder().fsName + "/" + compiled.saveFileName);
  app.project.save(out);
  return out;
};
