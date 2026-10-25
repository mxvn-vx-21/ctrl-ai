import { json } from '../../_lib/util.js';
import { guard } from '../../_lib/launchpad.js';
export async function onRequestPost({ request, env }) {
  const g = await guard(request, env); if (g instanceof Response) return g;
  await env.DB.prepare('UPDATE pages SET published=0 WHERE user_id=?').bind(g.user.id).run();
  return json({ ok: true, published: false });
}
