var VN = VN || {};

VN.showPanel = function () {
  try {
    if (VN._panel && VN._panel.visible) {
      VN._panel.show();
      return;
    }
  } catch (ignorePanel) {}
  var win = new Window("palette", "VN 生成器", undefined, { resizeable: false });
  win.orientation = "column";
  win.alignChildren = ["fill", "top"];
  win.spacing = 6;
  win.margins = 12;

  var scopeRow = win.add("group");
  scopeRow.orientation = "row";
  scopeRow.alignChildren = ["left", "center"];
  scopeRow.add("statictext", undefined, "范围");
  var scope = scopeRow.add("dropdownlist", undefined, ["选中文字", "当前合成", "当前实例"]);
  scope.selection = 0;
  scope.preferredSize.width = 140;

  function currentScope() {
    if (scope.selection.index === 1) return "scene";
    if (scope.selection.index === 2) return "instance";
    return "selection";
  }

  win.add("button", undefined, "导入生成包").onClick = function () {
    VN.importPackage();
  };
  win.add("button", undefined, "定位控制器").onClick = function () {
    VN.locateControl();
  };
  win.add("button", undefined, "刷新文字").onClick = function () {
    VN.refreshTargets(currentScope());
  };

  var speedRow = win.add("group");
  speedRow.orientation = "row";
  speedRow.alignChildren = ["left", "center"];
  speedRow.add("statictext", undefined, "速度倍率");
  var speedText = speedRow.add("edittext", undefined, "2");
  speedText.characters = 6;
  var keepManual = win.add("checkbox", undefined, "按现有关键帧缩放");
  win.add("button", undefined, "应用速度").onClick = function () {
    var speed = parseFloat(speedText.text);
    if (!(speed > 0)) {
      alert("速度倍率必须大于 0。大于 1 会加快，小于 1 会放慢。");
      return;
    }
    VN.applySpeedTargets(currentScope(), speed, keepManual.value);
  };

  var presetRow = win.add("group");
  presetRow.orientation = "row";
  presetRow.alignChildren = ["left", "center"];
  presetRow.add("statictext", undefined, "动画预设");
  var preset = presetRow.add("dropdownlist", undefined, ["打字机", "逐行出现", "整段淡入"]);
  preset.selection = 0;
  preset.preferredSize.width = 120;
  win.add("button", undefined, "应用预设").onClick = function () {
    var name = preset.selection.index === 1 ? "lines" : preset.selection.index === 2 ? "fade" : "typewriter";
    VN.applyPresetTargets(currentScope(), name);
  };

  win.add("button", undefined, "检查时长与关联").onClick = function () {
    VN.checkTargets(currentScope());
  };
  win.add("button", undefined, "解除样式关联").onClick = function () {
    VN.unlinkTargets(currentScope());
  };

  win.onClose = function () {
    VN._panel = null;
  };
  VN._panel = win;
  win.center();
  win.show();
};
