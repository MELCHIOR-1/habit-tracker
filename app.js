const METRICS = {
  exercise_min: { label: '运动', unit: '分钟', color: 'var(--exercise)', cls: 'exercise', icon: '🏃' },
  weight: { label: '体重', unit: 'kg', color: 'var(--weight)', cls: 'weight', icon: '⚖️' },
  reading_min: { label: '读书', unit: '分钟', color: 'var(--reading)', cls: 'reading', icon: '📚' },
  english_xp: { label: '英语', unit: 'XP', color: 'var(--english)', cls: 'english', icon: '🔤' }
};

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

const state = {
  year: new Date().getFullYear(),
  month: new Date().getMonth() + 1,
  allDays: {}   // 解密后的全量数据：{ 'YYYY-MM-DD': {...} }
};

const $ = (sel) => document.querySelector(sel);

function pad(n) { return String(n).padStart(2, '0'); }
function ymd(y, m, d) { return `${y}-${pad(m)}-${pad(d)}`; }

// ---------- 农历（公历 → 农历日，1900-2099 数据表） ----------
const LUNAR_INFO = [0x04bd8,0x04ae0,0x0a570,0x054d5,0x0d260,0x0d950,0x16554,0x056a0,0x09ad0,0x055d2,0x04ae0,0x0a5b6,0x0a4d0,0x0d250,0x1d255,0x0b540,0x0d6a0,0x0ada2,0x095b0,0x14977,0x04970,0x0a4b0,0x0b4b5,0x06a50,0x06d40,0x1ab54,0x02b60,0x09570,0x052f2,0x04970,0x06566,0x0d4a0,0x0ea50,0x06e95,0x05ad0,0x02b60,0x186e3,0x092e0,0x1c8d7,0x0c950,0x0d4a0,0x1d8a6,0x0b550,0x056a0,0x1a5b4,0x025d0,0x092d0,0x0d2b2,0x0a950,0x0b557,0x06ca0,0x0b550,0x15355,0x04da0,0x0a5b0,0x14573,0x052b0,0x0a9a8,0x0e950,0x06aa0,0x0aea6,0x0ab50,0x04b60,0x0aae4,0x0a570,0x05260,0x0f263,0x0d950,0x05b57,0x056a0,0x096d0,0x04dd5,0x04ad0,0x0a4d0,0x0d4d4,0x0d250,0x0d558,0x0b540,0x0b6a0,0x195a6,0x095b0,0x049b0,0x0a974,0x0a4b0,0x0b27a,0x06a50,0x06d40,0x0af46,0x0ab60,0x09570,0x04af5,0x04970,0x064b0,0x074a3,0x0ea50,0x06b58,0x05ac0,0x0ab60,0x096d5,0x092e0,0x0c960,0x0d954,0x0d4a0,0x0da50,0x07552,0x056a0,0x0abb7,0x025d0,0x092d0,0x0cab5,0x0a950,0x0b4a0,0x0baa4,0x0ad50,0x055d9,0x04ba0,0x0a5b0,0x15176,0x052b0,0x0a930,0x07954,0x06aa0,0x0ad50,0x05b52,0x04b60,0x0a6e6,0x0a4e0,0x0d260,0x0ea65,0x0d530,0x05aa0,0x076a3,0x096d0,0x04afb,0x04ad0,0x0a4d0,0x1d0b6,0x0d250,0x0d520,0x0dd45,0x0b5a0,0x056d0,0x055b2,0x049b0,0x0a577,0x0a4b0,0x0aa50,0x1b255,0x06d20,0x0ada0,0x14b63,0x09370,0x049f8,0x04970,0x064b0,0x168a6,0x0ea50,0x06b20,0x1a6c4,0x0aae0,0x0a2e0,0x0d2d4,0x0d510,0x0e5ca,0x0d4a0,0x0da50,0x1eaa4,0x074a0,0x0d4a0,0x0c4d8,0x0ea50,0x076a0,0x0a6e0,0x0a4d4,0x0a4d0,0x0d2d0,0x0d280,0x0d4a0,0x0dd40,0x0a550,0x05b60,0x0a6e6,0x0ada0,0x02550,0x0aba4,0x0a950,0x0b640,0x0baa0,0x0b4a0,0x0a5b0,0x05250,0x0ada6,0x0a6d0,0x0d4d0,0x0d4f0,0x0d2b0,0x0b560,0x05d90,0x0a950,0x0a4d0];
function lYearDays(y){ let s=348; const info=LUNAR_INFO[y-1900]; s+=(info&0x8000)?1:0; s+=(info&0x4000)?1:0; s+=(info&0x2000)?1:0; s+=(info&0x1000)?1:0; s+=(info&0x0800)?1:0; s+=(info&0x0400)?1:0; s+=(info&0x0200)?1:0; s+=(info&0x0100)?1:0; s+=(info&0x0080)?1:0; s+=(info&0x0040)?1:0; s+=(info&0x0020)?1:0; s+=(info&0x0010)?1:0; const lm = info&0xf; if(lm) return s+((info&0x10000)?30:29); return s; }
function leapMonthOf(y){ return LUNAR_INFO[y-1900]&0xf; }
function leapDaysOf(y){ const lm = LUNAR_INFO[y-1900]&0xf; return lm?((LUNAR_INFO[y-1900]&0x10000)?30:29):0; }
function monthDaysOf(y,m){ return (LUNAR_INFO[y-1900]&(0x10000>>m))?30:29; }
function getLunarDay(y, m, d){
  const obj = new Date(y, m - 1, d);
  y = obj.getFullYear(); m = obj.getMonth() + 1; d = obj.getDate();
  let offset = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1900, 0, 31)) / 86400000);
  let i, temp = 0;
  for(i = 1900; i < 2101 && offset > 0; i++){ temp = lYearDays(i); offset -= temp; }
  if(offset < 0){ offset += temp; i--; }
  const finalYear = i;
  const lm = leapMonthOf(finalYear);
  let isLeap = false;
  for(i = 1; i < 13 && offset > 0; i++){
    if(lm > 0 && i === lm + 1 && !isLeap){ --i; isLeap = true; temp = leapDaysOf(finalYear); }
    else { temp = monthDaysOf(finalYear, i); }
    if(isLeap && i === lm + 1) isLeap = false;
    offset -= temp;
  }
  if(offset === 0 && lm > 0 && i === lm + 1){ if(isLeap) isLeap = false; else { isLeap = true; --i; } }
  if(offset < 0){ offset += temp; --i; }
  return offset + 1;
}
const LUNAR_DAY_CN1 = ['日','一','二','三','四','五','六','七','八','九','十'];
const LUNAR_DAY_CN2 = ['初','十','廿','卅'];
function lunarDayCN(n){
  if(n === 10) return '初十';
  if(n === 20) return '二十';
  if(n === 30) return '三十';
  return LUNAR_DAY_CN2[Math.floor(n / 10)] + LUNAR_DAY_CN1[n % 10];
}

// ---------- 解密（Web Crypto，算法与 crypto.mjs 严格一致） ----------
const SALT_LEN = 16, IV_LEN = 12, ITER = 150000;
function b64uToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
async function deriveKey(pass, salt) {
  if (!globalThis.crypto || !globalThis.crypto.subtle) {
    throw new Error(
      '当前打开方式不支持解密：浏览器要求 AES 加密只能在「HTTPS」或「localhost」下运行。\n' +
      '请用以下任一方式访问：\n' +
      '· 部署后通过 https 开头的 Pages 地址（如 https://MELCHIOR-1.github.io/habit-tracker/）\n' +
      '· 本地用 node server.js 启动，再访问 http://localhost:3000\n' +
      '不要直接双击 file:// 打开，也不要用局域网 IP（如 http://192.168.x.x）访问。'
    );
  }
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']
  );
}
async function decryptJSON(payload, pass) {
  const [s, i, c] = payload.trim().split('.');
  const salt = b64uToBytes(s), iv = b64uToBytes(i), ct = b64uToBytes(c);
  const key = await deriveKey(pass, salt);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return JSON.parse(new TextDecoder().decode(plain));
}

async function loadData(pass) {
  const res = await fetch('data/checkins.enc', { cache: 'no-store' });
  if (!res.ok) throw new Error('数据文件不存在，可能 Action 还没运行过');
  return decryptJSON(await res.text(), pass);
}

// ---------- 图例 ----------
function renderLegend() {
  $('#legend').innerHTML = Object.values(METRICS).map((m) => `
    <span class="item">
      <span class="legend-icon">${m.icon}</span>${m.label}（${m.unit}）
    </span>`).join('');
}

// ---------- 状态条（数据更新时间） ----------
async function renderStatus() {
  let t = '未知';
  try {
    const r = await fetch('data/meta.json', { cache: 'no-store' });
    if (r.ok) {
      const meta = await r.json();
      if (meta.lastSync) t = new Date(meta.lastSync).toLocaleString('zh-CN');
    }
  } catch {}
  $('#status').innerHTML = `数据更新：${t} · 已加密，需口令查看`;
}

// ---------- 日历 ----------
function renderCalendar() {
  const { year, month, allDays } = state;
  const el = $('#calendar');
  const first = new Date(year, month - 1, 1);
  const startWeekday = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month, 0).getDate();
  const todayStr = ymd(new Date().getFullYear(), new Date().getMonth() + 1, new Date().getDate());

  let html = WEEKDAYS.map((w) => `<div class="weekday">${w}</div>`).join('');
  for (let i = 0; i < startWeekday; i++) html += `<div class="day empty"></div>`;

  for (let d = 1; d <= daysInMonth; d++) {
    const key = ymd(year, month, d);
    const rec = allDays[key] || {};
    const icons = [];
    for (const [field, meta] of Object.entries(METRICS)) {
      let has = false;
      if (field === 'weight') has = typeof rec[field] === 'number';
      else if (field === 'english_xp') has = (typeof rec.english_xp === 'number' && rec.english_xp > 0) || rec.english_streak === true;
      else has = typeof rec[field] === 'number' && rec[field] > 0;
      if (has) icons.push(`<span class="emoji ${meta.cls}" title="${meta.label}">${meta.icon}</span>`);
    }
    const checked = icons.length > 0;
    const isToday = key === todayStr;
    const lunarText = lunarDayCN(getLunarDay(year, month, d));
    html += `
      <div class="day ${checked ? 'checked' : ''} ${isToday ? 'today' : ''}" data-date="${key}">
        <div class="day-head">
          <div class="num">${d}</div>
          <div class="lunar" title="农历${lunarText}">${lunarText}</div>
        </div>
        <div class="icons">${icons.join('')}</div>
      </div>`;
  }
  el.innerHTML = html;
  el.querySelectorAll('.day[data-date]').forEach((cell) => cell.addEventListener('click', () => openDay(cell.dataset.date)));
}

// ---------- 趋势图（自绘 SVG 柱状） ----------
function drawBarChart(container, series, meta, opts = {}) {
  const skipMissing = opts.skipMissing || false;
  const W = 320, H = 160, padL = 38, padR = 12, padT = 16, padB = 24;
  const plotW = W - padL - padR, plotH = H - padT - padB;

  const vals = series.map((p) => (skipMissing && p.v == null ? null : p.v));
  const present = vals.filter((v) => v != null);
  if (present.length === 0) { container.innerHTML = `<div class="empty">本月暂无数据</div>`; return; }
  const maxV = Math.max(...present, skipMissing ? 1 : 0);
  const minV = skipMissing ? Math.min(...present) : 0;
  const range = maxV - minV || 1;
  const n = series.length;

  const slot = plotW / n;
  const barW = Math.max(2, Math.min(slot * 0.66, 16));
  const yOf = (v) => padT + plotH - ((v - minV) / range) * plotH;
  const xCenterOf = (i) => padL + slot * i + slot / 2;

  let grid = '';
  for (let t = 0; t <= 4; t++) {
    const val = minV + (range * t) / 4;
    const y = yOf(val);
    grid += `<line class="grid" x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" />`;
    grid += `<text class="label" x="${padL - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end">${Math.round(val)}</text>`;
  }

  let bars = '', lastLabelX = -1e9;
  series.forEach((p, i) => {
    let v = p.v;
    if (v == null) return;
    if (!skipMissing && v === 0) return;
    const cx = xCenterOf(i), x = cx - barW / 2, yTop = yOf(v);
    const h = Math.max(0, padT + plotH - yTop);
    const r = Math.min(3, barW / 2, h), day = i + 1;
    bars += `<rect class="bar" x="${x.toFixed(1)}" y="${yTop.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="${r.toFixed(1)}" ry="${r.toFixed(1)}" fill="${meta.color}"><title>${day}日：${Math.round(v)}${meta.unit || ''}</title></rect>`;
    const lbl = Math.round(v);
    if (cx - lastLabelX > barW * 2.4) {
      bars += `<text class="val" x="${cx.toFixed(1)}" y="${(yTop - 5).toFixed(1)}" text-anchor="middle" fill="${meta.color}">${lbl}</text>`;
      lastLabelX = cx;
    }
  });

  let xlabels = '';
  [1, Math.ceil(n / 2), n].filter((v, i, a) => a.indexOf(v) === i).forEach((day) => {
    xlabels += `<text class="label" x="${xCenterOf(day - 1).toFixed(1)}" y="${H - 8}" text-anchor="middle">${day}</text>`;
  });

  container.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" role="img">
      ${grid}
      <line class="axis" x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" />
      <line class="axis" x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}" />
      ${bars}
      ${xlabels}
    </svg>`;
}

function renderCharts() {
  const { year, month, allDays } = state;
  const daysInMonth = new Date(year, month, 0).getDate();
  const build = (field, skipMissing) => {
    const arr = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const rec = allDays[ymd(year, month, d)] || {};
      const v = rec[field];
      arr.push({ v: typeof v === 'number' ? v : (skipMissing ? null : 0) });
    }
    return arr;
  };
  drawBarChart($('#chartExercise'), build('exercise_min', false), METRICS.exercise_min);
  drawBarChart($('#chartWeight'), build('weight', true), METRICS.weight, { skipMissing: true });
  drawBarChart($('#chartReading'), build('reading_min', false), METRICS.reading_min);
  drawBarChart($('#chartEnglish'), build('english_xp', false), METRICS.english_xp);
}

function renderAll() {
  $('#monthLabel').textContent = `${state.year}年${state.month}月`;
  renderCalendar();
  renderCharts();
  renderStatus();
}

// ---------- 日明细弹窗（只读） ----------
function openDay(date) {
  const rec = state.allDays[date] || {};
  $('#dayTitle').textContent = `${date} 明细`;
  $('#dayBody').innerHTML = Object.entries(METRICS).map(([field, m]) => {
    const v = rec[field];
    let shown;
    if (field === 'weight') shown = typeof v === 'number' ? `${v} kg` : '—';
    else if (field === 'english_xp') shown = (typeof v === 'number' && v > 0) ? `${v} ${m.unit}` : (rec.english_streak ? '连胜日 ✓' : '—');
    else shown = (typeof v === 'number' && v > 0) ? `${v} ${m.unit}` : '—';
    return `<div class="day-row"><span class="emoji ${m.cls}">${m.icon}</span><span>${m.label}</span><b>${shown}</b></div>`;
  }).join('');
  $('#dayModal').hidden = false;
  $('#dayMask').hidden = false;
}
function closeDay() { $('#dayModal').hidden = true; $('#dayMask').hidden = true; }

// ---------- 口令 ----------
function showPass() {
  $('#passError').hidden = true;
  $('#passInput').value = '';
  $('#passModal').hidden = false;
  $('#passMask').hidden = false;
  setTimeout(() => $('#passInput').focus(), 50);
}
function hidePass() { $('#passModal').hidden = true; $('#passMask').hidden = true; }
async function submitPass() {
  const pass = $('#passInput').value;
  if (!pass) return;
  $('#passError').hidden = true;
  try {
    state.allDays = await loadData(pass);
    sessionStorage.setItem('ht_pass', pass);
    hidePass();
    renderAll();
  } catch (e) {
    $('#passError').textContent = e.message || '解密失败';
    $('#passError').hidden = false;
  }
}
function lock() {
  sessionStorage.removeItem('ht_pass');
  state.allDays = {};
  $('#calendar').innerHTML = '';
  showPass();
}

// ---------- 事件 ----------
function bind() {
  $('#prev').addEventListener('click', () => {
    if (state.month === 1) { state.month = 12; state.year--; } else state.month--;
    renderAll();
  });
  $('#next').addEventListener('click', () => {
    if (state.month === 12) { state.month = 1; state.year++; } else state.month++;
    renderAll();
  });
  $('#lockBtn').addEventListener('click', lock);
  $('#passSubmit').addEventListener('click', submitPass);
  $('#passInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitPass(); });
  $('#dayClose').addEventListener('click', closeDay);
  $('#dayMask').addEventListener('click', closeDay);
}

// ---------- 初始化 ----------
renderLegend();
bind();
const saved = sessionStorage.getItem('ht_pass');
if (saved) {
  loadData(saved).then((d) => { state.allDays = d; renderAll(); }).catch(() => showPass());
} else {
  showPass();
}
