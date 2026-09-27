'use strict';
// MCP 服务器管控:user/local 级 MCP 不走插件市场体系,但同样是装在机器上的工具,
// 管家把它们纳入清单(经官方 `claude mcp` 系列命令管理)。
const { CONFIG_DIR, CLAUDE_JSON, loadJson } = require('./cache');
const { collect } = require('./stats');
const { runClaude } = require('./market');

function listMcp() {
  const claudeJson = loadJson(CLAUDE_JSON, {});
  const callsByServer = {};
  try {
    for (const m of collect(30).mcp) callsByServer[m.server] = m.count;
  } catch { /* 统计失败时调用数为 0 */ }
  const out = [];
  const push = (name, cfg, scope) => {
    if (!cfg || typeof cfg !== 'object') return;
    const calls = callsByServer[name] || 0;
    out.push({
      name, scope,
      type: cfg.type || 'stdio',
      command: cfg.command || null,
      url: cfg.url || null,
      args: cfg.args || [],
      calls,
      suggestion: calls > 0 ? 'keep' : 'watch',
      reason: calls > 0
        ? `近期有 ${calls} 次工具调用`
        : '窗口期内无调用;MCP 工具 schema 每个会话都占上下文,不用可移除',
    });
  };
  for (const [name, cfg] of Object.entries(claudeJson.mcpServers || {})) push(name, cfg, 'user');
  for (const [p, v] of Object.entries(claudeJson.projects || {})) {
    for (const [name, cfg] of Object.entries((v && v.mcpServers) || {})) push(name, cfg, 'local:' + p);
  }
  return out;
}

function removeMcp(name) { return runClaude(['mcp', 'remove', name]); }

module.exports = { listMcp, removeMcp };
