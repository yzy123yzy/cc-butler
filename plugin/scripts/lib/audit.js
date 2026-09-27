'use strict';
// 插件体检:清点每个已装插件的组件/hooks 时机/开销与真实使用,产出分级管控建议。
// 分级:uninstall(卸载候选) / disable(禁用观察) / watch(在用关注) / keep(保留) / off(已禁用)
const fs = require('fs');
const path = require('path');
const { CONFIG_DIR, CLAUDE_JSON, loadJson } = require('./cache');
const { collect } = require('./stats');
const { listMcp } = require('./mcp');

// hooks 事件热度:hot=每次工具调用/提示都触发,warm=每轮触发,cold=每会话一次
const HOT = ['PreToolUse', 'PostToolUse', 'UserPromptSubmit'];
const WARM = ['Stop', 'SubagentStop', 'Notification'];

function scanComponents(installPath) {
  const c = { commands: 0, skills: 0, agents: 0, mcpServers: [], hooks: null };
  if (!installPath || !fs.existsSync(installPath)) return { ...c, missing: true };
  const countMd = dir => {
    try { return fs.readdirSync(path.join(installPath, dir)).filter(f => f.endsWith('.md')).length; } catch { return 0; }
  };
  c.commands = countMd('commands');
  try {
    c.skills = fs.readdirSync(path.join(installPath, 'skills'))
      .filter(f => { try { return fs.statSync(path.join(installPath, 'skills', f)).isDirectory(); } catch { return false; } }).length;
  } catch { /* 无 skills 目录 */ }
  c.agents = countMd('agents');
  const mcpJson = loadJson(path.join(installPath, '.mcp.json'), null);
  if (mcpJson && mcpJson.mcpServers) c.mcpServers = Object.keys(mcpJson.mcpServers);
  const hooksJson = loadJson(path.join(installPath, 'hooks', 'hooks.json'), null);
  if (hooksJson && hooksJson.hooks) {
    c.hooks = Object.entries(hooksJson.hooks).map(([event, arr]) => {
      let count = 0;
      const matchers = [];
      for (const group of Array.isArray(arr) ? arr : []) {
        if (group.matcher) matchers.push(String(group.matcher));
        count += (group.hooks || []).length;
      }
      return {
        event, count, matchers,
        heat: HOT.includes(event) ? 'hot' : WARM.includes(event) ? 'warm' : 'cold',
      };
    });
  }
  return c;
}

function audit() {
  const report = collect(30);
  const installed = loadJson(path.join(CONFIG_DIR, 'plugins', 'installed_plugins.json'), { plugins: {} });
  const settings = loadJson(path.join(CONFIG_DIR, 'settings.json'), {});
  const enabledMap = settings.enabledPlugins || {};
  const claudeJson = loadJson(CLAUDE_JSON, {});
  const now = Date.now();
  const DAY = 86400e3;

  const plugins = Object.entries(installed.plugins || {}).map(([id, recs]) => {
    const rec = Array.isArray(recs) ? recs[0] : {};
    const name = id.split('@')[0];
    const pu = (claudeJson.pluginUsage || {})[id] || {};
    const components = scanComponents(rec.installPath);
    const agg = report.plugins.find(p => p.id === id) || {};
    const bgSessions = agg.backgroundTokens ? agg.backgroundTokens.sessions : 0;
    const skillCalls = agg.skillCalls || 0;
    const mcpCalls = agg.mcpCalls || 0;
    const daysIdle = pu.lastUsedAt ? Math.floor((now - pu.lastUsedAt) / DAY) : null;
    const active = (pu.usageCount || 0) > 0 || skillCalls > 0 || mcpCalls > 0;
    const enabled = enabledMap[id] === true;
    const installedFor = rec.installedAt ? Math.floor((now - Date.parse(rec.installedAt)) / DAY) : null;

    const reasons = [];
    let level;
    if (!enabled) {
      level = 'off';
      if (!active && installedFor != null && installedFor >= 7) reasons.push('已禁用且无使用记录,可考虑卸载');
    } else if (!active && bgSessions === 0 && installedFor != null && installedFor < 7) {
      level = 'watch';
      reasons.push(`新装 ${Math.max(installedFor, 0)} 天,尚无使用记录`);
    } else if (!active && bgSessions === 0) {
      level = 'uninstall';
      reasons.push('从未使用(无调用记录)');
    } else if (daysIdle != null && daysIdle >= 60) {
      level = 'uninstall';
      reasons.push(`${daysIdle} 天未使用`);
    } else if (daysIdle != null && daysIdle >= 30) {
      level = 'disable';
      reasons.push(`${daysIdle} 天未使用,可先禁用观察`);
    } else {
      level = 'keep';
    }
    if (bgSessions >= 20) reasons.push(`后台 SDK 会话 ${bgSessions} 个(持续消耗配额)`);
    if (components.hooks && components.hooks.some(h => h.heat === 'hot')) reasons.push('hooks 挂在每次工具调用/提示上(hot 事件)');
    if (level === 'keep' && reasons.length) level = 'watch';

    return {
      id, name,
      marketplace: id.split('@')[1] || null,
      version: rec.version || null,
      enabled,
      installedFor,
      installPath: rec.installPath || null,
      components,
      usage: {
        usageCount: pu.usageCount || 0,
        lastUsedAt: pu.lastUsedAt || null,
        daysIdle, skillCalls, mcpCalls, bgSessions,
      },
      suggestion: { level, reasons },
    };
  });

  const order = { uninstall: 0, disable: 1, watch: 2, keep: 3, off: 4 };
  plugins.sort((a, b) => order[a.suggestion.level] - order[b.suggestion.level] || b.usage.usageCount - a.usage.usageCount);

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      installed: plugins.length,
      enabled: plugins.filter(p => p.enabled).length,
      uninstall: plugins.filter(p => p.suggestion.level === 'uninstall').map(p => p.name),
      disable: plugins.filter(p => p.suggestion.level === 'disable').map(p => p.name),
      watch: plugins.filter(p => p.suggestion.level === 'watch').map(p => p.name),
      mcpServers: Object.keys(claudeJson.mcpServers || {}),
    },
    mcp: listMcp(),
    plugins,
    levelGuide: {
      uninstall: '卸载候选:从未/长期未使用',
      disable: '禁用观察:不常用,先禁用省开销',
      watch: '在用,但有开销关注点',
      keep: '保留:活跃使用',
      off: '已禁用',
    },
  };
}

module.exports = { audit };
