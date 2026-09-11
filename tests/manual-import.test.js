const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const readJSON = (relativePath) => JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));

function loadSummaryHelper() {
  const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const match = source.match(/function summarizePaper\(data = \{\}\) \{[\s\S]*?\n\}/);
  assert.ok(match, 'summarizePaper helper should be defined in app.js');
  return vm.runInNewContext(`(${match[0]})`);
}

test('deployed and direct-file credentials use liurui and the K180 SHA-256 hash', () => {
  const expectedHash = `sha-256:${crypto.createHash('sha256').update('K180').digest('hex')}`;
  const registry = readJSON('data/registry.json');
  const account = registry.accounts.find((item) => item.username === 'liurui');
  const demoSource = fs.readFileSync(path.join(root, 'data/demo.js'), 'utf8');

  assert.equal(account?.passwordHash, expectedHash);
  assert.match(demoSource, /username:\s*'liurui'/);
  assert.match(demoSource, new RegExp(expectedHash));
});

test('manual import templates exist and are valid JSON', () => {
  assert.doesNotThrow(() => readJSON('data/templates/paper-template.json'));
  assert.doesNotThrow(() => readJSON('data/templates/answer-key-template.json'));
});

test('summarizePaper returns supported question-type counts', () => {
  const summarizePaper = loadSummaryHelper();
  const summary = summarizePaper({
    questions: [
      { type: 'single' },
      { type: 'single' },
      { type: 'multiple' },
      { type: 'indefinite' }
    ]
  });

  assert.deepEqual(JSON.parse(JSON.stringify(summary)), { single: 2, multiple: 1, indefinite: 1 });
});

test('sample papers explicitly declare their answer-key availability', () => {
  assert.equal(readJSON('data/exams/fa-2026-01/paper.json').paper.hasAnswerKey, true);
  assert.equal(readJSON('data/exams/fa-2026-02/paper.json').paper.hasAnswerKey, false);
});
