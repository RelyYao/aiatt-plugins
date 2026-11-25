// SPDX-License-Identifier: Apache-2.0
// Stateless game UI primitives; no game engines or per-game views.
export const e = (ctx, value) => ctx.esc ? ctx.esc(value ?? '') : String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const list = value => Array.isArray(value) ? value : [];
// T(key, english, params): localized plain text via /locales (English source). Escape with e() before HTML.
export const T = (key, english, params) => { const f = globalThis.AiattShellI18n?.L; return typeof f === 'function' ? f(key, english, params) : String(english ?? key).replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (all, name) => params && Object.hasOwn(params, name) && params[name] != null ? String(params[name]) : all); };
export const gameOf = detail => detail?.state?.game || null;
export const catalogOf = ctx => list(Array.isArray(ctx.catalog) ? ctx.catalog : ctx.catalog?.games);


export const num = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export const isOwner = (detail, ctx) => detail.room?.ownerId === ctx.me?.id;
export const nameOf = (detail, id) => detail.room?.memberInfo?.[id]?.name || detail.userNames?.[id] || detail.room?.memberNames?.[id] || T('game.player', 'Player');

export const attr = (ctx, name, value) => ` data-${name}="${e(ctx, value)}"`;
export const button = (ctx, text, action, extra = '', disabled = false, primary = false) => `<button type="button" class="m-btn ${primary ? 'm-btn-primary' : ''}" data-mg-action="${e(ctx, action)}"${extra}${disabled ? ' disabled' : ''}>${e(ctx, text)}</button>`;
export const note = (ctx, text) => `<p class="mg-note">${e(ctx, text)}</p>`;
export const clock = (ctx, deadline) => deadline ? `<span class="mg-clock" data-mg-deadline="${num(deadline)}">${e(ctx, Math.max(0, Math.ceil((num(deadline) - Date.now()) / 1000)))}s</span>` : '';
export const heading = (ctx, title, sub = '', deadline = 0) => `<header class="mg-heading"><div><h2>${e(ctx, title)}</h2>${sub ? `<p>${e(ctx, sub)}</p>` : ''}</div>${clock(ctx, deadline)}</header>`;

export const actionRow = html => `<div class="mg-actions">${html}</div>`;
export const teamOf = (g, id) => list(g.teams).find(team => list(team.members).some(member => member.id === id));
export const squadOf = (g, id) => list(g.squads || g.seats).find(team => list(team.members).some(member => member.id === id));

