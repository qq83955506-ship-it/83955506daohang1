// 祈福导航 CF 版 —— KV 存储层
// 所有数据都以 JSON 存在 Cloudflare KV 里，key 前缀区分集合。

export const K = {
  CONFIG: 'cfg:main',        // 站点配置（不含管理员凭据）
  ADMIN: 'cfg:admin',        // 管理员账号 + 密码哈希 + 登录安全配置
  SECRET: 'secret:auth',     // 会话签名密钥（自动生成）
  CATEGORIES: 'data:categories',
  SITES: 'data:sites',
  FRIENDS: 'data:friends',
  STATS_PREFIX: 'stats:daily:', // + YYYY-MM-DD → {pv, ip:[...可选]}
  STATS_TOTAL: 'stats:total',   // 总访问量
};

export const APP_VERSION = 'CF-1.0.0';

// ---------- 默认数据 ----------

export function defaultConfig() {
  return {
    sitename: '祈福导航',
    title: '祈福导航 - 导航从这里开始',
    keywords: '网址导航,导航站,友链管理,站点收录',
    description: '祈福导航是一套简洁高效的网址导航，精选优质资源。',
    footer_text: '祈福导航 · 精选优质资源',
    bg_image: '/images/moren.webp',
    overlay_opacity: 52,          // 遮罩不透明度百分比
    clock_style: 'digital',       // digital | simple
    clock_12h: false,
    quick_tags: [
      { label: 'GitHub 趋势', url: 'https://github.com/trending' },
      { label: '掘金', url: 'https://juejin.cn' },
      { label: 'Product Hunt', url: 'https://producthunt.com' },
      { label: '少数派', url: 'https://sspai.com' },
    ],
    engines: [
      { label: '百度', icon: '百', url: 'https://www.baidu.com/s?wd=' },
      { label: 'Google', icon: 'G', url: 'https://www.google.com/search?q=' },
      { label: 'Bing', icon: 'B', url: 'https://www.bing.com/search?q=' },
      { label: '本站', icon: '站', mode: 'local' },
    ],
    default_engine: 0,
    stats_enabled: true,
    show_ip: true,
    link_apply_enabled: true,
    music_enabled: false,
    music_name: '',
    music_url: '',
    ads_enabled: false,
    ads: [
      { position: 'below', image: '', link: '', title: '' },
      { position: 'below', image: '', link: '', title: '' },
      { position: 'below', image: '', link: '', title: '' },
      { position: 'below', image: '', link: '', title: '' },
      { position: 'left', image: '', link: '', title: '' },
      { position: 'right', image: '', link: '', title: '' },
    ],
  };
}

export function defaultCategories() {
  return [
    { id: 'c1', name: '常用推荐', icon: '⭐', sort: 1 },
    { id: 'c2', name: '开发工具', icon: '🛠', sort: 2 },
  ];
}

export function defaultSites() {
  return [
    { id: 's1', cat: 'c1', name: 'Cloudflare', url: 'https://www.cloudflare.com/', desc: '全球网络云平台', color: '#f59e0b', sort: 1, hidden: false, clicks: 0, imps: 0 },
    { id: 's2', cat: 'c2', name: 'GitHub', url: 'https://github.com/', desc: '全球最大代码托管平台', color: '#d97706', sort: 1, hidden: false, clicks: 0, imps: 0 },
  ];
}

export function defaultFriends() {
  return [];
}

// ---------- 基础读写 ----------

export async function kvGet(env, key, fallback) {
  const raw = await env.NAV_KV.get(key);
  if (raw === null) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

export async function kvPut(env, key, value) {
  await env.NAV_KV.put(key, JSON.stringify(value));
}

// 首次访问自动初始化（幂等）
export async function ensureInit(env) {
  const admin = await kvGet(env, K.ADMIN, null);
  if (!admin) {
    await kvPut(env, K.ADMIN, {
      user: 'admin',
      pwd: await hashPassword('admin123'), // 首次部署默认密码 admin123，登录后请立即修改
      pv: 1, // 密码版本号：改密后 +1，旧 token 立即失效
      updated_at: Date.now(),
    });
  }
  const secret = await env.NAV_KV.get(K.SECRET);
  if (!secret) {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    await env.NAV_KV.put(K.SECRET, Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(''));
  }
  for (const [key, fallback] of [
    [K.CONFIG, defaultConfig()],
    [K.CATEGORIES, defaultCategories()],
    [K.SITES, defaultSites()],
    [K.FRIENDS, defaultFriends()],
  ]) {
    const v = await kvGet(env, key, null);
    if (v === null) await kvPut(env, key, fallback);
  }
}

// ---------- 密码哈希（PBKDF2-SHA256） ----------

export async function hashPassword(password, iterations = 100000) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, iterations);
  return { alg: 'PBKDF2-SHA256', iterations, salt: b64(salt), hash: b64(hash) };
}

export async function verifyPassword(password, stored) {
  if (!stored || stored.alg !== 'PBKDF2-SHA256') return false;
  const salt = unb64(stored.salt);
  const hash = await pbkdf2(password, salt, stored.iterations || 100000);
  return timingSafeEqual(hash, unb64(stored.hash));
}

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

function b64(bytes) { return btoa(String.fromCharCode(...bytes)); }
function unb64(str) { return Uint8Array.from(atob(str), c => c.charCodeAt(0)); }
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ---------- 统计 ----------

// 以东八区（原版 PRC）计算日期 key；offsetDays 用于取昨日
export function todayKey(offsetDays = 0) {
  const d = new Date(Date.now() + 8 * 3600000 - offsetDays * 86400000);
  return d.toISOString().slice(0, 10);
}

export async function bumpVisit(env, ip) {
  const day = todayKey();
  const daily = await kvGet(env, K.STATS_PREFIX + day, { pv: 0 });
  daily.pv += 1;
  await kvPut(env, K.STATS_PREFIX + day, daily);
  const totalRaw = await env.NAV_KV.get(K.STATS_TOTAL);
  const total = (parseInt(totalRaw || '0', 10) || 0) + 1;
  await env.NAV_KV.put(K.STATS_TOTAL, String(total));
  return { today: daily.pv, total };
}

export async function readStats(env) {
  const day = todayKey();
  const yesterday = todayKey(1);
  const daily = await kvGet(env, K.STATS_PREFIX + day, { pv: 0 });
  const y = await kvGet(env, K.STATS_PREFIX + yesterday, { pv: 0 });
  const totalRaw = await env.NAV_KV.get(K.STATS_TOTAL);
  return { today: daily.pv || 0, yesterday: y.pv || 0, total: parseInt(totalRaw || '0', 10) || 0 };
}

// ---------- 工具 ----------

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

export function ok(data = {}, headers = {}) { return json({ code: 1, data }, 200, headers); }
export function fail(msg, code = 0, status = 200) { return json({ code, msg }, status); }

export function genId(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// 校验 URL（只允许 http/https）；裸域名自动补 https://
export function safeUrl(u) {
  let s = String(u || '').trim();
  if (!s) return '';
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s) && /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}([\/?#].*)?$/i.test(s)) s = 'https://' + s;
  try {
    const p = new URL(s);
    return (p.protocol === 'http:' || p.protocol === 'https:') ? p.href : '';
  } catch { return ''; }
}

// 清洗站点/分类数据，防止注入垃圾字段
export function sanitizeSite(s) {
  return {
    id: String(s.id || genId('s')),
    cat: String(s.cat || ''),
    name: String(s.name || '').slice(0, 60),
    url: safeUrl(s.url),
    desc: String(s.desc || '').slice(0, 120),
    color: /^#[0-9a-fA-F]{3,8}$/.test(s.color || '') ? s.color : '#6366f1',
    sort: Math.max(0, Math.min(9999, parseInt(s.sort, 10) || 0)),
    hidden: !!s.hidden,
    clicks: Math.max(0, parseInt(s.clicks, 10) || 0),
    imps: Math.max(0, parseInt(s.imps, 10) || 0),
  };
}

export function sanitizeCategory(c) {
  return {
    id: String(c.id || genId('c')),
    name: String(c.name || '').slice(0, 30),
    icon: String(c.icon || '⭐').slice(0, 4),
    sort: Math.max(0, Math.min(9999, parseInt(c.sort, 10) || 0)),
  };
}

export function sanitizeFriend(f) {
  return {
    id: String(f.id || genId('f')),
    name: String(f.name || '').slice(0, 60),
    url: safeUrl(f.url),
    desc: String(f.desc || '').slice(0, 120),
    cat: String(f.cat || '').slice(0, 30),
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email || '') ? f.email : '',
    status: ['pending', 'approved', 'rejected'].includes(f.status) ? f.status : 'pending',
    createdAt: parseInt(f.createdAt, 10) || Date.now(),
  };
}
