'use strict';
// 页面 JS 冒烟测试:从运行中的仪表盘取页面,提取 <script>,在带最小 DOM 桩的 Node 环境里
// 真正执行 load()/doSearch()(数据来自真实接口),能抓住 ReferenceError/TypeError 这类
// curl 测不出、但浏览器里直接白屏的问题。用法:node check-page.cjs [端口]
const http = require('http');

const port = parseInt(process.argv[2], 10) || 3789;
const base = 'http://127.0.0.1:' + port;

function get(path) {
  return new Promise((resolve, reject) => {
    http.get(base + path, res => {
      let b = '';
      res.on('data', d => { b += d; });
      res.on('end', () => resolve(b));
    }).on('error', reject);
  });
}

async function main() {
  // 1. 取页面,提取 <script> 内容
  const html = await get('/');
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('页面里没有 <script>');
  const script = m[1] + '\n;global.__run={load,doSearch};';

  // 2. 最小 DOM 桩:所有元素共享按选择器记录的对象
  const made = {};
  function makeEl() {
    return {
      innerHTML: '', textContent: '', value: '', dataset: {}, style: {},
      classList: { add() {}, remove() {}, toggle() {} },
      addEventListener() {},
    };
  }
  global.document = {
    querySelector: sel => (made[sel] = made[sel] || makeEl()),
    querySelectorAll: () => [],
    addEventListener() {},
  };
  global.confirm = () => true;
  global.fetch = async (url) => {
    const body = await get(String(url).replace(base, '').replace(/^http:\/\/localhost:\d+/, ''));
    return { json: async () => JSON.parse(body), ok: true, status: 200 };
  };

  // 3. 执行页面脚本(顶层注册事件 + 自动调 load())
  eval(script);
  await new Promise(r => setTimeout(r, 800));
  made['#q'].value = '';
  await global.__run.doSearch();
  await new Promise(r => setTimeout(r, 800));

  // 4. 断言关键区块渲染非空
  const need = ['#cards', '#models', '#projs', '#plugins', '#mcpsrv', '#skillsinv', '#market'];
  const empty = need.filter(sel => {
    const h = made[sel] && made[sel].innerHTML;
    return !h || h === '<tr></tr>' || h === '';
  });
  if (empty.length) throw new Error('以下区块渲染为空: ' + empty.join(', '));
  const rows = sel => (made[sel].innerHTML.match(/<tr>/g) || []).length - 1;
  console.log('✓ 页面 JS 冒烟测试通过:' + need.length + ' 个区块全部渲染非空');
  console.log('  插件行数:', rows('#plugins'), '| MCP 行数:', rows('#mcpsrv'),
    '| 技能清单行数:', rows('#skillsinv'), '| 市场行数:', rows('#market'));
}

main().then(
  () => process.exit(0),
  e => { console.error('✗ 冒烟测试失败:', e.message); process.exit(1); }
);
