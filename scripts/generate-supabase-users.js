#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

function sqlString(value) {
  return `'${String(value ?? '').replace(/'/g, "''")}'`;
}

function generateUsersSQL(registry) {
  const rows = (registry.accounts || []).map((account) => {
    const paperIds = (account.paperIds || []).map(sqlString).join(', ');
    return `(${sqlString(account.username)}, ${sqlString(account.passwordHash)}, ARRAY[${paperIds}]::text[], ${account.enabled !== false})`;
  });
  if (!rows.length) return '-- No accounts found in registry.\n';
  return [
    '-- Generated from data/registry.json. Review before running in Supabase.',
    'insert into public.law_users (username, password_hash, paper_ids, enabled)',
    `values\n  ${rows.join(',\n  ')}\non conflict (username) do update set password_hash = excluded.password_hash, paper_ids = excluded.paper_ids, enabled = excluded.enabled;`,
    ''
  ].join('\n');
}

if (require.main === module) {
  const registryPath = process.argv[2] || path.resolve(__dirname, '..', 'data', 'registry.json');
  const outputPath = process.argv[3];
  const sql = generateUsersSQL(JSON.parse(fs.readFileSync(registryPath, 'utf8')));
  if (outputPath) fs.writeFileSync(outputPath, sql);
  else process.stdout.write(sql);
}

module.exports = { generateUsersSQL };
