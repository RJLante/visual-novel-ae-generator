var VN = VN || {};

VN.compByLogical = function (instanceId, logicalId) {
  var i;
  for (i = 1; i <= app.project.numItems; i++) {
    var item = app.project.item(i);
    if (!(item instanceof CompItem)) continue;
    var meta = VN.readMeta(item.comment);
    if (meta && meta.instanceId === instanceId && meta.logicalId === logicalId) return item;
  }
  return null;
};

VN.styleTargets = function (instanceId, scope) {
  var logicals = ["style:dialogue", "style:narration", "style:option"];
  if (scope === "dialogue") logicals = ["style:dialogue"];
  if (scope === "narration") logicals = ["style:narration"];
  if (scope === "option") logicals = ["style:option"];
  var layers = [];
  var i;
  for (i = 0; i < logicals.length; i++) {
    var comp = VN.compByLogical(instanceId, logicals[i]);
    if (!comp) continue;
    var n;
    for (n = 1; n <= comp.numLayers; n++) {
      if (comp.layer(n).name === "STYLE") layers.push(comp.layer(n));
    }
  }
  return layers;
};

VN.scopeInfluence = function (scope) {
  if (scope === "dialogue") return "影响此片段中的对白";
  if (scope === "narration") return "影响此片段中的旁白";
  if (scope === "option") return "影响此片段中的选项";
  return "影响此片段中的全部文字";
};

VN.colorHex = function (color) {
  function part(value) {
    var num = Math.round(Math.max(0, Math.min(1, value)) * 255);
    var hex = num.toString(16);
    return hex.length < 2 ? "0" + hex : hex;
  }
  return "#" + part(color[0]) + part(color[1]) + part(color[2]);
};

VN.parseHexColor = function (text) {
  var value = String(text || "").replace(/^\s+|\s+$/g, "");
  if (value.charAt(0) === "#") value = value.substring(1);
  if (value.length !== 6) return null;
  var i;
  for (i = 0; i < 6; i++) {
    var code = value.charCodeAt(i);
    var ok = (code >= 48 && code <= 57) || (code >= 65 && code <= 70) || (code >= 97 && code <= 102);
    if (!ok) return null;
  }
  return [parseInt(value.substring(0, 2), 16) / 255, parseInt(value.substring(2, 4), 16) / 255, parseInt(value.substring(4, 6), 16) / 255];
};

VN.revealStyleLayer = function (instanceId, scope) {
  var logical = "style:dialogue";
  if (scope === "narration") logical = "style:narration";
  if (scope === "option") logical = "style:option";
  var comp = VN.compByLogical(instanceId, logical);
  if (!comp) return false;
  comp.openInViewer();
  var i;
  for (i = 1; i <= comp.numLayers; i++) comp.layer(i).selected = comp.layer(i).name === "STYLE";
  return true;
};

VN.fontNames = function () {
  var names = [];
  try {
    if (!(app.fonts && app.fonts.allFonts)) return names;
    var fonts = app.fonts.allFonts;
    var i;
    for (i = 0; i < fonts.length; i++) {
      var name = fonts[i].postScriptName || fonts[i].name;
      if (name) names.push(String(name));
    }
  } catch (ignore) {}
  return names;
};

VN.openStyleEditor = function (instanceId) {
  var caps = VN.capabilitiesFor(instanceId);
  if (caps.style !== "editor") {
    var legacy = VN.openLogicalComp(instanceId, "global:control");
    return { ok: legacy.ok, message: legacy.ok ? "已打开原有样式控制" : legacy.message };
  }
  var lock = VN.captureLock(instanceId);
  var folder = VN.instanceFolderMeta(instanceId);
  var display = folder && folder.meta.displayName ? folder.meta.displayName : instanceId;
  var win = new Window("dialog", "文字样式");
  win.orientation = "column";
  win.alignChildren = ["fill", "top"];
  win.margins = 12;
  win.spacing = 8;
  win.preferredSize.width = 340;
  win.add("statictext", undefined, "修改：" + display);
  var influence = win.add("statictext", undefined, "影响此片段中的全部文字", { multiline: true });
  influence.preferredSize.height = 32;
  var scopeList = win.add("dropdownlist", undefined, ["全部文字", "对白", "旁白", "选项"]);
  scopeList.selection = 0;
  var fontLabel = win.add("statictext", undefined, "字体");
  var fontList = win.add("dropdownlist", undefined, ["当前字体"]);
  var fontStatic = win.add("statictext", undefined, "", { multiline: true });
  var fontButton = win.add("button", undefined, "在 AE 字符面板修改字体");
  var sizeLabel = win.add("statictext", undefined, "字号");
  var sizeText = win.add("edittext", undefined, "");
  var leadingLabel = win.add("statictext", undefined, "行距");
  var leadingMode = win.add("dropdownlist", undefined, ["自动行距", "指定行距"]);
  var leadingText = win.add("edittext", undefined, "");
  var colorLabel = win.add("statictext", undefined, "颜色");
  var colorText = win.add("edittext", undefined, "");
  var row = win.add("group");
  row.orientation = "row";
  row.alignChildren = ["fill", "center"];
  var applyButton = row.add("button", undefined, "应用");
  var closeButton = row.add("button", undefined, "关闭");
  var dirty = { font: false, fontSize: false, leading: false, color: false };
  var filling = false;
  var fonts = VN.fontNames();
  var canListFonts = fonts.length > 0;
  fontList.visible = canListFonts;
  fontStatic.visible = !canListFonts;

  function scopeName() {
    if (!scopeList.selection || scopeList.selection.index === 0) return "all";
    if (scopeList.selection.index === 1) return "dialogue";
    if (scopeList.selection.index === 2) return "narration";
    return "option";
  }

  function hasDirty() {
    return dirty.font || dirty.fontSize || dirty.leading || dirty.color;
  }

  function fill() {
    filling = true;
    dirty = { font: false, fontSize: false, leading: false, color: false };
    var scope = scopeName();
    influence.text = VN.scopeInfluence(scope);
    var layers = VN.styleTargets(lock.instanceId, scope);
    if (!layers.length) {
      sizeText.text = "";
      colorText.text = "";
      filling = false;
      return;
    }
    var docs = [];
    var i;
    for (i = 0; i < layers.length; i++) docs.push(VN.readStyleDocument(layers[i]));
    var fontValue = docs[0].font;
    var sizeValue = String(docs[0].fontSize);
    var leadMode = docs[0].autoLeading ? "自动行距" : "指定行距";
    var leadValue = String(docs[0].leading);
    var colorValue = VN.colorHex(docs[0].fillColor);
    for (i = 1; i < docs.length; i++) {
      if (docs[i].font !== docs[0].font) fontValue = "多种值";
      if (String(docs[i].fontSize) !== String(docs[0].fontSize)) sizeValue = "多种值";
      var mode = docs[i].autoLeading ? "自动行距" : "指定行距";
      if (mode !== leadMode || String(docs[i].leading) !== String(docs[0].leading)) {
        leadMode = "多种值";
        leadValue = "多种值";
      }
      if (VN.colorHex(docs[i].fillColor) !== colorValue) colorValue = "多种值";
    }
    if (canListFonts) {
      fontList.removeAll();
      if (fontValue === "多种值") fontList.add("item", "多种值");
      for (i = 0; i < fonts.length; i++) fontList.add("item", fonts[i]);
      var picked = 0;
      for (i = 0; i < fontList.items.length; i++) if (fontList.items[i].text === fontValue) picked = i;
      fontList.selection = picked;
    } else {
      fontStatic.text = fontValue;
    }
    sizeText.text = sizeValue;
    if (leadMode === "多种值") {
      leadingMode.selection = 0;
      leadingText.text = "多种值";
    } else {
      leadingMode.selection = leadMode === "自动行距" ? 0 : 1;
      leadingText.text = docs[0].autoLeading ? "" : leadValue;
    }
    colorText.text = colorValue;
    filling = false;
  }

  function askSwitch() {
    var ask = new Window("dialog", "未应用的修改");
    ask.orientation = "column";
    ask.alignChildren = ["fill", "top"];
    ask.add("statictext", undefined, "切换作用对象前，当前修改还没有应用。", { multiline: true });
    var buttons = ask.add("group");
    var apply = buttons.add("button", undefined, "应用后切换");
    var drop = buttons.add("button", undefined, "放弃修改");
    var stay = buttons.add("button", undefined, "继续编辑");
    var choice = "stay";
    apply.onClick = function () { choice = "apply"; ask.close(); };
    drop.onClick = function () { choice = "drop"; ask.close(); };
    stay.onClick = function () { choice = "stay"; ask.close(); };
    ask.show();
    return choice;
  }

  var previousScope = 0;
  scopeList.onChange = function () {
    if (filling) return;
    if (scopeList.selection && scopeList.selection.index === previousScope) return;
    if (hasDirty()) {
      var choice = askSwitch();
      if (choice === "stay") {
        filling = true;
        scopeList.selection = previousScope;
        filling = false;
        return;
      }
      if (choice === "apply") {
        var applied = commit();
        if (!applied) {
          filling = true;
          scopeList.selection = previousScope;
          filling = false;
          return;
        }
      }
    }
    previousScope = scopeList.selection ? scopeList.selection.index : 0;
    fill();
  };
  fontList.onChange = function () { if (!filling) dirty.font = true; };
  sizeText.onChanging = function () { if (!filling) dirty.fontSize = true; };
  leadingMode.onChange = function () { if (!filling) dirty.leading = true; };
  leadingText.onChanging = function () { if (!filling) dirty.leading = true; };
  colorText.onChanging = function () { if (!filling) dirty.color = true; };
  fontButton.onClick = function () {
    var scope = scopeName();
    if (scope === "all") {
      alert("每一类文字使用自己的样式层。接下来定位对白样式层；旁白和选项需要分别打开。");
      VN.revealStyleLayer(lock.instanceId, "dialogue");
      return;
    }
    VN.revealStyleLayer(lock.instanceId, scope);
  };

  function commit() {
    if (!VN.lockMatches(lock)) {
      alert("片段已变化，请关闭窗口后重试。");
      return false;
    }
    var patch = {};
    if (dirty.font && canListFonts && fontList.selection && fontList.selection.text !== "多种值") patch.font = fontList.selection.text;
    if (dirty.font && canListFonts && fontList.selection && fontList.selection.text === "多种值") {
      alert("字体仍是多种值，不能写回。");
      return false;
    }
    if (dirty.fontSize) {
      if (sizeText.text === "多种值") {
        alert("字号仍是多种值，不能写回。");
        return false;
      }
      var size = parseFloat(sizeText.text);
      if (!(size > 0)) {
        alert("字号必须大于 0。");
        return false;
      }
      patch.fontSize = size;
    }
    if (dirty.leading) {
      if (leadingText.text === "多种值") {
        alert("行距仍是多种值，不能写回。");
        return false;
      }
      if (leadingMode.selection && leadingMode.selection.index === 0) patch.leading = { mode: "auto" };
      else {
        var leading = parseFloat(leadingText.text);
        if (!(leading > 0)) {
          alert("行距必须大于 0。");
          return false;
        }
        patch.leading = { mode: "explicit", value: leading };
      }
    }
    if (dirty.color) {
      if (colorText.text === "多种值") {
        alert("颜色仍是多种值，不能写回。");
        return false;
      }
      var color = VN.parseHexColor(colorText.text);
      if (!color) {
        alert("颜色请使用 #RRGGBB。");
        return false;
      }
      patch.fillColor = color;
    }
    if (!patch.font && patch.fontSize === undefined && !patch.leading && !patch.fillColor) return true;
    var layers = VN.styleTargets(lock.instanceId, scopeName());
    var result = VN.applyStylePatch(lock, layers, patch);
    if (result.status !== "updated") {
      alert(result.message);
      return false;
    }
    lock = VN.captureLock(instanceId);
    dirty = { font: false, fontSize: false, leading: false, color: false };
    return true;
  }

  applyButton.onClick = function () {
    if (commit()) fill();
  };
  closeButton.onClick = function () {
    if (hasDirty()) {
      var choice = askSwitch();
      if (choice === "stay") return;
      if (choice === "apply" && !commit()) return;
    }
    win.close();
  };
  fill();
  win.show();
  return { ok: true, message: "样式窗口已关闭" };
};
