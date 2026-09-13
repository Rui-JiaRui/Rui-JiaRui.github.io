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

test('login payload carries a normalized digest for databases with or without sha-256 prefix', () => {
  assert.match(source, /passwordDigest/);
  assert.match(source, /passwordHashVariants|normalizePasswordHash/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'supabase/functions/law-api/index.ts'), 'utf8'), /normalizePasswordHash/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'supabase/functions/law-api/index.ts'), 'utf8'), /password_digest/);
});

test('edge function accepts both Supabase full paths and stripped function paths', () => {
  const functionSource = fs.readFileSync(path.join(__dirname, '..', 'supabase/functions/law-api/index.ts'), 'utf8');
  assert.match(functionSource, /allSegments\.indexOf\('auth'\)/);
  assert.match(functionSource, /allSegments\.indexOf\('attempts'\)/);
  assert.match(functionSource, /const segments = routeStart >= 0 \? allSegments\.slice\(routeStart\) : \[\]/);
});

test('password matching treats raw and prefixed SHA-256 values as equivalent', () => {
  const match = source.match(/function normalizePasswordHash\(value\) \{[\s\S]*?\n\}/);
  assert.ok(match, 'normalizePasswordHash helper should be defined');
  const normalizePasswordHash = vm.runInNewContext(`(${match[0]})`);
  assert.equal(normalizePasswordHash('sha-256:ABC123'), 'abc123');
  assert.equal(normalizePasswordHash('abc123'), 'abc123');
});

test('cloud login request includes both canonical and legacy digest fields', () => {
  const loginBlock = source.match(/login\(username, passwordDigest\) \{[\s\S]*?\n  \}/)?.[0] || '';
  assert.match(loginBlock, /passwordDigest: digest/);
  assert.match(loginBlock, /password_digest: digest/);
  assert.match(loginBlock, /passwordHash: `sha-256:\$\{digest\}`/);
  assert.match(loginBlock, /passwordHashVariants/);
});

test('cloud request preserves HTTP status for accurate login error handling', async () => {
  const classMatch = source.match(/class CloudRepository \{[\s\S]*?\n\}/);
  assert.ok(classMatch, 'CloudRepository should be defined');
  const normalizeMatch = source.match(/function normalizePasswordHash\(value\) \{[\s\S]*?\n\}/);
  const CloudRepository = vm.runInNewContext(`(${classMatch[0]})`, {
    normalizePasswordHash: vm.runInNewContext(`(${normalizeMatch[0]})`),
    fetch: async () => ({ ok: false, status: 500, json: async () => ({ error: 'database-unavailable' }) })
  });
  const repository = new CloudRepository({ functionsUrl: 'https://example.test/functions/v1/law-api' });
  await assert.rejects(
    () => repository.request('/auth/login', { method: 'POST' }, 0),
    (error) => error.status === 500 && error.message === 'database-unavailable'
  );
});

test('cloud login does not silently fall back after an HTTP authentication or server error', () => {
  assert.match(source, /if \(Number\(error\?\.status \|\| 0\) > 0\)/);
  assert.match(source, /云端服务暂时不可用/);
});

test('cloud login only uses the local fallback when the browser is explicitly offline', () => {
  assert.match(source, /typeof navigator !== 'undefined' && navigator\.onLine === false/);
  assert.match(source, /无法连接云端服务/);
});

test('remote accounts must have at least one authorized paper', () => {
  assert.match(source, /Array\.isArray\(account\?\.paperIds\)/);
  assert.match(source, /account\.paperIds\.length/);
});

test('edge function reports Supabase login query errors instead of treating them as bad passwords', () => {
  const functionSource = fs.readFileSync(path.join(__dirname, '..', 'supabase/functions/law-api/index.ts'), 'utf8');
  assert.match(functionSource, /const \{ data: candidates, error \} = await supabase/);
  assert.match(functionSource, /if \(error\) \{[\s\S]*?return json\(\{ error: 'login-query-failed' \}, 500\);[\s\S]*?\}/);
});

test('edge function forces terminal status on submit and in-progress status on drafts', () => {
  const functionSource = fs.readFileSync(path.join(__dirname, '..', 'supabase/functions/law-api/index.ts'), 'utf8');
  assert.match(functionSource, /const status = submit \? \(attempt\.grading \? 'graded' : 'submitted_ungraded'\) : 'in_progress'/);
  assert.match(functionSource, /status, current_index/);
});

test('result page renders annotation controls and subjective responses', () => {
  assert.match(source, /data-annotation-question/);
  assert.match(source, /保存批注/);
  assert.match(source, /question\.type === 'subjective'/);
  assert.match(source, /参考答案/);
});
