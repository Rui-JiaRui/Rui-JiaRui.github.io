const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

test('index loads local assets with one page version and keeps demo before app', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

  assert.doesNotMatch(html, /<link[^>]+href="styles\.css"/);
  assert.doesNotMatch(html, /<script[^>]+src="(?:data\/demo|app)\.js"/);
  assert.match(html, /window\.__LAW_ASSET_VERSION__\s*=\s*version/);
  assert.match(html, /Date\.now\(\)/);
  assert.match(html, /withVersion\('styles\.css'\)/);
  assert.match(html, /withVersion\('data\/demo\.js'\)/);
  assert.match(html, /withVersion\('app\.js'\)/);
  assert.match(html, /demoScript\.onload\s*=\s*loadApp/);
  assert.match(html, /资源加载失败，请刷新页面重试/);
});

test('index merges deployment Supabase overrides with the linked-project defaults', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

  assert.match(html, /const defaultSupabaseConfig/);
  assert.match(html, /url:\s*'https:\/\/nuyrjibjpzdcblnlteqx\.supabase\.co'/);
  assert.match(html, /functionsUrl:\s*''/);
  assert.match(html, /window\.__LAW_SUPABASE__ = \{\s*\.\.\.defaultSupabaseConfig/);
  assert.match(html, /\.\.\.\(window\.__LAW_SUPABASE__\s*\|\|\s*\{\}\)/);
});

test('versionedURL appends the current page version', () => {
  const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const match = source.match(/function versionedURL\(resourcePath\) \{[\s\S]*?\n\}/);
  assert.ok(match, 'versionedURL should be defined');
  const versionedURL = vm.runInNewContext(`(${match[0]})`, {
    globalThis: { __LAW_ASSET_VERSION__: 'build 7' }
  });

  assert.equal(versionedURL('data/registry.json'), 'data/registry.json?v=build%207');
  assert.equal(versionedURL('data/file.json?x=1'), 'data/file.json?x=1&v=build%207');
});

test('registry, papers and answer keys use fresh versioned requests', () => {
  const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

  assert.match(source, /function freshFetch\(resourcePath\) \{[\s\S]*?fetch\(versionedURL\(resourcePath\), \{ cache: 'no-store' \}\)/);
  assert.match(source, /freshFetch\(`data\/exams\/\$\{encodeURIComponent\(paperId\)\}\/paper\.json`\)/);
  assert.match(source, /freshFetch\(`data\/exams\/\$\{encodeURIComponent\(state\.attempt\.paperId\)\}\/answer-key\.json`\)/);
  assert.match(source, /freshFetch\('data\/registry\.json'\)/);
});
