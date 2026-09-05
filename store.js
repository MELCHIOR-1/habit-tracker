import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'checkins.json');
const META_FILE = path.join(DATA_DIR, 'meta.json');

function ensure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJSON(file, fallback) {
  ensure();
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

// 写队列: 串行化所有写操作, 避免并发 rename 在 Windows 上触发 EPERM
let writeChain = Promise.resolve();
function writeJSON(file, obj) {
  ensure();
  const run = () => new Promise((resolve) => {
    const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
      try {
        fs.renameSync(tmp, file);
      } catch {
        // Windows: 目标文件被占用时 rename 会 EPERM, 退回直接覆盖写
        fs.writeFileSync(file, JSON.stringify(obj, null, 2));
        try { fs.unlinkSync(tmp); } catch { /* ignore */ }
      }
    } catch { /* ignore write errors */ }
    resolve();
  });
  writeChain = writeChain.then(run, run);
  return writeChain;
}

let cache = readJSON(DATA_FILE, {});
let meta = readJSON(META_FILE, { lastSync: null, lastSyncTarget: null });

export function getAll() {
  return cache;
}

// 把已有历史合并进内存缓存（增量基线）。
// 用于 Action 每次运行时先解密仓库里的 checkins.enc 作为起点，
// 保证历史数据不会被后续同步覆盖丢失。
export function loadAll(obj) {
  if (!obj || typeof obj !== 'object') return cache;
  let n = 0;
  for (const [d, v] of Object.entries(obj)) {
    if (!v || typeof v !== 'object') continue;
    cache[d] = { ...(cache[d] || {}), ...v, date: d };
    n++;
  }
  return cache;
}

export function getDay(date) {
  return cache[date] || null;
}

export function putDay(date, patch) {
  const cur = cache[date] || { date };
  // 只写入有明确值的字段，避免用 undefined 覆盖已有数据
  const next = { ...cur, date };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    next[k] = v;
  }
  next.updatedAt = new Date().toISOString();
  cache[date] = next;
  writeJSON(DATA_FILE, cache);
  return next;
}

// 清空某月指定字段（用于「按数据源整月重建」）。
// 背景：增量同步只写不删，一旦某个数据源因 bug（如归日错位）写脏了历史，
// 后续再同步只会叠加正确值，脏值永远清不掉。因此每个数据源在「成功」拉到
// 某月数据后，先清掉该月由自己负责的字段，再整体重写。
export function clearMonthFields(year, month, fields) {
  const prefix = `${year}-${String(month).padStart(2, '0')}-`;
  let n = 0;
  for (const [d, v] of Object.entries(cache)) {
    if (!d.startsWith(prefix) || !v || typeof v !== 'object') continue;
    let changed = false;
    const next = { ...v };
    for (const f of fields) {
      if (Object.prototype.hasOwnProperty.call(next, f)) {
        delete next[f];
        changed = true;
      }
    }
    if (!changed) continue;
    const rest = Object.keys(next).filter((k) => k !== 'date' && k !== 'updatedAt');
    if (rest.length === 0) delete cache[d];
    else cache[d] = next;
    n++;
  }
  if (n) writeJSON(DATA_FILE, cache);
  return n;
}

// 统计某月包含指定字段中任一字段的天数（用于「拉到 0 天」时的安全兜底判断）
export function countMonthFields(year, month, fields) {
  const prefix = `${year}-${String(month).padStart(2, '0')}-`;
  let n = 0;
  for (const [d, v] of Object.entries(cache)) {
    if (!d.startsWith(prefix) || !v || typeof v !== 'object') continue;
    if (fields.some((f) => typeof v[f] === 'number' || typeof v[f] === 'boolean')) n++;
  }
  return n;
}

export function getMonth(year, month) {
  const prefix = `${year}-${String(month).padStart(2, '0')}-`;
  const out = {};
  for (const [d, v] of Object.entries(cache)) {
    if (d.startsWith(prefix)) out[d] = v;
  }
  return out;
}

export function getMeta() {
  return meta;
}

export function setMeta(patch) {
  meta = { ...meta, ...patch };
  writeJSON(META_FILE, meta);
  return meta;
}
