// 地図レイヤーの定義。色だけに頼らないよう「色＋形＋文字」で区別する。
// nearby: 「うちの近く」パネルの検索対象 / on: 初期表示 / minzoom: 点が多いため、このズーム以上で描画

export const LAYERS = [
  { id: 'shelter', label: '指定緊急避難場所', short: '避難場所', color: '#b3261e', shape: 'triangle', glyph: '避', nearby: true, on: true },
  { id: 'unlisted', label: '避難所・避難場所（指定緊急避難場所一覧に未収録）', short: '(A)未収録', color: '#7a4a00', shape: 'pentagon', glyph: '未', nearby: true, on: true },
  { id: 'tsunami', label: '津波避難ビル（指定緊急避難場所一覧に無いもの）', short: '津波避難ビル', color: '#0057b8', shape: 'invtriangle', glyph: '津', nearby: true, on: true },
  { id: 'water', label: '拠点給水所', short: '拠点給水所', color: '#00707a', shape: 'diamond', glyph: '水', nearby: true, on: true },
  { id: 'aed', label: 'AED設置施設', short: 'AED', color: '#0b6e4f', shape: 'circle', glyph: 'A', nearby: true, on: true },
  { id: 'childcare', label: '子育て施設', short: '子育て', color: '#b34700', shape: 'hexagon', glyph: '子', nearby: true, on: true },
  { id: 'community', label: '身近な施設（公民館・コミュニティセンター等・図書館）', short: '身近な施設', color: '#33415c', shape: 'square', glyph: '公', nearby: true, on: true },
  { id: 'park', label: '公園・緑地', short: '公園', color: '#2e6b2e', shape: 'star', glyph: '園', nearby: false, on: false, minzoom: 13 },
];

// 災害種別（キーは scripts/convert.py の DISASTERS と同じ）
export const DISASTER_MAIN = [
  { key: 'tsunami', label: '津波', glyph: '🌊' },
  { key: 'flood', label: '洪水', glyph: '💧' },
];
export const DISASTER_OTHER = [
  { key: 'quake', label: '地震', glyph: '〰' },
  { key: 'storm_surge', label: '高潮', glyph: '≈' },
  { key: 'inland_flood', label: '内水氾濫', glyph: '☂' },
  { key: 'landslide', label: '崖崩れ等', glyph: '⛰' },
  { key: 'fire', label: '大規模な火事', glyph: '🔥' },
];
export const DISASTER_TABLE = [
  ...DISASTER_MAIN, ...DISASTER_OTHER,
  { key: 'volcano', label: '火山現象' },
];
export const DISASTER_LABEL_FULL = {
  landslide: '崖崩れ、土石流及び地滑り',
};

// 国土地理院タイル（ハザードマップポータルサイト）。ズーム 2〜17。
const HAZARD_BASE = 'https://disaportaldata.gsi.go.jp/raster/';
export const HAZARDS = [
  { id: 'tsunami', label: '津波浸水想定', path: '04_tsunami_newlegend_data', on: false },
  { id: 'flood', label: '洪水浸水想定区域（想定最大規模）', path: '01_flood_l2_shinsuishin_data', on: false },
].map((h) => ({ ...h, url: `${HAZARD_BASE}${h.path}/{z}/{x}/{y}.png` }));

export const OFFICIAL_BOSAI_URL = 'https://www.city.niigata.lg.jp/kurashi/bosai/index.html';
export const CC_URL = 'https://creativecommons.org/licenses/by/2.1/jp/';
export const CITY_HALL = [139.0365502, 37.91607571]; // 国土地理院 住所検索で「新潟市役所」
