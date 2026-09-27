---
description: 插件/技能使用统计与 token 消耗仪表盘(可指定天数;加 --web 启动网页版)
argument-hint: "[天数] [--web]"
allowed-tools: Bash(node:*), TaskStop
---

按以下步骤执行:

1. 运行统计脚本(`$ARGUMENTS` 原样传入,作为天数或选项):

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/butler.cjs" stats $ARGUMENTS --json
```

若报路径错误,先用 `cygpath -u "$CLAUDE_PLUGIN_ROOT"` 转换路径再重试。

2. 把返回的 JSON 渲染成中文 Markdown 报告,包含:
   - **总览**:交互会话 token(输入/输出/缓存读取分列,注明 cache_read 通常是大头)、后台 SDK 会话(如 claude-mem 等插件后台进程)token 与会话数、Claude Code 启动次数
   - **按模型**:模型、输入、输出、缓存读、消息数
   - **每日趋势**(窗口期内有数据的日期):日期、输入、输出、缓存读
   - **按项目**:项目、输出 token、会话数
   - **技能使用排行**:技能、所属插件、次数、归因 token(注明:token 归因为启发式,从 Skill 调用起至对应 tool_result 返回止)
   - **MCP 调用**:server、归属(插件/user)、次数
   - **已安装插件**:名称、启用、使用次数、技能/MCP 调用数、后台消耗
   大数字用 K/M 缩写,表格按数量降序。

3. 若参数包含 `--web`:用 run_in_background 方式运行:

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/butler.cjs" serve --port 3789
```

然后告诉用户在浏览器打开 http://localhost:3789 查看网页仪表盘,不再重复终端表格的完整内容,只给摘要。
