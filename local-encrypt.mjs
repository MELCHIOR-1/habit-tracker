// local-encrypt.mjs —— 仅本地预览用：用口令把明文 checkins.json 重加密成 checkins.enc
// 用法：DATA_PASSPHRASE=你的口令 node local-encrypt.mjs
// 注意：生成的 .enc 仅供本地预览，切勿 commit/push（线上由 GitHub Action 维护）
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { encryptJSON } from './crypto.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, 'data');

const passphrase = process.env.DATA_PASSPHRASE;
if (!passphrase) {
  console.error('[local-encrypt] 缺少 DATA_PASSPHRASE（用法：DATA_PASSPHRASE=口令 node local-encrypt.mjs）');
  process.exit(1);
}

const plain = JSON.parse(readFileSync(join(dataDir, 'checkins.json'), 'utf8'));
const enc = await encryptJSON(plain, passphrase);
writeFileSync(join(dataDir, 'checkins.enc'), enc, 'utf8');

// 统计含体重/运动的天数，方便确认
let w = 0, e = 0;
for (const k in plain) {
  if (typeof plain[k].weight === 'number') w++;
  if (typeof plain[k].exercise_min === 'number' && plain[k].exercise_min > 0) e++;
}
console.log(`[local-encrypt] 已加密 ${Object.keys(plain).length} 天 -> data/checkins.enc（体重 ${w} 天 / 运动 ${e} 天）`);
