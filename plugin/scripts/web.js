'use strict';
// cc-butler 本地网页仪表盘:node web.js [--port 3789]
// 单页应用,原生 JS + 纯 CSS 条形图,无外部依赖,仅监听 127.0.0.1。
// 支持在页面里直接安装/卸载/更新/启用/禁用插件(POST /api/action,带同源保护)。
const http = require('http');
const { URL } = require('url');
const stats = require('./lib/stats');
const market = require('./lib/market');
const { listMcp } = require('./lib/mcp');
const { listInstalledSkills } = require('./lib/inventory');

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function page() {
return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>cc-butler · 插件管家</title>
<style>
:root{--bg:#0f1115;--card:#171a21;--fg:#e6e9ef;--dim:#8b93a7;--acc:#5b9dff;--ok:#3fb96f;--warn:#e0a83f}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--fg);font:14px/1.6 "Segoe UI",system-ui,sans-serif;padding:24px;max-width:1200px;margin:0 auto}
h1{font-size:20px;margin-bottom:4px}
.sub{color:var(--dim);font-size:12px;margin-bottom:16px}
.tabs{display:flex;gap:4px;margin-bottom:16px;flex-wrap:wrap}
.tabs button{background:var(--card);color:var(--dim);border:0;padding:8px 16px;border-radius:8px 8px 0 0;cursor:pointer;font-size:14px}
.tabs button.on{color:var(--fg);border-bottom:2px solid var(--acc)}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:18px}
.card{background:var(--card);border-radius:10px;padding:12px 14px}
.card .k{color:var(--dim);font-size:12px}
.card .v{font-size:20px;font-weight:600;margin-top:2px}
table{width:100%;border-collapse:collapse;background:var(--card);border-radius:10px;overflow:hidden;margin-bottom:18px}
th{color:var(--dim);font-weight:500;text-align:left;font-size:12px;padding:8px 12px;border-bottom:1px solid #232838}
td{padding:7px 12px;border-bottom:1px solid #1d2230;font-size:13px;vertical-align:middle}
tr:last-child td{border-bottom:0}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
.bar{background:#232a3d;border-radius:4px;height:14px;position:relative;min-width:60px}
.bar i{position:absolute;left:0;top:0;bottom:0;background:linear-gradient(90deg,#3b6fd4,#5b9dff);border-radius:4px}
.bar span{position:absolute;right:6px;top:-1px;font-size:11px;color:var(--fg)}
h2{font-size:15px;margin:18px 0 8px;color:var(--acc)}
.note{color:var(--dim);font-size:12px;margin-bottom:12px}
#mkt{display:flex;gap:8px;margin-bottom:12px}
#mkt input{flex:1;background:var(--card);border:1px solid #2a3145;color:var(--fg);border-radius:8px;padding:8px 12px;font-size:14px}
#mkt button{background:var(--acc);border:0;color:#fff;border-radius:8px;padding:8px 18px;cursor:pointer}
.stars{color:var(--warn)}
.dayrow{display:grid;grid-template-columns:88px 1fr 1fr;gap:8px;align-items:center;margin-bottom:4px;font-size:12px}
.dayrow .lab{color:var(--dim)}
.hidden{display:none}
.stack{display:flex;height:20px;border-radius:6px;overflow:hidden;background:var(--card);margin-bottom:8px}
.stack i{display:block;height:100%}
.mixleg{display:flex;gap:14px;font-size:12px;color:var(--dim);margin-bottom:14px;flex-wrap:wrap}
.mixleg b{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px;vertical-align:-1px}
.btn{background:#232a3d;border:1px solid #2a3145;color:var(--fg);border-radius:6px;padding:3px 10px;font-size:12px;cursor:pointer;margin:1px 2px;white-space:nowrap}
.btn:hover{border-color:var(--acc)}
.btn.warn{border-color:#7a4a2a;color:var(--warn)}
.btn.danger{border-color:#6e2f2f;color:#e07070}
.btn.ok{border-color:#2a5a3d;color:var(--ok)}
#toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#1d2230;border:1px solid #2a3145;border-radius:8px;padding:10px 16px;font-size:13px;max-width:80%;display:none;white-space:pre-wrap;z-index:9;box-shadow:0 4px 24px rgba(0,0,0,.4)}
</style>
</head>
<body>
<h1>🛎️ cc-butler · Claude Code 插件管家</h1>
<div class="sub">数据来源:本地转录与插件注册表,按需统计,零常驻开销 · 页面内可直接 安装/卸载/更新/启停(仅本机访问)<span id="gen"></span></div>
<div class="tabs">
  <button data-t="ov" class="on">总览</button>
  <button data-t="sk">技能</button>
  <button data-t="pg">插件管理</button>
  <button data-t="mk">市场</button>
</div>
<div class="tabs"><span class="sub" style="align-self:center">统计窗口:</span>
  <button class="w" data-d="7">7 天</button><button class="w on" data-d="30">30 天</button><button class="w" data-d="90">90 天</button><button class="w" data-d="3650">全部</button>
</div>

<div id="t-ov">
  <div class="cards" id="cards"></div>
  <h2 style="margin-top:2px">Token 构成</h2>
  <div class="stack" id="mix"></div>
  <div class="mixleg" id="mixleg"></div>
  <h2>每日输出 token 趋势</h2><div class="note">蓝条=输出,深条=输入(各自独立归一化)</div>
  <div id="days"></div>
  <h2>按模型</h2><table id="models"></table>
  <h2>按项目</h2><table id="projs"></table>
  <h2>MCP 调用</h2><table id="mcps"></table>
</div>
<div id="t-sk" class="hidden">
  <h2>技能使用排行</h2><div class="note">token 归因为启发式:从 Skill 调用起至对应 tool_result 返回止</div>
  <table id="skills"></table>
  <h2>已安装技能清单</h2><div class="note">插件自带 + 用户级全部技能(不依赖是否被调用过)</div>
  <table id="skillsinv"></table>
  <h2>子代理类型</h2><table id="agents"></table>
</div>
<div id="t-pg" class="hidden">
  <h2>已安装插件 · 管控</h2>
  <div class="note">更新/启停/卸载在本页直接操作;操作成功后需重启 Claude Code 会话生效。后台 SDK 会话多或挂 hot hooks 的插件,禁用可显著省配额。</div>
  <table id="plugins"></table>
  <h2>MCP 服务器(user/local 级)</h2>
  <div class="note">不走插件市场体系、但同样占会话上下文(user 级每个会话都加载);不用可移除</div>
  <table id="mcpsrv"></table>
</div>
<div id="t-mk" class="hidden">
  <div id="mkt"><input id="q" placeholder="搜索插件:名称 / 描述 / 关键词(留空显示 ⭐ 热度排行)"><button onclick="doSearch()">搜索</button></div>
  <div class="note">⭐ 为 GitHub 热度参考(非官方安装量);官方市场自带插件的 stars 来自市场仓库,已排在独立仓库插件之后;点"安装"直接装,装完到"插件管理"页启停</div>
  <table id="market"></table>
</div>
<div id="toast"></div>

<script>
const $=s=>document.querySelector(s);
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>n==null?'-':(n>=1e6?(n/1e6).toFixed(1)+'M':n>=1e3?(n/1e3).toFixed(1)+'K':String(n));
let R=null,DAYS=30;
document.querySelectorAll('.tabs [data-t]').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('.tabs [data-t]').forEach(x=>x.classList.remove('on'));b.classList.add('on');
  ['ov','sk','pg','mk'].forEach(t=>$('#t-'+t).classList.toggle('hidden',t!==b.dataset.t));
  if(b.dataset.t==='mk'&&!$('#market').dataset.done)doSearch();
});
document.querySelectorAll('.w').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('.w').forEach(x=>x.classList.remove('on'));b.classList.add('on');
  DAYS=+b.dataset.d;load();
});
function tbl(el,head,rows){
  el.innerHTML='<tr>'+head.map(h=>'<th'+(h.num?' class="num"':'')+'>'+h.t+'</th>').join('')+'</tr>'+
    rows.map(r=>'<tr>'+r.map(c=> typeof c==='object'&&c.bar
      ?'<td style="width:30%"><div class="bar"><i style="width:'+c.bar.pct+'%"></i><span>'+esc(c.bar.t)+'</span></div></td>'
      : typeof c==='object'&&c.html
      ? '<td>'+c.html+'</td>'
      :'<td'+(c.num?' class="num"':'')+'>'+esc(c.t)+'</td>').join('')+'</tr>').join('');
}
let toastTimer=null;
function toast(msg){const t=$('#toast');t.textContent=msg;t.style.display='block';clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.style.display='none',10000);}
async function act(action,target,confirmMsg){
  if(confirmMsg&&!confirm(confirmMsg))return;
  toast('⏳ 执行中: '+action+' '+target+' …');
  try{
    const r=await (await fetch('/api/action',{method:'POST',headers:{'Content-Type':'application/json','X-Butler':'1'},body:JSON.stringify({action,target})})).json();
    toast((r.code===0?'✅ 成功: ':'❌ 失败(code '+r.code+'): ')+action+' '+target+'\\n'+[r.stdout,r.stderr].filter(Boolean).join('\\n')+'\\n(重启会话后生效)');
    load();if($('#market').dataset.done)doSearch();
  }catch(e){toast('❌ 请求失败: '+e.message)}
}
document.addEventListener('click',e=>{
  const b=e.target.closest('button[data-a]');if(!b)return;
  act(b.dataset.a,b.dataset.t,b.dataset.c||null);
});
function plugBtns(p){
  const t=esc(p.id);
  return '<button class="btn" data-a="update" data-t="'+t+'" data-c="更新 '+esc(p.name)+' 到最新版?">更新</button>'+
    (p.enabled
      ?'<button class="btn warn" data-a="disable" data-t="'+t+'" data-c="禁用 '+esc(p.name)+'?其 hooks/命令/MCP 将立即失效(重启会话)。">禁用</button>'
      :'<button class="btn ok" data-a="enable" data-t="'+t+'">启用</button>')+
    '<button class="btn danger" data-a="uninstall" data-t="'+t+'" data-c="确定卸载 '+esc(p.name)+'?(使用 '+p.usageCount+' 次)卸载后重启会话生效。">卸载</button>';
}
function mcpBtns(m){
  return '<button class="btn danger" data-a="mcp-remove" data-t="'+esc(m.name)+'" data-c="移除 MCP 服务器 '+esc(m.name)+'?移除后新会话不再加载其工具。">移除</button>';
}
async function load(){
  try{
  const [rep,mcpInv,skInv]=await Promise.all([
    fetch('/api/report?days='+DAYS).then(r=>r.json()),
    fetch('/api/mcp').then(r=>r.json()),
    fetch('/api/skills-inv').then(r=>r.json()),
  ]);
  R=rep;
  $('#gen').textContent=' · 统计时间 '+new Date(R.generatedAt).toLocaleString('zh-CN');
  const a=R.totals.all,b=R.totals.background,w=R.totals.window;
  const tot=a.in+a.out+a.cr+a.cc||1;
  const seg=[['输入',a.in,'#3b82f6'],['输出',a.out,'#3fb96f'],['缓存读',a.cr,'#8b5cf6'],['缓存写',a.cc,'#e0a83f']].filter(x=>x[1]>0);
  $('#mix').innerHTML=seg.map(x=>'<i style="width:'+(x[1]/tot*100).toFixed(2)+'%;background:'+x[2]+'" title="'+x[0]+' '+fmt(x[1])+'('+(x[1]/tot*100).toFixed(1)+'%)"></i>').join('');
  $('#mixleg').innerHTML=seg.map(x=>'<span><b style="background:'+x[2]+'"></b>'+x[0]+' '+fmt(x[1])+' · '+(x[1]/tot*100).toFixed(1)+'%</span>').join('');
  $('#cards').innerHTML=[
    ['输入 token',fmt(a.in)],['输出 token',fmt(a.out)],['缓存读取',fmt(a.cr)],
    ['交互会话',a.sessions+' 个'],['后台 SDK 会话',b.sessions+' 个'],
    ['窗口 '+DAYS+' 天输出',fmt(w.out)],['技能调用',R.skills.reduce((x,s)=>x+s.count,0)+' 次'],['启动次数',R.numStartups??'-']
  ].map(c=>'<div class="card"><div class="k">'+c[0]+'</div><div class="v">'+c[1]+'</div></div>').join('');
  const days=R.byDay.slice(-Math.min(DAYS,60));
  const mx=Math.max(1,...days.map(d=>d.out)),mxi=Math.max(1,...days.map(d=>d.in));
  $('#days').innerHTML=days.map(d=>
    '<div class="dayrow"><div class="lab">'+d.day.slice(5)+'</div>'+
    '<div class="bar"><i style="width:'+(d.in/mxi*100).toFixed(1)+'%;background:#2c3550"></i><span style="color:#8b93a7">'+fmt(d.in)+'</span></div>'+
    '<div class="bar"><i style="width:'+(d.out/mx*100).toFixed(1)+'%"></i><span>'+fmt(d.out)+'</span></div></div>').join('');
  const mmx=Math.max(1,...R.byModel.map(m=>m.out));
  tbl($('#models'),[{t:'模型'},{t:'输入',num:1},{t:'输出',num:1},{t:'缓存读',num:1},{t:'消息数',num:1},{t:'占比',num:1}],
    R.byModel.map(m=>[{t:m.model},{t:fmt(m.in),num:1},{t:fmt(m.out),num:1},{t:fmt(m.cr),num:1},{t:m.msgs,num:1},
      {bar:{pct:(m.out/mmx*100).toFixed(1),t:(m.out/Math.max(1,a.out)*100).toFixed(1)+'%'}}]));
  const pmx=Math.max(1,...R.byProject.map(p=>p.out));
  tbl($('#projs'),[{t:'项目'},{t:'输出',num:1},{t:'会话',num:1},{t:'占比',num:1}],
    R.byProject.map(p=>[{t:p.project},{t:fmt(p.out),num:1},{t:p.sessions,num:1},{bar:{pct:(p.out/pmx*100).toFixed(1),t:''}}]));
  tbl($('#mcps'),[{t:'Server'},{t:'归属'},{t:'调用次数',num:1}],
    R.mcp.map(m=>[{t:m.server},{t:m.plugin},{t:m.count,num:1}]));
  const smx=Math.max(1,...R.skills.map(s=>s.count));
  tbl($('#skills'),[{t:'技能'},{t:'所属插件'},{t:'次数',num:1},{t:'归因输出',num:1},{t:'占比',num:1}],
    R.skills.map(s=>[{t:s.name},{t:s.plugin||'(内置/用户)'},{t:s.count,num:1},{t:fmt(s.tokens.out),num:1},
      {bar:{pct:(s.count/smx*100).toFixed(1),t:''}}]));
  tbl($('#agents'),[{t:'子代理类型'},{t:'调用次数',num:1}],
    R.agents.map(a=>[{t:a.type},{t:a.count,num:1}]));
  tbl($('#plugins'),[{t:'插件'},{t:'市场'},{t:'版本'},{t:'启用'},{t:'使用次数',num:1},{t:'技能/MCP',num:1},{t:'后台会话',num:1},{t:'操作'}],
    R.plugins.map(p=>[{t:p.name},{t:p.marketplace||'-'},{t:p.version||'-'},{t:p.enabled?'✓':'✗'},
      {t:p.usageCount,num:1},{t:(p.skillCalls||0)+' / '+(p.mcpCalls||0),num:1},
      {t:p.backgroundTokens?p.backgroundTokens.sessions+' 个':'-',num:1},
      {html:plugBtns(p)}]));
  tbl($('#mcpsrv'),[{t:'名称'},{t:'范围'},{t:'类型'},{t:'命令/URL'},{t:'近期调用',num:1},{t:'建议'},{t:'操作'}],
    mcpInv.map(m=>[
      {t:m.name},{t:m.scope},{t:m.type},
      {t:m.command?[m.command].concat(m.args||[]).join(' '):m.url||'-'},
      {t:m.calls,num:1},{t:m.reason},{html:mcpBtns(m)}]));
  const usageByName={};R.skills.forEach(s=>usageByName[s.fullName]=s.count);
  tbl($('#skillsinv'),[{t:'技能'},{t:'来源'},{t:'近期调用',num:1},{t:'描述'}],
    skInv.map(s=>{const full=s.plugin==='(user)'?s.name:s.plugin+':'+s.name;
      return [{t:s.name},{t:s.plugin},{t:usageByName[full]||0,num:1},{t:(s.description||'').slice(0,70)}];}));
  }catch(e){toast('❌ 数据加载失败: '+e.message+'(请刷新重试)');}
}
async function doSearch(){
  const q=$('#q').value.trim();
  const url=q?'/api/market?q='+encodeURIComponent(q):'/api/market?top=30';
  const r=await (await fetch(url)).json();
  if(r.top)toast('⭐ 已按 GitHub stars 排序显示前 '+r.results.length+' 名(24h 缓存,受限时部分为空)');
  tbl($('#market'),[{t:'#',num:1},{t:'插件'},{t:'市场'},{t:'版本'},{t:'⭐'},{t:'描述'},{t:'操作'}],
    r.results.map((p,i)=>[{t:i+1,num:1},{t:p.name},{t:p.marketplace},{t:p.version||'-'},{t:p.stars!=null?p.stars.toLocaleString():'…'},
      {t:(p.description||'').slice(0,80)},
      {html:'<button class="btn ok" data-a="install" data-t="'+esc(p.name+'@'+p.marketplace)+'" data-c="安装 '+esc(p.name)+'('+(p.version||'最新版')+',来自 '+esc(p.marketplace)+')?">安装</button>'}]));
  $('#market').dataset.done='1';
}
$('#q').addEventListener('keydown',e=>{if(e.key==='Enter')doSearch()});
load();
</script>
</body>
</html>`;
}

const ACTIONS = {
  install: 'installPlugin',
  uninstall: 'uninstallPlugin',
  update: 'updatePlugin',
  enable: 'enablePlugin',
  disable: 'disablePlugin',
};

function loadJsonSafe() {
  try { return JSON.parse(require('fs').readFileSync(require('./lib/cache').STARS_FILE, 'utf8')); } catch { return {}; }
}

function handleAction(req, res) {
  // 同源保护:自定义头 + 无 CORS 头,浏览器跨源请求过不了 preflight
  if (req.headers['x-butler'] !== '1') {
    res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ error: 'forbidden' }));
  }
  let body = '';
  req.on('data', d => { body += d; if (body.length > 10240) req.destroy(); });
  req.on('end', () => {
    try {
      const { action, target } = JSON.parse(body);
      let r;
      if (action === 'mcp-remove') {
        if (!target || typeof target !== 'string') throw new Error('bad target');
        r = require('./lib/mcp').removeMcp(target);
      } else {
        const fn = ACTIONS[action];
        if (!fn || !target || typeof target !== 'string') throw new Error('bad action/target');
        r = market[fn](target);
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ action, target, ...r }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
}

function start(port) {
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    try {
      if (req.method === 'POST' && u.pathname === '/api/action') return handleAction(req, res);
      if (u.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(page());
      }
      if (u.pathname === '/api/report') {
        const days = parseInt(u.searchParams.get('days'), 10) || 30;
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify(stats.collect(days)));
      }
      if (u.pathname === '/api/market') {
        if (u.searchParams.get('top')) {
          const results = await market.topPlugins(parseInt(u.searchParams.get('top'), 10) || 30);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ query: '(热度排行)', total: results.length, results }));
        }
        const q = u.searchParams.get('q') || '';
        const results = market.searchPlugins(q).slice(0, 50);
        await market.fetchStarsBulk(results.map(p => p.repo).filter(Boolean));
        const cache = loadJsonSafe();
        const withStars = results
          .map(p => ({ ...p, stars: cache[p.repo] ? cache[p.repo].stars : p.stars }))
          .sort((a, b) => (b.stars ?? -1) - (a.stars ?? -1));
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ query: q, total: results.length, results: withStars }));
      }
      if (u.pathname === '/api/mcp') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify(listMcp()));
      }
      if (u.pathname === '/api/skills-inv') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify(listInstalledSkills()));
      }
      res.writeHead(404); res.end('not found');
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
  server.listen(port, '127.0.0.1', () => {
    console.log('cc-butler 仪表盘已启动: http://localhost:' + port + '  (Ctrl+C 停止)');
  });
}

module.exports = { start, page };
if (require.main === module) {
  const i = process.argv.indexOf('--port');
  start(i >= 0 ? parseInt(process.argv[i + 1], 10) || 3789 : 3789);
}
