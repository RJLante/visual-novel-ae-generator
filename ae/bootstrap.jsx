var VN = VN || {};

VN.main = function () {
  if (!$.fileName) {
    alert("请用「文件 > 脚本 > 运行脚本文件」执行，不要把脚本贴进控制台。");
    return;
  }
  var root = new File($.fileName).parent;
  VN.packageRoot = root;
  var manifestFile = new File(root.fsName + "/vn-package.json");
  var compiled;
  var displayName = "";
  var versionLabel = "";
  if (manifestFile.exists) {
    var inspected = VN.inspectPackage(manifestFile);
    if (!inspected.ok) {
      alert(inspected.message + "\n" + inspected.hint);
      return;
    }
    compiled = inspected.compiled;
    displayName = inspected.manifest.displayName;
    versionLabel = inspected.manifest.versionLabel;
  } else {
    compiled = VN.readJsonFile(new File(root.fsName + "/compiled.json"));
    displayName = compiled.name;
  }
  var result = VN.runImport({
    compiled: compiled,
    packageRoot: root,
    displayName: displayName,
    versionLabel: versionLabel,
    destination: "legacy",
    saveProject: app.project.numItems === 0,
    activeItem: app.project.activeItem,
    reportFile: new File(root.fsName + "/report.ae.json"),
    extendHost: false,
    targetComp: null,
    insertTime: null
  });
  VN.presentLegacyResult(result);
};

VN.presentLegacyResult = function (result) {
  var report = result.report || VN.blankReport();
  var summary = "字体缺失 " + report.fonts.length + "\n文字溢出 " + report.overflow.length + "\n表达式错误 " + report.expressionErrors.length;
  if (result.ok && result.details.indexOf("检查报告没有写入") !== -1) {
    alert("导入已经完成，但检查报告没有写入。\n" + summary);
    return;
  }
  if (result.ok) {
    var where = report.mode === "create" ? "已保存工程：\n" + report.saved : "已追加实例：\n" + report.instanceId + "\n现有工程没有自动保存。";
    var insertedNote = report.inserted ? "\n已插入：" + report.inserted : "";
    alert(where + insertedNote + "\n\n" + summary + "\n详见 report.ae.json");
    return;
  }
  alert("导入没有完成。\n" + result.message + "\n" + (result.cleanup || "") + "\n" + summary);
};
