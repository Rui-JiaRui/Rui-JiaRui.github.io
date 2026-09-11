# 法考客观题题库网站（Designed by Jiarui Zhang, exclusively for Rui Liu）

## 目录结构

每套试卷使用独立目录：

```text
data/exams/<试卷ID>/
├── paper.json
└── answer-key.json   # 可选；没有时提交结果为待批改
```

复制 `paper-template.json` 为 `data/exams/<试卷ID>/paper.json`，复制 `answer-key-template.json` 为同目录的 `answer-key.json`，然后替换示例内容。将相同的试卷 ID 写入 `data/registry.json` 账号的 `paperIds` 数组。

## 字段约定

`paper.id`、目录名和答案文件的 `paperId` 必须一致；`title`、`description` 用于选择页；`durationMinutes` 为倒计时分钟数；`totalScore` 应等于题目分值之和；`hasAnswerKey` 只声明预览状态，不会代替实际答案文件。

| 字段 | 位置 | 说明 |
| --- | --- | --- |
| `schemaVersion` | `paper.json` 根级 | 试卷数据结构版本，例如 `1.0`。 |
| `paper.id` | `paper.json` | 试卷唯一 ID，须与目录名一致。 |
| `paper.durationMinutes` | `paper.json` | 倒计时分钟数，必须为正数。 |
| `paper.totalScore` | `paper.json` | 试卷总分，必须等于所有题目分值之和。 |
| `paper.showResultAfterSubmit` | `paper.json` | 是否在交卷后显示结果。 |
| `paper.hasAnswerKey` | `paper.json` | 选择页状态声明；实际判分仍检查 `answer-key.json`。 |
| `questions[].type` | `paper.json` | 只能使用 `single`、`multiple` 或 `indefinite`。 |
| `questions[].score` | `paper.json` | 该题分值，参与总分校验。 |
| `answers` | `answer-key.json` | 以题目 ID 为键，保存答案选项和解析。 |
| `answer` | `answer-key.json` | 选项 key 数组；每个 key 必须存在于对应题目。 |

计分按题目分值计算：答对整题得该题分，答案不完整或包含错误选项则不得分；总分为各题分值之和。

题目 `id` 在一套试卷内必须唯一，`type` 只能是 `single`、`multiple` 或 `indefinite`，每题至少两个选项，选项 `key` 在题内唯一。答案文件的每个题目 ID 和选项 key 都必须存在于 `paper.json`。

## 校验

```bash
node -e "JSON.parse(require('fs').readFileSync('data/exams/manual-2026-01/paper.json'))"
node -e "JSON.parse(require('fs').readFileSync('data/exams/manual-2026-01/answer-key.json'))"
```

部署到静态服务器后直接访问页面即可。若需要直接双击 `index.html` 进行 `file://` 预览，请在新增或修改题库后运行：

```bash
node scripts/generate-demo.js
```

该脚本从 `data/registry.json` 和 `data/exams/` 自动生成 `data/demo.js`，因此不需要手工在两个文件中重复录入题目。`data/demo.js` 是生成文件，不要直接编辑。

题干、选项和解析中的换行使用 JSON 字符串转义 `\n` 表示，例如 `"第一行\\n第二行"`；页面和导出 HTML 会保留这些换行，并在超长单词或链接处自动折行。

## 答卷与重新考试

答卷进度和成绩只保存在当前浏览器的 IndexedDB（不支持时回退到 localStorage）。同一账号同一试卷最多保留一个 `in_progress` 答卷；选择“重新考试”时，已完成答卷会原样保留，并创建新的答卷 ID、计时、答案和标记。若已有进行中的答卷，系统会先询问是否放弃，放弃后该记录标记为 `abandoned`，原有答案仍可在历史记录中查看。

结果页和试卷选择页会显示历史答卷，可重新打开某次结果；“重新考试”不会覆盖或删除旧成绩。

## 从 TXT 自动生成题库

固定格式的错题文本可以直接转换并发布：

```bash
node scripts/import-exam-txt.js generate/20260801.txt
```

输入文件名会作为试卷 ID。命令会生成 `generate/20260801/` 下的 `paper.json` 和 `answer-key.json`，将相同文件发布到 `data/exams/20260801/`，并把 `20260801` 加入账号 `liurui` 的 `paperIds`。重复运行会覆盖同名题库，但不会在 registry 中重复添加 ID，也不会生成或修改 `data/demo.js`。

每道题必须由以下三块内容组成，并以 `本题答案：` 行结束：

```text
【刑法134】题干内容（多选）
A.选项 A
B.选项 B

答案解析，可以有多行。
第二行解析。

本题答案：AB，小睿第一次选B
```

每道新题必须以 `【科目编号】` 开始。支持 `（单选）`、`（多选）`、`（不定项）`；单选每题 1 分、1 分钟，多选和不定项每题 2 分、2 分钟。连续答案字母会自动拆分，例如 `AB` 生成 `["A", "B"]`。科目、总分、总时长、题目 ID 和标签均由脚本自动生成。

若题型不合法、选项不足或重复、缺少解析或答案、答案引用不存在的选项，脚本会显示文件行号并停止，且不会发布这次无效输入。若之后需要直接双击 `index.html` 预览新题库，再单独运行 `node scripts/generate-demo.js`。

## GitHub Pages 缓存

页面每次打开或手动刷新时，会为 `styles.css`、`data/demo.js`、`app.js`、账号配置和题库 JSON 附加本次页面的版本参数，并以不使用浏览器缓存的方式请求 JSON。因此 GitHub Pages 部署完成后，普通刷新即可获取最新资源，不需要长期使用无痕模式或手工清理缓存。

第一次部署这套加载逻辑时，已经缓存旧 `index.html` 的浏览器可能仍需执行一次强制刷新。页面不会在答题过程中后台自动刷新；已经打开的页面需要手动刷新后才会加载新版本。
