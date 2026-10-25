import { json } from '../../../_lib/util.js';
import { guard, clean } from '../../../_lib/launchpad.js';
import { ownConv, studioConfig, listModels } from '../../../_lib/studio.js';
export async function onRequestGet({ request, env, params }) {
  const g = await guard(request, env, { write: false, needHandle: false }); if (g instanceof Response) return g;
  const c = await ownConv(env, g.user.id, params.id); if (!c) return json({ error: 'not_found' }, 404);
  const { results } = await env.DB.prepare('SELECT id,role,content,model,created_at FROM studio_messages WHERE conversation_id=? ORDER BY created_at, rowid LIMIT 500').bind(c.id).all();
  return json({ conversation: c, messages: results });
}
export async function onRequestPatch({ request, env, params }) {
  const g = await guard(request, env, { needHandle: false }); if (g instanceof Response) return g;
  const c = await ownConv(env, g.user.id, params.id); if (!c) return json({ error: 'not_found' }, 404);
  const b = await request.json().catch(() => null) || {};
  let title = c.title, model = c.model;
  if (b.title !== undefined) { title = clean(b.title, 80); if (!title) return json({ error: 'invalid' }, 400); }
  if (b.model !== undefined) { const ms = await listModels(env, studioConfig(env)); if (!ms.some(m => m.id === b.model)) return json({ error: 'bad_model' }, 400); model = b.model; }
  await env.DB.prepare('UPDATE studio_conversations SET title=?,model=? WHERE id=? AND user_id=?').bind(title, model, c.id, g.user.id).run();
  return json({ ok: true, title, model });
}
export async function onRequestDelete({ request, env, params }) {
  const g = await guard(request, env, { needHandle: false }); if (g instanceof Response) return g;
  const c = await ownConv(env, g.user.id, params.id); if (!c) return json({ error: 'not_found' }, 404);
  await env.DB.batch([env.DB.prepare('DELETE FROM studio_messages WHERE conversation_id=?').bind(c.id), env.DB.prepare('DELETE FROM studio_conversations WHERE id=? AND user_id=?').bind(c.id, g.user.id)]);
  return json({ ok: true });
}
