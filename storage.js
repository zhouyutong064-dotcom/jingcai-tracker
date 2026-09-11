/* ============================================================
 * 数据源抽象层  (挂在 window.Store，便于静态快照内联，避免 file:// 的 module CORS)
 *   server  : 本地 Node 服务，数据存 data/app.db (SQLite)
 *   github  : 静态托管(GitHub Pages 等)，数据存 GitHub 私有仓库 data.json
 *   snapshot: 静态快照，数据内嵌，只读
 * ============================================================ */
(function () {
const GH_API = 'https://api.github.com';

function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
function b64decode(b64) {
  const bin = atob(String(b64).replace(/\s/g, ''));
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/* 把原始 data.json 补齐成本地接口同构的结构（computed/byTab/daily/tabs） */
function enrich(d) {
  d = d || {};
  const records = Array.isArray(d.records) ? d.records : [];
  const tabs = [...new Set(records.map(r => r.tab))];
  const byTab = {};
  const byDate = {};
  let amount = 0, bonus = 0, profit = 0, hits = 0;
  for (const r of records) {
    amount += Number(r.amount) || 0;
    bonus += Number(r.bonus) || 0;
    profit += Number(r.profit) || 0;
    const t = byTab[r.tab] || (byTab[r.tab] = { tab: r.tab, amount: 0, bonus: 0, profit: 0, count: 0, hits: 0 });
    t.amount += Number(r.amount) || 0;
    t.bonus += Number(r.bonus) || 0;
    t.profit += Number(r.profit) || 0;
    t.count += 1;
    if (Number(r.bonus) > 0) { t.hits += 1; hits += 1; }
    const dt = r.date || '未标注日期';
    const day = byDate[dt] || (byDate[dt] = { date: dt, amount: 0, bonus: 0, profit: 0, count: 0 });
    day.amount += Number(r.amount) || 0;
    day.bonus += Number(r.bonus) || 0;
    day.profit += Number(r.profit) || 0;
    day.count += 1;
  }
  const daily = Object.values(byDate)
    .filter(x => x.date !== '未标注日期')
    .sort((a, b) => a.date.localeCompare(b.date));
  const r2 = v => Math.round(v * 100) / 100;
  const capital = Number(d.meta && d.meta.capital) || 0;
  return {
    meta: { ...(d.meta || {}), capital },
    records,
    tabs,
    byTab: Object.values(byTab),
    daily,
    computed: {
      amount: r2(amount),
      bonus: r2(bonus),
      profit: r2(profit),
      count: records.length,
      hits,
      hitRate: records.length ? Math.round(hits / records.length * 1000) / 10 : 0,
      roi: amount ? Math.round(profit / amount * 1000) / 10 : 0,
      liveBalance: r2(capital + profit),
    },
    updatedAt: d.updatedAt,
  };
}

const CFG_KEY = 'jc_cfg_v1';

const Store = {
  mode: 'server',
  cfg: { token: '', owner: '', repo: '', path: 'data.json', branch: 'main' },
  _sha: null,          // GitHub 文件的 sha，更新时必须带上
  _local: null,        // github 模式下的内存数据
  meta: null,

  /* ---------- 初始化：判断当前运行模式 ---------- */
  async init() {
    if (window.__SNAPSHOT__) {
      this.mode = 'snapshot';
      this._local = window.__SNAPSHOT__;
      return this.mode;
    }
    const saved = localStorage.getItem(CFG_KEY);
    if (saved) {
      try { Object.assign(this.cfg, JSON.parse(saved)); } catch (e) {}
    }
    // 探测本地服务是否存在
    try {
      const r = await fetch('/api/db', { cache: 'no-store' });
      if (r.ok) { this.mode = 'server'; return this.mode; }
    } catch (e) {}
    this.mode = this.cfg.token ? 'github' : 'unset';
    return this.mode;
  },

  isConfigured() {
    return this.mode === 'github'
      ? !!(this.cfg.token && this.cfg.owner && this.cfg.repo)
      : true;
  },

  saveCfg(patch) {
    Object.assign(this.cfg, patch);
    localStorage.setItem(CFG_KEY, JSON.stringify(this.cfg));
    if (this.mode === 'unset' && this.cfg.token) this.mode = 'github';
  },

  clearCfg() {
    localStorage.removeItem(CFG_KEY);
    this.cfg = { token: '', owner: '', repo: '', path: 'data.json', branch: 'main' };
    this.mode = 'unset';
  },

  /* ---------- GitHub API ---------- */
  async gh(path, opts = {}) {
    const r = await fetch(GH_API + path, {
      ...opts,
      headers: {
        Authorization: 'Bearer ' + this.cfg.token,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(opts.headers || {}),
      },
    });
    if (!r.ok) {
      let msg = 'GitHub API ' + r.status;
      try { const j = await r.json(); msg += '：' + (j.message || ''); } catch (e) {}
      if (r.status === 401) msg += '（令牌无效或已过期）';
      if (r.status === 404) msg += '（仓库或文件不存在，请检查仓库名与文件路径）';
      throw new Error(msg);
    }
    return r.status === 204 ? null : r.json();
  },

  /* 不抛错的原始请求，用于分步诊断 */
  async ghRaw(path) {
    try {
      const r = await fetch(GH_API + path, {
        headers: {
          Authorization: 'Bearer ' + this.cfg.token,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });
      let json = null;
      try { json = await r.json(); } catch (e) {}
      return { status: r.status, json };
    } catch (e) {
      return { status: 0, json: null, error: e };
    }
  },

  /* 逐步诊断连接问题，返回 {ok, msg, count} */
  async diagnose() {
    const c = this.cfg;
    if (!c.token) return { ok: false, msg: '还没有填令牌' };
    if (!c.owner) return { ok: false, msg: '还没有填 GitHub 用户名' };
    if (!c.repo) return { ok: false, msg: '还没有填数据仓库名' };

    // 1. 用户名
    const u = await this.ghRaw('/users/' + c.owner);
    if (u.status === 404) {
      return { ok: false, msg: `用户名 "${c.owner}" 在 GitHub 上不存在，请检查拼写（注意横杠和数字）` };
    }
    if (u.status === 0) {
      return { ok: false, msg: '连不上 GitHub，请检查网络后重试' };
    }

    // 2. 仓库（带令牌查）
    const r = await this.ghRaw(`/repos/${c.owner}/${c.repo}`);
    if (r.status === 401) return { ok: false, msg: '令牌无效或已过期，请重新生成并粘贴' };
    if (r.status === 404) {
      // 匿名再查一次，区分"仓库不存在"和"令牌没授权"
      try {
        const anon = await fetch(`${GH_API}/repos/${c.owner}/${c.repo}`);
        if (anon.status === 200) {
          return { ok: false, msg: `仓库 ${c.owner}/${c.repo} 存在，但你的令牌访问不了它 —— 令牌没有授权这个仓库。去令牌设置里确认 Repository access 勾选了它（私有仓库必须在 Only select repositories 里选中）` };
        }
      } catch (e) {}
      return { ok: false, msg: `找不到仓库 ${c.owner}/${c.repo}。请在浏览器打开 github.com/${c.owner}/${c.repo} 确认：① 仓库已创建 ② 名字一字不差 ③ 若能打开，说明是令牌没授权它` };
    }

    // 3. 文件
    const f = await this.ghRaw(`/repos/${c.owner}/${c.repo}/contents/${c.path}?ref=${c.branch}`);
    if (f.status === 404) {
      const defBr = (r.json && r.json.default_branch) || 'main';
      if (defBr !== c.branch) {
        return { ok: false, msg: `分支名不对：这个仓库的默认分支是 "${defBr}"，你填的是 "${c.branch}"。把"分支"一栏改成 ${defBr} 再试` };
      }
      return { ok: false, msg: `仓库在，但里面还没有 ${c.path}。请进入 jingcai-data 仓库 → Add file → Upload files → 把桌面部署文件夹里的 data.json 传上去` };
    }
    if (f.status === 403) {
      return { ok: false, msg: '令牌权限不够：生成令牌时 Permissions → Contents 必须设为 Read and write，去令牌设置里补上' };
    }
    if (f.status !== 200) {
      return { ok: false, msg: `读取 ${c.path} 失败（HTTP ${f.status}）：${(f.json && f.json.message) || '未知错误'}` };
    }

    // 4. 内容校验
    let parsed;
    try {
      parsed = JSON.parse(b64decode(f.json.content));
    } catch (e) {
      return { ok: false, msg: 'data.json 的内容不是有效 JSON，请确认上传的是桌面「竞彩台账部署文件」里的原始文件，没被记事本改动过' };
    }
    if (!parsed || !Array.isArray(parsed.records)) {
      return { ok: false, msg: 'data.json 格式不对：缺少 records 字段。请确认上传的是桌面「竞彩台账部署文件」文件夹里的那份' };
    }
    return { ok: true, msg: `一切正常！仓库里已有 ${parsed.records.length} 条记录`, count: parsed.records.length };
  },

  async ghLoad() {
    const p = `/repos/${this.cfg.owner}/${this.cfg.repo}/contents/${this.cfg.path}?ref=${this.cfg.branch}`;
    const j = await this.gh(p);
    this._sha = j.sha;
    return JSON.parse(b64decode(j.content));
  },

  async ghSave(data) {
    const url = `/repos/${this.cfg.owner}/${this.cfg.repo}/contents/${this.cfg.path}`;
    let sha = this._sha;
    if (!sha) {
      try { sha = (await this.gh(url + `?ref=${this.cfg.branch}`)).sha; }
      catch (e) { sha = undefined; }
    }
    const body = {
      message: '更新竞彩台账 ' + new Date().toLocaleString('zh-CN'),
      content: b64encode(JSON.stringify(data, null, 2)),
      branch: this.cfg.branch,
    };
    if (sha) body.sha = sha;
    const j = await this.gh(url, { method: 'PUT', body: JSON.stringify(body) });
    this._sha = j.content.sha;
    return true;
  },

  /* ---------- 统一读取 ---------- */
  async load() {
    if (this.mode === 'snapshot') return this._local;
    if (this.mode === 'server') {
      const r = await fetch('/api/data', { cache: 'no-store' });
      if (!r.ok) throw new Error('本地服务读取失败');
      return r.json();
    }
    if (this.mode === 'github') {
      const d = await this.ghLoad();
      this._local = d;
      return enrich(d);
    }
    throw new Error('尚未配置数据源');
  },

  /* ---------- 统一写入 ---------- */
  async commit(mutator) {
    if (this.mode === 'snapshot') throw new Error('静态快照为只读');

    if (this.mode === 'server') {
      const op = mutator({ type: 'server' });
      const { method, url, body } = op;
      const r = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!r.ok) throw new Error('保存失败');
      return;
    }

    if (this.mode === 'github') {
      if (!this._local) this._local = await this.ghLoad();
      mutator({ type: 'github', data: this._local });
      this._local.updatedAt = new Date().toISOString();
      await this.ghSave(this._local);
      return;
    }
    throw new Error('尚未配置数据源');
  },

  /* ---------- 便捷方法 ---------- */
  async add(rec) {
    return this.commit(({ type, data }) => {
      if (type === 'server') {
        return { method: 'POST', url: '/api/records', body: rec };
      }
      rec.id = (data.records.reduce((m, r) => Math.max(m, r.id || 0), 0)) + 1;
      rec.created_at = new Date().toISOString();
      data.records.push(rec);
    });
  },

  async update(id, rec) {
    return this.commit(({ type, data }) => {
      if (type === 'server') {
        return { method: 'PUT', url: `/api/records/${id}`, body: rec };
      }
      const i = data.records.findIndex(r => r.id === id);
      if (i >= 0) data.records[i] = { ...data.records[i], ...rec, id };
    });
  },

  async del(id) {
    return this.commit(({ type, data }) => {
      if (type === 'server') {
        return { method: 'DELETE', url: `/api/records/${id}` };
      }
      const i = data.records.findIndex(r => r.id === id);
      if (i >= 0) data.records.splice(i, 1);
    });
  },

  async updateMeta(patch) {
    return this.commit(({ type, data }) => {
      if (type === 'server') {
        return { method: 'POST', url: '/api/meta', body: patch };
      }
      data.meta = { ...(data.meta || {}), ...patch };
    });
  },
};

window.Store = Store;
})();
