// Read-only dashboard: listens to Firestore and renders. It never signs in, and
// firestore.rules only let the kiosk account write, so nobody can interact
// with the pets from here.
import { renderPet, MOOD_LABEL } from '/shared/pets.js';
import { confetti } from '/shared/confetti.js';
import { PETS, ACTIONS } from '/shared/rules.js';
import { listenState } from '/shared/data.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => Number(n).toLocaleString();

let config;
let state;
let prev = null;
const celebrating = new Set();
const seenFeed = new Set();
const drawnMood = {};

// ---------- Pet cards ----------
function buildCards() {
  $('pets').innerHTML = Object.values(config.pets).map((p) => `
    <article class="pet-card ${p.id}" id="card-${p.id}">
      <div class="art" id="art-${p.id}"></div>
      <div class="head">
        <h3>${esc(p.name)}</h3>
        <p>the ${esc(p.major)} ${esc(p.species)}</p>
        <div class="meter-row"><span>Happiness · <strong id="mood-${p.id}"></strong></span><strong class="num" id="hp-${p.id}"></strong></div>
        <div class="meter happy"><i id="hpbar-${p.id}"></i></div>
        <div class="meter-row"><span>Level <strong class="num" id="lv-${p.id}"></strong></span><span class="num" id="xp-${p.id}"></span></div>
        <div class="meter xp"><i id="xpbar-${p.id}"></i></div>
      </div>
      <div class="tiles">
        <div class="tile"><b class="num" id="pts-${p.id}">0</b><span>points all-time</span></div>
        <div class="tile"><b class="num" id="ptsd-${p.id}">0</b><span>points today</span></div>
        <div class="tile"><b class="num" id="vis-${p.id}">0</b><span>students today</span></div>
        <div class="tile"><b class="num" id="int-${p.id}">0</b><span>interactions today</span></div>
      </div>
      <table class="acts">
        <thead><tr><th scope="col">Interaction</th><th scope="col">Today</th><th scope="col">All-time</th><th scope="col">Pts each</th></tr></thead>
        <tbody>${Object.entries(config.actions).map(([id, a]) => `
          <tr id="row-${p.id}-${id}">
            <td>${a.emoji} ${esc(a.label)}<span class="tier">${a.tier}</span></td>
            <td class="today num"><b id="c-${p.id}-${id}-today">0</b></td>
            <td class="num" id="c-${p.id}-${id}-total">0</td>
            <td class="num">+${a.points}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </article>`).join('');
}

function setNum(id, value, bump) {
  const el = $(id);
  const text = fmt(value);
  if (el.textContent === text) return;
  el.textContent = text;
  if (bump) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
}

function drawArt(petId) {
  const p = state.pets[petId];
  const key = `${p.mood}|${celebrating.has(petId)}`;
  if (drawnMood[petId] === key) return;
  drawnMood[petId] = key;
  $(`art-${petId}`).innerHTML = renderPet(petId, p.mood, { celebrate: celebrating.has(petId) });
}

function renderPets() {
  for (const p of Object.values(state.pets)) {
    const was = prev?.pets[p.id];
    const bump = !!was;
    drawArt(p.id);
    $(`mood-${p.id}`).textContent = celebrating.has(p.id) ? 'Celebrating!' : MOOD_LABEL[p.mood];
    $(`hp-${p.id}`).textContent = `${Math.round(p.happiness)}%`;
    const hpbar = $(`hpbar-${p.id}`);
    hpbar.style.width = `${p.happiness}%`;
    hpbar.style.setProperty('--full', `${hpbar.parentElement.clientWidth}px`);
    $(`lv-${p.id}`).textContent = p.level.level;
    $(`xp-${p.id}`).textContent = `${fmt(p.points - p.level.floor)} / ${fmt(p.level.next - p.level.floor)} to Lv ${p.level.level + 1}`;
    $(`xpbar-${p.id}`).style.width = `${p.level.progress * 100}%`;
    setNum(`pts-${p.id}`, p.points, bump);
    setNum(`ptsd-${p.id}`, p.pointsToday, bump);
    setNum(`vis-${p.id}`, p.visitorsToday, bump);
    setNum(`int-${p.id}`, p.interactionsToday, bump);
    for (const [id, c] of Object.entries(p.actions)) {
      setNum(`c-${p.id}-${id}-today`, c.today, false);
      setNum(`c-${p.id}-${id}-total`, c.total, false);
      if (was && was.actions[id].total < c.total) {
        const row = $(`row-${p.id}-${id}`);
        row.classList.remove('flash'); void row.offsetWidth; row.classList.add('flash');
      }
    }
  }
}

function renderRivalry() {
  const { cs, ds } = state.pets;
  $('r-cs').textContent = `${cs.name} ${fmt(cs.pointsToday)}`;
  $('r-ds').textContent = `${fmt(ds.pointsToday)} ${ds.name}`;
  const total = cs.pointsToday + ds.pointsToday;
  $('r-cs-bar').style.flexGrow = total ? cs.pointsToday : 1;
  $('r-ds-bar').style.flexGrow = total ? ds.pointsToday : 1;
}

// ---------- Weekly chart (grouped bars, one axis) ----------
function niceMax(v) {
  if (v <= 0) return 50;
  const step = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / step) * step;
}
function barPath(x, y, w, h, r = 4) {
  if (h <= 0) return '';
  r = Math.min(r, w / 2, h);
  return `M${x} ${y + h}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h}Z`;
}
const dayLabel = (d, today) => (d === today ? 'Today'
  : new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' }));

function renderChart() {
  const el = $('week-chart');
  const W = el.clientWidth || 600;
  const H = el.clientHeight || 230;
  const m = { t: 18, r: 4, b: 24, l: 36 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const days = state.pets.cs.week.map((w, i) => ({ day: w.day, cs: w.points, ds: state.pets.ds.week[i].points }));
  const max = niceMax(Math.max(...days.flatMap((d) => [d.cs, d.ds])));
  const y = (v) => m.t + ih - (v / max) * ih;
  const band = iw / days.length;
  const bw = Math.min(28, (band * 0.62 - 2) / 2);

  const ticks = [0, max / 2, max];
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Points per day for the last 7 days, CS vs DS">`;
  svg += `<g class="grid">${ticks.map((t) => `<line x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}"/>`).join('')}</g>`;
  svg += `<g class="axis">${ticks.map((t) => `<text x="${m.l - 8}" y="${y(t) + 4}" text-anchor="end">${fmt(t)}</text>`).join('')}</g>`;
  days.forEach((d, i) => {
    const cx = m.l + band * i + band / 2;
    const isToday = d.day === state.today;
    svg += `<path class="bar-cs" d="${barPath(cx - bw - 1, y(d.cs), bw, m.t + ih - y(d.cs))}"/>`;
    svg += `<path class="bar-ds" d="${barPath(cx + 1, y(d.ds), bw, m.t + ih - y(d.ds))}"/>`;
    if (isToday) {
      // Direct labels only on today's bars.
      if (d.cs) svg += `<text class="val" x="${cx - bw / 2 - 1}" y="${y(d.cs) - 5}" text-anchor="middle">${fmt(d.cs)}</text>`;
      if (d.ds) svg += `<text class="val" x="${cx + bw / 2 + 1}" y="${y(d.ds) - 5}" text-anchor="middle">${fmt(d.ds)}</text>`;
    }
    svg += `<text class="axis" x="${cx}" y="${H - 6}" text-anchor="middle" style="fill:var(--muted);font-size:11px;${isToday ? 'font-weight:700;fill:var(--text-2)' : ''}">${dayLabel(d.day, state.today)}</text>`;
    svg += `<rect class="hit" data-i="${i}" x="${m.l + band * i}" y="${m.t}" width="${band}" height="${ih}"/>`;
  });
  svg += '</svg>';
  el.innerHTML = svg;

  const tip = $('tooltip');
  el.querySelectorAll('.hit').forEach((r) => {
    r.addEventListener('mousemove', (e) => {
      const d = days[r.dataset.i];
      const date = new Date(`${d.day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
      tip.innerHTML = `<div class="t-h">${date}</div>
        <div class="t-r"><span><i class="sw cs"></i>Byte · CS</span><b>${fmt(d.cs)} pts</b></div>
        <div class="t-r"><span><i class="sw ds"></i>Sigma · DS</span><b>${fmt(d.ds)} pts</b></div>`;
      tip.hidden = false;
      const x = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8);
      tip.style.left = `${x}px`;
      tip.style.top = `${e.clientY - tip.offsetHeight - 12}px`;
    });
    r.addEventListener('mouseleave', () => { tip.hidden = true; });
  });

  $('week-table').innerHTML = `<thead><tr><th>Day</th><th>Byte · CS</th><th>Sigma · DS</th></tr></thead><tbody>${
    days.map((d) => `<tr><td>${d.day}</td><td>${fmt(d.cs)}</td><td>${fmt(d.ds)}</td></tr>`).join('')}</tbody>`;
}

// ---------- Activity feed ----------
function ago(ms) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
function renderFeed() {
  const items = state.recent.slice(0, 10);
  if (!items.length) {
    $('feed').innerHTML = '<li><span></span><span class="empty">No activity yet — go tap in at a kiosk!</span><span></span></li>';
    return;
  }
  $('feed').innerHTML = items.map((e) => {
    const a = config.actions[e.action] || { emoji: '✨', label: e.action };
    const pet = config.pets[e.pet];
    const isNew = prev && !seenFeed.has(e.id);
    seenFeed.add(e.id);
    return `<li class="${isNew ? 'new' : ''}">
      <span class="dot ${e.pet}" aria-label="${pet.short}"></span>
      <span class="what"><b>${esc(e.who)}</b> ${a.emoji} ${esc(a.label.charAt(0).toLowerCase() + a.label.slice(1))} <span style="color:var(--muted)">for ${esc(pet.name)}</span></span>
      <span class="meta"><strong>+${e.points}</strong>${ago(e.at)}</span>
    </li>`;
  }).join('');
}

// ---------- Celebrations ----------
let bannerTimer;
function celebrate({ pet, action, who }) {
  const a = config.actions[action];
  celebrating.add(pet);
  const card = $(`card-${pet}`);
  card.classList.remove('party'); void card.offsetWidth; card.classList.add('party');
  if (state) { drawArt(pet); renderPets(); }
  const r = $(`art-${pet}`).getBoundingClientRect();
  confetti({ origin: { x: r.left + r.width / 2, y: r.top + r.height / 2 } });
  $('banner').textContent = `${a.emoji} ${who} ${a.label.toLowerCase()} for ${config.pets[pet].name}! +${a.points}`;
  $('banner').hidden = false;
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { $('banner').hidden = true; }, 6000);
  setTimeout(() => { celebrating.delete(pet); if (state) renderPets(); }, 6500);
}

// ---------- Wiring ----------
function render() {
  renderPets();
  renderRivalry();
  renderChart();
  renderFeed();
  $('today').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  prev = state;
}

function connect() {
  const live = $('live');
  const setLive = (on, text) => { live.classList.toggle('on', on); live.querySelector('span').textContent = text; };
  listenState((s) => { state = s; setLive(true, 'Live'); render(); }, {
    onEvent: (e) => { if (ACTIONS[e.action]?.celebrate) celebrate({ pet: e.pet, action: e.action, who: e.who }); },
    onError: () => setLive(false, 'Connection problem'),
  });
  addEventListener('offline', () => setLive(false, 'Offline'));
  addEventListener('online', () => state && setLive(true, 'Live'));
}

addEventListener('resize', () => state && renderChart());
setInterval(() => state && renderFeed(), 30_000);

config = { pets: PETS, actions: ACTIONS };
buildCards();
connect();
