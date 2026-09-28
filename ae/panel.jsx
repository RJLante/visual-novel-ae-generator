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
  win.spacing = 8;
  win.margins = 10;
  win.preferredSize = [340, 480];

  var clipBox = win.add("panel", undefined, "片段");
  clipBox.orientation = "column";
  clipBox.alignChildren = ["fill", "top"];
  clipBox.margins = 8;
  var chooseButton = clipBox.add("button", undefined, "选择作品包");
  var summaryName = clipBox.add("statictext", undefined, "选择一个作品包开始", { multiline: true });
  summaryName.preferredSize.height = 36;
  var summaryMeta = clipBox.add("statictext", undefined, " ", { multiline: true });
  summaryMeta.preferredSize.height = 32;
  var instancePick = clipBox.add("dropdownlist", undefined, ["已有片段"]);
  var primaryButton = clipBox.add("button", undefined, "导入片段");

  var playBox = win.add("panel", undefined, "文字样式与播放");
  playBox.orientation = "column";
  playBox.alignChildren = ["fill", "top"];
  playBox.margins = 8;
  var playName = playBox.add("statictext", undefined, " ", { multiline: true });
  playName.preferredSize.height = 32;
  var playDuration = playBox.add("statictext", undefined, " ", { multiline: true });
  playDuration.preferredSize.height = 32;
  var styleButton = playBox.add("button", undefined, "修改文字样式");
  var effectList = playBox.add("dropdownlist", undefined, ["打字机", "透明度逐字显示"]);
  effectList.selection = 0;
  var effectButton = playBox.add("button", undefined, "应用效果");
  var effectNote = playBox.add("statictext", undefined, " ", { multiline: true });
  effectNote.preferredSize.height = 32;
  var speedLabel = playBox.add("statictext", undefined, "播放速度");
  var speedSlider = playBox.add("slider", undefined, 1, 0.5, 2);
  var speedValue = playBox.add("edittext", undefined, "1");
  var speedPreview = playBox.add("statictext", undefined, " ", { multiline: true });
  speedPreview.preferredSize.height = 28;

  var textBox = win.add("panel", undefined, "文字动画");
  textBox.orientation = "column";
  textBox.alignChildren = ["fill", "top"];
  textBox.margins = 8;
  var textCount = textBox.add("statictext", undefined, " ", { multiline: true });
  var rebuildButton = textBox.add("button", undefined, "更新文字动画");

  var errorBox = win.add("group");
  errorBox.orientation = "column";
  errorBox.alignChildren = ["fill", "top"];
  var errorTitle = errorBox.add("statictext", undefined, " ", { multiline: true });
  errorTitle.preferredSize.height = 36;
  var errorRow = errorBox.add("group");
  var copyButton = errorRow.add("button", undefined, "复制错误");
  var assetsButton = errorRow.add("button", undefined, "打开素材目录");

  var statusText = win.add("statictext", undefined, "选择一个作品包开始", { multiline: true });
  statusText.preferredSize.height = 36;
  var detailsBox = win.add("edittext", undefined, "", { multiline: true });
  detailsBox.preferredSize.height = 72;

  var ui = {
    inspection: null,
    manifestFile: null,
    existing: [],
    context: null,
    signature: "",
    busy: false,
    fillingSpeed: false,
    speedLock: null,
    dragging: false
  };
  VN._panel = win;

  function pinTop(item) {
    try {
      item.alignment = ["fill", "top"];
    } catch (ignorePin) {}
  }

  function layoutNow() {
    try {
      var i;
      for (i = 0; i < win.children.length; i++) pinTop(win.children[i]);
      win.layout.layout(true);
    } catch (ignoreLayout) {}
  }

  function setShown(item, shown) {
    item.visible = !!shown;
    try {
      if (shown) item.maximumSize = [4000, 4000];
      else {
        item.minimumSize = [0, 0];
        item.maximumSize = [0, 0];
      }
    } catch (ignoreSize) {}
  }

  function setLabel(field, text) {
    field.text = text ? String(text) : " ";
  }

  function setStatus(text, details) {
    setLabel(statusText, text);
    detailsBox.text = details || "";
    setShown(detailsBox, !!details);
    layoutNow();
  }

  function speedNumber(value) {
    var number = Math.round(Number(value) * 100) / 100;
    if (!(number >= 0.5 && number <= 2)) return null;
    return number;
  }

  function predictedText(instanceId, speed) {
    var folder = VN.instanceFolderMeta(instanceId);
    if (!folder || !folder.meta.baseline) return "";
    var frames = Math.round(folder.meta.baseline.masterDurationFrames / speed);
    return "预计：" + VN.formatDuration(frames, folder.meta.baseline.fps);
  }

  function currentText(instanceId) {
    var caps = VN.capabilitiesFor(instanceId);
    var master = VN.masterCompFor(instanceId);
    if (!master) return "当前片段";
    var frames = Math.round(master.duration / master.frameDuration);
    return "当前片段：" + VN.formatDuration(frames, master.frameRate) + " · " + caps.speedValue + " 倍速";
  }

  function fillInstances() {
    instancePick.removeAll();
    var i;
    for (i = 0; i < ui.existing.length; i++) {
      var meta = ui.existing[i].meta || {};
      instancePick.add("item", meta.displayName || ui.existing[i].instanceId);
    }
    if (instancePick.items.length) instancePick.selection = 0;
  }

  function renderChrome() {
    var busy = ui.busy;
    var ready = ui.inspection && ui.inspection.ok;
    var count = ui.existing.length;
    chooseButton.enabled = !busy;
    primaryButton.enabled = !busy && ((ready && count === 0) || count > 0);
    primaryButton.text = count ? "打开片段" : "导入片段";
    setShown(instancePick, count > 1);
    setShown(summaryName, true);
    setShown(summaryMeta, !!ready);
    setShown(errorBox, ui.inspection && !ui.inspection.ok);
    var context = ui.context;
    var unique = context && context.status === "unique";
    setShown(playBox, !!unique && !busy);
    setShown(textBox, !!(context && context.textLayers && context.textLayers.length) && !busy);
    if (!unique && context && context.status === "ambiguous") setLabel(statusText, context.message);
    layoutNow();
  }

  function applyInspection(inspection, manifestFile) {
    ui.inspection = inspection;
    ui.manifestFile = manifestFile || ui.manifestFile;
    ui.signature = "";
    if (!inspection || !inspection.ok) {
      setLabel(summaryName, inspection ? inspection.message : "选择一个作品包开始");
      setLabel(summaryMeta, " ");
      setLabel(errorTitle, inspection ? inspection.message : " ");
      ui.existing = [];
      setStatus(inspection ? inspection.message : "选择一个作品包开始", inspection ? inspection.details : "");
      setShown(assetsButton, !!(inspection && inspection.message && inspection.message.indexOf("找不到") !== -1));
      renderChrome();
      return;
    }
    var manifest = inspection.manifest;
    var summaryInfo = manifest.summary;
    setLabel(summaryName, manifest.displayName || "作品");
    setLabel(summaryMeta, summaryInfo.textEventCount + " 段文字 · " + VN.formatDuration(summaryInfo.durationFrames, summaryInfo.fps));
    ui.existing = VN.findBuildInstances(manifest.projectId, manifest.buildId);
    fillInstances();
    setStatus(ui.existing.length ? "此版本已在工程中" : "可以导入", "");
    renderChrome();
    syncContext();
  }

  function loadManifest(file) {
    if (!file) return;
    try {
      ui.busy = true;
      setStatus("正在检查素材与版本…", "");
      renderChrome();
      var inspection = VN.inspectPackage(file);
      ui.busy = false;
      applyInspection(inspection, file);
    } catch (err) {
      ui.busy = false;
      ui.inspection = { ok: false, message: "无法读取作品包", details: String(err) };
      applyInspection(ui.inspection, file);
    }
  }

  function selectedExisting() {
    if (!ui.existing.length) return null;
    if (ui.existing.length === 1) return ui.existing[0];
    var index = instancePick.selection ? instancePick.selection.index : 0;
    return ui.existing[index] || ui.existing[0];
  }

  function openExisting() {
    var chosen = selectedExisting();
    if (!chosen) return;
    var opened = VN.openLogicalComp(chosen.instanceId, "master");
    setStatus(opened.ok ? "已打开片段" : opened.message, "");
    ui.signature = "";
    syncContext();
  }

  function beginImport() {
    if (ui.busy || !ui.manifestFile) return;
    var inspection = VN.inspectPackage(ui.manifestFile);
    if (!inspection.ok) {
      applyInspection(inspection, ui.manifestFile);
      return;
    }
    ui.existing = VN.findBuildInstances(inspection.manifest.projectId, inspection.manifest.buildId);
    if (ui.existing.length) {
      fillInstances();
      renderChrome();
      openExisting();
      return;
    }
    try {
      VN.ensureVersion();
      if (app.project.numItems > 0) VN.ensureExpressionEngineCompatible();
    } catch (err) {
      setStatus(VN.friendlyImportError(err), String(err));
      return;
    }
    ui.busy = true;
    renderChrome();
    var result;
    try {
      result = VN.runImport({
        compiled: inspection.compiled,
        packageRoot: inspection.packageRoot,
        displayName: inspection.manifest.displayName,
        versionLabel: inspection.manifest.versionLabel,
        destination: "project",
        saveProject: false,
        extendHost: false,
        targetComp: null,
        insertTime: null,
        activeItem: null,
        reportFile: new File(inspection.packageRoot.fsName + "/report.ae.json")
      });
    } finally {
      ui.busy = false;
    }
    if (result.ok) {
      try {
        VN.rememberSuccessfulImport({
          displayName: inspection.manifest.displayName,
          manifestPath: ui.manifestFile.fsName,
          lastUsedAt: VN.timestampNow(),
          versionLabel: inspection.manifest.versionLabel
        });
      } catch (ignoreRemember) {}
      if (result.master) {
        try {
          result.master.openInViewer();
        } catch (ignoreOpen) {}
      }
      ui.existing = VN.findBuildInstances(inspection.manifest.projectId, inspection.manifest.buildId);
      fillInstances();
      setStatus(result.message || "已导入并打开片段", result.hint || "");
      renderChrome();
      ui.signature = "";
      syncContext();
      return;
    }
    setStatus(result.message, [result.hint, result.cleanup, result.details].join("\n"));
    renderChrome();
  }

  function syncSpeed(instanceId) {
    var caps = VN.capabilitiesFor(instanceId);
    ui.fillingSpeed = true;
    speedSlider.value = caps.speedValue;
    speedValue.text = String(caps.speedValue);
    effectList.selection = caps.defaultEffect === "characterFade" ? 1 : 0;
    ui.fillingSpeed = false;
    setLabel(playDuration, currentText(instanceId));
    setLabel(speedPreview, " ");
    setLabel(effectNote, "默认效果：" + VN.effectLabel(caps.defaultEffect));
    var enabled = !!caps.full;
    effectList.enabled = enabled;
    effectButton.enabled = enabled;
    speedSlider.enabled = enabled;
    speedValue.enabled = enabled;
    styleButton.text = caps.style === "editor" ? "修改文字样式" : "打开原有样式控制";
  }

  function syncContext() {
    if (ui.busy || ui.dragging) return;
    var context = VN.resolveContext();
    ui.context = context;
    var textCountValue = context.textLayers ? context.textLayers.length : 0;
    var instanceKey = context.status === "unique" ? context.instanceId : context.status;
    var signature = instanceKey + "|" + textCountValue + "|" + (ui.existing.length) + "|" + (context.message || "");
    var changed = signature !== ui.signature;
    if (context.status === "unique") {
      var folder = VN.instanceFolderMeta(context.instanceId);
      var name = context.instance && context.instance.displayName ? context.instance.displayName : context.instanceId;
      if (folder && folder.meta.displayName) name = folder.meta.displayName;
      setLabel(playName, name);
      if (changed) syncSpeed(context.instanceId);
      else setLabel(playDuration, currentText(context.instanceId));
    }
    if (textCountValue) setLabel(textCount, "已选中 " + textCountValue + " 段文字");
    if (!changed) return;
    ui.signature = signature;
    renderChrome();
  }

  function selectionInstance() {
    var context = VN.resolveContext();
    ui.context = context;
    if (!context.textLayers || !context.textLayers.length) return "";
    var id = context.textLayers[0].meta.instanceId;
    var i;
    for (i = 1; i < context.textLayers.length; i++) {
      if (context.textLayers[i].meta.instanceId !== id) return "";
    }
    return id;
  }

  function commitSpeed(raw) {
    var context = ui.context;
    if (!context || context.status !== "unique") return;
    var speed = speedNumber(raw);
    if (speed === null) {
      setStatus("速度需要在 0.5 到 2 之间。", "");
      syncSpeed(context.instanceId);
      return;
    }
    var caps = VN.capabilitiesFor(context.instanceId);
    if (Math.abs(speed - caps.speedValue) < 0.001) {
      setLabel(speedPreview, " ");
      return;
    }
    var lock = ui.speedLock || VN.captureLock(context.instanceId);
    ui.busy = true;
    speedSlider.enabled = false;
    speedValue.enabled = false;
    effectButton.enabled = false;
    var result = VN.executeSpeed(lock, speed);
    ui.busy = false;
    ui.speedLock = null;
    ui.dragging = false;
    syncSpeed(context.instanceId);
    setStatus(result.message, result.status === "failed" ? result.message : "");
    renderChrome();
  }

  chooseButton.onClick = function () {
    if (ui.busy) return;
    var picked = File.openDialog("选择 vn-package.json", "JSON:*.json");
    if (!picked) return;
    loadManifest(picked);
  };
  primaryButton.onClick = function () {
    if (ui.existing.length) openExisting();
    else beginImport();
  };
  styleButton.onClick = function () {
    var context = VN.resolveContext();
    if (!context || context.status !== "unique") {
      setStatus("请先打开一个生成片段。", "");
      return;
    }
    var result = VN.openStyleEditor(context.instanceId);
    setStatus(result.message, "");
  };
  effectButton.onClick = function () {
    var context = VN.resolveContext();
    if (!context || context.status !== "unique") {
      setStatus("请先打开一个生成片段。", "");
      return;
    }
    var effect = effectList.selection && effectList.selection.index === 1 ? "characterFade" : "typewriter";
    var lock = VN.captureLock(context.instanceId);
    ui.busy = true;
    renderChrome();
    var result = VN.executeEffect(lock, effect);
    ui.busy = false;
    var retained = 0;
    var i;
    for (i = 0; i < result.items.length; i++) if (result.items[i].status !== "updated") retained += 1;
    if (result.status === "updated" || result.status === "partial") {
      setLabel(effectNote, "默认效果：" + VN.effectLabel(effect) + (retained ? "\n" + retained + " 段保留原效果" : ""));
    }
    setStatus(result.message, result.status === "failed" || result.status === "partial" ? result.message : "");
    ui.signature = "";
    syncContext();
  };
  speedSlider.onChanging = function () {
    if (ui.fillingSpeed) return;
    var context = ui.context;
    if (!context || context.status !== "unique") return;
    if (!ui.speedLock) ui.speedLock = VN.captureLock(context.instanceId);
    ui.dragging = true;
    var speed = speedNumber(speedSlider.value) || speedSlider.value;
    speedValue.text = String(Math.round(speedSlider.value * 100) / 100);
    setLabel(speedPreview, predictedText(context.instanceId, speedSlider.value));
  };
  speedSlider.onChange = function () {
    if (ui.fillingSpeed) return;
    ui.dragging = false;
    commitSpeed(speedSlider.value);
  };
  speedValue.onChange = function () {
    if (ui.fillingSpeed) return;
    ui.speedLock = ui.context && ui.context.status === "unique" ? VN.captureLock(ui.context.instanceId) : null;
    commitSpeed(speedValue.text);
  };
  rebuildButton.onClick = function () {
    var instanceId = selectionInstance();
    if (!instanceId) {
      setStatus("请选中同一个片段里的文字。", "");
      return;
    }
    var lock = VN.captureLock(instanceId);
    ui.busy = true;
    renderChrome();
    var result = VN.executeRebuild(lock);
    ui.busy = false;
    var details = "";
    var i;
    for (i = 0; i < result.items.length; i++) {
      if (result.items[i].status !== "updated" && result.items[i].message) details += result.items[i].message + "\n";
    }
    setStatus(result.message, details);
    renderChrome();
  };
  copyButton.onClick = function () {
    var payload = errorTitle.text + "\n" + detailsBox.text;
    setStatus(VN.copyText(payload) ? "已复制错误详情" : "请在详情框中全选复制", detailsBox.text);
  };
  assetsButton.onClick = function () {
    if (!ui.inspection || !ui.inspection.packageRoot) {
      setStatus("请先选择作品包", "");
      return;
    }
    var folder = new Folder(ui.inspection.packageRoot.fsName + "/assets");
    if (!folder.exists) folder = ui.inspection.packageRoot;
    folder.execute();
  };

  try {
    win.onResize = function () { layoutNow(); };
    win.onResizing = function () { layoutNow(); };
  } catch (ignoreResize) {}
  try {
    win.onClose = function () {
      VN._panel = null;
      VN._polling = false;
    };
  } catch (ignoreClose) {}

  VN.syncPanelContext = syncContext;
  setShown(playBox, false);
  setShown(textBox, false);
  setShown(errorBox, false);
  setShown(detailsBox, false);
  setShown(instancePick, false);
  layoutNow();
  applyInspection(null, null);
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
