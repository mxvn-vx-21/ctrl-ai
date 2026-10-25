import { json } from './util.js';
export const STUDIO = { maxMsg: 8000, ctxMsgs: 20, ctxChars: 60000, maxConvs: 200, maxMsgsPerConv: 200, timeoutMs: 120000 };
export const SYSTEM = 'You are CTRL AI Studio, a concise, accurate coding assistant. Help with writing, explaining, debugging and refactoring code. Use Markdown, put code in fenced blocks with a language tag, and be direct.';
export function studioConfig(env) {
  const provider = String(env.STUDIO_PROVIDER || 'anthropic').toLowerCase() === 'openai' ? 'openai' : 'anthropic';
  const key = provider === 'anthropic' ? env.ANTHROPIC_API_KEY : env.STUDIO_API_KEY;
  const base = String(provider === 'anthropic' ? (env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com') : (env.STUDIO_BASE_URL || '')).replace(/\/+$/, '');
  const maxOut = Math.max(256, Math.min(parseInt(env.STUDIO_MAX_TOKENS || '2048', 10) || 2048, 4096));
  return { provider, key, base, maxOut, configured: !!(key && base), label: provider === 'anthropic' ? 'Anthropic' : 'OpenAI-compatible' };
}
const cache = { at: 0, key: '', models: null };
// Models come from trusted server config (STUDIO_MODELS="id|Label,id2") or, if unset, the provider's own model list.
export async function listModels(env, cfg) {
  const raw = String(env.STUDIO_MODELS || '').trim();
  if (raw) return raw.split(',').map(s => s.trim()).filter(Boolean).map(s => { const i = s.indexOf('|'); return i > 0 ? { id: s.slice(0, i).trim(), label: s.slice(i + 1).trim() } : { id: s, label: s }; }).filter(m => /^[A-Za-z0-9._\/:-]{1,100}$/.test(m.id));
  if (!cfg.configured) return [];
  const ck = cfg.provider + cfg.base;
  if (cache.models && cache.key === ck && Date.now() - cache.at < 600000) return cache.models;
  try {
    const r = await fetch(cfg.provider === 'anthropic' ? `${cfg.base}/v1/models?limit=100` : `${cfg.base}/models`, { headers: cfg.provider === 'anthropic' ? { 'x-api-key': cfg.key, 'anthropic-version': '2023-06-01' } : { authorization: `Bearer ${cfg.key}` }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return [];
    const j = await r.json(), models = (j.data || []).slice(0, 60).map(m => ({ id: String(m.id), label: String(m.display_name || m.id) })).filter(m => /^[A-Za-z0-9._\/:-]{1,100}$/.test(m.id));
    cache.at = Date.now(); cache.key = ck; cache.models = models; return models;
  } catch { return []; }
}
export const defaultModel = (env, models) => (models.find(m => m.id === env.STUDIO_DEFAULT_MODEL) || models[0] || {}).id || null;
export function mapStatus(s) { return s === 401 || s === 403 ? ['provider_auth', 502] : s === 429 ? ['provider_rate_limited', 429] : s === 400 || s === 404 || s === 422 ? ['provider_rejected', 502] : ['provider_error', 502]; }
export async function openStream(cfg, { model, messages, signal }) {
  const anth = cfg.provider === 'anthropic';
  const url = anth ? `${cfg.base}/v1/messages` : `${cfg.base}/chat/completions`;
  const headers = anth ? { 'x-api-key': cfg.key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' } : { authorization: `Bearer ${cfg.key}`, 'content-type': 'application/json' };
  const body = anth ? { model, max_tokens: cfg.maxOut, system: SYSTEM, messages, stream: true } : { model, max_tokens: cfg.maxOut, messages: [{ role: 'system', content: SYSTEM }, ...messages], stream: true };
  let r;
  try { r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal }); }
  catch { return signal.aborted ? { error: 'timeout', status: 504 } : { error: 'provider_error', status: 502 }; }
  if (!r.ok) { try { await r.body?.cancel(); } catch {} const [error, status] = mapStatus(r.status); console.error('provider_http', r.status); return { error, status }; }
  if (!r.body) return { error: 'provider_error', status: 502 };
  return { resp: r };
}
function* mapEvent(provider, j) {
  if (provider === 'anthropic') {
    if (j.type === 'content_block_delta' && j.delta && j.delta.type === 'text_delta') yield { text: String(j.delta.text || '') };
    else if (j.type === 'message_stop') yield { stop: true };
    else if (j.type === 'error') yield { error: true };
  } else {
    if (j.error) { yield { error: true }; return; }
    const c = j.choices && j.choices[0]; if (!c) return;
    if (c.delta && typeof c.delta.content === 'string' && c.delta.content) yield { text: c.delta.content };
    if (c.finish_reason) yield { stop: true };
  }
}
export async function* events(provider, body) {
  const rd = body.getReader(), dec = new TextDecoder(); let buf = '';
  for (;;) {
    const { done, value } = await rd.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let m;
    while ((m = /\r?\n\r?\n/.exec(buf))) {
      const blk = buf.slice(0, m.index); buf = buf.slice(m.index + m[0].length);
      const data = blk.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
      if (!data) continue;
      if (data === '[DONE]') { yield { stop: true }; continue; }
      let j; try { j = JSON.parse(data); } catch { continue; }
      yield* mapEvent(provider, j);
    }
  }
}
export const makeTitle = t => { const s = String(t).replace(/\s+/g, ' ').trim(); return s ? (s.length > 60 ? s.slice(0, 57).trimEnd() + '…' : s) : 'New chat'; };
export function buildContext(history, userText) {
  let h = history.slice(-STUDIO.ctxMsgs);
  while (h.length && h[0].role !== 'user') h.shift();
  let total = userText.length + h.reduce((n, m) => n + m.content.length, 0);
  while (h.length > 1 && total > STUDIO.ctxChars) { total -= h[0].content.length; h.shift(); while (h.length && h[0].role !== 'user') { total -= h[0].content.length; h.shift(); } }
  const out = h.map(m => ({ role: m.role, content: m.content }));
  if (userText) out.push({ role: 'user', content: userText });
  return out;
}
export const UUID = /^[0-9a-f-]{36}$/;
export async function ownConv(env, uid, id) {
  if (!UUID.test(String(id))) return null;
  return env.DB.prepare('SELECT id,title,model,created_at,updated_at FROM studio_conversations WHERE id=? AND user_id=?').bind(id, uid).first();
}
export const needCfg = cfg => cfg.configured ? null : json({ error: 'not_configured' }, 503);
