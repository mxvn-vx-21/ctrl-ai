import { json } from '../../_lib/util.js';
import { guard } from '../../_lib/launchpad.js';
import { studioConfig, listModels, defaultModel } from '../../_lib/studio.js';
export async function onRequestGet({ request, env }) {
  const g = await guard(request, env, { write: false, needHandle: false }); if (g instanceof Response) return g;
  const cfg = studioConfig(env), models = await listModels(env, cfg);
  return json({ configured: cfg.configured && models.length > 0, provider: cfg.configured ? cfg.label : null, models: cfg.configured ? models : [], default: cfg.configured ? defaultModel(env, models) : null, key_set: !!cfg.key });
}
