// action-sync.mjs —— GitHub Actions 入口：拉取三源数据 → 加密 → 写回仓库
// 凭证从环境变量读取（对应仓库 Secrets）：
//   INTERVALS_KEY   DUOLINGO_USER   jwt_token(→DUOLINGO_JWT)   WEREAD_API_KEY   DATA_PASSPHRASE
//
// 增量更新机制（避免跨月后历史数据丢失）：
//   1) 先把仓库里已有的 data/checkins.enc 解密，作为历史基线载入 store
//   2) 再回填最近 N 个月（BACKFILL_MONTHS，默认 6），把数据源的最新值叠加到基线上
//   3) 最后把合并后的完整数据重新加密写回 data/checkins.enc
// 注：data/checkins.json 被 .gitignore 排除，不会进仓库，因此基线只能来自 .enc。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { syncMonth } from './sync.js';
import { loadAll, getAll, setMeta } from './store.js';
import { encryptJSON, decryptJSON } from './crypto.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, 'data');
const encPath = join(dataDir, 'checkins.enc');

const config = {
  intervals: { apiKey: process.env.INTERVALS_KEY || '', athleteId: '0' }, // 个人 Intervals 账户 athleteId 恒用 "0"（参考成功任务），不再依赖 INTERVALS_ATHLETE_ID secret
  duolingo: { username: process.env.DUOLINGO_USER || '', jwt: process.env.DUOLINGO_JWT || '' },
  weread: { apiKey: process.env.WEREAD_API_KEY || '' }
};

const passphrase = process.env.DATA_PASSPHRASE;
if (!passphrase) {
  console.error('[action] 缺少 DATA_PASSPHRASE（请在仓库 Settings → Secrets 中设置）');
  process.exit(1);
}

// ---------- 1) 载入历史基线（增量关键） ----------
if (existsSync(encPath)) {
  try {
    const prev = await decryptJSON(readFileSync(encPath, 'utf8'), passphrase);
    const days = Object.keys(prev || {}).length;
    loadAll(prev);
    console.log(`[baseline] 已载入历史 ${days} 天作为增量基线`);
  } catch (e) {
    // 口令变更 / 文件损坏时不要中断任务，从空基线重建（本次回填会尽量补回）
    console.warn(`[baseline] 解密历史失败，本次从空数据重建：${e.message}`);
  }
} else {
  console.warn('[baseline] 未找到 data/checkins.enc，本次从空数据开始');
}

// ---------- 2) 回填最近 N 个月 ----------
// 只同步「本月+上月」会导致跨月后更早的数据被丢弃，故改为滚动回填多个月；
// 中途某次任务失败也能在下一次自愈补回。
const months = Math.max(1, Number(process.env.BACKFILL_MONTHS || 6));
const now = new Date();
const targets = [];
for (let i = 0; i < months; i++) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
  targets.push({ y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 });
}
console.log(`[sync] 回填范围：${targets[targets.length - 1].y}-${String(targets[targets.length - 1].m).padStart(2, '0')} ~ ${targets[0].y}-${String(targets[0].m).padStart(2, '0')}（${months} 个月）`);

const failures = [];
for (const { y, m } of targets) {
  const tag = `${y}-${String(m).padStart(2, '0')}`;
  try {
    const r = await syncMonth(y, m, config);
    const bad = Object.entries(r).filter(([, v]) => v && v.ok === false);
    if (bad.length) failures.push(`${tag}: ${bad.map(([k, v]) => `${k}(${v.reason})`).join('; ')}`);
    console.log(`[sync] ${tag}:`, JSON.stringify(r));
  } catch (e) {
    failures.push(`${tag}: ${e.message}`);
    console.warn(`[sync] ${tag} 失败：${e.message}`);
  }
}

// ---------- 3) 重新加密写回 ----------
const plain = getAll();
const enc = await encryptJSON(plain, passphrase);
writeFileSync(encPath, enc, 'utf8');
setMeta({
  lastSync: new Date().toISOString(),
  lastSyncTarget: `${targets[0].y}-${String(targets[0].m).padStart(2, '0')}`,
  backfillMonths: months
});
console.log(`[encrypt] 共 ${Object.keys(plain).length} 天 -> data/checkins.enc`);
if (failures.length) {
  console.warn(`[warn] 以下月份/数据源未完全成功（历史数据已保留，下次运行会重试）：\n  ${failures.join('\n  ')}`);
}
