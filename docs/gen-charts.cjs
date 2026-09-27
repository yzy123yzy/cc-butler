'use strict';
// 用本地真实数据生成 README 展示用 SVG 图表:
//   node docs/gen-charts.cjs   →  docs/assets/daily-trend.svg + model-share.svg
// 暗色主题与网页仪表盘一致;数据来自统计引擎(增量缓存,秒级)。
const fs = require('fs');
const path = require('path');
const { collect } = require('../plugin/scripts/lib/stats');

const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const fmt = n => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n));

const C = { bg: '#0f1115', card: '#171a21', fg: '#e6e9ef', dim: '#8b93a7', blue: '#5b9dff', blueD: '#2c3550', grid: '#232838' };

function dailyTrendSvg(days) {
  const W = 860, H = 280, padL = 60, padB = 34, padT = 40;
  const iw = W - padL - 16, ih = H - padT - padB;
  const mx = Math.max(1, ...days.map(d => d.out));
  const mxi = Math.max(1, ...days.map(d => d.in));
  const bw = Math.min(26, iw / days.length * 0.42);
  let bars = '', labels = '', grid = '';
  for (let g = 0; g <= 4; g++) {
    const y = padT + ih - ih * g / 4;
    grid += `<line x1="${padL}" y1="${y}" x2="${W - 16}" y2="${y}" stroke="${C.grid}" stroke-width="1"/>` +
      `<text x="${padL - 8}" y="${y + 4}" fill="${C.dim}" font-size="11" text-anchor="end">${fmt(mx * g / 4)}</text>`;
  }
  days.forEach((d, i) => {
    const cx = padL + iw * (i + 0.5) / days.length;
    const ho = ih * d.out / mx, hi = ih * d.in / mxi;
    bars += `<rect x="${cx - bw - 1.5}" y="${padT + ih - hi}" width="${bw}" height="${Math.max(hi, 1)}" rx="2" fill="${C.blueD}"/>` +
      `<rect x="${cx + 1.5}" y="${padT + ih - ho}" width="${bw}" height="${Math.max(ho, 1)}" rx="2" fill="${C.blue}"><title>${d.day} 输出 ${d.out}</title></rect>`;
    if (days.length <= 16 || i % 2 === 0) labels += `<text x="${cx}" y="${H - 12}" fill="${C.dim}" font-size="10" text-anchor="middle">${d.day.slice(5)}</text>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" rx="10" fill="${C.bg}"/>
<text x="${padL}" y="24" fill="${C.fg}" font-size="14" font-weight="600">每日 token 趋势(最近 ${days.length} 天)</text>
<rect x="${W - 190}" y="14" width="10" height="10" rx="2" fill="${C.blue}"/><text x="${W - 176}" y="23" fill="${C.dim}" font-size="11">输出</text>
<rect x="${W - 110}" y="14" width="10" height="10" rx="2" fill="${C.blueD}"/><text x="${W - 96}" y="23" fill="${C.dim}" font-size="11">输入(独立比例)</text>
${grid}${bars}${labels}</svg>`;
}

function modelShareSvg(models) {
  const W = 860, rowH = 44, H = 70 + models.length * rowH;
  const padL = 150, iw = W - padL - 130;
  const mx = Math.max(1, ...models.map(m => m.out + m.cr * 0.15));
  let rows = '';
  models.forEach((m, i) => {
    const y = 46 + i * rowH;
    const wo = iw * m.out / mx, wc = iw * (m.cr * 0.15) / mx;
    rows += `<text x="24" y="${y + 15}" fill="${C.fg}" font-size="12">${esc(m.model)}</text>` +
      `<text x="${padL + wo + 8}" y="${y + 15}" fill="${C.dim}" font-size="11">输出 ${fmt(m.out)} · 缓存读 ${fmt(m.cr)}</text>` +
      `<rect x="${padL}" y="${y + 4}" width="${Math.max(wo, 2)}" height="16" rx="4" fill="${C.blue}"><title>${esc(m.model)} 输出 ${m.out}</title></rect>` +
      `<rect x="${padL + wo + 2}" y="${y + 4}" width="${Math.max(wc, 0)}" height="16" rx="4" fill="#8b5cf6" opacity="0.55"><title>${esc(m.model)} 缓存读 ${m.cr}</title></rect>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" rx="10" fill="${C.bg}"/>
<text x="24" y="28" fill="${C.fg}" font-size="14" font-weight="600">按模型(全量转录)</text>
<rect x="${padL}" y="18" width="10" height="10" rx="2" fill="${C.blue}"/><text x="${padL + 14}" y="27" fill="${C.dim}" font-size="11">输出</text>
<rect x="${padL + 70}" y="18" width="10" height="10" rx="2" fill="#8b5cf6" opacity="0.55"/><text x="${padL + 84}" y="27" fill="${C.dim}" font-size="11">缓存读(0.15x 缩放示意)</text>
${rows}</svg>`;
}

function main() {
  const r = collect(30);
  const days = r.byDay.slice(-30);
  const outDir = path.join(__dirname, 'assets');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'daily-trend.svg'), dailyTrendSvg(days));
  fs.writeFileSync(path.join(outDir, 'model-share.svg'), modelShareSvg(r.byModel.slice(0, 6)));
  console.log('✓ 已生成 docs/assets/daily-trend.svg(' + days.length + ' 天)与 model-share.svg(' + r.byModel.length + ' 个模型)');
}
main();
