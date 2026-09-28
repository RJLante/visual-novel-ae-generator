# Visual Novel AE Generator

把视觉小说的剧本和主题配置，生成可在 After Effects 里继续修改的工程。第一版通过配置文件操作，没有网页编辑器。

画面固定为 1920×1080、30fps。选项的出现和最终选中项都写在剧本里，不执行真实分支。

## 环境

- Node.js 20 或更新版本
- Windows
- After Effects 2021 或更新版本。生成脚本会把表达式引擎改成 JavaScript

素材包里的字体文件不会被安装。主题里的 `font` 必须是这台机器上 AE 能识别的 PostScript 名称。示例使用 `MicrosoftYaHei`。生成后若报告缺字体，把三个样式里的名称改成你已安装的字体再重新生成。

更细的结构、转场和文字表达式说明见 [DESIGN.md](DESIGN.md)。

## 命令

```bash
npm install
npm test
npx tsx src/cli.ts validate examples/connection-test
npx tsx src/cli.ts build examples/connection-test --out exports/connection-test
```

`build` 会在输出目录写入：

```text
exports/connection-test/
├── generate_project.jsx
├── refresh_text_timing.jsx
├── compiled.json
├── source/
├── assets/
└── report.json
```

## 在 After Effects 里生成工程

1. 新建一个空项目。不要在已经打开的工程里运行。
2. 文件 > 脚本 > 运行脚本文件，选择输出目录里的 `generate_project.jsx`。
3. 脚本创建合成和表达式，并把 `connection-test.aep` 保存在同一目录。检查结果写在 `report.ae.json`。
4. 整个输出目录一起移动。工程继续使用旁边的 `assets/`。

全局控制在 `CONTROL` 合成里，不进入最终画面：

- **字号倍率**、**全局文字不透明度**、**统一字体**、**统一颜色**会立刻影响对应文字。
- **文字动画模式**：0 使用事件预设，1 打字机，2 整段淡入，3 逐行出现。
- **预览速度**只改变文字显示快慢，不重排时间轴。正式改节奏时，修改 `project.json` 后重新 build，再生成新工程。新工程的预览速度会回到 1。

可以直接改文字层里的句子，表达式不会把文案写回配置里的旧内容。如果字数变了，打字进度可能对不上：打开该文字层所在合成，选中文字层，运行 `refresh_text_timing.jsx`。它只刷新这一层的进度。时长不够时会提示重新生成，不会挪动后面的事件。

颜色、字号和字体请改 `STYLE_DIALOGUE`、`STYLE_NARRATION`、`STYLE_OPTION` 里的样式层。

## 作品目录

```text
my-video/
├── project.json
├── theme.json
├── script.json
└── assets/
```

日常只写事件顺序、文案和少量节奏覆盖，不写每条开始时间。事件 ID 在全片内唯一；改文案时保持 ID 不变。

第一版不从 AE 读回修改，也不会保留旧工程里的手工精修。需要新版本时换一个输出目录。
