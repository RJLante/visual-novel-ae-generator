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
npx tsx src/cli.ts validate examples/connection-test
npx tsx src/cli.ts build examples/connection-test --out exports/connection-test
```

`build` 会在输出目录写入：

```text
exports/connection-test/
├── generate_project.jsx
├── refresh_text_timing.jsx
├── convert_v1_text_animation.jsx
├── compiled.json
├── source/
├── assets/
└── report.json
```

## 在 After Effects 里生成工程

1. 文件 > 脚本 > 运行脚本文件，选择输出目录里的 `generate_project.jsx`。
2. 空项目会创建合成，并把 `.aep` 保存到同一目录。已经打开的工程会追加一个独立实例，不改已有时间轴，也不自动保存。
3. 如果工程里已有带 `USER_OVERLAY` 和场景层的 `MASTER`，脚本会询问是否把新实例放在该 `USER_OVERLAY` 下面，与场景层并列。超出宿主结尾时，再询问是否延长。画面按 100% 放入，不拉伸。
4. 同一份生成包可以再导入一次，第二次是另一个实例，控制器互不影响。
5. 检查结果写在 `report.ae.json`。整个输出目录一起移动后，脚本按自己旁边的 `assets/` 找素材。

每个实例在项目面板里有自己的目录，合成名带 `VN_` 和本次导入的短编号。字体、字号、颜色仍由该实例里的样式合成实时控制。打字、逐行和淡入写在关键帧上，可以直接拖。

改了句子之后，可以运行 `vn_panel.jsx` 打开操作面板，或只运行 `refresh_text_timing.jsx`。刷新默认只处理选中的文字层，也可以改成当前合成或当前实例。它只重写生成器管理的打字关键帧。关键帧若已被手工改过，这一层会跳过，其他动画器、效果和位置也不会被动。字数需要的时间超过事件长度时会提示，不会把后面的事件往后推，也不会悄悄截断。

面板里的「应用速度」以动画第一帧为起点缩放关键帧间距。大于 1 会加快。手工改过的层默认跳过；勾选「按现有关键帧缩放」才会动那些层，而且之后的文案刷新仍会跳过它们。「应用预设」在打字机、逐行和整段淡入之间重建这一条动画通道。「解除样式关联」把当前字体和颜色写回文字，再去掉样式表达式。

第一版工程里的打字表达式，用 `convert_v1_text_animation.jsx` 按当前画面采样成关键帧。这是保持现状的迁移，不是按剧本重新计算。

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
