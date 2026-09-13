const assert = require('node:assert/strict');
const test = require('node:test');
const { generateUsersSQL } = require('../scripts/generate-supabase-users');

test('generateUsersSQL converts registry accounts into idempotent Supabase SQL', () => {
  const sql = generateUsersSQL({ accounts: [{ username: "o'neil", passwordHash: 'sha-256:x', paperIds: ['p1'], enabled: true }] });
  assert.match(sql, /insert into public\.law_users/);
  assert.match(sql, /'o''neil'/);
  assert.match(sql, /ARRAY\['p1'\]::text\[\]/);
  assert.match(sql, /on conflict \(username\) do update/);
});
