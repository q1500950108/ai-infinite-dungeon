/* ══════════════════════════════════════════════════════════════════════
   面板层：开局向导 / 装备与背包 / 角色卡 / 任务 / 人物名录 / 时间
   依赖 app.js 里的全局 Backend / Game / UI / esc / $ / toast
   ══════════════════════════════════════════════════════════════════════ */
'use strict';

/* ── 界面偏好：实现放在 public/prefs.js，这里挂到 UI 上 ── */
UI.DEFAULT_PREFS = window.Prefs.DEFAULT;
UI.READ_FONTS = window.Prefs.FONTS;
UI.prefs = () => window.Prefs.load();
UI.savePrefs = p => window.Prefs.save(p);
UI.setPref = (k, v, live) => {
  const p = window.Prefs.load();
  p[k] = v;
  window.Prefs.save(p);
  window.Prefs.apply();
  // live=true 用于滑块拖动，别每动一下就重绘面板（会丢焦点）
  if (!live) UI.openSettings({ tab: UI._cfg ? UI._cfg.tab : 'display' });
};

const D = () => window.GAME_DATA || null;

/* ── 侧栏背包的展开 / 收起 ──
   背包一多（实测 30+ 件）会把整个侧栏撑满，把「技能」「存档」全挤到看不见。
   所以默认收起，只留标题和件数；状态记在本地，玩家展开过就保持展开。 */
const INV_COLLAPSE_KEY = 'mid_inv_collapsed_v1';
UI.invCollapsed = () => {
  try { return localStorage.getItem(INV_COLLAPSE_KEY) !== '0'; }
  catch { return true; }                      // 隐私模式：默认收起
};
UI.applyInvCollapse = () => {
  const el = document.getElementById('invList');
  if (!el) return;
  const want = UI.invCollapsed();
  el.classList.toggle('collapsed', want);
  const c = document.getElementById('invCaret');
  if (c) c.textContent = want ? '▸' : '▾';
};
UI.toggleInv = force => {
  const want = typeof force === 'boolean' ? force : !UI.invCollapsed();
  try { localStorage.setItem(INV_COLLAPSE_KEY, want ? '1' : '0'); } catch { /* 隐私模式 */ }
  UI.applyInvCollapse();
};

const RARITY = id => (D()?.rarities?.[id]) || { name: '普通', color: '#9aa0b5', order: 0 };
const SLOTNAME = {
  head: '头部', weapon: '武器', offhand: '副手', armor: '护甲', accessory: '饰品',
  consumable: '消耗品', skill: '技能', bloodline: '血统',
};
const ATTR_META = () => D()?.attrs || [];

const rarTag = r => {
  const m = RARITY(r);
  return `<span class="rar" style="--rc:${m.color}">${m.name}</span>`;
};

/** 属性 / 战斗数值的中文名。之前散在 statLine 里，而且漏了「魅力」，统一提到这里。 */
const STAT_CN = {
  atk: '攻击', def: '防御',
  con: '体质', agi: '敏捷', int: '智识', wil: '意志', cha: '魅力', luk: '幸运',
  maxHp: 'HP上限', maxSta: '体力上限',
};

const statLine = st => {
  if (!st) return '';
  const parts = Object.entries(st)
    .filter(([, v]) => v)
    .map(([k, v]) => `<span class="st ${v > 0 ? 'up' : 'down'}">${STAT_CN[k] || k} ${v > 0 ? '+' : ''}${v}</span>`);
  return parts.join('');
};

const price = n => n >= 10000 ? `${(n / 10000).toFixed(n % 10000 === 0 ? 0 : 1)}万` : String(n);

/* ══════════════════════════════════════════════════════════════════════
   〇、开始页
   ══════════════════════════════════════════════════════════════════════ */
UI.showLanding = async function () {
  const el = document.getElementById('landing');
  if (!el) return;
  el.classList.add('show');
  // 把游戏界面整个藏起来 —— 不然开始页只是个浮在上面的卡片，
  // 后面的顶栏/侧栏/输入框全都露着。藏掉 #app 之后 body 的背景图就露出来了。
  document.body.classList.add('landing-open');

  const saves = await Backend.listSaves().catch(() => []);
  const c = Backend.cfg || {};
  const isServer = Backend.mode === 'server';

  // ── 两张模式卡：反映真实检测结果，不是让玩家选 ──
  const bS = document.getElementById('badgeServer');
  const bL = document.getElementById('badgeLocal');
  const mS = document.getElementById('modeServer');
  const mL = document.getElementById('modeLocal');
  if (bS) bS.textContent = isServer ? '使用中' : '不可用';
  if (bL) bL.textContent = isServer ? '未启用' : '使用中';
  mS?.classList.toggle('on', isServer);
  mS?.classList.toggle('off', !isServer);
  mL?.classList.toggle('on', !isServer);
  mL?.classList.toggle('off', isServer);
  mS && (mS.onclick = () => toast(isServer
    ? '完整模式：存档在服务器的 saves/ 目录，手机同 Wi-Fi 也能访问，还能让 AI 直接读改存档。'
    : '完整模式需要本地服务器 —— 双击文件夹里的「启动游戏.bat」再刷新页面。', isServer ? 'ok' : 'warn', 5200));
  mL && (mL.onclick = () => toast(isServer
    ? '网页模式是把 public/ 传到静态托管、免安装的那种。现在跑的是完整模式，功能更全。'
    : '网页模式：存档在这个浏览器里，刷新不丢；重塑与回退也能用（快照存在本地）。换浏览器/设备就看不到了。', 'info', 5200));

  // ── 底部：运行状态 ──
  const foot = document.getElementById('landingEngine');
  if (foot) {
    foot.innerHTML = isServer
      ? `完整模式 · 存档在 <code>saves/</code> · 手机同 Wi-Fi 可访问
         <br>当前引擎：<code>${esc(c.providerLabel || c.provider || '未配置')}</code>${c.provider && c.provider !== 'offline' ? ` · <code>${esc(c.model || '')}</code>` : ''}${c.provider && c.provider !== 'offline' && !c.hasKey && (Backend.providers[c.provider] || {}).needsKey ? ' · <span style="color:var(--hp)">缺少 API Key</span>' : ''}`
      : `网页模式 · 存档在这个浏览器里
         <br>API Key 存在本地，浏览器直连可能被 CORS 拦截 —— 想要更稳请用 <code>启动游戏.bat</code>`;
  }

  // ── 两个大按钮 ──
  const btnStart = document.getElementById('ldStart');
  const btnCont = document.getElementById('ldContinue');
  const hasSaves = saves.length > 0;
  const inGame = Boolean(Game.saveId && Game.state);

  // 开始旅途之前先把 API 配好 —— 别人第一次打开时最容易被这一步卡住：
  // 建完号、发了第一句话、然后报「还没配置接口地址」。
  btnStart.onclick = () => UI.startJourney();

  if (inGame) {
    btnCont.classList.remove('disabled');
    btnCont.textContent = '返 回 当 前 游 戏';
    btnCont.onclick = () => UI.hideLanding();
  } else {
    btnCont.classList.toggle('disabled', !hasSaves);
    btnCont.textContent = hasSaves ? '继 续 旅 途' : '还 没 有 存 档';
    btnCont.onclick = async () => {
      if (!hasSaves) { toast('还没有存档 —— 点「开始旅途」创建一段。', 'warn'); return; }
      UI.hideLanding();
      await Game.load(saves[0].id);
      toast(`已读取「${saves[0].name}」`, 'ok');
    };
  }

  // ── 右上角关闭 ──
  const close = document.getElementById('ldClose');
  if (close) close.onclick = () => {
    // 没在游戏里就关了会看到空聊天区 —— 那就等于「开始旅途」
    if (inGame) UI.hideLanding();
    else UI.hideLanding(), UI.openNewSave();
  };

  // ── 右侧功能菜单 ──
  const needGame = (fn, name) => () => {
    if (!Game.saveId || !Game.state) return toast(`「${name}」要在一段旅途里才能打开。`, 'warn');
    UI.hideLanding();
    fn();
  };
  const MENU = {
    settings: () => UI.openSettings(),
    api: () => UI.openSettings(),
    prompt: () => UI.openPrompt(),
    worlds: needGame(() => UI.openWorlds(), '世界图鉴'),
    codex: needGame(() => UI.openCodex(), '人物名录'),
    shop: needGame(() => UI.openShop(), '主神商店'),
    fullscreen: () => {
      if (document.fullscreenElement) document.exitFullscreen?.();
      else document.documentElement.requestFullscreen?.().catch(() => toast('这个浏览器不让进全屏。', 'warn'));
    },
    guide: () => UI.openGuide(),
    saves: () => {
      UI.hideLanding();
      if (!Game.saveId) UI.openNewSave();
      else toast(`侧栏「存档」那一栏里就是全部存档（共 ${saves.length} 个）。`, 'info', 5000);
    },
  };
  document.querySelectorAll('.ld-menu [data-ld]').forEach(b => {
    b.onclick = () => (MENU[b.dataset.ld] || (() => {}))();
  });
};

/** 玩法说明 —— 开始页那个「玩法说明」按钮 */
UI.openGuide = function () {
  const row = (k, v) => `<div class="cd-row"><span>${k}</span><b>${v}</b></div>`;
  UI.openModal({
    title: '玩法说明',
    body: `
      <div class="cd-block"><h4>这是个什么游戏</h4>
        <p>你是现代都市里的一个普通人。每隔七天，主神会把你拉走一次，扔进一部动漫、电影、
        游戏或小说的世界里做任务。完成任务拿积分，回来继续过日子。</p></div>
      <div class="cd-block"><h4>怎么玩</h4>
        <p>用自然语言写你想做什么，AI 会接着往下写。正文后面会给 3~5 个选项，
        <b>点了不会直接发送，而是填进输入框</b> —— 你可以改完再发。不想用选项就直接写。</p></div>
      <div class="cd-block"><h4>时间</h4>
        <p>游戏里的时间是<b>真实日期 + 24 小时制，精确到分钟</b>，从 <b>26年1月1日 00:00</b> 开始。
        <b>时间跟着剧情走</b> —— 你吃顿饭、上一整天班、睡一觉，各花多久就往前走多久，不是固定的四格。</p>
        <p style="margin-top:8px">叙事里会带上大概的时段（清晨 / 上午 / 下午 / 夜晚），但那只是气氛，
        真正的时间以界面上的 <b>HH:MM</b> 为准。</p>
        <p style="margin-top:8px">七个游戏日是一轮。<b>主神会在这一轮里随便挑一个时刻把你拉走</b> ——
        哪天、哪一刻都不固定，所以倒计时只能给个大概。被拉走的那一刻起，
        <b>任务期间现实世界的时间是停住的</b> —— 你在那个世界待多久，地球上一秒都没过，
        回来还是走的那一天。</p></div>
      <div class="cd-block"><h4>两套钱</h4>
        ${row('积分', '任务奖励，在主神商店里换技能、血统、装备')}
        ${row('现金 ¥', '现实生活的钱，交房租、吃饭、买东西')}</div>
      <div class="cd-block"><h4>等级</h4>
        <p>F → E → D → C → B → A → S → SS → SSS。<b>你等级越高，抽到高等级任务的概率越大</b> ——
        S 级之后基本都是 A 以上的任务。</p></div>
      <div class="cd-block"><h4>世界书</h4>
        <p>84 个作品各有一篇世界书（原著设定、势力、5 个原著人物）。
        主神指派你去哪个世界，就注入哪个世界的设定，人物还会带着准确档案进场。</p></div>
      <div class="cd-block"><h4>两个模式</h4>
        ${row('完整模式', '本地服务器。存档在 saves/，手机同 Wi-Fi 可访问，还能让 AI 直接读改存档')}
        ${row('网页模式', '纯静态托管，免安装。存档在浏览器里，<b>重塑与回退同样能用</b>（快照存在浏览器本地）')}</div>
      <div class="cd-hint">想改提示词、换模型、调数值？左侧图标栏的 📜 提示词 和 ⚙️ 设置。</div>`,
    footer: '<button class="btn ghost" onclick="UI.closeModal()">知道了</button>',
  });
};

/**
 * API 配好了没有？
 * · 网页模式：必须自己配（这个页面本身不带 AI）
 * · 完整模式：默认用服务器上的配置 —— 服务器配好了就算「能用」，
 *   但玩家也可以在这个浏览器里填自己的接口（那就直连，不吃服务器的额度）。
 */
UI.apiReady = function () {
  const c = Backend.cfg || {};
  if (Backend.hostRelay) return true;        // 走网站自带的中转，玩家什么都不用配
  if (!c || c.provider === 'offline') return false;
  if (!c.baseUrl || !c.model) return false;
  const need = (Backend.providers?.[c.provider] || {}).needsKey;
  return !(need && !c.apiKey);
};

/** 服务器上有没有可用的接口（完整模式下用来自动跳过第 0 步） */
UI.serverHasApi = function () {
  if (Backend.mode !== 'server') return false;
  const c = Backend.cfg || {};
  if (c.provider === 'offline') return false;
  if (!c.baseUrl || !c.model) return false;
  const need = (Backend.providers?.[c.provider] || {}).needsKey;
  return !(need && !c.apiKey);
};

/**
 * 「开始旅途」：直接进建号向导。
 * 没配好接口的话，向导的**第 0 步**就是 API 配置（见 UI.wzApiStep）——
 * 不配好走不到「出身」，所以这里不用再做拦截，也别再弹一个设置窗口
 * （两个弹窗叠在一起反而更绕）。
 */
UI.startJourney = async function () {
  await Backend.getConfig().catch(() => {});
  UI.hideLanding();
  UI.openNewSave();
};

UI.hideLanding = function () {
  const el = document.getElementById('landing');
  if (el) el.classList.remove('show');
  document.body.classList.remove('landing-open');
  // 摘掉「首次访问」的兜底显示（那是 index.html 内联脚本加的，见 style.css 的 html.no-save）
  document.documentElement.classList.remove('no-save');
};

/* ══════════════════════════════════════════════════════════════════════
   一、开局向导
   ══════════════════════════════════════════════════════════════════════ */
UI._wizard = null;

/**
 * 自定义出身/天赋的「加值」预算：**只算正数**。
 * 以前用绝对值求和，于是把六项全按到 -5 显示「已用 30/7」，
 * 而且每按一次 − 都会把预算吃满、再加也加不动 —— 等于把点数凭空吃掉。
 * 现在负数不占预算（是拿属性换点数），只有往上加才花点数。
 */
const CUSTOM_STAT_BUDGET = { origin: 7, talent: 8 };
const CUSTOM_STAT_MIN = -5;     // 单项最多往下压 5（基础 5 → 最低 0）
const CUSTOM_STAT_MAX = 8;      // 单项最多往上加 8
const statPointsUsed = stats => Object.values(stats || {}).reduce((a, v) => a + Math.max(0, Number(v) || 0), 0);

/**
 * 建号向导的第 0 步：先把 API 配好。
 *
 * 为什么放在建号**之前**：网页版没有内置引擎，没配接口的话建完号、发第一句话才报错，
 * 别人第一次玩基本都卡在这儿。所以把它做成向导的第一步 —— 不配好就走不到「出身」。
 * 已经配好的人会自动跳过这一步（见 openNewSave）。
 */
UI.wzApiStep = function () {
  const c = Backend.cfg || {};
  const isServer = Backend.mode === 'server';
  const provList = Object.entries(Backend.providers || {}).map(([id, v]) => ({ id, ...v }));
  const serverReady = UI.serverHasApi();
  const usingOwn = Boolean(Backend.guestMode);

  // 网页模式下离线引擎跑不了（那是 server.mjs 里的东西）→ 禁掉。
  // ⚠ 如果配置里存的正好是它，不能让它「选中且禁用」—— 那看起来就是个坏掉的下拉框
  // （用户截图里就是这个）。这种情况回落到第一个可用的接口。
  const usable = provList.filter(x => x.id !== 'offline');
  const cur = usable.find(x => x.id === c.provider) || usable[0] || {};
  const opts = provList.map(x => {
    const no = x.id === 'offline' && !isServer;
    return `<option value="${esc(x.id)}" ${x.id === cur.id ? 'selected' : ''} ${no ? 'disabled' : ''}>`
      + `${esc(x.label)}${no ? '（只有本地服务器模式支持）' : ''}</option>`;
  }).join('');

  const form = `
      <label style="font-size:12px;color:var(--text-dim)">叙事引擎</label>
      <select id="wzApiProvider" style="width:100%;margin:6px 0 12px">${opts}</select>

      <label style="font-size:12px;color:var(--text-dim)">接口地址 BaseURL</label>
      <input type="text" id="wzApiBase" value="${esc(c.baseUrl || cur.baseUrl || '')}"
             placeholder="${esc(cur.baseUrl || 'https://api.deepseek.com/v1')}" style="margin:6px 0 4px" />
      <div class="desc" style="margin-bottom:12px">必须是 OpenAI 兼容接口，通常以 <code>/v1</code> 结尾。</div>

      <label style="font-size:12px;color:var(--text-dim)">模型名</label>
      <input type="text" id="wzApiModel" value="${esc(c.provider === cur.id ? (c.model || cur.model || '') : (cur.model || ''))}"
             placeholder="${esc(cur.model || 'deepseek-chat')}" style="margin:6px 0 12px" />

      <label style="font-size:12px;color:var(--text-dim)">API Key</label>
      <input type="password" id="wzApiKey" value="${esc(usingOwn ? (c.apiKey || '') : '')}" placeholder="sk-..." style="margin:6px 0 4px" />
      <div class="desc">按接口要求填；不需要就留空。存在这个浏览器的 localStorage 里，不会上传。</div>
      <div id="wzApiTest" style="margin-top:10px"></div>`;

  // ── 完整模式 + 服务器已经配好，而且浏览器里没存过自己的 Key：什么都不用做 ──
  // ⚠ 以前这里只在 !usingOwn 时才给「用我自己的 API Key」的入口；
  //   反过来（已经填过自己的 Key）却**没有任何切回服务器的按钮** —— 于是只要那把 Key
  //   是错的/过期的，玩家就被永久困在 401 上，怎么点都出不来。所以两边都要给开关。
  if (isServer && serverReady) {
    if (usingOwn) {
      return `
      <div class="field" id="wzServerBox">
        <label>接口</label>
        <div class="result info" style="margin-bottom:10px">
          你现在用的是<b>自己填的接口</b>：<code>${esc(c.providerLabel || c.provider || '')}</code>${c.model ? ` · <code>${esc(c.model)}</code>` : ''}
          ${c.apiKey ? `<br>Key：<code>${esc(String(c.apiKey).slice(0, 10))}…${esc(String(c.apiKey).slice(-4))}</code>` : ''}
          <br><span class="desc">如果一直报「无效的令牌 / 401」，多半是这把 Key 不对。</span>
        </div>
        <button class="btn ghost" id="wzUseServer">↩ 改回用这台服务器配好的接口（推荐）</button>
      </div>
      <div id="wzOwnBox">${form}</div>`;
    }
    return `
      <div class="field" id="wzServerBox">
        <label>接口</label>
        <div class="result ok" style="margin-bottom:10px">
          ✅ 这台服务器已经配好了接口（<code>${esc(c.providerLabel || c.provider || '')}</code>${c.model ? ` · <code>${esc(c.model)}</code>` : ''}），
          你<b>什么都不用填</b>，直接往下走就能玩。
        </div>
        <div class="desc" style="margin-bottom:8px">
          如果你不想用服务器的额度，可以在这个浏览器里填一份自己的 —— 填了之后只影响你自己。
        </div>
        <button class="btn ghost" id="wzUseOwn">🔑 用我自己的 API Key</button>
      </div>
      <div id="wzOwnBox" style="display:none">${form}</div>`;
  }

  // ── 网页模式，或服务器没配好，或已经决定用自己的 ──
  const intro = isServer
    ? `<div class="result warn" style="margin-bottom:10px">
         这台服务器<b>没有配置接口</b>。你可以在这里填自己的，只存在你自己的浏览器里。
       </div>`
    : `<div class="result warn" style="margin-bottom:10px">
         你现在是<b>网页模式</b>：这个页面本身不带 AI，得连一个 OpenAI 兼容的接口才能玩。
         API Key 只存在<b>你自己的浏览器</b>里，不会上传到任何地方。
       </div>`;
  return `<div class="field">
      <label>建号之前：先接上一个 AI 接口</label>
      ${intro}${form}
    </div>`;
};

/** 把第 0 步表单里的值收集成配置 */
UI.wzApiCollect = function () {
  const g = id => document.getElementById(id);
  const patch = {
    provider: g('wzApiProvider')?.value ?? (Backend.cfg || {}).provider,
    baseUrl: (g('wzApiBase')?.value || '').trim(),
    model: (g('wzApiModel')?.value || '').trim(),
    apiKey: g('wzApiKey')?.value || '',
  };
  return patch;
};

UI.openNewSave = function () {
  const d = D();
  if (!d) { toast('游戏数据还没加载好，刷新一下页面。', 'err'); return; }

  // 网页模式下没配接口的话，第 0 步就是 API 配置 —— 不配好走不到出身。
  // 已经配好（或完整模式）就直接从出身的第 1 步开始。
  // 什么时候要停在第 0 步：
  //  · 网页模式：必须自己配（没配就停住）
  //  · 完整模式 + 服务器已配好：停一下告诉他「不用填，直接走」，同时也给了「用我自己的 Key」的入口
  //    —— 已经在这个浏览器里带了 Key 的人不再重复看这一步
  const needApi = Backend.mode === 'server'
    ? !Backend.guestMode
    : !UI.apiReady();

  UI._wizard = {
    // step 0 = API 配置（只在没配好时出现），1..5 = 出身/天赋/属性/难度/确认
    step: needApi ? 0 : 1,
    needApi,
    name: '',
    originId: null,
    originMode: 'preset',      // preset = 从 14 种里挑 | custom = 自己写
    customOrigin: { name: '', desc: '', perk: '', stats: { con: 0, agi: 0, int: 0, wil: 0, cha: 0, luk: 0 }, startItems: [] },
    talentId: null,
    rolled: [],
    rerolled: false,
    talentMode: 'random',      // random = 抽三选一 | manual = 全部自己挑 | custom = 自己写
    customTalent: { name: '', desc: '', perk: '', rarity: 'rare', stats: { con: 0, agi: 0, int: 0, wil: 0, cha: 0, luk: 0 } },
    talentRarity: 'all',
    talentQuery: '',
    attrs: { con: 5, agi: 5, int: 5, wil: 5, cha: 5, luk: 5 },
    gender: '男',
    age: null,
    difficulty: 'normal',
  };
  UI.openModal({
    title: '创建你的角色',
    wide: true,
    body: '<div id="wzBody"></div>',
    footer: '<div id="wzFoot" style="display:flex;gap:9px;width:100%;justify-content:space-between;align-items:center"></div>',
    onMount: ov => { UI._wzEl = ov; UI.wzRender(); },
  });
};

UI.wzRender = function () {
  const w = UI._wizard, d = D(), ov = UI._wzEl;
  if (!w || !ov) return;
  const body = ov.querySelector('#wzBody');
  const foot = ov.querySelector('#wzFoot');
  const steps = ['出身', '天赋', '属性', '难度与世界', '确认'];
  // 面包屑只显示真正的建号步骤；API 那一步是「前置」，用一句说明代替
  const crumb = steps.map((s, i) =>
    `<span class="wz-step ${i + 1 === w.step ? 'on' : i + 1 < w.step ? 'done' : ''}">${i + 1} ${s}</span>`).join('<span class="wz-sep">›</span>');

  let html = w.step === 0
    ? '<div class="wz-crumbs"><span class="wz-step on">0 接上 AI</span><span class="wz-sep">›</span>'
      + steps.map((s, i) => `<span class="wz-step">${i + 1} ${s}</span>`).join('<span class="wz-sep">›</span>') + '</div>'
    : `<div class="wz-crumbs">${crumb}</div>`;

  /* ── 第 0 步：API 配置（只在网页模式且没配好时出现）── */
  if (w.step === 0) {
    html += UI.wzApiStep();
  }

  /* ── 第 1 步：出身 ── */
  if (w.step === 1) {
    const co = w.customOrigin;
    const used = statPointsUsed(co.stats);
    html += `<div class="field"><label>你叫什么名字？</label>
      <input type="text" id="wzName" maxlength="12" placeholder="随便取一个，主神空间不在乎" value="${esc(w.name)}" /></div>

      <div class="field"><label>性别</label>
        <div class="tabs">
          ${['男', '女', '其他', '保密'].map(g => `<button class="tab ${w.gender === g ? 'on' : ''}" data-gender="${g}">${g}</button>`).join('')}
        </div>
        <div class="desc">AI 会据此决定 NPC 怎么称呼你、以及谁可能对你有意思。选「保密」就用中性称呼。</div>
      </div>

      <div class="field"><label>年龄</label>
        <div style="display:flex;gap:14px;align-items:flex-start">
          <input type="number" id="wzAge" min="12" max="90" placeholder="26"
                 value="${w.age == null ? '' : w.age}" style="max-width:110px" />
          <div class="desc" style="margin:0;flex:1">
            决定别人第一眼看你的判断 —— 是学生、刚上班，还是已经被生活磨过一轮。
            留空也行，AI 会自己估。
          </div>
        </div>
      </div>

      <div class="field">
        <label>被拉进灰雾之前，你是什么人？</label>
        <div class="talent-bar">
          <button class="tab ${w.originMode === 'preset' ? 'on' : ''}" data-omode="preset">📋 从 ${d.origins.length} 种里挑</button>
          <button class="tab ${w.originMode === 'custom' ? 'on' : ''}" data-omode="custom">✍️ 自己写一个</button>
        </div>
        ${w.originMode === 'preset' ? `
        <div class="pick-grid" id="wzOrigins">
          ${d.origins.map(o => `
            <div class="pick ${w.originId === o.id ? 'on' : ''}" data-origin="${o.id}">
              <div class="pick-hd"><span class="pick-ico">${o.icon || '·'}</span><span class="pick-nm">${esc(o.name)}</span></div>
              <div class="pick-ds">${esc(o.desc)}</div>
              <div class="pick-st">${statLine(o.stats)}</div>
              ${o.startItems?.length ? `<div class="pick-ex">开局携带：${o.startItems.map(i => esc(i.name)).join('、')}</div>` : ''}
              ${o.perk ? `<div class="pick-pk">▸ ${esc(o.perk)}</div>` : ''}
            </div>`).join('')}
        </div>` : `
        <div class="custom-box">
          <div class="desc" style="margin-bottom:10px">
            属性加值最多 ${CUSTOM_STAT_BUDGET.origin} 点（<b>只算加的部分</b>）。把某一项往下压可以腾出点数给别的项
            —— 每项最低 ${CUSTOM_STAT_MIN}、最高 +${CUSTOM_STAT_MAX}。
            开局道具最多 2 件。
            「特长」会写进 AI 的提示词里影响叙事，写得具体一点更有用。
          </div>
          <div class="field"><label>出身名称</label>
            <input type="text" id="coName" maxlength="16" placeholder="例如：退役潜水员 / 殡仪馆夜班司机 / 前马戏团空中飞人" value="${esc(co.name)}" /></div>
          <div class="field"><label>一句话描述</label>
            <input type="text" id="coDesc" maxlength="80" placeholder="例如：在深海待过太久，习惯性屏息" value="${esc(co.desc)}" /></div>
          <div class="field"><label>特长（写进 AI 提示词）</label>
            <textarea id="coPerk" rows="2" maxlength="120" style="min-height:56px;font-family:inherit;font-size:13px"
              placeholder="例如：水下不会恐慌，能憋气四分钟；对密闭空间有异常的适应力">${esc(co.perk)}</textarea></div>
          <div class="field"><label>属性加值　<span style="color:${used > CUSTOM_STAT_BUDGET.origin ? 'var(--hp)' : 'var(--muted)'}">已用 ${used} / ${CUSTOM_STAT_BUDGET.origin}</span></label>
            <div class="attr-alloc">
              ${ATTR_META().map(a => `
                <div class="attr-row">
                  <div class="attr-info"><span class="attr-nm">${a.name}</span><span class="attr-ds">${esc(a.desc)}</span></div>
                  <div class="attr-ctl">
                    <button class="rnd" data-cstat="${a.id}" data-d="-1" ${co.stats[a.id] <= CUSTOM_STAT_MIN ? 'disabled' : ''}>−</button>
                    <span class="attr-val">${co.stats[a.id] > 0 ? '+' : ''}${co.stats[a.id]}</span>
                    <button class="rnd" data-cstat="${a.id}" data-d="1" ${(used >= CUSTOM_STAT_BUDGET.origin || co.stats[a.id] >= CUSTOM_STAT_MAX) ? 'disabled' : ''}>＋</button>
                  </div>
                </div>`).join('')}
            </div></div>
          <div class="field"><label>开局携带（最多 2 件）</label>
            <div class="row2">
              <input type="text" id="coItem1" maxlength="16" placeholder="道具 1" value="${esc(co.startItems[0]?.name || '')}" />
              <input type="text" id="coItem2" maxlength="16" placeholder="道具 2" value="${esc(co.startItems[1]?.name || '')}" />
            </div></div>
        </div>`}
      </div>`;
  }

  /* ── 第 2 步：天赋 ── */
  if (w.step === 2) {
    const pickCard = t => `
      <div class="pick ${w.talentId === t.id ? 'on' : ''}" data-talent="${t.id}">
        <div class="pick-hd"><span class="pick-ico">${t.icon || '·'}</span><span class="pick-nm">${esc(t.name)}</span>${rarTag(t.rarity)}</div>
        <div class="pick-ds">${esc(t.desc)}</div>
        <div class="pick-st">${statLine(t.stats)}</div>
        ${t.perk ? `<div class="pick-pk">▸ ${esc(t.perk)}</div>` : ''}
      </div>`;

    if (w.talentMode === 'custom') {
      const ct = w.customTalent;
      const used = statPointsUsed(ct.stats);
      const rar = { common: '普通', rare: '稀有', epic: '史诗', legend: '传说' };
      html += `<div class="field">
        <label>自己写一个天赋</label>
        <div class="talent-bar">
          <button class="tab" data-tmode="random">🎲 随机抽三张</button>
          <button class="tab" data-tmode="manual">📋 全部 ${d.talents.length} 个自己挑</button>
          <button class="tab on" data-tmode="custom">✍️ 自己写一个</button>
        </div>
        <div class="custom-box">
          <div class="desc" style="margin-bottom:10px">
            属性加值最多 ${CUSTOM_STAT_BUDGET.talent} 点（<b>只算加的部分</b>；往下压可以腾出点数）。
            「特殊效果」会直接进 AI 的提示词，
            写得越具体，AI 越能照着演 —— 也可以写负面代价，那样更有意思。
          </div>
          <div class="field"><label>天赋名称</label>
            <input type="text" id="ctName" maxlength="16" placeholder="例如：静水 / 第二次呼吸 / 尸体语言" value="${esc(ct.name)}" /></div>
          <div class="field"><label>一句话效果</label>
            <input type="text" id="ctDesc" maxlength="80" placeholder="例如：心跳慢得不像活人" value="${esc(ct.desc)}" /></div>
          <div class="field"><label>特殊效果（写进 AI 提示词）</label>
            <textarea id="ctPerk" rows="3" maxlength="140" style="min-height:70px;font-family:inherit;font-size:13px"
              placeholder="例如：所有恐惧与体力相关的判定 +2；但在需要速度的场合，你会慢半拍。">${esc(ct.perk)}</textarea></div>
          <div class="field"><label>品质（只影响显示）</label>
            <div class="tabs sub">
              ${Object.entries(rar).map(([k, v]) => `<button class="tab ${ct.rarity === k ? 'on' : ''}" data-crar="${k}">${v}</button>`).join('')}
            </div></div>
          <div class="field"><label>属性加值　<span style="color:${used > CUSTOM_STAT_BUDGET.talent ? 'var(--hp)' : 'var(--muted)'}">已用 ${used} / ${CUSTOM_STAT_BUDGET.talent}</span></label>
            <div class="attr-alloc">
              ${ATTR_META().map(a => `
                <div class="attr-row">
                  <div class="attr-info"><span class="attr-nm">${a.name}</span><span class="attr-ds">${esc(a.desc)}</span></div>
                  <div class="attr-ctl">
                    <button class="rnd" data-tstat="${a.id}" data-d="-1" ${ct.stats[a.id] <= CUSTOM_STAT_MIN ? 'disabled' : ''}>−</button>
                    <span class="attr-val">${ct.stats[a.id] > 0 ? '+' : ''}${ct.stats[a.id]}</span>
                    <button class="rnd" data-tstat="${a.id}" data-d="1" ${(used >= CUSTOM_STAT_BUDGET.talent || ct.stats[a.id] >= CUSTOM_STAT_MAX) ? 'disabled' : ''}>＋</button>
                  </div>
                </div>`).join('')}
            </div></div>
        </div>
      </div>`;
    } else if (w.talentMode === 'random') {
      if (!w.rolled.length) w.rolled = UI._rollTalents(3);
      html += `<div class="field">
        <label>主神给了你三张牌，只能拿一张</label>
        <div class="desc" style="margin-bottom:10px">
          天赋是随机抽的 —— 抽到什么是什么，这也是无限流的一部分。
          不满意可以重抽一次，也可以切到「自己挑」或「自己写」。
        </div>
        <div class="talent-bar">
          <button class="tab on" data-tmode="random">🎲 随机抽三张</button>
          <button class="tab" data-tmode="manual">📋 全部 ${d.talents.length} 个自己挑</button>
          <button class="tab" data-tmode="custom">✍️ 自己写一个</button>
        </div>
        <div class="pick-grid three">${w.rolled.map(pickCard).join('')}</div>
      </div>`;
    } else {
      // 品质标签只列天赋里真实存在的品质（装备的「神话」档天赋里没有）
      const present = [...new Set(d.talents.map(t => t.rarity))]
        .sort((a, b) => RARITY(b).order - RARITY(a).order);
      const rarities = [['all', '全部'], ...present.map(k => [k, RARITY(k).name])];
      let pool = d.talents.slice();
      if (w.talentRarity !== 'all') pool = pool.filter(t => t.rarity === w.talentRarity);
      if (w.talentQuery) pool = pool.filter(t => t.name.includes(w.talentQuery) || (t.desc || '').includes(w.talentQuery) || (t.perk || '').includes(w.talentQuery));
      pool.sort((a, b) => (RARITY(b.rarity).order - RARITY(a.rarity).order) || a.name.localeCompare(b.name, 'zh'));
      html += `<div class="field">
        <label>自己挑一个天赋</label>
        <div class="desc" style="margin-bottom:10px">
          全部 ${d.talents.length} 个天赋都在这里，不用靠运气。品质越高越强，但有些普通天赋的
          「叙事效果」在特定场景里比数值更好用。
        </div>
          <div class="talent-bar">
          <button class="tab" data-tmode="random">🎲 随机抽三张</button>
          <button class="tab on" data-tmode="manual">📋 全部自己挑</button>
          <button class="tab" data-tmode="custom">✍️ 自己写一个</button>
          <span class="grow"></span>
          <input type="text" id="wzTq" placeholder="搜索天赋…" value="${esc(w.talentQuery)}" />
        </div>
        <div class="talent-bar" id="wzTrar">
          ${rarities.map(([k, n]) => `<button class="tab ${w.talentRarity === k ? 'on' : ''}" data-trar="${k}">${n}</button>`).join('')}
        </div>
        <div class="talent-scroll"><div class="pick-grid three">${pool.map(pickCard).join('')}</div></div>
        <div class="desc" style="margin-top:6px">${pool.length} 个</div>
      </div>`;
    }
  }

  /* ── 第 3 步：属性 ── */
  if (w.step === 3) {
    const used = Object.values(w.attrs).reduce((a, b) => a + b, 0) - ATTR_META().length * 5;
    const total = (d.difficulties.find(x => x.id === w.difficulty) || {}).points || 8;
    const left = total - used;
    const origin = d.origins.find(o => o.id === w.originId);
    html += `<div class="field">
      <label>分配属性点　<span style="color:${left === 0 ? 'var(--ok)' : 'var(--warn)'}">剩余 ${left} 点</span></label>
      <div class="desc" style="margin-bottom:12px">
        每项基础 5 点。属性直接决定骰子判定的修正值 —— 10 点是基准，每高 2 点修正 +1。
        体质决定 HP 上限，意志决定 体力 上限（每点 ±8）。
      </div>
      <div class="attr-alloc">
        ${ATTR_META().map(a => {
      const base = w.attrs[a.id];
      const bonus = (origin?.stats?.[a.id] || 0);
      const final = base + bonus;
      const mod = Math.floor((final - 10) / 2);
      return `<div class="attr-row">
            <div class="attr-info"><span class="attr-nm">${a.name}</span><span class="attr-ds">${esc(a.desc)}</span></div>
            <div class="attr-ctl">
              <button class="rnd" data-attr="${a.id}" data-d="-1" ${base <= 3 ? 'disabled' : ''}>−</button>
              <span class="attr-val">${final}${bonus ? `<i>（含出身 ${bonus > 0 ? '+' : ''}${bonus}）</i>` : ''}</span>
              <button class="rnd" data-attr="${a.id}" data-d="1" ${(left <= 0 || base >= 16) ? 'disabled' : ''}>＋</button>
              <span class="attr-mod">修正 ${mod >= 0 ? '+' : ''}${mod}</span>
            </div>
          </div>`;
    }).join('')}
      </div></div>`;
  }

  /* ── 第 4 步：难度 ── */
  if (w.step === 4) {
    html += `<div class="field"><label>难度</label>
      <div class="pick-grid three">
        ${d.difficulties.map(x => `
          <div class="pick ${w.difficulty === x.id ? 'on' : ''}" data-diff="${x.id}">
            <div class="pick-hd"><span class="pick-ico">${x.icon}</span><span class="pick-nm">${esc(x.name)}</span></div>
            <div class="pick-ds">${esc(x.desc)}</div>
          </div>`).join('')}
      </div></div>

      <div class="field">
        <label>你的日子从哪开始？</label>
        <div class="desc" style="margin-bottom:10px">
          没有世界要选 —— 你就是个住在现代都市里的普通人。
          平时过自己的日子，每过七天，主神会在其中某个时刻把你拉走一次（哪天哪个时段都随机）。
          任务是什么、去哪里，也全部是当场抽的，同样由 AI 现场生成，你只能随机应变。
        </div>
        <div class="summary" style="padding:14px 16px">
          <div class="sum-line2" style="margin-top:0">
            现实生活 → <b>一周后</b>被拉进主神任务 → 完成或失败 → 回到现实 → 再数七天
          </div>
          <div class="sum-line2" style="color:var(--muted);font-size:11.5px">
            时间由系统推进，你随时能在侧栏看到还剩几天。
            现实里也能做事：上班赚钱、跟人打交道、准备下一次任务 —— 这些都会影响你能不能活下来。
          </div>
        </div>
      </div>`;
  }

  /* ── 第 5 步：确认 ── */
  if (w.step === 5) {
    const origin = w.originMode === 'custom' ? w.customOrigin : d.origins.find(o => o.id === w.originId);
    const talent = w.talentMode === 'custom' ? w.customTalent : d.talents.find(t => t.id === w.talentId);
    const diff = d.difficulties.find(x => x.id === w.difficulty);
    const isCustomO = w.originMode === 'custom', isCustomT = w.talentMode === 'custom';
    const oIcon = isCustomO ? '✍️' : (origin?.icon || '');
    const tIcon = isCustomT ? '✍️' : (origin ? (talent?.icon || '') : '');
    const finalAttrs = {};
    for (const a of ATTR_META()) finalAttrs[a.id] = w.attrs[a.id] + (origin?.stats?.[a.id] || 0) + (talent?.stats?.[a.id] || 0);
    const hp = Math.max(20, 100 + (finalAttrs.con - 10) * 8 + (diff.extraHp || 0));
    const sta = Math.max(20, 100 + (finalAttrs.wil - 10) * 8);
    const score = Math.round((d.economy?.startScore || 500) * diff.scoreMult) + (origin?.score || 0);

    html += `<div class="summary">
      <div class="sum-name">${esc(w.name || '无名者')}${w.gender && w.gender !== '保密' ? `<i style="font-style:normal;font-size:13px;color:var(--text-dim);margin-left:8px">${esc(w.gender)}</i>` : ''}${w.age ? `<i style="font-style:normal;font-size:13px;color:var(--text-dim);margin-left:6px">${w.age} 岁</i>` : ''}</div>
      <div class="sum-line">${oIcon}${esc(origin?.name || '—')}${isCustomO ? '<i style="font-style:normal;color:var(--muted);font-size:11px">（自己写的）</i>' : ''}
        　·　${tIcon}${esc(talent?.name || '—')}${isCustomT ? '<i style="font-style:normal;color:var(--muted);font-size:11px">（自己写的）</i>' : ''}
        　·　${diff.icon}${esc(diff.name)}</div>
      ${(isCustomO && w.customOrigin.desc) || (isCustomT && w.customTalent.desc) ? `<div class="sum-line2" style="color:var(--text-dim)">
        ${[isCustomO ? w.customOrigin.desc : '', isCustomT ? w.customTalent.desc : ''].filter(Boolean).map(esc).join('　·　')}</div>` : ''}
      <div class="sum-grid">
        ${ATTR_META().map(a => `<div><span>${a.name}</span><b>${finalAttrs[a.id]}</b><i>${Math.floor((finalAttrs[a.id] - 10) / 2) >= 0 ? '+' : ''}${Math.floor((finalAttrs[a.id] - 10) / 2)}</i></div>`).join('')}
      </div>
      <div class="sum-line2">初始 HP <b>${hp}</b>　体力 <b>${sta}</b>　积分 <b style="color:var(--score)">${score}</b></div>
      <div class="sum-line2">开局时间 <b>26年1月1日 06:00</b>　·　现金 <b>¥${(d.economy?.startMoney || 3000).toLocaleString()}</b></div>
      <div class="sum-line2" style="color:var(--text-dim);font-size:11.5px">
        现实生活起步，一周后被拉进第一次主神任务 —— 任务内容由 AI 现场生成。</div>
      ${origin?.startItems?.length ? `<div class="sum-line2">携带：${origin.startItems.map(i => esc(i.name)).join('、')}</div>` : ''}
      ${[origin?.perk, talent?.perk].filter(Boolean).length ? `<div class="sum-line2" style="margin-top:8px;color:var(--accent-2)">
        ${[origin?.perk, talent?.perk].filter(Boolean).map(p => '▸ ' + esc(p)).join('<br>')}</div>` : ''}
    </div>
    <div class="desc" style="margin-top:12px;text-align:center">确认之后，灰雾就会把你吸进去。</div>`;
  }

  body.innerHTML = html;

  /* ── 底部按钮 ── */
  const originOk = w.originMode === 'custom'
    ? Boolean((w.customOrigin.name || '').trim())
    : Boolean(w.originId);
  const talentOk = w.talentMode === 'custom'
    ? Boolean((w.customTalent.name || '').trim())
    : Boolean(w.talentId);
  // 每一步的「能不能往下走」：0 API / 1 出身 / 2 天赋 / 3 属性 / 4 难度 / 5 确认（确认页用 wzDone）
  const canNext = [
    false,                       // 第 0 步（API）永远不能用「下一步」，要走下面那个「保存并继续」
    originOk, talentOk,
    Object.values(w.attrs).reduce((a, b) => a + b, 0) - ATTR_META().length * 5 === ((d.difficulties.find(x => x.id === w.difficulty) || {}).points || 8),
    true, true,
  ][w.step];
  foot.innerHTML = `
    <button class="btn ghost" id="wzBack" ${w.step <= 1 ? 'style="visibility:hidden"' : ''}>← 上一步</button>
    <div style="display:flex;gap:9px;align-items:center">
      ${w.step === 2 && w.talentMode === 'random'
      ? `<button class="btn ghost" id="wzReroll" ${w.rerolled ? 'disabled' : ''}>🎲 重抽（${w.rerolled ? '已用过' : '剩 1 次'}）</button>`
      : ''}
      ${w.step === 0
      ? (() => {
        // 服务器已经配好、玩家也没打算用自己的 → 只有一个「开始建号」
        const usesServer = Backend.mode === 'server' && UI.serverHasApi() && !Backend.guestMode;
        return usesServer
          ? '<button class="btn" id="wzApiGo">开始建号 →</button>'
          : `<button class="btn ghost" id="wzApiTestBtn">测试连接</button>
             <button class="btn" id="wzApiGo">保存并继续 →</button>`;
      })()
      : w.step === 5
        ? '<button class="btn" id="wzDone">进入灰雾</button>'
        : `<button class="btn" id="wzNext" ${canNext ? '' : 'disabled'}>下一步 →</button>`}
    </div>`;

  /* ── 事件 ── */
  const nameEl = ov.querySelector('#wzName');
  if (nameEl) nameEl.oninput = e => { w.name = e.target.value; };
  const ageEl = ov.querySelector('#wzAge');
  if (ageEl) ageEl.oninput = e => {
    const v = e.target.value.trim();
    if (!v) { w.age = null; return; }
    const n = Math.round(Number(v));
    w.age = Number.isFinite(n) ? Math.max(12, Math.min(90, n)) : null;
  };

  // ── 出身：预设 / 自己写 ──
  ov.querySelectorAll('[data-origin]').forEach(el => el.onclick = () => { w.originId = el.dataset.origin; UI.wzRender(); });
  ov.querySelectorAll('[data-omode]').forEach(el => el.onclick = () => { w.originMode = el.dataset.omode; UI.wzRender(); });
  ov.querySelectorAll('[data-gender]').forEach(el => el.onclick = () => { w.gender = el.dataset.gender; UI.wzRender(); });
  ov.querySelectorAll('[data-cstat]').forEach(b => b.onclick = () => {
    const k = b.dataset.cstat, dv = Number(b.dataset.d);
    const used = statPointsUsed(w.customOrigin.stats);
    const nv = (w.customOrigin.stats[k] || 0) + dv;
    if (nv < CUSTOM_STAT_MIN || nv > CUSTOM_STAT_MAX || (dv > 0 && used >= CUSTOM_STAT_BUDGET.origin)) return;
    w.customOrigin.stats[k] = nv;
    UI._syncCustom(w);
    UI.wzRender();
  });
  const bindText = (id, obj, key) => {
    const el = ov.querySelector(id);
    if (el) el.oninput = e => { obj[key] = e.target.value; };
  };
  bindText('#coName', w.customOrigin, 'name');
  bindText('#coDesc', w.customOrigin, 'desc');
  bindText('#coPerk', w.customOrigin, 'perk');
  ['#coItem1', '#coItem2'].forEach((sel, i) => {
    const el = ov.querySelector(sel);
    if (el) el.oninput = e => {
      const items = w.customOrigin.startItems;
      items[i] = { name: e.target.value, desc: '' };
      w.customOrigin.startItems = items.filter((x, j) => j <= i || (x?.name || '').trim());
    };
  });

  // ── 天赋 ──
  ov.querySelectorAll('[data-talent]').forEach(el => el.onclick = () => { w.talentId = el.dataset.talent; UI.wzRender(); });
  ov.querySelectorAll('[data-tmode]').forEach(el => el.onclick = () => { w.talentMode = el.dataset.tmode; UI.wzRender(); });
  ov.querySelectorAll('[data-trar]').forEach(el => el.onclick = () => { w.talentRarity = el.dataset.trar; UI.wzRender(); });
  ov.querySelectorAll('[data-crar]').forEach(el => el.onclick = () => { w.customTalent.rarity = el.dataset.crar; UI.wzRender(); });
  ov.querySelectorAll('[data-tstat]').forEach(b => b.onclick = () => {
    const k = b.dataset.tstat, dv = Number(b.dataset.d);
    const used = statPointsUsed(w.customTalent.stats);
    const nv = (w.customTalent.stats[k] || 0) + dv;
    if (nv < CUSTOM_STAT_MIN || nv > CUSTOM_STAT_MAX || (dv > 0 && used >= CUSTOM_STAT_BUDGET.talent)) return;
    w.customTalent.stats[k] = nv;
    UI._syncCustom(w);
    UI.wzRender();
  });
  bindText('#ctName', w.customTalent, 'name');
  bindText('#ctDesc', w.customTalent, 'desc');
  bindText('#ctPerk', w.customTalent, 'perk');

  const tq = ov.querySelector('#wzTq');
  if (tq) {
    tq.oninput = () => {
      w.talentQuery = tq.value;
      clearTimeout(UI._tqTimer);
      UI._tqTimer = setTimeout(() => {
        const pos = tq.selectionStart;
        UI.wzRender();
        const again = ov.querySelector('#wzTq');
        if (again) { again.focus(); again.setSelectionRange(pos, pos); }
      }, 260);
    };
  }
  ov.querySelectorAll('[data-diff]').forEach(el => el.onclick = () => {
    w.difficulty = el.dataset.diff;
    // 难度变了，属性点上限跟着变，多出来的点退回
    const total = (d.difficulties.find(x => x.id === w.difficulty) || {}).points || 8;
    let used = Object.values(w.attrs).reduce((a, b) => a + b, 0) - ATTR_META().length * 5;
    while (used > total) {
      const k = ATTR_META().map(a => a.id).reverse().find(k => w.attrs[k] > 5);
      if (!k) break; w.attrs[k] -= 1; used -= 1;
    }
    UI.wzRender();
  });
  ov.querySelectorAll('[data-attr]').forEach(b => b.onclick = () => {
    const k = b.dataset.attr, dv = Number(b.dataset.d);
    const total = (d.difficulties.find(x => x.id === w.difficulty) || {}).points || 8;
    const used = Object.values(w.attrs).reduce((a, b2) => a + b2, 0) - ATTR_META().length * 5;
    const nv = w.attrs[k] + dv;
    if (nv < 3 || nv > 16) return;
    if (dv > 0 && used >= total) return;
    w.attrs[k] = nv;
    UI.wzRender();
  });

  const back = ov.querySelector('#wzBack');
  if (back) back.onclick = () => { if (w.step > 1) { w.step--; UI.wzRender(); } };
  const next = ov.querySelector('#wzNext');
  if (next) next.onclick = () => { if (w.step < 5) { w.step++; UI.wzRender(); } };
  const reroll = ov.querySelector('#wzReroll');
  if (reroll) reroll.onclick = () => {
    w.rerolled = true; w.talentId = null; w.rolled = UI._rollTalents(3, [w.talentId].filter(Boolean)); UI.wzRender();
  };

  /* ── 第 0 步：保存接口配置，配好了才放行 ── */
  // 换厂商时把它的默认地址/模型带出来，省得手填
  const provSel = ov.querySelector('#wzApiProvider');
  if (provSel) provSel.onchange = () => {
    const def = (Backend.providers || {})[provSel.value];
    if (!def) return;
    const base = ov.querySelector('#wzApiBase'), model = ov.querySelector('#wzApiModel');
    if (base) base.value = def.baseUrl || '';
    if (model) model.value = def.model || '';
  };
  const apiTest = ov.querySelector('#wzApiTestBtn');
  if (apiTest) apiTest.onclick = async () => {
    const box = ov.querySelector('#wzApiTest');
    apiTest.disabled = true;
    box.innerHTML = '<div class="result info">正在测试连接……（只测试，不会保存）</div>';
    try {
      const res = await Backend.testWith(UI.wzApiCollect());
      box.innerHTML = `<div class="result ${res.ok ? 'ok' : 'err'}">${res.ok ? '✅ ' : '❌ '}${esc(res.message)}</div>`;
    } catch (err) {
      box.innerHTML = `<div class="result err">❌ ${esc(err.message)}</div>`;
    }
    apiTest.disabled = false;
  };
  const apiGo = ov.querySelector('#wzApiGo');
  if (apiGo) apiGo.onclick = async () => {
    const box = ov.querySelector('#wzApiTest');
    const formOnScreen = Boolean(ov.querySelector('#wzApiProvider'));
    apiGo.disabled = true;
    const label = apiGo.textContent;
    apiGo.textContent = formOnScreen ? '正在保存…' : '正在进入…';
    try {
      // 表单不在屏幕上（服务器已配好、玩家没填自己的）→ 什么都不用存，直接进建号
      if (formOnScreen) {
        const patch = UI.wzApiCollect();
        // 完整模式：存成**这个浏览器自己的**那份，不动服务器配置
        if (Backend.mode === 'server') patch.__guest = true;
        await Backend.saveConfig(patch);
        await Backend.getConfig();
        applyBranding();
      }
      if (!UI.apiReady()) {
        const cc = Backend.cfg || {};
        const miss = [];
        if (!cc.baseUrl) miss.push('接口地址');
        if (!cc.model) miss.push('模型名');
        if ((Backend.providers?.[cc.provider] || {}).needsKey && !cc.apiKey) miss.push('API Key');
        box.innerHTML = `<div class="result err">还差：${esc(miss.join('、') || '必要信息')}</div>`;
        apiGo.disabled = false; apiGo.textContent = label;
        return;
      }
      toast(formOnScreen ? '接口已保存，接着建角色吧' : '接口可用，开始建角色', 'ok');
      w.needApi = false;
      w.step = 1;
      UI.wzRender();
    } catch (err) {
      box.innerHTML = `<div class="result err">❌ ${esc(err.message)}</div>`;
      apiGo.disabled = false; apiGo.textContent = label;
    }
  };

  // 「用我自己的 API Key」：把隐藏的表单展开，按钮也跟着换
  const useOwn = ov.querySelector('#wzUseOwn');
  if (useOwn) useOwn.onclick = () => {
    const box = ov.querySelector('#wzOwnBox');
    if (box) { box.style.display = ''; box.className = 'field'; }
    // 把上面那句「你什么都不用填」收起来 —— 否则和展开的表单自相矛盾
    const srv = ov.querySelector('#wzServerBox');
    if (srv) srv.style.display = 'none';
    useOwn.style.display = 'none';
    const go = ov.querySelector('#wzApiGo');
    if (go) go.textContent = '保存并继续 →';
  };

  // 「改回用这台服务器配好的接口」——清掉这个浏览器里存的那份（含那把可能是错的 Key）
  const useServer = ov.querySelector('#wzUseServer');
  if (useServer) useServer.onclick = async () => {
    try { localStorage.removeItem('mid_guest_api_v1'); } catch { /* 隐私模式 */ }
    await Backend.getConfig();
    toast('已改回用服务器配好的接口', 'ok');
    UI.openNewSave();   // 重画这一步
  };

  const done = ov.querySelector('#wzDone');
  if (done) done.onclick = async () => {
    done.disabled = true; done.textContent = '正在拉入灰雾…';
    try { await Game.createCharacter(w); } catch (e) { toast(e.message, 'err'); done.disabled = false; done.textContent = '进入灰雾'; }
  };
};

/** 重渲染之前把还没提交的输入框内容同步回向导对象（防止输入被吃掉） */
UI._syncCustom = function (w) {
  const ov = UI._wzEl;
  if (!ov) return;
  const val = sel => { const el = ov.querySelector(sel); return el ? el.value : undefined; };
  const co = w.customOrigin, ct = w.customTalent;
  if (val('#coName') !== undefined) {
    co.name = val('#coName'); co.desc = val('#coDesc'); co.perk = val('#coPerk');
    const i1 = val('#coItem1'), i2 = val('#coItem2');
    co.startItems = [{ name: i1, desc: '' }, { name: i2, desc: '' }].filter(x => (x.name || '').trim());
  }
  if (val('#ctName') !== undefined) {
    ct.name = val('#ctName'); ct.desc = val('#ctDesc'); ct.perk = val('#ctPerk');
  }
};

UI._rollTalents = function (n) {
  const d = D();
  const W = { common: 62, rare: 26, epic: 10, legend: 2 };
  const bag = [...d.talents], out = [];
  while (out.length < n && bag.length) {
    const ws = bag.map(t => W[t.rarity] ?? 30);
    let r = Math.random() * ws.reduce((a, b) => a + b, 0), i = 0;
    for (; i < bag.length; i++) { r -= ws[i]; if (r <= 0) break; }
    out.push(bag.splice(Math.min(i, bag.length - 1), 1)[0]);
  }
  return out;
};

/* ══════════════════════════════════════════════════════════════════════
   二、角色卡
   ══════════════════════════════════════════════════════════════════════ */
UI.openCharacter = function () {
  const s = Game.state, d = D();
  if (!s || !d) return;
  const origin = resolveOrigin(s);
  const talent = resolveTalent(s);
  const diff = d.difficulties.find(x => x.id === s.difficulty) || {};
  const tot = s.totalAttrs || s.attrs;
  const cmb = s.combat || {};

  UI.openModal({
    title: '角色卡',
    wide: true,
    body: `
      <div class="summary">
        <div class="sum-name">${esc(s.name)}</div>
        <div class="sum-line">${origin?.icon || ''}${esc(origin?.name || '未知出身')}　·　${talent?.icon || ''}${esc(talent?.name || '未觉醒')}　·　${diff.icon || ''}${esc(diff.name || '')}</div>
        <div class="sum-grid">
          ${ATTR_META().map(a => {
      const v = tot?.[a.id] ?? 5, m = Math.floor((v - 10) / 2);
      return `<div><span>${a.name}</span><b>${v}</b><i>${m >= 0 ? '+' : ''}${m}</i></div>`;
    }).join('')}
        </div>
        <div class="sum-line2">HP <b style="color:var(--hp)">${s.hp}/${s.maxHp}</b>　体力 <b style="color:var(--sta)">${s.sta}/${s.maxSta}</b>　积分 <b style="color:var(--score)">${s.score}</b></div>
        <div class="sum-line2">攻击 <b>${cmb.atk || 0}</b>　防御 <b>${cmb.def || 0}</b>　回合 <b>${s.turn}</b></div>
          ${s.dungeon ? `<div class="sum-line2">副本：<b>${esc(s.dungeon.name)}</b> ${s.dungeon.rank} 级 · ${s.dungeon.status} ${s.dungeon.progress}%</div>` : ''}
      </div>

      <div class="field" style="margin-top:16px"><label>装备</label>
        <div class="equip-grid">
          ${(d.equipSlots || []).map(slot => {
      const id = s.equipment?.[slot];
      const it = id ? (d.equipment.find(x => x.id === id) || (s.inventory || []).find(x => x.id === id)) : null;
      return `<div class="equip-slot ${it ? 'has' : ''}">
              <div class="es-name">${d.equipSlotNames?.[slot] || slot}</div>
              ${it ? `<div class="es-item">${rarTag(it.rarity)}<b>${esc(it.name)}</b></div>
                      <div class="es-stats">${statLine(it.stats)}</div>
                      <button class="btn ghost tiny" data-unequip="${slot}">卸下</button>`
        : '<div class="es-empty">空</div>'}
            </div>`;
    }).join('')}
        </div>
      </div>

      ${(s.skills || []).length || (s.bloodlines || []).length ? `
      <div class="field"><label>技能与血统</label>
        <div class="chips">
          ${(s.skills || []).map(k => `<span class="chip skill" title="${esc(k.desc || '')}">${esc(k.name)}</span>`).join('')}
          ${(s.bloodlines || []).map(k => `<span class="chip blood" title="${esc(k.desc || '')}">${esc(k.name)}</span>`).join('')}
        </div>
      </div>` : ''}

      ${origin?.perk || talent?.perk ? `<div class="field"><label>特殊效果</label>
        <div class="desc">${[origin?.perk, talent?.perk].filter(Boolean).map(esc).join('<br>')}</div></div>` : ''}

      ${(s.attrs && s.attrs.con !== undefined) ? '' : ''}
      <div class="field"><label>重新分配属性点</label>
        <div class="desc" style="margin-bottom:8px">主神允许一次「重塑」：把建号时分配的 8 点重新分配。装备和出身加值不受影响。</div>
        <button class="btn ghost tiny" id="csRespec">重置分配（当前：${JSON.stringify(s.attrs)}）</button>
      </div>`,
    footer: `<button class="btn ghost" onclick="UI.closeModal()">关闭</button>`,
    onMount: ov => {
      ov.querySelectorAll('[data-unequip]').forEach(b => b.onclick = async () => {
        try {
          const st = await Backend.unequip(Game.saveId, b.dataset.unequip, Game.state);
          Game.state = { ...Game.state, ...st, messages: undefined };
          renderState(Game.state); renderSaves(await Backend.listSaves());
          Game.addSystem(st && b.dataset.unequip ? '卸下了装备。' : '', '');
          UI.closeModal(); UI.openCharacter();
        } catch (e) { toast(e.message, 'err'); }
      });
      const rs = ov.querySelector('#csRespec');
      if (rs) rs.onclick = () => { UI.closeModal(); UI.openRespec(); };
    },
  });
};

UI.openRespec = function () {
  const d = D(), s = Game.state;
  const w = { attrs: { ...(s.attrs || {}) } };
  const total = (d.difficulties.find(x => x.id === s.difficulty) || {}).points || 8;
  UI.openModal({
    title: '重塑属性',
    body: '<div id="rsBody"></div>',
    footer: `<button class="btn ghost" onclick="UI.closeModal()">取消</button><button class="btn" id="rsSave">确认重塑</button>`,
    onMount: ov => {
      const draw = () => {
        const used = Object.values(w.attrs).reduce((a, b) => a + b, 0) - ATTR_META().length * 5;
        const left = total - used;
        ov.querySelector('#rsBody').innerHTML = `
          <div class="desc" style="margin-bottom:12px">剩余 <b style="color:${left === 0 ? 'var(--ok)' : 'var(--warn)'}">${left}</b> 点</div>
          <div class="attr-alloc">
            ${ATTR_META().map(a => {
          const base = w.attrs[a.id] ?? 5;
          return `<div class="attr-row">
                <div class="attr-info"><span class="attr-nm">${a.name}</span><span class="attr-ds">${esc(a.desc)}</span></div>
                <div class="attr-ctl">
                  <button class="rnd" data-a="${a.id}" data-d="-1" ${base <= 3 ? 'disabled' : ''}>−</button>
                  <span class="attr-val">${base}</span>
                  <button class="rnd" data-a="${a.id}" data-d="1" ${(left <= 0 || base >= 16) ? 'disabled' : ''}>＋</button>
                </div></div>`;
        }).join('')}
          </div>`;
        ov.querySelectorAll('[data-a]').forEach(b => b.onclick = () => {
          const k = b.dataset.a, dv = Number(b.dataset.d);
          const u = Object.values(w.attrs).reduce((a, b2) => a + b2, 0) - ATTR_META().length * 5;
          const nv = (w.attrs[k] ?? 5) + dv;
          if (nv < 3 || nv > 16 || (dv > 0 && u >= total)) return;
          w.attrs[k] = nv; draw();
        });
      };
      draw();
      ov.querySelector('#rsSave').onclick = async e => {
        e.target.disabled = true;
        try {
          await Backend.respec(Game.saveId, w.attrs, Game.state);
          await Game.load(Game.saveId);
          toast('属性已重塑', 'ok'); UI.closeModal();
        } catch (err) { toast(err.message, 'err'); e.target.disabled = false; }
      };
    },
  });
};

/* ══════════════════════════════════════════════════════════════════════
   三、主神商店
   剧情里 AI 给的东西走剧情；这里是**主神空间的兑换处** ——
   拿积分换技能、血统、装备，以及把开局那个残次品补全。
   ══════════════════════════════════════════════════════════════════════ */

const SHOP_CATS = [
  { id: 'all', name: '全部', icon: '✦' },
  { id: 'world', name: '世界专属', icon: '🌍' },
  { id: 'skill', name: '技能', icon: '✨' },
  { id: 'bloodline', name: '血统', icon: '🧬' },
  { id: 'weapon', name: '主武器', icon: '⚔️' },
  { id: 'offhand', name: '副手', icon: '🛡️' },
  { id: 'armor', name: '护甲', icon: '🥋' },
  { id: 'accessory', name: '饰品', icon: '💍' },
  { id: 'consumable', name: '消耗品', icon: '💊' },
];
const RAR_ORDER = { common: 0, fine: 1, rare: 2, epic: 3, legend: 4, myth: 5 };

/** 积分够不够、有没有买过、是不是能补全的那个残次品 */
function shopState(it, s) {
  const skills = s.skills || [], bloods = s.bloodlines || [], inv = s.inventory || [];
  const ownFull = skills.some(x => x.id === it.id) || bloods.some(x => x.id === it.id)
    || inv.some(x => x.id === it.id);
  const nerfedList = it.slot === 'skill' ? skills : it.slot === 'bloodline' ? bloods : [];
  const nerfed = nerfedList.find(x => x.id === `${it.id}__nerfed`);
  // 装备类：已经穿在身上的话，买之前告诉玩家会替换掉什么
  let replaceId = null;
  if (Boolean(SLOT_ACCEPTS()[it.slot])) {
    const slots = slotsForSlot(it.slot);
    replaceId = slots.map(x => s.equipment?.[x]).find(Boolean) || null;
  }
  const canUpgrade = Boolean(nerfed) && !ownFull;
  // 补全残次品打折 —— 你已经有那个东西了，只是残的
  const disc = D()?.upgradeDiscount ?? 0.6;
  const cost = canUpgrade ? Math.round(it.cost * disc) : it.cost;
  return {
    ownFull, nerfed, canUpgrade,
    fullPrice: it.cost, cost,
    replaceId: ownFull ? null : replaceId,
    afford: (s.score || 0) >= cost,
    short: Math.max(0, cost - (s.score || 0)),
  };
}

UI.openShop = function (opts = {}) {
  const d = D(), s = Game.state;
  if (!s || !d) return toast('先创建或载入一段旅途。', 'warn');
  const st = UI._shop = UI._shop || { cat: 'all', q: '', sort: 'rarity', rar: 'all', work: '' };
  if (opts.cat) st.cat = opts.cat;
  if (opts.work !== undefined) st.work = opts.work;

  const all = d.equipment || [];
  const decorated = all.map(it => ({ it, ...shopState(it, s) }));
  const upgradeable = decorated.filter(x => x.canUpgrade);

  // 有专属装备的作品（件数多的排前面）
  const works = (() => {
    const m = new Map();
    for (const it of all) if (it.work) m.set(it.work, (m.get(it.work) || 0) + 1);
    return [...m.entries()].map(([work, cnt]) => ({ work, cnt }))
      .sort((a, b) => b.cnt - a.cnt || a.work.localeCompare(b.work, 'zh'));
  })();

  // 筛选与排序
  let list = decorated;
  if (st.cat === 'world') list = list.filter(x => x.it.work);
  else if (st.cat !== 'all') list = list.filter(x => x.it.slot === st.cat);
  if (st.work) list = list.filter(x => x.it.work === st.work);
  if (st.rar !== 'all') list = list.filter(x => x.it.rarity === st.rar);
  if (st.q.trim()) {
    const q = st.q.trim().toLowerCase();
    list = list.filter(x => `${x.it.name}${x.it.desc}${x.it.work || ''}${(x.it.tags || []).join('')}`.toLowerCase().includes(q));
  }
  const sorters = {
    rarity: (a, b) => (RAR_ORDER[b.it.rarity] ?? 0) - (RAR_ORDER[a.it.rarity] ?? 0) || a.it.cost - b.it.cost,
    cheap: (a, b) => a.it.cost - b.it.cost,
    pricey: (a, b) => b.it.cost - a.it.cost,
    name: (a, b) => String(a.it.name).localeCompare(String(b.it.name), 'zh'),
  };
  // 能补全的永远排最前 —— 那是玩家最该看到的东西
  list = [...list].sort((a, b) => (b.canUpgrade - a.canUpgrade) || sorters[st.sort](a, b));

  const statsOf = it => {
    const cur = it.replaceId ? (d.equipment.find(x => x.id === it.replaceId) || (s.inventory || []).find(x => x.id === it.replaceId)) : null;
    return { cur };
  };

  const catCount = id => {
    if (id === 'all') return decorated.length;
    if (id === 'world') return decorated.filter(x => x.it.work).length;
    return decorated.filter(x => x.it.slot === id).length;
  };

  const card = ({ it, ownFull, canUpgrade, replaceId, afford, short, cost, fullPrice }) => {
    const rar = RARITY(it.rarity);
    const { cur } = statsOf({ replaceId });
    const isCons = it.slot === 'consumable';
    const eq = s.equipment || {};
    const worn = Object.values(eq).includes(it.id);
    let btn, note = '';
    if (canUpgrade) {
      btn = `<button class="btn tiny up" data-buy="${it.id}">⚡ 补全 <s>${fmtScore(fullPrice)}</s> ${fmtScore(cost)}</button>`;
      note = '<span class="sp-note up">你身上的是残次品 · 补全价六折</span>';
    } else if (ownFull) {
      btn = `<button class="btn tiny" disabled>${worn ? '已装备' : '已拥有'}</button>`;
      note = '<span class="sp-note">已在你的收藏里</span>';
    } else if (!afford) {
      btn = `<button class="btn tiny" disabled>还差 ${fmtScore(short)}</button>`;
      note = '<span class="sp-note">积分不够</span>';
    } else {
      btn = `<button class="btn tiny" data-buy="${it.id}">${isCons ? '兑换' : '兑换'} · ${fmtScore(cost)}</button>`;
    }

    const delta = (cur && !ownFull && !isCons && it.stats && cur.stats)
      ? Object.entries(it.stats).map(([k, v]) => {
        const dv = (Number(v) || 0) - (Number(cur.stats[k]) || 0);
        if (!dv) return '';
        return `<span class="sp-d ${dv > 0 ? 'up' : 'down'}">${STAT_CN[k] || k} ${dv > 0 ? '+' : ''}${dv}</span>`;
      }).filter(Boolean).join('')
      : '';

    return `<div class="sp-card ${canUpgrade ? 'can-up' : ''} ${!afford && !ownFull && !canUpgrade ? 'cant' : ''}" style="--rc:${rar.color}">
      <div class="sp-top">
        <span class="rar" style="--rc:${rar.color}">${rar.name}</span>
        ${canUpgrade ? '<span class="sp-flag">可补全</span>' : ''}
        ${worn ? '<span class="sp-flag eq">已装备</span>' : ''}
      </div>
      <div class="sp-nm">${esc(it.name)}${it.work ? `<span class="sp-work">${esc(it.work)}</span>` : ''}</div>
      <div class="sp-ds">${esc(it.desc || '')}</div>
      ${Object.keys(it.stats || {}).length ? `<div class="st-row">${statLine(it.stats)}</div>` : ''}
      ${it.perk ? `<div class="sp-pk">▸ ${esc(it.perk)}</div>` : ''}
      ${delta ? `<div class="sp-delta">换上之后：${delta}</div>` : ''}
      ${cur && !ownFull ? `<div class="sp-replace">会替下「${esc(cur.name)}」</div>` : ''}
      <div class="sp-foot">${note}${btn}</div>
    </div>`;
  };

  UI.openModal({
    title: '主神商店',
    wide: true,
    body: `
      <div class="sp-head">
        <span class="sp-bal">积分 <b>${s.score.toLocaleString()}</b></span>
        <span class="sp-hint">任务里 AI 给的东西不用买 —— 这里是主神空间的兑换处</span>
      </div>

      ${upgradeable.length ? `<div class="sp-upbar">
        <span class="sp-upicon">⚡</span>
        <div class="sp-uptext">
          <b>你有 ${upgradeable.length} 个残次品可以补全</b>
          <div class="desc">开局主神给的是阉割版。攒够积分就能在这里换成完整效果，位置不变。</div>
        </div>
        <div class="sp-uplist">
          ${upgradeable.map(({ it, afford, short, cost, fullPrice }) => `
            <div class="sp-uprow">
              <span>${esc(it.name)}</span>
              <span class="sp-upcost"><s>${fmtScore(fullPrice)}</s> ${fmtScore(cost)}</span>
              <button class="btn tiny up" data-buy="${it.id}" ${afford ? '' : 'disabled'}>
                ${afford ? '补全' : `还差 ${fmtScore(short)}`}
              </button>
            </div>`).join('')}
        </div>
      </div>` : ''}

      <div class="shop">
        <div class="shop-side">
          ${SHOP_CATS.map(c => `<button class="shop-cat ${st.cat === c.id ? 'on' : ''}" data-scat="${c.id}">
            <i>${c.icon}</i><span>${c.name}</span><em>${catCount(c.id)}</em></button>`).join('')}
        </div>
        <div class="shop-main">
          <div class="shop-tools">
            <input type="text" id="spQ" placeholder="搜索名称 / 效果 / 标签" value="${esc(st.q)}" />
            <select id="spWork" title="只看某个世界的东西">
              <option value="">全部世界</option>
              ${st.work ? `<option value="${esc(st.work)}" selected>${esc(st.work)}</option>` : ''}
              ${works.filter(w => w.work !== st.work).map(w => `<option value="${esc(w.work)}">${esc(w.work)}（${w.cnt}）</option>`).join('')}
            </select>
            <select id="spRar">
              <option value="all">全部品质</option>
              ${Object.entries(RARITY_ALL()).map(([k, v]) => `<option value="${k}" ${st.rar === k ? 'selected' : ''}>${v.name}</option>`).join('')}
            </select>
            <select id="spSort">
              <option value="rarity" ${st.sort === 'rarity' ? 'selected' : ''}>按品质</option>
              <option value="cheap" ${st.sort === 'cheap' ? 'selected' : ''}>便宜的在前</option>
              <option value="pricey" ${st.sort === 'pricey' ? 'selected' : ''}>贵的在前</option>
              <option value="name" ${st.sort === 'name' ? 'selected' : ''}>按名字</option>
            </select>
          </div>
          ${list.length ? `<div class="shop-grid">${list.map(card).join('')}</div>`
        : '<div class="empty">没有符合条件的东西。换个分类或者清掉搜索词试试。</div>'}
        </div>
      </div>`,
    footer: `<button class="btn ghost" onclick="UI.closeModal()">关闭</button>
             <span class="grow"></span>
             <button class="btn ghost" onclick="UI.closeModal();UI.openInventory()">🎒 背包与装备</button>`,
    onMount: ov => {
      const redraw = () => UI.openShop();
      ov.querySelectorAll('[data-scat]').forEach(b => b.onclick = () => { UI._shop.cat = b.dataset.scat; redraw(); });
      const q = ov.querySelector('#spQ');
      if (q) {
        q.oninput = e => { UI._shop.q = e.target.value; };
        q.onkeydown = e => { if (e.key === 'Enter') redraw(); };
        // 输入时不要每敲一个字就重绘（会丢焦点），失焦或回车再重排
        q.onblur = () => redraw();
      }
      const wk = ov.querySelector('#spWork');
      if (wk) wk.onchange = () => { UI._shop.work = wk.value; redraw(); };
      const rar = ov.querySelector('#spRar');
      if (rar) rar.onchange = () => { UI._shop.rar = rar.value; redraw(); };
      const srt = ov.querySelector('#spSort');
      if (srt) srt.onchange = () => { UI._shop.sort = srt.value; redraw(); };

      ov.querySelectorAll('[data-buy]').forEach(b => b.onclick = async () => {
        const id = b.dataset.buy;
        const it = all.find(x => x.id === id);
        if (!it) return;
        const stt = shopState(it, Game.state);
        // 花钱之前必须确认，尤其是补全这种一笔大支出
        const okGo = await UI.confirmSpend(it, stt);
        if (!okGo) return;
        b.disabled = true;
        try {
          const r = await Backend.buy(Game.saveId, id, Game.state);
          if (r?.state) Game.state = { ...Game.state, ...r.state, messages: undefined };
          toast(r?.msg || '兑换成功', r?.ok === false ? 'err' : 'ok', 4200);
          UI.openShop();
        } catch (e) {
          toast(e.message, 'err');
          b.disabled = false;
        }
      });
    },
  });
};

/** 兑换前的确认 —— 把「花多少、变成什么」说清楚 */
UI.confirmSpend = function (it, stt) {
  return new Promise(resolve => {
    const rar = RARITY(it.rarity);
    const before = (Game.state.score || 0);
    UI.openModal({
      title: stt.canUpgrade ? '补全这个能力？' : '兑换这个？',
      body: `
        <div class="sp-confirm">
          <div class="sp-cf-nm"><span class="rar" style="--rc:${rar.color}">${rar.name}</span>
            <b>${esc(it.name)}</b>${it.slot === 'skill' ? '<span class="sp-flag">技能</span>' : it.slot === 'bloodline' ? '<span class="sp-flag">血统</span>' : ''}</div>
          <div class="sp-ds">${esc(it.desc || '')}</div>
          ${it.perk ? `<div class="sp-pk">▸ ${esc(it.perk)}</div>` : ''}
          ${stt.canUpgrade ? `<div class="sp-cf-up">⚡ 会把你身上那个残次品**原地补全**，位置和名字都不变，效果恢复到完整版。<br>
            补全价 <b>${fmtScore(stt.cost)}</b>（原价 ${fmtScore(stt.fullPrice)}，六折）</div>` : ''}
          ${stt.replaceId ? `<div class="sp-cf-up warn">会替下当前装备的「${esc((D().equipment.find(x => x.id === stt.replaceId) || (Game.state.inventory || []).find(x => x.id === stt.replaceId))?.name || '装备')}」</div>` : ''}
          <div class="sp-cf-num">
            <span>消耗 <b>${fmtScore(stt.cost)}</b></span>
            <span>剩余 <b>${fmtScore(before - stt.cost)}</b></span>
          </div>
        </div>`,
      footer: `<button class="btn ghost" id="spNo">再想想</button>
               <button class="btn ${stt.canUpgrade ? 'up' : ''}" id="spYes">${stt.canUpgrade ? '⚡ 补全' : '确认兑换'}</button>`,
      onMount: ov => {
        ov.querySelector('#spNo').onclick = () => { UI.closeModal(); resolve(false); };
        ov.querySelector('#spYes').onclick = () => { UI.closeModal(); resolve(true); };
      },
    });
  });
};

/** 品质表 */
function RARITY_ALL() {
  return D()?.rarities || {
    common: { name: '普通' }, fine: { name: '精良' }, rare: { name: '稀有' },
    epic: { name: '史诗' }, legend: { name: '传说' }, myth: { name: '神话' },
  };
}

const fmtScore = n => Number(n || 0).toLocaleString();

/* ══════════════════════════════════════════════════════════════════════
   四、背包与装备
   ══════════════════════════════════════════════════════════════════════ */
UI.openInventory = function () {
  const d = D(), s = Game.state;
  if (!s || !d) return;
  const inv = s.inventory || [];
  const equippedIds = new Set(Object.values(s.equipment || {}).filter(Boolean));
  const SLOT_CN = { head: '头部', weapon: '主武器', offhand: '副手', armor: '护甲', accessory: '饰品', consumable: '消耗品' };
  const findAny = id => d.equipment.find(x => x.id === id) || inv.find(x => x.id === id);

  // 当前装备的合计加成 —— 之前要自己一件件加，现在直接给总数
  const eqTotal = {};
  for (const slot of (d.equipSlots || [])) {
    const it = findAny(s.equipment?.[slot]);
    for (const [k, v] of Object.entries(it?.stats || {})) {
      eqTotal[k] = (eqTotal[k] || 0) + (Number(v) || 0);
    }
  }
  const totalLine = Object.entries(eqTotal).filter(([, v]) => v)
    .map(([k, v]) => `<span>${STAT_CN[k] || k} <b>${v > 0 ? '+' : ''}${v}</b></span>`).join('');
  const equippedCount = (d.equipSlots || []).filter(x => s.equipment?.[x]).length;

  // ── 把背包分成两组 ──
  // 「装备」页只放**能穿上的**；「背包」页放消耗品、食物、剧情道具这类**能用的**。
  // 以前全混在一起：想找一只能吃的药，得先翻过十几把刀枪剑戟。
  const RAR_ORDER = { common: 0, fine: 1, rare: 2, epic: 3, legend: 4, myth: 5 };
  const slotOf = it => findAny(it.id)?.slot || it.slot || '';
  const isEquippable = it => Boolean(SLOT_ACCEPTS()[slotOf(it)]);
  const usableOf = it => {
    const eff = it.effect || findAny(it.id)?.effect;
    return Boolean(eff) && Boolean(eff.hp || eff.sta || eff.score || eff.permanent);
  };
  const byRarity = (a, b) => {
    const ra = RAR_ORDER[a.rarity || findAny(a.id)?.rarity] ?? 0;
    const rb = RAR_ORDER[b.rarity || findAny(b.id)?.rarity] ?? 0;
    if (ra !== rb) return rb - ra;
    return String(a.name).localeCompare(String(b.name), 'zh');
  };
  const equipables = [...inv].filter(isEquippable).sort(byRarity);
  const bagItems = [...inv].filter(it => !isEquippable(it)).sort(byRarity);

  // 一行物品（装备页和背包页共用）
  const itemRow = it => {
    const def = d.equipment.find(x => x.id === it.id);
    const slot = def?.slot || it.slot;
    const equippable = Boolean(SLOT_ACCEPTS()[slot]);
    const stats = it.stats && Object.keys(it.stats).length ? it.stats : (def?.stats || {});
    const rarity = it.rarity || def?.rarity || 'common';
    const usable = usableOf(it);
    const eqName = { head: '头部', weapon: '主武器', offhand: '副手', armor: '护甲', accessory: '饰品', consumable: '消耗品' }[slot] || '';
    // ⚠ 消耗品不要显示装备那套属性（"HP上限 +3"），那会让人以为**用了就加上限**。
    //   玩家看到「HP上限+3」点使用、结果只回了血还被上限截断 —— 就觉得"没效果"。
    //   这里改成直接写「使用后：HP +35 体力 +30」。
    const eff = it.effect || def?.effect;
    const effText = (() => {
      if (!eff) return '';
      const parts = [];
      if (eff.hp) parts.push(`HP +${eff.hp}`);
      if (eff.sta) parts.push(`体力 +${eff.sta}`);
      if (eff.score) parts.push(`积分 +${eff.score}`);
      if (eff.permanent?.maxHp) parts.push(`HP 上限 +${eff.permanent.maxHp}`);
      if (eff.permanent?.maxSta) parts.push(`体力 上限 +${eff.permanent.maxSta}`);
      return parts.join('　');
    })();
    const isConsumable = slot === 'consumable';
    const statBlock = (isConsumable && effText)
      ? `<div class="st-row ir-use">使用后：${effText}</div>`
      : (Object.keys(stats).length ? `<div class="st-row">${statLine(stats)}</div>` : '');
    return `<div class="inv-row" style="--rc:${RARITY(rarity).color}">
            <div class="ir-main">
              <div class="ir-nm">${rarTag(rarity)}<b>${esc(it.name)}</b>${it.qty > 1 ? `<span class="q">×${it.qty}</span>` : ''}${equippedIds.has(it.id) ? '<span class="eq">已装备</span>' : ''}${it.source === 'story' ? '<span class="q" title="剧情里得到的">剧情</span>' : ''}</div>
              <div class="ir-ds">${esc(it.desc || def?.desc || '')}${eqName && equippable ? `<span class="ir-slot">${eqName}</span>` : ''}</div>
              ${statBlock}
              ${it.perk || def?.perk ? `<div class="ir-pk">▸ ${esc(it.perk || def?.perk)}</div>` : ''}
            </div>
            <div class="ir-act">
              ${equippable ? `<button class="btn tiny" data-equip="${it.id}">${equippedIds.has(it.id) ? '卸下' : '装备'}</button>` : ''}
              ${usable ? `<button class="btn ghost tiny" data-use="${it.id}">使用</button>` : ''}
              ${def ? `<button class="btn ghost tiny" data-sell="${it.id}">卖 ${price(Math.floor(def.cost / 2))}</button>` : ''}
            </div>
          </div>`;
  };

  UI.openModal({
    title: '装备与背包',
    wide: true,
    body: `
      <div class="inv-tabs">
        <button class="tab on" data-itab="equip">🛡 装备 <span class="mini">${equippedCount}/${(d.equipSlots || []).length}</span></button>
        <button class="tab" data-itab="bag">🎒 背包 <span class="mini">${bagItems.length}</span></button>
      </div>

      <div class="itab-pane" data-pane="equip">
      <div class="field"><label>已装备 <span class="mini">${equippedCount} / ${(d.equipSlots || []).length}</span></label>
        <div class="equip-grid">
          ${(d.equipSlots || []).map(slot => {
      const it = findAny(s.equipment?.[slot]);
      return `<div class="equip-slot ${it ? 'has' : ''}" style="--rc:${it ? RARITY(it.rarity).color : '#2a2a3d'}">
              <div class="es-name">${d.equipSlotNames?.[slot] || slot}</div>
              ${it ? `<div class="es-item"><b>${esc(it.name)}</b></div><div class="es-stats">${statLine(it.stats)}</div>
                      <button class="btn ghost tiny" data-unequip="${slot}">卸下</button>`
        : '<div class="es-empty">空</div>'}
            </div>`;
    }).join('')}
        </div>
        ${totalLine ? `<div class="equip-total"><span class="et-lb">合计加成</span>${totalLine}</div>`
        : '<div class="equip-total empty"><span class="et-lb">合计加成</span><span>身上什么都没穿，全靠肉身</span></div>'}
      </div>

      <div class="field"><label>背包里能换上的 <span class="mini">${equipables.length} 件</span></label>
        ${equipables.length
        ? `<div class="inv-list">${equipables.map(itemRow).join('')}</div>`
        : '<div class="empty">背包里没有可装备的东西。</div>'}
      </div>
      </div>

      <div class="itab-pane" data-pane="bag" hidden>
      <div class="field"><label>消耗品与杂物 <span class="mini">${bagItems.length} 件</span></label>
        ${bagItems.length
        ? `<div class="inv-list">${bagItems.map(itemRow).join('')}</div>`
        : '<div class="empty">背包里没有能用的东西。</div>'}
      </div>
      </div>`,
    footer: `<button class="btn ghost" onclick="UI.closeModal()">关闭</button>`,
    onMount: ov => {
      // 装备 / 背包分两个标签页：以前挤在一屏，背包一多就得一直往下滚才看得到装备
      const TABS = ['equip', 'bag'];
      const setTab = name => {
        ov.querySelectorAll('[data-itab]').forEach(b => b.classList.toggle('on', b.dataset.itab === name));
        ov.querySelectorAll('[data-pane]').forEach(p => { p.hidden = p.dataset.pane !== name; });
      };
      ov.querySelectorAll('[data-itab]').forEach(b => {
        b.onclick = () => {
          const name = TABS.includes(b.dataset.itab) ? b.dataset.itab : 'equip';
          setTab(name);
          try { localStorage.setItem('mid_inv_tab_v1', name); } catch { /* 隐私模式 */ }
        };
      });
      let startTab = 'equip';
      try {
        const t = localStorage.getItem('mid_inv_tab_v1');
        if (TABS.includes(t)) startTab = t;
      } catch { /* 隐私模式 */ }
      setTab(startTab);
      const refresh = async (r) => {
        if (r?.state) Game.state = { ...Game.state, ...r.state, messages: undefined };
        else await Game.load(Game.saveId);
        renderState(Game.state);
        // 用不上（比如血和体力都满）不是成功 —— 别用绿色对勾骗玩家
        if (r?.msg) {
          if (r.ok) { Game.addSystem(r.msg, 'good'); toast(r.msg, 'ok'); }
          else toast(r.msg, 'warn');
        }
        UI.openInventory();
      };
      ov.querySelectorAll('[data-equip]').forEach(b => b.onclick = async () => {
        b.disabled = true;
        try { refresh(await Backend.equip(Game.saveId, b.dataset.equip, Game.state)); }
        catch (e) { toast(e.message, 'err'); b.disabled = false; }
      });
      ov.querySelectorAll('[data-unequip]').forEach(b => b.onclick = async () => {
        b.disabled = true;
        try { refresh(await Backend.unequip(Game.saveId, b.dataset.unequip, Game.state)); }
        catch (e) { toast(e.message, 'err'); b.disabled = false; }
      });
      ov.querySelectorAll('[data-use]').forEach(b => b.onclick = async () => {
        b.disabled = true;
        try { refresh(await Backend.useItem(Game.saveId, b.dataset.use, Game.state)); }
        catch (e) { toast(e.message, 'err'); b.disabled = false; }
      });
      ov.querySelectorAll('[data-sell]').forEach(b => b.onclick = async () => {
        b.disabled = true;
        try { refresh(await Backend.sell(Game.saveId, b.dataset.sell, Game.state)); }
        catch (e) { toast(e.message, 'err'); b.disabled = false; }
      });
    },
  });
};

/* ══════════════════════════════════════════════════════════════════════
   四点五、侧栏：移动端抽屉 + 桌面端收起
   ══════════════════════════════════════════════════════════════════════ */
UI.toggleSidebar = function (open) {
  const sb = document.getElementById('sidebar');
  const bd = document.getElementById('backdrop');
  if (!sb) return;
  const on = open === undefined ? !sb.classList.contains('open') : Boolean(open);
  sb.classList.toggle('open', on);
  if (bd) bd.classList.toggle('show', on);
};

UI.toggleSidebarCollapse = function (force) {
  const sb = document.getElementById('sidebar');
  const rp = document.getElementById('sideReopen');
  if (!sb) return;
  const collapsed = force === undefined ? !sb.classList.contains('collapsed') : Boolean(force);
  sb.classList.toggle('collapsed', collapsed);
  if (rp) rp.classList.toggle('show', collapsed);
  try { localStorage.setItem('dsh_side_collapsed', collapsed ? '1' : '0'); } catch { /* 隐私模式 */ }
};

/* ══════════════════════════════════════════════════════════════════════
   四点六、重塑 / 回退
   ══════════════════════════════════════════════════════════════════════ */

/** 重塑：API 卡住没吐字、或者这一轮不满意 —— 用同样的输入重跑 */
UI.reroll = async function () {
  if (!Game.saveId) return toast('先创建或载入一段旅途。', 'warn');
  if (Game.busy) return toast('还在生成中，等这一轮结束。', 'warn');
  try {
    const r = await Backend.reroll(Game.saveId);
    await applyRollback(r);
    if (r.action) {
      toast(r.redrawn ? '已撤掉这个任务，正在重新派发…' : '正在重塑这一轮…', 'ok');
      await Game.send(r.action, true);
    } else {
      toast('已回到上一轮开头', 'ok');
    }
  } catch (e) { toast(e.message, 'err'); }
};

/** 回退：把上一轮整个删掉 */
UI.undo = async function () {
  if (!Game.saveId) return toast('先创建或载入一段旅途。', 'warn');
  if (Game.busy) return toast('还在生成中，等这一轮结束。', 'warn');
  if (!Game.state?.canUndo) return toast('没有可以回退的轮次了。', 'warn');
  try {
    const r = await Backend.undo(Game.saveId);
    await applyRollback(r);
    toast('已回退一轮', 'ok');
  } catch (e) { toast(e.message, 'err'); }
};

/**
 * 把「重塑 / 回退」返回的存档灌回界面。
 * 服务端模式返回的是 stateView（一份投影），纯前端模式返回的就是存档本体，
 * 两种都要能用 —— 所以判一下要不要重算派生数值。
 */
async function applyRollback(r) {
  if (!r?.state) return;
  Game.state = r.local ? r.state : { ...Game.state, ...r.state, messages: undefined };
  Game.messages = r.messages || r.state.messages || [];
  if (r.local) { localRefresh(Game.state); Game.state.messages = Game.messages; }
  renderMessages(Game.messages);
  renderState(Game.state);
  syncTopActions(Game.state);
  $('turnHint').textContent = `共 ${Game.state.turn} 回合`;
  // 本地模式存档变了，侧栏列表也要跟着刷新
  if (Backend.mode !== 'server') renderSaves(await Backend.listSaves());
}

/* ══════════════════════════════════════════════════════════════════════
   四点七、导出：小说 / 人物卡 / 记忆档案
   ══════════════════════════════════════════════════════════════════════ */

/** 让浏览器去下载那个 TXT。用 <a download> 而不是 fetch —— 文件名交给服务端的
 *  Content-Disposition 处理，中文名才不会乱码。 */
UI.download = function (url, note) {
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  if (note) toast(note, 'ok');
};

UI.exportText = function (kind, npcName, note) {
  if (!Game.saveId) return toast('先创建或载入一段旅途。', 'warn');
  const u = `./api/saves/${encodeURIComponent(Game.saveId)}/text?kind=${encodeURIComponent(kind)}`
    + (npcName ? `&npc=${encodeURIComponent(npcName)}` : '');
  UI.download(u, note || '正在导出…');
};

/** 记忆档案：把所有人的记忆按回合串成一条时间线 */
UI.openArchive = function () {
  const s = Game.state;
  if (!s) return;
  const ws = s.worldState || { npcs: [] };
  const all = [];
  for (const n of ws.npcs || []) {
    for (const m of n.memories || []) {
      all.push({ turn: m.turn || 0, npc: n.name, identity: n.identity || '', text: m.text || '' });
    }
  }
  all.sort((a, b) => b.turn - a.turn);   // 新的在前

  const maxTurn = s.turn || 1;
  // 短期 / 中期 / 长期：按距现在多少回合分。参考站是这么分的，读起来比一长条舒服。
  const span = Math.max(6, Math.round(maxTurn / 3));
  const bucket = r => (maxTurn - r.turn <= span ? '短期' : maxTurn - r.turn <= span * 3 ? '中期' : '长期');
  const counts = { 短期: 0, 中期: 0, 长期: 0 };
  for (const r of all) counts[bucket(r)]++;

  const st = UI._arch = UI._arch || { tab: '全部', npc: '' };
  const npcNames = [...new Set(all.map(r => r.npc))];
  let rows = all.filter(r => st.tab === '全部' || bucket(r) === st.tab);
  if (st.npc) rows = rows.filter(r => r.npc === st.npc);

  UI.openModal({
    title: '记忆档案 · 重要事件回顾',
    wide: true,
    body: `
      <div class="arch-bar">
        <div class="tabs sub">
          ${['短期', '中期', '长期', '全部'].map(t => `<button class="tab ${st.tab === t ? 'on' : ''}" data-atab="${t}">${t}${t !== '全部' ? ` <i>${counts[t]}</i>` : ` <i>${all.length}</i>`}</button>`).join('')}
        </div>
        <span class="grow"></span>
        <select id="archNpc" class="arch-sel">
          <option value="">全部人物</option>
          ${npcNames.map(n => `<option value="${esc(n)}" ${st.npc === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}
        </select>
        <button class="btn tiny" id="archExport">📖 导出为小说</button>
      </div>

      ${rows.length ? `<div class="arch-list">
        ${rows.map(r => `
          <div class="arch-row">
            <div class="arch-when"><span>第 ${r.turn} 回合</span><span class="arch-tag">${bucket(r)}</span></div>
            <div class="arch-body">
              <div class="arch-npc">${esc(r.npc)}${r.identity ? `<span>${esc(r.identity)}</span>` : ''}</div>
              <div class="arch-text">${esc(r.text)}</div>
            </div>
          </div>`).join('')}
      </div>` : '<div class="empty">还没有留下任何记忆。任务里跟人打过交道之后，这里就会攒起来。</div>'}
    `,
    footer: `<button class="btn ghost" onclick="UI.closeModal()">关闭</button>
             <button class="btn ghost" id="archExportAll">导出全部档案（小说+人物+记忆）</button>`,
    onMount: ov => {
      ov.querySelectorAll('[data-atab]').forEach(b => b.onclick = () => { st.tab = b.dataset.atab; UI.openArchive(); });
      const sel = ov.querySelector('#archNpc');
      if (sel) sel.onchange = () => { st.npc = sel.value; UI.openArchive(); };
      ov.querySelector('#archExport').onclick = () => UI.exportText('memory', st.npc || null, '记忆档案已导出');
      const all2 = ov.querySelector('#archExportAll');
      if (all2) all2.onclick = () => UI.exportText('dossier', null, '完整档案已导出');
    },
  });
};

/* ══════════════════════════════════════════════════════════════════════
   四点七五、网页模式：怎么把 public/ 变成一条网址
   ══════════════════════════════════════════════════════════════════════ */
UI.openWebMode = function () {
  const row = (k, v) => `<div class="cd-row"><span>${k}</span><b>${v}</b></div>`;
  UI.openModal({
    title: '网页模式 —— 免安装，发一条网址就能玩',
    wide: true,
    body: `
      <div class="cd-block"><h4>它是什么</h4>
        <p>把 <code>public/</code> 这个目录整个传到任意静态托管上，就变成一条网址。
        谁点谁玩 —— 不用装 Node、不用下载任何东西。</p></div>

      <div class="cd-block"><h4>和完整模式的区别</h4>
        ${row('存档', '存在各自的浏览器里，天然隔离，互相看不见')}
        ${row('API Key', '也存浏览器里，各人填各人的，费用各自承担')}
        ${row('重塑 / 回退', '<b style="color:var(--hp)">不可用</b> —— 那两个功能靠服务端存快照')}
        ${row('手机访问', '有网址就行')}
        ${row('存档安全', '<b style="color:var(--warn)">清浏览器数据就没了</b>，重要的话导出一份 TXT')}</div>

      <div class="cd-block"><h4>三步做出来</h4>
        <p><b>1.</b> 把项目的 <code>public/</code> 目录整个传上去。常用的免费托管：<br>
        　· <b>GitHub Pages</b> —— 建个仓库，把 public 里的文件丢进去，在设置里开 Pages<br>
        　· <b>Vercel / Netlify</b> —— 直接把文件夹拖进它们的网页，几秒钟出链接<br>
        　· <b>Cloudflare Pages</b> —— 同上</p>
        <p><b>2.</b> 打开那条网址。它会显示「网页模式（没检测到本地服务器）」。</p>
        <p><b>3.</b> 在 🔑 API 管理 里填自己的接口地址、模型名和 API Key，就能开玩。</p></div>

      <div class="cd-block"><h4>两个要注意的</h4>
        <p>① 浏览器直连厂商接口<b>可能被 CORS 拦截</b>。多数主流厂商允许浏览器直连；
        如果报跨域错误，换个厂商，或者改用完整模式。</p>
        <p>② 存档在浏览器里，<b>换浏览器 / 换设备就看不到了</b>。想带走就用「导出全部档案 TXT」。</p></div>

      <div class="cd-block"><h4>想先在本地试试？</h4>
        <p>不用传任何东西 —— 装了 Node 的话，在项目目录里跑
        <code>npx serve public</code>，打开它给的地址就是网页模式。</p></div>`,
    footer: '<button class="btn ghost" onclick="UI.closeModal()">知道了</button>',
  });
};

/* ══════════════════════════════════════════════════════════════════════
   四点八、世界图鉴 —— 去过哪些作品，那些世界的设定与原著人物
   ══════════════════════════════════════════════════════════════════════ */
UI.openWorlds = function () {
  const s = Game.state;
  if (!s) return;
  const ws = s.worldState || {};
  const visited = ws.visitedWorlds || [];
  const st = UI._worlds = UI._worlds || { sel: null };

  // 默认选中当前所在的世界，没有就选最近去过的
  if (!st.sel || !visited.some(v => v.work === st.sel)) {
    st.sel = ws.currentBook?.canon || visited[visited.length - 1]?.work || null;
  }

  const npcs = (ws.npcs || []);
  const met = name => npcs.some(n => n.name === name);

  // 详情：优先用当前任务注入的完整世界书，否则从 meta 索引里找名字
  const cur = ws.currentBook && ws.currentBook.canon === st.sel ? ws.currentBook : null;
  const idx = (D()?.worlds || []).find(w => (w.canon || w.name) === st.sel);

  const detail = st.sel ? (() => {
    if (!cur && !idx) return '<div class="empty" style="padding:36px;text-align:center">这个世界书没有加载。</div>';
    const b = cur || idx;
    return `
      <div class="wb-head">
        <span class="wb-icon">${esc(b.icon || '📖')}</span>
        <div>
          <div class="wb-name">${esc(b.canon || b.name)}</div>
          <div class="wb-tag">${esc(b.tagline || '')}</div>
        </div>
      </div>
      ${b.guidance ? `<div class="cd-block"><p class="wb-guide">${esc(b.guidance)}</p></div>` : ''}
      ${b.powerStyle ? `<div class="cd-block"><h4>力量风格</h4><p>${esc(b.powerStyle)}</p></div>` : ''}
      ${b.signatureItems?.length ? `<div class="cd-block"><h4>标志性道具</h4>
        <div class="chips">${b.signatureItems.map(i => `<span class="chip">${esc(i)}</span>`).join('')}</div></div>` : ''}
      ${b.factions?.length ? `<div class="cd-block"><h4>势力</h4>
        ${b.factions.map(f => `<div class="cd-row"><span>${esc(f.name)}</span><b>${esc(f.attitude || '')}</b></div>
          <div class="desc" style="margin:-2px 0 8px">${esc(f.desc || '')}</div>`).join('')}</div>` : ''}
      ${b.npcs?.length ? `<div class="cd-block"><h4>原著人物 <span class="mini">见过 ${b.npcs.filter(n => met(n.name)).length} / ${b.npcs.length}</span></h4>
        <div class="wb-cast">
          ${b.npcs.map(n => {
      const isMet = met(n.name);
      const rec = npcs.find(x => x.name === n.name);
      const [tn, tc] = isMet ? FAV(rec.favor || 0) : ['', 'var(--muted)'];
      const av = npcAvatar(n.name);
      return `<div class="wb-npc ${isMet ? 'met' : ''}" data-gonpc="${esc(n.name)}">
              <span class="ci-av" style="background:${av.color}22;color:${av.color};border-color:${av.color}55">${esc(av.ch)}</span>
              <div class="wb-npc-body">
                <div class="ci-nm">${esc(n.name)}${isMet ? `<span class="wb-fav" style="color:${tc}">${tn} ${rec.favor > 0 ? '+' : ''}${rec.favor}</span>` : '<span class="wb-unmet">还没遇到</span>'}</div>
                <div class="ci-sub">${esc(n.identity || '')}${n.role ? ` · ${esc(n.role)}` : ''}</div>
              </div>
            </div>`;
    }).join('')}
        </div>
        <div class="desc">在游戏里跟人打过交道之后，这里会显示好感和详细档案。</div></div>` : ''}
      <div class="cd-hint">详细档案（外貌 / 说话风格 / 好感规则）在 📇 人物名录里。</div>`;
  })() : '<div class="empty" style="padding:40px;text-align:center">还没被主神送出去过。<br><br>每完成一次主神任务，去过的世界就会记在这里。</div>';

  UI.openModal({
    title: `世界图鉴 · 去过 ${visited.length} 个作品`,
    wide: true,
    body: `
      <div class="codex">
        <div class="codex-list">
          <div class="tabs sub" style="margin-bottom:8px">
            <button class="tab on">去过 ${visited.length}</button>
            <span class="grow"></span>
            <button class="tab" onclick="UI.closeModal();UI.openCodex()">📇 人物</button>
          </div>
          <div class="codex-scroll">
            ${ws.currentBook ? `<div class="wb-cur">当前：${esc(ws.currentBook.icon || '📖')} ${esc(ws.currentBook.canon)}</div>` : ''}
            ${visited.length ? visited.slice().reverse().map(v => {
      const on = v.work === st.sel;
      const book = (D()?.worlds || []).find(x => (x.canon || x.name) === v.work);
      return `<div class="codex-item ${on ? 'on' : ''}" data-world="${esc(v.work)}">
                <span class="wb-li-icon">${esc(v.icon || book?.icon || '📖')}</span>
                <div class="ci-body">
                  <div class="ci-nm">${esc(v.work)}</div>
                  <div class="ci-sub">第 ${v.day} 天首次进入 · 去过 ${v.times} 次</div>
                </div>
              </div>`;
    }).join('') : '<div class="empty" style="padding:20px;text-align:center">还是空的</div>'}
          </div>
        </div>
        <div class="codex-detail">${detail}</div>
      </div>`,
    footer: `<button class="btn ghost" onclick="UI.closeModal()">关闭</button>
             ${st.sel ? `<span class="grow"></span>
               <button class="btn ghost" onclick="UI.exportText('worldbook','${esc(st.sel).replace(/'/g, '&#39;')}','这本世界书已导出')">⬇ 导出这本世界书</button>` : ''}
             <button class="btn" onclick="UI.exportText('worlds',null,'世界图鉴已导出')">📖 导出世界图鉴</button>`,
    onMount: ov => {
      ov.querySelectorAll('[data-world]').forEach(el => el.onclick = () => {
        UI._worlds.sel = el.dataset.world;
        UI.openWorlds();
      });
      ov.querySelectorAll('[data-gonpc]').forEach(el => el.onclick = () => {
        const n = (Game.state.worldState?.npcs || []).find(x => x.name === el.dataset.gonpc);
        if (!n) return toast('还没在游戏里遇到这个人。', 'warn');
        UI.closeModal();
        UI._codex = UI._codex || {};
        UI._codex.sel = n.name;
        UI._codex.tab = '概况';
        UI.openCodex();
      });
    },
  });
};

/* ══════════════════════════════════════════════════════════════════════
   四·五、主神空间（中转站）—— 系统面板 / 指定世界 / 推门 / 出站
   ══════════════════════════════════════════════════════════════════════ */
UI.openHub = function () {
  const s = Game.state;
  if (!s) return;
  if (!s.isHub) {
    return toast('你现在不在主神空间。下一次被拉走时才有机会进去。', 'warn');
  }
  const panel = s.panel || '（面板没有响应）';
  const pending = s.pendingWork || '';
  const free = s.freeWorldPick === true;          // 首次免费
  const cost = s.pickWorldCost ?? 5000;
  const score = s.score || 0;
  const canAfford = free || score >= cost;
  const works = (window.GAME_DATA?.outline?.MISSION_HOOKS || []).map(h => h.work).filter(Boolean);
  const unique = [...new Set(works)].sort();

  UI.openModal({
    title: '主神空间 · 中转站',
    body: `
      <div class="field">
        <label>系统面板</label>
        <pre class="hub-panel">${esc(panel)}</pre>
      </div>
      <div class="field">
        <label>指定下一个去的世界</label>
        <div class="desc" style="margin-bottom:10px">
          ${free
        ? `🎁 <b style="color:var(--score)">主神送了你第一次免费指定</b> —— 现在挑一个世界不要积分。
                 ${pending ? `<br>当前已经指定：<b style="color:var(--score)">《${pending}》</b>` : ''}`
        : `推门进去的默认是**随机世界**。花 <b>${cost.toLocaleString()}</b> 积分可以让主神把坐标定死
                 —— 你现在有 <b>${score.toLocaleString()}</b> 积分。
                 ${pending ? `<br>当前已经指定：<b style="color:var(--score)">《${pending}》</b>` : ''}`}
        </div>
        <div class="hub-pick-row">
          <select id="hubWorld" class="hub-select">
            <option value="">（随机，不花积分）</option>
            ${unique.map(w => `<option value="${esc(w)}" ${w === pending ? 'selected' : ''}>${esc(w)}</option>`).join('')}
          </select>
          <button class="btn ${canAfford ? '' : 'ghost'}" id="hubPick" ${canAfford ? '' : 'disabled'}>
            指定（${free ? '首次免费' : cost.toLocaleString() + ' 分'}）
          </button>
        </div>
      </div>
      <div class="field">
        <label>接下来</label>
        <div class="tabs">
          <button class="tab" id="hubDepart">🚪 推开那扇门（进任务世界）</button>
          <button class="tab" id="hubLeave">↩ 出站，回到现实</button>
          <button class="tab" id="hubShop">🛒 去兑换</button>
        </div>
        <div class="desc" style="margin-top:8px">
          门后是什么世界由主神定。进去之后现实的时间是停的 —— 你回来时还是走的那一刻。
        </div>
      </div>`,
    footer: '<button class="btn ghost" onclick="UI.closeModal()">关闭</button>',
    onMount: ov => {
      /**
       * 跑一个主神空间操作。
       * after 是「要填进输入框的那句话」—— 与其让玩家自己再打一遍，不如填好让他回车。
       */
      const run = async (fn, okMsg, after) => {
        try {
          const r = await fn();
          await Game.load(Game.saveId);
          UI.closeModal();
          const msg = r?.msg || okMsg;
          // 消息里的 **粗体** 在提示条上会露出星号，这里去掉
          if (msg) { toast(String(msg).replace(/\*\*/g, ''), 'ok'); Game.addSystem(msg, 'good'); }
          if (after) UI.fillComposer(typeof after === 'function' ? after(r) : after);
        } catch (e) { toast(e.message, 'err'); }
      };
      const pick = ov.querySelector('#hubPick');
      if (pick) pick.onclick = () => {
        const work = ov.querySelector('#hubWorld').value;
        if (!work) return toast('先选一个世界。', 'warn');
        run(() => Backend.pickWorld(Game.saveId, work, Game.state), '',
          // 指定完直接把「推门去那里」填好，玩家只要回车
          () => `推开那扇门，去《${work}》`);
      };
      // 推门 = 立刻进任务世界（服务端已经派好任务并落了系统消息），所以：
      //  · 指定过世界 → 直接送进去，不用再填话
      //  · 没指定过   → 也送进去了（随机世界），只报一句，别留旧文本
      // 两种情况都要**清空输入框** —— 否则上一步填的「推开那扇门，去《X》」还留着，
      // 玩家顺手一回车就发出一个已经发生过的动作，白烧一轮。
      ov.querySelector('#hubDepart').onclick = () => {
        const w = Game.state?.pendingWork;
        UI.fillComposer('');
        return run(() => Backend.hubOp(Game.saveId, 'depart', Game.state),
          w ? `门后是《${w}》—— 系统已经把你送进去了。` : '门开了 —— 落点由主神定。');
      };
      ov.querySelector('#hubLeave').onclick = () => run(
        () => Backend.hubOp(Game.saveId, 'leave', Game.state), '出站，回到现实。',
        '我出站，回到现实生活');
      ov.querySelector('#hubShop').onclick = () => { UI.closeModal(); UI.openShop(); };
    },
  });
};

/* ══════════════════════════════════════════════════════════════════════
   五、时间：现实生活 ←→ 主神任务
   ══════════════════════════════════════════════════════════════════════ */
UI.openTime = function () {
  const s = Game.state;
  if (!s) return;
  const cd = {
    text: s.countdownText || '—',
    days: s.countdownDays ?? 0,
    minutes: s.countdownMinutes ?? 0,
  };
  const inMission = s.phase === 'mission';
  const slots = ['清晨', '上午', '下午', '夜晚'];

  UI.openModal({
    title: '时间与阶段',
    body: `
      <div class="prog-ring">
        <span class="pr-num" style="font-size:20px">${esc(s.clockText || '')}</span>
        <div class="pr-bar">
          <div class="track" style="height:8px">
            <div class="fill ${cd.days <= 1 && !inMission ? 'hp' : 'score'}"
                 style="width:${inMission ? 100 : Math.round(Math.max(0, Math.min(1, 1 - cd.minutes / 10080)) * 100)}%"></div>
          </div>
        </div>
      </div>

      <div class="field">
        <label>当前阶段</label>
        <div class="quest-main ${inMission ? '' : 'empty'}" style="${inMission ? 'border-color:rgba(255,95,109,.4)' : ''}">
          ${inMission
        ? `🚨 <b>${esc(s.mission?.name || '主神任务')}</b>${s.mission?.rank ? `　${esc(s.mission.rank)} 级` : ''}
               ${s.mission?.brief ? `<br><span style="font-size:11.5px;color:var(--text-dim)">${esc(s.mission.brief)}</span>` : ''}`
        : `📅 现实生活　距离下一次主神任务 <b>${esc(cd.text)}</b>`}
        </div>
      </div>

      <div class="field">
        <label>怎么过这几天</label>
        <div class="desc" style="margin-bottom:10px">
          现实生活是主体，**不要为了等任务而空转**。上班、见人、锻炼、查资料、买装备、
          跟前同事吃饭 —— 这些都会影响你下一次能不能活着回来。
          时间由系统推进，你说「我去上班」它就往前走。
        </div>
        <div class="tabs">
          <button class="tab" data-adv="30">推进 30 分钟</button>
          <button class="tab" data-adv="240">推进 4 小时</button>
          <button class="tab" data-adv="1440">睡一觉（1 天）</button>
          <button class="tab" data-skip="1" ${inMission ? 'disabled' : ''}>直接跳到任务时刻</button>
        </div>
      </div>

      <div class="field">
        <label>手动控制</label>
        <div class="desc" style="margin-bottom:8px">
          等不及想现在就打一场，或者任务卡住了想强行结束，用这两个。
        </div>
        <div class="tabs">
          <button class="tab" id="tStartMission">🚨 现在就开始主神任务</button>
          <button class="tab" id="tEndMission" ${inMission ? '' : 'disabled'}>✅ 结束当前任务，回到现实</button>
        </div>
      </div>`,
    footer: `<button class="btn ghost" onclick="UI.closeModal()">关闭</button>`,
    onMount: ov => {
      const apply = async (fn, note) => {
        try {
          await fn();
          await Game.load(Game.saveId);
          if (note) { Game.addSystem(note, 'good'); toast(note, 'ok'); }
          UI.closeModal();
        } catch (e) { toast(e.message, 'err'); }
      };
      ov.querySelectorAll('[data-adv]').forEach(b => b.onclick = () =>
        apply(() => Backend.advanceTime(Game.saveId, Number(b.dataset.adv), Game.state),
          `时间推进到 ${Game.state.clockText || ''}`));
      ov.querySelectorAll('[data-skip]').forEach(b => b.onclick = () =>
        apply(() => Backend.advanceTime(Game.saveId, null, Game.state, true), '快进到了任务日'));
      ov.querySelector('#tStartMission').onclick = () =>
        apply(() => Backend.missionOp(Game.saveId, 'start', {}, Game.state), '主神把你拉走了。');
      const em = ov.querySelector('#tEndMission');
      if (em) em.onclick = () =>
        apply(() => Backend.missionOp(Game.saveId, 'end', {}, Game.state), '任务结束，你回到了现实。');
    },
  });
};

/* ══════════════════════════════════════════════════════════════════════
   六、任务与攻略度   （FAV / clamp2 在文件末尾的人物名录一节里统一定义）
   ══════════════════════════════════════════════════════════════════════ */
UI.openQuests = function () {
  const s = Game.state, d = D();
  if (!s) return;
  const ws = s.worldState || { quests: [], npcs: [] };
  const quests = [...(ws.quests || [])].sort((a, b) =>
    (a.type === '主线' ? -1 : 1) - (b.type === '主线' ? -1 : 1));
  const npcs = [...(ws.npcs || [])].sort((a, b) => (b.favor || 0) - (a.favor || 0));
  const done = quests.filter(q => q.status === '已完成').length;

  const stCls = st => st === '已完成' ? 'ok' : st === '已失败' ? 'no' : 'on';



  UI.openModal({
    title: `任务 · ${s.clockText || ''}`,
    wide: true,
    body: `
      <div class="prog-ring">
        <span class="pr-num" style="font-size:19px">${esc(s.clockText || '')}</span>
        <div class="pr-bar">
          <div class="track" style="height:8px"><div class="fill ${(s.countdownDays <= 1 && s.phase !== 'mission') ? 'hp' : 'score'}" style="width:${s.phase === 'mission' ? 100 : Math.round((1 - (s.countdownSlots ?? 0) / 28) * 100)}%"></div></div>
          <div class="desc" style="margin-top:6px">${s.phase === 'mission' ? '<b style="color:var(--hp)">主神任务进行中</b>' : `现实生活 · 距离下一次主神任务 <b>${esc(s.countdownText || '')}</b>`}${ws.faction ? ` · 当前站队：<b>${esc(ws.faction)}</b>` : ''}</div>
        </div>
      </div>

      ${s.phase === 'mission' && s.mission ? `<div class="field">
        <label>当前任务</label>
        <div class="quest-main">${esc(s.mission.name || '主神任务')}${s.mission.rank ? `　<b>${esc(s.mission.rank)} 级</b>` : ''}</div>
        ${s.mission.brief ? `<div class="quest-goal">${esc(s.mission.brief)}</div>` : ''}
      </div>` : ''}

      <div class="field">
        <label>任务清单（${done}/${quests.length} 已完成）</label>
        ${quests.length ? quests.map(q => `
          <div class="quest-row ${q.type === '主线' ? 'main' : ''} ${q.status === '已完成' ? 'done' : q.status === '已失败' ? 'fail' : ''}">
            <div class="qr-body">
              <div class="qr-nm">${q.type === '主线' ? '★' : '·'} ${esc(q.name)}${q.progress && q.progress.cur
                ? `<span class="qr-pg">${q.progress.max ? `${q.progress.cur} / ${q.progress.max}` : `第 ${q.progress.cur} 步`}</span>` : ''}</div>
              ${q.progress && q.progress.max ? `<div class="qr-pbar"><i style="width:${clamp2(q.progress.cur / q.progress.max * 100)}%"></i></div>` : ''}
              ${q.objective ? `<div class="qr-obj">${esc(q.objective)}</div>` : ''}
              ${q.reward ? `<div class="qr-rw">报酬：${esc(q.reward)}</div>` : ''}
            </div>
            <div class="qr-act">
              <span class="qr-st ${stCls(q.status)}">${esc(q.status)}</span>
              <div class="qr-btns">
                ${q.status === '进行中'
        ? `<button class="qr-btn ok" data-qdone="${esc(q.name)}" title="正文里已经做完了，但 AI 没上报？点这里自己标">✓ 完成</button>
                   <button class="qr-btn no" data-qfail="${esc(q.name)}" title="放弃或失败了">✕ 失败</button>`
        : `<button class="qr-btn" data-qredo="${esc(q.name)}" title="标错了，改回进行中">↺ 改回进行中</button>`}
              </div>
            </div>
          </div>`).join('') : '<div class="empty">还没有任务。进入副本后，会有人给你派活。</div>'}
      </div>

      <div class="field">
        <label>已结识的人物（${npcs.length}）</label>
        <div class="desc" style="margin-bottom:10px">
          好感度会真实影响判定：这个世界里好感最高的人如果到「信任」以上，
          你的所有判定 +1；到「生死之交」+2。反过来，死敌会让你 −2。
        </div>
        ${npcs.length ? npcs.map(n => {
      const [tn, tc] = FAV(n.favor || 0);
      return `<div class="npc-row" style="--fc:${tc}">
            <div class="nr-body">
              <div class="nr-nm">${esc(n.name)}<span class="nr-id">${esc(n.identity || '身份不明')} · ${esc(n.role || '中立')}</span></div>
              ${n.note ? `<div class="nr-note">${esc(n.note)}</div>` : ''}
            </div>
            <div class="nr-fav">
              <b style="color:${tc}">${n.favor > 0 ? '+' : ''}${n.favor || 0}</b>
              <span style="color:${tc}">${tn}</span>
              <div class="fav-bar"><i style="width:${clamp2((n.favor + 100) / 2)}%;background:${tc}"></i></div>
            </div>
          </div>`;
    }).join('') : '<div class="empty">还没遇到值得记住的人。多跟人说话、帮忙、或者得罪人。</div>'}
      </div>`,
    footer: `<button class="btn ghost" onclick="UI.closeModal()">关闭</button>
             <button class="btn ghost" onclick="UI.closeModal();UI.openCodex()">📇 人物名录</button>`,
  });
};

/* ══════════════════════════════════════════════════════════════════════
   七、人物名录（主从布局，参考《仙途》的人物面板）
   ══════════════════════════════════════════════════════════════════════ */
const FAV = v => v >= 80 ? ['生死之交', '#ff5ec7'] : v >= 50 ? ['信任', '#3ddc84']
  : v >= 20 ? ['友善', '#4ea1ff'] : v >= -19 ? ['中立', '#9aa0b5']
    : v >= -49 ? ['戒备', '#ff9f43'] : v >= -79 ? ['敌视', '#ff5f6d'] : ['死敌', '#ff2d55'];
const clamp2 = v => Math.max(0, Math.min(100, Number(v) || 0));

/** 人物头像：取名字第一个字，颜色由名字哈希决定 */
function npcAvatar(name) {
  const palette = ['#7c5cff', '#4ea1ff', '#3ddc84', '#ff9f43', '#ff5f6d', '#ff5ec7', '#22d3c5', '#c084fc'];
  let h = 0;
  for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const color = palette[h % palette.length];
  return { ch: String(name || '?').trim()[0] || '?', color };
}

/** 档案完整度：让玩家知道「还不了解这个人」 */
function npcCompleteness(n) {
  const fields = ['identity', 'gender', 'age', 'race', 'faction', 'appearance', 'voice', 'demeanor'];
  const filled = fields.filter(k => n[k]).length;
  return Math.round(((filled + ((n.traits || []).length ? 1 : 0) + ((n.relations || []).length ? 1 : 0))
    / (fields.length + 2)) * 100);
}

UI._codex = { sel: null, q: '', tab: '概况', filter: 'all', sort: 'favor' };

UI.openCodex = function () {
  const s = Game.state;
  if (!s) return;
  const ws = s.worldState || { npcs: [] };
  const all = ws.npcs || [];
  const st = UI._codex;

  if (!st.sel || !all.some(n => n.name === st.sel)) {
    st.sel = all.length ? [...all].sort((a, b) => b.favor - a.favor)[0].name : null;
  }
  const cur = all.find(n => n.name === st.sel) || null;

  let list = all.slice();
  if (st.q) list = list.filter(n => n.name.includes(st.q) || (n.identity || '').includes(st.q)
    || (n.traits || []).some(t => t.includes(st.q)));
  if (st.filter === 'star') list = list.filter(n => n.starred);
  if (st.filter === 'ally') list = list.filter(n => (n.favor || 0) >= 20);
  if (st.filter === 'enemy') list = list.filter(n => (n.favor || 0) <= -20);
  list.sort((a, b) => st.sort === 'name'
    ? a.name.localeCompare(b.name, 'zh')
    : (b.favor || 0) - (a.favor || 0));

  const tabBtn = (t) => `<button class="tab ${st.tab === t ? 'on' : ''}" data-ctab="${t}">${t}${
    t === '记忆' && cur?.memories?.length ? `<i>${cur.memories.length}</i>` : ''}</button>`;

  const detail = cur ? (() => {
    const [tn, tc] = FAV(cur.favor || 0);
    const av = npcAvatar(cur.name);
    const pct = npcCompleteness(cur);

    // 关系标签：AI 按剧情自己写的自由文本（老婆 / 仇敌 / 债主…）。
    // 按语义给个颜色，让玩家一眼看出这个人是敌是友 —— 但**不做白名单**，
    // 认不出来的标签就按中性色显示。
    const relColor = t => {
      if (/老婆|妻子|丈夫|老公|恋人|情侣|未婚|伴侣|对象|男友|女友|爱人/.test(t)) return 'rel-love';
      if (/仇敌|死敌|敌人|宿敌|仇人|追杀|叛徒|死对头/.test(t)) return 'rel-foe';
      if (/兄弟|姐妹|朋友|挚友|同伴|搭档|战友|恩人|救命/.test(t)) return 'rel-friend';
      if (/债主|欠|契约|雇主|下属|上司|师父|老师|徒弟|学生/.test(t)) return 'rel-bond';
      return 'rel-plain';
    };
    const tags = Array.isArray(cur.tags) ? cur.tags.filter(Boolean) : [];
    const tagBar = tags.length
      ? `<div class="rel-tags">${tags.map(t => `<span class="rel-tag ${relColor(t)}">${esc(t)}</span>`).join('')}</div>`
      : '';

    let body = '';
    if (st.tab === '概况') {
      const row = (k, v) => v ? `<div class="cd-row"><span>${k}</span><b>${esc(v)}</b></div>` : '';
      body = `
        ${tagBar}
        ${row('身份', cur.identity)}
        ${row('立场', cur.role)}
        ${row('性别', cur.gender)}
        ${row('年龄', cur.age)}
        ${row('种族', cur.race)}
        ${row('势力', cur.faction)}
        ${row('所在', cur.location)}
        ${row('状态', cur.status)}
        ${cur.appearance ? `<div class="cd-block"><h4>外貌</h4><p>${esc(cur.appearance)}</p></div>` : ''}
        ${cur.origin ? `<div class="cd-block"><h4>与你的渊源</h4><p>${esc(cur.origin)}</p></div>` : ''}
        ${cur.note ? `<div class="cd-block"><h4>性格</h4><p>${esc(cur.note)}</p></div>` : ''}
        ${(cur.traits || []).length ? `<div class="cd-block"><h4>性格标签</h4>
          <div class="chips">${cur.traits.map(t => `<span class="chip">${esc(t)}</span>`).join('')}</div></div>` : ''}
        ${cur.demeanor ? `<div class="cd-block"><h4>此刻 · 神态</h4><p>${esc(cur.demeanor)}</p></div>` : ''}
        ${cur.mindset ? `<div class="cd-block"><h4>此刻 · 心态</h4><p>${esc(cur.mindset)}</p></div>` : ''}
        ${cur.voice ? `<div class="cd-block"><h4>说话风格</h4><p>${esc(cur.voice)}</p></div>` : ''}
        ${cur.favorHint ? `<div class="cd-block"><h4>怎么讨他欢心</h4><p>${esc(cur.favorHint)}</p></div>` : ''}
        ${pct < 60 ? `<div class="cd-hint">档案完整度 ${pct}% —— 多跟他打交道，系统会补全他的资料。</div>` : ''}`;
    } else if (st.tab === '关系') {
      const rel = cur.relations || [];
      const others = all.filter(n => n.name !== cur.name);
      body = rel.length ? rel.map(r => {
        const o = all.find(n => n.name === r.name);
        const [otn, otc] = o ? FAV(o.favor || 0) : ['', 'var(--muted)'];
        const oav = npcAvatar(r.name);
        return `<div class="rel-row">
          <span class="rel-av" style="background:${oav.color}22;color:${oav.color};border-color:${oav.color}55">${esc(oav.ch)}</span>
          <div class="rel-body">
            <div class="rel-nm">${esc(r.name)}${o ? `<i>${esc(o.identity || '')}</i>` : '<i style="color:var(--muted)">（还没见过）</i>'}</div>
            <div class="rel-lb">${esc(r.label || '关系未明')}</div>
          </div>
          ${o ? `<span class="rel-fav" style="color:${otc}">${o.favor > 0 ? '+' : ''}${o.favor}</span>` : ''}
        </div>`;
      }).join('') : '<div class="empty">还不知道他和其他人是什么关系。</div>';
      if (others.length) {
        body += `<div class="cd-block" style="margin-top:14px"><h4>这个世界里的其他人</h4>
          <div class="desc">${others.map(o => esc(o.name)).join('、')}</div></div>`;
      }
    } else if (st.tab === '记忆') {
      const mem = (cur.memories || []).slice().reverse();
      body = mem.length ? mem.map(m =>
        `<div class="mem-row"><span class="mem-turn">第 ${m.turn} 回合</span><p>${esc(m.text)}</p></div>`).join('')
        : '<div class="empty">还没有值得记住的事。多跟他打交道。</div>';
    }

    return `
      <div class="cd-head">
        <span class="cd-av" style="background:${av.color}22;color:${av.color};border-color:${av.color}66">${esc(av.ch)}</span>
        <div class="cd-title">
          <div class="cd-name">${esc(cur.name)}</div>
          <div class="cd-sub">${esc(cur.identity || '身份不明')}${cur.role ? ` · ${esc(cur.role)}` : ''}</div>
        </div>
        <button class="star ${cur.starred ? 'on' : ''}" data-star="${esc(cur.name)}" title="关注">${cur.starred ? '★' : '☆'}</button>
      </div>
      <div class="cd-fav">
        <span style="color:${tc}">好感 · ${tn}</span>
        <div class="fav-bar" style="flex:1"><i style="width:${clamp2((cur.favor + 100) / 2)}%;background:${tc}"></i></div>
        <b style="color:${tc}">${cur.favor > 0 ? '+' : ''}${cur.favor || 0}</b>
      </div>
      <div class="tabs" style="margin:12px 0 14px">
        ${tabBtn('概况')}${tabBtn('关系')}${tabBtn('记忆')}
      </div>
      <div class="cd-body">${body}</div>`;
  })() : '<div class="empty" style="padding:40px;text-align:center">还没有遇到值得记住的人。<br><br>进入副本、跟人说话、帮忙或者得罪人，这里就会填满。</div>';

  UI.openModal({
    title: `人物名录 · ${s.clockText || ''}`,
    wide: true,
    body: `
      <div class="codex">
        <div class="codex-list">
          <div class="codex-tools">
            <input type="text" id="cxQ" placeholder="搜索名字 / 身份 / 标签" value="${esc(st.q)}" />
          </div>
          <div class="tabs sub" style="margin-bottom:6px">
            <button class="tab ${st.filter === 'all' ? 'on' : ''}" data-cf="all">全部 ${all.length}</button>
            <button class="tab ${st.filter === 'star' ? 'on' : ''}" data-cf="star">关注 ${all.filter(n => n.starred).length}</button>
            <button class="tab ${st.filter === 'ally' ? 'on' : ''}" data-cf="ally">友善</button>
            <button class="tab ${st.filter === 'enemy' ? 'on' : ''}" data-cf="enemy">敌对</button>
            <span class="grow"></span>
            <button class="tab" data-csort="${st.sort === 'favor' ? 'name' : 'favor'}">${st.sort === 'favor' ? '按好感' : '按姓名'}</button>
          </div>
          <div class="codex-scroll">
            ${list.map(n => {
      const [tn2, tc2] = FAV(n.favor || 0);
      const av2 = npcAvatar(n.name);
      return `<div class="codex-item ${n.name === st.sel ? 'on' : ''}" data-npc="${esc(n.name)}">
                <span class="ci-av" style="background:${av2.color}22;color:${av2.color};border-color:${av2.color}55">${esc(av2.ch)}</span>
                <div class="ci-body">
                  <div class="ci-nm">${esc(n.name)}</div>
                  <div class="ci-sub">${esc(n.identity || '身份不明')} · <span style="color:${tc2}">${tn2}</span></div>
                  <div class="fav-bar"><i style="width:${clamp2((n.favor + 100) / 2)}%;background:${tc2}"></i></div>
                </div>
                ${n.starred ? '<span class="ci-star">★</span>' : ''}
              </div>`;
    }).join('') || '<div class="empty" style="padding:20px;text-align:center">没有符合条件的人</div>'}
          </div>
        </div>
        <div class="codex-detail">${detail}</div>
      </div>`,
    footer: `<button class="btn ghost" onclick="UI.closeModal()">关闭</button>
             <button class="btn ghost" onclick="UI.closeModal();UI.openQuests()">📋 任务</button>
             ${st.sel ? `<span class="grow"></span>
               <button class="btn ghost" onclick="UI.exportText('npc','${esc(st.sel).replace(/'/g, '&#39;')}','人物卡已导出')">⬇ 导出人物</button>
               <button class="btn ghost" onclick="UI.exportText('memory','${esc(st.sel).replace(/'/g, '&#39;')}','记忆档案已导出')">⬇ 导出记忆</button>
               <button class="btn" onclick="UI.exportText('novel',null,'小说已导出')">📖 导出为小说</button>` : ''}`,
    onMount: ov => {

      const redraw = () => UI.openCodex();
      ov.querySelectorAll('[data-npc]').forEach(el => el.onclick = () => {
        UI._codex.sel = el.dataset.npc; UI._codex.tab = '概况'; redraw();
      });
      ov.querySelectorAll('[data-ctab]').forEach(el => el.onclick = () => { UI._codex.tab = el.dataset.ctab; redraw(); });
      ov.querySelectorAll('[data-cf]').forEach(el => el.onclick = () => { UI._codex.filter = el.dataset.cf; redraw(); });
      ov.querySelectorAll('[data-csort]').forEach(el => el.onclick = () => { UI._codex.sort = el.dataset.csort; redraw(); });
      const star = ov.querySelector('[data-star]');
      if (star) star.onclick = async () => {
        const name = star.dataset.star;
        const n = (Game.state.worldState?.npcs || []).find(x => x.name === name);
        if (!n) return;
        const next = !n.starred;
        n.starred = next;                       // 先本地翻转，界面立刻响应
        redraw();
        try {
          const st = await Backend.patchNpc(Game.saveId, name, { starred: next }, Game.state);
          if (st) Game.state = { ...Game.state, ...st, messages: undefined };
        } catch (e) {
          n.starred = !next;                    // 失败就回滚
          toast(e.message, 'err');
          UI.openCodex();
        }
      };
      const q = ov.querySelector('#cxQ');
      if (q) {
        q.oninput = () => {
          UI._codex.q = q.value;
          clearTimeout(UI._cxTimer);
          UI._cxTimer = setTimeout(() => {
            const pos = q.selectionStart; redraw();
            const again = document.querySelector('#cxQ');
            if (again) { again.focus(); again.setSelectionRange(pos, pos); }
          }, 260);
        };
      }
    },
  });
};

window.UI = UI;

/* ══════════════════════════════════════════════════════════════════════
   任务标记：事件委托
   为什么不用 onMount 逐个绑：那样一旦某个面板忘了写 onMount，
   按钮就会「渲染出来但点了没反应」—— 而且完全静默，最难查的一类 bug。
   挂在 document 上就忘不掉了，之后新加的任务按钮也自动生效。
   ══════════════════════════════════════════════════════════════════════ */
document.addEventListener('click', async e => {
  const b = e.target.closest?.('[data-qdone],[data-qfail],[data-qredo]');
  if (!b) return;
  const name = b.dataset.qdone || b.dataset.qfail || b.dataset.qredo;
  const status = b.hasAttribute('data-qdone') ? '已完成'
    : b.hasAttribute('data-qfail') ? '已失败' : '进行中';
  if (!name || !Game.saveId) return;
  e.preventDefault();
  e.stopPropagation();
  b.disabled = true;
  try {
    const r = await Backend.setQuest(Game.saveId, name, status, Game.state);
    if (r) Game.state = { ...Game.state, ...r, messages: undefined };
    toast(`「${name}」已标记为${status}`, 'ok');
    if (document.querySelector('.overlay')) UI.openQuests();
    else renderState(Game.state);
  } catch (err) {
    toast(err.message, 'err');
    b.disabled = false;
  }
});
