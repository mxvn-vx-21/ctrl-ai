import { json, limit } from '../../_lib/util.js';
import { guard, likeEsc } from '../../_lib/launchpad.js';
import { STUDIO, studioConfig, listModels } from '../../_lib/studio.js';
export async function onRequestGet({ request, env }) {
  const g = await guard(request, env, { write: false, needHandle: false }); if (g instanceof Response) return g;
  const term = (new URL(request.url).searchParams.get('q') || '').trim().slice(0, 60).toLowerCase();
  const args = [g.user.id]; let where = 'c.user_id=?';
  if (term) { const l = `%${likeEsc(term)}%`; where += " AND (lower(c.title) LIKE ? ESCAPE '\\' OR EXISTS(SELECT 1 FROM studio_messages m WHERE m.conversation_id=c.id AND lower(m.content) LIKE ? ESCAPE '\\'))"; args.push(l, l); }
  const { results } = await env.DB.prepare(`SELECT c.id,c.title,c.model,c.updated_at FROM studio_conversations c WHERE ${where} ORDER BY c.updated_at DESC LIMIT 100`).bind(...args).all();
  return json({ conversations: results });
}
export async function onRequestPost({ request, env }) {
  const g = await guard(request, env, { needHandle: false }); if (g instanceof Response) return g;
  if (!(await limit(env, 'sv:' + g.user.id, 60, 3600))) return json({ error: 'rate_limited' }, 429);
  const b = await request.json().catch(() => null), cfg = studioConfig(env), models = await listModels(env, cfg);
  const model = b?.model ? String(b.model) : (models[0] ? models[0].id : null);
  if (b?.model && !models.some(m => m.id === model)) return json({ error: 'bad_model' }, 400);
  const c = await env.DB.prepare('SELECT COUNT(*) n FROM studio_conversations WHERE user_id=?').bind(g.user.id).first();
  if (c.n >= STUDIO.maxConvs) return json({ error: 'limit' }, 400);
  const id = crypto.randomUUID(), now = Date.now();
  await env.DB.prepare('INSERT INTO studio_conversations(id,user_id,title,model,created_at,updated_at) VALUES(?,?,?,?,?,?)').bind(id, g.user.id, 'New chat', model, now, now).run();
  return json({ ok: true, id }, 201);
}
