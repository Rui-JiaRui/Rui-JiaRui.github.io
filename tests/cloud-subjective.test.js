const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function loadFunction(name, signature, context = {}) {
  const match = source.match(new RegExp(`function ${name}\\(${signature}\\) \\{[\\s\\S]*?\\n\\}`));
  assert.ok(match, `${name} helper should be defined`);
  return vm.runInNewContext(`(${match[0]})`, context);
}

test('subjective questions are labelled and accept trimmed text answers', () => {
  const typeLabel = loadFunction('typeLabel', 'type');
  const answerProvided = loadFunction('answerProvided', 'question, answer');
  assert.equal(typeLabel('subjective'), '主观题');
  assert.equal(answerProvided({ type: 'subjective' }, '  论述内容  '), true);
  assert.equal(answerProvided({ type: 'subjective' }, '   '), false);
  assert.equal(answerProvided({ type: 'single' }, ['A']), true);
  assert.equal(answerProvided({ type: 'single' }, []), false);
});

test('objective grading excludes subjective questions from score totals', () => {
  const gradeAttempt = loadFunction('gradeAttempt', 'paper, answerKey, answers');
  const result = gradeAttempt({
    paper: { totalScore: 3 },
    questions: [
      { id: 'S1', type: 'single', score: 1 },
      { id: 'E1', type: 'subjective', score: 2 }
    ]
  }, {
    version: '2',
    answers: {
      S1: { answer: ['A'], analysis: 'ok' },
      E1: { referenceAnswer: '参考', analysis: '说明' }
    }
  }, { S1: ['A'], E1: '我的论述' });
  assert.equal(result.score, 1);
  assert.equal(result.total, 1);
  assert.equal(result.details.S1.isCorrect, true);
  assert.equal(result.details.E1.isSubjective, true);
  assert.equal(result.details.E1.response, '我的论述');
  assert.equal(result.details.E1.referenceAnswer, '参考');
});

test('cloud repository exposes authenticated attempt and annotation requests', () => {
  assert.match(source, /class CloudRepository/);
  assert.match(source, /\/auth\/login/);
  assert.match(source, /\/attempts/);
  assert.match(source, /\/annotations/);
  assert.match(source, /updatedAt/);
});

test('result page renders annotation controls and subjective responses', () => {
  assert.match(source, /data-annotation-question/);
  assert.match(source, /保存批注/);
  assert.match(source, /question\.type === 'subjective'/);
  assert.match(source, /参考答案/);
});
