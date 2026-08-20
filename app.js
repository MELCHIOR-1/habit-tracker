const METRICS = {
  exercise_min: { label: '运动', unit: '分钟', color: 'var(--exercise)', cls: 'exercise' },
  weight: { label: '体重', unit: 'kg', color: 'var(--weight)', cls: 'weight' },
  reading_min: { label: '读书', unit: '分钟', color: 'var(--reading)', cls: 'reading' },
  english_xp: { label: '英语', unit: 'XP', color: 'var(--english)', cls: 'english' }
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
      <span class="swatch" style="background:${m.color}"></span>${m.label}（${m.unit}）
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
    const bars = [];
    for (const [field, meta] of Object.entries(METRICS)) {
      let has = false;
      if (field === 'weight') has = typeof rec[field] === 'number';
      else if (field === 'english_xp') has = (typeof rec.english_xp === 'number' && rec.english_xp > 0) || rec.english_streak === true;
      else has = typeof rec[field] === 'number' && rec[field] > 0;
      if (has) bars.push(`<span class="bar ${meta.cls}" title="${meta.label}"></span>`);
    }
    const checked = bars.length > 0;
    const isToday = key === todayStr;
    html += `
      <div class="day ${checked ? 'checked' : ''} ${isToday ? 'today' : ''}" data-date="${key}">
        <div class="num">${d}</div>
        <div class="bars">${bars.join('')}</div>
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
    return `<div class="day-row"><span class="dot ${m.cls}"></span><span>${m.label}</span><b>${shown}</b></div>`;
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
