import { esc, page } from '../_lib/ui.js';
import { UCSS } from '../_lib/ucss.js';
import { loadPublic } from '../_lib/pages.js';
import { HANDLE_RE } from '../_lib/launchpad.js';
const KIND = { link: 'Link', website: 'Website', github: 'GitHub', x: 'X', linkedin: 'LinkedIn', youtube: 'YouTube', discord: 'Discord', instagram: 'Instagram', twitch: 'Twitch', mastodon: 'Mastodon' };
const ext = u => `href="${esc(u)}" target="_blank" rel="noopener nofollow ugc"`;
export async function onRequestGet({ request, env, params }) {
  const raw = String(params.username || ''), n = raw.toLowerCase(), origin = env.APP_URL ? new URL(env.APP_URL).origin : new URL(request.url).origin;
  const nf = () => page({ title: 'Page not available · CTRL', desc: 'This page is not available.', status: 404, bare: true, body: '<div class="u-page"><p class="u-at">404</p><h1 class="u-name">This page isn’t available.</h1><p class="u-bio">It may not exist or hasn’t been published.</p><p><a class="b" href="/#/pages">Create your own page</a></p></div>', css: UCSS });
  if (!HANDLE_RE.test(n)) return nf();
  if (raw !== n) return Response.redirect(`${new URL(request.url).origin}/u/${n}`, 301);
  const d = await loadPublic(env, n); if (!d) return nf();
  const name = d.display_name || d.username, canon = `${origin}/u/${d.username}`;
  const av = d.avatar_url ? `<img class="u-av" src="${esc(d.avatar_url)}" alt="${esc(name)} profile image" width="96" height="96" loading="lazy" referrerpolicy="no-referrer">` : `<div class="u-av" aria-hidden="true">${esc(name.trim().charAt(0).toUpperCase() || '?')}</div>`;
  const links = d.links.length ? `<section class="u-sec"><h2 class="u-lab">Links</h2><div class="u-links">${d.links.map(l => `<a class="u-link" ${ext(l.url)}><span>${esc(l.title)}</span><small>${esc(KIND[l.kind] || 'Link')}</small></a>`).join('')}</div></section>` : '';
  const projs = d.projects.length ? `<section class="u-sec"><h2 class="u-lab">Projects</h2><div class="u-projs">${d.projects.map(p => `<a class="u-proj" ${p.kind === 'launchpad' ? `href="${esc(p.url)}"` : ext(p.url)}>${p.thumb_url ? `<img class="u-th" src="${esc(p.thumb_url)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}<h3>${esc(p.title)}</h3>${p.description ? `<p>${esc(p.description)}</p>` : ''}</a>`).join('')}</div></section>` : '';
  const meta = [d.location ? `<span>${esc(d.location)}</span>` : '', d.website ? `<a ${ext(d.website)}>${esc(d.website.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</a>` : ''].filter(Boolean).join('');
  const body = `<main class="u-page u-${esc(d.layout)}"><header class="u-hd">${av}<h1 class="u-name">${esc(name)}</h1><div class="u-at">@${esc(d.username)}</div>${d.bio ? `<p class="u-bio">${esc(d.bio)}</p>` : ''}${meta ? `<div class="u-meta">${meta}</div>` : ''}${d.skills.length ? `<div class="u-chips">${d.skills.map(s => `<span class="u-chip">${esc(s)}</span>`).join('')}</div>` : ''}</header>${d.layout === 'portfolio' ? projs + links : links + projs}<footer class="u-foot">Made with <a href="/">CTRL</a></footer></main>`;
  const head = `<link rel="canonical" href="${esc(canon)}"><meta property="og:url" content="${esc(canon)}"><meta property="og:type" content="profile">${d.avatar_url ? `<meta property="og:image" content="${esc(d.avatar_url)}">` : ''}`;
  return page({ title: `${name} (@${d.username}) · CTRL`, desc: d.bio || `${name} on CTRL`, body, head, bare: true, css: UCSS, extra: { 'cache-control': 'public, max-age=30' } });
}
