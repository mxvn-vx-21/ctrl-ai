import { clean, cleanMulti, cleanUrl } from './launchpad.js';
export const LAYOUTS = ['minimal', 'cards', 'portfolio'];
export const KINDS = ['link', 'website', 'github', 'x', 'linkedin', 'youtube', 'discord', 'instagram', 'twitch', 'mastodon'];
const httpsUrl = v => { const u = cleanUrl(v); return u && u.startsWith('https://') ? u : null; };
export function validatePage(b) {
  const e = {}, display_name = clean(b?.display_name, 50) || null, bio = cleanMulti(b?.bio, 280) || null, location = clean(b?.location, 60) || null;
  const ra = String(b?.avatar_url ?? '').trim(), avatar_url = ra ? httpsUrl(ra) : null; if (ra && !avatar_url) e.avatar_url = 'Profile image must be an https URL.';
  const rw = String(b?.website ?? '').trim(), website = rw ? cleanUrl(rw) : null; if (rw && !website) e.website = 'Enter a valid http(s) URL.';
  let skills = b?.skills; if (typeof skills === 'string') skills = skills.split(','); if (!Array.isArray(skills)) skills = [];
  skills = [...new Set(skills.map(s => clean(s, 24)).filter(Boolean))];
  if (skills.length > 10) e.skills = 'Up to 10 skills.';
  const layout = String(b?.layout || 'cards'); if (!LAYOUTS.includes(layout)) e.layout = 'Unknown layout.';
  return Object.keys(e).length ? { errors: e } : { value: { display_name, bio, avatar_url, location, website, skills, layout } };
}
export function validateLinks(arr) {
  if (!Array.isArray(arr) || arr.length > 30) return { index: -1, fields: { list: 'Up to 30 links.' } };
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const l = arr[i], title = clean(l?.title, 60), url = cleanUrl(l?.url), kind = KINDS.includes(l?.kind) ? l.kind : 'link', f = {};
    if (!title) f.title = 'Title is required.'; if (!url) f.url = 'Enter a valid http(s) URL.';
    if (Object.keys(f).length) return { index: i, fields: f };
    out.push({ title, url, kind, visible: l?.visible === false ? 0 : 1 });
  }
  return { value: out };
}
export function validateProjects(arr) {
  if (!Array.isArray(arr) || arr.length > 12) return { index: -1, fields: { list: 'Up to 12 projects.' } };
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const p = arr[i], description = clean(p?.description, 200) || null, visible = p?.visible === false ? 0 : 1, rt = String(p?.thumb_url ?? '').trim(), thumb_url = rt ? httpsUrl(rt) : null, f = {};
    if (rt && !thumb_url) f.thumb_url = 'Thumbnail must be an https URL.';
    if (p?.project_slug) { if (Object.keys(f).length) return { index: i, fields: f }; out.push({ slug: String(p.project_slug).toLowerCase().slice(0, 80), description, thumb_url, visible }); continue; }
    const title = clean(p?.title, 60), url = cleanUrl(p?.url);
    if (!title) f.title = 'Title is required.'; if (!url) f.url = 'Enter a valid http(s) URL.';
    if (Object.keys(f).length) return { index: i, fields: f };
    out.push({ title, url, description, thumb_url, visible });
  }
  return { value: out };
}
const parseSkills = s => { try { const a = JSON.parse(s || '[]'); return Array.isArray(a) ? a.map(String) : []; } catch { return []; } };
export async function loadProjects(env, userId, onlyVisible) {
  const { results } = await env.DB.prepare(`SELECT pp.project_id,pp.title,pp.description,pp.url,pp.thumb_url,pp.visible,p.slug lp_slug,p.title lp_title,p.tagline lp_tagline,p.logo_url lp_logo
    FROM page_projects pp LEFT JOIN projects p ON p.id=pp.project_id WHERE pp.user_id=? ${onlyVisible ? 'AND pp.visible=1' : ''} AND (pp.project_id IS NULL OR p.id IS NOT NULL) ORDER BY pp.position`).bind(userId).all();
  return results.map(r => r.project_id ? { kind: 'launchpad', project_slug: r.lp_slug, title: r.lp_title, description: r.description || r.lp_tagline, url: '/launchpad/project/' + r.lp_slug, thumb_url: r.thumb_url || r.lp_logo || null, visible: !!r.visible }
    : { kind: 'external', title: r.title, description: r.description, url: r.url, thumb_url: r.thumb_url, visible: !!r.visible });
}
export async function loadLinks(env, userId, onlyVisible) {
  const { results } = await env.DB.prepare(`SELECT title,url,kind,visible FROM page_links WHERE user_id=? ${onlyVisible ? 'AND visible=1' : ''} ORDER BY position`).bind(userId).all();
  return results.map(l => ({ ...l, visible: !!l.visible }));
}
export const pageView = p => p ? { display_name: p.display_name, bio: p.bio, avatar_url: p.avatar_url, location: p.location, website: p.website, skills: parseSkills(p.skills), layout: p.layout, published: !!p.published } : null;
// Public data: only published pages; never includes email or drafts.
export async function loadPublic(env, username) {
  const u = await env.DB.prepare('SELECT u.id,u.username FROM users u WHERE u.username=?').bind(String(username).toLowerCase()).first();
  if (!u) return null;
  const p = await env.DB.prepare('SELECT * FROM pages WHERE user_id=? AND published=1').bind(u.id).first();
  if (!p) return null;
  return { username: u.username, ...pageView(p), links: await loadLinks(env, u.id, true), projects: await loadProjects(env, u.id, true) };
}
