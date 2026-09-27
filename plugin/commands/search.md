---
description: 搜索已配置市场里的插件(名称/描述/关键词,含 GitHub stars 热度)
argument-hint: "<关键词>"
allowed-tools: Bash(node:*)
---

运行搜索脚本:

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/butler.cjs" search $ARGUMENTS --json
```

若报路径错误,先用 `cygpath -u "$CLAUDE_PLUGIN_ROOT"` 转换路径再重试。

把 JSON 渲染成中文表格:**插件名 | 市场 | 版本 | ⭐Stars | 描述**(按 stars 降序)。注意:
- stars 是 GitHub 热度参考,不是官方安装量;repo 显示为市场本身时(如 anthropics/claude-plugins-official),stars 代表市场仓库而非该插件
- 若 `truncated: true`,注明"共 N 个结果,仅显示前 20"
- 结尾提示:`/cc-butler:info <插件名>` 看详情(含本机使用数据),`/cc-butler:install <插件名>` 安装
