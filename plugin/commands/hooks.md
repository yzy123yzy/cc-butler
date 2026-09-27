---
description: hooks 安全画像:展示每个插件的 hooks 在什么时机以什么命令触碰会话,启发式风险信号分析
argument-hint: "[插件名]"
allowed-tools: Bash(node:*)
---

按以下步骤执行:

1. 运行画像脚本(`$ARGUMENTS` 为可选插件名,原样传入):

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/butler.cjs" hooks $ARGUMENTS --json
```

若报路径错误,先用 `cygpath -u "$CLAUDE_PLUGIN_ROOT"` 转换路径再重试。

2. 渲染中文安全画像,按插件分组:
   - **插件头行**:名称、版本、启用状态、hooks 总数、最大风险等级
   - **事件表**(hot 事件排前):事件(标热度:🔥hot=每次工具调用/提示触发、⏱warm=每轮、❄️cold=每会话)| matcher | 异步 | 风险等级 | 信号(网络访问/写文件/读环境变量/运行脚本等)
   - **命令预览**:默认只显示 preview 截断版;**不要主动刷屏完整命令**,告诉用户"想看某条的完整命令告诉我编号即可"(完整 command 在 JSON 里)
   - 风险图例:🔴 high=含删除/提权/混淆,🟡 medium=网络/写入/超长,🟢 low=未命中特征
   - 无 hooks 的插件明确写"✅ 无 hooks(零注入)";userHooks(用户全局 settings.json)单独一节,同样格式
   - 结尾管控提示:hot hooks 的 token 开销提醒;"禁用某插件的全部 hooks 用 /cc-butler:uninstall 时会连插件一起卸,只想暂停用 `claude plugin disable`";本画像为启发式,高危条目建议查看完整命令人工确认
