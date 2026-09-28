import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = [
  "lib.jsx",
  "project.jsx",
  "layers.jsx",
  "timing.jsx",
  "refresh.jsx",
  "tools.jsx",
  "package-reader.jsx",
  "context.jsx",
  "preferences.jsx",
  "import-service.jsx",
  "panel.jsx",
];

const banner = [
  "// 文字冒险面板。复制到 After Effects 的 ScriptUI Panels 目录后，从「窗口」菜单打开。",
  "// 也可以用「文件 > 脚本 > 运行脚本文件」打开浮动窗口，方便调试。",
  "// 这个文件是工具本身，不要放进作品包。作品包通过 vn-package.json 导入。",
  "",
].join("\n");

const body = files
  .map((name) => fs.readFileSync(path.join(root, "ae", name), "utf8").replace(/^\uFEFF/, ""))
  .join("\n");
const releaseDir = path.join(root, "release");
fs.mkdirSync(releaseDir, { recursive: true });
const target = path.join(releaseDir, "VN Panel.jsx");
fs.writeFileSync(target, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(banner + body + "\nVN.buildPanel(this);\n", "utf8")]));
console.log(target);
