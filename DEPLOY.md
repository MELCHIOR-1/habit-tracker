# 部署说明（GitHub Pages + 口令加密）

本仓库是**纯静态站点**：数据由 GitHub Actions 自动抓取并加密，前端在浏览器用口令解密后展示。无后端、无服务器。

## 架构
```
GitHub Actions (每日 UTC 22:00 即北京 06:00)
   └─ action-sync.mjs：拉 Intervals / Duolingo / 微信读书
        └─ 用 DATA_PASSPHRASE 把 checkins.json 加密成 data/checkins.enc
             └─ commit 回仓库
GitHub Pages (main 分支 / 根目录)
   └─ index.html 加载 data/checkins.enc
        └─ 浏览器用口令 AES-GCM 解密 → 渲染日历+趋势图
```

## 1. 配置 Secrets（仓库 Settings → Secrets and variables → Actions → New repository secret）
| Name | 说明 |
|---|---|
| `INTERVALS_KEY` | Intervals.icu 的 API Key（Settings → API 里的 Key，Basic 鉴权用户名固定 `API_KEY`） |
| ~~`INTERVALS_ATHLETE_ID`~~（**已废弃，无需配置**） | 早期版本需要从 intervals.icu 地址栏查 athleteId 配成 secret，容易填错导致体重/运动抓不到。现已改为代码恒用 `0`（参考成功任务「导出华为运动健康数据到网页并自动同步」，`/athlete/0/...` 即代表当前用户），**这个 secret 可以删掉**，留着也会被忽略。 |
| `DUOLINGO_USER` | 多邻国手柄/用户名（如 `wx.d4f7`），脚本自动解析数字 ID |
| `WEREAD_API_KEY` | 微信读书网关 Key（格式 `wrk-xxxx`） |
| `DATA_PASSPHRASE` | **查看口令**：你自己定的任意字符串，用于加密与浏览器解密。**务必牢记** |

> 密钥只在 Action runner 内使用，永远不会进入前端或浏览器。

## 2. 开启 Pages
仓库 Settings → Pages → Source 选 **Deploy from a branch** → Branch 选 **main** → 目录 **/ (root)** → Save。
（首次开启后约 1 分钟可访问 `https://<用户名>.github.io/<仓库名>/`）

## 3. 查看
打开 Pages 地址 → 输入你设置的 `DATA_PASSPHRASE` → 看到日历与趋势图。
数据每天北京时间 06:00 自动更新；也可在 Actions 页点 **Run workflow** 手动触发。

## 本地预览（可选）
```bash
# 本地生成密文（需在本机环境变量设置上面的 5 个值）
INTERVALS_KEY=xxx INTERVALS_ATHLETE_ID=123456 DUOLINGO_USER=wx.d4f7 WEREAD_API_KEY=wrk-xxx DATA_PASSPHRASE=你的口令 \
  node action-sync.mjs
# 起静态预览
node server.js          # 打开 http://localhost:3000
```

## 注意事项
- ⚠️ **必须用默认 `https://<用户名>.github.io/<仓库名>/` 地址访问，不要绑定自定义域名。** 口令解密依赖浏览器 Web Crypto（`crypto.subtle`），它只在 **HTTPS 或 localhost** 下存在。GitHub Pages 默认 `*.github.io` 子域自带 HTTPS，可直接用；但若绑定自定义域名（如 `blog.shawpan.cn`），GitHub 往往无法为其签发 HTTPS 证书（Enforce HTTPS 报 "domain is not properly configured to support HTTPS"），导致该域名下是 HTTP，`crypto.subtle` 为 `undefined`，口令解密必然失败（报错 `Cannot read properties of undefined (reading 'importKey')`）。如确需自定义域名，须先让 DNS 的 CNAME 正确指向 `MELCHIOR-1.github.io` 且关闭 CDN/Cloudflare 代理，等 GitHub 成功签发证书后再用。
- 数据公开在 Pages 上，但仓库里只存**密文**；没有口令他人无法解。口令不要写进任何文件/提交。
- `data/meta.json`（lastSync、多邻国 XP 累计基准）是明文、必须随仓库提交，否则每日 XP 增量会断。
- Duolingo 公开接口目前不返回历史按日 XP，英语"已打卡"用连胜窗口标记，真实每日 XP 从每天同步起逐日累积。
