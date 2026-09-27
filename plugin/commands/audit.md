---
description: 插件体检:清点各插件组件/hooks/开销/使用频率,产出分级管控建议(卸载候选/禁用观察/关注/保留),可一键执行
argument-hint: "[--json]"
allowed-tools: Bash(node:*), Bash(claude plugin details:*)
---

按以下步骤执行:

1. 运行体检脚本:

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/butler.cjs" audit --json
```

若报路径错误,先用 `cygpath -u "$CLAUDE_PLUGIN_ROOT"` 转换路径再重试。

2. 渲染中文体检报告:
   - **总评行**:已装 N 个、启用 M 个;卸载候选 x 个、禁用观察 y 个、关注 z 个
   - **插件明细表**(按建议级别排序):插件 | 版本 | 启用 | 组件(命令/技能/agents/MCP 数)| hooks 事件及热度(hot=每次工具调用/提示触发,cold=每会话一次)| 使用(次数/闲置天数/技能与 MCP 调用/后台会话)| **建议级别 + 理由**
   - 级别图例:🔴 卸载候选 / 🟡 禁用观察 / 👀 关注 / 🟢 保留 / ⏸ 已禁用
   - 若列表里有 user 级 MCP server(非插件),单独一行说明"不归插件管控"

3. **主动给出一键执行**:若存在 🔴 卸载候选或 🟡 禁用观察,用 AskUserQuestion(多选)列出对应动作(如"卸载 xxx"、"禁用 yyy")让用户勾选;用户确认后逐个执行:

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/butler.cjs" uninstall <插件名>
node "$CLAUDE_PLUGIN_ROOT/scripts/butler.cjs" disable <插件名>
```

执行后汇报结果,并提醒重启会话生效。无候选时说明"当前插件都在合理使用范围内"。
