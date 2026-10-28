// 浏览器端到端测试（jsdom 版，无需 Chromium）
// 真实加载前台 index.html / 后台 admin.html，把 fetch + XMLHttpRequest 桥接到
// 真实的 CF Pages Functions 处理器上，前台与后台共享同一份内存 KV。
// 用法: node test/ui.mjs
import jsdomMod from 'jsdom';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { onRequestGet as pubGet, onRequestPost as pubPost } from '../functions/api/public/[[path]].js';
import { onRequestGet as admGet, onRequestPost as admPost } from '../functions/api/admin/[[path]].js';
import { ok } from '../functions/lib/store.js';

const JSDOM = jsdomMod.JSDOM;
const { VirtualConsole } = jsdomMod;
const PUBLIC_DIR = fileURLToPath(new URL('../public', import.meta.url));
const COOKIE_NAME = 'nav_admin';
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function check(name, pass, detail = '') {
  results.push({ name, pass });
  console.log((pass ? '  PASS ' : '  FAIL ') + name + (detail ? '  -> ' + detail : ''));
}

// ---------- 内存 KV（前后台共享） ----------
function makeKV() {
  const map = new Map();
  return {
    async get(k) { return map.has(k) ? map.get(k) : null; },
    async put(k, v) { map.set(k, String(v)); },
    async delete(k) { map.delete(k); },
    async list({ prefix = '' } = {}) { return { keys: [...map.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }; },
  };
}
const env = { NAV_KV: makeKV() };

// ---------- 请求路由到真实处理函数 ----------
async function route(method, url, headers, body) {
  const u = new URL(url, 'http://localhost');
  if (u.pathname.startsWith('/api/public/') && u.pathname.endsWith('/meta')) {
    return ok({ name: 'Example Site', description: 'Mocked site description from meta' }); // 测试环境 mock，避免依赖外网
  }
  const req = new Request(u.toString(), { method, headers, body });
  const ctx = { request: req, env };
  if (u.pathname.startsWith('/api/public/')) return (method === 'GET' ? pubGet : pubPost)(ctx);
  if (u.pathname.startsWith('/api/admin/')) return (method === 'GET' ? admGet : admPost)(ctx);
  return new Response('{"code":0}', { status: 404 });
}

// 每个页面一个 cookie jar，模拟浏览器自动管理 nav_admin cookie
function makeBridge() {
  const cookies = {};
  async function call(method, url, headers = {}, body) {
    const h = { ...headers };
    const ck = Object.entries(cookies).map(([k, v]) => k + '=' + v).join('; ');
    if (ck) h.cookie = ck;
    const res = await route(method, url, h, body);
    const sc = res.headers.get('Set-Cookie');
    if (sc) {
      sc.split(',').forEach((part) => {
        const m = part.match(new RegExp('(?:^|;\\s*)' + COOKIE_NAME + '=([^;]+)'));
        if (m) { if (m[1]) cookies[COOKIE_NAME] = m[1]; else delete cookies[COOKIE_NAME]; }
      });
    }
    return res;
  }
  return {
    fetch: (url, opts = {}) => call((opts.method || 'GET').toUpperCase(), url, opts.headers || {}, opts.body),
    XHR: class {
      constructor() { this.headers = {}; }
      open(m, u) { this.method = m; this.url = u; }
      setRequestHeader(k, v) { this.headers[k] = v; }
      abort() {}
      async send(body) {
        const res = await call(this.method, this.url, this.headers, body);
        this.status = res.status;
        this.responseText = await res.text();
        if (this.onload) this.onload();
      }
    },
  };
}

// 将本地 JS 内联进 HTML，避免 jsdom 去网络拉取外部脚本/资源
function inlineAsset(html, relPath) {
  const js = readFileSync(join(PUBLIC_DIR, relPath), 'utf8');
  const re = new RegExp('<script src="' + relPath.replace(/[./]/g, '\\$&') + '"></script>');
  return html.replace(re, '<script>\n' + js + '\n</script>');
}
function buildHtml(page) {
  let html = readFileSync(join(PUBLIC_DIR, page), 'utf8');
  if (page === 'index.html') html = inlineAsset(html, '/assets/app.js');
  if (page === 'admin.html') html = inlineAsset(html, '/assets/admin.js');
  return html;
}

function createPage(page, bridge, jsErrors) {
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => jsErrors.push('jsdomError: ' + (e && e.message || e)));
  const dom = new JSDOM(buildHtml(page), {
    url: 'http://localhost/',
    runScripts: 'dangerously',          // 不传 resources → jsdom 不会去网络拉取任何外部资源
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      window.fetch = (url, opts) => bridge.fetch(url, opts);
      window.XMLHttpRequest = bridge.XHR;
      window.navigator.sendBeacon = () => true;
      window.open = () => null;
      window.confirm = () => true;
      window.alert = () => {};
      window.scrollTo = () => {};
      window.Blob = Blob;
      try { window.URL.createObjectURL = () => 'blob:mock'; window.URL.revokeObjectURL = () => {}; } catch {}
      try { Object.defineProperty(window.location, 'reload', { value: () => {}, configurable: true }); } catch {}
      window.addEventListener('error', (e) => jsErrors.push('window.error: ' + (e.message || e)));
    },
  });
  return dom;
}

async function waitFor(win, predicate, timeout = 9000, label = '') {
  const start = Date.now();
  for (;;) {
    let okv = false;
    try { okv = predicate(); } catch {}
    if (okv) return true;
    if (Date.now() - start > timeout) { console.log('    (waitFor 超时: ' + label + ')'); return false; }
    await sleep(50);
  }
}

const $ = (win, sel) => win.document.querySelector(sel);
const $$ = (win, sel) => win.document.querySelectorAll(sel);
function setInput(win, sel, value) {
  const el = $(win, sel);
  el.value = value;
  el.dispatchEvent(new win.Event('input', { bubbles: true }));
  el.dispatchEvent(new win.Event('change', { bubbles: true }));
}

// =================== 主流程 ===================
const frontErrors = [];
const front = createPage('index.html', makeBridge(), frontErrors);
const fwin = front.window;

console.log('\n[前台] 渲染');
await waitFor(fwin, () => $(fwin, '#sections .card'), 9000, 'sections/card 渲染');
check('分区渲染 (>=2)', $$(fwin, '.sec').length >= 2, `共 ${$$(fwin, '.sec').length} 个`);
check('站点卡片渲染 (>=2)', $$(fwin, '.card').length >= 2, `共 ${$$(fwin, '.card').length} 张`);
check('搜索引擎渲染 (>=3)', $$(fwin, '.engine-option').length >= 3);
check('快捷标签渲染 (>=3)', $$(fwin, '.tag').length >= 3);
check('友链申请按钮可见', $(fwin, '#lkmBtn') && !$(fwin, '#lkmBtn').hidden);
await waitFor(fwin, () => ($(fwin, '#statsRow')?.textContent || '').includes('今日访问'), 9000, '访问统计');
check('访问统计渲染', ($(fwin, '#statsRow').textContent || '').includes('今日访问'));
await sleep(1200);
check('时钟在跳动', $(fwin, '#clock').textContent !== '00:00:00', $(fwin, '#clock').textContent);

// 本站搜索过滤
console.log('\n[前台] 本站搜索');
const localOpt = $(fwin, '.engine-option[data-mode="local"]');
check('存在「本站」搜索引擎', !!localOpt);
localOpt && localOpt.click();
setInput(fwin, '#sinp', 'GitHub');
await sleep(200);
const hidden = $$(fwin, '.card[hidden]').length;
check('本站搜索过滤生效', hidden >= 1, `${hidden} 张卡片被隐藏`);

// 友链申请弹窗 + 自动获取 meta + 提交
console.log('\n[前台] 友链申请');
$(fwin, '#lkmBtn').click();
check('友链弹窗打开', $$(fwin, '#lkm-wrap.open').length === 1);
setInput(fwin, '#lkmUrl', 'example.org');
$(fwin, '#lkmFetchMeta').click();
await waitFor(fwin, () => ($(fwin, '#lkmName').value || '').length > 0, 5000, 'meta 自动填充');
check('meta 自动填充网站名', ($(fwin, '#lkmName').value || '').length > 0, $(fwin, '#lkmName').value);
if (!$(fwin, '#lkmName').value) setInput(fwin, '#lkmName', 'Example');
if (!$(fwin, '#lkmDesc').value) setInput(fwin, '#lkmDesc', 'desc');
$(fwin, '#lkmSubmit').click();
await waitFor(fwin, () => $(fwin, '#lkmDoneBd').style.display === 'block', 5000, '提交成功态');
check('友链申请提交成功', $(fwin, '#lkmDoneBd').style.display === 'block');

// =================== 后台 ===================
const adminErrors = [];
const admin = createPage('admin.html', makeBridge(), adminErrors);
const awin = admin.window;

console.log('\n[后台] 登录');
await waitFor(awin, () => $(awin, '#loginLayer') && !$(awin, '#loginLayer').hidden, 9000, '登录层显示');
setInput(awin, '#loginUser', 'admin');
setInput(awin, '#loginPass', 'admin123');
$(awin, '#loginForm').dispatchEvent(new awin.Event('submit', { bubbles: true, cancelable: true }));
const loggedIn = await waitFor(awin, () => $(awin, '#appLayer') && !$(awin, '#appLayer').hidden, 9000, '登录进入主界面');
check('登录后进入主界面', loggedIn);
check('工作台统计卡片 (>=6)', $$(awin, '.stat-card').length >= 6, `共 ${$$(awin, '.stat-card').length} 个`);
check('侧边栏菜单渲染 (>=10)', $$(awin, '.menu-item[data-page]').length >= 10, `共 ${$$(awin, '.menu-item[data-page]').length} 项`);

// 遍历所有菜单页
const menuKeys = $$(awin, '.menu-item[data-page]').length
  ? [...$$(awin, '.menu-item[data-page]')].map((e) => e.getAttribute('data-page'))
  : [];
for (const key of menuKeys) {
  awin.document.querySelector('.menu-item[data-page="' + key + '"]').click();
  await sleep(120);
  const len = ($(awin, '#main').textContent || '').trim().length;
  check(`页面「${key}」正常渲染`, len > 50, `${len} 字符`);
}

// 新增分类
console.log('\n[后台] 内容 CRUD');
awin.document.querySelector('.menu-item[data-page="cats"]').click();
await sleep(120);
awin.document.querySelector('#addRow').click();
await sleep(60);
setInput(awin, 'tbody tr:last-child input[data-k="name"]', '测试分类');
awin.document.querySelector('#saveCats').click();
await waitFor(awin, () => !!awin.document.querySelector('tbody input[data-k="name"][value="测试分类"]'), 9000, '分类保存');
check('新分类保存成功', !!awin.document.querySelector('tbody input[data-k="name"][value="测试分类"]'));

// 新增站点
awin.document.querySelector('.menu-item[data-page="sites"]').click();
await sleep(120);
awin.document.querySelector('#addRow').click();
await sleep(60);
setInput(awin, 'tbody tr[data-i]:last-child input[data-k="name"]', '测试站点');
setInput(awin, 'tbody tr[data-i]:last-child input[data-k="url"]', 'https://example.org/');
const sel = awin.document.querySelector('tbody tr[data-i]:last-child select[data-k="cat"]');
const opt = [...sel.options].find((o) => o.textContent === '测试分类');
if (opt) { sel.value = opt.value; sel.dispatchEvent(new awin.Event('change', { bubbles: true })); }
awin.document.querySelector('#saveSites').click();
await waitFor(awin, () => !!awin.document.querySelector('tbody input[data-k="name"][value="测试站点"]'), 9000, '站点保存');
check('新站点保存成功', !!awin.document.querySelector('tbody input[data-k="name"][value="测试站点"]'));

// 前台联动：重新加载前台，确认新分类/站点出现
console.log('\n[前台] 数据联动');
const front2Errors = [];
const front2 = createPage('index.html', makeBridge(), front2Errors);
const f2 = front2.window;
await waitFor(f2, () => ($(f2, '#sections')?.textContent || '').includes('测试站点'), 9000, '前台出现新数据');
check('前台出现新分类与站点', ($(f2, '#sections').textContent || '').includes('测试分类') && ($(f2, '#sections').textContent || '').includes('测试站点'));

// 改密码：错误旧密码提示
console.log('\n[后台] 账号安全');
awin.document.querySelector('.menu-item[data-page="account"]').click();
await sleep(120);
setInput(awin, '#f_old', 'wrongpass');
setInput(awin, '#f_new', 'newpass88');
awin.document.querySelector('#savePwd').click();
await waitFor(awin, () => ($(awin, '#toast')?.textContent || '').includes('当前密码不正确'), 5000, '错误密码提示');
check('错误旧密码有提示', ($(awin, '#toast').textContent || '').includes('当前密码不正确'));

// =================== JS 报错检查 ===================
check('前台无 JS 运行时错误', frontErrors.length === 0, frontErrors.join('; ').slice(0, 300));
check('前台(联动)无 JS 错误', front2Errors.length === 0, front2Errors.join('; ').slice(0, 300));
check('后台无 JS 运行时错误', adminErrors.length === 0, adminErrors.join('; ').slice(0, 300));

front.window.close();
front2.window.close();
admin.window.close();

const failed = results.filter((r) => !r.pass);
console.log('\n========== UI 结果: ' + (results.length - failed.length) + '/' + results.length + ' 通过 ==========');
process.exit(failed.length ? 1 : 0);
