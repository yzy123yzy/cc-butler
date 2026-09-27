'use strict';
// 市场与安装管理:读本地 marketplace 目录做搜索,GitHub stars 作热度参考(24h 缓存),
// 安装/卸载/更新一律包装官方 `claude plugin` CLI,不手改注册表文件。
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { CONFIG_DIR, STARS_FILE, loadJson, saveJson } = require('./cache');

const MP_BASE = path.join(CONFIG_DIR, 'plugins', 'marketplaces');

function listMarketplaces() {
  const known = loadJson(path.join(CONFIG_DIR, 'plugins', 'known_marketplaces.json'), {});
  return Object.entries(known).map(([name, v]) => ({
    name,
    repo: (v.source && v.source.repo) || null,
    installLocation: v.installLocation || path.join(MP_BASE, name),
    autoUpdate: !!v.autoUpdate,
    lastUpdated: v.lastUpdated || null,
  }));
}

// 从插件 source 字段提取 owner/repo(stars 查询用)
function repoOf(source) {
  if (!source || typeof source === 'string') return null;
  if (typeof source.repo === 'string' && source.repo.includes('/')) return source.repo;
  const url = String(source.url || '');
  const m = url.match(/github\.com[/:]([^/]+\/[^/#?]+?)(?:\.git)?(?:[/?#]|$)/);
  return m ? m[1] : null;
}

function catalog() {
  const out = [];
  for (const mp of listMarketplaces()) {
    const mf = loadJson(path.join(mp.installLocation, '.claude-plugin', 'marketplace.json'), null);
    if (!mf || !Array.isArray(mf.plugins)) continue;
    for (const p of mf.plugins) {
      out.push({
        name: p.name,
        marketplace: mf.name || mp.name,
        version: p.version || '',
        description: p.description || '',
        category: p.category || '',
        keywords: p.keywords || [],
        owner: (p.author && p.author.name) || (mf.owner && mf.owner.name) || '',
        // 插件 source 是相对路径时,退回所属市场的 repo;repoFallback=true 表示
        // stars 来自市场仓库而非插件自身仓库(排行时应沉底,避免误导)
        repo: repoOf(p.source) || mp.repo,
        repoFallback: !repoOf(p.source) && !!mp.repo,
        stars: typeof p.stars === 'number' ? p.stars : null,
      });
    }
  }
  return out;
}

function searchPlugins(query) {
  const kw = String(query || '').trim().toLowerCase();
  const all = catalog();
  if (!kw) return all;
  return all.filter(p =>
    p.name.toLowerCase().includes(kw) ||
    p.description.toLowerCase().includes(kw) ||
    p.category.toLowerCase().includes(kw) ||
    (p.keywords || []).some(k => String(k).toLowerCase().includes(kw)));
}

function pluginInfo(name) {
  const hits = catalog().filter(p => p.name === name || p.name === String(name).split('@')[0]);
  const installed = loadJson(path.join(CONFIG_DIR, 'plugins', 'installed_plugins.json'), { plugins: {} });
  const settings = loadJson(path.join(CONFIG_DIR, 'settings.json'), {});
  const enabled = settings.enabledPlugins || {};
  const id = Object.keys(installed.plugins || {}).find(k => k === name || k.split('@')[0] === name);
  const rec = id ? installed.plugins[id][0] : null;
  return {
    query: name,
    catalogEntries: hits,
    installed: id ? {
      id, version: rec.version, enabled: enabled[id] === true,
      installPath: rec.installPath, installedAt: rec.installedAt,
      usageCount: (loadJson(require('./cache').CLAUDE_JSON, {}).pluginUsage || {})[id]?.usageCount || 0,
    } : null,
  };
}

function httpsJson(url, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'cc-butler', 'Accept': 'application/vnd.github+json' } }, res => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', d => { buf += d; });
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
  });
}

function ghCliStars(repo) {
  try {
    const r = spawnSync('gh', ['api', 'repos/' + repo, '--jq', '.stargazers_count'],
      { encoding: 'utf8', shell: process.platform === 'win32', timeout: 15000 });
    if (r.status === 0) {
      const n = parseInt(String(r.stdout).trim(), 10);
      if (Number.isFinite(n)) return n;
    }
  } catch { /* gh 不可用时走 https */ }
  return null;
}

// GitHub stars,24h 本地缓存(未认证 API 限流 60 次/小时)
async function fetchStars(repo) {
  if (!repo) return null;
  const cache = loadJson(STARS_FILE, {});
  const hit = cache[repo];
  if (hit && Date.now() - hit.at < 24 * 3600 * 1000) return hit.stars;
  let stars = ghCliStars(repo);
  if (stars == null) {
    // GitHub API 在部分网络环境下时通时断,失败重试一次
    for (let i = 0; i < 2 && stars == null; i++) {
      try { stars = (await httpsJson('https://api.github.com/repos/' + repo)).stargazers_count ?? null; } catch { /* 离线/限流时保持 null */ }
    }
  }
  if (stars != null) { cache[repo] = { stars, at: Date.now() }; saveJson(STARS_FILE, cache); }
  return stars;
}

// 批量拉 stars:GitHub search API 支持多 repo: 限定符(每查约 40 个,1 次请求),
// 比逐个查快一个数量级;结果进同一个 24h 缓存;限流/离线时已缓存的仍可用。
async function fetchStarsBulk(repos, chunkSize = 40) {
  const cache = loadJson(STARS_FILE, {});
  const now = Date.now();
  const missing = repos.filter(r => !cache[r] || now - cache[r].at > 24 * 3600 * 1000);
  for (let i = 0; i < missing.length; i += chunkSize) {
    const q = missing.slice(i, i + chunkSize).map(r => 'repo:' + r).join(' ');
    try {
      const j = await httpsJson('https://api.github.com/search/repositories?q=' + encodeURIComponent(q) + '&per_page=100');
      for (const it of (j.items || [])) {
        if (it.full_name) cache[it.full_name] = { stars: it.stargazers_count, at: now };
      }
    } catch { break; } // 搜索接口限流(未认证 10 次/分)时停止,靠缓存兜底
  }
  saveJson(STARS_FILE, cache);
  return cache;
}

// 热度排行:目录插件按 stars 降序,取前 limit 个。
// stars 来自市场仓库兜底的(repoFallback)沉底,避免市场仓库 stars 冒充插件热度。
async function topPlugins(limit = 30) {
  const all = catalog().filter(p => p.repo);
  const cache = await fetchStarsBulk(all.map(p => p.repo));
  const key = p => (cache[p.repo] ? cache[p.repo].stars : p.stars ?? -1) + (p.repoFallback ? -1e9 : 0);
  return all
    .map(p => ({ ...p, stars: cache[p.repo] ? cache[p.repo].stars : p.stars }))
    .sort((a, b) => key(b) - key(a))
    .slice(0, limit);
}

function runClaude(args) {
  const r = spawnSync('claude', args, { encoding: 'utf8', shell: process.platform === 'win32', timeout: 180000 });
  return { code: r.status, stdout: String(r.stdout || '').trim(), stderr: String(r.stderr || '').trim() };
}

function installedIds() {
  const installed = loadJson(path.join(CONFIG_DIR, 'plugins', 'installed_plugins.json'), { plugins: {} });
  return Object.keys(installed.plugins || {});
}

module.exports = {
  listMarketplaces, catalog, searchPlugins, pluginInfo, fetchStars, fetchStarsBulk, topPlugins,
  runClaude, installedIds,
  installPlugin: name => runClaude(['plugin', 'install', name]),
  uninstallPlugin: name => runClaude(['plugin', 'uninstall', name]),
  updatePlugin: name => runClaude(['plugin', 'update', name]),
  enablePlugin: name => runClaude(['plugin', 'enable', name]),
  disablePlugin: name => runClaude(['plugin', 'disable', name]),
  details: name => runClaude(['plugin', 'details', name]),
  listInstalled: () => runClaude(['plugin', 'list']),
};
