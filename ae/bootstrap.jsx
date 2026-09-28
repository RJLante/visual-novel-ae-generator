var VN = VN || {};

VN.main = function () {
  var report = {
    ok: false,
    saved: "",
    errors: [],
    warnings: [],
    fonts: [],
    overflow: [],
    expressionErrors: []
  };
  var suppressed = false;
  try {
    app.beginSuppressDialogs();
    suppressed = true;
  } catch (ignore) {}

  app.beginUndoGroup("VN AE Generate");
  var started = false;
  try {
    VN.ensureVersion();
    if (typeof JSON === "undefined") {
      throw new Error("这个 After Effects 的脚本环境无法解析 JSON。");
    }
    VN.ensureEmptyProject();
    started = true;
    VN.setExpressionEngine();
    var compiled = VN.loadCompiled();
    VN.buildProject(compiled, report);
    var saved = VN.saveProject(compiled);
    report.saved = saved.fsName;
    report.ok = report.expressionErrors.length === 0;
    if (report.fonts.length) {
      report.warnings.push("有字体在这台机器的 AE 里不可用。素材包里的字体文件不会自动安装，请改用已安装字体的 PostScript 名称。");
    }
    if (report.overflow.length) {
      report.warnings.push("有文字超出文本框。请拆段或调小字号，生成器不会自动压缩。");
    }
  } catch (err) {
    report.ok = false;
    report.errors.push(err.toString());
  }
  app.endUndoGroup();
  if (started && report.errors.length > 0) {
    try {
      app.executeCommand(16);
    } catch (ignoreUndo) {}
  }
  if (suppressed) {
    try {
      app.endSuppressDialogs(false);
    } catch (ignoreEnd) {}
  }

  try {
    VN.writeJsonFile(new File(VN.scriptFolder().fsName + "/report.ae.json"), report);
  } catch (writeErr) {
    report.ok = false;
    report.errors.push(writeErr.toString());
  }

  var summary = "字体缺失 " + report.fonts.length + "\n文字溢出 " + report.overflow.length + "\n表达式错误 " + report.expressionErrors.length + "\n详见 report.ae.json";
  if (report.ok) {
    alert("已保存工程：\n" + report.saved + "\n\n" + summary);
  } else {
    alert("生成没有完成。\n" + report.errors.join("\n") + "\n" + summary);
  }
};
