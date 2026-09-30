# Visual Novel AE Generator

把视觉小说的剧本和主题配置，生成可在 After Effects 里继续修改的工程。第一版通过配置文件操作，没有网页编辑器。

画面固定为 1920×1080、30fps。选项的出现和最终选中项都写在剧本里，不执行真实分支。

## 环境

- Node.js 20 或更新版本
- Windows
- After Effects 2021 或更新版本。空项目生成时会把表达式引擎改成 JavaScript；向已有工程追加时，如果工程还在用旧引擎，脚本会停下来，不会擅自切换

素材包里的字体文件不会被安装。主题里的 `font` 必须是这台机器上 AE 能识别的 PostScript 名称。示例使用 `MicrosoftYaHei`。生成后若报告缺字体，把三个样式里的名称改成你已安装的字体再重新生成。

更细的结构、转场和文字表达式说明见 [DESIGN.md](DESIGN.md)。

## 命令

```bash
npm install
npm test
npm run panel
npx tsx src/cli.ts validate examples/connection-test
npx tsx src/cli.ts build examples/connection-test --out exports/connection-test
```

`build` 会在输出目录写入作品包。入口文件 `vn-package.json` 最后写入，避免选到还没生成完的目录。新版本请换一个 `--out` 目录；如果目标里已经有另一份 `buildId`，命令会停下来，不会覆盖素材。

```text
exports/connection-test/
├── vn-package.json
├── compiled.json
├── assets/
├── source/
├── report.json
├── generate_project.jsx
├── refresh_text_timing.jsx
└── convert_v1_text_animation.jsx
```

`generate_project.jsx` 只作为兼容入口保留。日常不需要运行它。

## 安装面板

1. 运行 `npm run panel`，得到 `release/VN Panel.jsx`。
2. 复制到你正在使用的 After Effects 的 `Support Files/Scripts/ScriptUI Panels`。不同版本的安装目录不一样，工具不会写死路径。
3. 重新打开 After Effects，从「窗口」菜单打开「文字冒险」，停靠到工作区。之后可以从这个工作区继续用。
4. 开发调试时，也可以用「文件 > 脚本 > 运行脚本文件」直接打开浮动窗口。

## 导入作品包

1. 修改剧本、主题和素材后执行 `vn-ae build`，把整个作品包留在固定目录。不要删这个目录，AE 会持续引用里面的素材。面板可以打开素材目录。
2. 在面板里「选择作品包」，选中 `vn-package.json`。面板会检查版本、摘要和素材，并显示作品名、版本、场景数、文字段数和时长。
3. 导入位置默认是「仅加入项目面板」。要放进时间轴时选「插入当前合成」；点击导入前会重新读取当前合成和播放头。超出合成结尾时只询问一次是否延长，取消则完全不改工程。
4. 导入成功后打开主合成开始精修。成功不会再弹出提示框。失败原因可以展开并复制。
5. 同一个包再导入时，可以从「最近使用」选。最近列表最多 5 条，只在导入成功后更新。同一次构建已在工程里时，可以选择打开已有片段，或再导入一个副本。不同 `buildId` 会作为新版本新建实例。

面板导入不会自动保存工程。兼容脚本 `generate_project.jsx` 在空项目里仍会把工程另存到作品包旁边。

每个实例在项目面板里有自己的目录，合成名带 `VN_` 和本次导入的短编号。字体、字号、颜色仍由该实例里的样式合成实时控制。打字、逐行和淡入写在关键帧上，可以直接拖。

选中生成器文字层后，面板才出现「按新文案重建动画」。它会重写打字关键帧；手工改过的层会跳过，其他动画器、效果和位置也不会被动。字数需要的时间超过事件长度时会提示，不会把后面的事件往后推，也不会悄悄截断。

速度、动画预设和解除样式关联放在「更多」里。这些批量操作每次都从「选中文字」开始，并显示实际层数。速度以动画第一帧为起点缩放间距，大于 1 会加快；手工改过的层默认跳过，只有勾选「按现有关键帧缩放」才会动它们。第一版工程的迁移脚本不在日常面板里。

## 作品目录

```text
my-video/
├── project.json
├── theme.json
├── script.json
└── assets/
```

日常只写事件顺序、文案和少量节奏覆盖，不写每条开始时间。事件 ID 在全片内唯一；改文案时保持 ID 不变。

生成器不会把 AE 里的修改读回配置。重新 build 再导入会新建一个实例，原来的实例和里面的手工关键帧都还在。
