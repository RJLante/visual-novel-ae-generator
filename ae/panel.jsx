var VN = VN || {};

VN.buildPanel = function (thisObj) {
  var hosted = false;
  try {
    hosted = thisObj instanceof Panel;
  } catch (ignoreHost) {}
  var win = hosted ? thisObj : new Window("palette", "文字冒险", undefined, { resizeable: true });
  if (hosted && win.children && win.children.length) {
    var clearGuard = win.children.length + 2;
    while (win.children.length && clearGuard > 0) {
      clearGuard -= 1;
      try {
        win.remove(win.children[0]);
      } catch (ignoreRemove) {
        break;
      }
    }
  }
  win.orientation = "column";
  win.alignChildren = ["fill", "top"];
  win.spacing = 6;
  win.margins = 10;

  var header = win.add("group");
  header.orientation = "row";
  header.alignChildren = ["left", "center"];
  header.add("statictext", undefined, "文字冒险");
  var moreButton = header.add("button", undefined, "更多");
  moreButton.alignment = ["right", "center"];
  moreButton.preferredSize.width = 64;

  var menu = win.add("group");
  menu.orientation = "column";
  menu.alignChildren = ["fill", "top"];
  menu.spacing = 2;
  var speedMenu = menu.add("button", undefined, "批量调整节奏…");
  var presetMenu = menu.add("button", undefined, "更换文字动画…");
  var unlinkMenu = menu.add("button", undefined, "独立编辑样式…");
  var checkMenu = menu.add("button", undefined, "检查当前片段");
  var infoMenu = menu.add("button", undefined, "作品包详情");
  var assetsMenu = menu.add("button", undefined, "打开素材目录");

  var packageHeading = win.add("statictext", undefined, "作品包");
  var pickRow = win.add("group");
  pickRow.orientation = "row";
  pickRow.alignChildren = ["fill", "center"];
  var chooseButton = pickRow.add("button", undefined, "选择作品包…");
  chooseButton.alignment = ["fill", "center"];
  var recent = pickRow.add("dropdownlist", undefined, ["最近使用"]);
  recent.selection = 0;
  recent.preferredSize.width = 120;

  var emptyText = win.add("statictext", undefined, "选择一个作品包开始", { multiline: true });
  emptyText.preferredSize.height = 32;

  var summary = win.add("group");
  summary.orientation = "column";
  summary.alignChildren = ["fill", "top"];
  summary.spacing = 2;
  var summaryName = summary.add("statictext", undefined, "", { multiline: true });
  summaryName.preferredSize.height = 32;
  var summaryMeta = summary.add("statictext", undefined, "", { multiline: true });
  summaryMeta.preferredSize.height = 32;
  var summaryHealth = summary.add("statictext", undefined, "", { multiline: true });
  summaryHealth.preferredSize.height = 28;

  var errorBox = win.add("group");
  errorBox.orientation = "column";
  errorBox.alignChildren = ["fill", "top"];
  var errorTitle = errorBox.add("statictext", undefined, "", { multiline: true });
  errorTitle.preferredSize.height = 36;
  var errorHint = errorBox.add("statictext", undefined, "", { multiline: true });
  errorHint.preferredSize.height = 32;
  var errorRow = errorBox.add("group");
  errorRow.orientation = "row";
  var recheckButton = errorRow.add("button", undefined, "重新检查");
  var copyButton = errorRow.add("button", undefined, "复制错误详情");

  var destinationLabel = win.add("statictext", undefined, "导入位置");
  var destination = win.add("dropdownlist", undefined, ["仅加入项目面板", "插入当前合成"]);
  destination.selection = 0;
  var targetText = win.add("statictext", undefined, "导入后可自行拖入时间轴", { multiline: true });
  targetText.preferredSize.height = 32;
  var importButton = win.add("button", undefined, "导入片段");
  var openLastButton = win.add("button", undefined, "打开主合成");

  var duplicateBox = win.add("group");
  duplicateBox.orientation = "column";
  duplicateBox.alignChildren = ["fill", "top"];
  duplicateBox.add("statictext", undefined, "本工程已导入此版本");
  var duplicateRow = duplicateBox.add("group");
  duplicateRow.orientation = "row";
  duplicateRow.alignChildren = ["fill", "center"];
  var openExistingButton = duplicateRow.add("button", undefined, "打开已导入片段");
  var copyImportButton = duplicateRow.add("button", undefined, "再导入副本");

  var currentBox = win.add("panel", undefined, "当前片段");
  currentBox.orientation = "column";
  currentBox.alignChildren = ["fill", "top"];
  currentBox.alignment = ["fill", "top"];
  currentBox.margins = 8;
  var currentPrompt = currentBox.add("statictext", undefined, "请选择一个生成的片段", { multiline: true });
  var currentName = currentBox.add("statictext", undefined, "", { multiline: true });
  currentName.preferredSize.height = 28;
  var currentRow = currentBox.add("group");
  currentRow.orientation = "row";
  currentRow.alignChildren = ["fill", "center"];
  var openMasterButton = currentRow.add("button", undefined, "打开主合成");
  var styleButton = currentRow.add("button", undefined, "全局样式");

  var textBox = win.add("panel", undefined, "文字工具");
  textBox.orientation = "column";
  textBox.alignChildren = ["fill", "top"];
  textBox.margins = 8;
  var textCount = textBox.add("statictext", undefined, "", { multiline: true });
  var textPreview = textBox.add("statictext", undefined, "", { multiline: true });
  textPreview.preferredSize.height = 32;
  var rebuildButton = textBox.add("button", undefined, "按新文案重建动画");
  textBox.add("statictext", undefined, "手动调整过的动画会跳过");

  var extraBox = win.add("panel", undefined, "批量操作");
  extraBox.orientation = "column";
  extraBox.alignChildren = ["fill", "top"];
  extraBox.margins = 8;
  var extraTitle = extraBox.add("statictext", undefined, "批量调整节奏");
  extraBox.add("statictext", undefined, "处理范围");
  var scopeList = extraBox.add("dropdownlist", undefined, ["选中文字"]);
  scopeList.selection = 0;
  var speedLabel = extraBox.add("statictext", undefined, "速度倍率");
  var speedText = extraBox.add("edittext", undefined, "1");
  var keepManual = extraBox.add("checkbox", undefined, "按现有关键帧缩放");
  var presetLabel = extraBox.add("statictext", undefined, "动画预设");
  var presetList = extraBox.add("dropdownlist", undefined, ["打字机", "逐行出现", "整段淡入"]);
  presetList.selection = 0;
  var extraRow = extraBox.add("group");
  extraRow.orientation = "row";
  var extraApply = extraRow.add("button", undefined, "应用");
  var extraClose = extraRow.add("button", undefined, "关闭");

  var detailsBox = win.add("edittext", undefined, "", { multiline: true });
  detailsBox.preferredSize.height = 72;

  var footer = win.add("group");
  footer.orientation = "row";
  footer.alignChildren = ["fill", "center"];
  var statusText = footer.add("statictext", undefined, "选择一个作品包开始", { multiline: true });
  statusText.alignment = ["fill", "center"];
  statusText.preferredSize.height = 28;

  var ui = {
    state: "empty",
    inspection: null,
    manifestFile: null,
    existing: [],
    lastResult: null,
    context: null,
    contextSignature: "",
    extraMode: "",
    menuOpen: false
  };
  VN._panel = win;

  function pinTop(item) {
    try {
      item.alignment = ["fill", "top"];
    } catch (ignorePin) {}
  }

  function layoutNow() {
    var i;
    try {
      for (i = 0; i < win.children.length; i++) pinTop(win.children[i]);
      win.layout.layout(true);
    } catch (ignoreLayout) {}
    try {
      win.update();
    } catch (ignoreUpdate) {}
  }

  function setShown(item, shown) {
    item.visible = !!shown;
    try {
      if (shown) {
        item.maximumSize = [4000, 4000];
        if (item._vnHeight) item.preferredSize = [item.preferredSize.width > 20 ? item.preferredSize.width : 240, item._vnHeight];
      } else {
        if (!item._vnHeight && item.preferredSize && item.preferredSize.height > 8) item._vnHeight = item.preferredSize.height;
        item.minimumSize = [0, 0];
        item.maximumSize = [0, 0];
      }
    } catch (ignoreSize) {}
  }

  function setLabel(field, text) {
    var value = text ? String(text) : " ";
    field.text = value;
    try {
      field.characters = value.length < 12 ? 12 : value.length;
    } catch (ignoreCharacters) {}
  }

  function setStatus(text) {
    setLabel(statusText, text);
    try {
      win.update();
    } catch (ignoreUpdate) {}
  }

  function showDetails(text, shown) {
    detailsBox.text = text || "";
    setShown(detailsBox, !!shown && !!text);
  }

  function shortText(value) {
    var text = String(value || "").replace(/\r|\n/g, " ");
    if (text.length > 28) text = text.substring(0, 28) + "…";
    return text ? "“" + text + "”" : "";
  }

  function fillRecent() {
    VN._fillingRecent = true;
    recent.removeAll();
    recent.add("item", "最近使用");
    ui.recentItems = VN.readRecentPackages();
    var i;
    for (i = 0; i < ui.recentItems.length; i++) {
      var item = ui.recentItems[i];
      var label = item.displayName || "作品包";
      if (item.versionLabel) label += " " + item.versionLabel;
      var file = new File(item.manifestPath);
      if (!file.exists) label += "（找不到）";
      recent.add("item", label);
    }
    recent.selection = 0;
    VN._fillingRecent = false;
  }

  function renderChrome() {
    var state = ui.state;
    var busy = state === "checking" || state === "importing";
    var ready = ui.inspection && ui.inspection.ok;
    chooseButton.enabled = !busy;
    recent.enabled = !busy;
    destination.enabled = ready && !busy;
    importButton.enabled = (state === "ready" || state === "success") && !busy;
    moreButton.enabled = !busy;
    setShown(emptyText, state === "empty");
    setShown(summary, !!ready);
    setShown(errorBox, state === "invalid" || state === "failed");
    setShown(destinationLabel, !!ready && state !== "importing");
    setShown(destination, !!ready && state !== "importing");
    setShown(targetText, !!ready && state !== "importing");
    setShown(importButton, state !== "duplicate");
    setShown(openLastButton, state === "success" && ui.lastResult && ui.lastResult.master);
    setShown(duplicateBox, state === "duplicate");
    setShown(menu, ui.menuOpen && !busy);
    setShown(extraBox, !!ui.extraMode && !busy);
    if (!busy && state !== "failed" && state !== "invalid") {
      if (!detailsBox.text || ui.extraMode) setShown(detailsBox, !!ui.extraMode && !!detailsBox.text);
    }
    layoutNow();
  }

  function applyInspection(inspection, manifestFile) {
    ui.inspection = inspection;
    ui.manifestFile = manifestFile || ui.manifestFile;
    ui.contextSignature = "";
    if (!inspection || !inspection.ok) {
      ui.state = inspection ? "invalid" : "empty";
      setLabel(errorTitle, inspection ? inspection.message : " ");
      setLabel(errorHint, inspection ? inspection.hint : " ");
      showDetails(inspection ? inspection.message + "\n" + inspection.hint + "\n" + inspection.details : "", !!inspection);
      setStatus(inspection ? inspection.message : "选择一个作品包开始");
      renderChrome();
      return;
    }
    var manifest = inspection.manifest;
    var summaryInfo = manifest.summary;
    setLabel(summaryName, manifest.displayName + "  " + (manifest.versionLabel || ""));
    setLabel(summaryMeta, summaryInfo.sceneCount + " 个场景 · " + summaryInfo.textEventCount + " 段文字 · " + VN.formatDuration(summaryInfo.durationFrames, summaryInfo.fps));
    setLabel(summaryHealth, "素材齐全，可以导入  ·  " + summaryInfo.width + " × " + summaryInfo.height + "  ·  " + summaryInfo.fps + " fps");
    ui.existing = VN.findBuildInstances(manifest.projectId, manifest.buildId);
    if (ui.existing.length) {
      ui.state = "duplicate";
      setStatus("此版本已存在");
      showDetails("", false);
    } else {
      ui.state = "ready";
      setStatus("可以导入");
      showDetails("", false);
    }
    renderChrome();
    syncContext();
  }

  function loadManifest(file, repairedFrom, previousUsed) {
    if (!file) return;
    try {
      ui.state = "checking";
      setStatus("正在检查素材与版本…");
      renderChrome();
      var inspection = VN.inspectPackage(file);
      if (repairedFrom && inspection.ok) {
        VN.replaceRecentPath(repairedFrom, {
          displayName: inspection.manifest.displayName,
          manifestPath: file.fsName,
          lastUsedAt: previousUsed || "",
          versionLabel: inspection.manifest.versionLabel
        });
        fillRecent();
      }
      applyInspection(inspection, file);
    } catch (err) {
      ui.state = "failed";
      setLabel(errorTitle, "无法读取作品包");
      setLabel(errorHint, String(err));
      showDetails(String(err), true);
      setStatus(String(err));
      renderChrome();
    }
  }

  function choosePackage() {
    if (VN._importing) return;
    var picked = File.openDialog("选择 vn-package.json", "JSON:*.json");
    if (!picked) return;
    loadManifest(picked, "");
  }

  function syncContext() {
    if (VN._importing) return;
    var context = VN.resolveContext();
    ui.context = context;
    var targetLabel = "导入后可自行拖入时间轴";
    if (destination.selection && destination.selection.index === 1) {
      targetLabel = context.insertTarget ? "插入到：" + context.insertTarget.name + " · " + context.insertTarget.timecode : "请先打开要插入的合成";
    }
    setLabel(targetText, targetLabel);
    var identified = context.state === "instance" && context.instance;
    setShown(currentPrompt, !identified);
    setShown(currentName, !!identified);
    setShown(currentRow, !!identified);
    if (identified) setLabel(currentName, context.instance.displayName + (context.instance.versionLabel ? "  " + context.instance.versionLabel : ""));
    var textCountValue = context.textLayers.length;
    setShown(textBox, textCountValue > 0);
    if (textCountValue > 0) {
      setLabel(textCount, "已选择 " + textCountValue + " 个可处理的文字层");
      setLabel(textPreview, shortText(context.textLayers[0].preview));
    }
    var instanceKey = identified ? context.instance.instanceId : context.state;
    var signature = instanceKey + "|" + textCountValue + "|" + targetLabel;
    if (signature === ui.contextSignature) return;
    ui.contextSignature = signature;
    layoutNow();
  }

  function showFailure(result) {
    ui.state = "failed";
    setLabel(errorTitle, result.message);
    setLabel(errorHint, result.hint || " ");
    showDetails([result.message, result.hint, result.cleanup, result.details].join("\n"), true);
    setStatus(result.message);
    renderChrome();
  }

  function beginImport(asCopy) {
    if (VN._importing || !ui.manifestFile) return;
    var inspection = VN.inspectPackage(ui.manifestFile);
    if (!inspection.ok) {
      applyInspection(inspection, ui.manifestFile);
      return;
    }
    ui.inspection = inspection;
    try {
      VN.ensureVersion();
      if (app.project.numItems > 0) VN.ensureExpressionEngineCompatible();
    } catch (err) {
      showFailure({
        message: VN.friendlyImportError(err),
        hint: "工程未被修改。",
        cleanup: "工程未被修改。",
        details: String(err)
      });
      return;
    }
    if (!asCopy) {
      var existing = VN.findBuildInstances(inspection.manifest.projectId, inspection.manifest.buildId);
      if (existing.length) {
        ui.existing = existing;
        ui.state = "duplicate";
        setStatus("此版本已存在");
        renderChrome();
        return;
      }
    }
    var destinationName = destination.selection && destination.selection.index === 1 ? "comp" : "project";
    var targetComp = null;
    var insertTime = null;
    var extendHost = false;
    if (destinationName === "comp") {
      var target = VN.currentInsertTarget();
      if (!target) {
        setStatus("请先打开要插入的合成。");
        return;
      }
      var seconds = inspection.compiled.durationFrames / inspection.compiled.fps;
      if (target.time + seconds > target.comp.duration + 0.0005) {
        var agreed = confirm("片段会超出「" + target.comp.name + "」的结尾。\n是否延长这个合成后再导入？\n\n选择「否」将取消，不会修改工程。");
        if (!agreed) {
          setStatus("已取消导入，工程没有修改。");
          return;
        }
        extendHost = true;
      }
      var again = VN.currentInsertTarget();
      if (!again || again.comp !== target.comp) {
        setStatus("当前合成已变化，导入已取消，工程没有修改。");
        return;
      }
      if (again.time + seconds <= again.comp.duration + 0.0005) extendHost = false;
      targetComp = again.comp;
      insertTime = again.time;
    }

    VN._importing = true;
    ui.state = "importing";
    ui.menuOpen = false;
    ui.extraMode = "";
    setStatus("正在检查作品包…");
    renderChrome();
    VN.onImportPhase = function (phase) {
      setStatus(phase === "assets" ? "正在导入素材…" : phase === "comps" || phase === "layers" ? "正在创建合成和图层…" : phase === "verify" ? "正在检查结果…" : "正在检查作品包…");
    };
    var result;
    try {
      result = VN.runImport({
        compiled: inspection.compiled,
        packageRoot: inspection.packageRoot,
        displayName: inspection.manifest.displayName,
        versionLabel: inspection.manifest.versionLabel,
        destination: destinationName,
        saveProject: false,
        extendHost: extendHost,
        targetComp: targetComp,
        insertTime: insertTime,
        activeItem: null,
        reportFile: new File(inspection.packageRoot.fsName + "/report.ae.json")
      });
    } finally {
      VN.onImportPhase = null;
      VN._importing = false;
    }
    ui.lastResult = result;
    if (result.ok) {
      VN.rememberSuccessfulImport({
        displayName: inspection.manifest.displayName,
        manifestPath: ui.manifestFile.fsName,
        lastUsedAt: VN.timestampNow(),
        versionLabel: inspection.manifest.versionLabel
      });
      fillRecent();
      ui.state = "success";
      setLabel(summaryHealth, "此版本已导入当前工程");
      setStatus(result.message);
      showDetails(result.hint ? result.message + "\n" + result.hint + "\n" + result.details : "", !!result.hint);
      renderChrome();
      syncContext();
      return;
    }
    showFailure(result);
  }

  function openExtra(mode) {
    ui.menuOpen = false;
    ui.extraMode = mode;
    extraTitle.text = mode === "preset" ? "更换文字动画" : mode === "unlink" ? "独立编辑样式" : "批量调整节奏";
    var context = VN.resolveContext();
    ui.context = context;
    scopeList.removeAll();
    scopeList.add("item", "选中文字 · " + context.textLayers.length + " 层");
    scopeList.add("item", "当前合成");
    scopeList.add("item", "当前片段");
    scopeList.selection = 0;
    speedText.text = "1";
    keepManual.value = false;
    presetList.selection = 0;
    setShown(speedLabel, mode === "speed");
    setShown(speedText, mode === "speed");
    setShown(keepManual, mode === "speed");
    setShown(presetLabel, mode === "preset");
    setShown(presetList, mode === "preset");
    renderChrome();
  }

  function selectedScope() {
    if (!scopeList.selection || scopeList.selection.index === 0) return "selection";
    if (scopeList.selection.index === 1) return "scene";
    return "instance";
  }

  chooseButton.onClick = choosePackage;
  recent.onChange = function () {
    if (VN._fillingRecent || !recent.selection || recent.selection.index < 1) return;
    var item = ui.recentItems[recent.selection.index - 1];
    if (!item) return;
    var file = new File(item.manifestPath);
    if (!file.exists) {
      setStatus("找不到这个作品包，请重新定位 vn-package.json。");
      var picked = File.openDialog("重新定位 vn-package.json", "JSON:*.json");
      if (!picked) return;
      loadManifest(picked, item.manifestPath, item.lastUsedAt);
      return;
    }
    loadManifest(file, "");
  };
  destination.onChange = function () {
    ui.contextSignature = "";
    syncContext();
  };
  importButton.onClick = function () {
    beginImport(false);
  };
  copyImportButton.onClick = function () {
    beginImport(true);
  };
  openExistingButton.onClick = function () {
    if (!ui.existing.length) return;
    var opened = VN.openLogicalComp(ui.existing[0].instanceId, "master");
    setStatus(opened.ok ? "已打开已导入片段" : opened.message);
  };
  openLastButton.onClick = function () {
    if (!ui.lastResult || !ui.lastResult.master) return;
    ui.lastResult.master.openInViewer();
    setStatus("已打开主合成");
    ui.contextSignature = "";
    syncContext();
  };
  openMasterButton.onClick = function () {
    var context = VN.resolveContext();
    if (!context.instance) {
      setStatus("请选择一个生成的片段");
      return;
    }
    var opened = VN.openLogicalComp(context.instance.instanceId, "master");
    setStatus(opened.ok ? "已打开主合成" : opened.message);
  };
  styleButton.onClick = function () {
    var context = VN.resolveContext();
    if (context.state === "ambiguous" || !context.instance) {
      setStatus("请选择一个生成的片段");
      return;
    }
    var opened = VN.openLogicalComp(context.instance.instanceId, "global:control");
    setStatus(opened.ok ? "已打开全局样式" : opened.message);
  };
  rebuildButton.onClick = function () {
    var result = VN.rebuildSelectedText();
    setStatus(result.message);
    showDetails(result.details, !!result.details);
    renderChrome();
  };
  recheckButton.onClick = function () {
    if (ui.manifestFile) loadManifest(ui.manifestFile, "");
  };
  copyButton.onClick = function () {
    var payload = [errorTitle.text, errorHint.text, detailsBox.text].join("\n");
    setStatus(VN.copyText(payload) ? "已复制错误详情" : "请在详情框中全选复制");
  };
  moreButton.onClick = function () {
    ui.menuOpen = !ui.menuOpen;
    renderChrome();
  };
  speedMenu.onClick = function () {
    openExtra("speed");
  };
  presetMenu.onClick = function () {
    openExtra("preset");
  };
  unlinkMenu.onClick = function () {
    openExtra("unlink");
  };
  checkMenu.onClick = function () {
    ui.menuOpen = false;
    var context = VN.resolveContext();
    if (!context.instance) {
      setStatus("请选择一个生成的片段");
      renderChrome();
      return;
    }
    var result = VN.applyToTargets("instance", "VN Check", function (layer, comp) {
      return VN.checkLayer(layer, comp);
    });
    setStatus(result.ok ? "已检查当前片段" : result.message);
    showDetails(result.notes ? result.notes.join("\n") : "", result.ok);
    renderChrome();
  };
  infoMenu.onClick = function () {
    ui.menuOpen = false;
    if (!ui.inspection || !ui.inspection.ok) {
      setStatus("请先选择作品包");
      renderChrome();
      return;
    }
    showDetails(ui.inspection.details, true);
    renderChrome();
  };
  assetsMenu.onClick = function () {
    ui.menuOpen = false;
    renderChrome();
    if (!ui.inspection || !ui.inspection.packageRoot) {
      setStatus("请先选择作品包");
      return;
    }
    var folder = new Folder(ui.inspection.packageRoot.fsName + "/assets");
    if (!folder.exists) folder = ui.inspection.packageRoot;
    folder.execute();
  };
  extraClose.onClick = function () {
    ui.extraMode = "";
    renderChrome();
  };
  extraApply.onClick = function () {
    var scopeName = selectedScope();
    var result;
    if (ui.extraMode === "speed") {
      var speed = parseFloat(speedText.text);
      if (!(speed > 0)) {
        setStatus("速度倍率必须大于 0。");
        return;
      }
      var manual = keepManual.value;
      result = VN.applyToTargets(scopeName, "VN Apply Speed", function (layer, comp) {
        return VN.applySpeedToLayer(layer, comp, speed, manual);
      });
    } else if (ui.extraMode === "preset") {
      var preset = presetList.selection && presetList.selection.index === 1 ? "lines" : presetList.selection && presetList.selection.index === 2 ? "fade" : "typewriter";
      result = VN.applyToTargets(scopeName, "VN Apply Preset", function (layer, comp) {
        return VN.applyPresetToLayer(layer, comp, preset);
      });
    } else {
      result = VN.applyToTargets(scopeName, "VN Unlink Style", function (layer, comp) {
        return VN.unlinkStyle(layer, comp);
      });
    }
    ui.extraMode = "";
    setStatus(result.ok ? "已处理 " + result.notes.length + " 个文字层" : result.message);
    showDetails(result.notes ? result.notes.join("\n") : "", !!(result.notes && result.notes.length));
    renderChrome();
  };

  try {
    win.onClose = function () {
      VN._panel = null;
      VN._polling = false;
    };
  } catch (ignoreClose) {}

  VN.syncPanelContext = syncContext;
  layoutNow();
  fillRecent();
  setShown(menu, false);
  setShown(extraBox, false);
  setShown(detailsBox, false);
  setShown(textBox, false);
  applyInspection(null, null);
  ui.state = "empty";
  setStatus("选择一个作品包开始");
  renderChrome();
  syncContext();
  VN.ensurePolling();
  if (!hosted) {
    win.center();
    win.show();
  }
  return win;
};

VN.ensurePolling = function () {
  if (VN._polling) return;
  VN._polling = true;
  try {
    app.scheduleTask("VN.pollPanel()", 500, false);
  } catch (ignoreSchedule) {
    VN._polling = false;
  }
};

VN.pollPanel = function () {
  var alive = false;
  try {
    alive = !!(VN._panel && VN._panel.visible);
  } catch (ignoreAlive) {
    VN._panel = null;
  }
  if (!alive) {
    VN._polling = false;
    return;
  }
  try {
    if (VN.syncPanelContext) VN.syncPanelContext();
  } catch (ignoreSync) {}
  try {
    app.scheduleTask("VN.pollPanel()", 500, false);
  } catch (ignoreReschedule) {
    VN._polling = false;
  }
};
