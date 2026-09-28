var VN = VN || {};

VN.PREFS_SECTION = "VNTextAdventure";
VN.PREFS_RECENT = "recentPackages";
VN.RECENT_LIMIT = 5;

VN.readRecentPackages = function () {
  try {
    if (!app.settings.haveSetting(VN.PREFS_SECTION, VN.PREFS_RECENT)) return [];
    var parsed = JSON.parse(app.settings.getSetting(VN.PREFS_SECTION, VN.PREFS_RECENT));
    if (!(parsed instanceof Array)) return [];
    return parsed;
  } catch (ignore) {
    return [];
  }
};

VN.writeRecentPackages = function (items) {
  app.settings.saveSetting(VN.PREFS_SECTION, VN.PREFS_RECENT, JSON.stringify(items));
};

VN.rememberSuccessfulImport = function (entry) {
  try {
    var items = VN.readRecentPackages();
    var next = [entry];
    var i;
    for (i = 0; i < items.length; i++) {
      if (VN.samePath(items[i].manifestPath, entry.manifestPath)) continue;
      next.push(items[i]);
      if (next.length >= VN.RECENT_LIMIT) break;
    }
    VN.writeRecentPackages(next);
  } catch (ignoreRemember) {}
};

VN.replaceRecentPath = function (previousPath, entry) {
  var items = VN.readRecentPackages();
  var next = [];
  var replaced = false;
  var i;
  for (i = 0; i < items.length; i++) {
    if (!replaced && VN.samePath(items[i].manifestPath, previousPath)) {
      next.push(entry);
      replaced = true;
    } else if (!VN.samePath(items[i].manifestPath, entry.manifestPath)) {
      next.push(items[i]);
    }
    if (next.length >= VN.RECENT_LIMIT) break;
  }
  if (!replaced) next.unshift(entry);
  VN.writeRecentPackages(next.slice(0, VN.RECENT_LIMIT));
};

VN.timestampNow = function () {
  var date = new Date();
  function pad(value) {
    return value < 10 ? "0" + value : String(value);
  }
  return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()) + " " + pad(date.getHours()) + ":" + pad(date.getMinutes());
};

VN.samePath = function (left, right) {
  return String(left || "").replace(/\\/g, "/").toLowerCase() === String(right || "").replace(/\\/g, "/").toLowerCase();
};

VN.copyText = function (text) {
  var file = new File(Folder.temp.fsName + "/vn-panel-clipboard.txt");
  file.encoding = "UTF-8";
  if (!file.open("w")) return false;
  file.write(String(text || ""));
  file.close();
  if (String($.os).indexOf("Windows") === -1) return false;
  var literal = file.fsName.replace(/'/g, "''");
  var command = "powershell -NoProfile -Command \"Get-Content -LiteralPath '" + literal + "' -Raw -Encoding UTF8 | Set-Clipboard\"";
  try {
    system.callSystem(command);
    return true;
  } catch (ignore) {
    return false;
  }
};
