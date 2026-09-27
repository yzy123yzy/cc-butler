#!/usr/bin/env node
'use strict';
// Claude Code statusLine 集成:settings.json 里配一条 command 即可在状态栏显示今日用量。
// 输出单行,尽量快(读增量缓存,超时兜底):
//   "statusLine": { "type": "command", "command": "node <路径>/statusline.cjs" }
const path = require('path');

function todayTok() {
  try {
    const { CONFIG_DIR, loadJson } = require('./lib/cache');
    const cache = loadJson(path.join(CONFIG_DIR, 'plugins', 'data', 'cc-butler', 'cache.json'), { files: {} });
    const day = localDay(new Date());
    let t = { in: 0, out: 0, cr: 0 };
    for (const f of Object.values(cache.files || {})) {
      const d = f.agg && f.agg.days && f.agg.days[day];
      if (d) { t.in += d.in; t.out += d.out; t.cr += d.cr; }
    }
    return t;
  } catch { return null; }
}

function localDay(d) {
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function fmt(n) {
  return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n);
}

const t = todayTok();
if (t) {
  process.stdout.write(`\x1b[38;5;75m🛎️ 今日 ↑${fmt(t.out)} ↓${fmt(t.in)} ⟳${fmt(t.cr)}\x1b[0m`);
} else {
  process.stdout.write('🛎️');
}
