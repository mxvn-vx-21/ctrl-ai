import { json, limit } from '../../_lib/util.js';
import { guard } from '../../_lib/launchpad.js';
import { validateLinks } from '../../_lib/pages.js';
export async function onRequestPut({ request, env }) {
  const g = await guard(request, env); if (g instanceof Response) return g;
  const v = validateLinks((await request.json().catch(() => null))?.links); if (v.fields) return json({ error: 'invalid', index: v.index, fields: v.fields }, 400);
  if (!(await limit(env, 'pw:' + g.user.id, 120, 3600))) return json({ error: 'rate_limited' }, 429);
  const now = Date.now(), uid = g.user.id;
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO pages(user_id,layout,published,created_at,updated_at) VALUES(?,'cards',0,?,?)").bind(uid, now, now),
    env.DB.prepare('DELETE FROM page_links WHERE user_id=?').bind(uid),
    ...v.value.map((l, i) => env.DB.prepare('INSERT INTO page_links(id,user_id,title,url,kind,position,visible,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(), uid, l.title, l.url, l.kind, i, l.visible, now)),
    env.DB.prepare('UPDATE pages SET updated_at=? WHERE user_id=?').bind(now, uid),
  ]);
  return json({ ok: true });
}
