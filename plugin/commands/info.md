---
description: 插件详情:市场信息、GitHub stars、本机安装状态与使用统计、token 成本预测
argument-hint: "<插件名>"
allowed-tools: Bash(node:*), Bash(claude plugin details:*)
---

按顺序执行:

1. 运行详情脚本:

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/butler.cjs" info $ARGUMENTS --json
```

若报路径错误,先用 `cygpath -u "$CLAUDE_PLUGIN_ROOT"` 转换路径再重试。

2. 若 `installed` 非空,再运行 `claude plugin details <插件名>` 获取组件清单与 projected token cost,并入报告。

3. 渲染成中文报告:
   - **市场信息**:名称、市场、版本、⭐Stars(注明是 GitHub 热度参考)、描述、repo
   - **本机安装状态**:已装/未装、版本、是否启用、安装时间、路径
   - **本机使用统计**:使用次数、关联技能调用、MCP 调用、后台 SDK 会话 token(若有)
   - **组件与开销**(若有 details 输出):commands/skills/hooks/MCP 数量与 token 成本预测
   - 未安装则说明"未安装",并提示可用 `/cc-butler:install <插件名>` 安装
