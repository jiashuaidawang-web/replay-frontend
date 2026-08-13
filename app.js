/* 顿悟股道 · 复盘看板 M3 前端
 * 纯原生 JS，无外部依赖。调用 replay-backend (M2) REST API。
 * 后端默认 http://localhost:8090/api/v1
 */
const API_BASE = 'http://localhost:8090/api/v1';

const state = {
  date: '',          // '' = 服务端取最新交易日
  mod: 'overview',
  selectedBoard: null,
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

/* ---------- 模块：总览看板 ---------- */
async function renderOverview() {
  const ov = await apiGet('/overview');
  let se = null;
  try { se = await apiGet('/sentiment'); } catch (e) { se = null; }

  const fd = ov.fourDim || {};
  const dims = [
    { name: '技术', val: fd.tech },
    { name: '情绪', val: fd.sentiment },
    { name: '资金', val: fd.fund },
    { name: '政策', val: fd.policy },
  ];
  const legend = dims.map(d => `<span class="legend"><i class="dot ${d.val == null ? 'grey' : 'red'}"></i>${esc(d.name)} ${d.val == null ? '计算中' : Number(d.val).toFixed(2)}</span>`).join('');

  const topMl = (ov.topMainline || []).map(m => `
    <div class="bar-row">
      <span class="bar-name">${esc(m.boardName || m.boardCode)}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${Math.min(100, Number(m.strength) || 0)}%"></span></span>
      <span class="bar-val">${q(m.strength)}<small> · ${esc(m.mainLevel || '')}</small></span>
    </div>`).join('') || '<div class="empty">无主线数据</div>';

  const html = `
    ${section('大盘择时 · 四维度评分', `
      <div class="overview-grid">
        <div>${radarSVG(dims)}<div class="legend-row">${legend}</div></div>
        <div class="ov-right">
          <div class="badges">
            <span class="badge">周期判定：<b>${q((ov.cycle && ov.cycle.phase) || '—')}</b></span>
            <span class="badge">牛熊：<b>${q((ov.cycle && ov.cycle.absolute) || '—')}</b></span>
            <span class="badge regime">情绪区间：<b>${esc(ov.regime || '—')}</b></span>
            <span class="badge">综合分：<b>${q(fd.composite == null ? '计算中' : Number(fd.composite).toFixed(2))}</b></span>
          </div>
          <div class="hint">技术/资金/政策三维依赖 S1 计算层（index_daily 等），当前未实现，显示"计算中"。</div>
        </div>
      </div>`)}
    ${section('情绪温度计', `
      <div class="thermal-grid">
        <div>${gaugeSVG(ov.thermal)}<div class="thermal-cap">情绪温度（0-100）· 区间：${esc(ov.regime || '—')}</div></div>
        <div class="stat-row">
          ${statCard('涨停家数', se ? q(se.limitUpCnt) : '—', se && se.limitUpCnt > 0 ? 'up' : '')}
          ${statCard('跌停家数', se ? q(se.limitDownCnt) : '—', se && se.limitDownCnt > 0 ? 'down' : '')}
          ${statCard('最高连板', se ? q(se.maxBoardPos) + ' 板' : '—', '')}
          ${statCard('昨日涨停今表现', se && se.yestLimitRet != null ? fmtPct(se.yestLimitRet) : '—', se && se.yestLimitRet != null ? pctClass(se.yestLimitRet) : '')}
        </div>
      </div>`)}
    ${section('主线概览（Top ' + (ov.topMainline || []).length + '）', `<div class="bars">${topMl}</div>`)}
  `;
  setView(html);
}

/* ---------- 模块：主线·龙头 ---------- */
async function renderMainline() {
  const list = await apiGet('/mainline');
  const rows = list.map(m => `
    <tr class="clickable" data-board="${esc(m.boardCode)}">
      <td>${m.rank}</td>
      <td><b>${esc(m.boardName || m.boardCode)}</b><br><small>${esc(m.boardCode)}</small></td>
      <td><span class="tag level-${esc((m.mainLevel || '').replace('线',''))}">${esc(m.mainLevel || '—')}</span></td>
      <td><span class="bar-track sm"><span class="bar-fill" style="width:${Math.min(100, Number(m.strength) || 0)}%"></span></span> <span class="bar-val">${q(m.strength)}</span></td>
    </tr>`).join('') || '<tr><td colspan="4" class="empty">无主线数据</td></tr>';

  const html = `
    ${section('题材主线地图（板块强弱排序）', `
      <table class="tbl">
        <thead><tr><th>排名</th><th>板块</th><th>级别</th><th>强度</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="hint">点击任意板块，下方查看龙头池与买卖建议。</div>`)}
    <div id="boardDetail"></div>
  `;
  setView(html);
  if (state.selectedBoard) loadBoardDetail(state.selectedBoard);
  document.querySelectorAll('#view tr.clickable').forEach(tr => {
    tr.addEventListener('click', () => { state.selectedBoard = tr.getAttribute('data-board'); loadBoardDetail(state.selectedBoard); });
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

/* ---------- 模块：情绪·资金 ---------- */
async function renderSentiment() {
  const se = await apiGet('/sentiment');
  const type = (state.sentType || 'limit_up');
  const minPos = (state.sentMinPos || 2);
  const [pool, flow, dt] = await Promise.all([
    apiGet('/limit-pool?type=' + type + '&minPos=' + minPos).catch(() => []),
    apiGet('/fund-flow/board?top=12').catch(() => []),
    apiGet('/fund-flow/dragon-tiger').catch(() => []),
  ]);

  const poolRows = (pool || []).map(p => `
    <tr>
      <td><b>${esc(p.stockName || p.tsCode)}</b><br><small>${esc(p.tsCode)}</small></td>
      <td>${esc(p.boardName || '—')}</td>
      <td>${q(p.boardPos) + (p.boardPos ? ' 板' : '')}</td>
      <td>${esc(p.limitStyle || '—')}</td>
      <td class="${pctClass(p.pctChg)}">${fmtPct(p.pctChg)}</td>
      <td>${fmtMoney(p.amount)}</td>
    </tr>`).join('') || '<tr><td colspan="6" class="empty">无涨跌停数据</td></tr>';

  const flowRows = (flow || []).map(f => `
    <tr>
      <td><b>${esc(f.boardName || f.boardCode)}</b><br><small>${esc(f.boardCode)}</small></td>
      <td class="${netClass(f.mainNet)}">${fmtMoney(f.mainNet)}</td>
      <td class="${netClass(f.superBig)}">${fmtMoney(f.superBig)}</td>
      <td class="${netClass(f.bigNet)}">${fmtMoney(f.bigNet)}</td>
      <td><span class="up">${q(f.upCount)}</span> / <span class="down">${q(f.downCount)}</span></td>
    </tr>`).join('') || '<tr><td colspan="5" class="empty">无板块资金流</td></tr>';

  const dtRows = (dt || []).map(d => `
    <tr>
      <td><b>${esc(d.stockName || d.tsCode)}</b><br><small>${esc(d.tsCode)}</small></td>
      <td title="${esc(d.reason || '')}">${esc((d.reason || '').slice(0, 24))}</td>
      <td class="${netClass(d.netBuy)}">${fmtMoney(d.netBuy)}</td>
      <td>${d.changeRate != null ? Number(d.changeRate).toFixed(2) + '%' : '—'}</td>
      <td>${d.closePrice != null ? Number(d.closePrice).toFixed(2) : '—'}</td>
      <td>${fmtMoney(d.freeMarketCap)}</td>
    </tr>`).join('') || '<tr><td colspan="6" class="empty">无龙虎榜</td></tr>';

  const html = `
    ${section('情绪温度计', `
      <div class="thermal-grid">
        <div>${gaugeSVG(se.thermal)}<div class="thermal-cap">区间：${esc(se.regime || '—')}</div></div>
        <div class="stat-row">
          ${statCard('涨停家数', q(se.limitUpCnt), 'up')}
          ${statCard('跌停家数', q(se.limitDownCnt), 'down')}
          ${statCard('最高连板', q(se.maxBoardPos) + ' 板', '')}
          ${statCard('昨日涨停今表现', se.yestLimitRet != null ? fmtPct(se.yestLimitRet) : '—', se.yestLimitRet != null ? pctClass(se.yestLimitRet) : '')}
        </div>
      </div>`)}
    ${section('每日涨跌停池', `
      <div class="filters">
        <label>类型
          <select id="poolType">
            <option value="limit_up" ${type === 'limit_up' ? 'selected' : ''}>涨停</option>
            <option value="limit_down" ${type === 'limit_down' ? 'selected' : ''}>跌停</option>
          </select>
        </label>
        <label>最低连板
          <input type="number" id="poolMin" min="1" value="${minPos}" />
        </label>
        <button class="btn" id="poolGo">查询</button>
      </div>
      <table class="tbl">
        <thead><tr><th>个股</th><th>板块</th><th>板位</th><th>风格</th><th>涨跌幅</th><th>成交额</th></tr></thead>
        <tbody>${poolRows}</tbody>
      </table>`)}
    ${section('板块资金流向（主力净流入排行）', `
      <table class="tbl">
        <thead><tr><th>板块</th><th>主力净流入</th><th>超大单</th><th>大单</th><th>涨/跌家数</th></tr></thead>
        <tbody>${flowRows}</tbody>
      </table>`)}
    ${section('龙虎榜（主力合力）', `
      <table class="tbl">
        <thead><tr><th>个股</th><th>上榜原因</th><th>净买入</th><th>涨跌幅</th><th>收盘价</th><th>流通市值</th></tr></thead>
        <tbody>${dtRows}</tbody>
      </table>
      <div class="hint">龙虎榜仅提示资金合力方向，不构成席位迷信——结合板块强度综合判断。</div>`)}
  `;
  setView(html);
  const go = document.getElementById('poolGo');
  if (go) go.addEventListener('click', () => {
    state.sentType = document.getElementById('poolType').value;
    state.sentMinPos = document.getElementById('poolMin').value || 1;
    renderSentiment();
  });
}

/* ---------- 模块：趋势战法（S6 占位） ---------- */
async function renderTrend() {
  setView(section('趋势战法（S6）', `
    <div class="placeholder">
      <div class="ph-icon">📈</div>
      <h3>计算层尚未实现</h3>
      <p>趋势股扫描依赖 <code>trend_candidate_daily</code>（需 <code>stock_weekly</code> 历史周线 + S6 八大技术特征算法）。</p>
      <p>当前接口 <code>GET /api/v1/trend/scan</code> 返回空数组 <code>[]</code>。</p>
      <p class="hint">待 M1 计算层补齐 S6 后，本页将展示"命中特征数 ≥ 6 且站上牛熊线"的趋势龙头股。</p>
    </div>`));
}

/* ---------- 模块：炒作题材（S7 真实渲染） ---------- */
async function renderTheme() {
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

  const html = `
    ${section('题材库 · 炒作因子评分（按综合分降序）', `
      <table class="tbl">
        <thead><tr><th>#</th><th>题材</th><th>综合分</th><th>稀缺</th><th>想象</th><th>突发</th><th>确定</th><th>最小阻力</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="hint">综合分 = 五因子加权（各 0.2 等权）×100；点击任意题材查看五维雷达。</div>`)}
    <div id="themeDetail"></div>
  `;
  setView(html);
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
async function renderTradelog() {
  setView(section('个人复盘 · 交易日志（S8）', `
    <div class="tradelog">
      <form id="logForm" class="log-form">
        <div class="form-row">
          <label>交易日期<input type="date" name="trade_date" /></label>
          <label>代码<input name="ts_code" placeholder="000001.SZ" /></label>
          <label>方向<select name="side"><option value="buy">买入</option><option value="sell">卖出</option></select></label>
        </div>
        <div class="form-row">
          <label>价格<input name="price" type="number" step="0.01" /></label>
          <label>数量<input name="qty" type="number" step="1" /></label>
          <label>心态标签<input name="emotion_tag" placeholder="贪婪/恐惧/平静" /></label>
          <label>三态处置<input name="应对" placeholder="买对/买错/未明" /></label>
        </div>
        <label>买入逻辑/原因<input name="reason" placeholder="大势/热点/个股？" /></label>
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
    fd.forEach((v, k) => { if (v !== '') body[k] = v; });
    const msg = document.getElementById('logMsg');
    msg.textContent = '提交中…'; msg.className = 'log-msg';
    try {
      const res = await fetch(API_BASE + '/trade-log', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (res.status === 503) {
        msg.textContent = '⚠️ 交易日志表(trade_log)尚未建表，写入暂不可用（S8 计算层未部署）。接口已正确返回 503。';
        msg.className = 'log-msg warn';
      } else if (res.ok) {
        msg.textContent = '✅ 提交成功'; msg.className = 'log-msg ok';
        loadLogList();
      } else {
        msg.textContent = 'HTTP ' + res.status; msg.className = 'log-msg warn';
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
    if (!list || !list.length) { box.innerHTML = '<div class="empty">暂无交易记录。</div>'; return; }
    box.innerHTML = '<table class="tbl"><thead><tr><th>日期</th><th>代码</th><th>方向</th><th>价格</th><th>数量</th><th>逻辑</th><th>心态</th><th>处置</th></tr></thead><tbody>' +
      list.map(r => `<tr><td>${q(r.trade_date)}</td><td>${esc(r.ts_code || '')}</td><td>${esc(r.side || '')}</td><td>${q(r.price)}</td><td>${q(r.qty)}</td><td>${esc(r.reason || '')}</td><td>${esc(r.emotion_tag || '')}</td><td>${esc(r.应对 || '')}</td></tr>`).join('') + '</tbody></table>';
  } catch (e) { box.innerHTML = '<div class="empty">读取失败：' + esc(e.message) + '</div>'; }
}

/* ---------- 路由 ---------- */
const ROUTES = {
  overview: renderOverview,
  mainline: renderMainline,
  sentiment: renderSentiment,
  trend: renderTrend,
  theme: renderTheme,
  tradelog: renderTradelog,
};
function setView(html) { document.getElementById('view').innerHTML = html; }
function showError(e) {
  setView('<div class="error">加载失败：' + esc(e.message) + '<br><small>请确认后端服务 http://localhost:8090 已启动。</small></div>');
}
async function route() {
  const h = location.hash.replace('#/', '') || 'overview';
  state.mod = h;
  document.querySelectorAll('.nav-item').forEach(a => a.classList.toggle('active', a.getAttribute('data-mod') === h));
  try { await (ROUTES[h] || renderOverview)(); }
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
