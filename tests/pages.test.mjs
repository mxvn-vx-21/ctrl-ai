// Integration tests for Pages V1. Same setup as launchpad.test.mjs. Run: node --test --test-concurrency=1 tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
const BASE = process.env.BASE || 'http://localhost:8788', ORIGIN = new URL(BASE).origin, R = Math.random().toString(36).slice(2, 7);
const mails = {};
const mock = http.createServer((q, r) => { let b = ''; q.on('data', d => b += d); q.on('end', () => { const m = JSON.parse(b); mails[m.to[0]] = m.text; r.writeHead(200, { 'content-type': 'application/json' }); r.end('{"id":"x"}'); }); });
test.before(() => new Promise(r => mock.listen(9999, r)));
test.after(() => mock.close());
async function call(path, { method = 'GET', body, cookie, origin = ORIGIN } = {}) {
  const res = await fetch(BASE + path, { method, redirect: 'manual', headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...(origin && method !== 'GET' ? { origin } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text(); let d = null; try { d = JSON.parse(text); } catch {}
  return { s: res.status, d, text, res };
}
async function login(email, handle) {
  await call('/api/auth/email/request', { method: 'POST', body: { email, mode: 'signup' } });
  const r = await call('/api/auth/email/verify', { method: 'POST', body: { token: /token=([A-Za-z0-9_-]+)/.exec(mails[email])[1] } });
  const cookie = r.res.headers.getSetCookie().map(c => c.split(';')[0]).find(c => c.startsWith('bb_session='));
  if (handle) assert.equal((await call('/api/launchpad/handle', { method: 'POST', cookie, body: { name: handle } })).s, 200);
  return cookie;
}
const S = {}, A = 'pa' + R, B = 'pb' + R, XSS = '<img src=x onerror=alert(1)>';
const prof = (o = {}) => ({ display_name: 'Ada ' + R, bio: 'Builds things.', avatar_url: '', location: 'Earth', website: 'https://example.com', skills: ['Rust', 'Design'], layout: 'cards', ...o });
test('setup', async () => { S.a = await login(`pa${R}@example.com`, A); S.b = await login(`pb${R}@example.com`, B); S.n = await login(`pn${R}@example.com`); });
test('auth, origin and handle required', async () => {
  assert.equal((await call('/api/pages/me', { method: 'PUT', body: prof() })).s, 401);
  assert.equal((await call('/api/pages/me', { method: 'PUT', cookie: S.a, body: prof(), origin: 'http://evil.com' })).s, 403);
  assert.equal((await call('/api/pages/me', { method: 'PUT', cookie: S.n, body: prof() })).s, 403);
  assert.equal((await call('/api/pages/publish', { method: 'POST' })).s, 401);
});
test('validation', async () => {
  for (const bad of [prof({ layout: 'neon' }), prof({ avatar_url: 'http://x.com/a.png' }), prof({ website: 'javascript:alert(1)' }), prof({ skills: Array(11).fill('x').map((x, i) => x + i) })])
    assert.equal((await call('/api/pages/me', { method: 'PUT', cookie: S.a, body: bad })).s, 400);
  assert.equal((await call('/api/pages/links', { method: 'PUT', cookie: S.a, body: { links: [{ title: 'x', url: 'javascript:alert(1)' }] } })).s, 400);
  assert.equal((await call('/api/pages/links', { method: 'PUT', cookie: S.a, body: { links: [{ title: '', url: 'https://a.com' }] } })).s, 400);
});
test('draft is private; publish needs name+bio; edits never auto-publish', async () => {
  assert.equal((await call('/u/' + A)).s, 404);
  assert.equal((await call('/api/pages/me', { method: 'PUT', cookie: S.a, body: prof({ display_name: '', bio: '' }) })).s, 200);
  const inc = await call('/api/pages/publish', { method: 'POST', cookie: S.a }); assert.equal(inc.s, 400); assert.deepEqual(inc.d.missing, ['display_name', 'bio']);
  assert.equal((await call('/api/pages/me', { method: 'PUT', cookie: S.a, body: prof({ display_name: XSS }) })).s, 200);
  assert.equal((await call('/u/' + A)).s, 404); assert.equal((await call('/api/pages/public/' + A)).s, 404);
  assert.equal((await call('/api/pages/publish', { method: 'POST', cookie: S.a })).s, 200);
  const pg = await call('/u/' + A); assert.equal(pg.s, 200); assert.ok(!pg.text.includes(XSS)); assert.ok(pg.text.includes('&lt;img src=x')); assert.ok(pg.text.includes(`rel="canonical" href="${ORIGIN}/u/${A}"`));
  assert.equal((await call('/api/pages/unpublish', { method: 'POST', cookie: S.a })).s, 200);
  assert.equal((await call('/u/' + A)).s, 404);
  await call('/api/pages/me', { method: 'PUT', cookie: S.a, body: prof({ bio: 'Changed bio.' }) });
  assert.equal((await call('/u/' + A)).s, 404); // editing a draft did not publish it
  assert.equal((await call('/u/nobody' + R)).s, 404);
});
test('links: order, visibility, safe rendering, public API shape', async () => {
  const links = [{ title: 'Second', url: 'https://b.com', kind: 'github' }, { title: 'Hidden', url: 'https://h.com', visible: false }, { title: XSS, url: 'https://c.com/?a=1&b="2"' }];
  assert.equal((await call('/api/pages/links', { method: 'PUT', cookie: S.a, body: { links } })).s, 200);
  await call('/api/pages/publish', { method: 'POST', cookie: S.a });
  const pub = await call('/api/pages/public/' + A); assert.equal(pub.s, 200);
  assert.deepEqual(pub.d.links.map(l => l.title), ['Second', XSS]);
  assert.ok(!JSON.stringify(pub.d).includes('@example.com')); assert.ok(!('user_id' in pub.d));
  const html = (await call('/u/' + A)).text; assert.ok(!html.includes('Hidden')); assert.ok(html.indexOf('Second') < html.indexOf('&lt;img'));
  const me = await call('/api/pages/me', { cookie: S.a }); assert.equal(me.d.links.length, 3); assert.equal(me.d.links[1].visible, false);
});
test('projects: own Launchpad projects only, external, hidden, deleted original', async () => {
  const mk = async (c, t) => (await call('/api/launchpad/projects', { method: 'POST', cookie: c, body: { title: t + R, tagline: 'Tagline text', description: 'A long enough description here.', url: 'https://example.com', category: 'web', tags: [] } })).d.slug;
  const mine = await mk(S.a, 'Mine'), theirs = await mk(S.b, 'Theirs');
  const put = projects => call('/api/pages/projects', { method: 'PUT', cookie: S.a, body: { projects } });
  assert.equal((await put([{ project_slug: theirs }])).s, 403);
  assert.equal((await put([{ project_slug: mine }, { project_slug: mine }])).s, 400);
  assert.equal((await put([{ title: 'x', url: 'javascript:1' }])).s, 400);
  assert.equal((await put([{ project_slug: mine }, { title: 'External', url: 'https://ext.com', description: 'Ext desc' }, { title: 'Secret', url: 'https://s.com', visible: false }])).s, 200);
  const pub = (await call('/api/pages/public/' + A)).d; assert.deepEqual(pub.projects.map(p => p.title), ['Mine' + R, 'External']);
  assert.equal(pub.projects[0].url, '/launchpad/project/' + mine);
  assert.equal((await call('/api/launchpad/projects/' + mine, { method: 'DELETE', cookie: S.a })).s, 200);
  assert.deepEqual((await call('/api/pages/public/' + A)).d.projects.map(p => p.title), ['External']);
});
test('ownership: another user cannot change my page', async () => {
  await call('/api/pages/links', { method: 'PUT', cookie: S.b, body: { links: [{ title: 'B link', url: 'https://b.example' }] } });
  await call('/api/pages/unpublish', { method: 'POST', cookie: S.b });
  const pub = (await call('/api/pages/public/' + A)).d; assert.ok(pub.links.every(l => l.title !== 'B link'));
  assert.equal((await call('/u/' + A)).s, 200); // A is still published
  assert.equal((await call('/api/pages/me', { cookie: S.b })).d.username, B);
});
test('layouts render and profile cross-link', async () => {
  for (const layout of ['minimal', 'portfolio', 'cards']) { await call('/api/pages/me', { method: 'PUT', cookie: S.a, body: prof({ layout }) }); assert.ok((await call('/u/' + A)).text.includes('u-' + layout)); }
  assert.ok((await call('/' + A)).text.includes('/u/' + A));
  assert.equal((await call('/u/' + A.toUpperCase())).s, 301);
});
