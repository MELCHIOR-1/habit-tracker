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
| `jwt_token` | 多邻国 JWT Token（浏览器 cookie 里的 `jwt_token`，DevTools Console 执行 `document.cookie.match(/jwt_token=([^;]+)/)[1]` 获取）。用于调 `/2017-06-30/users/{id}/xp_summaries` 取**逐日练习 XP**，作为「背英语趋势表」的真实数据。代码里映射为环境变量 `DUOLINGO_JWT`。**会过期**，API 返回 401 时需重新获取并更新此 secret |
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
# 本地生成密文（需在本机环境变量设置上面的 5 个值；athleteId 已在代码内恒为 "0"，无需传入）
INTERVALS_KEY=xxx DUOLINGO_USER=wx.d4f7 DUOLINGO_JWT=你的jwt_token WEREAD_API_KEY=wrk-xxx DATA_PASSPHRASE=你的口令 \
  node action-sync.mjs
# 起静态预览
node server.js          # 打开 http://localhost:3000
```

## 注意事项
- ⚠️ **必须用默认 `https://<用户名>.github.io/<仓库名>/` 地址访问，不要绑定自定义域名。** 口令解密依赖浏览器 Web Crypto（`crypto.subtle`），它只在 **HTTPS 或 localhost** 下存在。GitHub Pages 默认 `*.github.io` 子域自带 HTTPS，可直接用；但若绑定自定义域名（如 `blog.shawpan.cn`），GitHub 往往无法为其签发 HTTPS 证书（Enforce HTTPS 报 "domain is not properly configured to support HTTPS"），导致该域名下是 HTTP，`crypto.subtle` 为 `undefined`，口令解密必然失败（报错 `Cannot read properties of undefined (reading 'importKey')`）。如确需自定义域名，须先让 DNS 的 CNAME 正确指向 `MELCHIOR-1.github.io` 且关闭 CDN/Cloudflare 代理，等 GitHub 成功签发证书后再用。
- 数据公开在 Pages 上，但仓库里只存**密文**；没有口令他人无法解。口令不要写进任何文件/提交。
- `data/meta.json`（lastSync）是明文、必须随仓库提交。
- **背英语趋势表用 JWT 拉取的「逐日 XP」**（多邻国 `/xp_summaries` 接口，`gainedXp` 字段），不再是连胜标记占位。需要先配 `jwt_token` secret（会过期，失效后 English 图变空，重新获取即可）。
- **同步是增量的，历史不会被覆盖**：每次 Action 运行时先解密仓库里已有的 `data/checkins.enc` 作为历史基线，再回填最近 **12 个月**（`BACKFILL_MONTHS`，可在 Actions 手动运行时改，如填 `24` 做更深度回溯），最后把合并结果重新加密写回。因此跨月、或某次运行失败，都不会丢历史，下一次运行会自动补回。
  - 注意：`data/checkins.json`（明文）被 `.gitignore` 排除、**不进仓库**，所以历史基线只能来自 `.enc`。这也是为什么早期版本（只同步"本月+上月"）一到 9 月就把 7 月数据冲掉了。

## 踩坑记录（排查用）

### 1. Intervals 的 athleteId 必须填 `"0"`，不是地址栏的数字
- 个人 Intervals 账户的 `athleteId` 默认就是 **`"0"`**，即 `/athlete/0/...` 代表"当前登录用户"。这是参考成功任务「导出华为运动健康数据到网页并自动同步」（`server.py` 里 `DEFAULT_CONFIG["athleteId"] = "0"`、`/athlete/{athlete}/...`）。
- **千万别从地址栏 `https://intervals.icu/athletes/123456/dashboard` 抄那个 `123456` 当 athleteId**——那不是 API 用的 ID，填了会导致体重/运动请求静默失败、永远为空。
- 现代码已**恒用 `"0"`**（`sync.js` 内 `cfg?.athleteId || '0'`，`action-sync.mjs` 固定 `athleteId: '0'`），`INTERVALS_ATHLETE_ID` secret 已废弃，留着也会被忽略。

### 2. 体重/运动趋势图空白？多半是 `.enc` 比 `.json` 旧（加密层本身无 bug）
- 网页**只读 `data/checkins.enc`，绝不读明文 `checkins.json`**。若某次 Action 跑时 Intervals 抓取失败（如旧版缺 athleteId），生成的 `.enc` 里就没有 `weight`/`exercise_min`；而 `checkins.json` 是后来成功同步落地的，二者会**不一致**——于是读书/英语正常、唯独体重/运动空白（且当前月份确实该有数据）。
- **即时验证法**：用仓库里的 `local-encrypt.mjs` 以真实口令把本地明文重加密成 `.enc`（Node 端 `crypto.mjs` 与浏览器算法逐字节一致），localhost 硬刷新即可看到：
  ```bash
  DATA_PASSPHRASE=你的口令 node local-encrypt.mjs
  ```
  生成的 `.enc` **仅供本地预览，切勿 commit/push**（线上由 Action 维护）。
- **成功标志**：正确同步后 `.enc` 体积会明显大于"空数据"时的 **6850 字节**（例如含体重/运动时为 7000+ 字节）。若重跑 Action 后体积仍是 6850，说明 Intervals 那次仍没抓到，看 Action 日志里 `intervals` 字段的 `ok`/`reason` 定位。
- 加密算法本身验证过无 bug：`crypto.mjs` 是对整个对象 `JSON.stringify` 后整体加密，字段一个不丢，且与前端解密兼容。空白不是加密丢字段，而是源数据当时就没抓到。

