---
description: 更新插件到最新版本(可指定单个插件或 all;更新后需重启会话)
argument-hint: "[插件名|all]"
allowed-tools: Bash(node:*)
---

1. 若参数为空或为 `all`,列出已安装插件(运行 `node "$CLAUDE_PLUGIN_ROOT/scripts/butler.cjs" stats 30 --json` 取 `plugins` 数组),用 AskUserQuestion 确认要全部更新还是选择部分。若指定了插件名则跳过确认直接进入第 2 步。

若报路径错误,先用 `cygpath -u "$CLAUDE_PLUGIN_ROOT"` 转换路径再重试。

2. 用户确认后执行:

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/butler.cjs" update $ARGUMENTS
```

`all` 会逐个更新全部已安装插件。

3. 渲染结果:每个插件的更新成功/失败与输出;**提醒:更新需重启会话才生效**;失败的原样展示 stderr。
