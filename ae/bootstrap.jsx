var VN = VN || {};

VN.main = function () {
  var report = {
    ok: false,
    mode: "",
    saved: "",
    instanceId: "",
    inserted: "",
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

  var releaseDialogs = function () {
    if (!suppressed) return;
    suppressed = false;
    try {
      app.endSuppressDialogs(false);
    } catch (ignoreEnd) {}
  };

  app.beginUndoGroup("VN AE Import");
  var ctx = null;
  var imported = false;
  try {
    VN.ensureVersion();
    if (typeof JSON === "undefined") {
      throw new Error("这个 After Effects 的脚本环境无法解析 JSON。");
    }
    var compiled = VN.loadCompiled();
    if (compiled.schemaVersion !== 2) {
      throw new Error("这份生成包不是第二版。请重新执行 vn-ae build。");
    }
    report.mode = app.project.numItems === 0 ? "create" : "append";
    var host = app.project.activeItem;
    if (report.mode === "append") VN.ensureExpressionEngineCompatible();
    else VN.setExpressionEngine();
    ctx = {};
    VN.prepareInstance(ctx, compiled);
    report.instanceId = ctx.instanceId;
    var master = VN.buildProject(compiled, report, ctx);
    imported = true;
    if (report.mode === "create") {
      var saved = VN.saveProject(compiled);
      report.saved = saved.fsName;
    }
    if (report.expressionErrors.length === 0 && report.fonts.length) {
      report.warnings.push("有字体在这台机器的 AE 里不可用。素材包里的字体文件不会自动安装，请改用已安装字体的 PostScript 名称。");
    }
    if (report.overflow.length) {
      report.warnings.push("有文字超出文本框。请拆段或调小字号，生成器不会自动压缩。");
    }
    releaseDialogs();
    if (report.mode === "append" && report.expressionErrors.length === 0) {
      try {
        VN.offerInsert(host, master, compiled, ctx, report);
      } catch (insertErr) {
        var inserted = ctx.insertedLayers || [];
        var n;
        for (n = inserted.length - 1; n >= 0; n--) {
          try {
            inserted[n].remove();
          } catch (ignoreInsert) {}
        }
        ctx.insertedLayers = [];
        report.errors.push("插入当前合成失败，实例已保留：" + insertErr.toString());
      }
    }
  } catch (err) {
    report.errors.push(err.toString());
    if (ctx) VN.rollbackImport(ctx);
    imported = false;
  }
  app.endUndoGroup();
  releaseDialogs();

  report.ok = imported && report.errors.length === 0 && report.expressionErrors.length === 0;
  var reportError = "";
  try {
    VN.writeJsonFile(new File(VN.scriptFolder().fsName + "/report.ae.json"), report);
  } catch (writeErr) {
    reportError = writeErr.toString();
  }

  var summary = "字体缺失 " + report.fonts.length + "\n文字溢出 " + report.overflow.length + "\n表达式错误 " + report.expressionErrors.length;
  if (report.errors.length === 0 && !reportError) {
    var where = report.mode === "create" ? "已保存工程：\n" + report.saved : "已追加实例：\n" + report.instanceId + "\n现有工程没有自动保存。";
    var insertedNote = report.inserted ? "\n已插入：" + report.inserted : "";
    alert(where + insertedNote + "\n\n" + summary + "\n详见 report.ae.json");
  } else if (report.errors.length === 0 && reportError) {
    alert("导入已经完成，但检查报告没有写入。\n" + reportError + "\n" + summary);
  } else {
    alert("导入没有完成。\n" + report.errors.join("\n") + "\n" + summary);
  }
};
