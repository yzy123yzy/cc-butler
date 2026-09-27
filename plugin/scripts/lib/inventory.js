'use strict';
// 已安装能力清单:插件自带的 skills + 用户级 skills,不依赖"是否被使用过"。
// 解决"装了 20 个技能但技能页只显示用过的 1 个"的可见性问题。
const fs = require('fs');
const path = require('path');
const { CONFIG_DIR, loadJson } = require('./cache');

function parseSkillMd(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!m) return null;
    const fm = m[1];
    const name = (fm.match(/^name:\s*(.+)$/m) || [])[1];
    const desc = (fm.match(/^description:\s*(.+)$/m) || [])[1];
    return {
      name: name ? name.trim().replace(/^["']|["']$/g, '') : null,
      description: desc ? desc.trim().slice(0, 160) : '',
    };
  } catch { return null; }
}

function listInstalledSkills() {
  const out = [];
  const installed = loadJson(path.join(CONFIG_DIR, 'plugins', 'installed_plugins.json'), { plugins: {} });
  for (const [id, recs] of Object.entries(installed.plugins || {})) {
    const rec = Array.isArray(recs) ? recs[0] : {};
    const dir = rec.installPath && path.join(rec.installPath, 'skills');
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const info = parseSkillMd(path.join(dir, e.name, 'SKILL.md'));
      if (info) out.push({ name: info.name || e.name, plugin: id.split('@')[0], description: info.description });
    }
  }
  // 用户级技能(~/.claude/skills/<name>/SKILL.md)
  try {
    for (const e of fs.readdirSync(path.join(CONFIG_DIR, 'skills'), { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const info = parseSkillMd(path.join(CONFIG_DIR, 'skills', e.name, 'SKILL.md'));
      if (info) out.push({ name: info.name || e.name, plugin: '(user)', description: info.description });
    }
  } catch { /* 无用户技能目录 */ }
  return out;
}

module.exports = { listInstalledSkills, parseSkillMd };
