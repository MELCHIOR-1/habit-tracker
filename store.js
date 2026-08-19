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
