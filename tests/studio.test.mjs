// Integration tests for AI Studio V1 using a MOCK Anthropic-style provider (no real credentials needed).
// Dev server env: ANTHROPIC_API_KEY=test-key ANTHROPIC_BASE_URL=http://127.0.0.1:9998 STUDIO_MODELS="test-model|Test Model,test-model-2|Test Two"
// plus the usual RESEND_API_URL=http://127.0.0.1:9999/emails. Optional: NOCFG_BASE=http://localhost:8789 (a dev server WITHOUT provider settings).
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
const BASE = process.env.BASE || 'http://localhost:8788', ORIGIN = new URL(BASE).origin, R = Math.random().toString(36).slice(2, 7);
const mails = {}; let lastReq = null, providerCalls = 0;
const resend = http.createServer((q, r) => { let b = ''; q.on('data', d => b += d); q.on('end', () => { const m = JSON.parse(b); mails[m.to[0]] = m.text; r.writeHead(200, { 'content-type': 'application/json' }); r.end('{"id":"x"}'); }); });
const sse = (res, ev, d) => res.write(`event: ${ev}\ndata: ${JSON.stringify(d)}\n\n`);
const delta = (res, t) => sse(res, 'content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } });
const provider = http.createServer((q, res) => { let b = ''; q.on('data', d => b += d); q.on('end', async () => {
  providerCalls++; const j = JSON.parse(b); lastReq = { headers: q.headers, body: j };
  const last = j.messages[j.messages.length - 1].content;
  if (q.headers['x-api-key'] !== 'test-key') { res.writeHead(401); return res.end('{"error":"bad key"}'); }
  if (last.includes('FAIL401')) { res.writeHead(401); return res.end('{"secret":"provider-body"}'); }
  if (last.includes('RATELIMIT')) { res.writeHead(429); return res.end('{}'); }
  if (last.includes('BADMODEL404')) { res.writeHead(404); return res.end('{}'); }
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  if (last.includes('MIDERR')) { delta(res, 'partial '); sse(res, 'error', { type: 'error', error: { type: 'overloaded_error' } }); return res.end(); }
  if (last.includes('NOSTOP')) { delta(res, 'cut off'); return res.end(); }
  if (last.includes('SLOWSTREAM')) { for (let i = 0; i < 25 && !res.destroyed; i++) { delta(res, 'tick '); await new Promise(r => setTimeout(r, 200)); } sse(res, 'message_stop', { type: 'message_stop' }); return res.end(); }
  delta(res, 'Hello '); delta(res, 'from mock: '); delta(res, last.slice(0, 40)); sse(res, 'message_stop', { type: 'message_stop' }); res.end();
}); });
test.before(async () => { await new Promise(r => resend.listen(9999, r)); await new Promise(r => provider.listen(9998, r)); });
test.after(() => { resend.close(); provider.close(); });
async function call(path, { method = 'GET', body, cookie, origin = ORIGIN, base = BASE, raw } = {}) {
  const res = await fetch(base + path, { method, headers: { ...(body !== undefined || raw ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...(origin && method !== 'GET' ? { origin } : {}) }, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) });
  const text = await res.text(); let d = null; try { d = JSON.parse(text); } catch {}
  return { s: res.status, d, text, res };
}
async function login(email) {
  await call('/api/auth/email/request', { method: 'POST', body: { email, mode: 'signup' } });
  const r = await call('/api/auth/email/verify', { method: 'POST', body: { token: /token=([A-Za-z0-9_-]+)/.exec(mails[email])[1] } });
  return r.res.headers.getSetCookie().map(c => c.split(';')[0]).find(c => c.startsWith('bb_session='));
}
const events = text => text.split('\n\n').filter(b => b.startsWith('data:')).map(b => JSON.parse(b.slice(5)));
const chat = async (cookie, body) => { const r = await call('/api/studio/chat', { method: 'POST', cookie, body }); return { ...r, ev: r.res.headers.get('content-type')?.includes('event-stream') ? events(r.text) : [] }; };
const S = {};
test('setup', async () => { S.a = await login(`sa${R}@example.com`); S.b = await login(`sb${R}@example.com`); S.r = await login(`sr${R}@example.com`); });
test('every private endpoint requires auth and same origin', async () => {
  for (const [p, m] of [['/api/studio/models', 'GET'], ['/api/studio/conversations', 'GET'], ['/api/studio/conversations', 'POST'], ['/api/studio/chat', 'POST'], ['/api/studio/conversations/' + crypto.randomUUID(), 'GET']])
    assert.equal((await call(p, { method: m, body: m === 'POST' ? {} : undefined })).s, 401, p);
  assert.equal((await call('/api/studio/chat', { method: 'POST', cookie: S.a, body: { message: 'hi' }, origin: 'http://evil.com' })).s, 403);
});
test('models come from server config and never leak the key', async () => {
  const m = await call('/api/studio/models', { cookie: S.a });
  assert.equal(m.s, 200); assert.equal(m.d.configured, true); assert.deepEqual(m.d.models.map(x => x.id), ['test-model', 'test-model-2']); assert.equal(m.d.default, 'test-model');
  assert.ok(!m.text.includes('test-key'));
});
test('chat streams, persists, titles, sends history to provider', async () => {
  const r = await chat(S.a, { message: 'Explain closures in JavaScript please' });
  assert.equal(r.s, 200); const done = r.ev.find(e => e.t === 'done'), meta = r.ev.find(e => e.t === 'meta');
  assert.ok(meta.id && done.message_id); assert.equal(done.title, 'Explain closures in JavaScript please');
  assert.equal(r.ev.filter(e => e.t === 'd').map(e => e.x).join('').startsWith('Hello from mock: Explain closures'), true);
  assert.equal(lastReq.headers['x-api-key'], 'test-key'); assert.equal(lastReq.body.model, 'test-model'); assert.ok(lastReq.body.system.length > 10); assert.ok(lastReq.body.max_tokens <= 4096); assert.equal(lastReq.body.stream, true);
  S.id = meta.id;
  const r2 = await chat(S.a, { conversation_id: S.id, message: 'And arrow functions?', model: 'test-model-2' });
  assert.ok(r2.ev.some(e => e.t === 'done')); assert.deepEqual(lastReq.body.messages.map(m => m.role), ['user', 'assistant', 'user']); assert.equal(lastReq.body.model, 'test-model-2');
  const c = await call('/api/studio/conversations/' + S.id, { cookie: S.a });
  assert.deepEqual(c.d.messages.map(m => m.role), ['user', 'assistant', 'user', 'assistant']); assert.equal(c.d.conversation.model, 'test-model-2');
  assert.equal(c.d.messages[0].content, 'Explain closures in JavaScript please');
});
test('ownership isolation', async () => {
  const id = S.id;
  assert.equal((await call('/api/studio/conversations/' + id, { cookie: S.b })).s, 404);
  assert.equal((await call('/api/studio/conversations/' + id, { method: 'PATCH', cookie: S.b, body: { title: 'hacked' } })).s, 404);
  assert.equal((await call('/api/studio/conversations/' + id, { method: 'DELETE', cookie: S.b })).s, 404);
  const before = providerCalls; assert.equal((await chat(S.b, { conversation_id: id, message: 'sneaky' })).s, 404); assert.equal(providerCalls, before);
  assert.ok(!(await call('/api/studio/conversations', { cookie: S.b })).d.conversations.some(c => c.id === id));
  assert.ok((await call('/api/studio/conversations', { cookie: S.a })).d.conversations.some(c => c.id === id));
  assert.equal((await call('/api/studio/conversations/not-a-uuid', { cookie: S.a })).s, 404);
});
test('input validation', async () => {
  const before = providerCalls;
  assert.equal((await chat(S.a, { message: '   ' })).s, 400);
  assert.equal((await chat(S.a, { message: 'x'.repeat(8001) })).d.error, 'too_long');
  assert.equal((await chat(S.a, { message: 'hi', model: 'gpt-evil' })).d.error, 'bad_model');
  assert.equal((await chat(S.a, { message: 'hi', conversation_id: 5 })).s, 404);
  assert.equal((await call('/api/studio/chat', { method: 'POST', cookie: S.a, raw: '{not json' })).s, 400);
  assert.equal((await chat(S.a, { regenerate: true })).s, 400);
  assert.equal(providerCalls, before); // nothing invalid reached the provider
});
test('provider failures are honest and persist nothing', async () => {
  const n = async () => (await call('/api/studio/conversations', { cookie: S.a })).d.conversations.length, base = await n();
  const f1 = await chat(S.a, { message: 'FAIL401 please' }); assert.equal(f1.s, 502); assert.equal(f1.d.error, 'provider_auth'); assert.ok(!f1.text.includes('provider-body'));
  assert.equal((await chat(S.a, { message: 'RATELIMIT' })).d.error, 'provider_rate_limited');
  assert.equal((await chat(S.a, { message: 'BADMODEL404' })).d.error, 'provider_rejected');
  const mid = await chat(S.a, { message: 'MIDERR' }); assert.ok(mid.ev.some(e => e.t === 'err' && e.error === 'provider_error')); assert.ok(!mid.ev.some(e => e.t === 'done'));
  const ns = await chat(S.a, { conversation_id: S.id, message: 'NOSTOP' }); assert.ok(ns.ev.some(e => e.t === 'err'));
  assert.equal(await n(), base);
  assert.equal((await call('/api/studio/conversations/' + S.id, { cookie: S.a })).d.messages.length, 4); // existing conversation untouched
});
test('client abort persists nothing', async () => {
  const ac = new AbortController(), base = (await call('/api/studio/conversations', { cookie: S.a })).d.conversations.length;
  const res = await fetch(BASE + '/api/studio/chat', { method: 'POST', signal: ac.signal, headers: { 'content-type': 'application/json', cookie: S.a, origin: ORIGIN }, body: JSON.stringify({ message: 'SLOWSTREAM' }) });
  const rd = res.body.getReader(); await rd.read(); ac.abort(); await new Promise(r => setTimeout(r, 1500));
  assert.equal((await call('/api/studio/conversations', { cookie: S.a })).d.conversations.length, base);
});
test('regenerate replaces only the last answer', async () => {
  const before = (await call('/api/studio/conversations/' + S.id, { cookie: S.a })).d.messages, oldId = before[3].id;
  const r = await chat(S.a, { conversation_id: S.id, regenerate: true }); assert.ok(r.ev.some(e => e.t === 'done'));
  const after = (await call('/api/studio/conversations/' + S.id, { cookie: S.a })).d.messages;
  assert.equal(after.length, 4); assert.notEqual(after[3].id, oldId); assert.equal(after[3].role, 'assistant'); assert.deepEqual(after.slice(0, 3).map(m => m.id), before.slice(0, 3).map(m => m.id));
  assert.deepEqual(lastReq.body.messages.map(m => m.role), ['user', 'assistant', 'user']);
});
test('rename, model change, search scoping', async () => {
  const u = '/api/studio/conversations/' + S.id;
  assert.equal((await call(u, { method: 'PATCH', cookie: S.a, body: { title: 'Closures ' + R } })).s, 200);
  assert.equal((await call(u, { method: 'PATCH', cookie: S.a, body: { model: 'nope' } })).d.error, 'bad_model');
  assert.equal((await call(u, { method: 'PATCH', cookie: S.a, body: { title: '' } })).s, 400);
  assert.ok((await call('/api/studio/conversations?q=' + R, { cookie: S.a })).d.conversations.some(c => c.id === S.id));
  assert.ok((await call('/api/studio/conversations?q=arrow%20functions', { cookie: S.a })).d.conversations.some(c => c.id === S.id)); // matches message content
  assert.equal((await call('/api/studio/conversations?q=' + R, { cookie: S.b })).d.conversations.length, 0);
  assert.equal((await call('/api/studio/conversations?q=%25', { cookie: S.a })).d.conversations.length, 0);
  assert.equal((await call('/api/studio/conversations', { method: 'POST', cookie: S.a, body: { model: 'bad' } })).s, 400);
  const c = await call('/api/studio/conversations', { method: 'POST', cookie: S.a, body: {} }); assert.equal(c.s, 201); assert.equal((await call('/api/studio/conversations/' + c.d.id, { cookie: S.a })).d.messages.length, 0);
});
test('delete removes the conversation and its messages', async () => {
  assert.equal((await call('/api/studio/conversations/' + S.id, { method: 'DELETE', cookie: S.a })).s, 200);
  assert.equal((await call('/api/studio/conversations/' + S.id, { cookie: S.a })).s, 404);
  assert.equal((await chat(S.a, { conversation_id: S.id, message: 'x' })).s, 404);
});
test('rate limit is enforced', async () => {
  let last; for (let i = 0; i < 31; i++) last = await chat(S.r, { message: 'hi ' + i });
  assert.equal(last.s, 429); assert.equal(last.d.error, 'rate_limited');
});
test('not configured (needs NOCFG_BASE)', { skip: !process.env.NOCFG_BASE }, async () => {
  const b = process.env.NOCFG_BASE, c = await login2(b);
  const m = await call('/api/studio/models', { cookie: c, base: b }); assert.equal(m.d.configured, false); assert.deepEqual(m.d.models, []);
  const r = await call('/api/studio/chat', { method: 'POST', cookie: c, base: b, origin: new URL(b).origin, body: { message: 'hi' } }); assert.equal(r.s, 503); assert.equal(r.d.error, 'not_configured');
});
async function login2(b) { const e = `nc${R}@example.com`, o = new URL(b).origin; await call('/api/auth/email/request', { method: 'POST', base: b, origin: o, body: { email: e, mode: 'signup' } }); const r = await call('/api/auth/email/verify', { method: 'POST', base: b, origin: o, body: { token: /token=([A-Za-z0-9_-]+)/.exec(mails[e])[1] } }); return r.res.headers.getSetCookie().map(c => c.split(';')[0]).find(c => c.startsWith('bb_session=')); }
