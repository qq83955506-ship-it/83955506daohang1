// 管理 API：/api/admin/*
// POST login / logout / me
// GET  data        → 全量数据（配置+分类+站点+友链+统计+概览）
// POST save        → {collection, items[]} 整体保存分类/站点/友链
// POST config      → 保存站点配置
// POST password    → 修改管理员账号密码
// POST reset-stats → 清空统计
// POST restore     → 导入备份 JSON
import { K, kvGet, kvPut, ensureInit, verifyPassword, hashPassword, readStats, ok, fail, sanitizeSite, sanitizeCategory, sanitizeFriend, APP_VERSION } from '../../lib/store.js';
import { requireAdmin, createToken, sessionCookie, clearCookie } from '../../lib/auth.js';

async function guard(context) {
  await ensureInit(context.env);
  const admin = await requireAdmin(context.env, context.request);
  if (!admin) return fail('登录已失效，请重新登录', 401, 401);
  return null;
}

async function readBody(request) {
  try { return await request.json(); } catch { return {}; }
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const action = url.pathname.replace(/^\/api\/admin\/?/, '');
  const denied = await guard(context);
  if (denied) return denied;

  if (action === 'data') {
    const [config, categories, sites, friends, stats] = await Promise.all([
      kvGet(env, K.CONFIG, {}), kvGet(env, K.CATEGORIES, []),
      kvGet(env, K.SITES, []), kvGet(env, K.FRIENDS, []), readStats(env),
    ]);
    return ok({
      config, categories, sites, friends, stats,
      overview: {
        sites: sites.length, categories: categories.length,
        pending: friends.filter(f => f.status === 'pending').length,
        approved: friends.filter(f => f.status === 'approved').length,
        clicks: sites.reduce((s, x) => s + (x.clicks || 0), 0),
      },
      version: APP_VERSION,
    });
  }
  if (action === 'backup') {
    const [config, categories, sites, friends] = await Promise.all([
      kvGet(env, K.CONFIG, {}),
      kvGet(env, K.CATEGORIES, []), kvGet(env, K.SITES, []), kvGet(env, K.FRIENDS, []),
    ]);
    return ok({ exported_at: new Date().toISOString(), version: APP_VERSION, config, categories, sites, friends }); // 不含管理员凭据
  }
  return fail('未知接口', 404, 404);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const action = url.pathname.replace(/^\/api\/admin\/?/, '');
  const body = await readBody(request);

  // ---- 登录/登出不需要预先鉴权 ----
  if (action === 'login') {
    await ensureInit(env);
    const admin = await kvGet(env, K.ADMIN, null);
    const user = String(body.user || '').trim();
    const pass = String(body.pass || '');
    if (!admin || user !== admin.user || !(await verifyPassword(pass, admin.pwd))) {
      return fail('账号或密码错误');
    }
    const token = await createToken(env, admin.user, admin.pv || 1);
    return ok({ user: admin.user }, { 'Set-Cookie': sessionCookie(token) });
  }
  if (action === 'logout') {
    return ok({}, { 'Set-Cookie': clearCookie() });
  }

  const denied = await guard(context);
  if (denied) return denied;

  if (action === 'config') {
    const old = await kvGet(env, K.CONFIG, {});
    const next = { ...old, ...body };
    // 基本类型保护：只接受已知字段类型
    next.overlay_opacity = Math.max(0, Math.min(90, parseInt(next.overlay_opacity, 10) || 0));
    next.default_engine = Math.max(0, parseInt(next.default_engine, 10) || 0);
    if (!Array.isArray(next.quick_tags)) next.quick_tags = [];
    if (!Array.isArray(next.engines)) next.engines = [];
    if (!Array.isArray(next.ads)) next.ads = [];
    await kvPut(env, K.CONFIG, next);
    return ok({});
  }

  if (action === 'save') {
    const coll = String(body.collection || '');
    const items = Array.isArray(body.items) ? body.items : null;
    if (!items) return fail('数据格式错误');
    let sanitized;
    if (coll === 'categories') sanitized = items.map(sanitizeCategory);
    else if (coll === 'sites') sanitized = items.map(sanitizeSite);
    else if (coll === 'friends') sanitized = items.map(sanitizeFriend);
    else return fail('未知集合');
    const key = { categories: K.CATEGORIES, sites: K.SITES, friends: K.FRIENDS }[coll];
    await kvPut(env, key, sanitized);
    return ok({ count: sanitized.length });
  }

  if (action === 'password') {
    const admin = await kvGet(env, K.ADMIN, null);
    const oldPass = String(body.old_pass || '');
    const newPass = String(body.new_pass || '');
    const newUser = String(body.new_user || '').trim() || admin.user;
    if (!(await verifyPassword(oldPass, admin.pwd))) return fail('当前密码不正确');
    if (newPass && newPass.length < 6) return fail('新密码至少 6 位');
    if (!/^[A-Za-z0-9_\-\u4e00-\u9fa5]{1,32}$/.test(newUser)) return fail('用户名仅支持中英文、数字、下划线，最长 32 位');
    const pwd = newPass ? await hashPassword(newPass) : admin.pwd;
    await kvPut(env, K.ADMIN, { user: newUser, pwd, pv: (admin.pv || 1) + 1, updated_at: Date.now() });
    return ok({}, { 'Set-Cookie': clearCookie() }); // 改完强制重新登录
  }

  if (action === 'reset-stats') {
    const list = await env.NAV_KV.list({ prefix: K.STATS_PREFIX });
    for (const k of list.keys) await env.NAV_KV.delete(k.name);
    await env.NAV_KV.put(K.STATS_TOTAL, '0');
    return ok({});
  }

  if (action === 'restore') {
    const data = body.data || {};
    if (data.config && typeof data.config === 'object') await kvPut(env, K.CONFIG, data.config);
    if (Array.isArray(data.categories)) await kvPut(env, K.CATEGORIES, data.categories.map(sanitizeCategory));
    if (Array.isArray(data.sites)) await kvPut(env, K.SITES, data.sites.map(sanitizeSite));
    if (Array.isArray(data.friends)) await kvPut(env, K.FRIENDS, data.friends.map(sanitizeFriend));
    return ok({});
  }

  return fail('未知接口', 404, 404);
}
