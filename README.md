# 祈福导航 · Cloudflare Pages + KV 版

原 PHP 版祈福导航（github.com/JiangXinMao/qifudaohang）的移植版：前台样式 1:1 还原，**数据全部存 Cloudflare KV**，无需 MySQL / 虚拟主机 / 服务器。

## 功能

- **前台 `/`**：时钟、多搜索引擎（含本站搜索）、快捷标签、分类导航卡片、站标自动降级加载、友情链接分区、广告位（下方横幅 + 左右侧悬浮）、访问统计（今日/昨日/累计 + IP）、友链在线申请
- **后台 `/admin.html`**：工作台概览 / 站点信息 / 背景设置 / 前台界面 / 在线统计 / 在线音乐 / 站点管理 / 分类管理 / 友链审核 / 广告管理 / 账号安全 / 备份恢复
- **安全**：PBKDF2 密码哈希、HMAC 签名会话 Cookie（HttpOnly + Secure + SameSite=Strict）、友链申请限频

## 部署（GitHub + Cloudflare Pages，推荐方式）

1. **推送本目录到 GitHub 仓库**（直接上传或 `git push`）。
2. **创建 KV 命名空间**：Cloudflare 控制台 → Storage & Databases → KV → Create namespace，名字随意（如 `qifu-nav`）。
3. **创建 Pages 项目**：Workers & Pages → Create → Pages → Connect to Git → 选你的仓库：
   - 构建命令：留空
   - 输出目录：`public`
4. **绑定 KV**：项目 Settings → Bindings → 添加 KV Namespace：
   - Variable name：`NAV_KV`
   - Namespace：选刚才创建的
5. 部署完成后访问 `https://你的域名/` 即前台，`/admin.html` 即后台。
6. **默认账号 `admin / admin123`，登录后立即在「维护工具 → 账号安全」修改！**

> 也可以用命令行：`npx wrangler kv namespace create NAV_KV`，把 wrangler.toml 里的 id 替换后执行 `npx wrangler pages deploy`。

## 首次初始化

无需手动建表——首次访问任意接口时自动写入默认配置、两个示例分类和示例站点，全部可在后台修改。

## 目录结构

```
public/            静态资源（前台、后台、样式、图片）
functions/         Cloudflare Pages Functions（API）
  lib/store.js     KV 读写、默认数据、校验、统计
  lib/auth.js      会话签名与校验
  api/public/[[path]].js   公开接口
  api/admin/[[path]].js    管理接口
wrangler.toml      部署配置（KV 绑定）
test/            本地自测（无需浏览器）
  run.mjs        API 层端到端测试（41 项，模拟 KV + Functions）
  ui.mjs         浏览器端到端测试（35 项，jsdom 真实加载前后台）
```

## 本地自测

无需任何浏览器，纯 Node 即可跑通全部接口与页面逻辑：

```bash
npm install          # 安装 devDependency（jsdom）
npm run test:api     # API 层：鉴权、CRUD、统计、友链、改密等 41 项
npm run test:ui      # 前后台：渲染/搜索/友链申请/登录/菜单/CRUD/联动 35 项
```

`ui.mjs` 用 jsdom 真实加载 `public/index.html` 与 `admin.html`，把 `fetch` 与 `XMLHttpRequest`
桥接到真实的 CF 处理函数上，前后台共享同一份内存 KV，覆盖：前台渲染、本站搜索、友链申请（含 meta 自动抓取）、
后台登录、13 个菜单页渲染、分类/站点新增与保存、前台数据联动、改密码校验，并断言全程无 JS 运行时错误。
