import { json, limit } from '../../_lib/util.js';
import { guard } from '../../_lib/launchpad.js';
import { STUDIO, studioConfig, listModels, defaultModel, openStream, events, makeTitle, buildContext, ownConv, needCfg, UUID } from '../../_lib/studio.js';
const enc = new TextEncoder();
export async function onRequestPost({ request, env }) {
  const g = await guard(request, env, { needHandle: false }); if (g instanceof Response) return g;
  const cfg = studioConfig(env), nc = needCfg(cfg); if (nc) return nc;
  const b = await request.json().catch(() => null); if (!b || typeof b !== 'object') return json({ error: 'invalid' }, 400);
  const regen = b.regenerate === true;
  const text = regen ? '' : String(b.message ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\r\n?/g, '\n').trim();
  if (!regen && !text) return json({ error: 'invalid' }, 400);
  if (text.length > STUDIO.maxMsg) return json({ error: 'too_long' }, 400);
  const models = await listModels(env, cfg); if (!models.length) return json({ error: 'not_configured' }, 503);
  let conv = null, history = [];
  if (b.conversation_id !== undefined && b.conversation_id !== null) {
    if (typeof b.conversation_id !== 'string' || !UUID.test(b.conversation_id)) return json({ error: 'not_found' }, 404);
    conv = await ownConv(env, g.user.id, b.conversation_id); if (!conv) return json({ error: 'not_found' }, 404);
    history = (await env.DB.prepare('SELECT id,role,content FROM studio_messages WHERE conversation_id=? ORDER BY created_at, rowid LIMIT 500').bind(conv.id).all()).results;
    if (history.length >= STUDIO.maxMsgsPerConv) return json({ error: 'conversation_full' }, 400);
  } else if (regen) return json({ error: 'invalid' }, 400);
  const model = String(b.model || (conv && conv.model) || defaultModel(env, models) || '');
  if (!models.some(m => m.id === model)) return json({ error: 'bad_model' }, 400);
  let replaceId = null, userText = text, ctx;
  if (regen) {
    const last = history[history.length - 1];
    if (!last || last.role !== 'assistant' || history.length < 2) return json({ error: 'invalid' }, 400);
    replaceId = last.id; const prev = history.slice(0, -1), lu = prev[prev.length - 1];
    if (lu.role !== 'user') return json({ error: 'invalid' }, 400);
    ctx = buildContext(prev.slice(0, -1), lu.content);
  } else ctx = buildContext(history, text);
  if (!(await limit(env, 'ch:' + g.user.id, 30, 3600)) || !(await limit(env, 'cd:' + g.user.id, 150, 86400))) return json({ error: 'rate_limited' }, 429);
  if (!conv) { const c = await env.DB.prepare('SELECT COUNT(*) n FROM studio_conversations WHERE user_id=?').bind(g.user.id).first(); if (c.n >= STUDIO.maxConvs) return json({ error: 'limit' }, 400); }
  const up = new AbortController(), timer = setTimeout(() => up.abort(), STUDIO.timeoutMs);
  const o = await openStream(cfg, { model, messages: ctx, signal: up.signal });
  if (o.error) { clearTimeout(timer); return json({ error: o.error }, o.status); }
  const convId = conv ? conv.id : crypto.randomUUID(), isNew = !conv, t0 = Date.now();
  const stream = new ReadableStream({
    async start(ctrl) {
      const send = x => { try { ctrl.enqueue(enc.encode('data: ' + JSON.stringify(x) + '\n\n')); } catch {} };
      let full = '', stopped = false;
      try {
        send({ t: 'meta', id: convId, model });
        for await (const ev of events(cfg.provider, o.resp.body)) {
          if (ev.error) throw new Error('provider_error');
          if (ev.text) { full += ev.text; send({ t: 'd', x: ev.text }); }
          if (ev.stop) stopped = true;
        }
        if (!stopped) throw new Error('provider_error');
        if (!full.trim()) throw new Error('empty_response');
        const aid = crypto.randomUUID(), now = Date.now(), title = isNew ? makeTitle(text) : conv.title;
        const stmts = [];
        if (isNew) stmts.push(env.DB.prepare('INSERT INTO studio_conversations(id,user_id,title,model,created_at,updated_at) VALUES(?,?,?,?,?,?)').bind(convId, g.user.id, title, model, t0, now));
        if (regen) stmts.push(env.DB.prepare('DELETE FROM studio_messages WHERE id=? AND conversation_id=?').bind(replaceId, convId));
        else stmts.push(env.DB.prepare('INSERT INTO studio_messages(id,conversation_id,role,content,model,created_at) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(), convId, 'user', userText, null, t0));
        stmts.push(env.DB.prepare('INSERT INTO studio_messages(id,conversation_id,role,content,model,created_at) VALUES(?,?,?,?,?,?)').bind(aid, convId, 'assistant', full, model, now));
        stmts.push(env.DB.prepare('UPDATE studio_conversations SET updated_at=?,model=? WHERE id=? AND user_id=?').bind(now, model, convId, g.user.id));
        await env.DB.batch(stmts);
        send({ t: 'done', id: convId, message_id: aid, title });
      } catch (e) {
        console.error('studio_stream', e && e.message);
        send({ t: 'err', error: up.signal.aborted ? 'timeout' : (e && e.message === 'empty_response' ? 'empty_response' : 'provider_error') });
      } finally { clearTimeout(timer); try { ctrl.close(); } catch {} }
    },
    cancel() { up.abort(); clearTimeout(timer); },
  });
  return new Response(stream, { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' } });
}
