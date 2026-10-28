#!/usr/bin/env node
/**
 * Builds the generated parts of the profile README: the animated header, the camera kit,
 * one card per project and the contribution timeline, in a dark and a light version each.
 * Runs every day in .github/workflows/profile.yml. Locally: `node scripts/build.mjs`.
 * GITHUB_TOKEN is optional; without it the contribution calendar is read from the public profile page.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const config = {
  user: 'OSSKIDEV',
  name: 'Oskar Michalski',
  roles: 'FRONT-END  ·  VIDEO  ·  PHOTO',
  /** Shown first, in this order. The text replaces the repo description on the card. */
  featured: {
    'GPT-LEARN': 'A course in Polish on how ChatGPT and AI work, and how to build your own AI tools. Six chapters in plain HTML, CSS and JavaScript.',
    'Weather-app': 'My first front-end app: search for any city and get the current weather from the OpenWeather API.',
    'To-do_app': 'A task list in plain JavaScript. Add, tick off and delete tasks; the list is saved in localStorage.',
    'Password-Generator': 'Generates a strong random password in one click and copies it to the clipboard.',
  },
  /** Other public repos fill the remaining slots, most recently pushed first. */
  hidden: ['OSSKIDEV'],
  maxProjects: 6,
};

const themes = {
  dark: {
    bg: '#07090f', panel: '#0e1322', line: '#262a36', text: '#e7e7e2', muted: '#9399a9',
    steel: '#93a3b8', rec: '#e5262e', ok: '#3fb950',
    heat: ['#1c2233', '#3b4560', '#6b7a9c', '#c6cedd'],
  },
  light: {
    bg: '#f3f3ef', panel: '#ffffff', line: '#d9d9d2', text: '#161a2b', muted: '#5b6072',
    steel: '#5b6072', rec: '#e5262e', ok: '#1a7f37',
    heat: ['#d9d9d2', '#a9b0c2', '#6b7590', '#2a2f45'],
  },
};

const languageColors = {
  HTML: '#e34c26', CSS: '#663399', JavaScript: '#f1e05a', TypeScript: '#3178c6', Python: '#3572a5',
  'C#': '#178600', Java: '#b07219', PHP: '#4f5d95', Vue: '#41b883', Shell: '#89e051', SCSS: '#c6538c',
};

const SANS = `-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif`;
const MONO = `ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace`;

const root = new URL('../', import.meta.url);
const token = process.env.GITHUB_TOKEN;

// ---------------------------------------------------------------- data

async function api(path) {
  const headers = { accept: 'application/vnd.github+json', 'user-agent': config.user };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`https://api.github.com${path}`, { headers });
  if (!res.ok) throw new Error(`GET ${path}: ${res.status}`);
  return res.json();
}

async function isLive(url) {
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(8000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function loadProjects() {
  const repos = (await api(`/users/${config.user}/repos?per_page=100&sort=pushed`))
    .filter((r) => !r.fork && !r.archived && !config.hidden.includes(r.name));
  const order = Object.keys(config.featured);
  const rank = (r) => (order.includes(r.name) ? order.indexOf(r.name) : order.length);
  repos.sort((a, b) => rank(a) - rank(b) || b.pushed_at.localeCompare(a.pushed_at));

  return Promise.all(repos.slice(0, config.maxProjects).map(async (r) => {
    const candidates = [r.homepage, r.has_pages && `https://${config.user.toLowerCase()}.github.io/${r.name}/`];
    let demo = null;
    for (const url of candidates.filter(Boolean)) {
      if (await isLive(url)) { demo = url; break; }
    }
    return {
      name: r.name,
      url: r.html_url,
      description: config.featured[r.name] || r.description || 'No description yet.',
      language: r.language,
      stars: r.stargazers_count,
      pushed: r.pushed_at,
      demo,
      languages: await api(`/repos/${config.user}/${r.name}/languages`),
    };
  }));
}

async function loadCalendarFromApi() {
  const query = `query($login: String!) { user(login: $login) { contributionsCollection { contributionCalendar {
    weeks { contributionDays { date contributionCount } } } } } }`;
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'user-agent': config.user },
    body: JSON.stringify({ query, variables: { login: config.user } }),
  });
  const json = await res.json();
  const weeks = json.data?.user?.contributionsCollection.contributionCalendar.weeks;
  if (!weeks) throw new Error(`GraphQL: ${JSON.stringify(json.errors ?? json)}`);
  return weeks.flatMap((w) => w.contributionDays.map((d) => ({ date: d.date, count: d.contributionCount })));
}

/** The public calendar page: each day is a <td> whose count lives in a <tool-tip for="td id">. */
async function loadCalendarFromPage() {
  const res = await fetch(`https://github.com/users/${config.user}/contributions`, { headers: { 'user-agent': config.user } });
  if (!res.ok) throw new Error(`contributions page: ${res.status}`);
  const html = await res.text();
  const counts = new Map();
  for (const [, id, label] of html.matchAll(/<tool-tip[^>]*\bfor="([^"]+)"[^>]*>([^<]*)<\/tool-tip>/g)) {
    counts.set(id, Number(label.match(/^(\d+) contribution/)?.[1] ?? 0));
  }
  const days = [];
  for (const [td] of html.matchAll(/<td[^>]*ContributionCalendar-day[^>]*>/g)) {
    const date = td.match(/data-date="([^"]+)"/)?.[1];
    const id = td.match(/\bid="([^"]+)"/)?.[1];
    if (date) days.push({ date, count: counts.get(id) ?? 0 });
  }
  if (!days.length) throw new Error('contributions page: no days found');
  return days.sort((a, b) => a.date.localeCompare(b.date));
}

async function loadCalendar() {
  if (token) {
    try { return await loadCalendarFromApi(); } catch (e) { console.warn(e.message); }
  }
  return loadCalendarFromPage();
}

// ---------------------------------------------------------------- helpers

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function wrap(text, width, maxLines) {
  const lines = [''];
  for (const word of text.split(/\s+/)) {
    const last = lines.length - 1;
    if (!lines[last]) lines[last] = word;
    else if ((lines[last] + ' ' + word).length <= width) lines[last] += ' ' + word;
    else lines.push(word);
  }
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = lines[maxLines - 1].replace(/\W*\s*\S*$/, '') + '…';
  }
  return lines;
}

function svg(w, h, title, body, style = '') {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}">
<title>${esc(title)}</title>
<style>
text { font-family: ${SANS}; }
.mono { font-family: ${MONO}; }
${style}
@media (prefers-reduced-motion: reduce) { * { animation: none !important; } .typing-cover { display: none; } }
</style>
${body}
</svg>
`;
}

/** Relative luminance above which dark text reads better than white. */
const isLight = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.55;
};

const monthYear = (iso) => new Date(iso).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });

// ---------------------------------------------------------------- header

function header(t) {
  const W = 1200, H = 340, X = 72, R = 1136;

  // Timecode HH:MM:SS:FF. Animated digits are a column of values scrolled by a stepped animation.
  const fs = 18, cw = fs * 0.6, lh = 24, tcY = 70, tcX = R - 11 * cw;
  const column = (x, values, seconds) => {
    const name = `tc${Math.round(x)}`;
    const texts = values.map((v, i) => `<text class="mono" x="${x.toFixed(1)}" y="${tcY + i * lh}" font-size="${fs}" fill="${t.text}">${v}</text>`).join('');
    return {
      css: `.${name} { animation: ${name} ${seconds}s steps(${values.length}) infinite; } @keyframes ${name} { to { transform: translateY(-${values.length * lh}px); } }`,
      svg: `<g class="${name}">${texts}</g>`,
    };
  };
  const digits = (n) => Array.from({ length: n }, (_, i) => String(i));
  const frames = Array.from({ length: 25 }, (_, i) => String(i).padStart(2, '0'));
  const cols = [
    column(tcX + 4 * cw, digits(10), 600),
    column(tcX + 6 * cw, digits(6), 60),
    column(tcX + 7 * cw, digits(10), 10),
    column(tcX + 9 * cw, frames, 1),
  ];
  const statics = [[0, '00:0'], [5, ':'], [8, ':']]
    .map(([i, s]) => `<text class="mono" x="${(tcX + i * cw).toFixed(1)}" y="${tcY}" font-size="${fs}" fill="${t.text}">${s}</text>`).join('');

  // Headline typed out by shrinking a cover rect in one step per character.
  const words = [['Between ', t.text], ['code', t.steel], [' and ', t.text], ['camera', t.rec], ['.', t.text]];
  const hl = 34, hlY = 236, chars = words.reduce((n, [s]) => n + s.length, 0), hlW = chars * hl * 0.6;
  const tspans = words.map(([s, c]) => `<tspan fill="${c}">${esc(s)}</tspan>`).join('');

  const corner = (x, y, dx, dy, len = 40) => `<path d="M${x} ${y + dy * len}V${y}H${x + dx * len}" fill="none" stroke="${t.steel}" stroke-width="2"/>`;
  const thirds = [W / 3, (2 * W) / 3].map((x) => `<line x1="${x}" y1="28" x2="${x}" y2="${H - 28}"/>`).join('')
    + [H / 3, (2 * H) / 3].map((y) => `<line x1="28" y1="${y}" x2="${W - 28}" y2="${y}"/>`).join('');

  const fx = 960, fy = 168, fsz = 132, b = 24;
  const focus = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) => {
    const x = fx + (sx * fsz) / 2, y = fy + (sy * fsz) / 2;
    return `<path d="M${x} ${y - sy * b}V${y}H${x - sx * b}" fill="none" stroke-width="2.5"/>`;
  }).join('');

  const meter = (x, cls) => `<rect x="${x}" y="110" width="6" height="150" rx="1" fill="${t.line}"/>
<rect class="${cls}" x="${x}" y="110" width="6" height="150" rx="1" fill="url(#lvl)"/>`;

  const css = `
${cols.map((c) => c.css).join('\n')}
.blink { animation: blink 1s steps(1) infinite; }
@keyframes blink { 50% { opacity: 0; } }
.typing-cover { transform-box: fill-box; transform-origin: right center; animation: untype 2.2s steps(${chars}) .5s forwards; }
@keyframes untype { to { transform: scaleX(0); } }
.caret { animation: caret 2.2s steps(${chars}) .5s forwards, blink 1s steps(1) 2.7s infinite; }
@keyframes caret { to { transform: translateX(${hlW}px); } }
.focus { transform-box: fill-box; transform-origin: center; stroke: ${t.steel}; animation: hunt 1.6s ease-out .3s both; }
@keyframes hunt { 0% { transform: scale(1.3); } 45% { transform: scale(.9); } 70% { transform: scale(1.06); } 99% { stroke: ${t.steel}; } 100% { transform: scale(1); stroke: ${t.ok}; } }
.glyph { animation: sharpen 1.6s ease-out .3s both; }
@keyframes sharpen { from { opacity: .25; } to { opacity: 1; } }
.lvl-a, .lvl-b { transform-box: fill-box; transform-origin: bottom; }
.lvl-a { animation: lvl .9s ease-in-out infinite alternate; }
.lvl-b { animation: lvl 1.3s ease-in-out .2s infinite alternate; }
@keyframes lvl { from { transform: scaleY(.25); } to { transform: scaleY(.8); } }`;

  const body = `<defs>
<clipPath id="tc"><rect x="${tcX - 2}" y="${tcY - fs}" width="${11 * cw + 4}" height="${lh}"/></clipPath>
<linearGradient id="lvl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${t.rec}"/><stop offset=".3" stop-color="#e3b341"/><stop offset=".55" stop-color="${t.ok}"/></linearGradient>
</defs>
<rect width="${W}" height="${H}" rx="18" fill="${t.bg}"/>
<g stroke="${t.steel}" stroke-opacity=".12" stroke-dasharray="2 6">${thirds}</g>
${corner(28, 28, 1, 1)}${corner(W - 28, 28, -1, 1)}${corner(28, H - 28, 1, -1)}${corner(W - 28, H - 28, -1, -1)}
<circle class="blink" cx="${X - 6}" cy="${tcY - 6}" r="7" fill="${t.rec}"/>
<text class="mono" x="${X + 10}" y="${tcY}" font-size="16" font-weight="700" fill="${t.text}">REC</text>
<text class="mono" x="${X + 62}" y="${tcY}" font-size="14" fill="${t.muted}">OSSKI · CAM A</text>
${statics}<g clip-path="url(#tc)">${cols.map((c) => c.svg).join('')}</g>
<text class="mono" x="${X}" y="118" font-size="14" letter-spacing="3" fill="${t.muted}">HELLO, I'M</text>
<text x="${X - 3}" y="178" font-size="66" font-weight="800" letter-spacing="1" fill="${t.text}">${esc(config.name.toUpperCase())}</text>
<text class="mono" x="${X}" y="${hlY}" font-size="${hl}" xml:space="preserve">${tspans}</text>
<rect class="typing-cover" x="${X - 2}" y="${hlY - hl}" width="${hlW + 6}" height="${hl + 12}" fill="${t.bg}"/>
<rect class="caret" x="${X}" y="${hlY - hl + 4}" width="${hl * 0.5}" height="${hl}" fill="${t.rec}"/>
<text x="${X}" y="300" font-size="14" font-weight="600" letter-spacing="3" fill="${t.muted}">${esc(config.roles)}</text>
<g class="focus">${focus}</g>
<text class="mono glyph" x="${fx}" y="${fy + 14}" font-size="44" text-anchor="middle" fill="${t.steel}">&lt;/&gt;</text>
<text class="mono" x="${fx}" y="${fy + fsz / 2 + 26}" font-size="12" letter-spacing="2" text-anchor="middle" fill="${t.muted}">AF-C</text>
${meter(1104, 'lvl-a')}${meter(1116, 'lvl-b')}
<text class="mono" x="${R}" y="300" font-size="13" text-anchor="end" fill="${t.muted}">4K  25P  ISO 100  f/2.8  1/50</text>`;

  return svg(W, H, `${config.name}: between code and camera`, body, css);
}

// ---------------------------------------------------------------- camera kit

function kit(t) {
  const tools = [
    { label: 'Dr', name: 'DaVinci Resolve', bg: t === themes.dark ? '#1b1e27' : '#2a2f45', fg: ['#f3c142', '#e5262e', '#3d8de8'] },
    { label: 'Lr', name: 'Adobe Lightroom', bg: '#001e36', fg: ['#31a8ff'] },
    { label: 'Ps', name: 'Adobe Photoshop', bg: '#001e36', fg: ['#31a8ff'] },
  ];
  const size = 48, gap = 12;
  const W = tools.length * (size + gap) - gap;
  const tiles = tools.map((tool, i) => {
    const x = i * (size + gap);
    const fill = tool.fg.length > 1 ? `url(#g${i})` : tool.fg[0];
    const grad = tool.fg.length > 1
      ? `<linearGradient id="g${i}" x1="0" y1="0" x2="1" y2="1">${tool.fg.map((c, j) => `<stop offset="${j / (tool.fg.length - 1)}" stop-color="${c}"/>`).join('')}</linearGradient>`
      : '';
    return `${grad}<g><title>${esc(tool.name)}</title><rect x="${x}" width="${size}" height="${size}" rx="11" fill="${tool.bg}"/>
<text x="${x + size / 2}" y="32" font-size="21" font-weight="700" text-anchor="middle" fill="${fill}">${tool.label}</text></g>`;
  }).join('\n');
  return svg(W, size, tools.map((x) => x.name).join(', '), tiles);
}

// ---------------------------------------------------------------- project card

function card(t, p, index) {
  const W = 590, H = 220;
  const perfs = Array.from({ length: 25 }, (_, i) => `<rect x="${22 + i * 22.5}" y="14" width="10" height="6" rx="1.5"/>`).join('');
  const lines = wrap(p.description, 62, 3)
    .map((l, i) => `<text x="28" y="${130 + i * 22}" font-size="15" fill="${t.muted}">${esc(l)}</text>`).join('');
  const lang = p.language
    ? `<circle cx="${W - 28 - p.language.length * 7.8 - 14}" cy="51" r="5" fill="${languageColors[p.language] ?? t.steel}"/>
<text class="mono" x="${W - 28}" y="56" font-size="13" text-anchor="end" fill="${t.muted}">${esc(p.language)}</text>`
    : '';
  const meta = [`Updated ${monthYear(p.pushed)}`, p.stars ? `★ ${p.stars}` : ''].filter(Boolean).join('   ');
  const live = p.demo
    ? `<rect x="${W - 112}" y="178" width="84" height="24" rx="12" fill="none" stroke="${t.rec}" stroke-opacity=".6"/>
<circle class="blink" cx="${W - 97}" cy="190" r="4" fill="${t.rec}"/>
<text class="mono" x="${W - 87}" y="194.5" font-size="12" font-weight="700" fill="${t.rec}">LIVE</text>`
    : '';
  const body = `<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="16" fill="${t.panel}" stroke="${t.line}"/>
<g fill="${t.line}">${perfs}</g>
<line x1="0" y1="32" x2="${W}" y2="32" stroke="${t.line}"/>
<text class="mono" x="28" y="56" font-size="12" letter-spacing="2" fill="${t.muted}">CLIP ${String(index + 1).padStart(2, '0')}</text>
${lang}
<text x="28" y="96" font-size="26" font-weight="700" fill="${t.text}">${esc(p.name)}</text>
${lines}
<text class="mono" x="28" y="195" font-size="12" fill="${t.muted}">${esc(meta)}</text>
${live}`;
  return svg(W, H, `${p.name}: ${p.description}`, body,
    '.blink { animation: blink 1.4s steps(1) infinite; } @keyframes blink { 50% { opacity: .2; } }');
}

// ---------------------------------------------------------------- timeline

function stats(days, projects) {
  let longest = 0, run = 0;
  for (const d of days) { run = d.count ? run + 1 : 0; longest = Math.max(longest, run); }
  let current = 0;
  const back = [...days].reverse();
  if (back[0] && !back[0].count) back.shift(); // today may still be empty
  for (const d of back) { if (!d.count) break; current++; }

  const bytes = {};
  for (const p of projects) for (const [lang, n] of Object.entries(p.languages)) bytes[lang] = (bytes[lang] ?? 0) + n;
  const total = Object.values(bytes).reduce((a, b) => a + b, 0) || 1;
  const languages = Object.entries(bytes).sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, share: n / total }));

  return {
    contributions: days.reduce((n, d) => n + d.count, 0),
    activeDays: days.filter((d) => d.count).length,
    longest, current, languages,
  };
}

function timeline(t, days, s, repoCount) {
  const W = 1200, H = 300, x0 = 150, x1 = 1150;

  // Group days into Sunday-based weeks, like GitHub's own calendar.
  const first = new Date(days[0].date + 'T00:00:00Z');
  const start = first.getTime() - first.getUTCDay() * 864e5;
  const weeks = [];
  for (const d of days) {
    const i = Math.floor((new Date(d.date + 'T00:00:00Z').getTime() - start) / (7 * 864e5));
    (weeks[i] ??= { start: new Date(start + i * 7 * 864e5), count: 0 }).count += d.count;
  }
  const ww = (x1 - x0) / weeks.length;
  const max = Math.max(1, ...weeks.map((w) => w?.count ?? 0));

  const months = [];
  weeks.forEach((w, i) => {
    const prev = weeks[i - 1];
    if (i && prev && w.start.getUTCMonth() === prev.start.getUTCMonth()) return;
    months.push({ x: x0 + i * ww, label: w.start.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }).slice(0, 3).toUpperCase() });
  });
  if (months.length > 1 && months[1].x - months[0].x < 40) months.shift(); // a partial first month has no room
  const ruler = months.map(({ x, label }) => `<line x1="${x}" y1="98" x2="${x}" y2="108" stroke="${t.muted}"/>
<text class="mono" x="${x + 4}" y="94" font-size="11" fill="${t.muted}">${label}</text>`).join('');

  const clips = weeks.map((w, i) => {
    if (!w?.count) return '';
    const level = Math.min(3, Math.floor((w.count / max) * 4));
    return `<rect x="${(x0 + i * ww + 1).toFixed(1)}" y="122" width="${(ww - 2).toFixed(1)}" height="40" rx="4" fill="${t.heat[level]}"><title>${w.count} contribution${w.count === 1 ? '' : 's'}, week of ${w.start.toISOString().slice(0, 10)}</title></rect>`;
  }).join('');

  let lx = x0;
  const langs = s.languages.map(({ name, share }) => {
    const w = (x1 - x0) * share, x = lx;
    lx += w;
    const color = languageColors[name] ?? t.steel;
    const label = w > 110 ? `<text class="mono" x="${x + 10}" y="196" font-size="12" font-weight="700" fill="${isLight(color) ? '#161a2b' : '#ffffff'}">${esc(name)} ${Math.round(share * 100)}%</text>` : '';
    return `<rect x="${(x + 1).toFixed(1)}" y="176" width="${Math.max(0, w - 2).toFixed(1)}" height="30" rx="4" fill="${color}" fill-opacity=".9"><title>${esc(name)} ${(share * 100).toFixed(1)}%</title></rect>${label}`;
  }).join('');

  const track = (y, h, label) => `<rect x="40" y="${y}" width="96" height="${h}" rx="6" fill="${t.panel}" stroke="${t.line}"/>
<text class="mono" x="54" y="${y + h / 2 + 4}" font-size="11" letter-spacing="1" fill="${t.muted}">${label}</text>
<rect x="${x0}" y="${y}" width="${x1 - x0}" height="${h}" rx="4" fill="${t.panel}"/>`;

  const figures = [
    [s.contributions, 'contributions'],
    [s.activeDays, 'active days'],
    [`${s.longest}d`, 'longest streak'],
    [`${s.current}d`, 'current streak'],
    [repoCount, 'public projects'],
  ].map(([value, label], i) => {
    const x = 40 + i * 230;
    return `<text x="${x}" y="262" font-size="24" font-weight="800" fill="${t.text}">${value}</text>
<text class="mono" x="${x}" y="282" font-size="11" letter-spacing="1" fill="${t.muted}">${label.toUpperCase()}</text>`;
  }).join('');

  const body = `<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="18" fill="${t.bg}" stroke="${t.line}"/>
<text class="mono" x="40" y="50" font-size="13" letter-spacing="3" fill="${t.muted}">TIMELINE · LAST 12 MONTHS</text>
<text class="mono" x="${x1}" y="50" font-size="13" text-anchor="end" fill="${t.muted}">V1 commits · A1 languages</text>
${ruler}
${track(122, 40, 'V1 CODE')}${clips}
${track(176, 30, 'A1 LANG')}${langs}
<path d="M${x1 - 7} 98h14l-7 9z" fill="${t.rec}"/><line x1="${x1}" y1="104" x2="${x1}" y2="214" stroke="${t.rec}" stroke-width="2"/>
<line x1="40" y1="228" x2="${W - 40}" y2="228" stroke="${t.line}"/>
${figures}`;
  return svg(W, H, `${s.contributions} contributions in the last 12 months`, body);
}

// ---------------------------------------------------------------- readme

const picture = (base, alt, width, attrs = '') => `<picture>
  <source media="(prefers-color-scheme: dark)" srcset="${base}-dark.svg">
  <img src="${base}-light.svg" alt="${esc(alt)}" width="${width}"${attrs}>
</picture>`;

function projectsMarkdown(projects) {
  const cards = projects.map((p) =>
    `<a href="${p.url}">${picture(`assets/projects/${p.name}`, `${p.name}: ${p.description}`, '49%')}</a>`);
  const demos = projects.filter((p) => p.demo).map((p) => `<a href="${p.demo}">${esc(p.name)}</a>`);
  return `<p align="center">\n${cards.join('\n')}\n</p>\n`
    + (demos.length ? `\n<p align="center"><b>Live demos:</b> ${demos.join(' · ')}</p>\n` : '');
}

function replaceBlock(readme, name, content) {
  const re = new RegExp(`(<!-- ${name}:start -->)[\\s\\S]*?(<!-- ${name}:end -->)`);
  if (!re.test(readme)) throw new Error(`README.md has no ${name}:start/end markers`);
  return readme.replace(re, `$1\n${content}$2`);
}

// ---------------------------------------------------------------- main

const [projects, days] = await Promise.all([loadProjects(), loadCalendar()]);
const s = stats(days, projects);

await mkdir(new URL('assets/projects/', root), { recursive: true });
const write = (path, data) => writeFile(new URL(path, root), data);
for (const [mode, t] of Object.entries(themes)) {
  await write(`assets/header-${mode}.svg`, header(t));
  await write(`assets/kit-${mode}.svg`, kit(t));
  await write(`assets/timeline-${mode}.svg`, timeline(t, days, s, projects.length));
  for (const [i, p] of projects.entries()) await write(`assets/projects/${p.name}-${mode}.svg`, card(t, p, i));
}

const readmeUrl = new URL('README.md', root);
await writeFile(readmeUrl, replaceBlock(await readFile(readmeUrl, 'utf8'), 'projects', projectsMarkdown(projects)));

console.log(`${projects.length} projects, ${s.contributions} contributions in ${days.length} days, ${s.languages.length} languages`);
