# Manual Exam Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update the demonstration credentials to `liurui` / `K180` and make manually maintained exam packages easier to create and verify.

**Architecture:** Keep the static JSON repository model unchanged. Add canonical copy-ready templates and documentation, then derive non-sensitive preview metadata from each loaded `paper.json`; answer availability is declared by `paper.hasAnswerKey` while grading still depends on loading `answer-key.json`.

**Tech Stack:** Static HTML, CSS, browser JavaScript, JSON, Node.js built-in test runner.

---

## File Structure

- `app.js`: login hint, local-preview password fallback, paper-card metadata rendering, and exported helper hooks for tests.
- `data/registry.json`: deployed credential mapping.
- `data/demo.js`: direct-`file://` fallback credentials and sample paper metadata.
- `data/exams/fa-2026-01/paper.json`: graded sample declaration.
- `data/exams/fa-2026-02/paper.json`: ungraded sample declaration.
- `data/templates/paper-template.json`: canonical editable paper template.
- `data/templates/answer-key-template.json`: canonical editable answer template.
- `data/templates/README.md`: manual installation and validation guide.
- `tests/manual-import.test.js`: automated credential, template, and preview-metadata checks.

### Task 1: Add failing credential and template tests

**Files:**
- Create: `tests/manual-import.test.js`

- [x] **Step 1: Write tests for the requested credentials and missing templates**

Use Node's `node:test`, `assert`, `fs`, `vm`, and `crypto` modules. Assert that `registry.json` contains `liurui`, its hash equals `sha256('K180')`, `data/demo.js` contains the same account, and both template JSON files exist and parse.

- [x] **Step 2: Run the tests and verify RED**

Run: `node --test tests/manual-import.test.js`

Expected: FAIL because the current account is `student01` and `data/templates/*.json` do not exist.

### Task 2: Update demonstration credentials

**Files:**
- Modify: `app.js`
- Modify: `data/registry.json`
- Modify: `data/demo.js`

- [x] **Step 1: Calculate the password hash**

Run:

```bash
node -e "const c=require('crypto'); console.log(c.createHash('sha256').update('K180').digest('hex'))"
```

Use the exact output in both credential stores and the local Web Crypto fallback.

- [x] **Step 2: Replace the visible and stored demonstration credentials**

Set the visible hint to `专用账号：liurui · 密码：K180`. Replace the account username and hash in both stores, and change the local fallback password comparison from `law2026` to `K180`.

- [x] **Step 3: Run the credential test**

Run: `node --test tests/manual-import.test.js`

Expected: credential assertions PASS while template assertions remain FAIL.

### Task 3: Add canonical manual-import templates and guide

**Files:**
- Create: `data/templates/paper-template.json`
- Create: `data/templates/answer-key-template.json`
- Create: `data/templates/README.md`

- [x] **Step 1: Create the paper template**

Include `schemaVersion`, paper metadata (`id`, `title`, `description`, `durationMinutes`, `totalScore`, `hasAnswerKey`, and result settings), plus one valid example each for `single`, `multiple`, and `indefinite`. Use expanded indentation and descriptive Chinese example text.

- [x] **Step 2: Create the answer-key template**

Set the same example `paperId`, a version, and keyed answers for all three example question IDs. Keep answers and analyses out of `paper-template.json`.

- [x] **Step 3: Create the maintenance guide**

Document the exact directory tree, copy/rename workflow, registry update, field table, legal question types, scoring rule, `hasAnswerKey` semantics, JSON validation commands, and the special `data/demo.js` requirement for direct-file preview.

- [x] **Step 4: Run template tests and verify GREEN**

Run: `node --test tests/manual-import.test.js`

Expected: all credential and template tests PASS.

### Task 4: Add preview metadata to paper cards

**Files:**
- Modify: `app.js`
- Modify: `styles.css`
- Modify: `data/exams/fa-2026-01/paper.json`
- Modify: `data/exams/fa-2026-02/paper.json`
- Modify: `data/demo.js`
- Modify: `tests/manual-import.test.js`

- [x] **Step 1: Add failing paper-summary tests**

Assert that a summary helper returns counts for all three supported types and that the existing sample papers explicitly declare `hasAnswerKey` as true/false.

- [x] **Step 2: Run the new tests and verify RED**

Run: `node --test tests/manual-import.test.js`

Expected: FAIL because the helper and declarations do not exist.

- [x] **Step 3: Implement preview metadata**

Add a pure `summarizePaper(data)` helper. Update `paperCard()` to display the paper ID, per-type counts, and a graded/pending badge. Add `hasAnswerKey: true` to paper one and `false` to paper two in both JSON packages and direct-file fallback data.

- [x] **Step 4: Style the new card metadata**

Add compact ID, type-stat, and answer-status classes with accessible green and amber contrast. Preserve the current responsive two-column/one-column behavior.

- [x] **Step 5: Run tests and verify GREEN**

Run: `node --test tests/manual-import.test.js`

Expected: all tests PASS.

### Task 5: Full verification

**Files:**
- Verify all modified and created files.

- [x] **Step 1: Validate JavaScript syntax**

Run: `node --check app.js && node --check data/demo.js`

Expected: exit code 0 with no output.

- [x] **Step 2: Validate all JSON files**

Run a Python script that parses every `data/**/*.json`, asserts unique question IDs, legal question types, at least two options per question, and answer keys referencing only valid question/option IDs.

Expected: `all JSON packages and templates valid`.

- [x] **Step 3: Run the full test suite**

Run: `node --test tests/manual-import.test.js`

Expected: all tests PASS with zero failures.

- [x] **Step 4: Scan for retired demo credentials**

Run: `rg -n "student01|law2026" app.js data index.html`

Expected: no matches.

Commits are omitted because `/home/jrzhang/Documents/Law` is not a Git repository.
