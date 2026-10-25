import { json } from '../../_lib/util.js';
import { guard } from '../../_lib/launchpad.js';
export async function onRequestPost({ request, env }) {
  const g = await guard(request, env); if (g instanceof Response) return g;
  const p = await env.DB.prepare('SELECT display_name,bio FROM pages WHERE user_id=?').bind(g.user.id).first();
  const missing = []; if (!p || !p.display_name) missing.push('display_name'); if (!p || !p.bio) missing.push('bio');
  if (missing.length) return json({ error: 'incomplete', missing }, 400);
  const now = Date.now();
  await env.DB.prepare('UPDATE pages SET published=1,published_at=COALESCE(published_at,?) WHERE user_id=?').bind(now, g.user.id).run();
  return json({ ok: true, published: true, url: `/u/${g.user.username}` });
}
