import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import {
  LAYERS, HAZARDS, DISASTER_MAIN, DISASTER_OTHER, DISASTER_TABLE, DISASTER_LABEL_FULL,
  OFFICIAL_BOSAI_URL, CC_URL, CITY_HALL,
} from './layers.js';
import { iconImageData, iconDataUrl } from './icons.js';
import { distanceM, formatDistance, bearingLabel, geocode } from './geo.js';

const $ = (id) => document.getElementById(id);
const numFmt = new Intl.NumberFormat('ja-JP');

const state = {
  features: {}, // layerId -> Feature[]
  visible: Object.fromEntries(LAYERS.map((l) => [l.id, l.on])),
  pin: null, // [lon, lat]
  marker: null,
  popup: null,
  manifest: {},
  selected: new Set(), // 選択中の災害種別キー
  mode: 'and', // 'and' | 'or'
  includeCond: true,
};
const layerById = Object.fromEntries(LAYERS.map((l) => [l.id, l]));
const byId = {}; // feature id -> { layerId, feature }

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.entries(props).forEach(([k, v]) => {
    if (k === 'class') node.className = v;
    else node.setAttribute(k, v);
  });
  children.flat().forEach((c) => node.append(c));
  return node;
}

// ---------- 災害種別の判定 ----------
const STATUS_LABEL = {
  yes: '対応あり',
  cond: '階数・場所の条件つきで対応',
  unknown: '不明',
  nodata: 'データなし',
};
const DISASTER_NAME = Object.fromEntries(
  [...DISASTER_MAIN, ...DISASTER_OTHER, ...DISASTER_TABLE].map((d) => [d.key, DISASTER_LABEL_FULL[d.key] || d.label]),
);

function meets(props, key) {
  const s = props.dz?.[key]?.[0];
  return s === 'yes' || (s === 'cond' && state.includeCond);
}

function matchesFilter(props) {
  if (state.selected.size === 0) return true;
  if (!props.dz) return false; // 災害種別の情報がないもの
  const keys = [...state.selected];
  return state.mode === 'and' ? keys.every((k) => meets(props, k)) : keys.some((k) => meets(props, k));
}

const filterActive = () => state.selected.size > 0;

function shelterMatches() {
  return state.features.shelter.filter((f) => matchesFilter(f.properties));
}

function selectedLabel() {
  const names = [...state.selected].map((k) => DISASTER_NAME[k]);
  return names.join(state.mode === 'and' ? '・' : ' または ');
}

// ---------- 地図 ----------
const map = new maplibregl.Map({
  container: 'map',
  center: CITY_HALL,
  zoom: 12,
  minZoom: 8,
  maxZoom: 18,
  attributionControl: { compact: true },
  style: {
    version: 8,
    sources: {
      gsi: {
        type: 'raster',
        tiles: ['https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png'],
        tileSize: 256,
        minzoom: 5,
        maxzoom: 18,
        attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener noreferrer">地理院タイル</a>（国土地理院）',
      },
    },
    layers: [{ id: 'gsi', type: 'raster', source: 'gsi' }],
  },
});
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

function addHazardLayers() {
  HAZARDS.forEach((h) => {
    map.addSource(`hz-${h.id}`, {
      type: 'raster', tiles: [h.url], tileSize: 256, minzoom: 2, maxzoom: 17,
      attribution: '<a href="https://disaportal.gsi.go.jp/" target="_blank" rel="noopener noreferrer">ハザードマップポータルサイト</a>（国土地理院）',
    });
    map.addLayer({
      id: `hz-${h.id}`, type: 'raster', source: `hz-${h.id}`,
      paint: { 'raster-opacity': 0.6 },
      layout: { visibility: h.on ? 'visible' : 'none' },
    });
  });
}

function setHazard(id, on) {
  if (map.getLayer(`hz-${id}`)) map.setLayoutProperty(`hz-${id}`, 'visibility', on ? 'visible' : 'none');
  // 二つの画面の部品（絞り込み欄と表示の切替）を同期する
  [`hz-${id}`, `hzt-${id}`].forEach((cid) => { if ($(cid)) $(cid).checked = on; });
}

async function fetchData() {
  const get = (name) => fetch(`data/${name}`).then((r) => {
    if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
    return r.json();
  });
  state.manifest = await get('manifest.json');
  const collections = await Promise.all(LAYERS.map((l) => get(`${l.id}.geojson`)));
  LAYERS.forEach((l, i) => {
    state.features[l.id] = collections[i].features;
    collections[i].features.forEach((f) => { byId[f.properties.id] = { layerId: l.id, feature: f }; });
  });
  return collections;
}

function addPointLayers(collections) {
  // 点の多いレイヤー（公園）を先に追加して、他のアイコンの下に描く
  const order = LAYERS.map((l, i) => ({ l, fc: collections[i] }))
    .sort((a, b) => Number(Boolean(b.l.minzoom)) - Number(Boolean(a.l.minzoom)));
  order.forEach(({ l, fc }) => {
    const k = l.minzoom ? 0.7 : 1;
    map.addSource(`pt-${l.id}`, { type: 'geojson', data: fc });
    map.addLayer({
      id: `pt-${l.id}`, type: 'symbol', source: `pt-${l.id}`,
      ...(l.minzoom ? { minzoom: l.minzoom } : {}),
      layout: {
        'icon-image': l.id === 'shelter'
          ? ['case', ['get', 'unavailable'], 'icon-shelter-off', 'icon-shelter']
          : `icon-${l.id}`,
        'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.6 * k, 13, 0.95 * k, 16, 1.25 * k],
        'icon-allow-overlap': true,
        visibility: state.visible[l.id] ? 'visible' : 'none',
      },
    });
  });
}

function applyFilterToMap() {
  if (!state.mapReady) return;
  if (filterActive()) {
    const ids = shelterMatches().map((f) => f.properties.id);
    map.setFilter('pt-shelter', ['in', ['get', 'id'], ['literal', ids]]);
  } else {
    map.setFilter('pt-shelter', null);
  }
  // 災害種別の情報がない「(A)未収録」は、絞り込み中は表示しない
  const unlistedOn = state.visible.unlisted && !filterActive();
  map.setLayoutProperty('pt-unlisted', 'visibility', unlistedOn ? 'visible' : 'none');
}

function setLayerVisible(id, on) {
  state.visible[id] = on;
  if (id === 'unlisted') applyFilterToMap();
  else if (state.mapReady) map.setLayoutProperty(`pt-${id}`, 'visibility', on ? 'visible' : 'none');
  renderNearby();
}

// ---------- ポップアップ ----------
function badge(text, cls = '') {
  return el('span', { class: `badge ${cls}` }, text);
}

function disasterBadges(props) {
  const out = [];
  if (props.aux) out.push(badge('補助避難所', 'badge-aux'));
  if (props.unavailable) out.push(badge('現在使用不可', 'badge-off'));
  if (props.unlisted) out.push(badge('(A)未収録', 'badge-unlisted'));
  return out;
}

function disasterTable(props) {
  const table = el('table', { class: 'dz-table' });
  table.append(el('caption', {}, '災害種別ごとの対応表記（市の公開データに基づく参考情報）'));
  table.append(el('thead', {}, el('tr', {},
    el('th', { scope: 'col' }, '災害'), el('th', { scope: 'col' }, '整理した表記'), el('th', { scope: 'col' }, '元の値'))));
  const body = el('tbody');
  DISASTER_TABLE.forEach((d) => {
    const [status, raw] = props.dz[d.key];
    const cell = el('td', {}, STATUS_LABEL[status]);
    if (status === 'cond') cell.append(' ', badge(raw, 'badge-cond'));
    const hit = state.selected.has(d.key);
    body.append(el('tr', hit ? { class: 'dz-hit' } : {},
      el('th', { scope: 'row' }, DISASTER_NAME[d.key]), cell, el('td', {}, raw === '' ? '（空欄）' : raw)));
  });
  table.append(body);
  return table;
}

function popupContent(layerId, feature) {
  const p = feature.properties;
  const layer = layerById[layerId];
  const root = el('div', { class: 'popup' });
  root.append(el('p', { class: 'popup-cat' }, p.sub || layer.short));
  root.append(el('h3', { class: 'popup-title' }, p.name || '(名称なし)'));
  const badges = disasterBadges(p);
  if (badges.length) root.append(el('p', { class: 'badges' }, badges));
  const rows = [];
  if (state.pin) {
    const here = feature.geometry.coordinates;
    rows.push(['ピンから', `${formatDistance(distanceM(state.pin, here))}（${bearingLabel(state.pin, here)}）`]);
  }
  if (p.address) rows.push(['住所', p.address]);
  if (p.ward) rows.push(['区', p.ward]);
  if (p.cap_text) {
    rows.push(['想定収容人数', p.cap_num != null ? `${numFmt.format(p.cap_num)}人（元の記載: ${p.cap_text}）` : p.cap_text]);
  }
  if (p.dup) rows.push(['指定避難所', '指定避難所と重複（元データ）']);
  if (p.place) rows.push(['避難できる場所', `${p.place}（元データ）`]);
  if (p.capacity) rows.push(['収容人数', `${p.capacity}（元データ）`]);
  if (p.note) rows.push(['備考', p.note]);
  const dl = el('dl', { class: 'popup-dl' });
  rows.forEach(([k, v]) => dl.append(el('dt', {}, k), el('dd', {}, String(v))));
  root.append(dl);
  if (p.dz) root.append(disasterTable(p));
  if (p.tsunami_bldg) {
    root.append(el('p', { class: 'popup-warn' },
      `津波避難ビルのデータにも掲載（避難できる場所: ${p.tsunami_bldg.place || '記載なし'}／収容人数: ${p.tsunami_bldg.capacity || '記載なし'}）。`));
  }
  if (p.phone && p.phone.trim()) {
    root.append(el('a', { href: `tel:${p.phone.replace(/[^0-9+]/g, '')}`, class: 'popup-link' }, `電話 ${p.phone}`));
  }
  if (p.url) {
    root.append(el('a', { href: p.url, target: '_blank', rel: 'noopener noreferrer', class: 'popup-link' }, '詳細ページ（外部サイト）'));
  }
  if (['shelter', 'unlisted', 'tsunami'].includes(layerId)) {
    root.append(el('p', { class: 'popup-warn' },
      '使用できるかどうかは災害の種類や状況で変わります。避難時は新潟市の避難情報・公式ハザードマップを確認してください。'));
  }
  if (layerId === 'unlisted') {
    root.append(el('p', { class: 'popup-warn' },
      '指定緊急避難場所一覧に見当たらない施設です。災害種別の対応表記はありません。'));
  }
  return root;
}

function openPopup(layerId, feature, sameSpot = []) {
  state.popup?.remove();
  let content = popupContent(layerId, feature);
  if (sameSpot.length > 1) {
    content = el('div', { class: 'popup-multi' },
      el('p', { class: 'popup-count' }, `この場所に ${sameSpot.length} 件あります`),
      ...sameSpot.map((s) => popupContent(s.layerId, s.feature)));
  }
  state.popup = new maplibregl.Popup({ maxWidth: '340px', offset: 12 })
    .setLngLat(feature.geometry.coordinates)
    .setDOMContent(content)
    .addTo(map);
}

function focusFeature(layerId, feature) {
  const z = Math.max(map.getZoom(), 15.5);
  map.flyTo({ center: feature.geometry.coordinates, zoom: z, speed: 1.6 });
  openPopup(layerId, feature);
  if (isMobile()) selectTab('map');
}

function bindMapClicks() {
  const ids = LAYERS.map((l) => `pt-${l.id}`);
  map.on('click', (e) => {
    const hits = map.queryRenderedFeatures(
      [[e.point.x - 10, e.point.y - 10], [e.point.x + 10, e.point.y + 10]], { layers: ids });
    const items = [];
    const seen = new Set();
    hits.forEach((h) => {
      const id = h.properties.id;
      if (seen.has(id) || !byId[id]) return;
      seen.add(id);
      items.push({ layerId: byId[id].layerId, feature: byId[id].feature });
    });
    if (items.length) openPopup(items[0].layerId, items[0].feature, items.slice(0, 6));
  });
  ids.forEach((id) => {
    map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; });
  });
}

// ---------- ピン ----------
function setPin(lonlat, label = '') {
  state.pin = lonlat;
  if (!state.marker) {
    const node = el('div', { class: 'pin', 'aria-hidden': 'true' });
    node.innerHTML = '<svg width="36" height="46" viewBox="0 0 36 46"><path d="M18 45C18 45 3 28 3 17a15 15 0 0 1 30 0c0 11-15 28-15 28z" fill="#0b4f8a" stroke="#fff" stroke-width="3"/><circle cx="18" cy="17" r="6" fill="#fff"/></svg>';
    node.append(el('span', { class: 'pin-label' }, '調べる場所'));
    state.marker = new maplibregl.Marker({ element: node, anchor: 'bottom' });
  }
  state.marker.setLngLat(lonlat).addTo(map);
  map.flyTo({ center: lonlat, zoom: Math.max(map.getZoom(), 14.5), speed: 1.6 });
  if (label) $('search-status').textContent = `「${label}」付近にピンを置きました。`;
  renderNearby();
}

// ---------- うちの近く ----------
const MAX_LIST = 40;

function listItem(layerId, feature, dist, meta) {
  const p = feature.properties;
  const layer = layerById[layerId];
  const img = el('img', { src: iconDataUrl(layer), width: '36', height: '36', alt: '' });
  const main = el('span', { class: 'nearby-name' }, p.name || '(名称なし)');
  const metaText = [p.sub || layer.short, meta].filter(Boolean).join('・');
  const text = el('span', { class: 'nearby-text' }, main, el('span', { class: 'nearby-meta' }, metaText));
  const chips = disasterBadges(p);
  if (filterActive() && p.dz) {
    // 階数条件があれば、選んだ災害の分だけバッジで示す
    [...state.selected].forEach((k) => {
      const [st, raw] = p.dz[k];
      if (st === 'cond') chips.push(badge(`${DISASTER_NAME[k]}: ${raw}`, 'badge-cond'));
    });
  }
  if (chips.length) text.append(el('span', { class: 'badges' }, chips));
  const btn = el('button', { type: 'button', class: 'nearby-item' }, img, text,
    el('span', { class: 'nearby-dist' }, `${formatDistance(dist)} ${bearingLabel(state.pin, feature.geometry.coordinates)}`));
  btn.addEventListener('click', () => focusFeature(layerId, feature));
  return el('li', {}, btn);
}

function renderNearby() {
  const summary = $('nearby-summary');
  const nearestList = $('nearest-list');
  const list = $('nearby-list');
  nearestList.replaceChildren();
  list.replaceChildren();
  $('nearest-title').hidden = true;
  $('nearby-title').hidden = true;
  if (!state.pin) {
    summary.textContent = '住所を検索するか「現在地」を押すと、近くの施設が距離順に表示されます。';
    return;
  }
  const radius = Number($('radius').value);

  // 条件に合う最も近い避難場所（現在使用不可は除く。半径に関係なく上位5件）
  const nearest = shelterMatches()
    .filter((f) => !f.properties.unavailable)
    .map((f) => ({ f, d: distanceM(state.pin, f.geometry.coordinates) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 5);
  $('nearest-title').hidden = false;
  if (nearest.length === 0) {
    nearestList.append(el('li', { class: 'nearby-more' },
      '条件に合う避難場所がデータにありません。災害の種類や条件を変えてみてください。'));
  } else {
    nearest.forEach(({ f, d }) => nearestList.append(listItem('shelter', f, d, f.properties.ward)));
  }

  // 近くの施設（表示中のレイヤー、半径内、距離順）
  const items = [];
  LAYERS.filter((l) => l.nearby && state.visible[l.id]).forEach((l) => {
    if (l.id === 'unlisted' && filterActive()) return;
    state.features[l.id].forEach((f) => {
      if (l.id === 'shelter' && !matchesFilter(f.properties)) return;
      const d = distanceM(state.pin, f.geometry.coordinates);
      if (d <= radius) items.push({ l, f, d });
    });
  });
  items.sort((a, b) => a.d - b.d);
  $('nearby-title').hidden = false;
  summary.textContent = `ピンから${radius >= 1000 ? `${radius / 1000}km` : `${radius}m`}以内に ${items.length} 件`
    + (filterActive() ? `（避難場所は「${selectedLabel()}」で絞り込み中）` : '') + '。距離は直線距離です。';
  items.slice(0, MAX_LIST).forEach(({ l, f, d }) => list.append(listItem(l.id, f, d, f.properties.ward)));
  if (items.length > MAX_LIST) {
    list.append(el('li', { class: 'nearby-more' }, `ほか ${items.length - MAX_LIST} 件（範囲を狭めると絞り込めます）`));
  }
}

// ---------- 災害種別フィルタの画面 ----------
function buildChips() {
  const make = (d) => {
    const input = el('input', { type: 'checkbox', id: `chip-${d.key}`, class: 'chip-input' });
    const label = el('label', { class: 'chip', for: `chip-${d.key}` },
      el('span', { class: 'chip-icon', 'aria-hidden': 'true' }, d.glyph), d.label);
    input.addEventListener('change', () => {
      if (input.checked) state.selected.add(d.key); else state.selected.delete(d.key);
      onFilterChanged();
    });
    return [input, label];
  };
  $('chips-main').append(...DISASTER_MAIN.flatMap(make));
  $('chips-other').append(...DISASTER_OTHER.flatMap(make));
  document.querySelectorAll('input[name="fmode"]').forEach((r) => {
    r.addEventListener('change', () => { state.mode = r.value; onFilterChanged(); });
  });
  $('inc-cond').addEventListener('change', (e) => { state.includeCond = e.target.checked; onFilterChanged(); });
}

function onFilterChanged() {
  applyFilterToMap();
  const total = state.features.shelter.length;
  const summary = $('filter-summary');
  if (!filterActive()) {
    summary.textContent = `指定緊急避難場所 ${total} 件をすべて表示しています。災害の種類を選ぶと絞り込めます。`;
  } else {
    const n = shelterMatches().length;
    const extra = state.features.unlisted.length;
    summary.textContent = n === 0
      ? '条件に合う避難場所がデータにありません。災害の種類や条件を変えてみてください。'
      : `「${selectedLabel()}」に対応する表記のある避難場所: ${n} 件（全 ${total} 件中）。`
        + `「(A)未収録」${extra} 件は情報がないため非表示です。`;
  }
  renderNearby();
  state.popup?.remove();
}

// ---------- 検索・現在地 ----------
function buildSearch() {
  const status = $('search-status');
  const results = $('search-results');
  $('search-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = $('search-input').value.trim();
    results.hidden = true;
    results.replaceChildren();
    if (!q) { status.textContent = '住所を入力してください。'; return; }
    status.textContent = '検索しています…';
    try {
      const hits = await geocode(q);
      if (!hits.length) { status.textContent = '見つかりませんでした。町名や番地を変えて試してください。'; return; }
      if (hits.length === 1) { status.textContent = ''; setPin(hits[0].lonlat, hits[0].title); return; }
      status.textContent = '候補から選んでください。';
      hits.forEach((h) => {
        const b = el('button', { type: 'button', class: 'btn choice' }, h.title);
        b.addEventListener('click', () => {
          results.hidden = true; status.textContent = ''; setPin(h.lonlat, h.title);
        });
        results.append(el('li', {}, b));
      });
      results.hidden = false;
    } catch (err) {
      status.textContent = '住所検索に失敗しました。通信状況を確認するか、地図を直接タップしてピンを置いてください。';
    }
  });
  $('locate-btn').addEventListener('click', () => {
    if (!navigator.geolocation) { status.textContent = 'この端末では現在地を取得できません。'; return; }
    status.textContent = '現在地を取得しています…';
    navigator.geolocation.getCurrentPosition(
      (pos) => { status.textContent = ''; setPin([pos.coords.longitude, pos.coords.latitude], '現在地'); },
      () => { status.textContent = '現在地を取得できませんでした。住所を入力してください。'; },
      { enableHighAccuracy: true, timeout: 10000 });
  });
  $('center-pin-btn').addEventListener('click', () => {
    const c = map.getCenter();
    setPin([c.lng, c.lat], '地図の中心');
    if (isMobile()) selectTab('nearby');
  });
  $('radius').addEventListener('change', renderNearby);
}

// ---------- UI（タブ・シート） ----------
// スマホ（幅899px以下）では「近く/表示/データ」を地図の上に重なるシートとして表示する
const mobileMq = window.matchMedia('(max-width: 899px)');
const isMobile = () => mobileMq.matches;

function placeSheets() {
  const host = $('sheet-host');
  const panel = document.querySelector('.panel');
  const footer = document.querySelector('.site-footer');
  const views = [...document.querySelectorAll('.view')];
  if (isMobile()) {
    views.forEach((v) => host.append(v));
    $('view-about').append(footer);
  } else {
    views.forEach((v) => panel.append(v));
    document.body.append(footer);
  }
  map.resize();
}

function selectTab(name) {
  document.querySelectorAll('.tab').forEach((t) => {
    const on = t.id === `tab-${name}`;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
  });
  document.querySelectorAll('.view').forEach((v) => { v.hidden = v.id !== `view-${name}`; });
}

function buildTabs() {
  const tabs = [...document.querySelectorAll('.tab')];
  tabs.forEach((t) => {
    t.addEventListener('click', () => selectTab(t.id.replace('tab-', '')));
    t.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const shown = tabs.filter((x) => x.offsetParent !== null);
      const at = shown.indexOf(t);
      const next = shown[(at + (e.key === 'ArrowRight' ? 1 : shown.length - 1)) % shown.length];
      next.focus();
      selectTab(next.id.replace('tab-', ''));
    });
  });
}

function buildLayerControls() {
  const ul = $('layer-toggles');
  LAYERS.forEach((l) => {
    const input = el('input', { type: 'checkbox', id: `lt-${l.id}` });
    input.checked = l.on;
    input.addEventListener('change', () => setLayerVisible(l.id, input.checked));
    const count = state.manifest[l.id]?.count ?? 0;
    ul.append(el('li', {}, el('label', { class: 'toggle', for: `lt-${l.id}` }, input,
      el('img', { src: iconDataUrl(l), width: '28', height: '28', alt: '' }),
      el('span', {}, l.label, el('span', { class: 'toggle-count' }, `${numFmt.format(count)}件`)))));
  });
  const hz = $('hazard-toggles');
  HAZARDS.forEach((h) => {
    const input = el('input', { type: 'checkbox', id: `hzt-${h.id}` });
    input.checked = h.on;
    input.addEventListener('change', () => setHazard(h.id, input.checked));
    hz.append(el('li', {}, el('label', { class: 'toggle', for: `hzt-${h.id}` }, input, h.label)));
    $(`hz-${h.id}`).addEventListener('change', (e) => setHazard(h.id, e.target.checked));
  });
}

function buildAbout() {
  const body = $('data-table-body');
  const credits = $('credit-list');
  const done = new Set();
  Object.entries(state.manifest).forEach(([lid, m]) => {
    if (lid.startsWith('_')) return;
    m.sources.forEach((s) => {
      if (done.has(s.file)) return;
      done.add(s.file);
      body.append(el('tr', {},
        el('td', {}, el('a', { href: s.page, target: '_blank', rel: 'noopener noreferrer' }, s.title)),
        el('td', {}, s.pageUpdated || '—'),
        el('td', {}, s.fetchedAt || '—'),
        el('td', {}, `${numFmt.format(s.rows - s.excluded)} / ${numFmt.format(s.rows)}`)));
      credits.append(el('li', {},
        `この地図サイトは以下の著作物を改変して利用しています。『${s.title}』、新潟市、`,
        el('a', { href: CC_URL, target: '_blank', rel: 'noopener noreferrer' }, 'クリエイティブ・コモンズ・ライセンス 表示 2.1 日本')));
    });
  });
  credits.append(el('li', {}, '地図・浸水想定タイル・住所検索: 国土地理院（ハザードマップポータルサイトの洪水浸水想定区域は国土交通省各地方整備局等・都道府県、津波浸水想定は都道府県のデータ）。新潟市が作成・保証したものではありません。'));
}

function buildHowto() {
  const s = state.manifest._summary || {};
  const shelterMeta = state.manifest.shelter.sources[0];
  const body = $('howto-body');
  body.append(
    el('p', {}, '地図の避難場所は、新潟市が公開している「指定緊急避難場所一覧」（',
      `${shelterMeta.pageUpdated || '更新日不明'} 更新、${shelterMeta.fetchedAt || ''} 取得）に基づく参考情報です。`),
    el('h3', {}, '対応表記の見かた'),
    el('ul', {},
      el('li', {}, '「対応あり」: 元データの値が「○」のもの。'),
      el('li', {}, '「階数・場所の条件つきで対応」: 元データに「2階以上」「3階以上」「4階以上」「全階可」「体育館」と書かれているもの。'
        + '画面には元の文言をそのまま表示します。文言の詳しい意味は市の資料でご確認ください。'),
      el('li', {}, '「不明」: 元データの値が「×」または「－」のもの。市の説明でこれらの意味を確認できていないため、「対応なし」とは判断していません。元の値を併記します。'),
      el('li', {}, '「データなし」: 元データが空欄のもの。（高潮・内水氾濫・火山現象は全施設が空欄です）')),
    el('h3', {}, '絞り込みの使い方'),
    el('ul', {},
      el('li', {}, '複数の災害を選ぶと、既定は「選んだすべてに対応」の表記がある避難場所だけを表示します。「いずれかに対応」に切り替えられます。'),
      el('li', {}, '「階数などの条件つきも含める」を外すと、「対応あり」（○）だけに絞ります。'),
      el('li', {}, '「(A)未収録」は、屋内避難所・屋外避難場所のデータにあり、指定緊急避難場所一覧に見当たらない施設です'
        + `（${s.unlisted?.okunai?.notInShelter ?? '?'}件＋${s.unlisted?.okugai?.notInShelter ?? '?'}件）。災害種別の情報がないため、絞り込み中は表示しません。`),
      el('li', {}, '「補助避難所」「現在使用不可」は元データの名称に付いていた印です。現在使用不可の施設は「最も近い避難場所」の候補から除いています。'),
      el('li', {}, '距離は直線距離です。道のりや徒歩時間は計算していません。')),
    el('p', { class: 'popup-warn' }, 'この地図は参考情報です。避難時は必ず新潟市の公式ハザードマップ・避難情報を確認してください。',
      el('a', { href: OFFICIAL_BOSAI_URL, target: '_blank', rel: 'noopener noreferrer' }, '新潟市の防災情報（公式）')),
  );
}

// ---------- 起動 ----------
// 画面（一覧・絞り込み）は地図の描画に依存させず、データを読めた時点で組み立てる
const dataPromise = fetchData();

map.on('load', async () => {
  LAYERS.forEach((l) => map.addImage(`icon-${l.id}`, iconImageData(l)));
  map.addImage('icon-shelter-off', iconImageData({ ...layerById.shelter, color: '#767676', glyph: '休' }));
  addHazardLayers();
  try {
    addPointLayers(await dataPromise);
  } catch (e) {
    return; // 読み込み失敗は下の処理で表示する
  }
  state.mapReady = true;
  HAZARDS.forEach((h) => setHazard(h.id, $(`hz-${h.id}`)?.checked ?? h.on));
  LAYERS.forEach((l) => { if (!state.visible[l.id]) map.setLayoutProperty(`pt-${l.id}`, 'visibility', 'none'); });
  applyFilterToMap();
  bindMapClicks();
  // 施設以外の場所をタップしたとき、ピンが未設定ならそこに置く
  map.on('click', (e) => {
    const hits = map.queryRenderedFeatures(
      [[e.point.x - 10, e.point.y - 10], [e.point.x + 10, e.point.y + 10]],
      { layers: LAYERS.map((l) => `pt-${l.id}`) });
    if (!hits.length && !state.pin) setPin([e.lngLat.lng, e.lngLat.lat], '地図で指定した場所');
  });
});

dataPromise.then(() => {
  buildChips();
  buildLayerControls();
  buildAbout();
  buildHowto();
  buildTabs();
  buildSearch();
  placeSheets();
  mobileMq.addEventListener('change', placeSheets);
  $('howto-btn').addEventListener('click', () => $('howto').showModal());
  onFilterChanged();
}).catch((e) => {
  $('search-status').textContent = `データの読み込みに失敗しました（${e.message}）。再読み込みしてください。`;
});
