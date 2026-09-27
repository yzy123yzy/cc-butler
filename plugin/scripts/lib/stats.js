'use strict';
// 统计引擎:扫描 ~/.claude/projects 下的转录 JSONL,聚合 token 消耗与 plugin/skill/MCP 使用频率。
// 归因规则:
//  - Skill 调用:tool_use(name=Skill, input.skill),token 归因从调用起至对应 tool_result 返回为止(启发式)
//  - MCP 调用:tool 名 mcp__<server>__<tool>,server 通过插件 .mcp.json 反查归属
//  - 后台 SDK 会话(claude-mem 等通过 Agent SDK 跑的进程,entrypoint=sdk-*):token 单独归到后台桶
const fs = require('fs');
const path = require('path');
const { CONFIG_DIR, CLAUDE_JSON, loadJson, loadCache, saveCache } = require('./cache');

const PROJECTS_DIR = path.join(CONFIG_DIR, 'projects');

function emptyTok() { return { in: 0, out: 0, cc: 0, cr: 0 }; }
function addTok(dst, t) { dst.in += t.in; dst.out += t.out; dst.cc += t.cc; dst.cr += t.cr; }

function newAgg() {
  return {
    tokens: {},       // model -> {in,out,cc,cr,msgs}
    bg: {},           // 后台 SDK:pluginKey -> {in,out,cc,cr,msgs}
    days: {},         // YYYY-MM-DD -> {in,out,cc,cr}
    projects: {},     // cwd -> {in,out,cc,cr,sessions}
    skills: {},       // skill -> {count,lastUsedAt}
    skillTokens: {},  // skill -> {in,out,cc,cr}
    mcp: {},          // server -> count
    agents: {},       // subagentType -> count
    sessions: 0,
    bgSessions: {},   // pluginKey -> n
  };
}

function localDay(d) {
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function classifyBg(cwd) {
  if (cwd && String(cwd).includes('.claude-mem')) return 'claude-mem';
  return 'other-sdk';
}

function listTranscripts() {
  const out = [];
  let dirs = [];
  try { dirs = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name); } catch { return out; }
  for (const proj of dirs) {
    const pdir = path.join(PROJECTS_DIR, proj);
    let entries = [];
    try { entries = fs.readdirSync(pdir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.isFile() && e.name.endsWith('.jsonl')) {
        out.push({ path: path.join(pdir, e.name), subagent: false });
      } else if (e.isDirectory()) {
        // 子代理转录:<sessionId>/subagents/agent-*.jsonl
        const saDir = path.join(pdir, e.name, 'subagents');
        let sa = [];
        try { sa = fs.readdirSync(saDir, { withFileTypes: true }); } catch { continue; }
        for (const s of sa) {
          if (s.isFile() && s.name.endsWith('.jsonl')) out.push({ path: path.join(saDir, s.name), subagent: true });
        }
      }
    }
  }
  return out;
}

function scanFile(fp, isSubagent) {
  const agg = newAgg();
  let raw;
  try { raw = fs.readFileSync(fp, 'utf8'); } catch { return agg; }
  const active = []; // 活跃的 Skill 调用栈 [{id,name}],收到对应 tool_result 后移除
  let bgKey = null;
  let projectCwd = null;
  for (const line of raw.split('\n')) {
    if (!line || line[0] !== '{') continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (bgKey === null) {
      const ep = String(o.entrypoint || '');
      const cwd = String(o.cwd || '');
      if (ep.startsWith('sdk') || cwd.includes('.claude-mem')) bgKey = classifyBg(cwd);
    }
    if (o.cwd) projectCwd = o.cwd;
    const msg = o.message;
    // user 行:收回已完成的 Skill 归因
    if (o.type === 'user' && msg && Array.isArray(msg.content)) {
      for (const b of msg.content) {
        if (b && b.type === 'tool_result' && b.tool_use_id) {
          const i = active.findIndex(a => a.id === b.tool_use_id);
          if (i >= 0) active.splice(i, 1);
        }
      }
      continue;
    }
    if (o.type !== 'assistant' || !msg) continue;
    const ts = o.timestamp ? Date.parse(o.timestamp) : NaN;
    const day = Number.isFinite(ts) ? localDay(new Date(ts)) : null;
    // tool_use 频次统计
    if (Array.isArray(msg.content)) {
      for (const b of msg.content) {
        if (!b || b.type !== 'tool_use') continue;
        if (b.name === 'Skill' && b.input && b.input.skill) {
          const s = String(b.input.skill);
          const a = agg.skills[s] || (agg.skills[s] = { count: 0, lastUsedAt: 0 });
          a.count++;
          if (Number.isFinite(ts) && ts > a.lastUsedAt) a.lastUsedAt = ts;
          active.push({ id: b.id, name: s });
        } else if (typeof b.name === 'string' && b.name.startsWith('mcp__')) {
          const server = b.name.split('__')[1] || 'unknown';
          agg.mcp[server] = (agg.mcp[server] || 0) + 1;
        } else if (b.name === 'Agent' && b.input && b.input.subagent_type) {
          const t = String(b.input.subagent_type);
          agg.agents[t] = (agg.agents[t] || 0) + 1;
        }
      }
    }
    // token 统计
    const u = msg.usage;
    if (!u) continue;
    const t = { in: u.input_tokens | 0, out: u.output_tokens | 0, cc: u.cache_creation_input_tokens | 0, cr: u.cache_read_input_tokens | 0 };
    if (!t.in && !t.out && !t.cc && !t.cr) continue;
    if (bgKey) {
      const dst = agg.bg[bgKey] || (agg.bg[bgKey] = { ...emptyTok(), msgs: 0 });
      addTok(dst, t); dst.msgs++;
    } else {
      const dst = agg.tokens[msg.model || 'unknown'] || (agg.tokens[msg.model || 'unknown'] = { ...emptyTok(), msgs: 0 });
      addTok(dst, t); dst.msgs++;
      if (day) { const d = agg.days[day] || (agg.days[day] = emptyTok()); addTok(d, t); }
      if (projectCwd) {
        const p = agg.projects[projectCwd] || (agg.projects[projectCwd] = { ...emptyTok(), sessions: 0 });
        addTok(p, t);
      }
      if (active.length) {
        const s = active[active.length - 1].name;
        const st = agg.skillTokens[s] || (agg.skillTokens[s] = emptyTok());
        addTok(st, t);
      }
    }
  }
  if (bgKey) agg.bgSessions[bgKey] = 1;
  else if (!isSubagent) {
    agg.sessions = 1;
    if (projectCwd) {
      const p = agg.projects[projectCwd] || (agg.projects[projectCwd] = { ...emptyTok(), sessions: 0 });
      p.sessions++;
    }
  }
  return agg;
}

function mergeAgg(target, src) {
  for (const [m, v] of Object.entries(src.tokens)) {
    const dst = target.tokens[m] || (target.tokens[m] = { ...emptyTok(), msgs: 0 });
    addTok(dst, v); dst.msgs += v.msgs || 0;
  }
  for (const [k, v] of Object.entries(src.bg)) {
    const dst = target.bg[k] || (target.bg[k] = { ...emptyTok(), msgs: 0 });
    addTok(dst, v); dst.msgs += v.msgs || 0;
  }
  for (const [d, v] of Object.entries(src.days)) {
    const dst = target.days[d] || (target.days[d] = emptyTok());
    addTok(dst, v);
  }
  for (const [p, v] of Object.entries(src.projects)) {
    const dst = target.projects[p] || (target.projects[p] = { ...emptyTok(), sessions: 0 });
    addTok(dst, v); dst.sessions += v.sessions || 0;
  }
  for (const [s, v] of Object.entries(src.skills)) {
    const dst = target.skills[s] || (target.skills[s] = { count: 0, lastUsedAt: 0 });
    dst.count += v.count; dst.lastUsedAt = Math.max(dst.lastUsedAt, v.lastUsedAt);
  }
  for (const [s, v] of Object.entries(src.skillTokens)) {
    const dst = target.skillTokens[s] || (target.skillTokens[s] = emptyTok());
    addTok(dst, v);
  }
  for (const [s, c] of Object.entries(src.mcp)) target.mcp[s] = (target.mcp[s] || 0) + c;
  for (const [a, c] of Object.entries(src.agents)) target.agents[a] = (target.agents[a] || 0) + c;
  target.sessions += src.sessions || 0;
  for (const [k, n] of Object.entries(src.bgSessions)) target.bgSessions[k] = (target.bgSessions[k] || 0) + n;
}

function mcpServerOwners() {
  const map = {};
  const cacheDir = path.join(CONFIG_DIR, 'plugins', 'cache');
  let mps = [];
  try { mps = fs.readdirSync(cacheDir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name); } catch {}
  for (const mp of mps) {
    let pls = [];
    try { pls = fs.readdirSync(path.join(cacheDir, mp), { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name); } catch { continue; }
    for (const pl of pls) {
      const mcpJson = loadJson(path.join(cacheDir, mp, pl, '.mcp.json'), null);
      if (mcpJson && mcpJson.mcpServers) for (const k of Object.keys(mcpJson.mcpServers)) map[k] = pl;
    }
  }
  const userCfg = loadJson(CLAUDE_JSON, {});
  for (const k of Object.keys(userCfg.mcpServers || {})) if (!map[k]) map[k] = '(user)';
  return map;
}

function shortProject(cwd) {
  const parts = String(cwd).split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || cwd;
}

// 增量扫描全部转录,返回合并后的聚合(带缓存)
function buildAgg() {
  const cache = loadCache();
  const files = listTranscripts();
  const seen = new Set();
  let dirty = false;
  const total = newAgg();
  for (const f of files) {
    seen.add(f.path);
    let st; try { st = fs.statSync(f.path); } catch { continue; }
    const key = f.path;
    const hit = cache.files[key];
    if (hit && hit.mtime === st.mtimeMs && hit.size === st.size) {
      mergeAgg(total, hit.agg);
    } else {
      const agg = scanFile(f.path, f.subagent);
      cache.files[key] = { mtime: st.mtimeMs, size: st.size, agg };
      mergeAgg(total, agg);
      dirty = true;
    }
  }
  for (const k of Object.keys(cache.files)) {
    if (!seen.has(k)) { delete cache.files[k]; dirty = true; }
  }
  if (dirty) saveCache(cache);
  return total;
}

function collect(days) {
  days = Number.isFinite(days) && days > 0 ? days : 30;
  const agg = buildAgg();
  const claudeJson = loadJson(CLAUDE_JSON, {});
  const installed = loadJson(path.join(CONFIG_DIR, 'plugins', 'installed_plugins.json'), { plugins: {} });
  const settings = loadJson(path.join(CONFIG_DIR, 'settings.json'), {});
  const enabled = settings.enabledPlugins || {};
  const owners = mcpServerOwners();

  // 按天窗口
  const dayKeys = Object.keys(agg.days).sort();
  const byDay = dayKeys.map(d => ({ day: d, ...agg.days[d] }));
  const windowDays = dayKeys.slice(-days);
  const windowTotals = windowDays.reduce((a, d) => { addTok(a, agg.days[d]); return a; }, emptyTok());

  // 全量 token
  const allTotals = { ...emptyTok(), msgs: 0, sessions: agg.sessions };
  for (const v of Object.values(agg.tokens)) { addTok(allTotals, v); allTotals.msgs += v.msgs; }
  const bgTotals = { ...emptyTok(), msgs: 0, sessions: 0 };
  for (const v of Object.values(agg.bg)) { addTok(bgTotals, v); bgTotals.msgs += v.msgs; }
  for (const n of Object.values(agg.bgSessions)) bgTotals.sessions += n;

  // 技能列表(含插件归属)
  const skills = Object.entries(agg.skills).map(([name, v]) => {
    const ci = name.indexOf(':');
    return {
      name: ci >= 0 ? name.slice(ci + 1) : name,
      fullName: name,
      plugin: ci >= 0 ? name.slice(0, ci) : null,
      count: v.count,
      lastUsedAt: v.lastUsedAt || null,
      tokens: agg.skillTokens[name] || emptyTok(),
      usageCount: (claudeJson.skillUsage && claudeJson.skillUsage[name] && claudeJson.skillUsage[name].usageCount) || null,
    };
  }).sort((a, b) => b.count - a.count);

  // MCP 列表
  const mcp = Object.entries(agg.mcp).map(([server, count]) => ({
    server, plugin: owners[server] || '(未知)', count,
  })).sort((a, b) => b.count - a.count);

  // 已安装插件汇总
  const plugins = Object.entries(installed.plugins || {}).map(([id, recs]) => {
    const rec = Array.isArray(recs) ? recs[0] : {};
    const name = id.split('@')[0];
    const pu = (claudeJson.pluginUsage && claudeJson.pluginUsage[id]) || {};
    // 后台会话数从 bgSessions 取;bg token 桶通常为空(GLM 端点对 SDK 会话不回传 usage)
    const bgSessions = agg.bgSessions[name] || 0;
    const bgTok = agg.bg[name] || { in: 0, out: 0, cc: 0, cr: 0, msgs: 0 };
    return {
      id, name,
      marketplace: id.split('@')[1] || null,
      version: rec.version || null,
      enabled: enabled[id] === true,
      installPath: rec.installPath || null,
      usageCount: pu.usageCount || 0,
      lastUsedAt: pu.lastUsedAt || null,
      skillCalls: skills.filter(s => s.plugin === name).reduce((a, s) => a + s.count, 0),
      mcpCalls: mcp.filter(m => m.plugin === name).reduce((a, m) => a + m.count, 0),
      backgroundTokens: bgSessions > 0 ? { ...bgTok, sessions: bgSessions } : null,
    };
  }).sort((a, b) => (b.usageCount + b.skillCalls + b.mcpCalls) - (a.usageCount + a.skillCalls + a.mcpCalls));

  return {
    generatedAt: new Date().toISOString(),
    windowDays: days,
    numStartups: claudeJson.numStartups || null,
    totals: { all: allTotals, window: windowTotals, background: bgTotals },
    byModel: Object.entries(agg.tokens).map(([model, v]) => ({ model, ...v })).sort((a, b) => b.out - a.out),
    byDay,
    byProject: Object.entries(agg.projects).map(([cwd, v]) => ({ project: shortProject(cwd), cwd, ...v })).sort((a, b) => b.out - a.out),
    agents: Object.entries(agg.agents).map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
    skills, mcp, plugins,
  };
}

// 单个插件的本地使用画像(info 命令用)
function pluginLocalUsage(name) {
  const r = collect(30);
  return {
    plugin: r.plugins.find(p => p.name === name || p.id === name) || null,
    skills: r.skills.filter(s => s.plugin === name),
    mcp: r.mcp.filter(m => m.plugin === name),
    note: 'token 为全量转录统计;window 为最近 30 天',
    totals: r.totals,
  };
}

module.exports = { collect, pluginLocalUsage, buildAgg, scanFile, listTranscripts };
