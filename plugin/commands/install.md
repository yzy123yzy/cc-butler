---
description: 安装插件(先展示将安装的内容,确认后执行)
argument-hint: "<插件名>[@市场]"
allowed-tools: Bash(node:*)
---

这是改变系统状态的操作,必须先确认再执行:

1. 先运行 info 了解插件(不执行安装):

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/butler.cjs" info $ARGUMENTS --json
```

若报路径错误,先用 `cygpath -u "$CLAUDE_PLUGIN_ROOT"` 转换路径再重试。

2. 用 AskUserQuestion 向用户确认:展示插件名、市场、版本、⭐、描述,询问是否安装。

3. 用户确认后执行安装(参数原样传递,支持 `插件名@市场`):

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/butler.cjs" install $ARGUMENTS
```

4. 根据 JSON 结果报告:
   - `code: 0` → 安装成功,提示重启会话生效
   - 失败且 stderr 含 marketplace/market 字样 → 提示需要先添加市场,给出建议命令 `claude plugin marketplace add <repo 或路径>`
   - 其他失败 → 原样展示 stderr
