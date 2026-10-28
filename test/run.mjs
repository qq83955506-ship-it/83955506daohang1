// 端到端验证：在 Node 里模拟 CF Pages Functions 环境（KV / Request / Response）
// 用法: node test/run.mjs
import { onRequestGet as pubGet, onRequestPost as pubPost } from '../functions/api/public/[[path]].js';
import { onRequestGet as admGet, onRequestPost as admPost } from '../functions/api/admin/[[path]].js';

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass, detail });
  console.log((pass ? '  PASS ' : '  FAIL ') + name + (detail ? '  -> ' + detail : ''));
}

// ---------- Mock KV ----------
function makeKV() {
  const map = new Map();
  return {
    async get(key) { return map.has(key) ? map.get(key) : null; },
    async put(key, val) { map.set(key, String(val)); },
    async delete(key) { map.delete(key); },
    async list({ prefix = '' } = {}) {
      return { keys: [...map.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) };
    },
    _map: map,
  };
}
const env = { NAV_KV: makeKV() };

function ctxGet(url, extraHeaders = {}) {
  return { request: new Request('http://localhost' + url, { headers: extraHeaders }), env };
}
function ctxPost(url, body, extraHeaders = {}) {
  return {
    request: new Request('http://localhost' + url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...extraHeaders },
      body: JSON.stringify(body),
    }),
    env,
  };
}
async function jresp(p) { const r = await p; return { status: r.status, body: await r.json(), headers: r.headers }; }

// ---------- 1. 公开接口：首次自动初始化 ----------
console.log('\n[1] 公开接口 / 自动初始化');
{
  const r = await jresp(pubGet(ctxGet('/api/public/site')));
  check('GET site 返回 code=1', r.body.code === 1, JSON.stringify(r.body).slice(0, 80));
  check('默认配置存在', r.body.data.config.sitename === '祈福导航');
  check('默认分类 2 个', r.body.data.categories.length === 2);
  check('默认站点 2 个', r.body.data.sites.length === 2);
  check('不含管理员敏感字段', !JSON.stringify(r.body).includes('pwd'));
}

// ---------- 2. 管理员登录 ----------
console.log('\n[2] 管理员登录');
let adminCookie = '';
{
  const bad = await jresp(admPost(ctxPost('/api/admin/login', { user: 'admin', pass: 'wrong' })));
  check('错误密码被拒绝', bad.body.code !== 1);

  const good = await jresp(admPost(ctxPost('/api/admin/login', { user: 'admin', pass: 'admin123' })));
  check('默认账号 admin/admin123 登录成功', good.body.code === 1);
  const sc = good.headers.get('Set-Cookie') || '';
  adminCookie = (sc.match(/nav_admin=[^;]+/) || [''])[0];
  check('下发了 HttpOnly 会话 Cookie', adminCookie.startsWith('nav_admin=') && sc.includes('HttpOnly'));

  const noAuth = await jresp(admGet(ctxGet('/api/admin/data')));
  check('无 Cookie 访问管理接口 401', noAuth.status === 401);
}

// ---------- 3. 管理数据读取 ----------
console.log('\n[3] 管理数据');
{
  const r = await jresp(admGet(ctxGet('/api/admin/data', { Cookie: adminCookie })));
  check('GET data 成功', r.body.code === 1);
  check('概览统计正确(2站点/0待审)', r.body.data.overview.sites === 2 && r.body.data.overview.pending === 0);
}

// ---------- 4. CRUD：分类 / 站点 ----------
console.log('\n[4] 站点与分类 CRUD');
{
  const cats = [
    { id: 'c1', name: '常用推荐', icon: '⭐', sort: 1 },
    { id: 'c2', name: '开发工具', icon: '🛠', sort: 2 },
  ];
  let r = await jresp(admPost(ctxPost('/api/admin/save', { collection: 'categories', items: cats }, { Cookie: adminCookie })));
  check('保存分类', r.body.code === 1);

  const sites = [
    { id: 's1', cat: 'c1', name: 'Cloudflare', url: 'https://www.cloudflare.com/', desc: '云平台', color: '#f59e0b', sort: 1, clicks: 0, imps: 0 },
    { id: 's2', cat: 'c2', name: 'GitHub', url: 'github.com/', desc: '代码托管', color: '#d97706', sort: 2, clicks: 0, imps: 0 }, // 无协议 URL 应被清洗或拒收
    { id: 's3', cat: 'c1', name: '坏站点', url: 'javascript:alert(1)', desc: 'xss', sort: 3 }, // 非法协议应被清空
  ];
  r = await jresp(admPost(ctxPost('/api/admin/save', { collection: 'sites', items: sites }, { Cookie: adminCookie })));
  check('保存站点', r.body.code === 1);

  const site = JSON.parse(env.NAV_KV._map.get('data:sites'));
  const s2 = site.find(x => x.id === 's2');
  const s3 = site.find(x => x.id === 's3');
  check('裸域名自动补全 https://', s2.url === 'https://github.com/');
  check('javascript: 协议被拒绝(url 置空)', s3.url === '');
}

// ---------- 5. 配置保存 ----------
console.log('\n[5] 配置保存');
{
  let r = await jresp(admPost(ctxPost('/api/admin/config', { sitename: '李楠导航', overlay_opacity: 999, footer_text: '测试底部' }, { Cookie: adminCookie })));
  check('保存配置', r.body.code === 1);
  const cfg = JSON.parse(env.NAV_KV._map.get('cfg:main'));
  check('站名已更新', cfg.sitename === '李楠导航');
  check('遮罩透明度被夹取到 90', cfg.overlay_opacity === 90);
}

// ---------- 6. 访问统计 ----------
console.log('\n[6] 访问统计与点击');
{
  await jresp(pubPost(ctxPost('/api/public/track', { type: 'visit' }, { 'CF-Connecting-IP': '1.2.3.4' })));
  const r = await jresp(pubPost(ctxPost('/api/public/track', { type: 'visit' }, { 'CF-Connecting-IP': '1.2.3.4' })));
  check('两次访问后 today=2', r.body.data.today === 2);
  check('total=2', r.body.data.total === 2);
  check('返回 IP', r.body.data.ip === '1.2.3.4');

  const c = await jresp(pubPost(ctxPost('/api/public/track', { type: 'click', site_id: 's1' })));
  check('点击统计成功', c.body.code === 1);
  const site = JSON.parse(env.NAV_KV._map.get('data:sites'));
  check('s1 点击量 +1', site.find(x => x.id === 's1').clicks === 1);
}

// ---------- 7. 友链申请 ----------
console.log('\n[7] 友链申请');
{
  let r = await jresp(pubPost(ctxPost('/api/public/link', { name: '测试站', url: 'example.com', desc: '描述', cat: '', email: 'a@b.com' })));
  check('申请成功(自动补协议)', r.body.code === 1);
  r = await jresp(pubPost(ctxPost('/api/public/link', { name: '测试站2', url: 'https://example.com/', desc: '', email: '' })));
  check('重复申请被拦截', r.body.code !== 1 && String(r.body.msg).includes('已提交过申请'));
  r = await jresp(pubPost(ctxPost('/api/public/link', { name: '坏站', url: 'javascript:alert(1)' })));
  check('非法 URL 被拒绝', r.body.code !== 1);
  // 限频：本小时已用 2 次（成功1+重复1不计入? 成功1、重复未入库但限频计数在重复检查之后...查看代码：重复检查在限频之前 return），所以只有1次计数，再发4次成功触发限频
  for (let i = 0; i < 5; i++) await jresp(pubPost(ctxPost('/api/public/link', { name: '站' + i, url: 'https://site' + i + '.com/' })));
  r = await jresp(pubPost(ctxPost('/api/public/link', { name: '超限', url: 'https://over.com/' })));
  check('每小时 5 条限频生效', r.body.code !== 1, r.body.msg);
}

// ---------- 8. 友链审核 ----------
console.log('\n[8] 友链审核');
{
  let data = await jresp(admGet(ctxGet('/api/admin/data', { Cookie: adminCookie })));
  const friends = data.body.data.friends;
  check('友链已入库', friends.length >= 2);
  const approved = friends.map(f => ({ ...f, status: f.status === 'pending' ? 'approved' : f.status }));
  const r = await jresp(admPost(ctxPost('/api/admin/save', { collection: 'friends', items: approved }, { Cookie: adminCookie })));
  check('批量审核通过', r.body.code === 1);
  const pub = await jresp(pubGet(ctxGet('/api/public/site')));
  check('通过后前台可见', pub.body.data.friends.length >= 2);
}

// ---------- 9. meta 抓取（非法 URL 分支） ----------
console.log('\n[9] meta 接口');
{
  const r = await jresp(pubGet(ctxGet('/api/public/meta?url=javascript:alert(1)')));
  check('非法 URL 返回失败', r.body.code !== 1);
}

// ---------- 10. 修改密码 + 旧会话失效 ----------
console.log('\n[10] 账号安全');
{
  let r = await jresp(admPost(ctxPost('/api/admin/password', { old_pass: 'bad', new_pass: 'newpass66' }, { Cookie: adminCookie })));
  check('旧密码错误被拒', r.body.code !== 1);
  r = await jresp(admPost(ctxPost('/api/admin/password', { old_pass: 'admin123', new_pass: 'newpass66' }, { Cookie: adminCookie })));
  check('修改密码成功', r.body.code === 1);
  const after = await jresp(admGet(ctxGet('/api/admin/data', { Cookie: adminCookie })));
  check('改密后旧会话失效(401)', after.status === 401);
  const relogin = await jresp(admPost(ctxPost('/api/admin/login', { user: 'admin', pass: 'newpass66' })));
  check('新密码可登录', relogin.body.code === 1);
  adminCookie = (relogin.headers.get('Set-Cookie').match(/nav_admin=[^;]+/) || [''])[0];
}

// ---------- 11. 备份导出/恢复 ----------
console.log('\n[11] 备份与恢复');
{
  let r = await jresp(admGet(ctxGet('/api/admin/backup', { Cookie: adminCookie })));
  check('导出备份', r.body.code === 1);
  check('备份不含密码', !JSON.stringify(r.body.data).includes('pwd'));
  const backup = JSON.parse(JSON.stringify(r.body.data));
  await jresp(admPost(ctxPost('/api/admin/config', { sitename: '覆盖前' }, { Cookie: adminCookie })));
  r = await jresp(admPost(ctxPost('/api/admin/restore', { data: backup }, { Cookie: adminCookie })));
  check('恢复成功', r.body.code === 1);
  const cfg = JSON.parse(env.NAV_KV._map.get('cfg:main'));
  check('配置已还原', cfg.sitename === '李楠导航');
}

// ---------- 12. 清空统计 ----------
console.log('\n[12] 清空统计');
{
  const r = await jresp(admPost(ctxPost('/api/admin/reset-stats', {}, { Cookie: adminCookie })));
  check('清空成功', r.body.code === 1);
  const total = await env.NAV_KV.get('stats:total');
  check('总量归零', total === '0');
}

// ---------- 汇总 ----------
const failed = results.filter(r => !r.pass);
console.log('\n========== 结果: ' + (results.length - failed.length) + '/' + results.length + ' 通过 ==========');
if (failed.length) {
  failed.forEach(f => console.log('FAIL: ' + f.name + ' ' + f.detail));
  process.exit(1);
}
