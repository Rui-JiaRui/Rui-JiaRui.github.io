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

function loadHelper(name, signature, context = {}) {
  const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const match = source.match(new RegExp(`function ${name}\\(${signature}\\) \\{[\\s\\S]*?\\n\\}`));
  assert.ok(match, `${name} helper should be defined in app.js`);
  return vm.runInNewContext(`(${match[0]})`, context);
}

test('deployed and direct-file credentials use liurui and the K180 SHA-256 hash', () => {
  const expectedHash = `sha-256:${crypto.createHash('sha256').update('K180').digest('hex')}`;
  const registry = readJSON('data/registry.json');
  const account = registry.accounts.find((item) => item.username === 'liurui');
  const demoSource = fs.readFileSync(path.join(root, 'data/demo.js'), 'utf8');

  assert.equal(account?.passwordHash, expectedHash);
  assert.match(demoSource, /"username":\s*"liurui"/);
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

test('demo fallback is generated from exam packages', () => {
  assert.match(fs.readFileSync(path.join(root, 'scripts/generate-demo.js'), 'utf8'), /path\.join\(dataDir, 'exams'\)/);
  const generated = fs.readFileSync(path.join(root, 'data/demo.js'), 'utf8');
  const context = { window: {} };
  vm.runInNewContext(generated, context);
  const paper = readJSON('data/exams/fa-2026-01/paper.json');
  assert.deepEqual(JSON.parse(JSON.stringify(context.window.__LAW_DEMO__.papers['fa-2026-01'])), paper);
  assert.equal(context.window.__LAW_DEMO__.answerKeys['fa-2026-01'].paperId, 'fa-2026-01');
});

test('long text surfaces preserve explicit newlines', () => {
  const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  assert.match(styles, /\.option-text, \.result-stem, \.analysis\s*\{[^}]*white-space:\s*pre-wrap/);
});

test('new attempts reset answers, marks, position and timer while preserving paper version', () => {
  const createAttempt = loadHelper('createAttempt', 'paperId, paper, username, now = Date\\.now\\(\\)', { uid: () => 'attempt-1' });
  const attempt = createAttempt('fa-2026-01', { schemaVersion: '2.0', paper: { durationMinutes: 30 } }, 'liurui', 123456);
  assert.equal(attempt.paperId, 'fa-2026-01');
  assert.equal(attempt.paperVersion, '2.0');
  assert.equal(attempt.username, 'liurui');
  assert.equal(attempt.startedAt, 123456);
  assert.equal(attempt.expiresAt, 123456 + 30 * 60 * 1000);
  assert.equal(attempt.currentIndex, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(attempt.answers)), {});
  assert.deepEqual(JSON.parse(JSON.stringify(attempt.marked)), []);
  assert.equal(attempt.status, 'in_progress');
  assert.ok(attempt.id);
});

test('paper cards expose continue, recent-result and retake actions from history', () => {
  const paperCard = loadHelper('paperCard', 'id, data, index, attempts = \\[\\]', {
    escapeHTML: (value = '') => String(value),
    summarizePaper: (data = {}) => (data.questions || []).reduce((summary, question) => {
      if (Object.hasOwn(summary, question.type)) summary[question.type] += 1;
      return summary;
    }, { single: 0, multiple: 0, indefinite: 0 }),
    attemptStatusLabel: (attempt) => ({
      in_progress: ['is-progress', '进行中'],
      graded: ['is-graded', '已批改'],
      submitted_ungraded: ['is-pending', '待批改'],
      abandoned: ['is-abandoned', '已放弃']
    }[attempt.status] || ['is-pending', attempt.status])
  });
  const html = paperCard('fa-2026-01', {
    paper: { id: 'fa-2026-01', title: '模拟卷', description: 'desc', durationMinutes: 30, totalScore: 5, hasAnswerKey: true },
    questions: []
  }, 0, [
    { id: 'open', status: 'in_progress', startedAt: 20, expiresAt: 9999999999999 },
    { id: 'done', status: 'graded', startedAt: 10, grading: { score: 4, total: 5 } }
  ]);
  assert.match(html, /data-action="continue"/);
  assert.match(html, /data-action="recent"/);
  assert.match(html, /data-action="retake"/);
  assert.match(html, /查看最近结果/);
  assert.match(html, /重新考试/);
});

test('select page groups papers by attempt status', () => {
  const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const categoryMatch = source.match(/function paperCategory\(attempts = \[\]\) \{[\s\S]*?\n\}/);
  assert.ok(categoryMatch, 'paperCategory helper should be defined');
  const paperCategory = vm.runInNewContext(`(${categoryMatch[0]})`);
  assert.equal(paperCategory([]), 'not_started');
  assert.equal(paperCategory([{ status: 'abandoned' }]), 'not_started');
  assert.equal(paperCategory([{ status: 'in_progress' }]), 'in_progress');
  assert.equal(paperCategory([{ status: 'graded' }]), 'completed');
  assert.equal(paperCategory([{ status: 'submitted_ungraded' }]), 'completed');
  assert.equal(paperCategory([{ status: 'in_progress' }, { status: 'graded' }]), 'in_progress');
});

test('select sections paginate independently with six papers per page', () => {
  const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const paginationMatch = source.match(/function paginateItems\(items, page = 0, pageSize = 6\) \{[\s\S]*?\n\}/);
  assert.ok(paginationMatch, 'paginateItems helper should be defined');
  const paginateItems = vm.runInNewContext(`(${paginationMatch[0]})`);
  const items = Array.from({ length: 13 }, (_, index) => index);
  assert.deepEqual(JSON.parse(JSON.stringify(paginateItems(items))), { page: 0, pageCount: 3, items: [0, 1, 2, 3, 4, 5] });
  assert.deepEqual(JSON.parse(JSON.stringify(paginateItems(items, 2))), { page: 2, pageCount: 3, items: [12] });
  assert.equal(paginateItems(items, 99).page, 2);
  assert.equal(paginateItems(items, -1).page, 0);
});

test('select page uses status sections and light paper action buttons', () => {
  const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  assert.match(appSource, /未完成/);
  assert.match(appSource, /正在进行/);
  assert.match(appSource, /已完成/);
  assert.match(styles, /\.paper-action-primary\s*\{[^}]*background:\s*#d9efeb/);
  assert.match(styles, /\.paper-pagination\s*\{/);
});

test('result action buttons wrap as whole buttons without stacking their text', () => {
  const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  assert.match(styles, /\.result-actions\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(styles, /\.result-actions \.button\s*\{[^}]*flex:\s*0 0 auto[^}]*width:\s*auto[^}]*white-space:\s*nowrap/);
  const mobileRule = styles.match(/@media \(max-width: 560px\) \{[\s\S]*\n\}/)?.[0] || '';
  assert.doesNotMatch(mobileRule, /\.result-actions\s*\{[^}]*flex-direction:\s*column/);
});

test('result questions render every option for answer review', () => {
  const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const match = source.match(/function resultQuestion\(question, attempt, graded, detail, index\) \{[\s\S]*?\n\}/);
  assert.ok(match, 'resultQuestion helper should be defined');
  assert.match(match[0], /question\.options\.map/);
  assert.match(match[0], /option\.text/);
});
