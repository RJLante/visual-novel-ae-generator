var VN = VN || {};

VN.blankReport = function () {
  return {
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
};

VN.blankImportResult = function () {
  return {
    ok: false,
    message: "",
    hint: "",
    details: "",
    cleanup: "",
    instanceId: "",
    displayName: "",
    master: null,
    report: null
  };
};

VN.suppressDialogs = function () {
  var suppressed = false;
  try {
    app.beginSuppressDialogs();
    suppressed = true;
  } catch (ignore) {}
  return function () {
    if (!suppressed) return;
    suppressed = false;
    try {
      app.endSuppressDialogs(false);
    } catch (ignoreEnd) {}
  };
};

VN.removeInserted = function (ctx) {
  if (!ctx) return;
  var inserted = ctx.insertedLayers || [];
  var n;
  for (n = inserted.length - 1; n >= 0; n--) {
    try {
      inserted[n].remove();
    } catch (ignoreInsert) {}
  }
  ctx.insertedLayers = [];
};

VN.cleanupFailedImport = function (ctx, extended, host, previousDuration) {
  var created = ctx && ((ctx.folders && ctx.folders.length) || (ctx.comps && ctx.comps.length) || (ctx.footage && ctx.footage.length) || (ctx.insertedLayers && ctx.insertedLayers.length));
  var cleaned = true;
  try {
    if (extended && host && previousDuration !== null && previousDuration !== undefined) host.duration = previousDuration;
  } catch (ignoreDuration) {
    cleaned = false;
  }
  try {
    if (ctx) VN.rollbackImport(ctx);
  } catch (ignoreRollback) {
    cleaned = false;
  }
  if (!created && !extended) return "工程未被修改。";
  return cleaned ? "已删除本次新增的内容。" : "清理未完成。请使用撤销，或检查项目面板里是否留下本次的 VN_ 文件夹。";
};

VN.friendlyImportError = function (err) {
  var text = String(err && err.message ? err.message : err);
  if (text.indexOf("Error: ") === 0) text = text.substring(7);
  if (text.indexOf("无法导入") === 0) return text;
  return "无法导入：" + text;
};

VN.hintForError = function (message) {
  if (message.indexOf("找不到") !== -1) return "请重新生成完整作品包，或恢复缺失素材。";
  return "可以查看详情后重试。";
};

VN.formatReport = function (report, extra) {
  var lines = [];
  lines.push("实例：" + (report.instanceId || "（未创建）"));
  if (report.saved) lines.push("已保存：" + report.saved);
  if (report.inserted) lines.push("已插入：" + report.inserted);
  lines.push("字体缺失 " + report.fonts.length);
  lines.push("文字溢出 " + report.overflow.length);
  lines.push("表达式错误 " + report.expressionErrors.length);
  var i;
  for (i = 0; i < report.errors.length; i++) lines.push(report.errors[i]);
  for (i = 0; i < report.warnings.length; i++) lines.push("警告：" + report.warnings[i]);
  for (i = 0; i < report.fonts.length; i++) lines.push("字体：" + report.fonts[i].layer + " " + report.fonts[i].detail);
  for (i = 0; i < report.overflow.length; i++) lines.push("溢出：" + report.overflow[i].layer + " " + report.overflow[i].detail);
  for (i = 0; i < report.expressionErrors.length; i++) lines.push("表达式：" + report.expressionErrors[i].layer + " " + report.expressionErrors[i].detail);
  if (extra) lines.push(extra);
  return lines.join("\n");
};

VN.tryWriteReport = function (file, report) {
  try {
    VN.writeJsonFile(file, report);
    return "";
  } catch (err) {
    return "检查报告没有写入：" + err.toString();
  }
};

VN.runImport = function (options) {
  var result = VN.blankImportResult();
  var report = VN.blankReport();
  var ctx = null;
  var master = null;
  var extended = false;
  var host = options.targetComp;
  var previousDuration = null;
  var undo = false;
  var release = VN.suppressDialogs();
  VN.packageRoot = options.packageRoot;
  try {
    VN.notifyPhase("check");
    VN.ensureVersion();
    if (typeof JSON === "undefined") throw new Error("这个 After Effects 的脚本环境无法解析 JSON。");
    var compiled = options.compiled;
    if (!compiled || (compiled.schemaVersion !== 2 && compiled.schemaVersion !== 3)) throw new Error("这份作品包的数据结构不是受支持的版本。");
    var empty = app.project.numItems === 0;
    report.mode = empty ? "create" : "append";
    if (!empty) VN.ensureExpressionEngineCompatible();

    app.beginUndoGroup("VN 导入片段");
    undo = true;
    if (empty) VN.setExpressionEngine();
    ctx = {};
    ctx.displayName = options.displayName || compiled.name;
    ctx.versionLabel = options.versionLabel || "";
    VN.prepareInstance(ctx, compiled);
    report.instanceId = ctx.instanceId;
    master = VN.buildProject(compiled, report, ctx);
    VN.notifyPhase("verify");
    if (options.saveProject) {
      var saved = VN.saveProject(compiled);
      report.saved = saved.fsName;
    }
    if (options.destination === "comp") {
      if (!(host instanceof CompItem)) throw new Error("请先打开要插入的合成。");
      var start = options.insertTime;
      if (start === undefined || start === null) start = host.time;
      var end = start + master.duration;
      if (end > host.duration + 0.0005) {
        if (options.extendHost) {
          previousDuration = host.duration;
          host.duration = end;
          extended = true;
        } else {
          report.warnings.push("未延长宿主合成。超出结尾的画面不会显示。");
        }
      }
      VN.placeInstanceLayer(host, master, ctx, report, start, null, compiled);
    }
    release();
    if (options.destination === "legacy" && report.mode === "append" && report.expressionErrors.length === 0) {
      try {
        VN.offerInsert(options.activeItem, master, compiled, ctx, report);
      } catch (insertErr) {
        VN.removeInserted(ctx);
        report.errors.push("插入当前合成失败，实例已保留：" + insertErr.toString());
      }
    }
    if (undo) {
      app.endUndoGroup();
      undo = false;
    }
    result.ok = report.errors.length === 0;
    result.instanceId = ctx.instanceId;
    result.displayName = ctx.displayName;
    result.master = master;
    result.report = report;
    result.message = result.ok ? "已导入：" + (ctx.displayName || compiled.name) : "无法导入：" + report.errors.join(" ");
    result.hint = "";
    if (result.ok && (report.fonts.length || report.overflow.length || report.expressionErrors.length)) {
      result.hint = "导入已完成。字体、文字范围或表达式仍有需要留意的项目。";
    }
    var reportNote = "";
    if (options.reportFile) reportNote = VN.tryWriteReport(options.reportFile, report);
    result.cleanup = result.ok ? "" : "实例已保留。";
    result.details = VN.formatReport(report, reportNote);
    return result;
  } catch (err) {
    var cleanup = "工程未被修改。";
    if (ctx || extended) cleanup = VN.cleanupFailedImport(ctx, extended, host, previousDuration);
    if (undo) {
      try {
        app.endUndoGroup();
      } catch (ignoreUndo) {}
    }
    release();
    report.errors.push(String(err));
    result.ok = false;
    result.message = VN.friendlyImportError(err);
    result.hint = VN.hintForError(result.message);
    result.cleanup = cleanup;
    result.report = report;
    result.displayName = options.displayName || "";
    var failureNote = options.reportFile ? VN.tryWriteReport(options.reportFile, report) : "";
    result.details = VN.formatReport(report, [cleanup, failureNote].join("\n"));
    return result;
  }
};
