// 公开 API：/api/public/*
// GET  site   → 前台全部数据（配置+分类+站点+友链+广告）
// POST track  → 访问统计上报，返回今日/昨日/总量/IP
// POST link   → 友链申请
// GET  meta   → 抓取目标站点标题/描述（友链申请自动填充）
import { K, kvGet, kvPut, ensureInit, bumpVisit, readStats, ok, fail, sanitizeFriend, safeUrl, genId } from '../../lib/store.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const action = url.pathname.replace(/^\/api\/public\/?/, '');

  if (action === 'site') {
    await ensureInit(env);
    const [config, categories, sites, friends] = await Promise.all([
      kvGet(env, K.CONFIG, {}),
      kvGet(env, K.CATEGORIES, []),
      kvGet(env, K.SITES, []),
      kvGet(env, K.FRIENDS, []),
    ]);
    const visibleSites = sites.filter(s => !s.hidden && s.url);
    return ok({
      config: {
        sitename: config.sitename, title: config.title, keywords: config.keywords,
        description: config.description, footer_text: config.footer_text,
        bg_image: config.bg_image, overlay_opacity: config.overlay_opacity,
        clock_style: config.clock_style, clock_12h: config.clock_12h,
        quick_tags: config.quick_tags, engines: config.engines, default_engine: config.default_engine,
        stats_enabled: config.stats_enabled, show_ip: config.show_ip,
        link_apply_enabled: config.link_apply_enabled,
        music_enabled: config.music_enabled, music_name: config.music_name, music_url: config.music_url,
        ads_enabled: config.ads_enabled, ads: config.ads,
      },
      categories: [...categories].sort((a, b) => a.sort - b.sort),
      sites: visibleSites.sort((a, b) => a.sort - b.sort),
      friends: friends.filter(f => f.status === 'approved'),
    });
  }

  if (action === 'meta') {
    const target = safeUrl(url.searchParams.get('url'));
    if (!target) return fail('无效的网址');
    try {
      const resp = await fetch(target, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; QifuNavBot/1.0)' },
        redirect: 'follow',
        cf: { cacheTtl: 3600 },
      });
      if (!resp.ok) return fail('目标站点响应异常 ' + resp.status);
      const html = (await resp.text()).slice(0, 200000);
      const pick = (re) => { const m = html.match(re); return m ? m[1].trim().slice(0, 120) : ''; };
      const name = pick(/<title[^>]*>([\s\S]*?)<\/title>/i).replace(/\s+/g, ' ')
        || new URL(target).hostname;
      const description = pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)
        || pick(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i);
      return ok({ name, description });
    } catch (e) {
      return fail('抓取失败：' + (e.message || '目标站点无法访问'));
    }
  }

  return fail('未知接口', 404, 404);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const action = url.pathname.replace(/^\/api\/public\/?/, '');
  let body = {};
  try { body = await request.json(); } catch { /* 容忍空 body */ }

  if (action === 'track') {
    await ensureInit(env);
    const config = await kvGet(env, K.CONFIG, {});
    const ip = request.headers.get('CF-Connecting-IP') || '未知';

    // 站点点击 / 曝光统计
    if (body.type === 'click' && body.site_id) {
      const sites = await kvGet(env, K.SITES, []);
      const s = sites.find(x => x.id === body.site_id);
      if (s) { s.clicks = (s.clicks || 0) + 1; await kvPut(env, K.SITES, sites); }
      return ok({});
    }
    if (body.type === 'impression' && Array.isArray(body.site_ids) && body.site_ids.length) {
      const sites = await kvGet(env, K.SITES, []);
      const ids = new Set(body.site_ids.map(String).slice(0, 100));
      let changed = false;
      for (const s of sites) if (ids.has(s.id)) { s.imps = (s.imps || 0) + 1; changed = true; }
      if (changed) await kvPut(env, K.SITES, sites);
      return ok({});
    }

    if (config.stats_enabled === false) return ok({ disabled: true });
    const { today, total } = await bumpVisit(env, ip);
    const stats = await readStats(env);
    return ok({ ...stats, ip: config.show_ip === false ? '' : ip });
  }

  if (action === 'link') {
    const config = await kvGet(env, K.CONFIG, {});
    if (config.link_apply_enabled === false) return fail('友链申请已关闭');
    const item = sanitizeFriend({
      name: body.name, url: body.url, desc: body.desc,
      cat: body.cat, email: body.email, status: 'pending',
    });
    if (!item.name || !item.url) return fail('请填写网站名称和正确的网址');
    const friends = await kvGet(env, K.FRIENDS, []);
    const normalized = item.url.replace(/\/+$/, '');
    if (friends.some(f => f.url && f.url.replace(/\/+$/, '') === normalized && f.status === 'pending')) {
      return fail('该网站已提交过申请，正在审核中');
    }
    if (friends.some(f => f.url && f.url.replace(/\/+$/, '') === normalized && f.status === 'approved')) {
      return fail('该网站已是本站友链');
    }
    // 简易限频：同一 IP 每小时最多 5 条
    const ip = request.headers.get('CF-Connecting-IP') || 'x';
    const rateKey = 'rate:link:' + ip + ':' + Math.floor(Date.now() / 3600000);
    const rate = parseInt(await env.NAV_KV.get(rateKey) || '0', 10);
    if (rate >= 5) return fail('提交过于频繁，请稍后再试');
    await env.NAV_KV.put(rateKey, String(rate + 1), { expirationTtl: 3600 });

    item.id = genId('f');
    friends.unshift(item);
    await kvPut(env, K.FRIENDS, friends);
    return ok({ id: item.id });
  }

  return fail('未知接口', 404, 404);
}
