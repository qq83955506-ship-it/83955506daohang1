/* 祈福导航 CF 版 —— 管理后台逻辑 */
(function () {
  'use strict';
  var D = null; // 后端全量数据

  // ---------- 基础 ----------
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var toastTimer = 0;
  function toast(msg, type) {
    var t = $('toast');
    t.textContent = msg;
    t.className = 'toast ' + (type || '');
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
  }
  function api(path, opts) {
    opts = opts || {};
    return fetch('/api/admin/' + path, {
      method: opts.method || (opts.body ? 'POST' : 'GET'),
      headers: opts.body ? { 'Content-Type': 'application/json' } : {},
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: 'same-origin',
    }).then(function (r) { return r.json(); });
  }
  function genId(p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  // ---------- 登录 ----------
  function showLogin() { $('loginLayer').hidden = false; $('appLayer').hidden = true; }
  function showApp() { $('loginLayer').hidden = true; $('appLayer').hidden = false; }

  $('loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = $('loginBtn');
    btn.disabled = true; btn.textContent = '登录中...';
    api('login', { body: { user: $('loginUser').value.trim(), pass: $('loginPass').value } }).then(function (r) {
      btn.disabled = false; btn.textContent = '进入后台';
      if (r.code === 1) { boot(); }
      else {
        var err = $('loginErr');
        err.textContent = r.msg || '登录失败';
        err.hidden = false;
      }
    }).catch(function () {
      btn.disabled = false; btn.textContent = '进入后台';
      var err = $('loginErr'); err.textContent = '网络错误'; err.hidden = false;
    });
  });
  $('logoutBtn').addEventListener('click', function () {
    api('logout', { body: {} }).then(function () { location.reload(); });
  });

  // ---------- 菜单 ----------
  var MENU = [
    { key: 'dashboard', icon: '📁', label: '工作台', page: pageDashboard },
    {
      label: '系统配置', icon: '⚙', items: [
        { key: 'site', label: '站点信息', page: pageSiteInfo },
        { key: 'bg', label: '背景设置', page: pageBg },
        { key: 'ui', label: '前台界面', page: pageUi },
        { key: 'stats', label: '在线统计', page: pageStatsCfg },
        { key: 'music', label: '在线音乐', page: pageMusic },
      ],
    },
    {
      label: '内容运营', icon: '▦', items: [
        { key: 'sites', label: '站点管理', page: pageSites },
        { key: 'cats', label: '分类管理', page: pageCategories },
        { key: 'friends', label: '友链管理', page: pageFriends },
        { key: 'ads', label: '广告管理', page: pageAds },
      ],
    },
    {
      label: '维护工具', icon: '🛠', items: [
        { key: 'account', label: '账号安全', page: pageAccount },
        { key: 'backup', label: '备份与恢复', page: pageBackup },
      ],
    },
    { key: 'about', icon: 'ℹ', label: '关于系统', page: pageAbout },
  ];
  var pages = {};
  MENU.forEach(function (g) {
    if (g.items) g.items.forEach(function (i) { pages[i.key] = i.page; });
    else pages[g.key] = g.page;
  });

  function renderMenu() {
    var html = '';
    MENU.forEach(function (g, gi) {
      if (g.items) {
        html += '<div class="menu-group" data-g="' + gi + '"><button type="button" class="menu-group-title">' +
          '<span>' + g.icon + '</span><span>' + esc(g.label) + '</span><span class="arrow">▼</span></button><div class="menu-group-items">';
        g.items.forEach(function (i) {
          html += '<button type="button" class="menu-item" data-page="' + i.key + '">' + esc(i.label) + '</button>';
        });
        html += '</div></div>';
      } else {
        html += '<div class="menu-group"><button type="button" class="menu-item" data-page="' + g.key + '" style="padding-left:10px">' +
          '<span>' + g.icon + '</span> ' + esc(g.label) + '</button></div>';
      }
    });
    $('menu').innerHTML = html;
    $('menu').querySelectorAll('.menu-group-title').forEach(function (t) {
      t.addEventListener('click', function () { t.parentNode.classList.toggle('open'); });
    });
    $('menu').querySelectorAll('.menu-item[data-page]').forEach(function (b) {
      b.addEventListener('click', function () { nav(b.getAttribute('data-page')); });
    });
    // 默认展开前两组
    var groups = $('menu').querySelectorAll('.menu-group');
    if (groups[1]) groups[1].classList.add('open');
  }

  function nav(key) {
    $('menu').querySelectorAll('.menu-item').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-page') === key);
    });
    var fn = pages[key] || pageDashboard;
    $('main').innerHTML = '';
    fn($('main'));
    window.scrollTo(0, 0);
  }

  // ---------- 保存辅助 ----------
  function saveConfig(patch, done) {
    api('config', { body: patch }).then(function (r) {
      if (r.code === 1) { toast('已保存', 'ok'); Object.assign(D.config, patch); if (done) done(); }
      else toast(r.msg || '保存失败', 'err');
    });
  }
  function saveCollection(name, items, done) {
    api('save', { body: { collection: name, items: items } }).then(function (r) {
      if (r.code === 1) { toast('已保存', 'ok'); if (done) done(); }
      else toast(r.msg || '保存失败', 'err');
    });
  }
  function field(label, inputHtml, full) {
    return '<div class="field' + (full ? ' full' : '') + '"><label>' + esc(label) + '</label>' + inputHtml + '</div>';
  }

  // ---------- 页面：工作台 ----------
  function pageDashboard(root) {
    var o = D.overview, s = D.stats;
    root.innerHTML = '<div class="page-title">工作台</div><div class="page-sub">欢迎回来，站点数据概览</div>' +
      '<div class="stat-grid">' +
      [['今日访问', s.today], ['昨日访问', s.yesterday], ['累计访问', s.total], ['站点总数', o.sites], ['分类总数', o.categories], ['待审友链', o.pending], ['已审友链', o.approved], ['累计点击', o.clicks]]
        .map(function (p) { return '<div class="stat-card"><div class="num">' + p[1] + '</div><div class="lbl">' + p[0] + '</div></div>'; }).join('') +
      '</div>' +
      '<div class="card-box"><h3>快捷操作</h3><div class="hint">常用运营入口</div>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap">' +
      '<button class="btn btn-primary" onclick="void 0" id="goSites">新增站点</button>' +
      '<button class="btn btn-ghost" id="goFriends">审核友链</button>' +
      '</div></div>';
    $('goSites').onclick = function () { nav('sites'); };
    $('goFriends').onclick = function () { nav('friends'); };
  }

  // ---------- 页面：站点信息 ----------
  function pageSiteInfo(root) {
    var c = D.config;
    root.innerHTML = '<div class="page-title">站点信息</div><div class="page-sub">站名、SEO 与底部文案</div>' +
      '<div class="card-box"><h3>基本信息</h3><div class="hint">修改后点击底部保存按钮生效</div><div class="form-grid">' +
      field('站点名称', '<input id="f_sitename" value="' + esc(c.sitename) + '">') +
      field('浏览器标题', '<input id="f_title" value="' + esc(c.title) + '">') +
      field('SEO 关键词', '<input id="f_keywords" value="' + esc(c.keywords) + '">') +
      field('SEO 描述', '<input id="f_description" value="' + esc(c.description) + '">') +
      field('底部文案', '<input id="f_footer" value="' + esc(c.footer_text) + '">', true) +
      '</div><div style="margin-top:18px"><button class="btn btn-primary" id="saveSite">保存修改</button></div></div>';
    $('saveSite').onclick = function () {
      saveConfig({
        sitename: $('f_sitename').value.trim(),
        title: $('f_title').value.trim(),
        keywords: $('f_keywords').value.trim(),
        description: $('f_description').value.trim(),
        footer_text: $('f_footer').value.trim(),
      });
    };
  }

  // ---------- 页面：背景设置 ----------
  function pageBg(root) {
    var c = D.config;
    root.innerHTML = '<div class="page-title">背景设置</div><div class="page-sub">前台背景图与遮罩</div>' +
      '<div class="card-box"><h3>背景</h3><div class="hint">支持本站路径（/images/xxx.webp）或任意 https 图片地址；默认 /images/moren.webp</div><div class="form-grid">' +
      field('背景图地址', '<input id="f_bg" value="' + esc(c.bg_image) + '">', true) +
      field('遮罩不透明度（0-90）', '<input id="f_op" type="number" min="0" max="90" value="' + esc(c.overlay_opacity) + '">') +
      '</div><div class="form-grid" style="margin-top:10px">' +
      field('时钟样式', '<select id="f_clk"><option value="digital"' + (c.clock_style !== 'simple' ? ' selected' : '') + '>数字时钟（时:分:秒）</option><option value="simple"' + (c.clock_style === 'simple' ? ' selected' : '') + '>简约时钟（上午/下午 时:分）</option></select>') +
      '<div class="field"><label>&nbsp;</label><div class="switch-row"><input type="checkbox" id="f_12h"' + (c.clock_12h ? ' checked' : '') + '><span>使用 12 小时制</span></div></div>' +
      '</div><div style="margin-top:18px"><button class="btn btn-primary" id="saveBg">保存修改</button></div></div>';
    $('saveBg').onclick = function () {
      saveConfig({
        bg_image: $('f_bg').value.trim() || '/images/moren.webp',
        overlay_opacity: parseInt($('f_op').value, 10) || 0,
        clock_style: $('f_clk').value,
        clock_12h: $('f_12h').checked,
      });
    };
  }

  // ---------- 页面：前台界面（快捷标签 + 搜索引擎） ----------
  function pageUi(root) {
    var c = D.config;
    root.innerHTML = '<div class="page-title">前台界面</div><div class="page-sub">快捷标签与搜索引擎配置（JSON 数组）</div>' +
      '<div class="card-box"><h3>快捷标签</h3><div class="hint">格式：[{"label":"名称","url":"https://..."}]</div>' +
      '<div class="field"><textarea id="f_tags" rows="6"></textarea></div></div>' +
      '<div class="card-box"><h3>搜索引擎</h3><div class="hint">格式：[{"label":"百度","icon":"百","url":"https://www.baidu.com/s?wd="}]，本站搜索用 {"label":"本站","icon":"站","mode":"local"}；url 留空且非 local 的引擎会被忽略</div>' +
      '<div class="form-grid">' +
      field('默认搜索引擎序号（从 0 开始）', '<input id="f_defeng" type="number" min="0" value="' + esc(c.default_engine) + '">') +
      '</div><div class="field" style="margin-top:10px"><textarea id="f_engines" rows="8"></textarea></div></div>' +
      '<div style="margin-bottom:24px"><button class="btn btn-primary" id="saveUi">保存修改</button></div>';
    $('f_tags').value = JSON.stringify(c.quick_tags || [], null, 2);
    $('f_engines').value = JSON.stringify((c.engines || []).filter(function (e) { return e && e.label; }), null, 2);
    $('saveUi').onclick = function () {
      var tags, engines;
      try { tags = JSON.parse($('f_tags').value); } catch (e) { return toast('快捷标签 JSON 格式错误', 'err'); }
      try { engines = JSON.parse($('f_engines').value); } catch (e) { return toast('搜索引擎 JSON 格式错误', 'err'); }
      if (!Array.isArray(tags) || !Array.isArray(engines)) return toast('必须是 JSON 数组', 'err');
      tags = tags.filter(function (t) { return t && t.label && /^(https?:)?\/\//.test(t.url); })
        .map(function (t) { return { label: String(t.label).slice(0, 20), url: t.url }; });
      engines = engines.filter(function (e) { return e && e.label && (e.mode === 'local' || /^(https?:)?\/\//.test(e.url)); })
        .map(function (e) { return { label: String(e.label).slice(0, 20), icon: String(e.icon || e.label.slice(0, 1)).slice(0, 4), url: e.url || '', mode: e.mode === 'local' ? 'local' : 'external' }; });
      var def = Math.max(0, Math.min(engines.length - 1, parseInt($('f_defeng').value, 10) || 0));
      saveConfig({ quick_tags: tags, engines: engines, default_engine: def });
    };
  }

  // ---------- 页面：在线统计 ----------
  function pageStatsCfg(root) {
    var c = D.config, s = D.stats;
    root.innerHTML = '<div class="page-title">在线统计</div><div class="page-sub">前台底部统计栏（数据存于 KV）</div>' +
      '<div class="stat-grid">' +
      [['今日访问', s.today], ['昨日访问', s.yesterday], ['累计访问', s.total]].map(function (p) {
        return '<div class="stat-card"><div class="num">' + p[1] + '</div><div class="lbl">' + p[0] + '</div></div>';
      }).join('') + '</div>' +
      '<div class="card-box"><h3>显示设置</h3>' +
      '<div class="switch-row"><input type="checkbox" id="f_stats"' + (c.stats_enabled !== false ? ' checked' : '') + '><span>启用前台访问统计</span></div>' +
      '<div class="switch-row"><input type="checkbox" id="f_showip"' + (c.show_ip !== false ? ' checked' : '') + '><span>显示访客 IP</span></div>' +
      '<div style="margin-top:14px"><button class="btn btn-primary" id="saveStats">保存设置</button> ' +
      '<button class="btn btn-danger" id="resetStats">清空全部统计</button></div></div>';
    $('saveStats').onclick = function () {
      saveConfig({ stats_enabled: $('f_stats').checked, show_ip: $('f_showip').checked });
    };
    $('resetStats').onclick = function () {
      if (!confirm('确定清空全部访问统计吗？此操作不可恢复。')) return;
      api('reset-stats', { body: {} }).then(function (r) {
        if (r.code === 1) { toast('统计已清空', 'ok'); load(false).then(function () { nav('stats'); }); }
        else toast(r.msg || '操作失败', 'err');
      });
    };
  }

  // ---------- 页面：在线音乐 ----------
  function pageMusic(root) {
    var c = D.config;
    root.innerHTML = '<div class="page-title">在线音乐</div><div class="page-sub">前台左下角悬浮播放器（可选功能）</div>' +
      '<div class="card-box"><h3>播放器</h3>' +
      '<div class="switch-row"><input type="checkbox" id="f_mus"' + (c.music_enabled ? ' checked' : '') + '><span>启用在线音乐</span></div>' +
      '<div class="form-grid" style="margin-top:10px">' +
      field('歌曲名称', '<input id="f_mname" value="' + esc(c.music_name) + '">') +
      field('音频直链 URL（mp3 等）', '<input id="f_murl" value="' + esc(c.music_url) + '">', true) +
      '</div><div style="margin-top:18px"><button class="btn btn-primary" id="saveMusic">保存修改</button></div></div>';
    $('saveMusic').onclick = function () {
      saveConfig({
        music_enabled: $('f_mus').checked,
        music_name: $('f_mname').value.trim(),
        music_url: $('f_murl').value.trim(),
      });
    };
  }

  // ---------- 页面：站点管理 ----------
  function pageSites(root) {
    var cats = D.categories;
    var catOpts = function (v) {
      return cats.map(function (c) { return '<option value="' + esc(c.id) + '"' + (c.id === v ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('');
    };
    function tableHtml() {
      var rows = D.sites.map(function (s, i) {
        return '<tr data-i="' + i + '">' +
          '<td><input data-k="name" value="' + esc(s.name) + '"></td>' +
          '<td><input data-k="url" value="' + esc(s.url) + '"></td>' +
          '<td><input data-k="desc" value="' + esc(s.desc) + '"></td>' +
          '<td><select data-k="cat">' + catOpts(s.cat) + '</select></td>' +
          '<td style="width:64px"><input data-k="sort" type="number" value="' + esc(s.sort) + '" style="min-width:52px"></td>' +
          '<td><input type="checkbox" data-k="hidden"' + (s.hidden ? ' checked' : '') + '></td>' +
          '<td>' + (s.clicks || 0) + '</td>' +
          '<td><div class="row-actions"><button class="btn btn-danger btn-sm" data-del="' + i + '">删除</button></div></td></tr>';
      }).join('');
      return '<div class="table-wrap"><table><thead><tr><th>名称</th><th>网址</th><th>描述</th><th>分类</th><th>排序</th><th>隐藏</th><th>点击</th><th></th></tr></thead><tbody>' +
        (rows || '<tr><td colspan="8" class="empty-tip">暂无站点，点击下方"新增一行"</td></tr>') + '</tbody></table></div>';
    }
    root.innerHTML = '<div class="page-title">站点管理</div><div class="page-sub">前台导航卡片数据（勾选"隐藏"可临时下架）</div>' +
      '<div class="card-box">' + tableHtml() +
      '<div style="display:flex;gap:10px;margin-top:14px"><button class="btn btn-ghost" id="addRow">＋ 新增一行</button>' +
      '<button class="btn btn-primary" id="saveSites">保存全部</button></div></div>';
    function collect() {
      var items = [];
      root.querySelectorAll('tbody tr[data-i]').forEach(function (tr) {
        var idx = parseInt(tr.getAttribute('data-i'), 10);
        var s = JSON.parse(JSON.stringify(D.sites[idx]));
        tr.querySelectorAll('[data-k]').forEach(function (el) {
          var k = el.getAttribute('data-k');
          s[k] = el.type === 'checkbox' ? el.checked : el.value;
        });
        items.push(s);
      });
      return items;
    }
    $('addRow').onclick = function () {
      D.sites.push({ id: genId('s'), cat: cats.length ? cats[0].id : '', name: '', url: '', desc: '', color: '#6366f1', sort: 99, hidden: false, clicks: 0, imps: 0 });
      pageSites(root);
    };
    root.addEventListener('click', function (e) {
      var del = e.target.getAttribute && e.target.getAttribute('data-del');
      if (del !== null && del !== undefined && del !== false) {
        if (!confirm('确定删除该站点？')) return;
        D.sites.splice(parseInt(del, 10), 1);
        pageSites(root);
      }
    });
    $('saveSites').onclick = function () {
      var items = collect().filter(function (s) { return s.name && s.url; });
      saveCollection('sites', items, function () {
        D.sites = items;
        pageSites(root);
      });
    };
  }

  // ---------- 页面：分类管理 ----------
  function pageCategories(root) {
    function tableHtml() {
      var rows = D.categories.map(function (c, i) {
        return '<tr data-i="' + i + '">' +
          '<td style="width:70px"><input data-k="icon" value="' + esc(c.icon) + '" style="min-width:52px"></td>' +
          '<td><input data-k="name" value="' + esc(c.name) + '"></td>' +
          '<td style="width:80px"><input data-k="sort" type="number" value="' + esc(c.sort) + '" style="min-width:60px"></td>' +
          '<td>' + D.sites.filter(function (s) { return s.cat === c.id; }).length + '</td>' +
          '<td><div class="row-actions"><button class="btn btn-danger btn-sm" data-del="' + i + '">删除</button></div></td></tr>';
      }).join('');
      return '<div class="table-wrap"><table><thead><tr><th>图标</th><th>名称</th><th>排序</th><th>站点数</th><th></th></tr></thead><tbody>' +
        (rows || '<tr><td colspan="5" class="empty-tip">暂无分类</td></tr>') + '</tbody></table></div>';
    }
    root.innerHTML = '<div class="page-title">分类管理</div><div class="page-sub">前台分区标题（删除分类不会删除其下站点，但站点将不显示，请先转移）</div>' +
      '<div class="card-box">' + tableHtml() +
      '<div style="display:flex;gap:10px;margin-top:14px"><button class="btn btn-ghost" id="addRow">＋ 新增分类</button>' +
      '<button class="btn btn-primary" id="saveCats">保存全部</button></div></div>';
    $('addRow').onclick = function () {
      D.categories.push({ id: genId('c'), name: '', icon: '⭐', sort: 99 });
      pageCategories(root);
    };
    root.addEventListener('click', function (e) {
      var del = e.target.getAttribute && e.target.getAttribute('data-del');
      if (del !== null && del !== undefined && del !== false) {
        var i = parseInt(del, 10);
        var used = D.sites.filter(function (s) { return s.cat === D.categories[i].id; }).length;
        if (used && !confirm('该分类下有 ' + used + ' 个站点，删除后这些站点将不再显示。确定删除？')) return;
        D.categories.splice(i, 1);
        pageCategories(root);
      }
    });
    $('saveCats').onclick = function () {
      var items = [];
      root.querySelectorAll('tbody tr[data-i]').forEach(function (tr) {
        var idx = parseInt(tr.getAttribute('data-i'), 10);
        var c = JSON.parse(JSON.stringify(D.categories[idx]));
        tr.querySelectorAll('[data-k]').forEach(function (el) { c[el.getAttribute('data-k')] = el.value; });
        if (c.name) items.push(c);
      });
      saveCollection('categories', items, function () {
        D.categories = items;
        pageCategories(root);
      });
    };
  }

  // ---------- 页面：友链管理 ----------
  function pageFriends(root) {
    var list = D.friends;
    var tabs = [['pending', '待审核'], ['approved', '已通过'], ['rejected', '已拒绝']];
    var active = pageFriends._tab || 'pending';
    var shown = list.filter(function (f) { return f.status === active; });
    function tableHtml() {
      var rows = shown.map(function (f) {
        var i = list.indexOf(f);
        var actions = '';
        if (f.status !== 'approved') actions += '<button class="btn btn-primary btn-sm" data-approve="' + i + '">通过</button> ';
        if (f.status !== 'rejected') actions += '<button class="btn btn-ghost btn-sm" data-reject="' + i + '">拒绝</button> ';
        actions += '<button class="btn btn-danger btn-sm" data-del="' + i + '">删除</button>';
        return '<tr><td>' + esc(f.name) + '</td>' +
          '<td><div class="url-cell"><a href="' + esc(f.url) + '" target="_blank" rel="noopener">' + esc(f.url) + '</a></div></td>' +
          '<td>' + esc(f.desc || '-') + '</td>' +
          '<td>' + esc(f.email || '-') + '</td>' +
          '<td><span class="tag ' + f.status + '">' + ({ pending: '待审核', approved: '已通过', rejected: '已拒绝' }[f.status]) + '</span></td>' +
          '<td><div class="row-actions">' + actions + '</div></td></tr>';
      }).join('');
      return '<div class="table-wrap"><table><thead><tr><th>名称</th><th>网址</th><th>描述</th><th>邮箱</th><th>状态</th><th></th></tr></thead><tbody>' +
        (rows || '<tr><td colspan="6" class="empty-tip">暂无数据</td></tr>') + '</tbody></table></div>';
    }
    root.innerHTML = '<div class="page-title">友链管理</div><div class="page-sub">审核前台提交的友链申请，通过的链接会显示在前台"友情链接"分区</div>' +
      '<div class="card-box"><div style="display:flex;gap:8px;margin-bottom:14px">' +
      tabs.map(function (t) {
        var n = list.filter(function (f) { return f.status === t[0]; }).length;
        return '<button class="btn ' + (active === t[0] ? 'btn-primary' : 'btn-ghost') + ' btn-sm" data-tab="' + t[0] + '">' + t[1] + '（' + n + '）</button>';
      }).join('') + '</div>' + tableHtml() + '</div>';
    root.addEventListener('click', function (e) {
      var t = e.target.getAttribute && e.target.getAttribute('data-tab');
      if (t) { pageFriends._tab = t; pageFriends(root); return; }
      var approve = e.target.getAttribute && e.target.getAttribute('data-approve');
      var reject = e.target.getAttribute && e.target.getAttribute('data-reject');
      var del = e.target.getAttribute && e.target.getAttribute('data-del');
      function persist() { saveCollection('friends', list, function () { pageFriends(root); }); }
      if (approve !== null && approve !== undefined && approve !== false) { list[parseInt(approve, 10)].status = 'approved'; persist(); }
      else if (reject !== null && reject !== undefined && reject !== false) { list[parseInt(reject, 10)].status = 'rejected'; persist(); }
      else if (del !== null && del !== undefined && del !== false) {
        if (!confirm('确定删除该友链记录？')) return;
        list.splice(parseInt(del, 10), 1); persist();
      }
    });
  }

  // ---------- 页面：广告管理 ----------
  function pageAds(root) {
    var c = D.config;
    var names = { below: '搜索框下方横幅（7:2）', left: '左侧悬浮（14:31）', right: '右侧悬浮（14:31）' };
    function slotsHtml() {
      return (c.ads || []).map(function (a, i) {
        return '<div class="ad-slot"><h4>广告位 ' + (i + 1) + ' · ' + names[a.position] + '</h4><div class="form-grid">' +
          '<div class="field"><label>位置</label><select data-i="' + i + '" data-k="position">' +
          ['below', 'left', 'right'].map(function (p) { return '<option value="' + p + '"' + (a.position === p ? ' selected' : '') + '>' + names[p] + '</option>'; }).join('') +
          '</select></div>' +
          '<div class="field"><label>跳转链接</label><input data-i="' + i + '" data-k="link" value="' + esc(a.link) + '"></div>' +
          '<div class="field full"><label>图片地址</label><input data-i="' + i + '" data-k="image" value="' + esc(a.image) + '" placeholder="https://... 或 /images/..."></div>' +
          '</div></div>';
      }).join('');
    }
    root.innerHTML = '<div class="page-title">广告管理</div><div class="page-sub">图片广告位；留空图片地址即不显示</div>' +
      '<div class="card-box"><h3>总开关</h3>' +
      '<div class="switch-row"><input type="checkbox" id="f_ads"' + (c.ads_enabled ? ' checked' : '') + '><span>启用广告展示</span></div></div>' +
      '<div class="card-box"><h3>广告位</h3><div class="hint">建议下方横幅 1400x400px、侧边悬浮 560x1240px</div>' + slotsHtml() +
      '<div style="display:flex;gap:10px;margin-top:14px"><button class="btn btn-primary" id="saveAds">保存全部</button></div></div>';
    $('saveAds').onclick = function () {
      var ads = [];
      root.querySelectorAll('.ad-slot').length; // noop keep
      (c.ads || []).forEach(function (a, i) {
        var next = JSON.parse(JSON.stringify(a));
        root.querySelectorAll('[data-i="' + i + '"][data-k]').forEach(function (el) { next[el.getAttribute('data-k')] = el.value.trim(); });
        ads.push(next);
      });
      saveConfig({ ads_enabled: $('f_ads').checked, ads: ads });
    };
  }

  // ---------- 页面：账号安全 ----------
  function pageAccount(root) {
    root.innerHTML = '<div class="page-title">账号安全</div><div class="page-sub">修改管理员账号或密码；修改成功后需重新登录</div>' +
      '<div class="card-box"><div class="form-grid">' +
      field('当前密码', '<input id="f_old" type="password" autocomplete="current-password">') +
      field('新用户名（留空则不修改）', '<input id="f_user" value="' + esc(D.config._admin_user || '') + '" placeholder="留空不修改">') +
      field('新密码（至少 6 位，留空则不修改）', '<input id="f_new" type="password" autocomplete="new-password">', true) +
      '</div><div style="margin-top:18px"><button class="btn btn-primary" id="savePwd">确认修改</button></div></div>';
    $('savePwd').onclick = function () {
      var oldP = $('f_old').value, newP = $('f_new').value, newUser = $('f_user').value.trim();
      if (!oldP) return toast('请输入当前密码', 'err');
      if (!newP && !newUser) return toast('请至少修改用户名或密码之一', 'err');
      api('password', { body: { old_pass: oldP, new_pass: newP, new_user: newUser } }).then(function (r) {
        if (r.code === 1) { toast('修改成功，请重新登录', 'ok'); setTimeout(function () { location.reload(); }, 900); }
        else toast(r.msg || '修改失败', 'err');
      });
    };
  }

  // ---------- 页面：备份与恢复 ----------
  function pageBackup(root) {
    root.innerHTML = '<div class="page-title">备份与恢复</div><div class="page-sub">全部数据存于 Cloudflare KV，可导出 JSON 备份或从备份恢复</div>' +
      '<div class="card-box"><h3>导出备份</h3><div class="hint">包含站点配置、分类、站点、友链；不含统计与登录密码</div>' +
      '<button class="btn btn-primary" id="doExport">导出 JSON 备份</button></div>' +
      '<div class="card-box"><h3>导入恢复</h3><div class="hint">选择之前导出的 JSON 文件，将覆盖当前配置/分类/站点/友链</div>' +
      '<input type="file" id="importFile" accept=".json,application/json" style="font-size:13px"> ' +
      '<button class="btn btn-primary" id="doImport" style="margin-top:12px">开始恢复</button></div>';
    var importData = null;
    $('doExport').onclick = function () {
      api('backup').then(function (r) {
        if (r.code !== 1) return toast(r.msg || '导出失败', 'err');
        var data = r.data;
        delete data.admin; // 不导出密码哈希
        var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'qifu-nav-backup-' + new Date().toISOString().slice(0, 10) + '.json';
        a.click();
        URL.revokeObjectURL(a.href);
      });
    };
    $('importFile').addEventListener('change', function (e) {
      var f = e.target.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        try { importData = JSON.parse(reader.result); toast('文件已读取，点击"开始恢复"生效', 'ok'); }
        catch (err) { importData = null; toast('JSON 解析失败', 'err'); }
      };
      reader.readAsText(f);
    });
    $('doImport').onclick = function () {
      if (!importData) return toast('请先选择备份文件', 'err');
      if (!confirm('导入将覆盖当前数据，确定继续？')) return;
      api('restore', { body: { data: importData } }).then(function (r) {
        if (r.code === 1) { toast('恢复成功', 'ok'); load(false).then(function () { nav('backup'); }); }
        else toast(r.msg || '恢复失败', 'err');
      });
    };
  }

  // ---------- 页面：关于 ----------
  function pageAbout(root) {
    root.innerHTML = '<div class="page-title">关于系统</div><div class="page-sub">祈福导航 · Cloudflare Pages + KV 版</div>' +
      '<div class="card-box"><h3>版本</h3><div class="hint">' + esc(D.version || 'CF-1.0.0') + '</div>' +
      '<p style="font-size:13px;color:#475569;line-height:2">本版本由原 PHP 版祈福导航移植：前台样式 1:1 还原，数据全部存于 Cloudflare KV，无需数据库与服务器。<br>' +
      '默认管理员账号 admin / admin123（首次登录后请立即在「维护工具 → 账号安全」修改）。<br>' +
      '前台入口：<a href="/" target="_blank" style="color:#5b78ef">/</a> · 后台入口：<a href="/admin.html" target="_blank" style="color:#5b78ef">/admin.html</a></p></div>';
  }

  // ---------- 启动 ----------
  function load(needMenu) {
    return api('data').then(function (r) {
      if (r.code === 1) {
        D = r.data;
        D.config._admin_user = '';
        if (needMenu) renderMenu();
        showApp();
        return true;
      }
      showLogin();
      return false;
    });
  }
  function boot() { load(true).then(function (ok) { if (ok) nav('dashboard'); }); }
  boot();
})();
