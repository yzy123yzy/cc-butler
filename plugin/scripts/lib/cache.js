'use strict';
// 增量缓存:按文件 {mtime,size} 缓存转录文件的部分聚合结果,避免每次全量重扫
const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const HOME = path.dirname(CONFIG_DIR) || os.homedir();
const CLAUDE_JSON = path.join(os.homedir(), '.claude.json');
const DATA_DIR = path.join(CONFIG_DIR, 'plugins', 'data', 'cc-butler');
const CACHE_FILE = path.join(DATA_DIR, 'cache.json');
const STARS_FILE = path.join(DATA_DIR, 'stars-cache.json');

function loadJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function loadCache() {
  const c = loadJson(CACHE_FILE, null);
  if (c && c.version === 1 && c.files) return c;
  return { version: 1, files: {} };
}

function saveJson(file, obj) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj));
    fs.renameSync(tmp, file);
  } catch { /* 缓存写失败不影响统计 */ }
}

function saveCache(cache) { saveJson(CACHE_FILE, cache); }

module.exports = { CONFIG_DIR, HOME, CLAUDE_JSON, DATA_DIR, CACHE_FILE, STARS_FILE, loadJson, saveJson, loadCache, saveCache };
