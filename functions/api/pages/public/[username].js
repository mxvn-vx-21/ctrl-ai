import { json } from '../../../_lib/util.js';
import { loadPublic } from '../../../_lib/pages.js';
export async function onRequestGet({ env, params }) {
  const d = await loadPublic(env, params.username);
  return d ? json(d) : json({ error: 'not_found' }, 404);
}
