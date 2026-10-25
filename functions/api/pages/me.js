import { json, limit } from '../../_lib/util.js';
import { guard } from '../../_lib/launchpad.js';
import { validatePage, loadLinks, loadProjects, pageView } from '../../_lib/pages.js';
export async function onRequestGet({ request, env }) {
  const g = await guard(request, env, { write: false, needHandle: false }); if (g instanceof Response) return g;
  const p = await env.DB.prepare('SELECT * FROM pages WHERE user_id=?').bind(g.user.id).first();
  const mine = (await env.DB.prepare('SELECT slug,title,tagline FROM projects WHERE user_id=? ORDER BY created_at DESC').bind(g.user.id).all()).results;
  return json({ username: g.user.username, page: pageView(p), links: await loadLinks(env, g.user.id, false), projects: await loadProjects(env, g.user.id, false), mine });
}
export async function onRequestPut({ request, env }) {
  const g = await guard(request, env); if (g instanceof Response) return g;
  const v = validatePage(await request.json().catch(() => null)); if (v.errors) return json({ error: 'invalid', fields: v.errors }, 400);
  if (!(await limit(env, 'pw:' + g.user.id, 120, 3600))) return json({ error: 'rate_limited' }, 429);
  const d = v.value, now = Date.now();
  await env.DB.prepare(`INSERT INTO pages(user_id,display_name,bio,avatar_url,location,website,skills,layout,published,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,0,?,?)
    ON CONFLICT(user_id) DO UPDATE SET display_name=excluded.display_name,bio=excluded.bio,avatar_url=excluded.avatar_url,location=excluded.location,website=excluded.website,skills=excluded.skills,layout=excluded.layout,updated_at=excluded.updated_at`)
    .bind(g.user.id, d.display_name, d.bio, d.avatar_url, d.location, d.website, JSON.stringify(d.skills), d.layout, now, now).run();
  const p = await env.DB.prepare('SELECT * FROM pages WHERE user_id=?').bind(g.user.id).first();
  return json({ ok: true, page: pageView(p) });
}
