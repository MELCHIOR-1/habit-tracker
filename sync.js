import { putDay, getDay, getMeta, setMeta } from './store.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

async function fetchText(url, headers = {}, retries = 2) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers } });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        const detail = t.slice(0, 160).replace(/\n/g, ' ');
        throw new Error(`HTTP ${res.status}${detail ? ' ' + detail : ''}`);
      }
      return res.text();
    } catch (e) {
      lastErr = e;
      if (e.message.startsWith('HTTP')) throw e; // 仅 HTTP 状态错误不重试
      if (attempt < retries) await new Promise((r) => setTimeout(r, 800));
    }
  }
  throw lastErr;
}

// ---------- Intervals.icu (华为运动健康) ----------
// 参考「导出华为运动健康数据到网页并自动同步」成功实现:
//   - 鉴权: Basic base64("API_KEY:" + apiKey)  ← 关键: 用户名固定为 API_KEY, 不是 athleteId
//   - 运动:  /athlete/{athleteId}/activities.csv  ?oldest=&newest= (datetime)
//   - 体重:  /athlete/{athleteId}/wellness        ?oldest=&newest= (date)
function intervalsAuth(apiKey) {
  return `Basic ${Buffer.from(`API_KEY:${apiKey}`).toString('base64')}`;
}

function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQ = false;
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c === '\r') { /* skip */ }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const o = {};
    header.forEach((h, i) => (o[h] = r[i]));
    return o;
  });
}

export async function syncIntervals(year, month, cfg) {
  const athleteId = cfg?.athleteId;
  const apiKey = cfg?.apiKey;
  if (!athleteId || !apiKey) {
    return { ok: false, reason: '未配置 Intervals.icu 凭证（athleteId / apiKey）' };
  }
  const mm = String(month).padStart(2, '0');
  const lastDay = new Date(year, month, 0).getDate();
  const first = `${year}-${mm}-01`;
  const last = `${year}-${mm}-${String(lastDay).padStart(2, '0')}`;
  const base = `https://intervals.icu/api/v1/athlete/${athleteId}`;
  const headers = { Authorization: intervalsAuth(apiKey) };

  const touched = new Set();
  const warnings = [];

  // 1) 体重: wellness 范围查询 (JSON 数组, 每条约日期在 id 字段, weight 为数字)
  try {
    const txt = await fetchText(`${base}/wellness?oldest=${first}&newest=${last}`, headers);
    const rows = JSON.parse(txt);
    for (const w of rows || []) {
      const date = w.id || w.date;
      if (!date) continue;
      const weight = w.weight;
      if (typeof weight === 'number' && weight > 0) {
        putDay(date, { weight });
        touched.add(date);
      }
    }
  } catch (e) {
    warnings.push(`体重(wellness): ${e.message}`);
  }

  // 2) 运动: activities.csv 范围查询 (elapsed_time 秒 -> 分钟, 按天累加)
  try {
    const csv = await fetchText(
      `${base}/activities.csv?oldest=${first}T00:00:00&newest=${last}T23:59:59`,
      headers
    );
    const rows = parseCSV(csv.replace(/^﻿/, ''));
    const sums = {};
    for (const r of rows) {
      const d = (r.start_date_local || '').slice(0, 10);
      if (!d) continue;
      const secs = parseFloat(r.elapsed_time || r.duration || 0);
      if (secs > 0) sums[d] = (sums[d] || 0) + secs;
    }
    for (const [d, secs] of Object.entries(sums)) {
      const mins = Math.round(secs / 60);
      if (mins > 0) {
        putDay(d, { exercise_min: mins });
        touched.add(d);
      }
    }
  } catch (e) {
    warnings.push(`运动(activities): ${e.message}`);
  }

  if (warnings.length && touched.size === 0) {
    return { ok: false, reason: warnings.join('; ') };
  }
  return { ok: true, touched: [...touched], warnings };
}

// ---------- Duolingo (背英语) ----------
// 参考「在网页显示多邻国学习进度数据」成功实现:
//   - /2017-06-30/users?username={username}  -> users[0].id (数字 ID)
//   - 取 streak / totalXp / streakData 推算连续学习日 (连胜窗口)
//   - 用 totalXp 每日增量计算每日 XP (需服务端按日累积快照, 历史连胜日仅标记、无 XP 数值)
export async function syncDuolingo(year, month, cfg) {
  const username = cfg?.username;
  if (!username) {
    return { ok: false, reason: '未配置 Duolingo 用户名 (duolingo.username)' };
  }
  const mm = String(month).padStart(2, '0');
  try {
    const txt = await fetchText(
      `https://www.duolingo.com/2017-06-30/users?username=${encodeURIComponent(username)}`,
      { Accept: 'application/json' }
    );
    const data = JSON.parse(txt);
    const u = data.users && data.users[0];
    if (!u) return { ok: false, reason: `未找到用户 ${username}` };

    const streak = u.streak || 0;
    const totalXp = u.totalXp || 0;
    const sd = u.streakData && u.streakData.currentStreak;
    const endDate = (sd && sd.endDate) || null;

    // 连胜窗口: endDate 往前 streak-1 天 (统一用 UTC 解析, 避免本地时区偏移)
    const window = new Set();
    if (endDate && streak > 0) {
      const [ey, em, ed] = endDate.split('-').map(Number);
      for (let i = 0; i < streak; i++) {
        const dt = new Date(Date.UTC(ey, em - 1, ed - i));
        window.add(dt.toISOString().slice(0, 10));
      }
    }

    // 记录 totalXp 快照 (用于推算每日增量)
    const meta = getMeta();
    const dl = meta.duolingo || { totalXpByDate: {} };
    dl.totalXpByDate = dl.totalXpByDate || {};
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    dl.totalXpByDate[todayStr] = totalXp;
    setMeta({ duolingo: dl });

    const lastDay = new Date(year, month, 0).getDate();
    const prefix = `${year}-${mm}-`;
    const touched = [];
    for (let d = 1; d <= lastDay; d++) {
      const date = `${prefix}${String(d).padStart(2, '0')}`;
      if (date > todayStr) break;
      const prev = dl.totalXpByDate[prevDate(date)];
      const cur = dl.totalXpByDate[date];
      let xp = null;
      if (cur != null && prev != null && cur >= prev) xp = cur - prev;
      const patch = {};
      if (xp != null && xp > 0) patch.english_xp = xp;
      if (window.has(date)) patch.english_streak = true;
      if (Object.keys(patch).length) {
        putDay(date, patch);
        touched.push(date);
      }
    }
    return { ok: true, touched, streak, totalXp };
  } catch (e) {
    return { ok: false, reason: `Duolingo: ${e.message}` };
  }
}

function prevDate(dateStr) {
  const dt = new Date(dateStr + 'T00:00:00Z');
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

// ---------- 微信读书 ----------
// Agent API Gateway: POST i.weread.qq.com/api/agent/gateway
// /readdata/detail mode=monthly -> readTimes 为按天分桶的阅读秒数
export async function syncWeread(year, month, cfg) {
  const apiKey = cfg?.apiKey;
  if (!apiKey) {
    return { ok: false, reason: '未配置 WEREAD_API_KEY' };
  }
  const baseTime = Math.floor(new Date(year, month - 1, 1, 0, 0, 0).getTime() / 1000);
  const body = {
    api_name: '/readdata/detail',
    mode: 'monthly',
    baseTime,
    skill_version: '1.0.4'
  };
  let data;
  try {
    const res = await fetch('https://i.weread.qq.com/api/agent/gateway', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) return { ok: false, reason: `微信读书返回 HTTP ${res.status}` };
    data = await res.json();
  } catch (e) {
    return { ok: false, reason: `微信读书请求失败：${e.message}` };
  }
  if (data && data.errcode && data.errcode !== 0) {
    return { ok: false, reason: `微信读书错误(${data.errcode})：${data.errmsg || ''}` };
  }
  const readTimes = data?.readTimes || {};
  const prefix = `${year}-${String(month).padStart(2, '0')}-`;
  const touched = [];
  for (const [ts, sec] of Object.entries(readTimes)) {
    if (typeof sec !== 'number' || sec < 60) continue; // 不足 1 分钟忽略，避免噪声
    const dt = new Date(Number(ts) * 1000);
    const ds = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    if (ds.startsWith(prefix)) {
      putDay(ds, { reading_min: Math.round(sec / 60) });
      touched.push(ds);
    }
  }
  return { ok: true, touched };
}

// ---------- 编排：整月同步 ----------
export async function syncMonth(year, month, config) {
  const results = {
    intervals: await syncIntervals(year, month, config.intervals),
    duolingo: await syncDuolingo(year, month, config.duolingo),
    weread: await syncWeread(year, month, config.weread)
  };
  const mm = String(month).padStart(2, '0');
  setMeta({
    lastSync: new Date().toISOString(),
    lastSyncTarget: `${year}-${mm}`
  });
  return results;
}
