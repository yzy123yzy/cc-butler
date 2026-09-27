'use strict';
// hooks 安全画像:解析每个插件的 hooks.json,对每条 hook 命令做启发式信号分析,
// 回答"谁在什么时机以什么命令碰你的会话"。只提取环境变量名,绝不读取其值。
const fs = require('fs');
const path = require('path');
const { CONFIG_DIR, loadJson } = require('./cache');

const HOT = ['PreToolUse', 'PostToolUse', 'UserPromptSubmit'];
const WARM = ['Stop', 'SubagentStop', 'Notification'];
const heatOf = ev => HOT.includes(ev) ? 'hot' : WARM.includes(ev) ? 'warm' : 'cold';

// 单条 hook 命令的启发式分析(纯字符串特征,非沙箱级安全审计)
function analyzeCommand(cmd) {
  const c = String(cmd);
  const signals = [];
  // 环境变量:兼容 $VAR 与 ${VAR} 两种写法,只记名字不读值
  const envVars = [...new Set((c.match(/\$\{?[A-Z_][A-Z0-9_]{2,}\}?/g) || [])
    .map(v => v.replace(/[{}]/g, '')))];
  const sensitive = envVars.filter(v => /TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL/i.test(v));
  if (/\b(curl|wget|nc)\b|https?:\/\//.test(c)) signals.push('访问网络');
  const destructive = c.match(/rm\s+-[a-z]*[rf]|sudo\s|mkfs|dd\s+if=|chmod\s+777/g);
  if (destructive) signals.push('含删除/提权类命令(' + destructive.length + '处)');
  if (/\b(base64|eval)\b|\|\s*(ba)?sh\b/.test(c)) signals.push('疑似混淆(base64/eval/管道执行)');
  // 写文件:先剥离 stderr 抑制(2>/dev/null、2>&1),避免误报
  const stripped = c.replace(/2?>\s*\/dev\/null|2>&1/g, '');
  const writes = />>|>\s*\/(?!dev)|\btee\b/.test(stripped);
  if (writes) signals.push('写入文件');
  const scripts = [...new Set((c.match(/[\w./\\-]+\.(?:cjs|mjs|js|sh|py)/g) || []))].slice(0, 5);
  if (scripts.length) signals.push('运行脚本 ' + scripts.join(', '));
  if (sensitive.length) signals.push('⚠️ 读取敏感环境变量(' + sensitive.join(', ') + ')');
  else if (envVars.length) signals.push('读取环境变量(' + envVars.slice(0, 6).join(', ') + (envVars.length > 6 ? ' …' : '') + ')');
  const risky = destructive || /\b(base64|eval)\b|\|\s*(ba)?sh\b/.test(c);
  const risk = risky ? 'high'
    : (writes || signals.some(s => s === '访问网络' || s.startsWith('⚠️')) || c.length > 500) ? 'medium' : 'low';
  return {
    length: c.length,
    long: c.length > 300,
    envVars,
    sensitive,
    scripts,
    writes,
    risk,
    signals,
  };
}

function parseHookGroups(hooksDef) {
  const events = [];
  for (const [event, groups] of Object.entries(hooksDef)) {
    const hooks = [];
    for (const g of Array.isArray(groups) ? groups : []) {
      for (const h of g.hooks || []) {
        if (h.type !== 'command' || !h.command) continue;
        const analysis = analyzeCommand(h.command);
        hooks.push({
          matcher: g.matcher || '(全部)',
          async: !!h.async,
          timeout: h.timeout || null,
          preview: h.command.slice(0, 120) + (h.command.length > 120 ? '…' : ''),
          command: h.command,
          analysis,
        });
      }
    }
    if (hooks.length) events.push({ event, heat: heatOf(event), hooks });
  }
  // hot 事件排前,便于一眼看到常驻触发点
  events.sort((a, b) => {
    const w = { hot: 0, warm: 1, cold: 2 };
    return w[a.heat] - w[b.heat] || a.event.localeCompare(b.event);
  });
  return events;
}

function sourceHooks(installPath) {
  const j = loadJson(path.join(installPath, 'hooks', 'hooks.json'), null);
  return j && j.hooks ? parseHookGroups(j.hooks) : [];
}

// 全量画像:各插件 + 用户全局 settings.json 的 hooks
function analyze(filterName) {
  const installed = loadJson(path.join(CONFIG_DIR, 'plugins', 'installed_plugins.json'), { plugins: {} });
  const settings = loadJson(path.join(CONFIG_DIR, 'settings.json'), {});
  const enabledMap = settings.enabledPlugins || {};
  const claudeJson = loadJson(path.join(path.dirname(CONFIG_DIR), '.claude.json'), {});

  const plugins = [];
  for (const [id, recs] of Object.entries(installed.plugins || {})) {
    const name = id.split('@')[0];
    if (filterName && name !== filterName && id !== filterName) continue;
    const rec = Array.isArray(recs) ? recs[0] : {};
    const events = sourceHooks(rec.installPath);
    const hookCount = events.reduce((a, e) => a + e.hooks.length, 0);
    const risks = events.flatMap(e => e.hooks.map(h => h.analysis.risk));
    plugins.push({
      id, name,
      version: rec.version || null,
      enabled: enabledMap[id] === true,
      installPath: rec.installPath || null,
      totalHooks: hookCount,
      hotEvents: events.filter(e => e.heat === 'hot').map(e => e.event),
      maxRisk: risks.includes('high') ? 'high' : risks.includes('medium') ? 'medium' : risks.length ? 'low' : null,
      events,
    });
  }
  plugins.sort((a, b) => b.totalHooks - a.totalHooks);

  // 用户全局 hooks(非插件,但同样在碰会话)
  let userHooks = null;
  if (settings.hooks && Object.keys(settings.hooks).length) {
    userHooks = {
      id: '(用户全局 settings.json)',
      name: '(用户全局)',
      enabled: true,
      version: null,
      installPath: null,
      totalHooks: 0,
      hotEvents: [],
      maxRisk: null,
      events: parseHookGroups(settings.hooks),
    };
    userHooks.totalHooks = userHooks.events.reduce((a, e) => a + e.hooks.length, 0);
    const risks = userHooks.events.flatMap(e => e.hooks.map(h => h.analysis.risk));
    userHooks.maxRisk = risks.includes('high') ? 'high' : risks.includes('medium') ? 'medium' : risks.length ? 'low' : null;
    userHooks.hotEvents = userHooks.events.filter(e => e.heat === 'hot').map(e => e.event);
  }

  return {
    generatedAt: new Date().toISOString(),
    note: '信号为启发式字符串分析,非沙箱级审计;环境变量只列名字不读值。command 字段含完整命令,按需查看。',
    userMcpServers: Object.keys(claudeJson.mcpServers || {}),
    plugins,
    userHooks,
    riskGuide: {
      high: '含删除/提权命令或疑似混淆,建议查看完整命令再决定',
      medium: '有网络访问/文件写入/超长命令,建议了解用途',
      low: '未命中风险特征(通常是本地脚本调用)',
    },
  };
}

module.exports = { analyze, analyzeCommand };
