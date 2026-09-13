import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS'
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const encoder = new TextEncoder();

function base64url(value: Uint8Array | string) {
  const bytes = typeof value === 'string' ? encoder.encode(value) : value;
  let binary = ''; bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeBase64(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  return atob(normalized + '='.repeat((4 - normalized.length % 4) % 4));
}

function normalizePasswordHash(value: unknown) {
  return String(value ?? '').trim().replace(/^sha-?256:/i, '').toLowerCase();
}

async function signToken(username: string) {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ sub: username, username, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 12 }));
  const key = await crypto.subtle.importKey('raw', encoder.encode(Deno.env.get('LAW_JWT_SECRET')!), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(`${header}.${payload}`));
  return `${header}.${payload}.${base64url(new Uint8Array(signature))}`;
}

async function userFromRequest(request: Request) {
  const raw = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!raw) return null;
  try {
    const [, payload, signature] = raw.split('.');
    const key = await crypto.subtle.importKey('raw', encoder.encode(Deno.env.get('LAW_JWT_SECRET')!), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const valid = await crypto.subtle.verify('HMAC', key, Uint8Array.from([...decodeBase64(signature)].map((c) => c.charCodeAt(0))), encoder.encode(raw.split('.').slice(0, 2).join('.')));
    const claims = JSON.parse(decodeBase64(payload));
    return valid && claims.exp > Date.now() / 1000 ? claims.username : null;
  } catch { return null; }
}

async function body(request: Request) { return await request.json().catch(() => ({})); }

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const url = new URL(request.url);
  const allSegments = url.pathname.split('/').filter(Boolean);
  const routeStart = Math.max(allSegments.indexOf('auth'), allSegments.indexOf('attempts'));
  const segments = routeStart >= 0 ? allSegments.slice(routeStart) : [];
  if (segments[0] === 'auth' && segments[1] === 'login' && request.method === 'POST') {
    const { username, passwordDigest, passwordHash, password_digest } = await body(request);
    const digest = normalizePasswordHash(passwordDigest || password_digest || passwordHash);
    const { data: candidates, error } = await supabase.from('law_users').select('username,password_hash,paper_ids,enabled').eq('username', username).limit(1);
    if (error) {
      console.error('law_users login query failed', error);
      return json({ error: 'login-query-failed' }, 500);
    }
    const account = candidates?.find((item) => normalizePasswordHash(item.password_hash) === digest);
    if (!account?.enabled) return json({ error: 'invalid-credentials' }, 401);
    return json({ token: await signToken(account.username), user: { username: account.username, paperIds: account.paper_ids } });
  }
  const username = await userFromRequest(request);
  if (!username) return json({ error: 'unauthorized' }, 401);
  if (segments[0] === 'attempts' && !segments[1]) {
    const paperId = url.searchParams.get('paperId');
    const query = supabase.from('law_attempts').select('*').eq('username', username).order('started_at', { ascending: false });
    const { data, error } = paperId ? await query.eq('paper_id', paperId) : await query;
    return error ? json({ error: error.message }, 500) : json({ attempts: (data || []).map(toAttempt) });
  }
  if (segments[0] === 'attempts' && segments[1]) {
    const attemptId = segments[1];
    if (segments[2] === 'annotations') {
      const { data: ownedAttempt } = await supabase.from('law_attempts').select('id').eq('id', attemptId).eq('username', username).maybeSingle();
      if (!ownedAttempt) return json({ error: 'not-found' }, 404);
      if (request.method === 'GET') {
        const { data, error } = await supabase.from('law_annotations').select('*').eq('attempt_id', attemptId).eq('username', username);
        return error ? json({ error: error.message }, 500) : json({ annotations: data || [] });
      }
      if (request.method === 'PUT' && segments[3]) {
        const { content = '' } = await body(request);
        const { error } = await supabase.from('law_annotations').upsert({ attempt_id: attemptId, username, question_id: segments[3], content: String(content), updated_at: Date.now() });
        return error ? json({ error: error.message }, 500) : json({ ok: true });
      }
    }
    if (segments[2] === 'submit' && request.method === 'POST') return saveAttempt(request, username, attemptId, true);
    if (request.method === 'GET') {
      const { data, error } = await supabase.from('law_attempts').select('*').eq('id', attemptId).eq('username', username).maybeSingle();
      return error ? json({ error: error.message }, 500) : data ? json({ attempt: toAttempt(data) }) : json({ error: 'not-found' }, 404);
    }
    if (request.method === 'PUT') return saveAttempt(request, username, attemptId, false);
  }
  return json({ error: 'not-found' }, 404);
});

function toAttempt(row: any) {
  return { id: row.id, username: row.username, paperId: row.paper_id, paperVersion: row.paper_version, startedAt: row.started_at, expiresAt: row.expires_at, submittedAt: row.submitted_at, status: row.status, currentIndex: row.current_index, answers: row.answers || {}, marked: row.marked || [], grading: row.grading, annotations: row.annotations || {}, updatedAt: row.updated_at };
}

async function saveAttempt(request: Request, username: string, id: string, submit: boolean) {
  const payload = await body(request); const attempt = payload.attempt || {};
  const { data: account } = await supabase.from('law_users').select('paper_ids,enabled').eq('username', username).maybeSingle();
  if (!account?.enabled || !Array.isArray(account.paper_ids) || account.paper_ids.length === 0 || !account.paper_ids.includes(attempt.paperId)) return json({ error: 'paper-forbidden' }, 403);
  const { data: existing } = await supabase.from('law_attempts').select('*').eq('id', id).eq('username', username).maybeSingle();
  if (existing && existing.status !== 'in_progress' && !submit) return json({ error: 'attempt-locked' }, 409);
  if (existing && existing.status !== 'in_progress' && submit) return json({ attempt: toAttempt(existing) });
  const status = submit ? (attempt.grading ? 'graded' : 'submitted_ungraded') : 'in_progress';
  const row = { id, username, paper_id: attempt.paperId, paper_version: attempt.paperVersion || '1.0', started_at: attempt.startedAt, expires_at: attempt.expiresAt, submitted_at: submit ? (attempt.submittedAt || Date.now()) : attempt.submittedAt, status, current_index: attempt.currentIndex || 0, answers: attempt.answers || {}, marked: attempt.marked || [], grading: attempt.grading || null, annotations: attempt.annotations || {}, updated_at: Date.now() };
  const { data, error } = await supabase.from('law_attempts').upsert(row).select().single();
  return error ? json({ error: error.message }, 500) : json({ attempt: toAttempt(data) });
}
