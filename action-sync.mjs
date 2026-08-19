// action-sync.mjs —— GitHub Actions 入口：拉取三源数据 → 加密 → 写回仓库
// 凭证从环境变量读取（对应仓库 Secrets）：
//   INTERVALS_KEY   Duolingo_USER   WEREAD_API_KEY   DATA_PASSPHRASE
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { syncMonth } from './sync.js';
import { encryptJSON } from './crypto.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, 'data');

const config = {
  intervals: { apiKey: process.env.INTERVALS_KEY || '', athleteId: process.env.INTERVALS_ATHLETE_ID || '0' },
  duolingo: { username: process.env.DUOLINGO_USER || '' },
  weread: { apiKey: process.env.WEREAD_API_KEY || '' }
};

const passphrase = process.env.DATA_PASSPHRASE;
if (!passphrase) {
  console.error('[action] 缺少 DATA_PASSPHRASE（请在仓库 Settings → Secrets 中设置）');
  process.exit(1);
}

// 同步本月 + 上月（保证跨月时数据连续，且 Duolingo 每日 XP 增量有历史基准）
const now = new Date();
const y = now.getFullYear();
const m = now.getMonth() + 1;
const prev = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };

const r1 = await syncMonth(y, m, config);
const r2 = await syncMonth(prev.y, prev.m, config);
console.log('[sync] 本月:', JSON.stringify(r1));
console.log('[sync] 上月:', JSON.stringify(r2));

// store.js 已把聚合结果写入 data/checkins.json（明文，仅本地/runner 用，不进仓库）
const plain = JSON.parse(readFileSync(join(dataDir, 'checkins.json'), 'utf8'));
const enc = await encryptJSON(plain, passphrase);
writeFileSync(join(dataDir, 'checkins.enc'), enc, 'utf8');
console.log(`[encrypt] 已加密 ${Object.keys(plain).length} 天 -> data/checkins.enc`);
