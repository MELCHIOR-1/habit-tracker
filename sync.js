import { putDay, getMeta, setMeta, clearMonthFields, countMonthFields } from './store.js';

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

// 把 Unix 秒按 Asia/Shanghai（+08:00，全年无夏令时）折算成 'YYYY-MM-DD'。
// runner / 服务器常运行在 UTC，直接用 toISOString() 会把北京时间 00:00~08:00
// 的记录算成前一天，造成每月首尾数据错位甚至丢天。
function dateCN(tsSec) {
  return new Date((Number(tsSec) + 8 * 3600) * 1000).toISOString().slice(0, 10);
}

// 北京时间某月 1 号 00:00 对应的 Unix 秒（用于按月请求第三方接口）
function monthStartCN(year, month) {
  return Math.floor(Date.UTC(year, month - 1, 1, 0, 0, 0) / 1000) - 8 * 3600;
}

// 把某个数据源在某月的结果「整月重建」：先清空该数据源负责的字段，再整体写入。
//
// 为什么必须重建而不是叠加：增量同步只写不删。一旦某数据源因 bug（例如归日
// 错位把 8/3 的读书写到了 8/2）写脏了历史，后续同步只会追加正确的一天，
// 脏的那天永远清不掉，于是网页显示的天数比 App 多。
//
// 安全兜底：若本次拉到 0 天，而本地该月已有数据，说明更可能是接口抖动/限流，
// 此时保留旧数据并告警，避免整月被误清空。
function rebuildMonth(year, month, fields, entries, warnings, label) {
  if (entries.length === 0) {
    const existing = countMonthFields(year, month, fields);
    if (existing > 0) {
      warnings.push(`${label}: 本次返回 0 天，但本地已有 ${existing} 天，疑似接口异常，保留旧数据`);
      return 0;
    }
  }
  clearMonthFields(year, month, fields);
  for (const [ds, patch] of entries) putDay(ds, patch);
  return entries.length;
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
  // 参考「导出华为运动健康数据到网页并自动同步」: 个人 Intervals 账户的 athleteId 用 "0" 即可
  const athleteId = cfg?.athleteId || '0';
  const apiKey = cfg?.apiKey;
  if (!apiKey) {
    return { ok: false, reason: '未配置 Intervals.icu 凭证（apiKey）' };
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
    const entries = [];
    for (const w of rows || []) {
      const date = w.id || w.date;
      if (!date) continue;
      const weight = w.weight;
      if (typeof weight === 'number' && weight > 0) entries.push([date, { weight }]);
    }
    rebuildMonth(year, month, ['weight'], entries, warnings, '体重(wellness)');
    for (const [d] of entries) touched.add(d);
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
    const entries = [];
    for (const [d, secs] of Object.entries(sums)) {
      const mins = Math.round(secs / 60);
      if (mins > 0) entries.push([d, { exercise_min: mins }]);
    }
    rebuildMonth(year, month, ['exercise_min'], entries, warnings, '运动(activities)');
    for (const [d] of entries) touched.add(d);
  } catch (e) {
    warnings.push(`运动(activities): ${e.message}`);
  }

  if (warnings.length && touched.size === 0) {
    return { ok: false, reason: warnings.join('; ') };
  }
  return { ok: true, touched: [...touched], warnings };
}

// ---------- Duolingo (背英语) ----------
// 用 JWT 调多邻国官方接口取「逐日练习 XP」，作为背英语趋势表的数据输入:
//   - /2017-06-30/users?username={username}            -> users[0].id (数字 userId)
//   - /2017-06-30/users/{userId}/xp_summaries          -> summaries:[{gainedXp, date}]，date 为 Unix 秒
//       （Authorization: Bearer <JWT>，jwt 取自 GitHub secret）
export async function syncDuolingo(year, month, cfg) {
  const username = cfg?.username;
  const jwt = cfg?.jwt;
  if (!username) {
    return { ok: false, reason: '未配置 Duolingo 用户名 (duolingo.username)' };
  }
  const mm = String(month).padStart(2, '0');
  const prefix = `${year}-${mm}-`;
  const lastDay = new Date(year, month, 0).getDate();
  const start = `${year}-${mm}-01`;
  const end = `${year}-${mm}-${String(lastDay).padStart(2, '0')}`;

  try {
    // 1) 解析数字 userId（无鉴权即可）
    const txt = await fetchText(
      `https://www.duolingo.com/2017-06-30/users?username=${encodeURIComponent(username)}`,
      { Accept: 'application/json' }
    );
    const data = JSON.parse(txt);
    const u = data.users && data.users[0];
    if (!u) return { ok: false, reason: `未找到用户 ${username}` };
    const userId = u.id;

    // 2) 用 JWT 拉逐日 XP（仅目标月份，控制返回体量）
    const byDate = {}; // 'YYYY-MM-DD' -> gainedXp
    if (jwt) {
      try {
        const ctxt = await fetchText(
          `https://www.duolingo.com/2017-06-30/users/${userId}/xp_summaries?startDate=${start}&endDate=${end}&timezone=Asia/Shanghai`,
          { Accept: 'application/json', Authorization: `Bearer ${jwt}` }
        );
        const cdata = JSON.parse(ctxt);
        for (const s of cdata.summaries || []) {
          const xp = typeof s.gainedXp === 'number' ? s.gainedXp : 0;
          if (!xp) continue; // 无练习 / 冻结日跳过
          const ds = dateCN(s.date || 0); // 按北京时间归日，避免 UTC 错位一天
          if (ds.startsWith(prefix)) byDate[ds] = xp;
        }
      } catch (e) {
        return { ok: false, reason: `英语(xp_summaries JWT): ${e.message}` };
      }
    } else {
      return { ok: false, reason: '未配置 DUOLINGO_JWT（背英语逐日 XP 需要 JWT）' };
    }

    const entries = Object.entries(byDate).map(([ds, xp]) => [ds, { english_xp: xp }]);
    const warnings = [];
    // english_streak 是早期版本的兜底信号，现已由 english_xp 取代，重建时一并清掉
    rebuildMonth(year, month, ['english_xp', 'english_streak'], entries, warnings, '英语(xp_summaries)');
    const touched = entries.map(([ds]) => ds);
    return { ok: true, touched, jwtUsed: true, days: touched.length, warnings };
  } catch (e) {
    return { ok: false, reason: `Duolingo: ${e.message}` };
  }
}

// ---------- 微信读书 ----------
// Agent API Gateway: POST i.weread.qq.com/api/agent/gateway
// /readdata/detail mode=monthly -> readTimes 为按天分桶的阅读秒数
export async function syncWeread(year, month, cfg) {
  const apiKey = cfg?.apiKey;
  if (!apiKey) {
    return { ok: false, reason: '未配置 WEREAD_API_KEY' };
  }
  const baseTime = monthStartCN(year, month); // 北京时间月首零点
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
  const warnings = [];
  const entries = [];
  for (const [ts, sec] of Object.entries(readTimes)) {
    // 不足 1 分钟视为噪声（微信读书 App 未计入，实测存在 24s / 26s 这类残留桶）
    if (typeof sec !== 'number' || sec < 60) continue;
    const ds = dateCN(Number(ts)); // 按北京时间归日：接口返回的桶是北京当天 00:00
    if (ds.startsWith(prefix)) {
      entries.push([ds, { reading_min: Math.max(1, Math.round(sec / 60)) }]);
    }
  }
  rebuildMonth(year, month, ['reading_min'], entries, warnings, '微信读书(readTimes)');
  return { ok: true, touched: entries.map(([d]) => d), warnings };
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
