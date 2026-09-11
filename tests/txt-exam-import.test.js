const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  parseExamText,
  buildExamFiles,
  importExamFile
} = require('../scripts/import-exam-txt');

const sample = `【刑法1】第一题？（单选）
A.选项甲
B.选项乙

第一段解析。
第二段解析。

本题答案：A，小睿第一次选B

【民法2】第二题？（多选）
A.选项甲
B.选项乙
C.选项丙

多选解析。

本题答案：AC

【刑法3】第三题？（不定项）
A.选项甲
B.选项乙

不定项解析。

本题答案：AB
`;

test('parseExamText recognizes three question regions and supported types', () => {
  const questions = parseExamText(sample, 'sample.txt');

  assert.equal(questions.length, 3);
  assert.deepEqual(questions.map((item) => item.type), ['single', 'multiple', 'indefinite']);
  assert.deepEqual(questions[0].options, [
    { key: 'A', text: '选项甲' },
    { key: 'B', text: '选项乙' }
  ]);
  assert.deepEqual(questions[0].answer, ['A']);
  assert.equal(questions[0].subject, '刑法');
  assert.equal(questions[0].analysis, '第一段解析。\n第二段解析。\n小睿第一次选B');
  assert.deepEqual(questions[1].answer, ['A', 'C']);
  assert.deepEqual(questions[2].answer, ['A', 'B']);
});

test('parseExamText accepts CRLF and ignores surrounding blank lines', () => {
  const questions = parseExamText(`\r\n${sample.replace(/\n/g, '\r\n')}\r\n`, 'windows.txt');
  assert.equal(questions.length, 3);
  assert.equal(questions[1].stem, '【民法2】第二题？（多选）');
});

test('parseExamText reports line-numbered structural errors', () => {
  assert.throws(
    () => parseExamText('【刑法1】题目（判断）\nA.甲\nB.乙\n\n解析\n本题答案：A', 'bad.txt'),
    /bad\.txt:1.*不支持的题型/
  );
  assert.throws(
    () => parseExamText('【刑法1】题目（单选）\nA.甲\nA.乙\n\n解析\n本题答案：A', 'bad.txt'),
    /bad\.txt:3.*选项 A 重复/
  );
  assert.throws(
    () => parseExamText('【刑法1】题目（单选）\nA.甲\nB.乙\n\n解析\n本题答案：C', 'bad.txt'),
    /bad\.txt:6.*答案 C 不在选项中/
  );
  assert.throws(
    () => parseExamText('【刑法1】题目（多选）\nA.甲\nB.乙\n\n解析\n本题答案：AA', 'bad.txt'),
    /bad\.txt:6.*答案选项重复/
  );
  assert.throws(
    () => parseExamText('【刑法1】题目（单选）\nA.甲\nB.乙\n\n解析', 'bad.txt'),
    /bad\.txt:1.*缺少答案行/
  );
});

test('buildExamFiles derives metadata, scores, duration and type-specific IDs', () => {
  const result = buildExamFiles('20260801', parseExamText(sample));

  assert.equal(result.paper.paper.id, '20260801');
  assert.equal(result.paper.paper.title, '20260801错题回顾');
  assert.equal(result.paper.paper.description, '刑法、民法');
  assert.equal(result.paper.paper.totalScore, 5);
  assert.equal(result.paper.paper.durationMinutes, 5);
  assert.equal(result.paper.paper.hasAnswerKey, true);
  assert.deepEqual(result.paper.questions.map((item) => item.id), ['S001', 'M001', 'I001']);
  assert.deepEqual(result.paper.questions.map((item) => item.score), [1, 2, 2]);
  assert.deepEqual(result.paper.questions[0].tags, ['刑法']);
  assert.deepEqual(result.answerKey.answers.M001.answer, ['A', 'C']);
});

test('importExamFile publishes both copies and registers the paper only once', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'law-import-'));
  fs.mkdirSync(path.join(root, 'generate'));
  fs.mkdirSync(path.join(root, 'data'));
  fs.writeFileSync(path.join(root, 'generate', 'sample.txt'), sample);
  fs.writeFileSync(path.join(root, 'data', 'registry.json'), JSON.stringify({
    schemaVersion: '1.0',
    accounts: [
      { username: 'liurui', paperIds: ['existing'], enabled: true },
      { username: 'other', paperIds: ['other-paper'], enabled: true }
    ]
  }));
  fs.writeFileSync(path.join(root, 'data', 'demo.js'), 'unchanged');

  importExamFile(path.join(root, 'generate', 'sample.txt'), root);
  importExamFile(path.join(root, 'generate', 'sample.txt'), root);

  const generatedPaper = fs.readFileSync(path.join(root, 'generate', 'sample', 'paper.json'), 'utf8');
  const deployedPaper = fs.readFileSync(path.join(root, 'data', 'exams', 'sample', 'paper.json'), 'utf8');
  const registry = JSON.parse(fs.readFileSync(path.join(root, 'data', 'registry.json')));
  assert.equal(generatedPaper, deployedPaper);
  assert.equal(registry.accounts[0].paperIds.filter((id) => id === 'sample').length, 1);
  assert.deepEqual(registry.accounts[1].paperIds, ['other-paper']);
  assert.equal(fs.readFileSync(path.join(root, 'data', 'demo.js'), 'utf8'), 'unchanged');
});

test('invalid input does not modify output files or registry', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'law-import-invalid-'));
  const inputDir = path.join(root, 'generate');
  const outputDir = path.join(inputDir, 'sample');
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(path.join(root, 'data'));
  fs.writeFileSync(path.join(inputDir, 'sample.txt'), '【刑法1】题目（单选）\nA.甲\nB.乙\n解析');
  fs.writeFileSync(path.join(outputDir, 'paper.json'), 'old paper');
  fs.writeFileSync(path.join(root, 'data', 'registry.json'), JSON.stringify({ accounts: [{ username: 'liurui', paperIds: [] }] }));
  const beforeRegistry = fs.readFileSync(path.join(root, 'data', 'registry.json'), 'utf8');

  assert.throws(() => importExamFile(path.join(inputDir, 'sample.txt'), root), /缺少答案行/);
  assert.equal(fs.readFileSync(path.join(outputDir, 'paper.json'), 'utf8'), 'old paper');
  assert.equal(fs.readFileSync(path.join(root, 'data', 'registry.json'), 'utf8'), beforeRegistry);
  assert.equal(fs.existsSync(path.join(root, 'data', 'exams', 'sample')), false);
});
