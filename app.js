/* 顿悟股道 · 复盘看板 M3 前端
 * 纯原生 JS，无外部依赖。调用 replay-backend (M2) REST API。
 * 后端默认 http://localhost:8090/api/v1
 * 菜单：6 模块 / 14 子页（对齐设计文档 §1）。
 */
const API_BASE = 'http://localhost:8090/api/v1';

const state = {
  date: '',          // '' = 服务端取最新交易日
  mod: 'overview/timing',
  selectedBoard: null,
  sentType: 'limit_up',
  sentMinPos: 2,
};

/* ---------- 工具 ---------- */
function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function q(v) { return v === null || v === undefined ? '—' : v; }

function fmtMoney(yuan) {
  if (yuan === null || yuan === undefined) return '—';
  const n = Number(yuan);
  if (!isFinite(n)) return '—';
  if (Math.abs(n) >= 1e8) return (n / 1e8).toFixed(2) + ' 亿';
  if (Math.abs(n) >= 1e4) return (n / 1e4).toFixed(1) + ' 万';
  return n.toFixed(0);
}
function fmtPct(v) {
  if (v === null || v === undefined) return '—';
  return Number(v).toFixed(2) + '%';
}
function pctClass(v) {
  if (v === null || v === undefined) return '';
  const n = Number(v);
  if (n > 0) return 'up';      // 涨=红
  if (n < 0) return 'down';    // 跌=绿
  return '';
}
function netClass(v) {
  if (v === null || v === undefined) return '';
  const n = Number(v);
  if (n > 0) return 'up';
  if (n < 0) return 'down';
  return '';
}
/** 0~1 因子小条。 */
function bar(v) {
  const n = (v == null || v === undefined) ? 0 : Number(v);
  const pct = Math.max(0, Math.min(100, n * 100));
  return `<span class="bar-track sm"><span class="bar-fill" style="width:${pct}%"></span></span><span class="bar-val">${n.toFixed(2)}</span>`;
}
/** 综合分(0~100)着色：>=70 红(强)，<40 绿(弱)。 */
function scoreCls(v) {
  const n = (v == null || v === undefined) ? 0 : Number(v);
  if (n >= 70) return 'up';
  if (n < 40) return 'down';
  return '';
}

async function apiGet(path) {
  let u = path;
  if (state.date && !path.includes('date=')) {
    u += (path.includes('?') ? '&' : '?') + 'date=' + encodeURIComponent(state.date);
  }
  const res = await fetch(API_BASE + u);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

/* ---------- SVG 图表 ---------- */
function gaugeSVG(v) {
  // 半圆仪表盘，v 为 0-100
  const val = Math.max(0, Math.min(100, Number(v) || 0));
  const cx = 100, cy = 100, R = 80;
  const ang = (a) => { const r = a * Math.PI / 180; return [cx + R * Math.cos(r), cy - R * Math.sin(r)]; };
  const aVal = 180 - val / 100 * 180;
  const [nx, ny] = ang(aVal);
  const [sx, sy] = ang(180), [ex, ey] = ang(0);
  function color(t) {
    if (t < 20) return '#3b82f6';   // 冰点
    if (t < 50) return '#06b6d4';   // 低迷
    if (t < 75) return '#22c55e';   // 正常
    if (t < 90) return '#f59e0b';   // 活跃
    return '#ef4444';               // 高潮
  }
  const [vx, vy] = ang(aVal);
  return `<svg viewBox="0 0 200 120" class="gauge">
    <path d="M ${sx} ${sy} A ${R} ${R} 0 0 1 ${ex} ${ey}" fill="none" stroke="#e5e7eb" stroke-width="12" stroke-linecap="round"/>
    <path d="M ${sx} ${sy} A ${R} ${R} 0 0 1 ${vx} ${vy}" fill="none" stroke="${color(val)}" stroke-width="12" stroke-linecap="round"/>
    <line x1="${cx}" y1="${cy}" x2="${nx}" y2="${ny}" stroke="#111827" stroke-width="3"/>
    <circle cx="${cx}" cy="${cy}" r="5" fill="#111827"/>
    <text x="${cx}" y="${cy - 28}" text-anchor="middle" class="gauge-val" fill="${color(val)}">${val.toFixed(0)}</text>
  </svg>`;
}

function radarSVG(dims) {
  // dims: [{name, val(0~1 或 null)}]
  const cx = 110, cy = 110, R = 80, n = dims.length;
  const pt = (i, r) => { const a = (-90 + i * 360 / n) * Math.PI / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
  let grid = '';
  [0.25, 0.5, 0.75, 1].forEach(f => {
    const pts = dims.map((_, i) => pt(i, R * f).join(',')).join(' ');
    grid += `<polygon points="${pts}" fill="none" stroke="#eef0f3" stroke-width="1"/>`;
  });
  let axes = '', labels = '';
  dims.forEach((d, i) => {
    const [x, y] = pt(i, R);
    axes += `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="#e5e7eb" stroke-width="1"/>`;
    const [lx, ly] = pt(i, R + 16);
    labels += `<text x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="middle" class="radar-label">${esc(d.name)}</text>`;
  });
  const dataPts = dims.map((d, i) => pt(i, R * (d.val == null ? 0 : Math.max(0, Math.min(1, d.val)))).join(',')).join(' ');
  return `<svg viewBox="0 0 220 220" class="radar">
    ${grid}${axes}
    <polygon points="${dataPts}" fill="rgba(239,68,68,.25)" stroke="#ef4444" stroke-width="2"/>
    ${labels}
  </svg>`;
}

/* ---------- 通用卡片 ---------- */
function statCard(title, value, cls) {
  return `<div class="stat"><div class="stat-title">${esc(title)}</div><div class="stat-val ${cls || ''}">${esc(value)}</div></div>`;
}
function section(title, html) {
  return `<section class="card"><h2 class="card-title">${esc(title)}</h2>${html}</section>`;
}
function setView(html) { document.getElementById('view').innerHTML = html; }
function showError(e) {
  setView('<div class="error">加载失败：' + esc(e.message) + '<br><small>请确认后端服务 http://localhost:8090 已启动。</small></div>');
}

/* ---------- 模块：总览看板 ---------- */
async function renderOverviewTiming() {
  const ov = await apiGet('/overview');
  const fd = ov.fourDim || {};
  const dims = [
    { name: '技术', val: fd.tech },
    { name: '情绪', val: fd.sentiment },
    { name: '资金', val: fd.fund },
    { name: '政策', val: fd.policy },
  ];
  const legend = dims.map(d => `<span class="legend"><i class="dot ${d.val == null ? 'grey' : 'red'}"></i>${esc(d.name)} ${d.val == null ? '计算中' : Number(d.val).toFixed(2)}</span>`).join('');
  const worth = ov.worthTrade === 1;
  setView(section('大盘择时 · 四维度评分（S1）', `
    <div class="overview-grid">
      <div>${radarSVG(dims)}<div class="legend-row">${legend}</div></div>
      <div class="ov-right">
        <div class="badges">
          <span class="badge">周期判定：<b>${q((ov.cycle && ov.cycle.phase) || '—')}</b></span>
          <span class="badge">牛熊：<b>${q((ov.cycle && ov.cycle.absolute) || '—')}</b></span>
          <span class="badge">相对强弱：<b>${q((ov.cycle && ov.cycle.relative) || '—')}</b></span>
          <span class="badge regime">情绪区间：<b>${esc(ov.regime || '—')}</b></span>
          <span class="badge">综合分：<b>${q(fd.composite == null ? '计算中' : Number(fd.composite).toFixed(2))}</b></span>
          <span class="badge ${worth ? 'ok' : 'warn'}">值得参与：<b>${worth ? '是' : '否'}</b></span>
        </div>
        <div class="suggestion"><b>策略建议：</b>${esc(ov.suggestion || '—')}</div>
        ${ov.note ? `<div class="hint">数据口径：${esc(ov.note)}</div>` : ''}
      </div>
    </div>`));
}

async function renderOverviewThermal() {
  let ov = null, se = null;
  try { ov = await apiGet('/overview'); } catch (e) { ov = null; }
  try { se = await apiGet('/sentiment'); } catch (e) { se = null; }
  setView(section('情绪温度计（S2）', `
    <div class="thermal-grid">
      <div>${gaugeSVG(ov ? ov.thermal : 0)}<div class="thermal-cap">情绪温度（0-100）· 区间：${esc(ov ? (ov.regime || '—') : '—')}</div></div>
      <div class="stat-row">
        ${statCard('涨停家数', se ? q(se.limitUpCnt) : '—', se && se.limitUpCnt > 0 ? 'up' : '')}
        ${statCard('跌停家数', se ? q(se.limitDownCnt) : '—', se && se.limitDownCnt > 0 ? 'down' : '')}
        ${statCard('最高连板', se ? q(se.maxBoardPos) + ' 板' : '—', '')}
        ${statCard('昨日涨停今表现', se && se.yestLimitRet != null ? fmtPct(se.yestLimitRet) : '—', se && se.yestLimitRet != null ? pctClass(se.yestLimitRet) : '')}
      </div>
    </div>`));
}

async function renderOverviewMainline() {
  const ov = await apiGet('/overview');
  const topMl = (ov.topMainline || []).map(m => `
    <div class="bar-row">
      <span class="bar-name">${esc(m.boardName || m.boardCode)}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${Math.min(100, Number(m.strength) || 0)}%"></span></span>
      <span class="bar-val">${q(m.strength)}<small> · ${esc(m.mainLevel || '')}</small></span>
    </div>`).join('') || '<div class="empty">无主线数据</div>';
  setView(section('主线概览（Top ' + (ov.topMainline || []).length + '，S4）', `<div class="bars">${topMl}</div><div class="hint">完整主线列表见「主线·龙头 / 题材主线地图」。</div>`));
}

/* ---------- 模块：主线·龙头 ---------- */
async function renderMainlineMap() {
  const list = await apiGet('/mainline');
  const rows = list.map(m => `
    <tr class="clickable" data-board="${esc(m.boardCode)}">
      <td>${m.rank}</td>
      <td><b>${esc(m.boardName || m.boardCode)}</b><br><small>${esc(m.boardCode)}</small></td>
      <td><span class="tag level-${esc((m.mainLevel || '').replace('线', ''))}">${esc(m.mainLevel || '—')}</span></td>
      <td><span class="bar-track sm"><span class="bar-fill" style="width:${Math.min(100, Number(m.strength) || 0)}%"></span></span> <span class="bar-val">${q(m.strength)}</span></td>
    </tr>`).join('') || '<tr><td colspan="4" class="empty">无主线数据</td></tr>';
  setView(section('题材主线地图（板块强弱排序，S4）', `
    <table class="tbl">
      <thead><tr><th>排名</th><th>板块</th><th>级别</th><th>强度</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="hint">点击板块可跳到「龙头池 & 板位演化」。</div>`));
  document.querySelectorAll('#view tr.clickable').forEach(tr => {
    tr.addEventListener('click', () => { location.hash = '#/mainline/pool?b=' + encodeURIComponent(tr.getAttribute('data-board')); });
  });
}

async function loadBoardDetail(boardCode) {
  const box = document.getElementById('boardDetail');
  if (!box) return;
  box.innerHTML = '<div class="loading">加载龙头池…</div>';
  try {
    const [leaders, ideas] = await Promise.all([
      apiGet('/leaders?boardCode=' + encodeURIComponent(boardCode)),
      apiGet('/leader/trade-idea?boardCode=' + encodeURIComponent(boardCode)),
    ]);
    const lmap = {};
    (ideas || []).forEach(x => { lmap[x.tsCode] = x; });
    const rows = (leaders || []).map(l => {
      const idea = lmap[l.tsCode] || {};
      return `<tr>
        <td><b>${esc(l.stockName || l.tsCode)}</b><br><small>${esc(l.tsCode)}</small></td>
        <td><span class="tag role">${esc(l.role || '—')}</span></td>
        <td>${q(l.boardPos) + (l.boardPos ? ' 板' : '')}</td>
        <td><span class="bar-track sm"><span class="bar-fill" style="width:${Math.min(100, Number(l.score) || 0)}%"></span></span> <span class="bar-val">${q(l.score)}</span></td>
        <td class="idea">${esc(idea.idea || '—')}<br><small>风险：${esc(idea.riskLevel || '—')} · ${esc(idea.note || '')}</small></td>
      </tr>`;
    }).join('') || '<tr><td colspan="5" class="empty">该板块无龙头候选</td></tr>';
    box.innerHTML = section('龙头池 & 板位演化 · ' + esc(boardCode), `
      <table class="tbl">
        <thead><tr><th>个股</th><th>角色</th><th>板位</th><th>龙头相评分</th><th>买卖建议(S5)</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`);
  } catch (e) {
    box.innerHTML = '<div class="error">龙头池加载失败：' + esc(e.message) + '</div>';
  }
}

async function renderMainlinePool() {
  const list = await apiGet('/mainline');
  const boards = list || [];
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const sel = params.get('b') || state.selectedBoard || (boards[0] && boards[0].boardCode);
  setView(section('龙头池 & 板位演化（S4/S5）', `
    <div class="filters">
      <label>选择板块
        <select id="poolBoard">${boards.map(b => `<option value="${esc(b.boardCode)}" ${b.boardCode === sel ? 'selected' : ''}>${esc(b.boardName || b.boardCode)}</option>`).join('')}</select>
      </label>
    </div>
    <div id="boardDetail"><div class="loading">加载龙头池…</div></div>`));
  if (sel) { state.selectedBoard = sel; loadBoardDetail(sel); }
  const sb = document.getElementById('poolBoard');
  if (sb) sb.addEventListener('change', () => { state.selectedBoard = sb.value; loadBoardDetail(sb.value); });
}

async function renderMainlineRole() {
  let leaders = [];
  try { leaders = await apiGet('/leaders'); } catch (e) { leaders = []; }
  const groups = [
    { key: '龙', title: '龙相梯队（龙一~龙五，有同板块跟风）' },
    { key: '妖', title: '妖股（脱离板块·纯情绪博弈的市场高度龙）' },
    { key: '独狼', title: '独狼（无板块支撑·独立换手走强的活口）' },
  ];
  const fmtAmt = (a) => {
    if (a == null) return '—';
    const v = Number(a);
    if (!isFinite(v) || v <= 0) return '—';
    if (v >= 1e8) return (v / 1e8).toFixed(2) + '亿';
    if (v >= 1e4) return (v / 1e4).toFixed(0) + '万';
    return v.toFixed(0);
  };
  const blocks = groups.map(g => {
    const items = (leaders || []).filter(l =>
      (l.cat || '') === g.key || (l.role || '').indexOf(g.key) >= 0);
    const rows = items.map(l => `
      <tr>
        <td><b>${esc(l.stockName || l.tsCode)}</b><br><small>${esc(l.tsCode)}</small></td>
        <td>${esc(l.boardName || (l.boardCode || '独立'))}</td>
        <td>${q(l.boardPos) + (l.boardPos ? ' 板' : '')}</td>
        <td>${esc(l.limitStyle || '—')}</td>
        <td class="amt">${fmtAmt(l.amount)}</td>
        <td><span class="bar-track sm"><span class="bar-fill" style="width:${Math.min(100, Number(l.score) || 0)}%"></span></span> <span class="bar-val">${q(l.score)}</span></td>
        <td class="note">${esc(l.note || '—')}</td>
      </tr>`).join('') || `<tr><td colspan="7" class="empty">无（当日无脱离板块的独立高度股）</td></tr>`;
    return section(g.title + '（' + items.length + ' 只）',
      `<table class="tbl"><thead><tr><th>个股</th><th>板块</th><th>板位</th><th>风格</th><th>成交额</th><th>评分</th><th>判定说明</th></tr></thead><tbody>${rows}</tbody></table>`);
  }).join('');
  const banner = `<div class="hint strong">板学寻龙·猎物三分：<b>龙</b>=有板块团体属性（下面有一群小弟，靠主线合力上位）；`
    + `<b>妖</b>=脱离板块、纯情绪博弈的市场高度龙（钱少炒不动板块才出妖，常跨多题材、换手充分、人气极高）；`
    + `<b>独狼</b>=无板块支撑、靠自身逻辑独立走强的换手股（从题材活口走出）。妖/独狼由 S4 计算层按「脱离板块＋连板高度/跨题材数」自动标注，与龙互斥。</div>`;
  setView(section('龙 / 妖 / 独狼识别（S4）', banner + blocks));
}

/* ---------- 模块：情绪·资金 ---------- */
async function renderSentimentPool() {
  const type = state.sentType;
  const minPos = state.sentMinPos;
  const pool = await apiGet('/limit-pool?type=' + type + '&minPos=' + minPos).catch(() => []);
  const poolRows = (pool || []).map(p => `
    <tr>
      <td><b>${esc(p.stockName || p.tsCode)}</b><br><small>${esc(p.tsCode)}</small></td>
      <td>${esc(p.boardName || '—')}</td>
      <td>${q(p.boardPos) + (p.boardPos ? ' 板' : '')}</td>
      <td>${esc(p.limitStyle || '—')}</td>
      <td class="${pctClass(p.pctChg)}">${fmtPct(p.pctChg)}</td>
      <td>${fmtMoney(p.amount)}</td>
    </tr>`).join('') || '<tr><td colspan="6" class="empty">无涨跌停数据</td></tr>';
  setView(section('每日涨跌停池（S2）', `
    <div class="filters">
      <label>类型<select id="poolType"><option value="limit_up" ${type === 'limit_up' ? 'selected' : ''}>涨停</option><option value="limit_down" ${type === 'limit_down' ? 'selected' : ''}>跌停</option></select></label>
      <label>最低连板<input type="number" id="poolMin" min="1" value="${minPos}" /></label>
      <button class="btn" id="poolGo">查询</button>
    </div>
    <table class="tbl"><thead><tr><th>个股</th><th>板块</th><th>板位</th><th>风格</th><th>涨跌幅</th><th>成交额</th></tr></thead><tbody>${poolRows}</tbody></table>`));
  const go = document.getElementById('poolGo');
  if (go) go.addEventListener('click', () => {
    state.sentType = document.getElementById('poolType').value;
    state.sentMinPos = document.getElementById('poolMin').value || 1;
    renderSentimentPool();
  });
}

async function renderSentimentFlow() {
  const flow = await apiGet('/fund-flow/board?top=20').catch(() => []);
  const flowRows = (flow || []).map(f => `
    <tr>
      <td><b>${esc(f.boardName || f.boardCode)}</b><br><small>${esc(f.boardCode)}</small></td>
      <td class="${netClass(f.mainNet)}">${fmtMoney(f.mainNet)}</td>
      <td class="${netClass(f.superBig)}">${fmtMoney(f.superBig)}</td>
      <td class="${netClass(f.bigNet)}">${fmtMoney(f.bigNet)}</td>
      <td><span class="up">${q(f.upCount)}</span> / <span class="down">${q(f.downCount)}</span></td>
    </tr>`).join('') || '<tr><td colspan="5" class="empty">无板块资金流</td></tr>';
  setView(section('板块资金流向 · 主力净流入排行（S3）', `
    <table class="tbl"><thead><tr><th>板块</th><th>主力净流入</th><th>超大单</th><th>大单</th><th>涨/跌家数</th></tr></thead><tbody>${flowRows}</tbody></table>
    <div class="hint">数据来源 main_fund_flow（板块级）；净流入 = 超大单 + 大单。</div>`));
}

async function renderSentimentDragon() {
  const [stocks, seats, dt] = await Promise.all([
    apiGet('/main-force/stocks').catch(() => []),
    apiGet('/main-force/seats').catch(() => []),
    apiGet('/fund-flow/dragon-tiger').catch(() => [])
  ]);
  const sList = stocks || [];
  const seatList = seats || [];
  const dtList = dt || [];

  // 主力净买后次日胜 / 被埋（破除主力至上论的核心证据）
  const win = sList.filter(x => x.credibilityFlag === 1).length;
  const trapped = sList.filter(x => x.credibilityFlag === 0).length;
  const judged = win + trapped;
  const winRate = judged ? (win / judged * 100).toFixed(0) : '—';

  const stockRows = sList.map(d => `
    <tr class="clickable" data-code="${esc(d.tsCode)}">
      <td><b>${esc(d.stockName || d.tsCode)}</b><br><small>${esc(d.tsCode)}</small></td>
      <td class="${netClass(d.netBuy)}">${fmtMoney(d.netBuy)}</td>
      <td class="${netClass(d.orgNetBuy)}">${fmtMoney(d.orgNetBuy)}</td>
      <td class="${netClass(d.youziNetBuy)}">${fmtMoney(d.youziNetBuy)}</td>
      <td>${d.consensusScore != null ? Number(d.consensusScore).toFixed(2) : '—'}</td>
      <td>${d.divergenceFlag === 1 ? '<span class="tag warn">分歧</span>' : '<span class="tag ok">一致</span>'}</td>
      <td>${credCell(d.credibilityFlag, d.d1Return)}</td>
    </tr>`).join('') || '<tr><td colspan="7" class="empty">无主力博弈数据（先跑 /admin/recalc）</td></tr>';

  const seatRows = seatList.map(x => `
    <tr>
      <td><b>${esc(x.seatName || '—')}</b></td>
      <td><span class="tag">${esc(x.seatType || '—')}</span></td>
      <td><b>${q(x.stockCnt)}</b> 只</td>
      <td class="${netClass(x.netBuy)}">${fmtMoney(x.netBuy)}</td>
    </tr>`).join('') || '<tr><td colspan="4" class="empty">无抱团席位</td></tr>';

  const dtRows = dtList.map(d => `
    <tr class="clickable" data-code="${esc(d.tsCode)}">
      <td><b>${esc(d.stockName || d.tsCode)}</b><br><small>${esc(d.tsCode)}</small></td>
      <td title="${esc(d.reason || '')}">${esc((d.reason || '').slice(0, 24))}</td>
      <td class="${netClass(d.netBuy)}">${fmtMoney(d.netBuy)}</td>
      <td>${d.changeRate != null ? Number(d.changeRate).toFixed(2) + '%' : '—'}</td>
      <td>${d.closePrice != null ? Number(d.closePrice).toFixed(2) : '—'}</td>
    </tr>`).join('') || '<tr><td colspan="5" class="empty">无龙虎榜</td></tr>';

  setView(section('主力博弈 · 龙虎榜合力（S3）', `
    <div class="s3-banner">
      <div class="s3-stat"><b>${sList.length}</b><small>上榜个股</small></div>
      <div class="s3-stat up"><b>${win}</b><small>主力净买后次日涨(胜)</small></div>
      <div class="s3-stat ${trapped > 0 ? 'down' : ''}"><b>${trapped}</b><small>主力被埋(次日跌)</small></div>
      <div class="s3-stat"><b>${winRate}%</b><small>已判定胜率</small></div>
    </div>
    <div class="hint strong">⚠️ 有主力净买入 ≠ 必涨：本窗口 ${judged} 只可判定个股中 <b>${trapped} 只次日被埋</b>——主力也是博弈方，龙虎榜是合力结果而非必赢信号。须结合主线强度(S4)与情绪(S2)综合研判，切忌迷信席位。</div>

    <h3 class="sub">主力合力排行（按净买入降序）</h3>
    <table class="tbl"><thead><tr><th>个股</th><th>净买入</th><th>机构净买</th><th>游资净买</th><th>合力强度</th><th>分歧/一致</th><th>主力次日</th></tr></thead><tbody>${stockRows}</tbody></table>

    <h3 class="sub">抱团席位（同一席位横跨多只上榜股 = 资金合力/联动）</h3>
    <table class="tbl"><thead><tr><th>席位</th><th>类型</th><th>涉及股数</th><th>区间净买</th></tr></thead><tbody>${seatRows}</tbody></table>

    <h3 class="sub">龙虎榜原始明细（点个股展开席位）</h3>
    <table class="tbl"><thead><tr><th>个股</th><th>上榜原因</th><th>净买入</th><th>涨跌幅</th><th>收盘价</th></tr></thead><tbody>${dtRows}</tbody></table>
    <div id="dtDetail"></div>
  `));

  // 点击个股 → 展开该票席位明细（原龙虎榜下钻保留）
  document.querySelectorAll('#view tr.clickable').forEach(tr => {
    tr.addEventListener('click', async () => {
      const box = document.getElementById('dtDetail');
      box.innerHTML = '<div class="loading">加载席位明细…</div>';
      try {
        const det = await apiGet('/fund-flow/dragon-tiger/detail?tsCode=' + encodeURIComponent(tr.getAttribute('data-code')));
        box.innerHTML = section('席位明细 · ' + esc(tr.getAttribute('data-code')), '<table class="tbl"><thead><tr><th>席位</th><th>类型</th><th>买入</th><th>卖出</th><th>净买</th></tr></thead><tbody>' +
          (det || []).map(x => `<tr><td>${esc(x.seatName || '—')}</td><td>${esc(x.seatType || '—')}</td><td>${fmtMoney(x.buy)}</td><td>${fmtMoney(x.sell)}</td><td class="${netClass(x.netBuy)}">${fmtMoney(x.netBuy)}</td></tr>`).join('') +
          '</tbody></table>');
      } catch (e) { box.innerHTML = '<div class="error">明细加载失败</div>'; }
    });
  });
}

/* 主力次日可信度单元：胜(绿)/被埋(红)/净卖或未知(灰) */
function credCell(flag, d1) {
  const d1s = d1 != null ? (Number(d1) >= 0 ? '+' : '') + Number(d1).toFixed(2) + '%' : '—';
  if (flag === 1) return `<span class="cred win">次日胜 ${d1s}</span>`;
  if (flag === 0) return `<span class="cred trap">被埋 ${d1s}</span>`;
  if (flag === -1) return `<span class="cred muted">当日净卖</span>`;
  return `<span class="cred muted">未判定</span>`;
}

/* ---------- 模块：趋势战法（S6 真实渲染） ---------- */
function featPills(arr) {
  if (!arr || !arr.length) return '<span class="muted">—</span>';
  return arr.map(f => `<span class="pill">${esc(f)}</span>`).join(' ');
}
async function renderTrendScan() {
  let list = [];
  try { list = await apiGet('/trend/scan?minFeature=5'); } catch (e) { list = []; }
  if (!list || !list.length) {
    setView(section('趋势股扫描（S6）', `
      <div class="placeholder"><div class="ph-icon">📈</div><h3>暂无趋势候选</h3>
      <p>需先跑计算层（S6 八大技术特征）。启动 replay-backend 会对最新交易日自动计算 <code>trend_candidate_daily</code>。</p>
      <p class="hint">接口 <code>GET /api/v1/trend/scan</code> 当前返回空。</p></div>`));
    return;
  }
  const rows = list.map((t, i) => `
    <tr class="${t.confirmed ? 'top' : ''}">
      <td>${i + 1}</td>
      <td><b>${esc(t.stockName || t.tsCode)}</b><br><small>${esc(t.tsCode)}</small></td>
      <td><span class="badge ${t.featureHit >= 6 ? 'b-up' : ''}">${q(t.featureHit)}/8</span></td>
      <td>${t.confirmed ? '<span class="badge b-up">趋势成立</span>' : '<span class="badge">观察</span>'}</td>
      <td>${bar(t.rsVsIndex)}</td>
      <td class="${pctClass(t.gainFromBottom)}">${q(t.gainFromBottom)}%</td>
      <td>${q(t.rsi)}</td>
      <td class="feats">${featPills(t.hitFeatures)}</td>
    </tr>`).join('');
  setView(section('趋势股扫描（S6）· 八大技术特征命中（minFeature≥5）', `
    <table class="tbl">
      <thead><tr><th>#</th><th>个股</th><th>命中</th><th>趋势确认</th><th>RS相对指数</th><th>自底涨幅</th><th>RSI</th><th>命中特征</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="hint">特征：①长期均线多头 ②漂亮图形 ③健康量价 ④小盘子(无市值数据→N/A) ⑤RS强度 ⑥RSI突破70 ⑦周线确认 ⑧底部平台突破；趋势成立 = ①+②+自底涨幅&gt;25%。数据来自 <code>stock_weekly</code> 周线。</div>`));
}
async function renderTrendLead() {
  let list = [];
  try { list = await apiGet('/trend/leading?minFeature=4'); } catch (e) { list = []; }
  if (!list || !list.length) {
    setView(section('领涨股监控（S6）', `
      <div class="placeholder"><div class="ph-icon">📊</div><h3>暂无领涨信号</h3>
      <p>接口 <code>GET /api/v1/trend/leading</code> 当前返回空（趋势候选不足）。</p></div>`));
    return;
  }
  const rows = list.slice(0, 40).map((t, i) => `
    <tr class="${t.confirmed ? 'top' : ''}">
      <td>${i + 1}</td>
      <td><b>${esc(t.stockName || t.tsCode)}</b><br><small>${esc(t.tsCode)}</small></td>
      <td class="${pctClass(t.gainFromBottom)}">${q(t.gainFromBottom)}%</td>
      <td><span class="badge ${t.featureHit >= 6 ? 'b-up' : ''}">${q(t.featureHit)}/8</span></td>
      <td>${bar(t.rsVsIndex)}</td>
      <td>${t.confirmed ? '<span class="badge b-up">趋势成立</span>' : '<span class="badge">观察</span>'}</td>
      <td class="feats">${featPills(t.hitFeatures)}</td>
    </tr>`).join('');
  setView(section('领涨股监控（S6）· 拐点先行（按自底涨幅降序，minFeature≥4）', `
    <table class="tbl">
      <thead><tr><th>#</th><th>个股</th><th>自底涨幅</th><th>命中</th><th>RS相对指数</th><th>趋势确认</th><th>命中特征</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="hint">领涨股 = 自大底最低点以来涨幅领先、且技术特征命中较多者，用于监控"先于指数止跌、拐点先行"的机构趋势牛。</div>`));
}

/* ---------- 模块：炒作题材（S7 真实渲染） ---------- */
async function renderThemeFactor() {
  let list = [];
  try { list = await apiGet('/theme/factor'); } catch (e) { list = []; }
  if (!list || !list.length) {
    setView(section('炒作题材（S7）', `
      <div class="placeholder">
        <div class="ph-icon">💡</div>
        <h3>暂无题材因子数据</h3>
        <p>需先跑计算层（concept 派生 + S7 因子）。启动 replay-backend 会对最新交易日自动计算。</p>
        <p class="hint">接口 <code>GET /api/v1/theme/factor</code> 当前返回空数组。</p>
      </div>`));
    return;
  }
  const rows = list.map((t, i) => `
    <tr class="clickable ${i === 0 ? 'top' : ''}" data-code="${esc(t.boardCode)}">
      <td>${i + 1}</td>
      <td><b>${esc(t.boardName || t.boardCode)}</b><br><small>${esc(t.boardCode)}</small></td>
      <td><b class="${scoreCls(t.total)}">${q(t.total)}</b></td>
      <td>${bar(t.scarcity)}</td>
      <td>${bar(t.imagination)}</td>
      <td>${bar(t.sudden)}</td>
      <td>${bar(t.certainty)}</td>
      <td>${bar(t.minResist)}</td>
    </tr>`).join('');
  setView(section('题材库 · 炒作因子评分（按综合分降序，S7）', `
    <table class="tbl">
      <thead><tr><th>#</th><th>题材</th><th>综合分</th><th>稀缺</th><th>想象</th><th>突发</th><th>确定</th><th>最小阻力</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="hint">综合分 = 五因子加权（各 0.2 等权）×100；点击任意题材查看五维雷达。</div>
    <div id="themeDetail"></div>`));
  renderThemeDetail(list[0]);
  document.querySelectorAll('#view tr.clickable').forEach(tr => {
    tr.addEventListener('click', () => {
      const code = tr.getAttribute('data-code');
      const t = list.find(x => x.boardCode === code) || list[0];
      renderThemeDetail(t);
    });
  });
}
function renderThemeDetail(t) {
  const box = document.getElementById('themeDetail');
  if (!box || !t) return;
  const dims = [
    { name: '稀缺', val: t.scarcity },
    { name: '想象', val: t.imagination },
    { name: '突发', val: t.sudden },
    { name: '确定', val: t.certainty },
    { name: '最小阻力', val: t.minResist },
  ];
  const legend = dims.map(d => `<span class="legend"><i class="dot red"></i>${esc(d.name)} ${d.val == null ? '—' : Number(d.val).toFixed(2)}</span>`).join('');
  box.innerHTML = section('五维雷达 · ' + esc(t.boardName || t.boardCode) + '（综合分 ' + q(t.total) + '）', `
    <div class="overview-grid">
      <div>${radarSVG(dims)}<div class="legend-row">${legend}</div></div>
      <div class="ov-right">
        <div class="badges">
          <span class="badge">稀缺性：<b>${q(t.scarcity)}</b></span>
          <span class="badge">想象空间：<b>${q(t.imagination)}</b></span>
          <span class="badge">突发性：<b>${q(t.sudden)}</b></span>
          <span class="badge">确定性：<b>${q(t.certainty)}</b></span>
          <span class="badge">最小阻力：<b>${q(t.minResist)}</b></span>
        </div>
        <div class="hint">
          稀缺性=成分股越少越易抱团；想象空间=题材天花板；突发性=当日涨停集体启动；
          确定性=逻辑当日被市场验证；最小阻力=涨+资金净流入+达主线阈值+突发 的共振方向（势）。
        </div>
      </div>
    </div>`);
}

/* ---------- 模块：个人复盘（S8） ---------- */
async function renderTradelogLog() {
  setView(section('个人复盘 · 交易日志（S8）', `
    <div class="tradelog">
      <form id="logForm" class="log-form">
        <div class="form-row">
          <label>交易日期<input type="date" name="tradeDate" required /></label>
          <label>代码<input name="tsCode" placeholder="000001.SZ" /></label>
          <label>方向<select name="side"><option value="buy">买入</option><option value="sell">卖出</option></select></label>
        </div>
        <div class="form-row">
          <label>价格<input name="price" type="number" step="0.01" /></label>
          <label>数量<input name="qty" type="number" step="1" /></label>
          <label>心态标签<input name="emotionTag" placeholder="平静/贪婪/恐惧" /></label>
          <label>三态处置<input name="reaction" placeholder="买对/买错/未明" /></label>
        </div>
        <label>买入逻辑/原因<input name="reason" placeholder="大势/热点/个股？越具体评分越准" /></label>
        <button class="btn primary" type="submit">提交记录</button>
        <span id="logMsg" class="log-msg"></span>
      </form>
      <div id="logList" class="log-list"><div class="loading">加载历史…</div></div>
    </div>`));
  loadLogList();
  const form = document.getElementById('logForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const body = {};
    fd.forEach((v, k) => {
      if (v === '') return;
      if (k === 'price' || k === 'qty') body[k] = Number(v);
      else body[k] = v;
    });
    const msg = document.getElementById('logMsg');
    msg.textContent = '提交中…'; msg.className = 'log-msg';
    try {
      const res = await fetch(API_BASE + '/trade-log', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (res.ok) {
        msg.textContent = '✅ 提交成功（已按交易心法评分）'; msg.className = 'log-msg ok';
        form.reset();
        loadLogList();
      } else {
        msg.textContent = '写入失败 HTTP ' + res.status; msg.className = 'log-msg warn';
      }
    } catch (err) {
      msg.textContent = '网络错误：' + err.message; msg.className = 'log-msg warn';
    }
  });
}
async function loadLogList() {
  const box = document.getElementById('logList');
  if (!box) return;
  try {
    const list = await apiGet('/trade-log');
    if (!list || !list.length) { box.innerHTML = '<div class="empty">暂无交易记录。写一笔，看心法评分。</div>'; return; }
    box.innerHTML = '<table class="tbl"><thead><tr><th>日期</th><th>代码</th><th>方向</th><th>价格</th><th>数量</th><th>逻辑</th><th>心态</th><th>处置</th><th>纪律分</th></tr></thead><tbody>' +
      list.map(r => `<tr><td>${q(r.tradeDate)}</td><td>${esc(r.tsCode || '')}</td><td>${esc(r.side || '')}</td><td>${q(r.price)}</td><td>${q(r.qty)}</td><td>${esc(r.reason || '')}</td><td>${esc(r.emotionTag || '')}</td><td>${esc(r.reaction || '')}</td><td class="${scoreCls(r.disciplineScore)}"><b>${q(r.disciplineScore)}</b></td></tr>`).join('') + '</tbody></table>';
  } catch (e) { box.innerHTML = '<div class="empty">读取失败：' + esc(e.message) + '</div>'; }
}
async function renderTradelogScore() {
  let d;
  try { d = await apiGet('/trade-log/discipline'); }
  catch (e) { setView(section('纪律 / 心法评分（S8）', `<div class="empty">读取失败：${esc(e.message)}</div>`)); return; }
  if (!d || !d.count) {
    setView(section('纪律 / 心法评分（S8）', `
      <div class="placeholder"><div class="ph-icon">🧭</div><h3>还没有交易记录</h3>
      <p>去「交易日志」页写几笔买卖（含逻辑 / 心态 / 处置标签），这里会按《顿悟股道》交易心法量化你的纪律分。</p></div>`));
    return;
  }
  const dims = Object.entries(d.dimAvg).map(([k, v]) =>
    `<div class="dim-row"><span class="dim-name">${esc(k)}</span>${bar(v / 100)}</div>`).join('');
  const viols = (d.topViolations || []).map(v => `<li class="viol">${esc(v)}</li>`).join('');
  const samples = (d.samples || []).map(r =>
    `<tr><td>${q(r.tradeDate)}</td><td>${esc(r.tsCode || '')}</td><td class="${scoreCls(r.disciplineScore)}"><b>${q(r.disciplineScore)}</b></td><td>${esc((r.violations || []).join('；') || '—')}</td></tr>`).join('');
  setView(section('纪律 / 心法评分（S8）', `
    <div class="disc">
      <div class="disc-top">
        <div class="disc-gauge">${gaugeSVG(d.totalAvg)}<div class="disc-cap">综合纪律分（${d.count} 笔均值）</div></div>
        <div class="disc-dims"><h4>六维度均分</h4>${dims}</div>
      </div>
      <div class="disc-viol">
        <h4>高频违规（按出现频次）</h4>
        ${viols ? '<ul class="viol-list">' + viols + '</ul>' : '<p class="hint">暂无违规，纪律优秀 🎉</p>'}
      </div>
      <div class="disc-samples">
        <h4>近 ${(d.samples || []).length} 笔明细</h4>
        <table class="tbl"><thead><tr><th>日期</th><th>代码</th><th>纪律分</th><th>违规项</th></tr></thead><tbody>${samples}</tbody></table>
      </div>
      <div class="hint">六维度：主线思维(破个股思维) / 三因素综合 / 应对三态(分析≠交易) / 心态控制 / 风控纪律(破5日线即走) / 禁杠杆。</div>
    </div>`));
}

/* ---------- 路由 ---------- */
const ROUTES = {
  'overview/timing': renderOverviewTiming,
  'overview/thermal': renderOverviewThermal,
  'overview/mainline': renderOverviewMainline,
  'mainline/map': renderMainlineMap,
  'mainline/pool': renderMainlinePool,
  'mainline/role': renderMainlineRole,
  'sentiment/pool': renderSentimentPool,
  'sentiment/flow': renderSentimentFlow,
  'sentiment/dragon': renderSentimentDragon,
  'trend/scan': renderTrendScan,
  'trend/lead': renderTrendLead,
  'theme/factor': renderThemeFactor,
  'tradelog/log': renderTradelogLog,
  'tradelog/score': renderTradelogScore,
};
async function route() {
  const h = (location.hash.replace('#/', '').split('?')[0]) || 'overview/timing';
  state.mod = h;
  document.querySelectorAll('.nav-item').forEach(a => a.classList.toggle('active', a.getAttribute('data-mod') === h));
  try { await (ROUTES[h] || renderOverviewTiming)(); }
  catch (e) { showError(e); }
}
async function pingApi() {
  const el = document.getElementById('apiState');
  try { await fetch(API_BASE + '/overview'); el.textContent = 'API: 正常'; el.className = 'api-state ok'; }
  catch { el.textContent = 'API: 不可达'; el.className = 'api-state bad'; }
}

/* ---------- 启动 ---------- */
document.getElementById('datePicker').addEventListener('change', e => { state.date = e.target.value; route(); });
document.getElementById('refreshBtn').addEventListener('click', () => route());
window.addEventListener('hashchange', route);
pingApi();
route();
