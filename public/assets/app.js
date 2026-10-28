/* 祈福导航 CF 版前台逻辑 */
(function () {
  'use strict';
  var DATA = null;

  // ---------- 基础工具 ----------
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function iconSourcesFor(url) {
    var host = '';
    try { host = new URL(url).hostname; } catch (e) { return []; }
    return [
      url.replace(/\/+$/, '') + '/favicon.ico',
      'https://favicon.im/' + host + '?larger=true',
      'https://www.google.com/s2/favicons?domain_url=' + encodeURIComponent(url) + '&sz=64',
    ];
  }
  function track(body) {
    body = new URLSearchParams(body).toString();
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/public/track', new Blob([body], { type: 'application/x-www-form-urlencoded' }));
    } else if (window.fetch) {
      fetch('/api/public/track', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body, keepalive: true }).catch(function () {});
    }
  }

  // ---------- 渲染 ----------
  function applyConfig(config) {
    document.title = config.title || config.sitename || '导航';
    var metaDesc = document.querySelector('meta[name="description"]');
    if (!metaDesc) { metaDesc = document.createElement('meta'); metaDesc.name = 'description'; document.head.appendChild(metaDesc); }
    metaDesc.content = config.description || '';
    var metaKw = document.querySelector('meta[name="keywords"]');
    if (!metaKw) { metaKw = document.createElement('meta'); metaKw.name = 'keywords'; document.head.appendChild(metaKw); }
    metaKw.content = config.keywords || '';

    // 背景图 + 遮罩透明度
    var bg = config.bg_image || '/images/moren.webp';
    var style = document.createElement('style');
    style.textContent = '.bg::before{background-image:url(' + JSON.stringify(bg) + ')!important;background-image:image-set(url(' + JSON.stringify(bg) + ') type("image/webp"), url(' + JSON.stringify(bg) + ') type("image/jpeg"))!important;animation:none}' +
      '.overlay{background:linear-gradient(145deg,rgba(8,18,50,' + (config.overlay_opacity / 100) + '),rgba(12,25,65,' + (config.overlay_opacity / 100 * 0.77) + ') 50%,rgba(5,12,40,' + (config.overlay_opacity / 100 * 1.08) + '))}';
    document.head.appendChild(style);

    // 时钟样式
    var clock = $('clock');
    if (config.clock_style === 'simple') clock.classList.add('simple');

    // 快捷标签
    var tagsEl = $('quickTags');
    tagsEl.innerHTML = (config.quick_tags || []).map(function (t) {
      return '<a class="tag" href="' + esc(t.url) + '" target="_blank" rel="noopener noreferrer">' + esc(t.label) + '</a>';
    }).join('');

    // 搜索引擎
    var engines = (config.engines || []).filter(function (e) { return e && e.label; });
    if (engines.length) renderEngines(engines, config.default_engine || 0);

    // 友链申请按钮
    if (config.link_apply_enabled !== false) $('lkmBtn').hidden = false;

    // 底部
    $('footRow').innerHTML = '<span class="foot-item">' + esc(config.footer_text || '') + '</span>';

    // 广告
    renderAds(config);
  }

  function renderEngines(engines, defaultIndex) {
    var menu = $('engineMenu'), eng = $('eng');
    menu.innerHTML = engines.map(function (e, i) {
      return '<button class="engine-option' + (i === defaultIndex ? ' active' : '') + '" type="button" data-index="' + i + '"' +
        ' data-mode="' + esc(e.mode || 'external') + '" data-url="' + esc(e.url || '') + '">' +
        '<span class="engine-badge">' + esc(e.icon || e.label.slice(0, 1)) + '</span><span>' + esc(e.label) + '</span></button>';
    }).join('');
    function pick(i) {
      var e = engines[i]; if (!e) return;
      eng.value = e.url || ''; eng.setAttribute('data-mode', e.mode || 'external'); eng.dataset.index = i;
      $('engineLabel').textContent = e.label;
      $('engineBadge').textContent = e.icon || e.label.slice(0, 1);
      $('sinp').placeholder = e.mode === 'local' ? '搜索本站资源...' : '搜索网页、资源、工具...';
    }
    pick(defaultIndex);
    var picker = $('enginePicker'), btn = $('engineBtn');
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = picker.classList.toggle('open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    menu.querySelectorAll('.engine-option').forEach(function (opt) {
      opt.addEventListener('click', function () {
        menu.querySelectorAll('.engine-option').forEach(function (o) { o.classList.remove('active'); });
        opt.classList.add('active');
        pick(parseInt(opt.dataset.index, 10));
        filterLocalSites($('sinp').value, false);
        picker.classList.remove('open'); btn.setAttribute('aria-expanded', 'false');
      });
    });
    document.addEventListener('click', function () { picker.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); });
  }

  function cardHtml(item, idAttr) {
    var sources = iconSourcesFor(item.url);
    var firstChar = (item.name || '?').slice(0, 1);
    return '<a class="card" href="' + esc(item.url) + '" target="_blank" rel="noopener" data-track-id="' + esc(item.id) + '"' +
      ' data-search="' + esc([item.name, item.desc, item.url].join(' ')) + '">' +
      '<div class="ico site-icon-wrap" style="background:' + esc(item.color || '#6366f1') + '22;border:1px solid ' + esc(item.color || '#6366f1') + '44;">' +
      '<span class="site-icon-fallback" aria-hidden="true">' + esc(firstChar) + '</span>' +
      '<img class="site-favicon" src="' + esc(sources[0] || '') + '" data-icon-sources="' + esc(JSON.stringify(sources)) + '"' +
      ' data-icon-index="0" onload="qifuSiteIconLoaded(this)" onerror="qifuSiteIconNext(this)" alt="' + esc(item.name) + '"' +
      ' loading="lazy" decoding="async" referrerpolicy="no-referrer">' +
      '</div><div class="inf"><div class="nm">' + esc(item.name) + '</div>' +
      '<div class="ds"><span class="ds-text">' + esc(item.desc || item.url.replace(/^https?:\/\//, '').replace(/\/+$/, '')) + '</span></div></div></a>';
  }

  function renderSections(data) {
    var wrap = $('sections');
    var html = '';
    data.categories.forEach(function (cat) {
      var items = data.sites.filter(function (s) { return s.cat === cat.id; });
      if (!items.length) return;
      html += '<div class="sec"><div class="sec-hd"><div class="dot"></div>' +
        '<span style="font-size:.9rem">' + esc(cat.icon || '⭐') + '</span>' +
        '<span class="sec-title">' + esc(cat.name) + '</span><div class="sec-line"></div></div>' +
        '<div class="grid">' + items.map(function (s) { return cardHtml(s); }).join('') + '</div></div>';
    });
    if (data.friends.length) {
      html += '<div class="sec"><div class="sec-hd"><div class="dot"></div>' +
        '<span style="font-size:.9rem">🔗</span><span class="sec-title">友情链接</span><div class="sec-line"></div></div>' +
        '<div class="grid">' + data.friends.map(function (f) { return cardHtml(f); }).join('') + '</div></div>';
    }
    wrap.innerHTML = html;

    // 站点点击 + 曝光统计
    wrap.querySelectorAll('.card[data-track-id]').forEach(function (card) {
      card.addEventListener('click', function () { track({ type: 'click', site_id: card.getAttribute('data-track-id') }); });
    });
    var cards = Array.prototype.slice.call(wrap.querySelectorAll('.card[data-track-id]'));
    var viewed = {}, pending = [], flushTimer = 0;
    function flush() {
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = 0; }
      if (!pending.length) return;
      track({ type: 'impression', site_ids: pending.splice(0, pending.length).join(',') });
    }
    function markViewed(card) {
      var id = card.getAttribute('data-track-id');
      if (!id || viewed[id]) return;
      viewed[id] = true; pending.push(id);
      if (!flushTimer) flushTimer = setTimeout(flush, 250);
    }
    if ('IntersectionObserver' in window) {
      var observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.25) { markViewed(entry.target); observer.unobserve(entry.target); }
        });
      }, { threshold: [0.25], rootMargin: '0px 0px 64px 0px' });
      cards.forEach(function (c) { observer.observe(c); });
    } else {
      cards.forEach(markViewed);
    }
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flush(); });
    window.addEventListener('pagehide', flush);
    document.querySelectorAll('img.site-favicon').forEach(function (img) { window.qifuSiteIconArm(img); });
  }

  function renderAds(config) {
    var ads = (config.ads || []).filter(function (a) { return a && a.image && config.ads_enabled !== false; });
    var below = ads.filter(function (a) { return a.position === 'below'; }).slice(0, 4);
    var left = ads.find(function (a) { return a.position === 'left'; });
    var right = ads.find(function (a) { return a.position === 'right'; });
    var grid = $('adGrid');
    if (below.length) {
      grid.hidden = false;
      grid.innerHTML = below.map(function (a) {
        return '<a class="ad-link" href="' + esc(a.link || '#') + '" target="_blank" rel="noopener"><div class="ad-cell"><div class="ad-banner"><img class="ad-img" src="' + esc(a.image) + '" alt="' + esc(a.title || '广告') + '"></div></div></a>';
      }).join('');
    }
    [['adLeft', left], ['adRight', right]].forEach(function (pair) {
      var el = $(pair[0]), ad = pair[1];
      if (!ad) return;
      el.hidden = false;
      el.innerHTML = '<a class="ad-link" href="' + esc(ad.link || '#') + '" target="_blank" rel="noopener"><div class="ad-banner"><img class="ad-img" src="' + esc(ad.image) + '" alt="' + esc(ad.title || '广告') + '"></div></a>';
    });
  }

  function renderStats(s) {
    if (!s) return;
    $('onlineStats').hidden = false;
    var parts = [
      ['今日访问', s.today, '人次'], ['昨日访问', s.yesterday, '人次'], ['累计访问', s.total, '人次'],
    ];
    var html = parts.map(function (p) {
      return '<span class="online-stats-item"><span class="online-stats-label">' + p[0] + '</span><b>' + p[1] + '</b><span class="online-stats-unit">' + p[2] + '</span></span>';
    }).join('<span class="online-stats-sep">|</span>');
    if (s.ip) {
      html += '<span class="online-stats-sep">|</span><span class="online-stats-item online-stats-item-ip"><span class="online-stats-label">您的 IP</span><b>' + esc(s.ip) + '</b></span>';
    }
    $('statsRow').innerHTML = html;
  }

  // ---------- 时钟 ----------
  function tick() {
    var n = new Date(), pad = function (v) { return String(v).padStart(2, '0'); };
    var is12h = DATA && DATA.config && DATA.config.clock_12h;
    var h = n.getHours(), ampm = h >= 12 ? '下午' : '上午';
    if (is12h) h = h % 12 || 12;
    var ts = is12h ? ampm + ' ' + pad(h) + ':' + pad(n.getMinutes()) : pad(h) + ':' + pad(n.getMinutes()) + ':' + pad(n.getSeconds());
    var ce = $('clock');
    if (ce) {
      if (ce.classList.contains('simple')) ce.textContent = '现在' + ampm + ' ' + pad(h) + ':' + pad(n.getMinutes());
      else ce.textContent = ts;
    }
    var de = $('date');
    if (de) {
      var days = ['日', '一', '二', '三', '四', '五', '六'];
      de.textContent = n.getFullYear() + ' · ' + pad(n.getMonth() + 1) + ' · ' + pad(n.getDate()) + ' · 星期' + days[n.getDay()];
    }
  }
  setInterval(tick, 1000);

  // ---------- 搜索 ----------
  window.filterLocalSites = function (query, scrollToResults) {
    var sections = $('sections'), state = $('siteSearchState');
    if (!sections) return 0;
    var normalized = String(query || '').trim().toLocaleLowerCase(), count = 0;
    sections.querySelectorAll('.sec').forEach(function (section) {
      var sectionMatches = 0;
      section.querySelectorAll('.card').forEach(function (card) {
        var match = !normalized || (card.getAttribute('data-search') || '').toLocaleLowerCase().indexOf(normalized) !== -1;
        card.hidden = !match;
        if (match) { count++; sectionMatches++; }
      });
      section.hidden = sectionMatches === 0;
    });
    if (state) {
      if (!normalized) { state.className = 'site-search-state'; state.textContent = ''; }
      else { state.className = 'site-search-state show' + (count === 0 ? ' empty' : ''); state.textContent = count === 0 ? '未找到匹配的本站资源' : '找到 ' + count + ' 个本站资源'; }
    }
    if (scrollToResults && normalized && state) state.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return count;
  };
  window.doSearch = function () {
    var input = $('sinp'), eng = $('eng');
    if (!input || !eng) return;
    var q = input.value.trim();
    if (!q) { if (eng.getAttribute('data-mode') === 'local') filterLocalSites('', false); return; }
    if (eng.getAttribute('data-mode') === 'local') { filterLocalSites(q, true); return; }
    window.open(eng.value + encodeURIComponent(q), '_blank', 'noopener');
  };
  (function () {
    var sinpEl = $('sinp');
    if (!sinpEl) return;
    sinpEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); doSearch(); } });
    sinpEl.addEventListener('input', function () {
      var eng = $('eng');
      if (eng && eng.getAttribute('data-mode') === 'local') filterLocalSites(sinpEl.value, false);
    });
  })();

  // ---------- 友链申请弹窗 ----------
  (function () {
    var wrap = $('lkm-wrap'), btn = $('lkmBtn'), closeBtn = $('lkmCloseBtn'), doneCloseBtn = $('lkmDoneCloseBtn');
    var titleEl = $('lkmTitle'), titleNote = titleEl.parentNode.querySelector('p');
    var submitBtn = $('lkmSubmit'), tip = $('lkmTip'), formBd = $('lkmFormBd'), doneBd = $('lkmDoneBd');
    var nameInput = $('lkmName'), urlInput = $('lkmUrl'), fetchButton = $('lkmFetchMeta');
    var descInput = $('lkmDesc'), emailInput = $('lkmEmail'), metaStatus = $('lkmMetaStatus');
    var metaRequest = null;

    function cancelMeta() { if (metaRequest) { metaRequest.abort(); metaRequest = null; } }
    function setSubmitState(state, label) {
      submitBtn.classList.remove('is-loading', 'is-success', 'is-pending');
      if (state) submitBtn.classList.add('is-' + state);
      submitBtn.disabled = state === 'loading';
      submitBtn.textContent = label;
    }
    function showDoneState(o) {
      setSubmitState(o.buttonState, o.buttonLabel);
      titleEl.textContent = o.headerTitle;
      titleNote.textContent = o.headerNote;
      $('lkmDoneStatus').textContent = o.status;
      $('lkmDoneTitle').textContent = o.title;
      $('lkmDoneMessage').textContent = o.message;
      $('lkmDoneNext').textContent = o.next;
      setTimeout(function () { formBd.style.display = 'none'; doneBd.style.display = 'block'; }, 380);
    }
    function normalizeSiteUrl(value) {
      value = String(value || '').trim();
      if (!value) return '';
      var hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
      var authority = value.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split(/[\/?#]/, 1)[0];
      if (/^\d+(?::\d+)?$/.test(authority)) return '';
      if (!hasScheme) value = 'https://' + value;
      try { var p = new URL(value); if (p.protocol !== 'http:' && p.protocol !== 'https:') return ''; return p.href; }
      catch (e) { return ''; }
    }
    function setMetaStatus(message, state) {
      metaStatus.textContent = message || '';
      metaStatus.className = 'lkm-meta-status' + (state ? ' ' + state : '');
      fetchButton.disabled = state === 'loading';
      fetchButton.textContent = state === 'loading' ? '获取中...' : '获取信息';
    }
    function requestSiteMeta(callback) {
      var normalized = normalizeSiteUrl(urlInput.value);
      if (!normalized) {
        setMetaStatus(urlInput.value.trim() ? '请输入正确的网站域名或URL' : '', urlInput.value.trim() ? 'error' : '');
        if (callback) callback(false);
        return;
      }
      urlInput.value = normalized;
      setMetaStatus('正在获取网站名称和描述...', 'loading');
      var request = new XMLHttpRequest();
      metaRequest = request;
      request.open('GET', '/api/public/meta?url=' + encodeURIComponent(normalized), true);
      request.onload = function () {
        metaRequest = null;
        var r;
        try { r = JSON.parse(request.responseText); } catch (e) { setMetaStatus('自动获取失败，请手动填写', 'error'); if (callback) callback(false); return; }
        if (r.code === 1 && r.data) {
          if (!nameInput.value.trim()) nameInput.value = r.data.name || '';
          if (!descInput.value.trim()) descInput.value = r.data.description || '';
          setMetaStatus('已自动获取网站信息', 'success');
          if (callback) callback(true);
        } else {
          setMetaStatus(r.msg || '未能自动获取，请手动填写', 'error');
          if (callback) callback(false);
        }
      };
      request.onerror = function () { metaRequest = null; setMetaStatus('自动获取失败，请手动填写', 'error'); if (callback) callback(false); };
      request.onabort = function () { metaRequest = null; };
      request.send();
    }
    function submitApplication() {
      var name = nameInput.value.trim(), url = normalizeSiteUrl(urlInput.value.trim());
      var desc = descInput.value.trim(), cat = $('lkmCat').value, email = emailInput.value.trim();
      if (!name || !url) { tip.style.display = 'block'; tip.className = 'lkm-tip err'; tip.innerHTML = '请填写网站名称和正确的网址'; return; }
      setSubmitState('loading', '正在提交...');
      tip.style.display = 'none';
      var x = new XMLHttpRequest();
      x.open('POST', '/api/public/link', true);
      x.setRequestHeader('Content-Type', 'application/json');
      x.onload = function () {
        var r;
        try { r = JSON.parse(x.responseText); } catch (e) { setSubmitState('', '确认并提交'); tip.style.display = 'block'; tip.className = 'lkm-tip err'; tip.innerHTML = '返回格式错误，请重试'; return; }
        if (r.code === 1) {
          showDoneState({ buttonState: 'success', buttonLabel: '提交成功', headerTitle: '申请已提交', headerNote: '站点资料已安全送达审核列表', status: '申请已提交', title: '友链申请提交成功', message: '站点资料已经进入审核列表，管理员处理后会通过您填写的邮箱发送结果。', next: '请等待管理员审核' });
        } else if (String(r.msg || '').indexOf('已提交过申请') !== -1) {
          showDoneState({ buttonState: 'pending', buttonLabel: '已在审核中', headerTitle: '申请正在审核', headerNote: '无需重复提交站点资料', status: '申请已在审核中', title: '该网站已提交过申请', message: '我们已经收到该网站的友链资料，当前正在等待管理员处理。', next: '请耐心等待审核结果' });
        } else {
          setSubmitState('', '确认并提交');
          tip.style.display = 'block'; tip.className = 'lkm-tip info'; tip.innerHTML = esc(r.msg || '提交失败');
        }
      };
      x.onerror = function () { setSubmitState('', '确认并提交'); tip.style.display = 'block'; tip.className = 'lkm-tip err'; tip.innerHTML = '网络错误，请检查连接'; };
      x.send(JSON.stringify({ name: name, url: url, desc: desc, cat: cat, email: email }));
    }

    btn.addEventListener('click', function () {
      cancelMeta();
      wrap.classList.add('open');
      titleEl.textContent = '提交友链申请';
      titleNote.textContent = '填写网址后，点击“获取信息”自动读取公开站点资料';
      formBd.style.display = 'block'; doneBd.style.display = 'none';
      tip.style.display = 'none';
      setSubmitState('', '确认并提交');
      nameInput.value = ''; urlInput.value = ''; descInput.value = ''; emailInput.value = '';
      setMetaStatus('', '');
      setTimeout(function () { urlInput.focus(); }, 0);
    });
    closeBtn.addEventListener('click', function () { cancelMeta(); wrap.classList.remove('open'); });
    doneCloseBtn.addEventListener('click', function () { wrap.classList.remove('open'); });
    urlInput.addEventListener('input', function () { cancelMeta(); setMetaStatus('', ''); });
    fetchButton.addEventListener('click', function () { requestSiteMeta(); });
    submitBtn.addEventListener('click', function () {
      if (!nameInput.value.trim() && urlInput.value.trim()) { requestSiteMeta(function () { submitApplication(); }); return; }
      submitApplication();
    });
  })();

  // ---------- 启动 ----------
  fetch('/api/public/site').then(function (r) { return r.json(); }).then(function (res) {
    if (res.code !== 1) throw new Error(res.msg || '加载失败');
    DATA = res.data;
    applyConfig(DATA.config);
    renderSections(DATA);
    tick();
    // 访问统计
    var body = new URLSearchParams({ type: 'visit' }).toString();
    fetch('/api/public/track', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body })
      .then(function (r) { return r.json(); })
      .then(function (r) { if (r.code === 1) renderStats(r.data); })
      .catch(function () {});
  }).catch(function (e) {
    $('sections').innerHTML = '<div class="sec"><div class="sec-hd"><div class="dot"></div><span class="sec-title">加载失败：' + esc(e.message) + '</span><div class="sec-line"></div></div></div>';
  });
})();
