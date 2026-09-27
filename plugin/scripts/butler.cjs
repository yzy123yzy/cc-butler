#!/usr/bin/env node
'use strict';
// cc-butler CLI 入口:node butler.cjs <stats|search|info|install|uninstall|update|serve> [参数]
// 输出统一为 JSON(UTF-8),由斜杠命令指示 Claude 渲染成表格
const sub = process.argv[2];
const argv = process.argv.slice(3);

function flagNum(name, def) {
  const i = argv.indexOf('--' + name);
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')) return parseInt(argv[i + 1], 10);
  return def;
}
function positionals() {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { if (!argv[i + 1] || argv[i + 1].startsWith('--')) continue; i++; continue; }
    out.push(argv[i]);
  }
  return out;
}

async function main() {
  switch (sub) {
    case 'stats': {
      const stats = require('./lib/stats');
      const days = flagNum('days', parseInt(positionals()[0], 10)) || 30;
      console.log(JSON.stringify(stats.collect(days), null, 1));
      break;
    }
    case 'search': {
      const market = require('./lib/market');
      const q = positionals().join(' ');
      const results = market.searchPlugins(q);
      const top = results.slice(0, 20);
      const withStars = await Promise.all(top.map(async p => ({
        ...p, stars: p.stars != null ? p.stars : await market.fetchStars(p.repo),
      })));
      console.log(JSON.stringify({ query: q, total: results.length, truncated: results.length > top.length, results: withStars }, null, 1));
      break;
    }
    case 'info': {
      const market = require('./lib/market');
      const stats = require('./lib/stats');
      const name = positionals()[0];
      if (!name) { console.error('用法: butler info <插件名>'); process.exit(1); }
      const info = market.pluginInfo(name);
      if (info && Array.isArray(info.catalogEntries)) {
        for (const e of info.catalogEntries) {
          if (e.stars == null) e.stars = await market.fetchStars(e.repo);
        }
      }
      info.localUsage = stats.pluginLocalUsage(name);
      console.log(JSON.stringify(info, null, 1));
      break;
    }
    case 'install':
    case 'uninstall':
    case 'update':
    case 'enable':
    case 'disable': {
      const market = require('./lib/market');
      const target = positionals()[0];
      if (!target) { console.error('用法: butler ' + sub + ' <插件名|插件名@市场>'); process.exit(1); }
      let r;
      if (sub === 'update' && target === 'all') {
        r = market.installedIds().map(id => ({ id, ...market.updatePlugin(id) }));
      } else {
        const fn = { install: 'installPlugin', uninstall: 'uninstallPlugin', update: 'updatePlugin', enable: 'enablePlugin', disable: 'disablePlugin' }[sub];
        r = { target, ...market[fn](target) };
      }
      console.log(JSON.stringify({ action: sub, result: r }, null, 1));
      break;
    }
    case 'hooks': {
      const { analyze } = require('./lib/hooks');
      console.log(JSON.stringify(analyze(positionals()[0] || null), null, 1));
      break;
    }
    case 'mcp': {
      const { listMcp } = require('./lib/mcp');
      console.log(JSON.stringify(listMcp(), null, 1));
      break;
    }
    case 'skills': {
      const { listInstalledSkills } = require('./lib/inventory');
      console.log(JSON.stringify(listInstalledSkills(), null, 1));
      break;
    }
    case 'mcp-remove': {
      const { removeMcp } = require('./lib/mcp');
      const target = positionals()[0];
      if (!target) { console.error('用法: butler mcp-remove <服务器名>'); process.exit(1); }
      console.log(JSON.stringify({ action: 'mcp-remove', target, ...removeMcp(target) }, null, 1));
      break;
    }
    case 'audit': {
      const { audit } = require('./lib/audit');
      console.log(JSON.stringify(audit(), null, 1));
      break;
    }
    case 'serve': {
      require('./web').start(flagNum('port', 3789));
      break;
    }
    default:
      console.error('cc-butler — Claude Code 插件管家\n' +
        '用法: node butler.cjs <子命令> [参数]\n' +
        '  stats [天数]        使用统计(token/频率)\n' +
        '  search <关键词>     搜索市场插件(含 GitHub stars)\n' +
        '  info <插件名>       插件详情(stars + 本地使用)\n' +
        '  install <名称>      安装插件\n' +
        '  uninstall <名称>    卸载插件\n' +
        '  update <名称|all>   更新插件\n' +
        '  audit               插件体检:组件/hooks/开销/使用 → 分级管控建议\n' +
        '  hooks [插件名]      hooks 安全画像:谁在什么时机执行什么命令\n' +
        '  mcp                 MCP 服务器清单(user/local 级,含使用与建议)\n' +
        '  mcp-remove <名称>   移除 MCP 服务器\n' +
        '  skills              已安装技能全清单(插件自带 + 用户级)\n' +
        '  serve [--port N]    启动本地网页仪表盘');
      process.exit(1);
  }
}

main().catch(e => { console.error('cc-butler 错误:', e.message); process.exit(1); });
