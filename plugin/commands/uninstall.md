---
description: 卸载插件(必须先确认;有 hooks 的插件卸载会影响会话行为)
argument-hint: "<插件名>"
allowed-tools: Bash(node:*)
---

这是破坏性操作,必须先展示影响并确认:

1. 先运行 info 拿到该插件的本机使用数据:

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/butler.cjs" info $ARGUMENTS --json
```

若报路径错误,先用 `cygpath -u "$CLAUDE_PLUGIN_ROOT"` 转换路径再重试。

2. 用 AskUserQuestion 确认,内容必须包含:插件名与版本、启用状态、本机使用次数(使用频繁的要特别提醒)、**警告:若该插件带 hooks(如 claude-mem),卸载后相应功能立即失效**。

3. 用户确认后执行卸载:

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/butler.cjs" uninstall $ARGUMENTS
```

4. 报告结果:`code: 0` → 卸载成功,提示重启会话生效;失败 → 原样展示 stderr。
