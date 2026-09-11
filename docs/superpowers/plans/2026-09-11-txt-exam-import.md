# TXT Exam Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Convert structured wrong-question TXT files into valid exam packages, publish them to `data/exams`, register them for `liurui`, and prevent result-page button text from stacking vertically.

**Architecture:** Add a dependency-free CommonJS module/CLI with pure parsing and building functions plus an isolated publishing function. Validate all input and registry state before writing generated and deployed JSON; retain `data/demo.js` unchanged. Apply a narrowly scoped responsive CSS fix to the existing result action group.

**Tech Stack:** Node.js built-ins (`fs`, `path`, `node:test`), JSON, static CSS.

---

## File Structure

- Create `scripts/import-exam-txt.js`: parse TXT, build exam objects, validate, publish files, update registry, and expose functions for tests.
- Create `tests/txt-exam-import.test.js`: pure parser/builder tests and temporary-directory publishing tests.
- Modify `styles.css`: keep result action buttons horizontal and prevent internal text wrapping.
- Modify `tests/manual-import.test.js`: add CSS regression assertions.
- Generate `generate/20260801/paper.json` and `generate/20260801/answer-key.json` from the sample.
- Create `data/exams/20260801/paper.json` and `data/exams/20260801/answer-key.json` from the sample.
- Modify `data/registry.json`: add `20260801` once to `liurui.paperIds`.
- Modify `data/templates/README.md`: document the TXT import command and format.

### Task 1: Parse Structured TXT

**Files:**
- Create: `tests/txt-exam-import.test.js`
- Create: `scripts/import-exam-txt.js`

- [x] **Step 1: Write failing parser tests**

Create tests importing `parseExamText` and assert that a fixture containing single, multiple, and indefinite questions produces three normalized questions. Assert `S001`, `M001`, `I001`; option arrays; answers such as `AB` becoming `["A", "B"]`; subject extraction; preserved multiline analysis; and first-attempt text appended to analysis. Add invalid fixtures for missing answers, unsupported types, duplicate options, and answers referencing absent options, and assert errors contain line numbers.

- [x] **Step 2: Run parser tests and verify RED**

Run: `node --test tests/txt-exam-import.test.js`

Expected: FAIL because `scripts/import-exam-txt.js` does not exist.

- [x] **Step 3: Implement the state-machine parser**

Implement:

```js
function parseExamText(text, sourceName = '<input>')
```

Normalize CRLF to LF, recognize question headers with `^【(.+?)(\d+)】.*（(单选|多选|不定项)）\s*$`, options with `^([A-Z])[.．、]\s*(.+)$`, and answers with `^本题答案[：:]\s*([A-Z]+)(?:[，,]\s*(.*))?$`. Track source line numbers, require at least two unique options and nonempty analysis, validate every answer key, and return questions with `subject`, `type`, `stem`, `options`, `answer`, and `analysis`.

- [x] **Step 4: Run parser tests and verify GREEN**

Run: `node --test tests/txt-exam-import.test.js`

Expected: all parser tests PASS.

### Task 2: Build Exam JSON

**Files:**
- Modify: `tests/txt-exam-import.test.js`
- Modify: `scripts/import-exam-txt.js`

- [x] **Step 1: Write failing builder tests**

Test:

```js
buildExamFiles('20260801', parsedQuestions)
```

Assert title `20260801错题回顾`, subjects joined with `、` in first-seen order, `totalScore` and `durationMinutes` calculated with the 1/1 and 2/2 rules, `hasAnswerKey: true`, question tags, per-type IDs, and answer arrays keyed by generated question ID.

- [x] **Step 2: Run builder tests and verify RED**

Run: `node --test tests/txt-exam-import.test.js`

Expected: FAIL because `buildExamFiles` is not exported.

- [x] **Step 3: Implement the pure builder**

Implement:

```js
function buildExamFiles(paperId, parsedQuestions) {
  return { paper, answerKey };
}
```

Use counters `{ single: 0, multiple: 0, indefinite: 0 }`, prefixes `{ single: 'S', multiple: 'M', indefinite: 'I' }`, and weights `{ single: 1, multiple: 2, indefinite: 2 }`. Emit schema/version `1.0` and JSON structures matching `data/templates`.

- [x] **Step 4: Run builder tests and verify GREEN**

Run: `node --test tests/txt-exam-import.test.js`

Expected: all parser and builder tests PASS.

### Task 3: Publish and Register the Exam

**Files:**
- Modify: `tests/txt-exam-import.test.js`
- Modify: `scripts/import-exam-txt.js`

- [x] **Step 1: Write failing publishing tests**

Use `fs.mkdtempSync` to construct an isolated project containing `generate/sample.txt` and a registry with `liurui`. Call `importExamFile(inputPath, projectRoot)` and assert both output directories contain equivalent JSON, registry contains the ID once after two imports, unrelated accounts are unchanged, and no `demo.js` is created or modified. Snapshot output and registry, run an invalid import, and assert the snapshot is unchanged.

- [x] **Step 2: Run publishing tests and verify RED**

Run: `node --test tests/txt-exam-import.test.js`

Expected: FAIL because `importExamFile` is not exported.

- [x] **Step 3: Implement publishing and CLI behavior**

Implement:

```js
function importExamFile(inputPath, projectRoot = path.resolve(__dirname, '..'))
```

Resolve and validate `.txt`, derive a safe basename ID, parse/build fully in memory, load and validate registry and `liurui`, create only the two target directories, write pretty JSON with a final newline, and update `paperIds` only when absent. Add `if (require.main === module)` CLI handling with concise success output and nonzero error exit.

- [x] **Step 4: Run publishing tests and verify GREEN**

Run: `node --test tests/txt-exam-import.test.js`

Expected: all import tests PASS.

### Task 4: Fix Result Action Layout

**Files:**
- Modify: `tests/manual-import.test.js`
- Modify: `styles.css`

- [x] **Step 1: Write failing CSS regression test**

Assert `.result-actions` contains `flex-wrap: wrap`, `.result-actions .button` contains `white-space: nowrap` and `flex-shrink: 0`, and the mobile media rule no longer sets `.result-actions` to `flex-direction: column`.

- [x] **Step 2: Run the CSS test and verify RED**

Run: `node tests/manual-import.test.js`

Expected: FAIL because current mobile CSS forces a column and buttons can shrink/wrap internally.

- [x] **Step 3: Apply the scoped CSS fix**

Set:

```css
.result-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 9px; margin-top: 22px; }
.result-actions .button { flex: 0 0 auto; white-space: nowrap; }
```

In the mobile media query retain `justify-content: flex-start` and remove `flex-direction: column`.

- [x] **Step 4: Run the CSS test and verify GREEN**

Run: `node tests/manual-import.test.js`

Expected: all existing and CSS regression tests PASS.

### Task 5: Generate and Publish 20260801

**Files:**
- Generate: `generate/20260801/paper.json`
- Generate: `generate/20260801/answer-key.json`
- Create: `data/exams/20260801/paper.json`
- Create: `data/exams/20260801/answer-key.json`
- Modify: `data/registry.json`
- Modify: `data/templates/README.md`

- [x] **Step 1: Run the importer on the supplied sample**

Run: `node scripts/import-exam-txt.js generate/20260801.txt`

Expected: success reports one imported question and paths under both `generate/20260801` and `data/exams/20260801`.

- [x] **Step 2: Verify generated sample semantics**

Assert the sample is `M001`, score 2, duration 2, answer `["A", "B", "C", "D"]`, description `刑法`, and registry contains `20260801` exactly once. Confirm `data/demo.js` has not changed during import.

- [x] **Step 3: Document the importer**

Add a README section showing the command, three TXT regions, supported type markers, automatic output/registry behavior, validation failures, and explicit statement that `demo.js` is not regenerated.

### Task 6: Full Verification

**Files:**
- Verify all files above.

- [x] **Step 1: Run all tests and syntax checks**

Run:

```bash
node --test tests/*.test.js
node --check scripts/import-exam-txt.js
node --check app.js
node --check data/demo.js
```

Expected: zero failures and zero syntax errors.

- [x] **Step 2: Validate every JSON package**

Parse every `data/**/*.json` and `generate/**/*.json`; assert unique question IDs, legal types, score totals, answer question IDs, and answer option keys.

Expected: `all JSON packages valid`.

- [x] **Step 3: Confirm import scope**

Confirm `data/registry.json` includes `20260801`, `data/exams/20260801` matches `generate/20260801`, and `data/demo.js` does not contain `20260801`.

Expected: all scope assertions pass.

Git commit steps are omitted because `/home/jrzhang/Documents/Law` is not a Git repository.
