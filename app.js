/* 竞彩台账 前端 */
const $ = (s) => document.querySelector(s);
const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
const Store = window.Store;

let STATE = null;
let curTab = '全部';
let SNAPSHOT = false;

const money = (n) => {
  const v = Number(n) || 0;
  const s = Math.abs(v).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (v < 0 ? '-¥' : '¥') + s;
};
const cls = (n) => (n > 0 ? 'up' : n < 0 ? 'down' : 'neutral');
const signCls = (n) => (n > 0 ? 'up' : n < 0 ? 'down' : 'neutral');

function toast(msg, ms) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('on');
  clearTimeout(t._tm);
  t._tm = setTimeout(() => t.classList.remove('on'), ms || 2400);
}

/* ============ 启动 ============ */
async function boot() {
  const mode = await Store.init();
  SNAPSHOT = mode === 'snapshot';
  if (SNAPSHOT) document.body.classList.add('snapshot');

  if (mode === 'unset') {
    renderShell();
    openSetup('请选择数据存放位置');
    return;
  }
  try {
    await load();
  } catch (e) {
    renderShell();
    openSetup('读取数据失败：' + e.message);
  }
}

async function load() {
  STATE = await Store.load();
  render();
}

function render() {
  renderMeta();
  renderCards();
  renderTabs();
  renderTable();
  renderChartDaily();
  renderChartTab();
  renderDb();
  renderSourceBadge();
}

/* 无数据时的空壳渲染（用于配置引导） */
function renderShell() {
  STATE = { meta: { capital: 0, balance: 0, dataDate: '' }, records: [], tabs: [], byTab: [], daily: [],
            computed: { amount: 0, bonus: 0, profit: 0, count: 0, hits: 0, hitRate: 0, roi: 0, liveBalance: 0 } };
  render();
}

function renderMeta() {
  $('#dataDate').textContent = STATE.meta.dataDate ? '数据截至 ' + STATE.meta.dataDate : '';
  const sel = $('#fTab');
  if (sel.options.length === 0) for (const t of STATE.tabs) sel.add(new Option(t, t));
}

/* ============ 数据源徽章 ============ */
function renderSourceBadge() {
  const b = $('#dbBadge');
  const dot = b.querySelector('.dot');
  const strong = b.querySelector('strong');
  const small = b.querySelector('small');
  b.classList.remove('warn', 'ro');
  if (Store.mode === 'server') {
    strong.textContent = '数据库已连接';
    small.textContent = 'SQLite · data/app.db';
  } else if (Store.mode === 'github') {
    strong.textContent = '云同步 · GitHub 私有仓库';
    small.textContent = `${Store.cfg.owner}/${Store.cfg.repo}`;
  } else if (Store.mode === 'snapshot') {
    strong.textContent = '静态快照（只读）';
    small.textContent = '数据内嵌在网页里';
    b.classList.add('ro');
  } else {
    strong.textContent = '未配置数据源';
    small.textContent = '点击设置';
    b.classList.add('warn');
  }
}

/* ============ 汇总卡片 ============ */
function renderCards() {
  const c = STATE.computed, m = STATE.meta;
  const items = [
    { k: '本金', v: money(m.capital), vcls: 'neutral', s: '点右下角可修改' },
    { k: '当前余额', v: money(c.liveBalance), vcls: cls(c.liveBalance - m.capital), s: '本金 + 累计净收益' },
    { k: '累计投注', v: money(c.amount), vcls: 'neutral', s: `${c.count} 笔` },
    { k: '累计中奖', v: money(c.bonus), vcls: 'neutral', s: `命中 ${c.hits} 笔` },
    { k: '净收益', v: money(c.profit), vcls: cls(c.profit), s: `回报率 ${c.roi}%` },
    { k: '命中率', v: c.hitRate + '%', vcls: c.hitRate >= 30 ? 'up' : 'neutral', s: `${c.hits} / ${c.count}` },
  ];
  const box = $('#cards');
  box.innerHTML = '';
  for (const i of items) {
    box.appendChild(el('div', 'card',
      `<div class="k">${i.k}</div><div class="v ${i.vcls}">${i.v}</div><div class="s">${i.s}</div>`));
  }
}

/* ============ Tabs ============ */
function renderTabs() {
  const box = $('#tabs');
  box.innerHTML = '';
  const list = ['全部', ...STATE.tabs];
  if (!list.includes(curTab)) curTab = '全部';
  for (const t of list) {
    const b = el('button', 'tab' + (t === curTab ? ' on' : ''), t);
    b.onclick = () => { curTab = t; renderTabs(); renderTable(); };
    box.appendChild(b);
  }
}

/* ============ 表格 ============ */
function renderTable() {
  const rows = curTab === '全部' ? STATE.records : STATE.records.filter(r => r.tab === curTab);
  const tb = $('#tbody');
  tb.innerHTML = '';

  if (!rows.length) {
    tb.appendChild(el('tr', '', `<td colspan="6"><div class="empty">还没有记录，点右上角「新增记录」添加</div></td>`));
    $('#tfoot').innerHTML = '';
    return;
  }

  for (const r of rows) {
    const tr = el('tr');
    tr.innerHTML = `
      <td>${r.date || '<span class="tag">未标注</span>'}</td>
      <td class="content">${escapeHtml(r.content || '')}${curTab === '全部' ? ` <span class="tag">${escapeHtml(r.tab)}</span>` : ''}</td>
      <td class="num">${money(r.amount)}</td>
      <td class="num ${r.bonus > 0 ? 'up' : ''}">${money(r.bonus)}</td>
      <td class="num ${signCls(r.profit)}">${money(r.profit)}</td>
      <td class="rowact col-act">
        <button class="btn mini" data-edit="${r.id}">编辑</button>
        <button class="btn mini danger" data-del="${r.id}">删除</button>
      </td>`;
    tb.appendChild(tr);
  }

  tb.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openModal(Number(b.dataset.edit)));
  tb.querySelectorAll('[data-del]').forEach(b => b.onclick = () => del(Number(b.dataset.del)));

  const t = rows.reduce((a, r) => ({ a: a.a + r.amount, b: a.b + r.bonus, p: a.p + r.profit }), { a: 0, b: 0, p: 0 });
  $('#tfoot').innerHTML = `
    <span>本页合计 <b>${rows.length}</b> 笔</span>
    <span>投注 <b>${money(t.a)}</b></span>
    <span>中奖 <b>${money(t.b)}</b></span>
    <span>净收益 <b class="${signCls(t.p)}">${money(t.p)}</b></span>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ============ 图表：每日净收益 ============ */
function renderChartDaily() {
  const d = STATE.daily;
  const host = $('#chartDaily');
  if (!d.length) { host.innerHTML = '<div class="empty">暂无日期数据</div>'; return; }

  const W = 520, H = 210, padL = 46, padR = 8, padT = 14, padB = 30;
  const iw = W - padL - padR, ih = H - padT - padB;
  const vals = d.map(x => x.profit);
  const max = Math.max(1, ...vals), min = Math.min(0, ...vals);
  const span = max - min || 1;
  const zeroY = padT + ih * (max / span);
  const bw = Math.min(46, iw / d.length * 0.62);
  const step = iw / d.length;

  let s = `<svg viewBox="0 0 ${W} ${H}" role="img">`;
  s += `<line class="axis-line" x1="${padL}" y1="${zeroY}" x2="${W - padR}" y2="${zeroY}"/>`;
  [max, 0, min].forEach(v => {
    const y = padT + ih * ((max - v) / span);
    s += `<text class="axis-txt" x="${padL - 7}" y="${y + 3.5}" text-anchor="end">${Math.round(v)}</text>`;
  });
  d.forEach((x, i) => {
    const cx = padL + step * i + step / 2;
    const h = Math.max(2, Math.abs(x.profit) / span * ih);
    const y = x.profit >= 0 ? zeroY - h : zeroY;
    const fill = x.profit >= 0 ? '#d92d20' : '#0f9b6c';
    s += `<rect class="bar" x="${cx - bw / 2}" y="${y}" width="${bw}" height="${h}" rx="3" fill="${fill}">
            <title>${x.date}  投注 ¥${x.amount} · 中奖 ¥${x.bonus} · 净收益 ¥${x.profit}</title></rect>`;
    s += `<text class="bar-val" x="${cx}" y="${x.profit >= 0 ? y - 5 : y + h + 12}" text-anchor="middle" fill="${fill}">${x.profit > 0 ? '+' : ''}${Math.round(x.profit)}</text>`;
    s += `<text class="axis-txt" x="${cx}" y="${H - 10}" text-anchor="middle">${x.date.slice(5).replace('-', '/')}</text>`;
  });
  s += '</svg>';
  host.innerHTML = s;
}

/* ============ 图表：板块表现 ============ */
function renderChartTab() {
  const t = STATE.byTab;
  const host = $('#chartTab');
  if (!t.length) { host.innerHTML = '<div class="empty">暂无数据</div>'; return; }

  const W = 520, padL = 82, padR = 66, rowH = 54, padT = 10;
  const H = padT + t.length * rowH + 26;
  const iw = W - padL - padR;
  const max = Math.max(1, ...t.map(x => Math.max(x.amount, x.bonus)));

  let s = `<svg viewBox="0 0 ${W} ${H}" role="img">`;
  t.forEach((x, i) => {
    const y = padT + i * rowH;
    const wA = x.amount / max * iw, wB = x.bonus / max * iw;
    s += `<text class="axis-txt" x="${padL - 9}" y="${y + 16}" text-anchor="end" style="font-size:12px;fill:#374151;font-weight:600">${escapeHtml(x.tab)}</text>`;
    s += `<rect class="bar" x="${padL}" y="${y + 4}" width="${Math.max(1, wA)}" height="12" rx="3" fill="#cbd5e1"><title>投注 ¥${x.amount}</title></rect>`;
    s += `<rect class="bar" x="${padL}" y="${y + 19}" width="${Math.max(1, wB)}" height="12" rx="3" fill="#2563eb"><title>中奖 ¥${x.bonus}</title></rect>`;
    const pc = x.profit >= 0 ? '#d92d20' : '#0f9b6c';
    s += `<text x="${padL}" y="${y + 46}" style="font-size:11px;fill:#6b7280">投注 ${money(x.amount)} · 中奖 ${money(x.bonus)} · 命中 ${x.hits}/${x.count}</text>`;
    s += `<text x="${W - padR + 8}" y="${y + 24}" style="font-size:13px;font-weight:700;fill:${pc}">${x.profit > 0 ? '+' : ''}${Math.round(x.profit)}</text>`;
  });
  s += `<g transform="translate(${padL}, ${H - 6})">
          <rect x="0" y="-8" width="9" height="9" rx="2" fill="#cbd5e1"/><text x="14" y="0" class="axis-txt">投注</text>
          <rect x="56" y="-8" width="9" height="9" rx="2" fill="#2563eb"/><text x="70" y="0" class="axis-txt">中奖</text>
        </g>`;
  s += '</svg>';
  host.innerHTML = s;
}

/* ============ 数据存放面板 ============ */
function renderDb() {
  const g = $('#dbGrid');
  const title = $('#dbPanel').querySelector('h2');
  const note = $('#dbNote');
  g.innerHTML = '';
  const add = (k, v) => g.appendChild(el('div', 'dbitem', `<div class="k">${k}</div><div class="v">${escapeHtml(v)}</div>`));

  if (Store.mode === 'github') {
    const c = Store.cfg;
    title.textContent = '数据存在哪里？';
    add('存放位置', `GitHub 私有仓库 ${c.owner}/${c.repo}`);
    add('数据文件', c.path + '（分支 ' + c.branch + '）');
    add('完整地址', `https://github.com/${c.owner}/${c.repo}/blob/${c.branch}/${c.path}`);
    add('记录条数', (STATE.records || []).length + ' 条');
    add('最后更新', STATE.updatedAt ? STATE.updatedAt.replace('T', ' ').slice(0, 19) : '—');
    add('备份方式', 'git clone 该私有仓库，或直接下载 data.json');
    note.innerHTML = `
      <p><b>数据在你的 GitHub 账号里，不在任何第三方服务器。</b>网页每次读写都通过 GitHub 官方接口操作这个私有仓库，
      仓库是私有的，只有持令牌的人（也就是你）能访问。</p>
      <p><b>手机怎么用：</b>手机浏览器打开这个页面 → 第一次输入一次令牌 → 之后自动记住，随时可改。
      令牌只保存在<b>你自己的浏览器</b>里，不会上传到任何地方。</p>
      <p><b>换手机/清缓存后：</b>重新输入一次令牌即可，数据不会丢（数据在 GitHub 仓库里）。</p>`;
    return;
  }

  if (Store.mode === 'snapshot') {
    title.textContent = '数据存在哪里？';
    add('存放位置', '本网页文件内部（静态快照）');
    add('读写能力', '只读，网页上的修改无法保存');
    add('记录条数', (STATE.records || []).length + ' 条');
    add('如何更新', '重新导出一次静态网页并上传');
    note.innerHTML = `<p>这是一个已经把数据"烤"进文件里的静态页面，适合直接丢到任意空间打开查看。
      如果需要手机上也能修改，请改用带云同步的版本。</p>`;
    return;
  }

  if (Store.mode === 'server') {
    const d = STATE.db;
    if (!d) return;
    title.textContent = '数据存在哪里？';
    add('数据库类型', d.engine);
    add('文件位置（绝对路径）', d.path);
    add('项目内相对路径', './' + d.relativePath);
    add('文件大小', d.sizeHuman);
    add('最后写入时间', d.modifiedAt ? d.modifiedAt.replace('T', ' ').slice(0, 19) : '—');
    add('数据表', d.tables.join('、'));
    add('记录条数', d.recordCount + ' 条');
    add('备份方式', '复制 data/app.db 文件');
    note.innerHTML = `
      <p><b>数据存成一个文件，不在云端、不在浏览器里。</b>整站只有一个 <code>app.db</code> 文件，
      复制走这个文件就等于复制走全部数据。</p>
      <p><b>备份：</b>先停掉服务（命令行窗口按 Ctrl + C），然后把 <code>data/app.db</code> 复制到 U 盘或网盘。</p>
      <p><b>换电脑：</b>把整个 <code>jc-tracker</code> 文件夹拷过去，双击 <code>启动.bat</code> 就能跑，数据跟着走。</p>`;
    return;
  }

  title.textContent = '数据存在哪里？';
  note.innerHTML = `<p>还没有配置数据存放位置，点击页面右上角的数据源徽章进行设置。</p>`;
}

/* ============ 新增 / 编辑 ============ */
function openModal(id) {
  const r = id ? STATE.records.find(x => x.id === id) : null;
  $('#modalTitle').textContent = r ? '编辑记录' : '新增记录';
  $('#form').dataset.id = r ? r.id : '';
  const sel = $('#fTab');
  if (!sel.options.length) for (const t of STATE.tabs) sel.add(new Option(t, t));
  $('#fTab').value = r ? r.tab : (curTab !== '全部' ? curTab : (STATE.tabs[0] || '自选'));
  $('#fDate').value = r ? (r.date || '') : new Date().toISOString().slice(0, 10);
  $('#fContent').value = r ? (r.content || '') : '';
  $('#fAmount').value = r ? r.amount : '';
  $('#fBonus').value = r ? r.bonus : '';
  $('#fProfit').value = r ? r.profit : '';
  $('#modal').classList.add('on');
  setTimeout(() => $('#fContent').focus(), 50);
}
function closeModal() { $('#modal').classList.remove('on'); }

async function save(e) {
  e.preventDefault();
  const id = $('#form').dataset.id;
  const amount = Number($('#fAmount').value) || 0;
  const bonus = Number($('#fBonus').value) || 0;
  const pv = $('#fProfit').value;
  const body = {
    tab: $('#fTab').value,
    date: $('#fDate').value,
    content: $('#fContent').value,
    amount,
    bonus,
    profit: (pv === '' || pv == null) ? +(bonus - amount).toFixed(2) : Number(pv),
  };
  try {
    if (id) await Store.update(Number(id), body);
    else await Store.add(body);
    closeModal(); await load(); toast(id ? '已保存' : '已新增');
  } catch (err) {
    toast('保存失败：' + err.message, 4000);
  }
}

async function del(id) {
  if (!confirm('确定删除这条记录？')) return;
  try {
    await Store.del(id);
    await load(); toast('已删除');
  } catch (err) { toast('删除失败：' + err.message, 4000); }
}

/* ============ 设置面板 ============ */
function openSetup(msg) {
  $('#setupMsg').textContent = msg || '';
  $('#setupMsg').style.display = msg ? 'block' : 'none';
  const c = Store.cfg;
  $('#sOwner').value = c.owner || '';
  $('#sRepo').value = c.repo || '';
  $('#sPath').value = c.path || 'data.json';
  $('#sBranch').value = c.branch || 'main';
  $('#sToken').value = c.token || '';
  $('#sCapital').value = (STATE && STATE.meta && STATE.meta.capital) || '';
  $('#setup').classList.add('on');
}
function closeSetup() { $('#setup').classList.remove('on'); }

async function testConn() {
  const btn = $('#btnTest');
  btn.disabled = true; btn.textContent = '测试中…';
  try {
    Store.saveCfg({
      token: $('#sToken').value.trim(),
      owner: $('#sOwner').value.trim(),
      repo: $('#sRepo').value.trim(),
      path: $('#sPath').value.trim() || 'data.json',
      branch: $('#sBranch').value.trim() || 'main',
    });
    const d = await Store.diagnose();
    $('#setupMsg').className = d.ok ? 'setup-msg ok' : 'setup-msg err';
    $('#setupMsg').textContent = d.msg;
  } catch (e) {
    $('#setupMsg').className = 'setup-msg err';
    $('#setupMsg').textContent = '连接失败：' + e.message;
  } finally {
    btn.disabled = false; btn.textContent = '测试连接';
  }
}

async function saveSetup() {
  Store.saveCfg({
    token: $('#sToken').value.trim(),
    owner: $('#sOwner').value.trim(),
    repo: $('#sRepo').value.trim(),
    path: $('#sPath').value.trim() || 'data.json',
    branch: $('#sBranch').value.trim() || 'main',
  });
  if (!Store.cfg.token || !Store.cfg.owner || !Store.cfg.repo) {
    $('#setupMsg').className = 'setup-msg err';
    $('#setupMsg').textContent = '请填写完整：令牌、用户名、数据仓库名';
    return;
  }
  Store.mode = 'github';
  closeSetup();
  try {
    await load();
    toast('已连接云端数据');
  } catch (e) {
    openSetup('连接失败：' + e.message);
  }
}

async function saveCapital() {
  const v = Number($('#sCapital').value);
  if (!Number.isFinite(v)) return toast('请输入数字');
  try {
    await Store.updateMeta({ capital: v, balance: +(v + STATE.computed.profit).toFixed(2) });
    await load(); toast('本金已更新');
  } catch (e) { toast('保存失败：' + e.message, 4000); }
}

/* ============ 事件 ============ */
$('#btnAdd').onclick = () => openModal(null);
$('#btnCancel').onclick = closeModal;
$('#modal').onclick = (e) => { if (e.target.id === 'modal') closeModal(); };
$('#form').onsubmit = save;

$('#dbBadge').onclick = () => {
  if (Store.mode === 'unset') return openSetup();
  $('#dbPanel').scrollIntoView({ behavior: 'smooth', block: 'center' });
};
$('#btnSetup').onclick = () => openSetup('');
$('#btnCancelSetup').onclick = () => { closeSetup(); if (Store.mode === 'unset') renderShell(); };
$('#btnTest').onclick = testConn;
$('#btnSaveSetup').onclick = saveSetup;
$('#btnSaveCapital').onclick = saveCapital;
$('#btnClearCfg').onclick = () => {
  if (!confirm('清除本机保存的令牌和数据源配置？数据本身不会受影响。')) return;
  Store.clearCfg(); toast('已清除，请重新配置');
  setTimeout(() => location.reload(), 800);
};

$('#btnExport').onclick = () => {
  const rows = curTab === '全部' ? STATE.records : STATE.records.filter(r => r.tab === curTab);
  const esc = s => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const csv = '\uFEFF' + [['板块', '日期', '内容', '金额', '奖金', '收益'].join(','),
    ...rows.map(r => [esc(r.tab), esc(r.date || ''), esc(r.content), r.amount, r.bonus, r.profit].join(','))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = 'records.csv'; a.click();
};

$('#btnSnapshot').onclick = () => {
  if (Store.mode === 'server') { location.href = '/api/snapshot'; return; }
  toast('当前已是静态/云端版本，无需再导出');
};

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  closeModal(); closeSetup();
});

boot();
