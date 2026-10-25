import { json, limit } from '../../_lib/util.js';
import { guard } from '../../_lib/launchpad.js';
import { validateProjects } from '../../_lib/pages.js';
export async function onRequestPut({ request, env }) {
  const g = await guard(request, env); if (g instanceof Response) return g;
  const v = validateProjects((await request.json().catch(() => null))?.projects); if (v.fields) return json({ error: 'invalid', index: v.index, fields: v.fields }, 400);
  if (!(await limit(env, 'pw:' + g.user.id, 120, 3600))) return json({ error: 'rate_limited' }, 429);
  const uid = g.user.id, now = Date.now(), seen = new Set(), rows = [];
  for (let i = 0; i < v.value.length; i++) {
    const p = v.value[i];
    if (p.slug) {
      // ownership is resolved server-side from the slug and the session; the browser never supplies an id
      const own = await env.DB.prepare('SELECT id FROM projects WHERE slug=? AND user_id=?').bind(p.slug, uid).first();
      if (!own) return json({ error: 'not_yours', index: i }, 403);
      if (seen.has(own.id)) return json({ error: 'invalid', index: i, fields: { project: 'Project added twice.' } }, 400);
      seen.add(own.id); rows.push({ pid: own.id, ...p });
    } else rows.push({ pid: null, ...p });
  }
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO pages(user_id,layout,published,created_at,updated_at) VALUES(?,'cards',0,?,?)").bind(uid, now, now),
    env.DB.prepare('DELETE FROM page_projects WHERE user_id=?').bind(uid),
    ...rows.map((r, i) => env.DB.prepare('INSERT INTO page_projects(id,user_id,project_id,title,description,url,thumb_url,position,visible,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(), uid, r.pid, r.pid ? null : r.title, r.description, r.pid ? null : r.url, r.thumb_url, i, r.visible, now)),
    env.DB.prepare('UPDATE pages SET updated_at=? WHERE user_id=?').bind(now, uid),
  ]);
  return json({ ok: true });
}
