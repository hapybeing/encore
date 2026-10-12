const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (x) => (typeof x === 'number' ? `${Math.round(x * 100)}` : '–');

const TOOL_LABEL = {
  resolve_artist: 'Finding the artist in Qloo',
  taste_neighbors: 'Mapping fan overlap with other artists',
  rank_markets: 'Scoring every market by audience affinity',
  find_venues: 'Matching venues to the crowd',
  local_openers: 'Finding local openers with fan overlap',
  audience_profile: 'Reading the audience across brands, TV, podcasts, film',
  neighbourhood_hotspots: 'Locating fan hotspots inside the city',
  submit_tour_plan: 'Writing the plan',
};

let map, marketLayer, routeLayer, lastPlan, lastQuery;

function initMap() {
  if (map) return;
  map = L.map('map', { zoomControl: true, attributionControl: true, worldCopyJump: true }).setView([39, -96], 4);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap &copy; CARTO', subdomains: 'abcd', maxZoom: 18,
  }).addTo(map);
  marketLayer = L.layerGroup().addTo(map);
  routeLayer = L.layerGroup().addTo(map);
}

function log(kind, html) {
  const li = document.createElement('li');
  li.className = kind;
  const icon = { tool: '▸', res: '✓', err: '!', thought: '…', info: '·' }[kind] || '·';
  li.innerHTML = `<span class="ic">${icon}</span><span>${html}</span>`;
  $('#log').appendChild(li);
  $('#log').scrollTop = $('#log').scrollHeight;
}

function drawMarkets(markets) {
  marketLayer.clearLayers();
  const max = Math.max(...markets.map((m) => m.score || 0), 0.0001);
  const pts = [];
  markets.forEach((m, i) => {
    if (m.lat == null) return;
    const t = (m.score || 0) / max;
    L.circleMarker([m.lat, m.lng], {
      radius: 4 + t * 16, color: t > 0.75 ? '#ff4f2e' : '#f2b84b', weight: 1, fillOpacity: 0.15 + t * 0.5,
    }).bindTooltip(`#${i + 1} ${esc(m.city)} · affinity ${pct(m.score)}`).addTo(marketLayer);
    pts.push([m.lat, m.lng]);
  });
  if (pts.length) map.fitBounds(pts, { padding: [30, 30] });
  $('#map-legend').innerHTML = 'Circle size = audience affinity (Qloo heatmap)';
}

function drawRoute(stops) {
  routeLayer.clearLayers();
  const pts = stops.filter((s) => s.lat != null).map((s) => [s.lat, s.lng]);
  if (pts.length > 1) L.polyline(pts, { color: '#ff4f2e', weight: 3, opacity: 0.9, dashArray: '6 8' }).addTo(routeLayer);
  stops.forEach((s, i) => {
    if (s.lat == null) return;
    const icon = L.divIcon({ className: '', html: `<div class="pin">${i + 1}</div>`, iconSize: [28, 28], iconAnchor: [14, 14] });
    L.marker([s.lat, s.lng], { icon })
      .bindPopup(`<b>${i + 1}. ${esc(s.city)}</b><br>${esc(s.venue || '')}<br><span style="color:#9c948a">${esc(s.opener ? 'w/ ' + s.opener : '')}</span>`)
      .addTo(routeLayer);
  });
  if (pts.length) map.fitBounds(pts, { padding: [40, 40] });
}

async function run(q) {
  lastQuery = q;
  $('#go').disabled = true;
  $('#workspace').hidden = false;
  $('#result').hidden = true;
  $('#log').innerHTML = '';
  $('#pulse').classList.remove('idle');
  $('#status').textContent = 'working…';
  initMap();
  setTimeout(() => map.invalidateSize(), 50);
  marketLayer.clearLayers(); routeLayer.clearLayers();
  $('#workspace').scrollIntoView({ behavior: 'smooth', block: 'start' });
  let calls = 0;

  try {
    const res = await fetch('/api/plan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(q) });
    if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
        const line = chunk.split('\n').find((l) => l.startsWith('data: '));
        if (!line) continue;
        const ev = JSON.parse(line.slice(6));
        if (ev.type === 'tool_call') log('tool', `${esc(TOOL_LABEL[ev.name] || ev.name)}${ev.args?.city ? ` · <code>${esc(ev.args.city)}</code>` : ''}`);
        else if (ev.type === 'tool_result') log(ev.summary?.startsWith('error') ? 'err' : 'res', esc(ev.summary));
        else if (ev.type === 'qloo') { calls++; $('#status').textContent = `${calls} Qloo calls`; }
        else if (ev.type === 'thought' && ev.text.trim()) log('thought', esc(ev.text.trim().slice(0, 280)));
        else if (ev.type === 'markets') drawMarkets(ev.markets);
        else if (ev.type === 'plan') render(ev.plan, ev.trace);
        else if (ev.type === 'error') log('err', esc(ev.message));
      }
    }
  } catch (e) {
    log('err', esc(e.message));
  } finally {
    $('#go').disabled = false;
    $('#pulse').classList.add('idle');
    $('#status').textContent = `done · ${calls} Qloo calls`;
  }
}

function render(plan, trace) {
  lastPlan = plan;
  $('#result').hidden = false;
  $('#kicker').textContent = `${plan.artist?.name || lastQuery.artist} · ${plan.stops.length} stops · ${plan.region}`;
  $('#headline').textContent = plan.headline || '';
  $('#audience').textContent = plan.audience_summary || '';
  drawRoute(plan.stops);

  const list = $('#stopsList'); list.innerHTML = '';
  plan.stops.forEach((s, i) => {
    const el = $('#stopTpl').content.cloneNode(true);
    el.querySelector('.num').textContent = String(i + 1).padStart(2, '0');
    el.querySelector('.city').textContent = s.city;
    el.querySelector('.score').textContent = s.rank ? `market #${s.rank} · affinity ${pct(s.score)}` : 'market data n/a';
    el.querySelector('.why').textContent = s.why || '';
    const v = s.venue_detail;
    el.querySelector('.venue').innerHTML = `${esc(s.venue || '—')}${v?.affinity != null ? ` <span class="muted small">(crowd match ${pct(v.affinity)})</span>` : ''}`;
    el.querySelector('.opener').textContent = s.opener || '—';
    el.querySelector('.promo').textContent = s.promo || '—';
    if (s.hotspots?.length) el.querySelector('.hot').textContent = `Fan hotspots: ${s.hotspots.map((h) => h.name).filter(Boolean).slice(0, 3).join(' · ')}`;
    list.appendChild(el);
  });

  const chosen = new Set(plan.stops.map((s) => s.city.toLowerCase()));
  const max = Math.max(...plan.markets.map((m) => m.score || 0), 0.0001);
  $('#markets').innerHTML = plan.markets.map((m) => `
    <div class="bar ${chosen.has(m.city.toLowerCase()) ? 'chosen' : ''}">
      <span class="name">${esc(m.city)}</span>
      <span class="track"><span class="fill" style="width:${((m.score || 0) / max) * 100}%"></span></span>
      <span class="val">${pct(m.score)}</span>
    </div>`).join('');

  $('#skip').innerHTML = (plan.skip || []).map((x) => `<li>${esc(x)}</li>`).join('') || '<li class="muted">Nothing notable.</li>';
  $('#sponsors').innerHTML = (plan.sponsors || []).map((x) => `<li>${esc(x)}</li>`).join('');
  const p = plan.profile || {};
  const grp = (k, label) => (p[k]?.length ? `<div class="profile-group"><b>${label}</b>${p[k].slice(0, 5).map((e) => esc(e.name)).join(' · ')}</div>` : '');
  $('#profile').innerHTML = grp('brands', 'Brands') + grp('tv_shows', 'TV') + grp('podcasts', 'Podcasts') + grp('movies', 'Film') +
    (p.neighbors ? '' : '') + (plan.neighbors?.length ? `<div class="profile-group"><b>Shared fanbase with</b>${plan.neighbors.slice(0, 6).map((e) => esc(e.name)).join(' · ')}</div>` : '');

  $('#traceCount').textContent = trace.length;
  $('#trace').innerHTML = trace.map((t) => `<li><b>${esc(t.label)}</b> GET ${esc(t.path)}?${esc(Object.entries(t.params || {}).map(([k, v]) => `${k}=${v}`).join('&'))} · ${t.cached ? 'cache' : `${t.ms}ms`} · ${t.error ? 'error: ' + esc(t.error) : `${t.count} results`}</li>`).join('');
  $('#compare').innerHTML = '';
  $('#result').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function baseline() {
  if (!lastPlan) return;
  const btn = $('#baselineBtn');
  btn.disabled = true; btn.textContent = 'Asking…';
  try {
    const res = await fetch('/api/baseline', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(lastQuery) });
    const b = await res.json();
    if (b.error) throw new Error(b.error);
    const rank = new Map(lastPlan.markets.map((m, i) => [m.city.toLowerCase(), i + 1]));
    const n = lastPlan.markets.length;
    const item = (s) => {
      const r = rank.get(String(s.city || '').toLowerCase());
      const tag = r ? `<span class="tag ${r > n / 2 ? 'lowrank' : ''}">Qloo market rank ${r}/${n}</span>` : '<span class="tag">not in Qloo scan</span>';
      return `<li><b>${esc(s.city)}</b> · ${esc(s.venue || '')} ${tag}</li>`;
    };
    $('#compare').innerHTML = `
      <div><h4>Generic LLM (guessing)</h4><ol>${(b.stops || []).map(item).join('')}</ol></div>
      <div><h4 style="color:var(--hot)">Encore (Qloo-grounded)</h4><ol>${lastPlan.stops.map((s) => `<li><b>${esc(s.city)}</b> · ${esc(s.venue || '')} <span class="tag">rank ${s.rank ?? '–'}/${n}</span></li>`).join('')}</ol></div>`;
  } catch (e) {
    $('#compare').innerHTML = `<p class="muted">${esc(e.message)}</p>`;
  } finally {
    btn.disabled = false; btn.textContent = 'Ask a plain LLM the same question';
  }
}

$('#form').addEventListener('submit', (e) => {
  e.preventDefault();
  run({ artist: $('#artist').value.trim(), region: $('#region').value, stops: Number($('#stops').value) || 6 });
});
document.querySelectorAll('.examples button').forEach((b) => b.addEventListener('click', () => {
  $('#artist').value = b.dataset.artist; $('#region').value = b.dataset.region;
  $('#form').requestSubmit();
}));
$('#baselineBtn').addEventListener('click', baseline);
