/* ══════════════════════════════════════════════════════════════════════
   都市无限流 · 主神空间 —— 前端
   ──────────────────────────────────────────────────────────────────────
   两种运行模式，同一份代码：
     · 服务端模式：检测到 /api/health 时启用。存档在服务器，多端同步，
       离线剧本引擎可用，API Key 保存在服务器（更安全）。
     · 纯前端模式：把 public/ 丢到任意静态托管就能玩。存档在浏览器
       localStorage，直接调厂商接口（Key 存在本地，注意别放公开站点）。
   ══════════════════════════════════════════════════════════════════════ */
'use strict';

/* ═══════════════ 0. 小工具 ═══════════════ */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const toInt = v => { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : 0; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const nowISO = () => new Date().toISOString();
const uid = () => {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = ''; for (let i = 0; i < 8; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
};
const fmtTime = iso => {
  if (!iso) return '';
  const d = new Date(iso); if (isNaN(d)) return '';
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

function toast(msg, type = 'info', ms = 2600) {
  const colors = { info: '#9a9ab2', ok: '#3ddc84', err: '#ff5f6d', warn: '#ff9f43' };
  const d = document.createElement('div');
  d.style.cssText = `pointer-events:auto;padding:9px 16px;border-radius:9px;font-size:12.5px;
    background:#14141f;border:1px solid ${colors[type] || colors.info}55;color:${colors[type] || colors.info};
    box-shadow:0 8px 26px rgba(0,0,0,.5);animation:fade .18s ease-out;max-width:78vw;`;
  d.textContent = msg;
  $('toastRoot').appendChild(d);
  setTimeout(() => { d.style.transition = 'opacity .3s'; d.style.opacity = '0'; setTimeout(() => d.remove(), 320); }, ms);
}

/** 有些接口无视 stream:false 仍然返回 SSE，两种格式都解析 */
function parseAnyReply(text, contentType = '') {
  if (contentType.includes('event-stream') || /^\s*data:/.test(text)) {
    let out = '';
    for (const line of text.split('\n')) {
      const l = line.trim();
      if (!l.startsWith('data:')) continue;
      const d = l.slice(5).trim();
      if (!d || d === '[DONE]') continue;
      try {
        const o = JSON.parse(d);
        out += o.choices?.[0]?.delta?.content ?? o.choices?.[0]?.message?.content ?? '';
      } catch { /* 跳过坏行 */ }
    }
    return out;
  }
  try {
    const o = JSON.parse(text);
    return o.choices?.[0]?.message?.content ?? o.choices?.[0]?.text ?? '';
  } catch { return text.slice(0, 120); }
}

/** 判定结果卡片：插在 GM 叙事气泡的前面 */
function insertCheckCard(bodyEl, c) {
  const wrap = bodyEl.parentElement;
  if (!wrap || !c) return;
  const el = document.createElement('div');
  el.className = `check-card tone-${c.tone || 'ok'}`;
  el.innerHTML =
    `<span class="ck-label">${esc(c.label)}检定</span>` +
    `<span class="ck-die">d20 <b>${c.die}</b></span>` +
    `<span class="ck-mod">修正 ${c.mod >= 0 ? '+' : ''}${c.mod}</span>` +
    `<span class="ck-total">= ${c.total}</span>` +
    `<span class="ck-dc">DC ${c.dc}</span>` +
    `<span class="ck-out">${esc(c.outcome)}</span>`;
  wrap.insertBefore(el, bodyEl);
}

/* ═══════════════ 0b. 游戏数据包（由 server.mjs 生成，静态托管也带着） ═══════════════ */
async function loadGameData() {
  if (!window.GAME_DATA) {
    try {
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = './gamedata.js';
        s.onload = res;
        s.onerror = () => rej(new Error('gamedata.js 加载失败'));
        document.head.appendChild(s);
      });
    } catch { /* 下面统一提示 */ }
  }
  const d = window.GAME_DATA;
  if (!d) {
    console.error('gamedata.js 缺失');
    toast('游戏数据（gamedata.js）没找到。用 start.bat 启动服务器会自动生成它；静态托管时需要把它一起上传。', 'err', 12000);
    return null;
  }
  // 大纲给纯前端模式的提示词用
  if (d.outline) window.GAME_OUTLINE = d.outline;
  // 防御：老版本 gamedata.js 里 difficulties 是对象而不是数组，会直接把建号向导搞崩
  if (d.difficulties && !Array.isArray(d.difficulties)) {
    d.difficulties = Object.values(d.difficulties);
  }
  for (const k of ['origins', 'talents', 'attrs', 'equipment', 'equipSlots']) {
    if (d[k] && !Array.isArray(d[k])) d[k] = Object.values(d[k]);
  }
  // 世界书在后台慢慢拉（不阻塞首页渲染）；真正要用的时候 turnLocal 会 await 它
  ensureWorldBooks();
  return d;
}

/** 按需加载一个全局数据包脚本 */
function loadScriptOnce(src, globalName) {
  if (window[globalName]) return Promise.resolve(window[globalName]);
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => res(window[globalName]);
    s.onerror = () => rej(new Error(src + ' 加载失败'));
    document.head.appendChild(s);
  });
}

/** 人物档案包已经没有了（世界系统被移除）——保留一个空实现，防止旧代码调用时报错 */
const loadWorldcast = () => Promise.resolve({});

/* ═══════════════ 1. 厂商预设（纯前端模式的兜底） ═══════════════ */const PROVIDERS = {
  offline: { label: '离线剧本引擎（不需要 API）', baseUrl: '', model: 'offline', needsKey: false },
  // 不是真厂商：走同源的 /api/relay，由网站自己的服务器转发（分享给别人时用）
  host: { label: '本网站自带的接口（推荐）', baseUrl: '', model: 'host', needsKey: false },
  deepseek: { label: 'DeepSeek 官方', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', models: ['deepseek-chat', 'deepseek-reasoner'], needsKey: true },
  openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', models: ['gpt-4o-mini', 'gpt-4o'], needsKey: true },
  gemini: { label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.0-flash', models: ['gemini-2.0-flash', 'gemini-2.5-flash'], needsKey: true },
  moonshot: { label: '月之暗面 Kimi', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k', models: ['moonshot-v1-8k', 'moonshot-v1-32k'], needsKey: true },
  dashscope: { label: '阿里通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', models: ['qwen-plus', 'qwen-max'], needsKey: true },
  zhipu: { label: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', models: ['glm-4-flash', 'glm-4-plus'], needsKey: true },
  siliconflow: { label: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen2.5-7B-Instruct', models: ['Qwen/Qwen2.5-7B-Instruct', 'deepseek-ai/DeepSeek-V3'], needsKey: true },
  openrouter: { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'deepseek/deepseek-chat', models: ['deepseek/deepseek-chat'], needsKey: true },
  ollama: { label: 'Ollama 本地模型', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen2.5:7b', needsKey: false },
  lmstudio: { label: 'LM Studio 本地模型', baseUrl: 'http://127.0.0.1:1234/v1', model: 'local-model', needsKey: false },
  custom: { label: '自定义（OpenAI 兼容）', baseUrl: '', model: '', needsKey: false },
};

const FALLBACK_GM = `你是「主神空间」的文字冒险游戏主持人（Game Master），用沉浸式的中文叙事带领玩家经历现代都市中的无限流副本。
世界观：现代都市的暗面——深夜地铁、24 小时便利店、旧写字楼、城中村、天台，藏着无数「副本」。玩家被「主神」选中，进入灰雾弥漫的主神空间接受任务。主神空间是唯一的安全区，可兑换补给、疗伤、接取下一个副本。
副本难度 F（最易）→ E → D → C → B → A → S（最难）。完成副本 +50~+500 积分，失败 -20~-200，死亡复活 -300。
规则：HP 初始 100，归零死亡；体力 初始 100，归零疯狂；积分可兑换技能与道具。
叙事要求：
1. 中文创作，沉浸、有画面感，善用气味、声音、温度、触感等感官细节。
2. 每次 250-450 字，段落之间空一行。
3. 不要替玩家做决定，只描述世界与 NPC 的反应。
4. NPC 说话要符合身份，诡异存在说话断续、不合语法。
5. 恐怖来自「规律被打破」和「日常里的不对劲」，不做无意义猎奇。
6. 每次回复正文开头先输出一行状态：【积分:100 | HP:100 | 体力:100】。
7. 末尾给出 3-5 个数字选项，每行一个，格式严格为：[1] 选项内容
8. 每完成一个副本要做一次明确结算并报出积分变化。`;

const STATE_PROTOCOL = `
[状态协议 · 必须严格遵守]
每次回复的最末尾，必须输出一个状态结算块，格式如下（不要加代码围栏、不要加注释）：

<<<STATE
{"score":0,"hp":0,"sta":0,"items":[],"skills":[],"flags":{},"dungeon":null,"note":"一句话小结"}
STATE>>>

只写发生变化的字段：
- score / hp / sta：本次变化量，整数（受伤为负，治疗为正，没变化写 0）
- items：[{"name":"道具名","qty":1,"desc":"一句话作用"}]，qty 为负表示消耗
- skills：[{"name":"技能名","desc":"一句话作用"}]
- flags：{"剧情标记":"值"}
- dungeon：无副本写 null，有副本写 {"name":"副本名","rank":"F|E|D|C|B|A|S","status":"接取中|进行中|已结算","progress":0到100}
- note：给玩家看的一句话结算

状态块之外的正文会完整展示给玩家，状态块本身不会显示。数值必须与正文描述一致。`;

/* ═══════════════ 2. 状态结算（与服务端同规则） ═══════════════ */
function visibleFlags(s) {
  return Object.fromEntries(Object.entries(s || {}).filter(([k]) => !k.startsWith('__')));
}

function applyDelta(save, d) {
  const events = [];
  if (!d || typeof d !== 'object') return events;
  if (d.score) save.score = Math.max(0, save.score + toInt(d.score));
  if (d.hp) save.hp = clamp(save.hp + toInt(d.hp), 0, save.maxHp);
  if (d.sta) save.sta = clamp(save.sta + toInt(d.sta), 0, save.maxSta);
  if (d.permanent) {
    if (d.permanent.maxHp) { save.baseHp = (save.baseHp ?? 100) + toInt(d.permanent.maxHp); events.push(`HP 上限 +${d.permanent.maxHp}`); }
    if (d.permanent.maxSta) { save.baseSta = (save.baseSta ?? 100) + toInt(d.permanent.maxSta); events.push(`体力 上限 +${d.permanent.maxSta}`); }
  }

  for (const it of [].concat(d.items || [])) {
    if (!it || !it.name) continue;
    // ⚠ 人名 / 结构性字段名不是道具。模型会把 npcs 名单里的人当掉落物报上来，
    //   也报过「好感度更新」「剧情标记」这种状态块的键（实测它们进了背包）。
    if (localNotAnItem(it.name, save)) continue;
    const qty = toInt(it.qty) || 1;
    // 名字里的「×1」要剥掉，否则「杜蕾斯」和「杜蕾斯 ×1」会并存两条
    const cleanName = localCleanItemName(it.name) || it.name;
    const ex = save.inventory.find(x => x.name === cleanName);
    if (ex) {
      ex.qty += qty;
      if (ex.qty <= 0) save.inventory = save.inventory.filter(x => x !== ex);
    } else if (qty > 0) {
      // ⚠ 以前这里只塞 { name, qty, desc } —— slot / rarity / stats 全丢，
      //   于是网页版捡到的装备没有栏位、没有数值，等于装不上。
      //   现在走 localGrantItem（和服务端 grantItem 同规则）。
      save.inventory.push(localGrantItem(save, { ...it, name: cleanName }, qty));
    }
    events.push(`${qty > 0 ? '获得' : '失去'}道具「${cleanName}」`);
  }
  // 技能 / 血统：模型常把加成只写在 desc 里，这里解析成真字段，否则被动加成会被吞掉。
  // 去重按归一化名字 —— 模型换个括号写法重复报同一个血统时不能算两遍。
  const addPower = (raw, isBlood) => {
    if (!raw || !raw.name) return;
    // 用归一化名字查表：模型可能把血统写成技能
    const def = localItemByLooseName(raw.name);
    const blood = def ? def.slot === 'bloodline' : isBlood;
    const list = blood ? (save.bloodlines ||= []) : (save.skills ||= []);
    if (list.some(x => localSamePower(x, raw))) return;
    const stats = localParseStatText(`${raw.desc || ''} ${raw.effect || ''}`);
    if (def) {
      list.push({ id: def.id, name: def.name, desc: def.desc, rarity: def.rarity, stats: def.stats });
    } else {
      list.push({
        id: `x_${raw.name}`, name: String(raw.name), desc: String(raw.desc || ''),
        stats: Object.keys(stats).length ? stats : undefined, source: 'story',
      });
    }
    events.push(`${blood ? '获得血统' : '习得技能'}「${raw.name}」`
      + (Object.keys(stats).length ? `（${Object.entries(stats).map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${v}`).join('　')}）` : ''));
  };
  for (const sk of [].concat(d.skills || [])) addPower(sk, false);
  for (const bl of [].concat(d.bloodlines || [])) addPower(bl, true);
  if (d.flags && typeof d.flags === 'object') save.flags = { ...save.flags, ...d.flags };

  // 世界进度 / 人物好感 / 任务
  // 角色只允许这几个值 —— 模型有时会回「NPC」这种没信息量的东西
  const NPC_ROLES = ['引导者', '盟友', '对手', '中立', '潜在敌人', '关键人物'];
  const normRole = v => NPC_ROLES.find(r => String(v || '').includes(r)) || null;
  if (d.npcs || d.quests || d.world) {
    save.life ??= { quests: [], npcs: [], faction: '' };
    const ws = save.life;
    ws.quests ??= []; ws.npcs ??= [];
    if (d.world && typeof d.world === 'object' && d.world.faction !== undefined) {
      ws.faction = String(d.world.faction || '');
    }
    for (const n of [].concat(d.npcs || [])) {
      if (!n?.name) continue;
      let cur = ws.npcs.find(x => x.name === n.name);
      if (!cur) {
        cur = { name: n.name, identity: '', role: '中立', favor: 0, status: '在世', note: '', memories: [] };
        // 归属：现实生活里认识的是 'reality'，任务世界里认识的是那个作品 —— 他不能追到现实来
        cur.realm = save.phase === 'mission' ? (save.mission?.work || '任务世界') : 'reality';
        ws.npcs.push(cur); events.push(`结识了「${n.name}」`);
      }
      if (n.identity) cur.identity = n.identity;
      const role = normRole(n.role); if (role) cur.role = role;
      if (n.note) cur.note = n.note;
      // 外貌 / 说话风格：
      //   · 原著人物 → **世界书说了算，AI 不许改**（否则春丽会被写成「紫色眼眸、湿透的头发」）
      //   · 其他人物 → 存下来，人物卡上才有东西看（以前这里根本不存，卡上永远是空的）
      if (!cur.canon) {
        for (const k of ['appearance', 'voice', 'gender', 'age', 'race', 'demeanor']) {
          const v = n[k] === undefined || n[k] === null ? '' : String(n[k]).trim();
          if (v) cur[k] = v;
        }
      }
      if (n.favor !== undefined && n.favor !== null && n.favor !== '') {
        const b = cur.favor;
        let target = clamp(toInt(n.favor), -100, 100);
        // 魅力决定好感涨得多快
        if (target > b) target = Math.min(100, Math.round(b + (target - b) * localFavorMult(save)));
        cur.favor = target;
        if (cur.favor !== b) events.push(`「${n.name}」好感 → ${cur.favor}`);
      }
      if (n.favorDelta) { cur.favor = clamp(cur.favor + toInt(n.favorDelta), -100, 100); events.push(`「${n.name}」好感 ${n.favorDelta > 0 ? '+' : ''}${n.favorDelta}`); }
      // 关系阶段已删除（跟服务端同步）：模型还在报 romance 就直接忽略，顺手清掉旧字段
      if (cur.romance !== undefined) delete cur.romance;
      if (cur.romanceable !== undefined) delete cur.romanceable;
      const mem = n.memory || n.memories;
      for (const t of [].concat(mem || [])) {
        const text = String(t || '').trim();
        if (!text || (cur.memories || []).some(m => m.text === text)) continue;
        cur.memories.push({ turn: save.turn || 0, text });
        if (cur.memories.length > 40) cur.memories = cur.memories.slice(-40);
        events.push(`【记忆】${cur.name}：${text}`);
      }
    }
    // 现实生活里不记任务：界面右下角会挂一个「📋 任务」，玩家会以为主神又派活了。
    // （和服务端 R.applyWorldDelta 的规则保持一致）
    const questAllowed = save.phase !== 'life';
    for (const q of [].concat(d.quests || [])) {
      if (!q?.name) continue;
      let cur = ws.quests.find(x => x.name === q.name);
      if (!cur) {
        if (!questAllowed) { events.push('（现实里不记任务：想做的事写进正文或 flags 就行）'); continue; }
        cur = { name: q.name, type: '支线', objective: '', status: '进行中', reward: '' };
        ws.quests.push(cur);
        events.push(`【新任务】${q.name}`);
      }
      if (q.type) cur.type = /主/.test(String(q.type)) ? '主线' : '支线';
      if (q.objective) cur.objective = q.objective;
      if (q.reward) cur.reward = q.reward;
      if (q.status) {
        const st = /完成|已结算/.test(String(q.status)) ? '已完成' : /失败|放弃/.test(String(q.status)) ? '已失败' : '进行中';
        if (st !== cur.status) { cur.status = st; events.push(`任务「${cur.name}」${st}`); }
      }
    }
  }
  if (d.dungeon !== undefined) {
    if (d.dungeon && typeof d.dungeon === 'object' && d.dungeon.name) {
      save.dungeon = {
        name: String(d.dungeon.name),
        rank: String(d.dungeon.rank || save.dungeon?.rank || 'F'),
        status: String(d.dungeon.status || '进行中'),
        progress: clamp(toInt(d.dungeon.progress ?? save.dungeon?.progress ?? 0), 0, 100),
      };
    } else if (d.dungeon === null) save.dungeon = null;
  }
  if (d.note) events.push(String(d.note));

  if (save.hp <= 0 && save.status === 'alive') {
    const t = save.inventory.find(i => i.name === '复活券' && i.qty > 0);
    if (t) {
      t.qty -= 1;
      if (t.qty <= 0) save.inventory = save.inventory.filter(i => i !== t);
      save.hp = 50;
      events.push('【复活券生效】你在灰雾中重新凝聚出形体，HP 恢复至 50。');
    } else {
      save.status = 'dead';
      events.push('【死亡】HP 归零。可支付 300 积分复活，或重开存档。');
    }
  }
  // 体力归零不是发疯，是力竭 —— 人还在，但做什么都吃力
  if (save.sta <= 0 && save.status === 'alive') {
    save.status = 'spent';
    events.push('【力竭】体力归零 —— 先找个地方缓一缓。');
  }
  if (save.status === 'spent' && save.sta > (save.maxSta || 100) * 0.3) {
    save.status = 'alive';
    events.push('【缓过来了】体力回到三成以上。');
  }
  // 这一轮可能刚加了技能 / 血统 → 重算属性与上限。
  // 服务端在同一个位置会调 R.refreshDerived，纯前端模式以前漏了这一步，
  // 结果左侧属性面板还是旧的数字（用户看到的「血统属性没加上」有一部分就是这个）。
  localRefresh(save);
  return events;
}

function heuristicDelta(text) {
  const d = { score: 0, hp: 0, sta: 0, note: '' };
  if (/(受伤|剧痛|流血|被击中|撕裂|骨折)/.test(text)) d.hp = -(8 + Math.floor(Math.random() * 14));
  if (/(诡异|扭曲|不可名状|腐臭|低语|幻觉|疯狂)/.test(text)) d.sta = -(4 + Math.floor(Math.random() * 9));
  if (/(休息|喘息|安全了|平静|松了口气)/.test(text)) { d.sta = 6; d.hp = 4; }
  if (d.hp || d.sta) d.note = `（自动结算：HP ${d.hp >= 0 ? '+' : ''}${d.hp}，体力 ${d.sta >= 0 ? '+' : ''}${d.sta}）`;
  return d;
}

class ProtocolGate {
  constructor(onText) { this.onText = onText; this.marker = '<<<'; this.buf = ''; this.raw = ''; this.closed = false; }
  push(chunk) {
    if (this.closed) { this.raw += chunk; return; }
    this.buf += chunk;
    const i = this.buf.indexOf(this.marker);
    if (i >= 0) {
      const v = this.buf.slice(0, i);
      if (v) { this.raw += v; this.onText(v); }
      this.raw += this.buf.slice(i); this.buf = ''; this.closed = true; return;
    }
    const keep = this.marker.length - 1;
    if (this.buf.length > keep) {
      const cut = this.buf.length - keep;
      const v = this.buf.slice(0, cut);
      this.raw += v; this.onText(v); this.buf = this.buf.slice(cut);
    }
  }
  finish() {
    if (!this.closed && this.buf) { this.raw += this.buf; this.onText(this.buf); this.buf = ''; }
    return this.raw;
  }
}

const tryJSON = t => { try { return JSON.parse(t); } catch { return null; } };

/**
 * 流式过程中把累积的正文画进气泡。
 *
 * ⚠ 以前流式用的是 `body.textContent += chunk`（纯文本），所以对话 / 心理 / 环境
 *   这三类配色只在**刷新页面后**从存档重新渲染时才出现 —— 生成中的文字永远是单色。
 *   现在统一走 formatGm，跟静态渲染同一条路。
 *
 * 为什么要 try/catch：流式文本是**半截**的（可能停在 `<` 里、可能只写了一半的项目符号），
 * formatGm 的替换对不完整的输入是安全的，但万一以后加了新规则就必须保证
 * 一次渲染失败不能打断整个流。
 */
function paintStream(body, text) {
  try {
    body.innerHTML = formatGm(splitOptions(text).body);
  } catch {
    body.textContent = splitOptions(text).body;   // 退回纯文本，至少不丢内容
  }
}

/** 与服务端 extractState 同规则：容错各种不规范的写法 */
function extractState(raw) {
  const open = /<<<\s*STATE/i.exec(raw);
  if (!open) return null;
  let body = raw.slice(open.index + open[0].length);
  const close = /STATE\s*>>>/i.exec(body);
  if (close) body = body.slice(0, close.index);
  body = body.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const direct = tryJSON(body);
  if (direct) return direct;
  const start = body.indexOf('{');
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < body.length; i++) {
    const c = body[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return tryJSON(body.slice(start, i + 1)); }
  }
  return null;
}

const stripState = raw => String(raw)
  .replace(/<<<\s*STATE[\s\S]*?STATE\s*>>>/gi, '')
  .replace(/<<<\s*STATE[\s\S]*$/i, '')
  .replace(/STATE\s*>>>/gi, '')
  .trim();

/* ═══════════════ 3. 存档后端抽象 ═══════════════ */
const LS_KEY = 'mid_saves_v1';
const LS_CFG = 'mid_config_v1';
const LS_CUR = 'mid_current_v1';
// 完整模式下「用自己的 Key 玩」的那份配置（只存这个浏览器，不动服务器）
const LS_CFG_SERVER = 'mid_guest_api_v1';
// 「用这个网站自带的接口」——请求甩给同源的 /api/relay，由服务器转发
const LS_USE_HOST = 'mid_use_host_relay_v1';

const Backend = {
  mode: 'local',          // 'server' | 'local'
  cfg: null,
  providers: PROVIDERS,

  /**
   * 探测有没有本地服务器（决定走完整模式还是网页模式）。
   *
   * ⚠ 必须重试几次：服务器刚启动、或者玩家在服务器还没起来的那一瞬间刷新页面，
   *   一次失败就永久落到网页模式（local），之后每一轮都失败 ——
   *   玩家看到的就是「怎么老失败」，而且刷新也不一定碰得巧。
   *   这里做 3 次探测（间隔递增），能显著减少误判。
   */
  async detect(tries = 3) {
    for (let i = 0; i < tries; i++) {
      try {
        const r = await fetch('./api/health', { cache: 'no-store' });
        if (!r.ok) throw 0;
        const j = await r.json();
        if (!j || !j.ok) throw 0;
        this.mode = 'server';
        return true;
      } catch {
        if (i < tries - 1) await new Promise(res => setTimeout(res, 400 + i * 700));
      }
    }
    this.mode = 'local';
    return false;
  },

  /* ── 配置 ── */

  /**
   * 切回「用服务器上配好的接口」。
   * ⚠ 必须**同时**清 localStorage 和内存里的 this.cfg ——
   *   只清 localStorage 的话，界面上的 provider / baseUrl / apiKey 全都还是旧的那份，
   *   看起来像没生效（这就是「点了开关还是 401」的原因）。
   */
  async useServerApi() {
    try {
      localStorage.removeItem(LS_CFG_SERVER);
      localStorage.removeItem(LS_USE_HOST);
    } catch { /* 隐私模式 */ }
    this._gm = this._gm;   // 不动提示词
    return this.getConfig();
  },

  async getConfig() {
    if (this.mode === 'server') {
      const r = await fetch('./api/config', { cache: 'no-store' });
      const serverCfg = await r.json();
      this.providers = Object.fromEntries((serverCfg.providers || []).map(p => [p.id, p]));

      // ① 这个浏览器自己填过一份 → 直连它（不吃服务器的 Key）。
      //    ⚠ 必须**真的有一把 Key** 才算数。以前只检查 baseUrl + model，
      //    于是「建号向导第 0 步」会把服务器的地址/模型抄进浏览器那份（Key 留空），
      //    存出一个「有地址没 Key」的配置 → guestMode=true → 每次请求都 401 无效的令牌，
      //    而服务器上明明有一把好用的 Key。这是「本地一直 401」的真正原因。
      const guest = JSON.parse(localStorage.getItem(LS_CFG_SERVER) || 'null') || {};
      const LOCAL_NO_KEY = new Set(['ollama', 'lmstudio']);
      const guestReady = Boolean(guest.baseUrl && guest.model
        && (LOCAL_NO_KEY.has(guest.provider) || guest.apiKey));
      if (guestReady) {
        this.guestMode = true;
        this.hostRelay = false;
        this.cfg = {
          ...serverCfg,
          ...guest,
          providerLabel: (PROVIDERS[guest.provider] || {}).label || serverCfg.providerLabel,
          guest: true,
          localGuest: true,
        };
        return this.cfg;
      }

      // ② 没填过自己的 → 用服务器上配好的（localhost 直接调，分享出去时走同源中转）
      const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
      this.guestMode = false;
      this.hostRelay = false;
      this.cfg = {
        ...serverCfg,
        apiKey: '',                  // 绝不把服务器的 Key 交给浏览器
        guest: false,
        localGuest: false,
        // 本机玩 = 走服务器的 /api/turn；分享给别人才需要 /api/relay
        viaRelay: !isLocal,
      };
      return this.cfg;
    }
    // 纯前端模式（静态托管）：如果这个页面上真的躺着一个同源服务器，可以让它中转
    const useHost = localStorage.getItem(LS_USE_HOST) === '1'
      && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
    if (useHost) {
      this.hostRelay = true;
      this.guestMode = false;
      const saved0 = JSON.parse(localStorage.getItem(LS_CFG) || 'null') || {};
      this.providers = PROVIDERS;
      this.cfg = {
        title: '都市无限流：主神空间',
        provider: 'host', providerLabel: '本网站自带的接口（推荐）',
        baseUrl: '', model: 'host', apiKey: '', hasKey: true,
        temperature: saved0.temperature ?? 0.92, maxTokens: saved0.maxTokens ?? 1200,
        historyWindow: saved0.historyWindow ?? 18, isOffline: false, static: false, lanUrls: [],
        hostRelay: true,
      };
      return this.cfg;
    }
    this.hostRelay = false;
    const saved = JSON.parse(localStorage.getItem(LS_CFG) || 'null') || {};
    this.providers = PROVIDERS;
    this.cfg = {
      title: '都市无限流：主神空间',
      provider: saved.provider || 'deepseek',
      providerLabel: (PROVIDERS[saved.provider] || {}).label || '',
      baseUrl: saved.baseUrl || (PROVIDERS[saved.provider] || {}).baseUrl || '',
      model: saved.model || (PROVIDERS[saved.provider] || {}).model || '',
      apiKey: saved.apiKey || '',
      hasKey: Boolean(saved.apiKey),
      temperature: saved.temperature ?? 0.92,
      maxTokens: saved.maxTokens ?? 1200,
      historyWindow: saved.historyWindow ?? 18,
      isOffline: false, static: true,
      lanUrls: [],
    };
    return this.cfg;
  },

  async saveConfig(patch) {
    if (this.mode === 'server') {
      // 玩家在这个浏览器里填了「自己的接口」→ 存本地、直连那家，不吃服务器的 Key。
      // 没填就是普通的「改服务器设置」。
      if (patch && patch.__guest) {
        const { __guest, ...rest } = patch;
        const cur = JSON.parse(localStorage.getItem(LS_CFG_SERVER) || '{}');
        // 只有本机跑的服务（ollama / lmstudio）才允许「不要 Key」。
        // 其余一律必须带 Key —— 一份没有 Key 的配置存下来只会让玩家每次请求都 401，
        // 而服务器上明明有一把能用的 Key。（'custom' 在厂商表里被标成 needsKey:false，
        // 那是给「服务器上的自定义接口」用的，不代表浏览器这份可以不带 Key。）
        const LOCAL_NO_KEY = new Set(['ollama', 'lmstudio']);
        const needsKey = !LOCAL_NO_KEY.has(rest.provider);
        const merged = { ...cur, ...rest, needsKey };
        // 没给 Key 就不当「自己的配置」，把旧的清掉，老老实实用服务器的
        if (needsKey && !merged.apiKey) {
          localStorage.removeItem(LS_CFG_SERVER);
          await this.getConfig();
          return { ok: true, config: this.cfg, guest: false };
        }
        localStorage.setItem(LS_CFG_SERVER, JSON.stringify(merged));
        await this.getConfig();
        return { ok: true, config: this.cfg, guest: true };
      }
      const r = await fetch('./api/config', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || '保存失败');
      this.cfg = j.config;
      return j;
    }
    const cur = JSON.parse(localStorage.getItem(LS_CFG) || '{}');
    const merged = { ...cur, ...patch };
    const pre = PROVIDERS[merged.provider] || {};
    if (patch.provider && !patch.baseUrl) { merged.baseUrl = pre.baseUrl || ''; merged.model = pre.model || ''; }
    localStorage.setItem(LS_CFG, JSON.stringify(merged));
    await this.getConfig();
    return { ok: true, config: this.cfg, test: patch.__test ? await this.test() : null };
  },

  /**
   * 用「还没保存的表单内容」测连通性，不写盘、不改配置。
   * 点一下「测试连接」就顺手把 temperature 之类的改动存下来会很吓人。
   */
  async testWith(patch) {
    if (this.mode === 'server') {
      const r = await fetch('./api/test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch || {}),
      });
      return r.json();
    }
    const saved = this.cfg;
    try {
      const pre = PROVIDERS[patch?.provider] || {};
      this.cfg = {
        ...saved,
        ...patch,
        baseUrl: patch?.baseUrl || pre.baseUrl || '',
        model: patch?.model || pre.model || '',
        apiKey: patch?.apiKey || saved.apiKey || '',
      };
      return await this.test();
    } finally {
      this.cfg = saved;
    }
  },

  async test() {
    if (this.mode === 'server') {
      const r = await fetch('./api/test', { method: 'POST' });
      return r.json();
    }
    const c = this.cfg;
    if (!c.baseUrl) return { ok: false, message: '还没有填写 BaseURL。' };
    const pre = PROVIDERS[c.provider] || {};
    if (pre.needsKey && !c.apiKey) return { ok: false, message: '该厂商需要 API Key。' };
    const t0 = Date.now();
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (c.apiKey) headers.Authorization = `Bearer ${c.apiKey}`;
      const resp = await fetch(c.baseUrl.replace(/\/+$/, '') + '/chat/completions', {
        method: 'POST', headers,
        body: JSON.stringify({ model: c.model, messages: [{ role: 'user', content: '只回复两个字：在线' }], max_tokens: 16 }),
      });
      const txt = await resp.text();
      if (!resp.ok) return { ok: false, message: `HTTP ${resp.status}：${txt.slice(0, 260)}` };
      const reply = parseAnyReply(txt, resp.headers.get('content-type') || '');
      return { ok: true, message: `连接成功（${Date.now() - t0} ms）：${String(reply).trim().slice(0, 50) || '（模型没有返回文本）'}` };
    } catch (e) {
      return { ok: false, message: `连接失败：${e.message}（浏览器直连可能被 CORS 拦截，建议改用本地服务器模式）` };
    }
  },

  async getPrompt() {
    if (this.mode === 'server') {
      const r = await fetch('./api/gm', { cache: 'no-store' });
      return (await r.json()).prompt || '';
    }
    if (!this._gm) {
      const saved = localStorage.getItem('mid_gm_v1');
      if (saved) { this._gm = saved; return this._gm; }
      try {
        const r = await fetch('./game_master.txt', { cache: 'no-store' });
        // 单文件版（所有资源内联成一个 HTML）时没有这个文件，用内联的那份
        if (!r.ok && window.__INLINE_GM) {
          const bin = atob(window.__INLINE_GM);
          const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
          this._gm = new TextDecoder().decode(bytes);
        } else {
          this._gm = r.ok ? await r.text() : FALLBACK_GM;
        }
      } catch { this._gm = FALLBACK_GM; }
    }
    return this._gm;
  },

  async setPrompt(text) {
    if (this.mode === 'server') {
      const r = await fetch('./api/gm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: text }),
      });
      if (!r.ok) throw new Error((await r.json()).error || '保存失败');
      return;
    }
    this._gm = text;
    localStorage.setItem('mid_gm_v1', text);
  },

  async getShop() {
    if (this.mode === 'server') {
      const r = await fetch('./api/shop', { cache: 'no-store' });
      return (await r.json()).items || [];
    }
    return LOCAL_SHOP;
  },

  /* ── 存档 ── */
  _all() { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); },
  _put(save) { const a = this._all(); save.updatedAt = nowISO(); a[save.id] = save; localStorage.setItem(LS_KEY, JSON.stringify(a)); },
  _del(id) { const a = this._all(); delete a[id]; localStorage.setItem(LS_KEY, JSON.stringify(a)); },

  async listSaves() {
    if (this.mode === 'server') {
      const r = await fetch('./api/saves', { cache: 'no-store' });
      return r.json();
    }
    return Object.values(this._all())
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .map(s => ({
        id: s.id, name: s.name, turn: s.turn, score: s.score, hp: s.hp, sta: s.sta,
        status: s.status,
        dungeon: s.dungeon ? `${s.dungeon.name}（${s.dungeon.rank}）` : '主神空间',
        updatedAt: s.updatedAt,
      }));
  },

  async createSave(name) {
    if (this.mode === 'server') {
      const r = await fetch('./api/saves', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const j = await r.json();
      return { state: j.save, messages: [] };
    }
    const s = freshState(name);
    this._put(s);
    return { state: s, messages: [] };
  },

  async loadSave(id) {
    if (this.mode === 'server') {
      const r = await fetch(`./api/saves/${id}`, { cache: 'no-store' });
      if (!r.ok) throw new Error('存档不存在');
      const j = await r.json();
      return { state: j.state, messages: j.messages };
    }
    const s = this._all()[id];
    if (!s) throw new Error('存档不存在');
    return { state: s, messages: s.messages };
  },

  async deleteSave(id) {
    if (this.mode === 'server') { await fetch(`./api/saves/${id}`, { method: 'DELETE' }); return; }
    this._del(id);
  },

  async renameSave(id, name) {
    if (this.mode === 'server') {
      await fetch(`./api/saves/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      return;
    }
    const a = this._all(); if (a[id]) { a[id].name = name; localStorage.setItem(LS_KEY, JSON.stringify(a)); }
  },

  async buy(id, itemId, state) {
    if (this.mode === 'server') {
      const r = await fetch(`./api/saves/${id}/buy`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId }),
      });
      return r.json();
    }
    return localMutation(state, () => localBuy(state, itemId));
  },

  /** 手动改任务状态 —— AI 漏报时的兜底 */
  async setQuest(id, name, status, state) {
    if (this.mode === 'server') {
      const r = await fetch(`./api/saves/${id}/quest`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, status }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || j.msg || '修改失败');
      return j.state;
    }
    const q = ((state.life || state.worldState || {}).quests || [])
      .find(x => x.name === name);
    if (!q) throw new Error('名录里没有这个任务。');
    q.status = status;
    this._put(state);
    return state;
  },

  async useItem(id, itemId, state) {
    if (this.mode === 'server') {
      const r = await fetch(`./api/saves/${id}/use`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId }),
      });
      return r.json();
    }
    return localMutation(state, () => localUse(state, itemId));
  },

  async equip(id, itemId, state) {
    if (this.mode === 'server') {
      const r = await fetch(`./api/saves/${id}/equip`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId }),
      });
      return r.json();
    }
    return localMutation(state, () => localEquip(state, itemId));
  },

  async unequip(id, slot, state) {
    if (this.mode === 'server') {
      const r = await fetch(`./api/saves/${id}/unequip`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slot }),
      });
      return r.json();
    }
    return localMutation(state, () => localUnequip(state, slot));
  },

  async sell(id, itemId, state) {
    if (this.mode === 'server') {
      const r = await fetch(`./api/saves/${id}/sell`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId }),
      });
      return r.json();
    }
    return localMutation(state, () => localSell(state, itemId));
  },

  /** 推进现实时间。分钟为单位；skipToMission=true 时直接快进到任务时刻 */
  async advanceTime(id, minutes, state, skipToMission = false) {
    if (this.mode === 'server') {
      const body = skipToMission ? { skipToMission: true } : { advance: minutes || 1 };
      const r = await fetch(`./api/saves/${id}/time`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || '时间推进失败');
      return j.state;
    }
    localTick(state, skipToMission ? null : (minutes || 1), { skipToMission });
    this._put(state);
    return state;
  },

  /** 重塑：回到上一轮开始前，保留玩家的输入，重跑一次 */
  async reroll(id) {
    if (this.mode === 'server') {
      const r = await fetch(`./api/saves/${id}/reroll`, { method: 'POST' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || '重塑失败');
      return j;
    }
    // 纯前端模式：本地快照
    const s = this._all()[id];
    if (!s) throw new Error('存档不存在。');
    const res = localReroll(s, s.messages || []);
    if (!res.ok) throw new Error(res.msg);
    this._put(s);
    return { ok: true, state: s, messages: res.messages, action: res.action, redrawn: res.redrawn, local: true };
  },

  /** 回退：把上一轮整个删掉，回到那一刻 */
  async undo(id) {
    if (this.mode === 'server') {
      const r = await fetch(`./api/saves/${id}/undo`, { method: 'POST' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || '回退失败');
      return j;
    }
    const s = this._all()[id];
    if (!s) throw new Error('存档不存在。');
    const res = localUndo(s, s.messages || []);
    if (!res.ok) throw new Error(res.msg);
    this._put(s);
    return { ok: true, state: s, messages: s.messages, local: true };
  },

  /** 手动开始 / 结束主神任务 */
  async missionOp(id, action, info, state) {
    if (this.mode === 'server') {
      const r = await fetch(`./api/saves/${id}/mission`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, mission: info || {} }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || '操作失败');
      return j.state;
    }
    if (action === 'end') localEndMission(state);
    else localStartMission(state, info || {});
    this._put(state);
    return state;
  },

  /** 主神空间：leave = 出站回现实 | depart = 推开那扇门进任务世界 */
  async hubOp(id, action, state) {
    if (this.mode === 'server') {
      const r = await fetch(`./api/saves/${id}/hub`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || '操作失败');
      return { state: j.state, msg: j.msg || '' };
    }
    // 纯前端模式：本地复刻一份
    // 纯前端模式：depart 之前先把世界书拉好，这样 seedCanonNpcs 才有的可种
    if (this.mode !== 'server' && action === 'depart') await ensureWorldBooks();
    let msg = '';
    if (action === 'leave') {
      state.phase = 'life';
      state.missionAt = null;
      msg = '出站了，回到现实生活。';
    } else if (action === 'depart') {
      const work = state.pendingWork || '';
      localStartMission(state, {});
      if (work) state.mission = { ...(state.mission || {}), work };
      state.pendingWork = null;
      state.phase = 'mission';
      msg = `门后是《${state.mission?.work || '随机世界'}》。`;
    }
    this._put(state);
    return { state, msg };
  },

  /** 花积分指定下一个去的世界（只在主神空间里能用） */
  async pickWorld(id, work, state) {
    if (this.mode === 'server') {
      const r = await fetch(`./api/saves/${id}/pick_world`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ work }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || j.msg || '指定失败');
      return { state: j.state, msg: j.msg || '' };
    }
    const cost = window.GAME_DATA?.economy?.pickWorldCost ?? 5000;
    const free = state.freeWorldPick === true;      // 首次免费
    if (!free && (state.score || 0) < cost) throw new Error(`指定坐标要 ${cost} 积分，你不够。`);
    if (!free) state.score -= cost;
    state.freeWorldPick = false;
    state.pendingWork = work;
    this._put(state);
    return { state, msg: free ? `主神送你第一次免费指定：下一站锁定《${work}》。` : `花掉 ${cost} 积分，下一站锁定《${work}》。` };
  },

  async patchNpc(id, name, patch, state) {
    if (this.mode === 'server') {
      const r = await fetch(`./api/saves/${id}/npc`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, patch }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || '修改失败');
      return j.state;
    }
    const npc = (state.life?.npcs || []).find(n => n.name === name);
    if (!npc) throw new Error('还没遇到过这个人。');
    Object.assign(npc, patch);
    this._put(state);
    return state;
  },

  async respec(id, attrs, state) {
    if (this.mode === 'server') {
      const r = await fetch(`./api/saves/${id}/respec`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attrs }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || '重塑失败');
      return j.state;
    }
    const d = window.GAME_DATA;
    const total = (d.difficulties.find(x => x.id === state.difficulty) || {}).points || 8;
    let used = 0;
    for (const k of Object.keys(attrs)) used += (attrs[k] || 5) - 5;
    if (used !== total) throw new Error(`属性点要正好分配 ${total} 点。`);
    state.attrs = { ...attrs };
    localRefresh(state);
    this._put(state);
    return state;
  },

  async revive(id, state) {
    if (this.mode === 'server') {
      const r = await fetch(`./api/saves/${id}/revive`, { method: 'POST' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || '复活失败');
      return j.state;
    }
    if (state.score < 300) throw new Error(`积分不足，需要 300 分（当前 ${state.score}）。`);
    state.score -= 300; state.hp = 50; state.sta = Math.max(state.sta, 40); state.status = 'alive';
    state.messages.push({ role: 'system', content: '支付 300 积分复活，HP 恢复至 50。', at: nowISO() });
    this._put(state);
    return state;
  },

  async rest(id, cost, state) {
    if (this.mode === 'server') {
      const r = await fetch(`./api/saves/${id}/rest`, { method: 'POST' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || '恢复失败');
      return j.state;
    }
    if (state.score < cost) throw new Error(`恢复舱需要 ${cost} 积分。`);
    state.score -= cost; state.hp = state.maxHp; state.sta = state.maxSta; state.status = 'alive';
    state.messages.push({ role: 'system', content: `支付 ${cost} 积分进入恢复舱，HP / 体力 全满。`, at: nowISO() });
    this._put(state);
    return state;
  },
};

/* ═══════════════ 3.5 快照（重塑 / 回退） ═══════════════
   纯前端模式以前**没有快照**，所以「重塑」「回退」两个按钮在网页版直接报错，
   只能去用本地服务器。这里把服务端 lib/rules.mjs 那一套原样复刻到浏览器里：
   每轮开始前存一份「这一轮之前」的存档，「回退」= 回到那一刻，
   「重塑」= 回到那一刻 + 用同样的输入重跑。

   和服务端一样，快照里**不含 messages**（对话记录单独处理），
   否则一份存档里嵌套一份自己的历史，浏览器存储会被撑爆。 */

// canUndo 也从快照里排除：它应该由「有没有快照」算出来（服务端就是 canUndo: Boolean(save.snapshot)），
// 存进快照会变成自己描述自己，回退一次之后就再也退不了第二次。
const SNAP_SKIP = new Set(['messages', 'snapshot', 'canUndo']);

function localTakeSnapshot(s) {
  if (!s) return;
  const snap = {};
  for (const [k, v] of Object.entries(s)) {
    if (SNAP_SKIP.has(k)) continue;
    snap[k] = v;
  }
  s.snapshot = JSON.parse(JSON.stringify(snap));
  s.canUndo = true;
}

/** 回到快照那一刻。messages 不参与还原（由调用方处理）。返回是否成功 */
function localRestoreSnapshot(s) {
  if (!s?.snapshot) return false;
  const keepMessages = s.messages;
  const snap = s.snapshot;
  for (const k of Object.keys(s)) if (!SNAP_SKIP.has(k)) delete s[k];
  Object.assign(s, JSON.parse(JSON.stringify(snap)));
  s.messages = keepMessages;
  s.snapshot = null;
  s.canUndo = false;
  return true;
}

/** 从尾部删掉最近的一条 GM / system 消息 */
function dropLastGm(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'gm' || messages[i].role === 'system') { messages.splice(i, 1); return; }
  }
}
/** 从尾部删掉最近的一条玩家消息 */
function dropLastPlayer(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'player') { messages.splice(i, 1); return; }
  }
}

/** 回退：把这一轮整个删掉，回到这一轮开头 */
function localUndo(s, messages) {
  if (!s?.snapshot) return { ok: false, msg: '没有可以回退的轮次了。' };
  dropLastGm(messages);
  dropLastPlayer(messages);
  // 不要再手动 turn-1：快照是「这一轮开始前」存的，里面本来就带着当时的 turn。
  // 以前既还原快照又减一次，等于退了两轮（回合数从 2 直接跳到 0）。
  localRestoreSnapshot(s);
  s.messages = messages;
  return { ok: true };
}

/**
 * 重塑：回到这一轮开头，保留玩家的输入准备重跑。
 * 和服务端一致：如果这一轮发生在现实生活里（还没真正进任务），
 * 顺便换一个任务 —— 否则种子和 slot 被快照还原，再派发还是同一个世界。
 */
function localReroll(s, messages) {
  if (!s?.snapshot) return { ok: false, msg: '没有可以重塑的轮次了。' };
  let lastAction = '';
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'player') { lastAction = messages[i].content; break; }
  }
  dropLastGm(messages);
  dropLastPlayer(messages);
  const wasInMission = s.phase === 'mission';
  localRestoreSnapshot(s);   // turn 由快照还原，别再手动减
  const freshMission = wasInMission && (s.mission?.turnsSeen || 0) <= 0;
  if (!wasInMission || freshMission) {
    if (freshMission) {
      localWithdrawMission(s);
      messages = messages.filter(m => !(m.role === 'system' && String(m.content || '').includes('【主神任务】')));
    } else {
      localWithdrawMission(s);
    }
    localRerollOutline(s);
  }
  s.messages = messages;
  return { ok: true, action: lastAction, redrawn: Boolean(freshMission), messages };
}

/* ═══════════════ 4. 纯前端模式的本地规则 ═══════════════
   纯前端模式没有服务器，属性/装备/判定的计算在这里复刻一份。
   两边的规则保持一致，数据都来自 gamedata.js。 */
const ATTR_KEYS = ['con', 'agi', 'int', 'wil', 'cha', 'luk'];
const EQUIP_SLOT_KEYS = () => (window.GAME_DATA?.equipSlots) || ['head', 'weapon', 'offhand', 'armor', 'accessory1', 'accessory2'];
/** 一个 item.slot 值能戴到哪些栏位（和服务端 SLOT_ACCEPTS 同规则） */
const SLOT_ACCEPTS = () => ({
  head: ['head'], weapon: ['weapon'], offhand: ['offhand'],
  armor: ['armor'], accessory: ['accessory1', 'accessory2'],
});
const slotsForSlot = slot => (SLOT_ACCEPTS()[slot] || [slot]);

function localMutation(state, fn) {
  const r = fn(state) || {};
  localRefresh(state);
  Backend._put(state);
  return { ...r, state };
}

/* ── 出身 / 天赋可以「自己写」，统一走这两个解析函数 ── */
const CUSTOM_ID = '__custom__';
function resolveOrigin(s) {
  if (!s) return null;
  if (s.origin === CUSTOM_ID) return s.customOrigin || null;
  return (window.GAME_DATA?.origins || []).find(o => o.id === s.origin) || null;
}
window.resolveOrigin = resolveOrigin;
function resolveTalent(s) {
  if (!s) return null;
  if (s.talent === CUSTOM_ID) return s.customTalent || null;
  return (window.GAME_DATA?.talents || []).find(t => t.id === s.talent) || null;
}

window.resolveTalent = resolveTalent;

/** 重算总属性 / 上限 / 战斗数值 */
/* ═══════════════ 世界书（网页模式也要注入） ═══════════════
   以前纯前端模式**完全没有世界书** —— AI 不知道原著设定和人物，
   只会照着任务名瞎编（「未命名站务员」「神秘人」这种）。
   数据由 server.mjs 生成到 public/worldbooks.js（856KB）。

   ⚠ **按需加载**：856KB 挂在 index.html 里同步加载的话，GitHub Pages 上要下 4~11 秒，
   首页会白屏。所以第一次真正需要世界书时（进任务世界 / 开局注入提示词）才拉，
   拿过一次就缓存住。下面这些函数和 lib/rules.mjs 的
   worldBookByWork / worldBookBlock 保持同一套规则。 */

let _booksLoading = null;
/** 按需把世界书拉进来（幂等，重复调用共用同一个 promise） */
function ensureWorldBooks() {
  if (Array.isArray(window.GAME_WORLDBOOKS) && window.GAME_WORLDBOOKS.length) {
    return Promise.resolve(window.GAME_WORLDBOOKS);
  }
  if (!_booksLoading) {
    _booksLoading = loadScriptOnce('./worldbooks.js', 'GAME_WORLDBOOKS')
      .then(() => {
        const n = (window.GAME_WORLDBOOKS || []).length;
        if (!n) console.warn('worldbooks.js 里没有世界书数据');
        return window.GAME_WORLDBOOKS || [];
      })
      .catch(() => {
        _booksLoading = null;   // 失败允许下次重试
        console.warn('worldbooks.js 加载失败 —— 本轮不会注入世界书。'
          + '静态托管时记得把它一起上传（用 start.bat 启动服务器会自动生成）。');
        return [];
      });
  }
  return _booksLoading;
}
window.ensureWorldBooks = ensureWorldBooks;

function localWorldBooks() {
  return Array.isArray(window.GAME_WORLDBOOKS) ? window.GAME_WORLDBOOKS : [];
}

/** 按作品名查世界书；作品名带副标题也能匹配（跟服务端同规则） */
function localWorldBookByWork(work) {
  const w = String(work || '').trim();
  if (!w) return null;
  const list = localWorldBooks();
  const exact = list.find(b => (b.canon || b.name) === w);
  if (exact) return exact;
  return list.find(b => {
    const k = b.canon || b.name || '';
    return k && (w.includes(k) || k.includes(w));
  }) || null;
}

/** 世界书注入块。tier='full' 给细节，'entry' 只给名单（省 token） */
function localWorldBookBlock(save, tier = 'entry') {
  const b = localWorldBookByWork(save?.mission?.work || save?.world);
  if (!b) return '';
  const full = tier === 'full';
  const out = [];
  out.push(`[世界书 ·《${b.canon || b.name}》${b.tagline ? ` —— ${b.tagline}` : ''}]`);
  if (b.guidance) out.push(b.guidance);
  if (b.powerStyle) out.push(`力量风格：${b.powerStyle}`);
  if (b.signatureItems?.length) out.push(`这个世界的标志性道具：${b.signatureItems.join('、')}`);
  if (b.factions?.length) {
    out.push('势力：' + b.factions.map(f => `${f.name}（${f.attitude}｜${f.desc}）`).join('　'));
  }
  if (b.npcs?.length) {
    if (full) {
      out.push('原著人物（请让他们自然出场，不要一次全放出来）：');
      for (const n of b.npcs) {
        const bits = [`　· ${n.name}｜${n.identity}｜${n.role}`];
        const meta = [n.gender, n.age, n.race, n.faction].filter(Boolean).join('｜');
        if (meta) bits.push(`　　档案：${meta}`);
        if (n.traits?.length) bits.push(`　　性格标签：${n.traits.join('、')}`);
        if (n.appearance) bits.push(`　　**外貌（照这个写，不许改）**：${n.appearance}`);
        if (n.voice) bits.push(`　　**说话风格（照这个写）**：${n.voice}`);
        if (n.personality) bits.push(`　　性格：${n.personality}`);
        if (n.hook) bits.push(`　　与玩家的钩子：${n.hook}`);
        if (n.favorHint) bits.push(`　　好感变化规则：${n.favorHint}`);
        if (n.relations?.length) bits.push(`　　关系：${n.relations.map(r => `${r.name}（${r.label}）`).join('；')}`);
        out.push(bits.join('\n'));
      }
      out.push('\n★ **原著人物的外貌、发色、体型、穿着、说话风格是原著事实，不是你的创作空间。**'
        + '\n　 上面这些人的长相就按「外貌」那一行写，**不许自己改成别的发色 / 别的衣服 / 别的身材** ——'
        + '\n　 写错就是 OOC，玩家一眼就能看出来。他们换了衣服、受了伤、淋了雨，可以写变化，'
        + '\n　 但**底色（发色、体格、标志性穿着）必须始终一致**。'
        + '\n　 状态块里 npcs 的 appearance 字段**不要填**，系统会自己维护，填了也会被丢弃。');
    } else {
      out.push('这个世界有头有脸的人（详细档案在系统里，状态块里更新好感就行）：');
      for (const n of b.npcs) out.push(`　· ${n.name}｜${n.identity || ''}｜${n.role || ''}`);
    }
    out.push('★ 需要这些人出场时，**直接用上面这些有名字的人**，'
      + '不要另造「未命名站务员」「神秘人」「黑衣男子」这类没名字的角色去顶他们的位置。'
      + '玩家该记住的是名字，不是职务。');
  }
  if (full && b.mainQuest) {
    out.push(`\n这个世界原本的主线（**只是灵感，不强制** —— 玩家的任务由主神单独指派）：\n　${b.mainQuest}`);
    if (b.mainQuestGoal) out.push(`　原本的结局走向：${b.mainQuestGoal}`);
    if (b.sideQuests?.length) {
      out.push('　可以顺手埋的支线：');
      for (const q of b.sideQuests) out.push(`　　· ${q.name}：${q.desc}（报酬：${q.reward}）`);
    }
  }
  out.push('\n（世界书是**原著事实**：人名、地名、势力、能力体系、时间线都不要写错。'
    + '但玩家自己的遭遇、任务、以及他改变的东西，由你自由发挥。）');
  return out.join('\n');
}

/** 这个世界是系统派定的，不许换 —— 跟服务端 outlineBlock 里那段同义 */
function localWorldPinBlock(save) {
  const m = save?.mission;
  if (!m) return '';
  const b = localWorldBookByWork(m.work);
  return `[这个世界是系统派定的 · 不许换]
　作品：**《${m.work || '未知'}》**
　钩子：${m.hookText || m.brief || '（见任务简报）'}
　**这一轮的所有内容都必须发生在这部作品的世界里。** 上面那篇世界书就是唯一依据，
　不要引入别的作品的设定、地名、势力或人物 —— 哪怕任务名听起来像另一部作品。
　在状态块里**不要**写 "mission":{"name":...} 来改任务名；任务名由系统定，你只管写正文。`;
}

/* ── 技能 / 血统的属性加成 ──
   模型自己发明的能力往往只把加成写在 desc 文字里（「INT+8, AGI+5」），没有 stats 字段。
   这里复刻一份 lib/rules.mjs 的解析逻辑，不然纯前端模式下这些加成会被吞掉。 */
const LOCAL_STAT_ALIASES = {
  con: ['con', '体质', '体魄'], agi: ['agi', '敏捷', '身法'],
  int: ['int', '智识', '智力', '智慧'], wil: ['wil', '意志', '精神'],
  cha: ['cha', '魅力'], luk: ['luk', '幸运', '运气'],
  atk: ['atk', '攻击', '攻击力'], def: ['def', '防御', '防御力'],
  maxHp: ['maxHp', '生命上限'], maxSta: ['maxSta', '体力上限'],
};
const LOCAL_STAT_LOOKUP = (() => {
  const pairs = [];
  for (const [id, names] of Object.entries(LOCAL_STAT_ALIASES)) for (const n of names) pairs.push([n, id]);
  return pairs.sort((a, b) => b[0].length - a[0].length);
})();

function localParseStatText(text) {
  const out = {};
  const src = String(text || '');
  if (!src) return out;
  for (const [alias, id] of LOCAL_STAT_LOOKUP) {
    const esc = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // 符号组里 ASCII 减号必须放最后，否则会被当成区间（见 lib/rules.mjs 同样的注释）
    const m = src.match(new RegExp(`${esc}(?:值|上限)?\\s*[:：]?\\s*([+＋－-]?\\s*\\d+)`, 'i'));
    if (!m) continue;
    const n = Number(String(m[1]).replace(/[＋]/g, '+').replace(/[－]/g, '-').replace(/\s+/g, ''));
    if (Number.isFinite(n) && n !== 0) out[id] = (out[id] || 0) + n;
  }
  return out;
}

/** 一条技能 / 血统的加成：记录自带 → 数据表 → 从描述文字里解析（并写回） */
function localPowerStats(it) {
  if (!it) return null;
  if (it.stats && Object.keys(it.stats).length) return it.stats;
  const def = window.GAME_DATA?.equipment?.find(x => x.id === it.id);
  if (def?.stats && Object.keys(def.stats).length) return def.stats;
  const parsed = localParseStatText(it.desc);
  if (Object.keys(parsed).length) { it.stats = parsed; return parsed; }
  return null;
}
window.localParseStatText = localParseStatText;

/* 能力名归一化 + 去重（和服务端 lib/rules.mjs 同一套规则）。
   模型每回合重述同一个血统时括号写法会变：「宇智波血统(残)」vs「宇智波血统（残）」，
   按全等去重会漏，加成于是被算两三遍。 */
function localNormPowerName(name) {
  return String(name || '')
    .replace(/[\uFF01-\uFF5E]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/[\s\u3000]/g, '')
    .replace(/[()[\]{}<>〈〉《》「」『』【】·・,，.。:：;；!！?？'"`~—－_/\\|-]/g, '')
    .toLowerCase();
}
function localSamePower(a, b) {
  const ka = localNormPowerName(a?.name), kb = localNormPowerName(b?.name);
  return Boolean(ka) && ka === kb;
}
/** 就地去掉重复的能力记录，返回删掉几条 */
function localDedupePowers(list) {
  if (!Array.isArray(list) || list.length < 2) return 0;
  const out = [];
  let removed = 0;
  for (const rec of list) {
    const hit = out.find(x => localSamePower(x, rec));
    if (!hit) { out.push(rec); continue; }
    removed++;
    const keep = Object.keys(hit).length >= Object.keys(rec).length ? hit : rec;
    const drop = keep === hit ? rec : hit;
    for (const [k, v] of Object.entries(drop)) if (keep[k] === undefined || keep[k] === '' || keep[k] === null) keep[k] = v;
    if (!Object.keys(keep.stats || {}).length && Object.keys(drop.stats || {}).length) keep.stats = drop.stats;
    out[out.indexOf(hit)] = keep;
  }
  if (removed) { list.length = 0; list.push(...out); }
  return removed;
}
/** 去掉模型自带的数量后缀：「杜蕾斯 ×1」→「杜蕾斯」（和服务端 cleanItemName 同规则） */
function localCleanItemName(name) {
  return String(name || '')
    .replace(/\s*[×xX*]\s*\d+\s*$/, '')
    .replace(/\s*[（(]\s*\d+\s*[)）]\s*$/, '')
    .trim();
}
/** 这个名字像是「道具」吗 —— 人名和状态块的键不算（和服务端 looksLikeItemName 同规则） */
function localNotAnItem(name, save) {
  const s = localCleanItemName(name);
  if (!s) return true;
  if (/^(好感度?|好感度更新|关系|剧情标记|flag|flags|状态|效果|备注|note|记忆|标签|属性|任务进度|进度更新|积分|当前积分|经验|战绩|等级|hp|mp|sp|生命|生命值|体力|体力值|精力|现金|金钱|金钱数|时间|日期|时刻|位置|地点|阶段|身份|职业|年龄|性别|备注说明)$/i.test(s)) return true;
  if (/^(获得|领悟|习得|掌握|觉醒|失去|消耗|得到|学会|解锁|更新|被动|主动|冷却|触发)(状态|技能|能力|道具|物品|装备|武器|效果|被动|标记|进度)/.test(s)) return true;
  if (/^(被动|主动|冷却|触发|说明|来源|加成|代价)/.test(s)) return true;
  if (/[。！？]$/.test(s)) return true;
  // 人名不是道具：模型会把 npcs 名单里的人当掉落物报上来（实测「春丽」「嘉米」）
  if (save) {
    if ((save.life?.npcs || []).some(x => String(x?.name || '').trim() === s)) return true;
    if (String(save.name || '').trim() === s) return true;
  }
  return false;
}

/** 按归一化名字在数据表里找（半角括号的「宇智波血统(残)」也要认出正主） */
function localItemByLooseName(name) {
  const key = localNormPowerName(name);
  if (!key) return null;
  const all = window.GAME_DATA?.equipment || [];
  const exact = all.find(x => localNormPowerName(x.name) === key);
  if (exact) return exact;
  const stripped = key.replace(/残$/, '');
  return stripped === key ? null : all.find(x => localNormPowerName(x.name) === stripped) || null;
}

/* ── 从正文措辞里读稀有度 / 栏位（和服务端 lib/rules.mjs 同规则）──
   模型爱在正文写「传说级饰品」这种话，状态块却不一定报字段。 */
const CN_RARITY = {
  普通: 'common', 常见: 'common', 一般: 'common', 精良: 'fine', 优良: 'fine',
  稀有: 'rare', 史诗: 'epic', 传说: 'legend', 传奇: 'legend', 神话: 'myth', 神器: 'myth',
};
const CN_SLOT = {
  饰品: 'accessory', 配件: 'accessory', 首饰: 'accessory',
  护甲: 'armor', 防具: 'armor', 装备: 'armor',
  武器: 'weapon', 主武器: 'weapon', 副手: 'offhand', 盾: 'offhand',
  消耗品: 'consumable', 道具: 'consumable', 技能: 'skill', 血统: 'bloodline',
};
function localParseRarityHint(text) {
  const m = /(普通|常见|一般|精良|优良|稀有|史诗|传说|传奇|神话|神器)(?:级|品|阶|品质)?/.exec(String(text || ''));
  return m ? CN_RARITY[m[1]] || null : null;
}
function localParseSlotHint(text) {
  const m = /(饰品|配件|首饰|护甲|防具|主武器|武器|副手|消耗品|道具|技能|血统)/.exec(String(text || ''));
  return m ? CN_SLOT[m[1]] || null : null;
}
/** AI 没报 slot 时按名字猜栏位（饰品要排在护甲前面：「面具」两种都像） */
function localGuessSlot(name, desc) {
  const s = `${name || ''} ${desc || ''}`;
  if (/(军帽|头盔|安全帽|钢盔|警帽|兜帽|头巾|面罩|面具|护目镜|单片镜|墨镜|眼镜|王冠|冠冕|发饰|帽子|棒球帽|头带|额饰|面甲|防毒)/.test(s)) return 'head';
  if (/(戒指|项链|吊坠|徽章|耳环|手环|脚链|义眼|纹身|印记|指环|耳钉|耳机|耳麦|通讯器|对讲机|无线电|护身符|挂坠|腕表|手表|腰带|披风|勋章|围巾)/.test(s)) return 'accessory';
  if (/(盾|护符|符箓|卷轴|罗盘|灯笼|副手|箭袋|弹药)/.test(s)) return 'offhand';
  if (/(甲|铠|护腿|外骨骼|防弹衣|胸甲|战袍|斗篷|护额|制服|装置|护甲|装甲|背包|推进器|背心|防弹)/.test(s)) return 'armor';
  if (/(药|丸|丹|剂|针剂|血清|绷带|口粮|干粮|仙豆|符水|药剂)/.test(s)) return 'consumable';
  if (/(刀|剑|枪|矛|戟|斧|锤|弓|弩|棍|棒|镰|匕首|苦无|手里剑|短刃|长刀|光剑|魔杖|法杖|拳套|爪|鞭|铳|炮|刃|刺|针|镖)/.test(s)) return 'weapon';
  return 'consumable';
}
function localDefaultStats(slot, rarity) {
  const tier = { common: 1, fine: 2, rare: 3, epic: 5, legend: 8, myth: 12 }[rarity] || 1;
  if (slot === 'weapon') return { atk: tier * 2 };
  if (slot === 'armor') return { def: tier * 2, maxHp: tier * 2 };
  if (slot === 'offhand') return { def: tier };
  if (slot === 'accessory') return { luk: tier, def: tier };
  return {};
}
/** 名称里前置的稀有度后缀（「史诗级护腕」→「护腕」），并且把那份稀有度返回 */
function localStripRarityPrefix(name) {
  const m = /^(普通|精良|稀有|史诗|传说|传奇|神话|神器)(?:级|品|阶)?\s*(.+)$/.exec(String(name || '').trim());
  return m ? { rarity: CN_RARITY[m[1]] || null, name: m[2].trim() } : { rarity: null, name: String(name || '') };
}

/**
 * 剧情里拿到的道具 → 一条真正的道具记录（服务端 lib/rules.mjs grantItem 的本地对应版）。
 * ⚠ 以前网页版只塞 { name, qty, desc }，slot / rarity / stats 全丢，
 *   于是捡到的装备没有栏位也没有数值，等于装不上。
 */
function localGrantItem(save, raw, qty = 1) {
  const def = localItemByLooseName(raw?.name);
  const stripped = localStripRarityPrefix(raw?.name);
  const name = stripped.name || String(raw?.name || '未知道具');
  const hint = `${raw?.name || ''} ${raw?.desc || ''} ${raw?.rarity || ''} ${raw?.slot || ''}`;
  const rawId = String(raw?.rarity || '');
  const rarity = /^(common|fine|rare|epic|legend|myth)$/.test(rawId) ? rawId
    : (localParseRarityHint(rawId) || localParseRarityHint(hint) || stripped.rarity || 'common');
  const slot = localParseSlotHint(raw?.slot) || localParseSlotHint(raw?.desc) || localParseSlotHint(raw?.name)
    || localGuessSlot(name, raw?.desc);
  const it = {
    id: def ? def.id : `x_${name.replace(/\s+/g, '_')}`,
    name: def ? def.name : name,
    desc: String(raw?.desc || def?.desc || ''),
    slot: def ? def.slot : slot,
    rarity: def ? def.rarity : rarity,
    stats: {},
    qty: Math.max(1, Number(qty) || 1),
    source: def ? 'library' : 'story',
  };
  if (raw?.stats && typeof raw.stats === 'object') {
    for (const [k, v] of Object.entries(raw.stats)) {
      if (['atk', 'def', 'con', 'agi', 'int', 'wil', 'cha', 'luk', 'maxHp', 'maxSta'].includes(k)) {
        const n = Number(v);
        if (Number.isFinite(n) && n !== 0) it.stats[k] = n;
      }
    }
  }
  if (!Object.keys(it.stats).length) it.stats = localDefaultStats(it.slot, it.rarity);
  if (raw?.perk) it.perk = String(raw.perk).slice(0, 120);
  return it;
}

function localRefresh(s) {
  const d = window.GAME_DATA;
  if (!d || !s) return s;
  const tot = {};
  for (const k of ATTR_KEYS) tot[k] = Number(s.attrs?.[k]) || 5;
  const bump = st => {
    if (!st) return;
    for (const [k, v] of Object.entries(st)) tot[k] = (tot[k] || 0) + (Number(v) || 0);
  };
  bump(resolveOrigin(s)?.stats);
  bump(resolveTalent(s)?.stats);

  const cmb = { atk: 0, def: 0, maxHp: 0, maxSta: 0 };
  const bumpEq = st => {
    if (!st) return;
    for (const [k, v] of Object.entries(st)) {
      if (k in tot) tot[k] += Number(v) || 0;
      else if (k in cmb) cmb[k] += Number(v) || 0;
    }
  };
  for (const slot of EQUIP_SLOT_KEYS()) {
    const id = s.equipment?.[slot];
    if (!id) continue;
    const it = d.equipment.find(x => x.id === id) || (s.inventory || []).find(x => x.id === id);
    bumpEq(it?.stats);
  }
  // 同一份能力如果被重复存了几遍，加成会被算好几遍 —— 先按归一化名字去重
  for (const list of [s.skills, s.bloodlines]) localDedupePowers(list);
  for (const list of [s.skills, s.bloodlines]) {
    for (const it of (list || [])) {
      bumpEq(localPowerStats(it));
    }
  }

  const diff = d.difficulties.find(x => x.id === s.difficulty) || {};
  s.totalAttrs = tot;
  s.combat = cmb;
  s.maxHp = Math.max(20, (s.baseHp ?? 100) + (tot.con - 10) * 8 + (cmb.maxHp || 0) + (diff.extraHp || 0));
  s.maxSta = Math.max(20, (s.baseSta ?? 100) + (tot.wil - 10) * 8 + (cmb.maxSta || 0));
  s.hp = Math.max(0, Math.min(s.hp ?? s.maxHp, s.maxHp));
  s.sta = Math.max(0, Math.min(s.sta ?? s.maxSta, s.maxSta));
  localSyncView(s);
  return s;
}

/**
 * 纯前端模式的「界面派生字段」。
 * 服务端的 stateView() 会算这些；本地模式以前没算，于是侧栏的「主神空间」按钮、
 * 系统面板、下一站那一行在网页版都是空的。
 */
function localSyncView(s) {
  if (!s) return s;
  s.isHub = s.phase === 'hub';
  s.pendingWork = s.pendingWork || null;
  s.pickWorldCost = window.GAME_DATA?.economy?.pickWorldCost ?? 5000;
  s.canUndo = Boolean(s.snapshot);
  const cd = localCountdown(s);
  s.countdownText = cd.text;
  s.countdownMinutes = cd.minutes;
  s.countdownDays = cd.days;
  s.countdownSlots = cd.slots;
  s.clockText = localClockText(s);
  s.panel = s.isHub ? localSystemPanel(s) : null;
  return s;
}

/** 系统面板：浮在主神空间雾壁上的那块东西（对应服务端 R.systemPanel） */
function localSystemPanel(s) {
  const meta = window.GAME_DATA?.attrs || [];
  const tot = s.totalAttrs || {};
  const attr = meta.map(a => `${a.name} ${tot[a.id] ?? 5}`).join('　');
  const powers = [...(s.skills || []), ...(s.bloodlines || [])]
    .map(x => `${x.name}${x.nerfed ? `（残 · 补全需 ${(x.upgradeCost || 0).toLocaleString()} 分）` : ''}`)
    .join('、') || '无';
  const slotNames = window.GAME_DATA?.equipSlotNames || {};
  const gear = (window.GAME_DATA?.equipSlots || [])
    .map(k => `${slotNames[k] || k}：${s.equipment?.[k]
      ? ((window.GAME_DATA?.equipment || []).find(i => i.id === s.equipment[k])?.name || s.equipment[k])
      : '空'}`).join('　');
  const visited = (s.visitedWorlds || []).map(v => v.work).join('、') || '（还没去过）';
  const cost = s.pickWorldCost ?? 5000;
  return [
    '『系统面板』',
    `　编号　${s.id || '未登记'}`,
    `　等级　${s.rank || 'E'} 级（战绩 ${s.rankExp || 0}，已完成 ${s.missionsDone || 0} 次任务）`,
    `　积分　${(s.score || 0).toLocaleString()}`,
    `　属性　${attr}`,
    `　生命　${s.hp}/${s.maxHp}　体力　${s.sta}/${s.maxSta}`,
    `　能力　${powers}`,
    `　装备　${gear}`,
    `　去过　${visited}`,
    s.pendingWork
      ? `　下一站　《${s.pendingWork}》（已指定）`
      : s.freeWorldPick
        ? '　下一站　未指定 —— **主神送了你第一次免费指定**（推着挑一个世界不要积分）'
        : `　下一站　未指定 —— 推门是随机世界，花 ${cost.toLocaleString()} 积分可以指定`,
  ].join('\n');
}

function localGrant(save, def) {
  save.inventory ??= [];
  const ex = save.inventory.find(i => i.id === def.id);
  if (ex) { ex.qty += 1; return null; }
  save.inventory.push({ ...def, qty: 1 });
  if (Boolean(SLOT_ACCEPTS()[def.slot])) {
    save.equipment ??= {};
    const slots = slotsForSlot(def.slot);
    for (const sl of slots) if (!save.equipment[sl]) { save.equipment[sl] = def.id; return sl; }
  }
  return null;
}

function localBuy(save, itemId) {
  const d = window.GAME_DATA;
  if (!d) return { ok: false, msg: '游戏数据还没加载好。' };
  const def = d.equipment.find(x => x.id === itemId);
  if (!def) return { ok: false, msg: '主神空间没有这件东西。' };
  if ((save.skills || []).some(x => x.id === itemId) || (save.bloodlines || []).some(x => x.id === itemId)) {
    return { ok: false, msg: `你已经拥有「${def.name}」了。` };
  }
  if (def.slot !== 'consumable' && (save.inventory || []).some(i => i.id === itemId)) {
    return { ok: false, msg: `你已经有「${def.name}」了，装备栏里放不下第二件。` };
  }
  if (save.score < def.cost) return { ok: false, msg: `积分不足：需要 ${def.cost}，你只有 ${save.score}。` };
  save.score -= def.cost;
  if (def.slot === 'skill') {
    save.skills.push({ id: def.id, name: def.name, desc: def.desc, rarity: def.rarity, stats: def.stats });
  } else if (def.slot === 'bloodline') {
    save.bloodlines.push({ id: def.id, name: def.name, desc: def.desc, rarity: def.rarity, stats: def.stats });
  } else {
    localGrant(save, def);
  }
  localRefresh(save);
  return { ok: true, msg: `兑换成功：「${def.name}」，扣除 ${def.cost} 积分。` };
}

function localUse(save, itemId) {
  const inv = (save.inventory || []).find(i => i.id === itemId || i.name === itemId);
  if (!inv) return { ok: false, msg: '你没有这个道具。' };
  const d = window.GAME_DATA;
  const def = d?.equipment.find(x => x.id === inv.id);
  const eff = def?.effect || inv.effect;
  // permanent 也算「能在界面上用」（和服务端 R.useItem 同规则）
  if (!eff || (!eff.hp && !eff.sta && !eff.score && !eff.permanent)) {
    return { ok: false, msg: `「${inv.name}」要在剧情里用，先描述你怎么用它。` };
  }
  const before = { hp: save.hp, sta: save.sta, score: save.score, maxHp: save.maxHp, maxSta: save.maxSta };
  const ch = [];
  if (eff.hp) {
    save.hp = Math.max(0, Math.min(save.maxHp, save.hp + eff.hp));
    const got = save.hp - before.hp;
    ch.push(`HP +${got}${got === 0 ? '（已满）' : ''}`);
  }
  if (eff.sta) {
    save.sta = Math.max(0, Math.min(save.maxSta, save.sta + eff.sta));
    const got = save.sta - before.sta;
    ch.push(`体力 +${got}${got === 0 ? '（已满）' : ''}`);
  }
  if (eff.score) { save.score += eff.score; ch.push(`积分 +${eff.score}`); }
  if (eff.permanent?.maxHp) { save.baseHp = (save.baseHp ?? 100) + eff.permanent.maxHp; ch.push(`HP 上限 +${eff.permanent.maxHp}`); }
  if (eff.permanent?.maxSta) { save.baseSta = (save.baseSta ?? 100) + eff.permanent.maxSta; ch.push(`体力 上限 +${eff.permanent.maxSta}`); }

  // 一点都没变（都满着）→ 不消耗，说清楚原因（和服务端一致）
  const changed = save.hp !== before.hp || save.sta !== before.sta
    || save.score !== before.score || save.maxHp !== before.maxHp || save.maxSta !== before.maxSta;
  if (!changed) {
    return {
      ok: false,
      msg: `现在用不上「${inv.name}」：HP 和体力都是满的（${save.hp}/${save.maxHp}　${save.sta}/${save.maxSta}），先留着吧。`,
    };
  }

  inv.qty -= 1;
  if (inv.qty <= 0) save.inventory = save.inventory.filter(i => i !== inv);
  if (save.status === 'spent' && save.sta > save.maxSta * 0.3) save.status = 'alive';
  localRefresh(save);
  return { ok: true, msg: `使用了「${inv.name}」：${ch.join('，')}。` };
}

function localEquip(save, itemId) {
  const inv = (save.inventory || []).find(i => i.id === itemId);
  if (!inv) return { ok: false, msg: '背包里没有这件装备。' };
  const def = window.GAME_DATA?.equipment.find(x => x.id === itemId) || inv;
  if (!Boolean(SLOT_ACCEPTS()[def.slot])) {
    return { ok: false, msg: `「${def.name}」不是可穿戴的装备。` };
  }
  save.equipment ??= {};
  for (const slot of EQUIP_SLOT_KEYS()) {
    if (save.equipment[slot] === itemId) {
      save.equipment[slot] = null; localRefresh(save);
      return { ok: true, msg: `已卸下「${def.name}」。` };
    }
  }
  const slots = slotsForSlot(def.slot);
  const slot = slots.find(s => !save.equipment[s]) || slots[slots.length - 1];
  const replaced = save.equipment[slot];
  save.equipment[slot] = itemId;
  localRefresh(save);
  const rn = replaced ? (window.GAME_DATA?.equipment.find(x => x.id === replaced)?.name || replaced) : null;
  return { ok: true, msg: rn ? `已换上「${def.name}」，替换下「${rn}」。` : `已装备「${def.name}」。` };
}

function localUnequip(save, slot) {
  if (!EQUIP_SLOT_KEYS().includes(slot)) return { ok: false, msg: '没有这个装备栏。' };
  if (!save.equipment?.[slot]) return { ok: false, msg: '这个栏位是空的。' };
  const it = window.GAME_DATA?.equipment.find(x => x.id === save.equipment[slot]);
  save.equipment[slot] = null;
  localRefresh(save);
  return { ok: true, msg: `已卸下「${it?.name || '装备'}」。` };
}

function localSell(save, itemId) {
  const inv = (save.inventory || []).find(i => i.id === itemId);
  if (!inv) return { ok: false, msg: '背包里没有这个东西。' };
  const def = window.GAME_DATA?.equipment.find(x => x.id === itemId);
  const price = def ? Math.floor(def.cost / 2) : 0;
  if (!price) return { ok: false, msg: '这件东西卖不掉。' };
  inv.qty -= 1;
  if (inv.qty <= 0) {
    save.inventory = save.inventory.filter(i => i !== inv);
    for (const slot of EQUIP_SLOT_KEYS()) if (save.equipment?.[slot] === itemId) save.equipment[slot] = null;
  }
  save.score += price;
  localRefresh(save);
  return { ok: true, msg: `卖出「${inv.name}」，回收 ${price} 积分。` };
}

/** 纯前端模式下的建号 */
function localCreateCharacter(w) {
  const d = window.GAME_DATA;
  if (!d) throw new Error('游戏数据还没加载好。');
  const isCustomO = w.originMode === 'custom';
  const isCustomT = w.talentMode === 'custom';
  const cleanO = isCustomO ? normalizeCustomLocal(w.customOrigin, 'origin') : null;
  const cleanT = isCustomT ? normalizeCustomLocal(w.customTalent, 'talent') : null;
  if (isCustomO && !cleanO) throw new Error('自己写的出身需要一个名字。');
  if (isCustomT && !cleanT) throw new Error('自己写的天赋需要一个名字。');
  const origin = cleanO || d.origins.find(o => o.id === w.originId);
  const talent = cleanT || d.talents.find(t => t.id === w.talentId);
  const diff = d.difficulties.find(x => x.id === w.difficulty) || d.difficulties[1];
  const s = {
    id: uid(), name: String(w.name || '无名者').slice(0, 20),
    age: w.age ?? null,
    createdAt: nowISO(), updatedAt: nowISO(), turn: 0,
    origin: cleanO ? CUSTOM_ID : (origin?.id || null),
    talent: cleanT ? CUSTOM_ID : (talent?.id || null),
    customOrigin: cleanO, customTalent: cleanT,
    attrs: { ...w.attrs }, difficulty: diff.id,
    world: null, worldMode: 'random',
    baseHp: 100, baseSta: 100,
    // 开局积分清零：出身自带的那点照给，其余全靠挣
    score: (d.economy?.startScore || 0) + (origin?.score || 0),
    hp: null, maxHp: null, sta: null, maxSta: null, status: 'alive',
    equipment: { head: null, weapon: null, offhand: null, armor: null, accessory1: null, accessory2: null },
    inventory: [], skills: [], bloodlines: [], flags: {}, dungeon: null,
    summary: '', messages: [], checks: [], life: { quests: [], npcs: [], faction: '' },
    // 开局落在主神空间（中转站），并且第一次指定世界免费
    clock: { minutes: 0 }, day: 1, week: 1, phase: 'hub', mission: null,
    pendingWork: null, freeWorldPick: true, hubVisits: 0, missionAt: null,
    money: (window.GAME_DATA?.economy?.startMoney ?? 3000), job: null,
  };
  for (const it of origin?.startItems || []) {
    s.inventory.push({ id: `x_${it.name}`, name: it.name, desc: it.desc, slot: 'consumable', rarity: 'common', stats: {}, qty: 1 });
  }
  // 开局那份「残次品能力」——服务端由 R.grantStarterPower 给，纯前端以前**没给**，
  // 于是网页模式建出来的角色一身空。这里复刻同一套规则（见 lib/rules.mjs grantStarterPower）。
  localGrantStarterPower(s);
  localRefresh(s);
  s.hp = s.maxHp; s.sta = s.maxSta;
  return s;
}

/** 属性 id → 中文名（和服务端 ATTR_NAME 同一张表） */
function localAttrName(k) {
  return {
    con: '体质', agi: '敏捷', int: '智识', wil: '意志', cha: '魅力', luk: '幸运',
    atk: '攻击', def: '防御', maxHp: '生命上限', maxSta: '体力上限',
  }[k] || k;
}

/**
 * 开局能力（残次品）。规则和服务端完全一致：
 *  · 只从 common~fine/rare/epic 里抽（不能抽到 legend/myth，否则永远补不起）
 *  · 属性只保留四成，向下取整，本来不到 2 的算 1
 *  · id 必须和完整版不同，否则商店会以为你已经有、永远补不了
 *  · 带一份能看懂的介绍：这是什么 / 现在能干什么 / 完整版差在哪 / 怎么补全
 */
function localGrantStarterPower(s) {
  const d = window.GAME_DATA;
  const pool = (d?.equipment || []).filter(i =>
    (i.slot === 'skill' || i.slot === 'bloodline')
    && ['common', 'fine', 'rare', 'epic'].includes(i.rarity));
  if (!pool.length) return null;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  const nerfed = {};
  for (const [k, v] of Object.entries(pick.stats || {})) {
    const cut = Math.floor((Number(v) || 0) * 0.4);
    nerfed[k] = cut > 0 ? cut : 1;
  }
  const isBlood = pick.slot === 'bloodline';
  const rar = (d.rarities || {})[pick.rarity] || {};
  const discount = d.upgradeDiscount ?? 0.6;
  const upgradeCost = Math.round((pick.cost || 0) * discount);
  const statText = Object.entries(pick.stats || {}).map(([k, v]) => `${localAttrName(k)} ${v > 0 ? '+' : ''}${v}`).join('　');
  const myStatText = Object.entries(nerfed).map(([k, v]) => `${localAttrName(k)} +${v}`).join('　');
  const rec = {
    id: `${pick.id}__nerfed`,
    name: `${pick.name}（残）`,
    desc: pick.desc,
    rarity: pick.rarity,
    stats: nerfed,
    source: pick.id,
    nerfed: true,
    level: 1,
    intro: [
      `这是一份**${rar.name || ''}级${isBlood ? '血统' : '技能'}**，主神随手塞给你的，是残的。`,
      `完整版能给的：${statText || '（没有属性加成，全靠它的特殊效果）'}`,
      `你现在这一份只有：${myStatText || '（属性被削到几乎没有）'}`,
      pick.perk ? `完整版的特殊效果：${pick.perk}` : '',
      '**现在能干什么**：效果按上面那份缩水版的算。残次品只有完整版的一小部分威力，',
      '遇到硬仗时明显不够用，但它是你开局唯一拿得出手的东西。',
      `**怎么补全**：在主神空间花 ${upgradeCost.toLocaleString()} 积分（原价的六折）把它换成完整版`
      + (pick.work ? `；或者去《${pick.work}》那个世界做任务，有几率直接补全它。` : '。'),
    ].filter(Boolean).join('\n'),
    upgradeCost,
    fullStats: { ...(pick.stats || {}) },
    fullPerk: pick.perk || '',
    work: pick.work || '',
  };
  (isBlood ? (s.bloodlines ||= []) : (s.skills ||= [])).push(rec);
  return rec;
}

/** 和服务端 lib/rules.mjs 的 normalizeCustom 同规则 */
function normalizeCustomLocal(entry, kind) {
  if (!entry || !String(entry.name || '').trim()) return null;
  const cap = kind === 'talent' ? 8 : 7;
  const stats = {};
  let sum = 0;
  for (const k of ATTR_KEYS) {
    const v = Math.max(-3, Math.min(6, Math.round(Number(entry.stats?.[k]) || 0)));
    if (v) { stats[k] = v; sum += Math.abs(v); }
  }
  // ⚠ 以前这里是 `sum <= cap ? stats : {}` —— 超一点就整份清零。
  //   玩家写满六项（+2 ×6 = 12）是最自然的写法，结果天赋属性全废。
  //   改成按权重削到上限，保留玩家的分配意图（跟服务端同一套规则）。
  if (sum > cap) {
    const keys = Object.keys(stats);
    let guard = 200;
    while (sum > cap && guard-- > 0) {
      const big = keys.reduce((a, b) => (Math.abs(stats[b]) > Math.abs(stats[a]) ? b : a), keys[0]);
      if (Math.abs(stats[big]) > 1) { stats[big] -= Math.sign(stats[big]); sum -= 1; }
      else {
        const drop = keys.find(k => sum > cap && Math.abs(stats[k]) === 1);
        if (!drop) break;
        delete stats[drop]; sum -= 1;
      }
    }
  }
  const out = {
    id: CUSTOM_ID, custom: true,
    name: String(entry.name).trim().slice(0, 24),
    desc: String(entry.desc || '').trim().slice(0, 160),
    perk: String(entry.perk || '').trim().slice(0, 300) || null,
    icon: kind === 'talent' ? '✍️' : '📝',
    stats,
  };
  // 战斗属性（攻击 / 防御 / 生命与体力上限）也认 —— 写「攻击+10」不该等于没写
  const COMBAT_CAP = { atk: 12, def: 12, maxHp: 40, maxSta: 40 };
  for (const [k, limit] of Object.entries(COMBAT_CAP)) {
    const v = Math.round(Number(entry.stats?.[k]) || 0);
    if (v) out.stats[k] = Math.max(-limit, Math.min(limit, v));
  }
  if (kind === 'talent') out.rarity = entry.rarity || 'rare';
  else {
    out.startItems = (entry.startItems || []).filter(i => (i?.name || '').trim()).slice(0, 2)
      .map(i => ({ name: String(i.name).trim().slice(0, 16), desc: '' }));
    out.score = Math.max(-100, Math.min(150, Math.round(Number(entry.score) || 0)));
  }
  return out;
}

function freshState(name) {
  // 兜底：没有走向导时用默认出身建号
  const d = window.GAME_DATA;
  return localCreateCharacter({
    name: name || '无名者',
    originId: d?.origins?.[0]?.id, talentId: d?.talents?.[0]?.id,
    attrs: { con: 6, agi: 6, int: 3, wil: 6, luk: 4 },
    difficulty: 'normal',
  });
}

/* ═══════════════ 5. 游戏主体 ═══════════════ */
const Game = {
  saveId: null,
  state: null,
  messages: [],
  busy: false,
  els: {},
  pendingEl: null,
  lastInput: '',

  async boot() {
    this.els = {
      chat: $('chat'), inner: $('chatInner'), input: $('input'), send: $('sendBtn'),
    };
    bindInput();
    if (window.applyPrefs) window.applyPrefs();
    bindRail();
    bindSidebar();
    bindTopActions();

    await loadGameData();
    await Backend.detect();
    // 「没有存档就把开始页先画出来」这个提前量只对静态托管有意义（那里的存档在 localStorage）。
    // 完整模式的存档在服务器上、localStorage 是空的 —— 一旦探测到有服务器，立刻摘掉，
    // 不然开始页会压在游戏上面，而且 showLanding() 不会跑，两个模式徽章会永远停在「检测中」。
    if (Backend.mode === 'server') document.documentElement.classList.remove('no-save');
    await Backend.getConfig();
    applyBranding();

    const url = new URL(location.href);
    const wanted = url.searchParams.get('save');

    const saves = await Backend.listSaves();
    renderSaves(saves);

    if (wanted && saves.some(s => s.id === wanted)) {
      await this.load(wanted);
    } else if (saves.length) {
      await this.load(saves[0].id);
    } else {
      this.renderEmpty();
      // 没有存档 → 先给开始页，让玩家自己选「离线试玩」还是「配 API」
      if (typeof UI.showLanding === 'function') await UI.showLanding();
      else UI.openNewSave();
    }
  },

  renderEmpty() {
    this.els.inner.innerHTML = '';
    this.addSystem('主神空间在等一个名字。创建一段旅途，灰雾就会为你打开。');
  },

  /* ── 存档 ── */
  async load(id) {
    const { state, messages } = await Backend.loadSave(id);
    this.saveId = id;
    this.state = state;
    this.messages = messages || [];
    localStorage.setItem(LS_CUR, id);
    // ⚠ 载入存档就一定要把开始页收掉。
    //   index.html 的内联脚本会在「localStorage 里没有存档」时提前把开始页画出来
    //   （静态托管下能省好几秒白屏），但**完整模式的存档在服务器上**，
    //   localStorage 是空的 —— 不收掉的话开始页会一直压在上面。
    UI.hideLanding();
    renderState(state);
    renderMessages(this.messages);
    renderSaves(await Backend.listSaves());
    $('turnHint').textContent = `共 ${state.turn} 回合`;
    updateRail();
    if (state.status === 'dead') UI.openDeath();
  },

  async newSave(name) {
    const { state } = await Backend.createSave(name);
    this.saveId = state.id;
    this.state = state;
    this.messages = [];
    renderState(state);
    this.els.inner.innerHTML = '';
    renderSaves(await Backend.listSaves());
    UI.closeModal();
    toast('旅途已创建，正在把你拉进灰雾……', 'ok');
    await this.send('（游戏开始，请用沉浸式的方式把我吸入主神空间，并给出第一个选择）', true);
  },

  /** 开局向导提交 */
  async createCharacter(w) {
    UI._syncCustom?.(w);
    const customOrigin = w.originMode === 'custom' ? w.customOrigin : null;
    const customTalent = w.talentMode === 'custom' ? w.customTalent : null;
    let state;
    if (Backend.mode === 'server') {
      const r = await fetch('./api/saves', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: w.name,
          gender: w.gender,
          age: w.age,
          originId: customOrigin ? null : w.originId,
          talentId: customTalent ? null : w.talentId,
          customOrigin, customTalent,
          attrs: w.attrs, difficulty: w.difficulty,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || '创建失败');
      state = j.save;
    } else {
      state = localCreateCharacter(w);
      Backend._put(state);
    }
    this.saveId = state.id;
    this.state = state;
    this.messages = [];
    renderState(state);
    this.els.inner.innerHTML = '';
    renderSaves(await Backend.listSaves());
    UI.closeModal();

    const d = window.GAME_DATA;
    const o = customOrigin || d?.origins.find(x => x.id === w.originId);
    const t = customTalent || d?.talents.find(x => x.id === w.talentId);
    this.addSystem(`${state.name} · ${o?.name || ''} · 天赋「${t?.name || ''}」`, 'good');
    this.addSystem('灰雾正在合拢 —— 正在生成开场，稍等一下（模型越强越慢）。');
    toast('角色已创建，正在把你拉走……', 'ok');
    // 开局直接就是「被主神拉走」：不需要玩家先说话，系统自动起一轮
    await this.send('（游戏开始。这是第一回合：我刚刚被主神拉走，请你直接从我被拉走的那一秒写起）', true);
  },

  async remove(id) {
    if (!confirm('删除这个存档？剧情与角色都会消失，无法恢复。')) return;
    await Backend.deleteSave(id);
    const saves = await Backend.listSaves();
    renderSaves(saves);
    if (this.saveId === id) {
      this.saveId = null; this.state = null;
      if (saves.length) await this.load(saves[0].id); else { this.renderEmpty(); UI.openNewSave(); }
    }
  },

  /* ── 发送一回合 ── */
  async send(text, isAuto = false) {
    if (this.busy || !this.state) return;
    const input = this.els.input;
    const action = (text ?? input.value).trim();
    if (!action) return;
    if (this.state.status === 'dead') { UI.openDeath(); return; }

    // ⚠ 页面可能在「服务器还没起来」的时候加载过 —— 那一刻 Backend.detect() 失败，
    //   前端就把自己定成了网页模式（local），之后服务器起来了它**不会自己恢复**，
    //   于是每一轮都失败（玩家看到的就是「怎么老失败」）。
    //   所以每轮开始前重探一次：只要能连上服务器，就切回完整模式。
    if (Backend.mode !== 'server') {
      const cameBack = await Backend.detect().catch(() => false);
      if (cameBack) {
        await Backend.getConfig().catch(() => {});
        this.addSystem('已连上本地服务器，切回完整模式（存档在 saves/ 目录）。', 'ok');
        renderState(this.state);
      }
    }

    this.busy = true;
    setComposerEnabled(false);
    closeChoices();
    if (!isAuto) { input.value = ''; autoGrow(); this.lastInput = action; }
    // 每轮开始前存快照 —— 「重塑 / 回退」都靠它（纯前端模式）。
    // 服务端是在 handleTurn 里做同样的事，这里补上，两边行为才一致。
    if (Backend.mode !== 'server') localTakeSnapshot(this.state);
    this.addPlayer(action);

    const { node, body } = this.addStreamingGM();

    try {
      // 自己带了 Key 就直连那家（别人的额度自己出）；
      // 否则走服务器（用服务器上的 Key，普通玩家什么都不用配）。
      if (Backend.mode === 'server' && !Backend.guestMode) {
        await this.turnServer(action, body);
      } else {
        await this.turnLocal(action, body);
      }
    } catch (e) {
      this.addSystem(`❌ ${e.message}`, 'bad');
    } finally {
      body.classList.remove('cursor');
      this.busy = false;
      setComposerEnabled(true);
      renderState(this.state);
      $('turnHint').textContent = `共 ${this.state.turn} 回合`;
      if (this.state.status === 'dead') UI.openDeath();
      this.els.input.focus();
    }
  },

  async turnServer(action, body) {
    // 流式过程中累积的**原始文本**。以前是直接读 body.textContent ——
    // 那在把显示层改成格式化 HTML 之后就读不到了（会读到带标签的文本），
    // 所以原始文本必须自己留着。
    let raw = '';
    const resp = await fetch(`./api/saves/${this.saveId}/turn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    if (!resp.ok) {
      const t = await resp.text();
      let msg = t.slice(0, 200);
      try { msg = JSON.parse(t).error || msg; } catch { /* ignore */ }
      throw new Error(msg);
    }
    await readSSE(resp, ev => {
      if (ev.type === 'delta') { raw += ev.text; paintStream(body, raw); body.classList.add('cursor'); scrollIfNear(); }
      else if (ev.type === 'check') { this.pendingCheck = ev.check; }
      else if (ev.type === 'settling') { this._settleNode = this.addSystem('⏳ 主神正在结算本轮结果……'); }
      else if (ev.type === 'state') { this.state = { ...this.state, ...ev.state, messages: undefined }; }
      else if (ev.type === 'events' && ev.events?.length) {
        for (const e of ev.events) if (e) this.addSystem(e, 'warn');
      } else if (ev.type === 'error') { this.addSystem(`⚠ ${ev.message}`, 'bad'); }
    });
    if (this._settleNode) { this._settleNode.remove(); this._settleNode = null; }
    const rawText = raw;
    this.messages.push({ role: 'player', content: action, at: nowISO() });
    this.messages.push({ role: 'gm', content: rawText, at: nowISO() });
    // 正文里的选项行改成按钮，正文只留叙事（同样要过 formatGm 才有配色）
    body.innerHTML = formatGm(splitOptions(rawText).body);
    // 把判定结果插在这段叙事前面
    if (this.pendingCheck) { insertCheckCard(body, this.pendingCheck); this.pendingCheck = null; }
    renderChoices(rawText);
    if (Backend.mode === 'server') renderSaves(await Backend.listSaves());
  },

  async turnLocal(action, body) {
    const cfg = Backend.cfg;
    if (cfg.provider === 'offline') {
      // 最常见的原因不是「没配接口」，而是**页面加载时没连上服务器**，
      // 前端就落到了网页模式。所以先把这句话放在最前面。
      throw new Error(
        '现在跑的是网页模式（没连上本地服务器）。\n'
        + '最可能的原因：这一页是在服务器还没起来的时候打开的。\n'
        + '解决：先确认「启动游戏.bat」那个黑窗口还在跑，然后按 Ctrl+F5 刷新本页；\n'
        + '刷新后会自动连上完整模式。\n'
        + '如果你确实想用网页模式，就到右上角「设置」里配一个 API。'
      );
    }
    // 「用这个网站自带的接口」：不需要 baseUrl / model / key，全交给服务器
    if (!Backend.hostRelay) {
      if (!cfg.baseUrl || !cfg.model) throw new Error('还没有配置接口地址或模型名，请点右上角「设置」。');
      if ((PROVIDERS[cfg.provider] || {}).needsKey && !cfg.apiKey) throw new Error('这个厂商需要 API Key，请在「设置」里填写。');
    }

    // ── 中转站里的「出站 / 推门」：玩家在正文里说出来也要算数 ──
    // 网页模式以前只有界面按钮能换阶段，玩家打字说「我出站回现实」时
    // 状态还停在 hub —— 顶栏一直显示「主神空间」，看着就像卡死在里面。
    // 必须在拼提示词**之前**改，这样 AI 拿到的就是新阶段。
    if (this.state.phase === 'hub') {
      const a = String(action || '');
      const wantLeave = /出站|回现实|回(?:到)?(?:家|自己的?生活)|离开这|不去了/.test(a)
        && !/推门|那扇门|进任务/.test(a);
      const wantDepart = /推门|那扇门|进任务|进那扇门|去(?:那个|这个|下一个|另一个)?世界/.test(a);
      if (wantLeave) {
        this.state.phase = 'life';
        this.state.missionAt = null;
        this.addSystem('【出站】你回到了现实生活。下一次被主神拉走的时间重新开始数。', 'good');
      } else if (wantDepart) {
        const work = this.state.pendingWork || '';
        localStartMission(this.state, {});
        if (work) this.state.mission = { ...(this.state.mission || {}), work };
        this.state.pendingWork = null;
        this.state.phase = 'mission';
        this.addSystem(`【主神任务】《${this.state.mission?.work || '未知'}》—— 你推门进去了。`, 'good');
        this._put(this.state);
      }
    }

    // 纯前端模式的提示词要自己拼，这时才需要人物档案包
    const prompt = await Backend.getPrompt();
    const sys = prompt.includes('<<<STATE') ? prompt : `${prompt}\n\n${STATE_PROTOCOL}`;

    // 有副本时先掷骰，结果作为既成事实交给 AI
    const check = this.state.dungeon ? localRollCheck(this.state, action) : null;
    if (check) {
      this.state.checks = (this.state.checks || []).slice(-30);
      this.state.checks.push({ turn: this.state.turn + 1, ...check });
    }

    // 提示词按服务端 buildMessages 的顺序拼：阶段 → 能力说明 → 面板 → 风格 → 大纲 → 世界书…
    // 世界书是按需加载的，这里先确保拿到（第一次会稍微等一下，之后走缓存）
    if (this.state.mission) await ensureWorldBooks();
    const bookTier = (this.state.mission?.turnsSeen || 0) <= 1 ? 'full' : 'entry';
    const ctx = [localPhasePrompt(this.state), localOutlinePrompt(this.state),
    localWorldProgressPrompt(this.state), localCharacterPrompt(this.state), localStateBlock(this.state)];
    // 世界书 + 「这个世界是系统派定的」—— 以前网页模式**完全没有这两段**，
    // 于是 AI 不知道原著设定和人物，只会照着任务名瞎编。
    const wb = this.state.mission ? localWorldBookBlock(this.state, bookTier) : '';
    if (wb) ctx.push(wb);
    const pin = this.state.mission ? localWorldPinBlock(this.state) : '';
    if (pin) ctx.push(pin);
    if (check) ctx.push(localJudgmentPrompt(action, check));

    const msgs = [{ role: 'system', content: sys }, { role: 'system', content: ctx.join('\n\n') }];
    if (this.state.summary) msgs.push({ role: 'system', content: `【前情提要】${this.state.summary}` });
    const hist = this.messages.slice(-(cfg.historyWindow || 18));
    for (const m of hist) {
      if (m.role === 'player') msgs.push({ role: 'user', content: m.content });
      else if (m.role === 'gm') msgs.push({ role: 'assistant', content: m.content });
    }
    msgs.push({ role: 'user', content: action });

    const payload = {
      model: cfg.model === 'host' ? undefined : cfg.model,
      messages: msgs, stream: true,
      temperature: Number(cfg.temperature) || 0.9,
      max_tokens: Number(cfg.maxTokens) || 1200,
    };
    if (!payload.model) delete payload.model;   // 中转模式下模型名由服务器定

    let resp;
    if (Backend.hostRelay) {
      // 走同源中转：服务器用它的 Key 转发，顺带绕过接口不给跨域的问题
      resp = await fetch('./api/relay', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload }),
      });
      if (!resp.ok && resp.status !== 502) {
        const t = await resp.text();
        throw new Error(`中转失败 HTTP ${resp.status}：${t.slice(0, 200)}`);
      }
    } else {
      const headers = { 'Content-Type': 'application/json' };
      if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
      resp = await fetch(cfg.baseUrl.replace(/\/+$/, '') + '/chat/completions', {
        method: 'POST', headers, body: JSON.stringify(payload),
      });
    }
    if (!resp.ok) {
      const t = await resp.text();
      // 401/403 在网页版里几乎只有一个原因：这个浏览器里存的那份接口配置
      // （baseUrl / key）已经失效了 —— 换过接口、或者那把 key 被停用。
      // 光甩一串原始 JSON 没人看得懂，这里直接把出路写出来。
      if (resp.status === 401 || resp.status === 403) {
        throw new Error(
          `接口拒绝了这次请求（HTTP ${resp.status}）：当前用的 key 无效或已失效。\n`
          + `现在连的是：${cfg.baseUrl}　模型：${cfg.model}\n`
          + '去右上角「设置」→「接口与设置」里换一把能用的 key（地址、模型要跟 key 配套）。\n'
          + `原始返回：${t.slice(0, 160)}`,
        );
      }
      throw new Error(`接口返回 HTTP ${resp.status}：${t.slice(0, 240)}`);
    }

    // ⚠ 流式过程中也要走 formatGm（以前是 body.textContent += txt，纯文本，
    //   所以对话/心理/环境的配色要刷新页面才出现）。
    //   每来一小段就重解析全部文本确实有点浪费，所以按时间节流到 ~80ms。
    let lastPaint = 0;
    const painter = () => {
      const now = Date.now();
      if (now - lastPaint < 80) return;
      lastPaint = now;
      paintStream(body, gate.raw);
      body.classList.add('cursor');
      scrollIfNear();
    };
    const gate = new ProtocolGate(painter);
    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line || line.startsWith(':')) continue;
        const data = line.startsWith('data:') ? line.slice(5).trim() : line;
        if (data === '[DONE]') { buf = ''; break; }
        let o; try { o = JSON.parse(data); } catch { continue; }
        const piece = o.choices?.[0]?.delta?.content ?? o.choices?.[0]?.message?.content ?? '';
        if (piece) gate.push(piece);
      }
    }
    gate.finish();
    const raw = gate.raw;
    const parsed = extractState(raw);
    // ⚠ 必须 let —— 中转站那段会把它改写（曾经写成 const，
    //   于是「中转站改时间戳」这行直接抛 Assignment to constant variable，
    //   整个回合在落盘前中断：存档不写、回退失效，而且只在 hub 才触发，很难查）。
    let shown = stripState(raw) || '（主神空间沉默了片刻，没有回应。）';

    this.state.turn += 1;
    this.messages.push({ role: 'player', content: action, at: nowISO() });
    // 存**剥掉状态块**的正文 —— 跟服务端一致（服务端存的也是 stripState 之后的）。
    // 渲染路径还会再 stripState 一次，那只是防御，正常这里是干净的。
    this.messages.push({ role: 'gm', content: shown, at: nowISO() });

    const events = applyDelta(this.state, parsed || heuristicDelta(shown));
    for (const e of events) if (e) this.addSystem(e, 'warn');

    // ── 时钟对账（和服务端同规则）──
    // 模型几乎不报 advance（实测 73 回合 0 次），但它在正文里**一直写着绝对时间**。
    // 以前只按「每轮 1 分钟」兜底，等于时间冻住 —— 顶栏一直显示同一个时刻。
    // 现实世界的时间推进（任务世界和中转站都不动这个日历）
    if (this.state.phase === 'life') {
      const asked = parsed && Number(parsed.advance);
      let moved = asked ? localTick(this.state, asked) : 0;
      if (!moved) moved = localAlignClockToStamp(this.state, shown);
      // ⚠ 对齐不动（模型照抄了和现在一样的时间戳）时按正文措辞估时长。
      //   以前固定 1 分钟/轮，而任务派发窗口是一周 —— 时钟等于永远不动。
      if (!moved) moved = localTick(this.state, localGuessAdvance(shown), { cap: MAX_GUESS_ADVANCE });
      if (moved > 1) this.addSystem(`时间推进 ${localHumanDuration(moved)} → ${localClockText(this.state)}`, 'warn');
    } else if ((this.state.phase === 'hub' || this.state.phase === 'mission') && shown) {
      // 中转站 / 任务世界：顶栏那个日历是冻结的，正文的日期要摁回去，
      // 否则模型会顺着旧消息把日期编回去（实测 1月3日 被写回 1月1日 00:08）
      const fixed = localNormalizeStamp(shown, localClockText(this.state));
      if (fixed !== shown) { shown = fixed; this.messages[this.messages.length - 1].content = fixed; }
    }
    // 不管哪个阶段，都按真值把 HP / 体力的**分母**改对 ——
    // 模型会照抄旧的「体力:133/135」，而实际上限早涨到 208 了。
    if (shown) {
      const fixed2 = localNormalizeStamp(shown, '', { maxHp: this.state.maxHp, maxSta: this.state.maxSta });
      if (fixed2 !== shown) { shown = fixed2; this.messages[this.messages.length - 1].content = fixed2; }
    }

    // 滚动摘要 + 落盘
    const win = cfg.historyWindow || 18;
    // ⚠ 以前这里是 this.messages = this.messages.slice(-win)，把**完整历史砍成最后 18 条**，
    // 于是「回退」退不回上一轮（消息已经没了），导出的小说也缺前半段。
    // 现在完整历史留在 state.messages 里，喂给模型时再切窗口（上面 hist 那一段已经这么做了）。
    this.state.messages = this.messages;
    if (this.messages.length > win * 2) {
      const old = this.messages.slice(0, this.messages.length - win);
      this.state.summary = old.map(m => `${m.role === 'player' ? '玩家' : 'GM'}：${m.content.replace(/\s+/g, ' ').slice(0, 90)}`).join(' / ').slice(-1500);
    }
    Backend._put(this.state);
    // 收尾重画一次（和流式用同一个函数，保证颜色一致）
    body.innerHTML = formatGm(splitOptions(shown).body);
    if (check) insertCheckCard(body, check);
    renderChoices(shown);
    localRefresh(this.state);
    renderState(this.state);
    renderSaves(await Backend.listSaves());
  },

  /* ── DOM 输出 ── */
  addPlayer(text) {
    const d = document.createElement('div');
    d.className = 'msg player';
    d.innerHTML = `<div class="body">${esc(text)}</div>`;
    this.els.inner.appendChild(d);
    scrollBottom();
    return d;
  },

  addSystem(text, kind = '') {
    const d = document.createElement('div');
    d.className = 'msg system' + (kind ? ' ' + kind : '');
    d.innerHTML = `<div class="body">${esc(text)}</div>`;
    this.els.inner.appendChild(d);
    scrollIfNear();
    return d;
  },

  addStreamingGM() {
    const d = document.createElement('div');
    d.className = 'msg gm';
    d.innerHTML = `<div class="body cursor"></div>`;
    this.els.inner.appendChild(d);
    scrollBottom();
    return { node: d, body: d.querySelector('.body') };
  },
};

/* ── SSE 读取 ── */
async function readSSE(resp, onEvent) {
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i); buf = buf.slice(i + 2);
      for (const line of block.split('\n')) {
        if (!line.startsWith('data:')) continue;
        try { onEvent(JSON.parse(line.slice(5).trim())); } catch { /* ignore */ }
      }
    }
  }
}

/* ── 纯前端模式的骰子判定（与服务端 lib/rules.mjs 同规则） ── */
const CHECK_PATTERNS = [
  { attr: 'con', kind: 'endure', label: '体质', re: /(硬抗|硬扛|承受|忍住|咬牙|撑住|扛下|顶住|徒手|举起|搬开|撞开|蛮力|屏息|憋气)/ },
  { attr: 'agi', kind: 'combat', label: '敏捷', re: /(攻击|出手|开枪|射击|砍|刺|挥|打|搏斗|扭打|偷袭|先手|闪避|躲开|翻滚|跳|攀爬)/ },
  { attr: 'agi', kind: 'move', label: '敏捷', re: /(逃|跑|撤|溜|潜行|潜|藏|隐蔽|绕开|脱离|爬|翻越|窜)/ },
  { attr: 'int', kind: 'investigate', label: '智识', re: /(观察|检查|搜查|翻找|研究|分析|推理|破解|拆解|辨认|阅读|记录|测量|试探|实验|计算|看|找)/ },
  { attr: 'wil', kind: 'social', label: '意志', re: /(问|说|谈|聊|交涉|说服|劝|骗|撒谎|威胁|吓|安抚|喊话|求|恳求|命令|对话)/ },
  { attr: 'wil', kind: 'resist', label: '意志', re: /(抵抗|镇定|冷静|忍住恐惧|不去看|闭上眼|集中|冥想|压住)/ },
];
const RANK_DC_CLIENT = { F: 8, E: 10, D: 12, C: 14, B: 16, A: 19, S: 22 };

function localRollCheck(save, action) {
  const d = window.GAME_DATA;
  const p = CHECK_PATTERNS.find(x => x.re.test(String(action))) || { attr: 'luk', kind: 'luck', label: '幸运' };
  const tot = save.totalAttrs || save.attrs || {};
  const cmb = save.combat || {};
  let mod = Math.floor(((tot[p.attr] ?? 10) - 10) / 2);
  if (p.kind === 'combat' && cmb.atk) mod += Math.floor(cmb.atk / 5);
  if (p.kind === 'endure' && cmb.def) mod += Math.floor(cmb.def / 5);
  if (p.kind === 'resist' && cmb.def) mod += Math.floor(cmb.def / 8);

  const base = save.dungeon ? (RANK_DC_CLIENT[save.dungeon.rank] ?? 10) : 8;
  const diff = d?.difficulties.find(x => x.id === save.difficulty) || {};
  const dc = base + (diff.dcBias || 0);

  const die = 1 + Math.floor(Math.random() * 20);
  const total = die + mod;
  const critAt = 20 - Math.max(0, Math.floor(((tot.luk ?? 10) - 5) / 4));
  let outcome, tone;
  if (die === 1) { outcome = '大失败'; tone = 'crit-fail'; }
  else if (die >= critAt || total >= dc + 5) { outcome = '大成功'; tone = 'crit'; }
  else if (total >= dc) { outcome = '成功'; tone = 'ok'; }
  else if (total >= dc - 3) { outcome = '勉强成功'; tone = 'partial'; }
  else { outcome = '失败'; tone = 'fail'; }
  return { attr: p.attr, kind: p.kind, label: p.label, die, mod, total, dc, outcome, tone };
}

/** 判定结果 → 喂给 AI 的指令段 */
function localJudgmentPrompt(action, c) {
  return `[本次行动 · 系统判定结果 —— 这是程序掷骰得出的，不可更改]
玩家输入：${action}
判定属性：${c.label}　d20=${c.die}　修正 ${c.mod >= 0 ? '+' : ''}${c.mod}　合计 ${c.total}　难度 DC ${c.dc}
结果：${c.outcome}

叙事要求：
- 这个结果是程序用真随机骰子算出来的，你不能改写它，只能围绕它编故事。
- 大成功：给超出预期的收获。成功：行动达成预期。
- 勉强成功：目标达成但付出代价。失败：目标没达成，局势恶化。
- 大失败：严重后果 —— 受伤、体力流失、引来强敌或失去某样东西。
- 无论什么结果都要继续推进，不要卡住玩家。`;
}

/** 当前时间与阶段（纯前端模式） */
function localPhasePrompt(save) {
  const now = localClockText(save);
  if (save.phase === 'mission') {
    const m = save.mission || {};
    return `[当前阶段] **主神任务进行中**　现实时间停在「${now}」
任务：${m.name || '（未命名）'}${m.rank ? `　难度 ${m.rank} 级` : ''}
${m.brief ? `简报：${m.brief}` : ''}
**现实世界的时间是停住的。** 玩家现在不在现实世界。写完这个任务的结局后，在状态块里写：
　"mission":{"status":"已结算"}　—— 系统会先把玩家收回**主神空间**（中转站，HP 与体力回满），
在那里他还能兑换东西、指定下一次去哪，然后自己出站回现实。**不要直接写他回到了家里。**`;
  }
  if (save.phase === 'hub') {
    const free = save.freeWorldPick === true;
    return `[当前阶段] **主神空间 · 中转站**　（这里不属于任何时间线，现实的时间是停的）
玩家现在站在现实与任务世界之间的中转站里。这里能做的事：
1. **看系统面板**：等级、积分、属性、装备、技能/血统、已经去过哪些世界
2. **兑换**：拿积分在主神商店买东西（界面由系统处理，不由你代劳）
3. **指定下一个去的世界**：${save.pendingWork
        ? `他已经指定了《${save.pendingWork}》—— 推门就去那里`
        : free
          ? '**主神送了他第一次免费指定**（现在挑一个世界不要积分）—— 一定要在叙事里说出来'
          : '花积分可以指定'}
4. **出站回现实**：回到自己的生活，重新开始数七天
5. **推开那一扇门**：进入任务世界。玩家推门之后由系统接管派发任务，
   你**不要**自己开始写任务世界的内容 —— 等他真的进去了再写。
玩家的积分是 ${(save.score || 0).toLocaleString()}。
**语气**：主神不解释、不安慰、不鼓励，只派活和收账。可以借一个冷淡但熟悉流程的声音
把规矩交代清楚，然后给他 3~5 个具体的选项（看面板 / 挑一个地方 / 去兑换 / 推门 / 出站）。

**阶段切换由系统接管**：玩家只要说「推门」「出站」「回现实」（或者界面按钮），
系统就会真的把阶段切过去。你**不要**替他把状态改了 —— 也不要在这一轮就写
"他推开门，眼前是任务世界" 或 "他回到了家里"。等系统切完，下一轮再写那里的样子。`;
  }
  const cd = localCountdown(save);
  if (cd.minutes === 0) {
    return `[当前阶段] **时间到了** —— 该来的那一课到了（现在是「${now}」）。
这一轮**必须**把玩家拉进主神空间（中转站）：写他被吸走、眼前换成那片灰雾。
在状态块里写：　"mission":{"status":"进入主神空间"}
**注意**：先只到中转站，别直接进任务世界 —— 他要在那儿看面板、决定去哪，再自己推门。`;
  }
  return `[当前阶段] 现实生活　｜　现在是「${now}」　｜　距离下一次主神任务 ${cd.text}
玩家现在在过自己的日子。**不要催他去做任务**，也不要在叙事里反复提倒计时 ——
让日常自己长出来。只有当玩家主动问起、或者「不对劲」的事发生时，才让主神的影子露一下。

**现实里不会有任务。** 不要在这阶段写"主神派了个任务""你被扔进某个世界""任务简报"之类的东西 ——
玩家明确要求过：现实就是过日子，不能被任务打断。倒计时到了是**你先把他拉进中转站**，
在那之前任务世界连边都不该露。

时间按剧情走：这轮剧情实际花了多久，就在状态块里报多少分钟的 advance。`;
}

/**
 * 大纲素材库（纯前端模式）。
 * 服务端模式下这段提示词是服务器拼的，这里只是把同样的逻辑搬一份到浏览器里。
 */
function localOutlinePrompt(save) {
  const o = window.GAME_OUTLINE;
  if (!o) return '[大纲] 素材库没加载 —— 请自行发挥，按现代都市 + 每周一次主神任务的节奏来。';
  const out = [];
  if (o.PREMISE) out.push(`[这个世界的基本盘]\n${o.PREMISE}`);
  const slot = Math.floor(localMinutes(save) / MINUTES_PER_SLOT);

  const hooks = o.MISSION_HOOKS || [];
  if (hooks.length) {
    // 和服务端同规则：用存档自己的随机偏移，不然每局开局抽到的都是同一批世界。
    // 注意这里只给 AI 一份"灵感清单"，服务端才是真正派任务的那一方；
    // 种子为 0/缺失就补一个真随机值，否则清单永远停在同一段。
    if (!Number.isFinite(save.outlineSeed) || save.outlineSeed <= 0) save.outlineSeed = 1 + Math.floor(Math.random() * 999999999);
    const n = Math.min(14, hooks.length);
    const start = ((save.outlineSeed + slot * 5) % hooks.length + hooks.length) % hooks.length;
    const pick = Array.from({ length: n }, (_, i) => hooks[(start + i) % hooks.length]);
    out.push('[任务世界灵感 · 用真实作品的世界。可以照用、可以改、也可以自己另选一个]\n'
      + pick.map(h => h.work
        ? `　· [${h.tag}/${h.rank}] 《${h.work}》${h.world} —— ${h.hook}（变数：${h.twist}）`
        : `　· [${h.tag}/${h.rank}] ${h.title} —— ${h.hook}（${h.twist}）`).join('\n'));
  }
  const frames = o.MISSION_FRAMES || [];
  if (frames.length) out.push('[任务形式]\n' + frames.map(f => `　· ${f.name}：${f.desc}（压力来源：${f.pressure}）`).join('\n'));

  const tex = o.LIFE_TEXTURE || {};
  const cats = Object.keys(tex);
  if (cats.length) {
    const pick2 = arr => {
      if (!arr?.length) return [];
      const s = (slot * 3 + arr.length) % arr.length;
      return Array.from({ length: Math.min(2, arr.length) }, (_, i) => arr[(s + i) % arr.length]);
    };
    out.push('[现实生活的质感 · 写日常时随手取用]\n' + cats.map(c => `　${c}：${pick2(tex[c]).join('　／　')}`).join('\n'));
  }
  const roles = o.CITY_ROLES || [];
  if (roles.length) {
    const s = (slot * 2) % roles.length;
    const pick3 = Array.from({ length: Math.min(8, roles.length) }, (_, i) => roles[(s + i) % roles.length]);
    out.push('[现实里会遇到的人]\n' + pick3.map(r => `　· ${r.role}：${r.note}`).join('\n'));
  }
  return out.join('\n\n');
}

/** 魅力决定好感涨得多快（与服务端 favorGainMult 同规则） */
function localFavorMult(save) {
  const cha = (save.totalAttrs || save.attrs || {}).cha ?? 10;
  return Math.max(0.4, Math.min(2.2, 1 + (cha - 10) * 0.05));
}
// （本地模式原本复刻了一份 romanceCap —— 服务端删掉恋爱线后，这里也一起删了）

/* ── 时间推进（与服务端 lib/rules.mjs 同规则：一条分钟轴） ── */
const TIME_SLOTS = ['清晨', '上午', '下午', '夜晚'];
const MINUTES_PER_SLOT = 240, MINUTES_PER_DAY = 1440, SLOTS_PER_WEEK = 28;
const MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY;
/** 从正文措辞估算时间跨度时允许的最大值（约半年）—— 和服务端 MAX_GUESS_ADVANCE 一致。
 *  给模型报的 advance 那道「一天」护栏不该拿来截断玩家明说的「几天后」。 */
const MAX_GUESS_ADVANCE = MINUTES_PER_DAY * 190;

/** 读本地存档的时钟（绝对分钟）。旧存档的 clock.slot 是「格」，换算成分钟。 */
function localMinutes(s) {
  s.clock ??= {};
  if (!Number.isFinite(s.clock.minutes)) {
    s.clock.minutes = Math.max(0, Math.round(Number(s.clock.slot) || 0)) * MINUTES_PER_SLOT;
  }
  s.clock.minutes = Math.max(0, Math.round(s.clock.minutes));
  delete s.clock.slot;
  return s.clock.minutes;
}

function localPartOfDay(minuteOfDay) {
  const m = Math.max(0, Math.min(MINUTES_PER_DAY - 1, minuteOfDay));
  if (m >= 300 && m < 540) return '清晨';
  if (m >= 540 && m < 720) return '上午';
  if (m >= 720 && m < 1080) return '下午';
  return '夜晚';
}

function localClockText(s) {
  const minutes = localMinutes(s);
  const dayIdx = Math.floor(minutes / MINUTES_PER_DAY);
  const mod = minutes % MINUTES_PER_DAY;
  const p2 = n => String(n).padStart(2, '0');
  const d = new Date(Date.UTC(2026, 0, 1 + dayIdx));
  return `${d.getUTCFullYear() % 100}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日 ${p2(Math.floor(mod / 60))}:${p2(mod % 60)}`;
}

function localHumanDuration(mins) {
  const t = Math.max(0, Math.round(mins));
  if (!t) return '0 分';
  const d = Math.floor(t / MINUTES_PER_DAY), h = Math.floor((t % MINUTES_PER_DAY) / 60), m = t % 60;
  return [d ? `${d} 天` : '', h ? `${h} 小时` : '', (m || (!d && !h)) ? `${m} 分` : ''].filter(Boolean).join(' ') || '不到 1 分';
}

/* ── 时钟对账（和服务端 lib/rules.mjs 同规则）──
   模型写在正文里的是**绝对时间**，程序以前只认状态块的**增量**（advance），
   而模型几乎不报 advance —— 于是时钟永远停在开局那一刻。
   这里读它写的绝对时间，把时钟对齐过去。 */
function localParseClockStamp(text) {
  const m = /(?:^|【|\s)(\d{2,4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日[^\d]{0,6}(\d{1,2})\s*[：:]\s*(\d{2})/.exec(String(text || ''));
  if (!m) return null;
  const year = Number(m[1]) < 100 ? 2000 + Number(m[1]) : Number(m[1]);
  const month = Number(m[2]), date = Number(m[3]), hh = Number(m[4]), mm = Number(m[5]);
  if (month < 1 || month > 12 || date < 1 || date > 31 || hh > 23 || mm > 59) return null;
  const months = (year - 2026) * 12 + (month - 1);
  const days = months * 30 + (date - 1);
  if (days < 0) return null;
  return days * MINUTES_PER_DAY + hh * 60 + mm;
}
/** 从正文措辞估「这一轮过了多久」（分钟）—— 和服务端 guessAdvanceFromProse 同规则。
 *  模型不报 advance、又在正文里照抄同一个时间戳时，靠它让时钟继续走。 */
function localGuessAdvance(text) {
  const s = String(text || '');
  if (!s) return 10;
  if (/半年后|一年后/.test(s)) return 180 * MINUTES_PER_DAY;
  if (/一个月后|下个月/.test(s)) return 30 * MINUTES_PER_DAY;
  if (/半个月|两周后/.test(s)) return 15 * MINUTES_PER_DAY;
  if (/一周后|一星期后|七天后|整整一周/.test(s)) return 7 * MINUTES_PER_DAY;
  if (/几天后|数日后|三天后|两天后|过了几天/.test(s)) return 3 * MINUTES_PER_DAY;
  if (/第二天|次日|隔天|一夜|整夜|通宵|睡到天亮|醒来时.{0,6}(天亮|阳光|太阳)/.test(s)) return 8 * 60;
  if (/午睡|打了个盹|小睡|眯了一会儿|补觉/.test(s)) return 90;
  if (/傍晚|黄昏|天色.{0,3}(暗|黑)|日落|入夜|华灯初上/.test(s)) return 5 * 60;
  if (/中午|正午|午饭|午餐/.test(s)) return 3 * 60;
  if (/凌晨|后半夜|天快亮|破晓/.test(s)) return 4 * 60;
  if (/通勤|地铁|公交|开车|路上|赶路|长途|飞机|火车|高铁|出差|跨城/.test(s)) return 60;
  if (/出门|走到|上楼|下楼|进门|回家|到了.{0,4}(楼下|门口|公司|单位)/.test(s)) return 15;
  if (/睡|躺下|闭眼|休息/.test(s)) return 60;
  if (/吃饭|喝酒|喝茶|咖啡|聊了|坐了一会儿|发呆|看电视|刷手机/.test(s)) return 30;
  return 20;
}
/** 把本地时钟对齐到正文里写的绝对时间（只往前；离谱的退回最多一天） */
function localAlignClockToStamp(s, text) {
  const target = localParseClockStamp(text);
  if (target === null) return 0;
  const now = localMinutes(s);
  const delta = target - now;
  if (delta <= 0) return 0;
  if (delta <= MINUTES_PER_DAY * 31) {
    s.clock.minutes = target;
    s.day = Math.floor(target / MINUTES_PER_DAY) + 1;
    s.week = Math.floor(target / MINUTES_PER_WEEK) + 1;
    return delta;
  }
  return localTick(s, MINUTES_PER_DAY);
}
/** 状态行归一：日期时间换成 want（空则不动），HP / 体力分母换成真上限。
 *  和服务端 lib/rules.mjs 的 normalizeStampLine 同规则。只动【…】里面。 */
function localNormalizeStamp(text, want, limits = {}) {
  const src = String(text || '');
  const m = /【[^】]{0,200}】/.exec(src);
  if (!m) return src;
  let blk = m[0];
  let changed = false;
  if (want) {
    const after = blk.replace(/【\s*\d{2,4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日[^|】]{0,12}?\|/, `【${want} |`);
    if (after !== blk) { blk = after; changed = true; }
  }
  if (limits.maxHp > 0) {
    const after = blk.replace(/(HP|生命|血量|气血)\s*[:：]?\s*(\d+)\s*\/\s*\d+/i, (s, k, cur) => `${k}:${cur}/${limits.maxHp}`);
    if (after !== blk) { blk = after; changed = true; }
  }
  if (limits.maxSta > 0) {
    const after = blk.replace(/(体力|耐力|精力|STA)\s*[:：]?\s*(\d+)\s*\/\s*\d+/i, (s, k, cur) => `${k}:${cur}/${limits.maxSta}`);
    if (after !== blk) { blk = after; changed = true; }
  }
  return changed ? src.slice(0, m.index) + blk + src.slice(m.index + m[0].length) : src;
}

function localCountdown(s) {
  if (s.phase === 'mission') return { minutes: 0, slots: 0, days: 0, text: '主神任务进行中' };
  const left = Math.max(0, localDispatchAt(s) - localMinutes(s));
  return {
    minutes: left,
    slots: Math.ceil(left / MINUTES_PER_SLOT),
    days: Math.floor(left / MINUTES_PER_DAY),
    text: left === 0 ? '任务时间到了' : `还有 ${localHumanDuration(left)}`,
  };
}

/**
 * 主神会在哪个绝对分钟把人拉走。
 * 服务端同规则：随机定死一个时刻（不再固定在一周走满那一刻），
 * 只会在当前时刻之后抽 —— 抽到过去的话任务立刻到期，现实生活就过不成了。
 * 定死是为了让倒计时准确；存进存档，刷新页面不会重掷。
 */
function localDispatchAt(s) {
  const now = localMinutes(s);
  // 只在没抽过的时候抽：走到派发时刻那一分钟两者相等，
  // 若按「过期就重抽」会把到点判成过期，任务永远到不了。
  if (Number.isFinite(s.missionAt)) return s.missionAt;
  s.missionAt = now + 1 + Math.floor(Math.random() * MINUTES_PER_WEEK);
  return s.missionAt;
}

/**
 * 时间往前走。单位是分钟。
 * cap 默认一天（那是给模型报的 advance 用的护栏）；
 * 从正文措辞估算出的跨度（「几天后」）可以传更大的 cap。
 */
function localTick(s, minutes = 1, opt = {}) {
  // 任务世界和中转站都不推进这个日历（它记的是「现实世界」的日子）
  if (s.phase === 'mission' || s.phase === 'hub') return 0;
  const skipToMission = opt === true || opt?.skipToMission === true;
  const cap = opt?.cap || MINUTES_PER_DAY;
  const before = localMinutes(s);
  const step = skipToMission
    ? Math.max(0, localDispatchAt(s) - before)
    : Math.max(0, Math.min(cap, Math.round(minutes) || 0));
  s.clock.minutes = before + step;
  s.day = Math.floor(s.clock.minutes / MINUTES_PER_DAY) + 1;
  s.week = Math.floor(s.clock.minutes / MINUTES_PER_WEEK) + 1;
  return s.clock.minutes - before;
}
/**
 * 纯前端模式派发任务。
 * 顺序和服务端 startMission 一致：
 *   调用方给的钩子 → **玩家指定过的世界**（pendingWork）→ 从大纲里随机抽。
 * 以前这里只是把 info 抄进 mission，既不管 pendingWork 也不管钩子，
 * 于是「指定了世界却去了别处」、世界书也对不上。
 */
function localStartMission(s, info = {}) {
  if (s.phase === 'mission') return null;

  const hooks = (window.GAME_OUTLINE || window.GAME_DATA?.outline || {}).MISSION_HOOKS || [];
  const workOf = w => {
    const b = localWorldBookByWork(w);
    const names = new Set([w, b?.canon, b?.name].filter(Boolean));
    return hooks.find(h => names.has(h.work)) || null;
  };
  const wantedHook = info.hook || workOf(s.pendingWork);
  const pool = hooks.filter(h => h.work);
  const hook = wantedHook || pool[Math.floor(Math.random() * pool.length)] || null;
  if (!info.hook && wantedHook) s.pendingWork = null;   // 指定过的坐标只兑现一次

  s.phase = 'mission';
  s.mission = {
    name: String(info.name || hook?.work || '未命名任务').slice(0, 24),
    brief: String(info.brief || hook?.hook || '').slice(0, 160),
    rank: String(info.rank || hook?.rank || 'E').toUpperCase().slice(0, 1),
    startedSlot: localMinutes(s),
    turnsSeen: 0,
    // 世界书和「这个世界是系统派定的」都靠这两个字段
    work: hook?.work || '',
    world: hook?.world || '',
    hookText: hook?.hook || '',
    twist: hook?.twist || '',
    tag: hook?.tag || '',
    style: hook?.style || 'combat',
    bookId: localWorldBookByWork(hook?.work)?.id || '',
    bookName: localWorldBookByWork(hook?.work)?.canon || hook?.work || '',
  };
  localSeedCanonNpcs(s);
  return s.mission;
}

/**
 * 把这个世界书里的 5 个原著人物放进名录（纯前端版，对应服务端 seedCanonNpcs）。
 * 他们会带着完整档案进场：外貌、说话风格、好感变化规则。
 */
function localSeedCanonNpcs(s) {
  const work = s.mission?.work;
  if (!work) return 0;
  const book = localWorldBookByWork(work);
  if (!book?.npcs?.length) return 0;
  s.worldState = s.worldState || { quests: [], npcs: [], faction: '' };
  s.worldState.npcs = s.worldState.npcs || [];
  let n = 0;
  for (const src of book.npcs) {
    const cur = s.worldState.npcs.find(x => x.name === src.name)
      || s.worldState.npcs.find(x => localSamePower(x, src));
    // 世界书这版的指纹：只有它变了才刷新原著字段，否则每次推门都把玩家改过的东西冲掉
    const lore = localLoreFingerprint(src);
    const fields = {
      identity: src.identity, role: src.role, gender: src.gender, age: src.age, race: src.race,
      faction: src.faction, appearance: src.appearance, traits: src.traits, voice: src.voice,
      // ⚠ 模型报人物时用的字段名是 note（不是 personality）。
      //   以前这里写的是 personality，于是网页模式里「性格」这一项永远是空的。
      note: src.personality, hook: src.hook, favorHint: src.favorHint, relations: src.relations,
      canon: true, realm: work, seededFor: work,
      where: `${book.canon || book.name}·${s.mission.name || ''}`,
      loreVersion: lore,
    };
    if (cur) {
      // 已有记录：原著字段按世界书刷新，但**好感 / 记忆 / 备注永远是玩家的**
      const changed = cur.loreVersion !== lore;
      for (const [k, v] of Object.entries(fields)) {
        if (v === undefined || v === null || v === '') continue;
        if (changed || !cur[k]) cur[k] = v;
      }
      if (changed || !cur.traits?.length) cur.traits = [...(src.traits || [])];
      if (changed || !cur.relations?.length) cur.relations = (src.relations || []).map(r => ({ ...r }));
      cur.loreVersion = lore;
    } else {
      s.worldState.npcs.push(Object.assign({
        name: src.name, favor: 0, metAt: s.turn || 0, lastSeen: s.turn || 0,
        memories: [],
      }, fields));
      n++;
    }
  }
  return n;
}

/** 世界书人物档案的指纹（跟 lib/rules.mjs 的 loreFingerprint 同规则） */
function localLoreFingerprint(c) {
  const s = [
    c.identity, c.role, c.gender, c.age, c.race, c.faction,
    c.appearance, c.voice, c.personality, c.favorHint, c.hook,
    (c.traits || []).join('、'),
    (c.relations || []).map(r => `${r.name}:${r.label}`).join('；'),
  ].map(x => String(x ?? '')).join('\u0001');
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
/* ── 等级经验（和服务端 lib/rules.mjs 的 gainRankExp 同规则）──
   网页模式以前完全没有战绩结算：打完任务等级永远不动。
   ⚠ missionsDone 由 localEndMission 加，这里**只加经验**，别重复计数。 */
const LOCAL_RANKS = ['E', 'D', 'C', 'B', 'A', 'S', 'SS', 'SSS'];
const LOCAL_RANK_VALUE = { E: 1, D: 2, C: 4, B: 8, A: 16, S: 32, SS: 64, SSS: 128 };
const LOCAL_RANK_EXP = { E: 3, D: 7, C: 15, B: 31, A: 63, S: 127, SS: 255, SSS: Infinity };
const localRankIndex = r => Math.max(0, LOCAL_RANKS.indexOf(String(r || 'E').toUpperCase()));

function localGainRankExp(s, missionRank, success = true) {
  const out = [];
  const mr = localRankIndex(missionRank);
  const my = localRankIndex(s.rank);
  const base = LOCAL_RANK_VALUE[String(missionRank || 'E').toUpperCase()] || 1;
  const over = mr - my;
  const mult = !success ? 0.3 : over >= 2 ? 1.5 : over === 1 ? 1.2 : over === 0 ? 1 : 0.6;
  const gain = Math.max(1, Math.round(base * mult));
  s.rankExp = (s.rankExp || 0) + gain;
  out.push(`战绩 +${gain}（${s.rankExp}/${LOCAL_RANK_EXP[s.rank]}）`);
  let ups = 0;
  while (s.rankExp >= (LOCAL_RANK_EXP[s.rank] ?? Infinity) && ups < 3) {
    const i = localRankIndex(s.rank);
    if (i >= LOCAL_RANKS.length - 1) break;
    s.rankExp -= LOCAL_RANK_EXP[s.rank];
    s.rank = LOCAL_RANKS[i + 1];
    ups++;
    out.push(`【等级提升】主神重新评定：${s.rank} 级被选中者`);
  }
  if (s.rankExp > (LOCAL_RANK_EXP[s.rank] ?? Infinity)) s.rankExp = LOCAL_RANK_EXP[s.rank] - 1;
  return out;
}

function localEndMission(s) {
  if (s.phase !== 'mission') return [];
  const done = s.mission;
  // 和服务端 R.endMission 一致：先回**中转站**，不是直接回现实。
  // 以前这里写的是 'life'，于是网页模式结算完跳过中转站，
  // 玩家既看不到面板、也没法挑下一个世界。
  s.phase = 'hub';
  s.mission = null;
  s.missionAt = null;            // 下一次任务重新掷派发时刻（服务端同规则）
  s.missionsDone = (s.missionsDone || 0) + 1;
  s.dungeon = null;
  if (s.status !== 'dead') { s.status = 'alive'; s.hp = s.maxHp; s.sta = s.maxSta; }
  return localGainRankExp(s, done?.rank, true);
}

/**
 * 撤掉当前任务（纯前端版，对应服务端 R.withdrawMission）。
 * 收回这次引进、还没接触过的原著人物 —— 不然换了世界之后上一批人还挂在名录里。
 */
function localWithdrawMission(s) {
  const ws = s.worldState || (s.worldState = { quests: [], npcs: [] });
  const work = s.mission?.work || '';
  const npcs = ws.npcs || [];
  if (work) {
    ws.npcs = npcs.filter(n => {
      const from = n.seededFor || (n.canon ? n.realm : '') || '';
      if (from !== work) return true;
      const untouched = (n.favor || 0) === 0 && (n.lastSeen || 0) <= (n.metAt || 0);
      return !untouched;
    });
  }
  s.mission = null;
  s.dungeon = null;
  s.phase = 'hub';
  // 图鉴里没有留下任何人的作品 = 那次任务被撤过，记录不该留着
  const stillKnown = new Set((ws.npcs || []).map(n => n.realm || n.seededFor).filter(x => x && x !== 'reality'));
  s.visitedWorlds = (s.visitedWorlds || []).filter(v => stillKnown.has(v.work));
  s.messages = (s.messages || []).filter(m => !(m.role === 'system' && String(m.content || '').includes('【主神任务】')));
  return s;
}

/** 重掷大纲种子 —— 重塑换任务时用，否则还会抽到同一个世界 */
function localRerollOutline(s) {
  s.outlineSeed = 1 + Math.floor(Math.random() * 999999999);
  s.mission = null;
  s.dungeon = null;
  return s.outlineSeed;
}

/** 世界进度 / 人物 / 任务（纯前端模式） */
function localWorldProgressPrompt(save) {
  const ws = save.worldState || {};
  const L = [];
  L.push(`当前时间：${localClockText(save)}　阶段：${save.phase === 'mission' ? '主神任务中' : '现实生活'}`);
  if (ws.goal) L.push(`完成条件：${ws.goal}`);
  L.push(`距离下一次主神任务：${localCountdown(save).text}　现金：¥${(save.money ?? 0).toLocaleString()}`);
  if (ws.faction) L.push(`当前站队：${ws.faction}`);
  const qs = ws.quests || [];
  L.push(`\n任务（${qs.filter(q => q.status === '已完成').length}/${qs.length} 已完成）：`);
  for (const q of qs) L.push(`　· [${q.type}] ${q.name} —— ${q.status}${q.objective ? `｜目标：${q.objective}` : ''}${q.reward ? `｜报酬：${q.reward}` : ''}`);
  if (!qs.length) L.push('　（暂无）');
  const ns = ws.npcs || [];
  // 跨世界隔离（与服务端 worldProgressBlock 同规则）：
  // 现实生活里只能出现现世界认识的人；任务世界里的人留在他们自己的世界。
  const isReality = n => {
    const realm = String(n.realm || '').trim();
    if (realm) return realm === 'reality';
    if (n.canon) return false;
    const where = String(n.where || '');
    return !(where.includes('任务') || where.includes('·'));
  };
  const reality = ns.filter(isReality), offWorld = ns.filter(n => !isReality(n));
  const fmt = n => `　· ${n.name}（${n.identity || '身份不明'}｜${n.role || '中立'}）好感 ${n.favor > 0 ? '+' : ''}${n.favor || 0}${n.note ? `｜${n.note}` : ''}`;
  if (save.phase === 'mission') {
    const work = save.mission?.work || '';
    const here = offWorld.filter(n => !work || !n.realm || n.realm === work);
    L.push(`\n这个世界的原住民（能见到的人）：`);
    for (const n of here) L.push(fmt(n));
    if (!here.length) L.push('　（暂无）');
    if (reality.length) { L.push(`\n现实世界的人（不在这里，也不会出现）：`); for (const n of reality.slice(-8)) L.push(fmt(n)); }
    L.push('\n**跨世界隔离：**除了这个世界的原住民，其他任何人都不该在这一场出场，也不该联系玩家。');
  } else {
    L.push(`\n现实世界认识的人：`);
    for (const n of reality) L.push(fmt(n));
    if (!reality.length) L.push('　（暂无）');
    if (offWorld.length) {
      L.push(`\n**别的世界的人（现在联系不上，绝对不该出现）**：`);
      for (const n of offWorld.slice(-12)) L.push(`　· ${n.name}（${n.realm || n.where || '任务世界'}）`);
      L.push('**他们留在自己的世界。**回到现实之后不能给玩家打电话、发消息、出现在楼下，');
      L.push('也不能写成「托人带话」。想再见他们，只能等主神下次把玩家送过去。');
    }
  }
  return L.join('\n');
}

/** 角色卡（纯前端模式） */
function localCharacterPrompt(save) {
  const d = window.GAME_DATA;
  if (!d) return '';
  const tot = save.totalAttrs || save.attrs || {};
  const cmb = save.combat || {};
  const o = d.origins.find(x => x.id === save.origin);
  const t = d.talents.find(x => x.id === save.talent);
  const attrs = d.attrs.map(a => `${a.name} ${tot[a.id] ?? 5}（${Math.floor(((tot[a.id] ?? 10) - 10) / 2) >= 0 ? '+' : ''}${Math.floor(((tot[a.id] ?? 10) - 10) / 2)}）`).join('　');
  const gear = (d.equipSlots || []).map(slot => {
    const id = save.equipment?.[slot];
    const it = id ? d.equipment.find(x => x.id === id) : null;
    return `${d.equipSlotNames[slot]}：${it ? it.name : '空'}`;
  }).join('　');
  const perks = [o?.perk && `出身特长：${o.perk}`, t?.perk && `天赋：${t.perk}`].filter(Boolean);
  return `[角色卡]
姓名：${save.name}
出身：${o?.name || '未知'}　天赋：${t?.name || '未觉醒'}
属性：${attrs}
战斗数值：攻击 ${cmb.atk || 0}　防御 ${cmb.def || 0}
装备：${gear}
技能：${(save.skills || []).map(x => x.name).join('、') || '无'}　血统：${(save.bloodlines || []).map(x => x.name).join('、') || '无'}
${perks.length ? '特殊效果：\n' + perks.map(x => '· ' + x).join('\n') : ''}`;
}

function localStateBlock(s) {
  const inv = s.inventory.length ? s.inventory.map(i => `${i.name}×${i.qty}`).join('、') : '空';
  const sk = s.skills.length ? s.skills.map(x => x.name).join('、') : '无';
  const dg = s.dungeon ? `${s.dungeon.name}（${s.dungeon.rank} 级 · ${s.dungeon.status} · 进度 ${s.dungeon.progress}%）` : '无（当前在主神空间）';
  return `[当前玩家状态]\n姓名：${s.name}\n积分：${s.score}　HP：${s.hp}/${s.maxHp}　体力：${s.sta}/${s.maxSta}\n存活状态：${s.status === 'alive' ? '正常' : s.status === 'dead' ? '已死亡' : '精神崩溃中'}\n道具：${inv}\n技能：${sk}\n当前副本：${dg}\n回合数：${s.turn}`;
}

/* ═══════════════ 6. 渲染 ═══════════════ */
function renderState(s) {
  if (!s) return;
  try {
    renderStateInner(s);
  } catch (e) {
    // 以前这里会让整个侧栏白掉：某个元素被删掉之后 $() 返回 null，
    // 一行 `.textContent =` 就抛异常，后面的渲染全部中断。
    // 现在至少把错误喊出来，并保证下面还有机会继续渲染。
    console.error('[renderState] 渲染中断：', e);
    toast(`状态栏渲染出错：${e.message}`, 'err', 8000);
  }
}

function renderStateInner(s) {
  updateRail();
  $('saveNameLabel').textContent = s.name || '';
  $('hpVal').textContent = `${s.hp} / ${s.maxHp}`;
  $('staVal').textContent = `${s.sta} / ${s.maxSta}`;
  $('scoreVal').textContent = s.score;
  $('hpBar').style.width = `${clamp(s.hp / (s.maxHp || 100) * 100, 0, 100)}%`;
  $('staBar').style.width = `${clamp(s.sta / (s.maxSta || 100) * 100, 0, 100)}%`;
  $('scoreBar').style.width = `${clamp(s.score / 500 * 100, 2, 100)}%`;
  // 回合数现在只在顶部显示，侧栏那一行已删除 —— 注意别再往不存在的元素上写东西

  const st = $('statusVal');
  if (st) {
    const map = {
      alive: '<span class="tag alive">正常</span>',
      dead: '<span class="tag dead">已死亡</span>',
      spent: '<span class="tag spent">力竭</span>',
    };
    st.innerHTML = map[s.status] || map.alive;
  }

  // ── 顶部时间条 ──
  if ($('topClockTime')) {
    const inM = s.phase === 'mission';
    const inHub = s.phase === 'hub';
    const soon = !inM && !inHub && (s.countdownDays ?? 9) <= 1;
    $('topClockTime').textContent = s.clockText || '26年1月1日 06:00';
    $('topClockPhase').textContent = inM ? '主神任务中' : inHub ? '主神空间' : '现实生活';
    $('topClockPhase').className = `tc-phase${inM ? ' on-mission' : ''}${inHub ? ' on-hub' : ''}`;
    $('topClockCd').textContent = inM
      ? (s.mission?.name ? `「${s.mission.name}」` : '任务进行中')
      : inHub
        ? '随时可以推门'
        : (s.countdownText || '');
    $('topClockCd').className = `tc-cd${soon ? ' soon' : ''}`;
    // 任务里 / 中转站里，日历是冻住的 —— 直接把话说出来，别让玩家以为时钟坏了
    const fz = $('topClockFrozen');
    if (fz) {
      fz.hidden = !(inM || inHub);
      fz.textContent = inM ? '⏸ 现世时间暂停' : '⏸ 这里不数日子';
      fz.title = inM
        ? '你正在任务世界里。左上角那个日历记的是现实世界的日子，回到现实才会继续走。'
        : '主神空间是个站台，不是世界。出站回现实之后，日子才会继续。';
    }
    const tc = $('topClock');
    if (tc) tc.classList.toggle('soon', soon);
  }

  // ── 顶部当前任务徽章 ──
  if ($('topTask')) {
    const ws0 = s.worldState || { quests: [] };
    const open = (ws0.quests || []).filter(q => q.status === '进行中');
    const inM = s.phase === 'mission';
    const show = inM || open.length > 0;
    $('topTask').style.display = show ? 'inline-flex' : 'none';
    if (show) {
      const name = inM
        ? (s.mission?.name || '主神任务')
        : open[open.length - 1].name;
      const rank = inM ? (s.mission?.rank || '') : (open[open.length - 1].rank || '');
      $('topTaskName').textContent = name;
      $('topTaskRank').textContent = rank ? `${rank} 级` : '';
      $('topTaskRank').style.display = rank ? '' : 'none';
      $('topTask').classList.toggle('on-mission', inM);
      $('topTask').title = inM
        ? `主神任务：${name}${s.mission?.brief ? `\n${s.mission.brief}` : ''}`
        : `进行中的任务 ${open.length} 个 —— 点击查看`;
    }
  }

  // ── 顶部重塑 / 回退按钮的可用状态 ──
  // 注意这里每次 renderState 都要更新：按钮是常驻的，不会随消息重建
  syncTopActions(s);

  // ── 时间 / 阶段 / 现金 ──
  if ($('rankVal')) {
    const need = s.rankNeed;
    $('rankVal').innerHTML = `<span class="tag rank">${esc(s.rank || 'E')} 级</span>`
      + `<span style="color:var(--muted);font-size:11px;margin-left:6px">`
      + `战绩 ${s.rankExp || 0}${need ? '/' + need : '（封顶）'} · ${s.missionsDone || 0} 次</span>`;
    $('rankVal').title = `被选中者等级：${(s.ranks || []).join(' → ')}`;
  }
  if ($('clockVal')) $('clockVal').textContent = s.clockText || '26年1月1日 06:00';
  if ($('moneyVal')) $('moneyVal').textContent = `¥${(s.money ?? 0).toLocaleString()}`;
  if ($('phaseVal')) {
    $('phaseVal').innerHTML = s.phase === 'mission'
      ? '<span class="tag mad">主神任务中</span>'
      : s.phase === 'hub'
        ? '<span class="tag" style="color:var(--score)">主神空间</span>'
        : '<span class="tag alive">现实生活</span>';
  }
  if ($('countdownVal')) {
    $('countdownVal').textContent = s.phase === 'mission'
      ? '任务中'
      : s.phase === 'hub'
        ? (s.pendingWork ? `下一站《${s.pendingWork}》` : '在中转站，随时可以推门')
        : (s.countdownText || '—');
    $('countdownVal').style.color = (!s.isHub && s.countdownDays <= 1 && s.phase !== 'mission') ? 'var(--warn)' : '';
  }

  if ($('dungeonVal')) $('dungeonVal').textContent = s.dungeon
    ? `${s.dungeon.name} · ${s.dungeon.status}`
    : '—';

  // 出身 / 天赋
  const d = window.GAME_DATA;
  const o = resolveOrigin(s);
  const t = resolveTalent(s);
  if ($('originVal')) $('originVal').innerHTML = o
    ? `${o.custom ? '✍️' : (o.icon || '')}${esc(o.name)}` : '—';
  if ($('talentVal')) $('talentVal').innerHTML = t
    ? `${t.custom ? '✍️' : (t.icon || '')}${esc(t.name)}` : '—';

  // 属性
  const tot = s.totalAttrs || s.attrs || {};
  const box = $('attrList');
  if (box && d?.attrs) {
    box.innerHTML = d.attrs.map(a => {
      const v = tot[a.id] ?? 5;
      const m = Math.floor((v - 10) / 2);
      const base = (s.attrs?.[a.id] ?? 5);
      const eq = v - base;
      return `<div class="attr-mini" title="${esc(a.desc)}">
        <span class="am-nm">${a.name}</span>
        <span class="am-v">${v}</span>
        <span class="am-m ${m > 0 ? 'up' : m < 0 ? 'down' : ''}">${m >= 0 ? '+' : ''}${m}</span>
        ${eq > 0 ? `<span class="am-eq">+${eq}</span>` : ''}
      </div>`;
    }).join('');
  }
  if ($('combatVal') && d) {
    const cmb = s.combat || {};
    $('combatVal').textContent = `攻 ${cmb.atk || 0} · 防 ${cmb.def || 0}`;
  }

  // ── 时间 / 任务 / 人物好感 ──
  const ws = s.worldState || { quests: [], npcs: [] };
  const qm = $('questMain');
  if (qm) {
    if (s.phase === 'mission' && s.mission) {
      qm.innerHTML = `🚨 <b>${esc(s.mission.name || '主神任务')}</b>`
        + `${s.mission.rank ? `　<span class="tag rank">${esc(s.mission.rank)} 级</span>` : ''}`
        + `${s.mission.brief ? `<br><span style="color:var(--text-dim);font-size:11.5px">${esc(s.mission.brief)}</span>` : ''}`;
      qm.classList.remove('empty');
      qm.style.borderColor = 'rgba(255,95,109,.4)';
    } else {
      const open = (ws.quests || []).filter(q => q.status === '进行中');
      if (open.length) {
        qm.innerHTML = `📋 ${esc(open[open.length - 1].name)}`
          + (open.length > 1 ? `　<span style="color:var(--muted);font-size:11px">还有 ${open.length - 1} 个</span>` : '');
        qm.classList.remove('empty');
      } else {
        qm.textContent = '过着日子。做点什么都行 —— 上班、见人、发呆，或者准备下一次任务。';
        qm.classList.add('empty');
      }
      qm.style.borderColor = '';
    }
  }
  if ($('questGoal')) {
    $('questGoal').textContent = s.phase === 'mission'
      ? '任务世界里，现世的时间是暂停的 —— 回去之后日子接着走'
      : s.phase === 'hub'
        ? '主神空间不数日子 —— 出站回现实，时间才会继续'
        : `距离下一次主神任务 ${s.countdownText || '—'}`;
  }
  if ($('worldProgBar')) {
    // 进度条改成「离任务还有多久」：0% = 刚回来，100% = 该出发了
    const pct = s.phase === 'mission' ? 100
      : Math.round((1 - (s.countdownSlots ?? 0) / 28) * 100);
    $('worldProgBar').style.width = `${clamp(pct, 0, 100)}%`;
    $('worldProgBar').style.background = (s.countdownDays <= 1 && s.phase !== 'mission')
      ? 'linear-gradient(90deg, #ff9f43, #ff5f6d)' : '';
  }
  if ($('worldProgLabel')) {
    $('worldProgLabel').textContent = s.phase === 'mission'
      ? '任务中'
      : `${s.clockText || ''}`;
  }
  const nm = $('npcMini');
  if (nm) {
    const favTier = v => v >= 80 ? ['生死之交', '#ff5ec7'] : v >= 50 ? ['信任', '#3ddc84']
      : v >= 20 ? ['友善', '#4ea1ff'] : v >= -19 ? ['中立', '#9aa0b5']
        : v >= -49 ? ['戒备', '#ff9f43'] : v >= -79 ? ['敌视', '#ff5f6d'] : ['死敌', '#ff2d55'];
    const list = (ws.npcs || []).slice().sort((a, b) => b.favor - a.favor).slice(0, 5);
    nm.innerHTML = list.map(n => {
      const [tn, tc] = favTier(n.favor || 0);
      return `<div>
        <div class="nm-row"><span class="nm-name">${esc(n.name)}</span>
          <span class="nm-fav" style="color:${tc}">${n.favor > 0 ? '+' : ''}${n.favor} ${tn}</span></div>
        <div class="fav-bar"><i style="width:${clamp((n.favor + 100) / 2, 0, 100)}%;background:${tc}"></i></div>
      </div>`;
    }).join('');
    if (!list.length) nm.innerHTML = '<div class="empty" style="font-size:11px">还没遇到值得记住的人</div>';
  }

  // ── 侧栏装备区 ──
  // 以前侧栏只有背包、装备要看弹窗才知道穿了什么。这里把六个栏位压成一行一个，
  // 背包则默认收起 —— 背包东西一多（实测 30+ 件）会把整个侧栏撑满。
  const eq = $('equipList');
  if (eq) {
    const slots = d?.equipSlots || [];
    const slotNames = d?.equipSlotNames || {};
    const findGear = id => id
      ? (d?.equipment || []).find(x => x.id === id) || (s.inventory || []).find(x => x.id === id)
      : null;
    eq.innerHTML = slots.map(sl => {
      const it = findGear(s.equipment?.[sl]);
      const rc = it ? (d?.rarities?.[it.rarity]?.color || '#2a2a3d') : '#2a2a3d';
      return `<div class="eq-row${it ? ' has' : ''}" style="--rc:${rc}">
        <span class="eq-sl">${esc(slotNames[sl] || sl)}</span>
        <span class="eq-nm">${it ? esc(it.name) : '<i>空</i>'}</span>
      </div>`;
    }).join('') || '<div class="empty" style="font-size:11px">—</div>';
    const cnt = slots.filter(sl => s.equipment?.[sl]).length;
    const ec = $('equipCount');
    if (ec) ec.textContent = slots.length ? `${cnt} / ${slots.length}` : '';
  }

  const inv = $('invList');
  if (s.inventory.length) {
    const invSorted = [...s.inventory].sort((a, b) => {
      const ra = (d?.rarities?.[a.rarity]?.order ?? 0), rb = (d?.rarities?.[b.rarity]?.order ?? 0);
      return rb - ra;
    });
    inv.innerHTML = invSorted.slice(0, 14).map(i =>
      `<span class="chip usable rar-chip" style="--rc:${d?.rarities?.[i.rarity]?.color || '#2a2a3d'}"
             title="${esc(i.desc || '')}" onclick="Game.useItem('${esc(i.id || i.name)}')">${esc(i.name)}${i.qty > 1 ? `<span class="q">×${i.qty}</span>` : ''}</span>`
    ).join('') + (s.inventory.length > 14 ? `<span class="chip more" onclick="UI.openInventory()">+${s.inventory.length - 14} 件…</span>` : '');
    $('invCount').textContent = `${s.inventory.length} 件`;
  } else { inv.innerHTML = '<span class="empty">空空如也</span>'; $('invCount').textContent = ''; }

  // 背包默认收起（记在本地，玩家展开过就保持展开）
  UI.applyInvCollapse();

  const sk = $('skillList');
  const allSkills = [...(s.skills || []), ...(s.bloodlines || [])];
  sk.innerHTML = allSkills.length
    ? allSkills.map(x => `<span class="chip ${s.bloodlines?.some(b => b.id === x.id) ? 'blood' : 'skill'}" title="${esc(x.desc || '')}">${esc(x.name)}</span>`).join('')
    : '<span class="empty">尚未觉醒任何能力</span>';
}

function renderSaves(list) {
  const box = $('saveList');
  if (!list.length) { box.innerHTML = '<div class="empty">暂无存档</div>'; return; }
  box.innerHTML = list.map(s => `
    <div class="save-item ${s.id === Game.saveId ? 'active' : ''}" onclick="Game.load('${s.id}')">
      <div class="nm">${esc(s.name)}</div>
      <div class="mt">${esc(s.id)} · ${s.turn} 回合 · ${s.score} 分 · ${fmtTime(s.updatedAt)}</div>
      <span class="del" onclick="event.stopPropagation();Game.remove('${s.id}')" title="删除">✕</span>
    </div>`).join('');
  const hint = Backend.mode === 'server' ? '服务器同步' : '浏览器本地';
  $('syncHint').textContent = hint;
}

function renderMessages(list) {
  const box = Game.els.inner;
  box.innerHTML = '';
  if (!list.length) {
    Game.addSystem('灰雾在你面前缓缓流动。输入任何行动，或直接点选下方选项。');
    return;
  }

  // ── 长存档分页 ──
  // 以前 buildSummary() 会把存档砍成 18 条，所以这里全渲染也没事。
  // 现在存档保留全量（导出小说才不会缺前半段），几百条消息全塞进 DOM 会卡，
  // 所以只渲染最近一屏，往上是「载入更早」。
  const PAGE = 40;
  // 换了一段旅途就从头分页，别把上一段的展开状态带过来
  if (Game._showFor !== Game.saveId) { Game._showCount = PAGE; Game._showFor = Game.saveId; }
  const shown = Math.max(PAGE, Game._showCount || PAGE);
  const hidden = Math.max(0, list.length - shown);
  const view = hidden ? list.slice(-shown) : list;

  if (hidden) {
    const more = document.createElement('button');
    more.className = 'load-earlier';
    more.textContent = `↑ 载入更早的 ${Math.min(hidden, PAGE)} 条（还有 ${hidden} 条）`;
    more.onclick = () => {
      Game._showCount = shown + PAGE;
      const h = Game.els.inner.scrollHeight;
      renderMessages(list);
      Game.els.inner.scrollTop = Game.els.inner.scrollHeight - h;   // 保持视线位置
    };
    box.appendChild(more);
  }

  for (const m of view) {
    if (m.role === 'player') {
      const d = document.createElement('div');
      d.className = 'msg player';
      d.innerHTML = `<div class="body">${esc(m.content)}</div>`;
      box.appendChild(d);
    } else if (m.role === 'gm') {
      const d = document.createElement('div');
      d.className = 'msg gm';
      // ⚠ 必须 stripState：存档里存的是**完整原文**（含 <<<STATE>>> 状态块，
      //   服务端和本地模式都是），显示的时候要把它剥掉，否则刷新页面后
      //   一大段 JSON 会明晃晃地留在正文里。
      const { body } = splitOptions(stripState(m.content));
      d.innerHTML = `<div class="body">${formatGm(body)}</div>`;
      box.appendChild(d);
    } else {
      const d = document.createElement('div');
      d.className = 'msg system';
      d.innerHTML = `<div class="body">${esc(m.content)}</div>`;
      box.appendChild(d);
    }
  }
  // 最后一条 GM 消息下面挂一条工具栏：第几段 / 字数 / 时间
  // 「第 N 段」用全局计数，分页之后段号也不会跳回 1
  const lastGm = [...view].reverse().find(m => m.role === 'gm');
  if (lastGm) {
    const seg = list.filter(m => m.role === 'gm').length;
    const when = lastGm.at ? new Date(lastGm.at) : null;
    const stamp = when && !Number.isNaN(when.getTime())
      ? `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, '0')}-${String(when.getDate()).padStart(2, '0')} ${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`
      : '';
    const bar = document.createElement('div');
    bar.className = 'msg-tools';
    bar.innerHTML = `<span>第 ${seg} 段</span><span>${lastGm.content.length} 字</span>`
      + (stamp ? `<span>${stamp}</span>` : '');
    box.appendChild(bar);
    renderChoices(lastGm.content);
  }
  scrollBottom();
}

/**
 * GM 正文的轻量 Markdown 渲染。
 *
 * 先 esc 再替换，所以这里的模式要匹配**转义后**的样子（`>` 已经变成 `&gt;`）。
 * 支持的语法刻意很少 —— 模型最爱用的那几种：块引用、粗体、斜体、行内代码、围栏代码。
 *
 * 另外还识别**叙事配色**用的三类元素（设置里的「环境青、对话金、心理紫」）：
 *   · 对话 `.gm-say`   —— 引号里的内容（「」""''『』）
 *   · 心理 `.gm-think` —— 括号里的心声（（）〔〕）
 *   · 环境 `.gm-env`   —— 其余旁白（由 CSS 给底色，靠 body 上的类切换）
 * ⚠ 这段以前**根本不存在**：设置里写着「对话金、心理紫」，但 formatGm 从来不给
 *   对话加类名，所以那两项是空头支票，正文里对话和旁白一个颜色。
 */
function formatGm(text) {
  let html = esc(text);

  // 围栏代码块先抽出来，避免里面的引号被当成对话
  const vault = [];
  const stash = s => { vault.push(s); return `\u0000${vault.length - 1}\u0000`; };

  html = html.replace(/```([a-z]*)\n([\s\S]*?)```/g,
    (_, lang, code) => stash(`<pre class="gm-code"><code>${code.replace(/\n$/, '')}</code></pre>`));
  html = html.replace(/`([^`\n]+?)`/g, (_, code) => stash(`<code class="gm-inline">${code}</code>`));

  // 行首的引用块：连续的 &gt; 行合成一个 <blockquote>
  html = html.replace(/(?:^|\n)(?:&gt;[ \t]?.*(?:\n|$))+/g, m => {
    const body = m.replace(/\n$/, '').split('\n')
      .map(l => l.replace(/^&gt;[ \t]?/, '')).join('\n');
    return `\n<blockquote class="gm-quote">${body}</blockquote>\n`;
  });
  // 正文开头的【…】状态行（只在整行是【…】时生效，且只认第一处）
  html = html.replace(/^(【[^】]*】)\s*$/m, '<span class="state-line">$1</span>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // 斜体放在粗体之后，避免 ** 被当成两个 *
  html = html.replace(/(^|[^*\w])\*([^*\n]+?)\*(?![*\w])/g, '$1<em>$2</em>');

  // ── 对话 / 心理（在加粗斜体之后，这样它们里面的 ** 已经变成标签了）──
  // 只匹配成对的引号，不跨段（不跨空行），免得把整篇吞掉
  html = html.replace(/「([^「」\n]{1,400})」/g, '<span class="gm-say">「$1」</span>');
  html = html.replace(/『([^『』\n]{1,400})』/g, '<span class="gm-say">『$1』</span>');
  html = html.replace(/“([^“”\n]{1,400})”/g, '<span class="gm-say">“$1”</span>');
  html = html.replace(/（([^（）\n]{1,200})）/g, '<span class="gm-think">（$1）</span>');
  html = html.replace(/〔([^〔〕\n]{1,200})〕/g, '<span class="gm-think">〔$1〕</span>');

  // 把代码块放回去
  html = html.replace(/\u0000(\d+)\u0000/g, (_, i) => vault[Number(i)] || '');
  return html;
}

/**
 * 把正文末尾的选项块拆出来。
 * 返回 { body, choices }，choices 为空数组时正文原样返回。
 */
function splitOptions(text) {
  const raw = String(text ?? '');
  const lines = raw.split('\n');
  const opts = [];
  let i = lines.length - 1;
  while (i >= 0) {
    const t = lines[i].trim();
    if (!t) { i--; continue; }
    const m = t.match(/^\[(\d+)\]\s*(.+)$/);
    if (m) { opts.unshift({ n: m[1], label: m[2].trim().replace(/[。；;]\s*$/, '') }); i--; continue; }
    break;
  }
  if (!opts.length) return { body: raw, choices: [] };
  return { body: lines.slice(0, i + 1).join('\n').replace(/\s+$/, ''), choices: opts };
}

/** 选项不在末尾时的兜底扫描。注意选项文字里可能有方括号
 *  （例如「[1] 接取 [E级任务：雾隐村的失窃卷轴]」），所以按整行取，不能遇到 [ 就停。 */
function scanChoices(text) {
  const out = [];
  for (const line of String(text).split('\n')) {
    const m = line.trim().match(/^\[(\d+)\]\s*(.+)$/);
    if (!m) continue;
    const label = m[2].trim().replace(/[。；;]\s*$/, '');
    if (label) out.push({ n: m[1], label });
  }
  return out.slice(0, 8);
}

function renderChoices(text) {
  closeChoices();
  const split = splitOptions(text);
  const list = split.choices.length ? split.choices : scanChoices(text);
  if (!list.length) return;
  const box = document.createElement('div');
  box.className = 'choices';
  box.id = 'choiceBox';
  list.forEach((c, i) => {
    const b = document.createElement('button');
    b.className = 'choice';
    b.style.animationDelay = `${i * 45}ms`;
    b.innerHTML = `<span class="num">${esc(c.n)}</span><span>${esc(c.label)}</span>`;
    // 点选项**不直接发送** —— 先填进输入框，玩家可以改完再发（也避免误触）
    b.onclick = () => {
      const input = Game.els.input;
      input.value = c.label;
      autoGrow();
      input.focus();
      try { input.setSelectionRange(input.value.length, input.value.length); } catch { /* ignore */ }
      box.querySelectorAll('.choice').forEach(x => x.classList.remove('picked'));
      b.classList.add('picked');
    };
    box.appendChild(b);
  });
  Game.els.inner.appendChild(box);
  scrollIfNear();
}

function closeChoices() {
  const b = $('choiceBox');
  if (b) b.remove();
}

/* ═══════════════ 7. 滚动 / 输入 ═══════════════ */
function nearBottom() {
  const c = Game.els.chat;
  return c.scrollHeight - c.scrollTop - c.clientHeight < 140;
}
function scrollBottom() { const c = Game.els.chat; c.scrollTop = c.scrollHeight; }
function scrollIfNear() { if (nearBottom()) scrollBottom(); }

function autoGrow() {
  const t = Game.els.input;
  t.style.height = 'auto';
  t.style.height = Math.min(168, t.scrollHeight) + 'px';
}

function setComposerEnabled(on) {
  Game.els.send.disabled = !on;
  Game.els.send.textContent = on ? '发送' : '……';
  document.querySelectorAll('.choice').forEach(c => { c.disabled = !on; });
}

function bindInput() {
  const t = Game.els.input;
  t.addEventListener('input', autoGrow);
  t.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      Game.send();
    } else if (e.key === 'ArrowUp' && !t.value && Game.lastInput) {
      e.preventDefault();
      t.value = Game.lastInput;
      autoGrow();
    }
  });
}

/** 顶部重塑 / 回退按钮：绑定一次，之后只更新可用状态 */
function bindTopActions() {
  const r = document.getElementById('btnReroll');
  const u = document.getElementById('btnUndo');
  if (r) r.onclick = () => UI.reroll();
  // 「回退」在没有可退轮次时变成「回主页」——
  // 以前那种情况按钮是灰的，而顶栏里根本没有回主页的入口（只有侧栏最底下的 🏠）。
  if (u) u.onclick = () => {
    if (Game.state?.canUndo && !Game.busy) return UI.undo();
    return UI.showLanding();
  };
  syncTopActions(Game.state);
}

function syncTopActions(s) {
  const r = document.getElementById('btnReroll');
  const u = document.getElementById('btnUndo');
  const busy = Boolean(Game.busy);
  const has = Boolean(s);
  if (r) {
    r.disabled = !has || busy;
    r.title = busy ? '正在生成，等这一轮结束'
      : has ? '用同样的输入重新生成这一轮（API 卡住或写得不满意时用）'
        : '先创建或载入一段旅途';
  }
  if (u) {
    // 能退就退，不能退就去主页 —— 所以这个键**永远可点**（只在生成中禁用）
    const canUndo = Boolean(has && s?.canUndo && !busy);
    u.disabled = busy;
    u.textContent = canUndo ? '↩ 回退' : '🏠 主页';
    u.classList.toggle('is-home', !canUndo);
    u.title = busy ? '正在生成，等这一轮结束'
      : canUndo ? '删掉这一轮，回到这一轮开头（存档状态也会回退）'
        : '回到开始页（选存档 / 开新旅途 / 改设置）';
  }
}

/** 侧栏收起 / 展开 */
function bindSidebar() {
  const fold = document.getElementById('sideFold');
  if (fold) fold.onclick = () => UI.toggleSidebarCollapse();
  const reopen = document.getElementById('sideReopen');
  if (reopen) reopen.onclick = () => UI.toggleSidebarCollapse(false);
  // 记住上次是收着还是开着
  try {
    if (localStorage.getItem('dsh_side_collapsed') === '1') UI.toggleSidebarCollapse(true);
  } catch { /* 隐私模式 */ }
}

/** 左侧图标栏 */
function bindRail() {
  const acts = {
    char: () => UI.openCharacter(),
    inv: () => UI.openInventory(),
    shop: () => UI.openShop(),
    quest: () => UI.openQuests(),
    codex: () => UI.openCodex(),
    worlds: () => UI.openWorlds(),
    archive: () => UI.openArchive(),
    time: () => UI.openTime(),
    hub: () => UI.openHub(),
    rest: () => Game.rest(),
    prompt: () => UI.openPrompt(),
    cfg: () => UI.openSettings(),
    home: () => UI.showLanding(),
  };
  document.querySelectorAll('.rail-btn').forEach(b => {
    b.onclick = () => {
      const act = b.dataset.act;
      if (!Game.state && !['cfg', 'home', 'prompt'].includes(act)) {
        toast('先创建一段旅途吧', 'warn');
        UI.openNewSave();
        return;
      }
      acts[act]?.();
    };
  });
  updateRail();
}

/** 有任务进行中时，图标栏给个提示点 */
function updateRail() {
  const s = Game.state;
  const questBtn = document.querySelector('.rail-btn[data-act="quest"]');
  if (questBtn) {
    const doing = (s?.worldState?.quests || []).filter(q => q.status === '进行中').length;
    questBtn.classList.toggle('hot', doing > 0);
    questBtn.title = doing ? `${doing} 个任务进行中` : '任务与攻略度';
  }
  const codexBtn = document.querySelector('.rail-btn[data-act="codex"]');
  if (codexBtn) {
    const n = (s?.worldState?.npcs || []).length;
    codexBtn.title = n ? `已结识 ${n} 个人` : '人物名录';
  }
  // 主神空间只在人在中转站里的时候亮起来
  const hubBtn = document.querySelector('.rail-btn[data-act="hub"]');
  if (hubBtn) {
    hubBtn.classList.toggle('hot', Boolean(s?.isHub));
    hubBtn.title = s?.isHub
      ? (s.pendingWork ? `在主神空间 · 下一站《${s.pendingWork}》` : '在主神空间 · 可指定下一个世界')
      : '主神空间（被拉走时才能进）';
  }
}

function applyBranding() {
  const c = Backend.cfg || {};
  document.title = c.title || '都市无限流：主神空间';
  $('topTitle').textContent = c.title || '都市无限流：主神空间';
  $('brandTitle').textContent = (c.title || '主神空间').split('：').pop();

  const dot = $('statusDot');
  const txt = $('engineText');
  const badge = $('engineBadge');
  // 徽章上只显示模型名（顶栏空间宝贵），完整信息放 title 里，鼠标悬停能看到
  const setBadge = (short, full, cls) => {
    txt.textContent = short;
    if (badge) badge.title = `${full}\n点击打开设置`;
  };
  if (Backend.mode === 'local') {
    dot.className = 'status-dot warn';
    const p = PROVIDERS[c.provider] || {};
    setBadge(c.model || p.model || '未配置',
      `浏览器直连 · ${c.providerLabel || c.provider || ''} · ${c.model || p.model || '未配置'}`);
    return;
  }
  if (c.provider === 'offline') {
    dot.className = 'status-dot';
    setBadge('离线引擎', '离线剧本引擎（不调用任何 API）');
  } else if (c.hasKey || !(Backend.providers[c.provider] || {}).needsKey) {
    dot.className = 'status-dot';
    setBadge(c.model || c.provider,
      `${c.providerLabel || c.provider} · ${c.baseUrl || ''} · ${c.model}`);
  } else {
    dot.className = 'status-dot off';
    setBadge('未配置 Key', '还没填 API Key —— 点击打开设置填一个');
  }
}

/* ═══════════════ 8. 弹窗 ═══════════════ */
const UI = {
  _cur: null,

  /**
   * 把一段话填进输入框（不自动发送），让玩家看一眼再按回车。
   * 场景：在主神空间指定了世界之后，与其让他自己再打一遍「推开门，去《X》」，
   * 不如把这句填好 —— 他只要回车。
   */
  fillComposer(text) {
    const t = Game?.els?.input;
    if (!t) return false;
    t.value = String(text || '');
    t.focus();
    try { t.setSelectionRange(t.value.length, t.value.length); } catch { /* 无所谓 */ }
    if (typeof autoGrow === 'function') autoGrow();
    return true;
  },

  openModal({ title, body, footer = '', wide = false, onMount }) {
    this.closeModal();
    const ov = document.createElement('div');
    ov.className = 'overlay';
    ov.innerHTML = `
      <div class="modal ${wide ? 'wide' : ''}">
        <header><h3>${esc(title)}</h3><span class="x">✕</span></header>
        <div class="content">${body}</div>
        ${footer ? `<footer>${footer}</footer>` : ''}
      </div>`;
    ov.addEventListener('click', e => { if (e.target === ov) this.closeModal(); });
    ov.querySelector('.x').onclick = () => this.closeModal();
    $('modalRoot').appendChild(ov);
    this._cur = ov;
    if (onMount) onMount(ov);
    return ov;
  },

  closeModal() {
    document.querySelectorAll('.overlay').forEach(o => o.remove());
    this._cur = null;
  },

  toggleSidebar(open) {
    $('sidebar').classList.toggle('open', open);
    $('backdrop').classList.toggle('show', open);
  },

  /* ── 新建存档 ── */
  openNewSave() {
    this.openModal({
      title: '创建一段旅途',
      body: `
        <div class="field">
          <label>角色 / 存档名称</label>
          <input type="text" id="nsName" placeholder="例如：陈默" maxlength="20" />
          <div class="desc">只是一个称呼。真正的名字，主神空间会自己决定要不要记住。</div>
        </div>`,
      footer: `<button class="btn ghost" onclick="UI.closeModal()">取消</button>
               <button class="btn" id="nsGo">进入灰雾</button>`,
      onMount: ov => {
        const inp = ov.querySelector('#nsName');
        inp.focus();
        const go = async () => {
          const name = inp.value.trim() || `旅途-${uid().slice(0, 4)}`;
          go.disabled = true;
          try { await Game.newSave(name); } catch (e) { toast(e.message, 'err'); go.disabled = false; }
        };
        ov.querySelector('#nsGo').onclick = go;
        inp.onkeydown = e => { if (e.key === 'Enter') go(); };
      },
    });
  },

  /* ── 设置 ── */
  async openSettings(opts = {}) {
    await Backend.getConfig();
    const c = Backend.cfg;
    const isServer = Backend.mode === 'server';
    const p = UI.prefs();
    const st = UI._cfg = UI._cfg || { tab: opts.tab || 'display' };
    if (opts.tab) st.tab = opts.tab;

    // 网页模式没有内置的离线剧本引擎（那是 server.mjs 里的东西）。
    // 把它标成不可选，否则玩家选了它、建完号、发第一句话才报错。
    //
    // ⚠ 这里必须用**对象的键**当 id：Backend.providers 是 {offline:{label,...}, deepseek:{...}}，
    // 条目里根本没有 id 字段 —— 以前写 x.id，12 个选项的 value 全是字面量字符串 "undefined"，
    // 选中哪个都存不进去，看起来就像「设置保存不了」。
    const provList = Object.entries(Backend.providers).map(([id, v]) => ({ id, ...v }));
    const offlineOk = isServer;
    const provOptions = provList.map(x => {
      const no = x.id === 'offline' && !offlineOk;
      return `<option value="${esc(x.id)}" ${x.id === c.provider ? 'selected' : ''} ${no ? 'disabled' : ''}>`
        + `${esc(x.label)}${no ? '（只有本地服务器模式支持）' : ''}</option>`;
    }).join('');

    /* ── 显示 ── */
    const tabDisplay = `
      <div class="set-row">
        <div class="set-lb"><b>主题模式</b><i>选择界面主题风格</i></div>
        <div class="seg" id="setTheme">
          ${[['dark', '🌙 暗黑'], ['light', '☀️ 明亮'], ['auto', '🖥 跟随系统']].map(([k, t]) =>
      `<button class="seg-b ${p.theme === k ? 'on' : ''}" data-theme="${k}">${t}</button>`).join('')}
        </div>
      </div>
      <div class="set-row">
        <div class="set-lb"><b>界面缩放</b><i>按钮、菜单、面板和文字一起放大缩小</i></div>
        <div class="set-ctl">
          <input type="range" id="setScale" min="0.85" max="1.25" step="0.05" value="${p.scale}" />
          <span class="set-val" id="scaleLabel">${Math.round(p.scale * 100)}%</span>
        </div>
      </div>
      <div class="set-row">
        <div class="set-lb"><b>快速动画</b><i>关掉后界面不再有过渡与淡入</i></div>
        <div class="set-ctl"><button class="sw ${p.fastAnim ? 'on' : ''}" id="setAnim" role="switch"></button></div>
      </div>
      <div class="cd-hint">显示设置立刻生效，不用点保存。</div>`;

    /* ── 阅读 ── */
    const fontCards = UI.READ_FONTS.map(f => `
      <button class="font-card ${p.font === f.id ? 'on' : ''}" data-font="${f.id}">
        <span class="fc-sample" style="font-family:${f.css}">山河道途</span>
        <span class="fc-nm">${esc(f.name)}</span>
        <span class="fc-ds">${esc(f.desc)}</span>
      </button>`).join('');

    const tabReading = `
      <div class="field">
        <label>字体</label>
        <div class="desc" style="margin-bottom:10px">只影响正文与界面文字，用系统自带字体，不用等下载。</div>
        <div class="font-grid">${fontCards}</div>
      </div>
      <div class="set-row">
        <div class="set-lb"><b>正文字号</b><i>只影响中间的正文</i></div>
        <div class="set-ctl">
          <input type="range" id="setSize" min="13" max="20" step="0.5" value="${p.readSize}" />
          <span class="set-val" id="sizeLabel">${p.readSize}px</span>
        </div>
      </div>
      <div class="set-row">
        <div class="set-lb"><b>正文行距</b><i>行与行之间的留白</i></div>
        <div class="seg" id="setLh">
          ${[['1.6', '紧凑'], ['1.85', '适中'], ['2.15', '宽松']].map(([k, t]) =>
      `<button class="seg-b ${String(p.readLh) === k ? 'on' : ''}" data-lh="${k}">${t}</button>`).join('')}
        </div>
      </div>
      <div class="set-row">
        <div class="set-lb"><b>叙事配色</b><i>彩色＝环境青、对话金、心理紫；素雅＝只有加粗</i></div>
        <div class="seg" id="setNar">
          ${[['color', '彩色'], ['plain', '素雅']].map(([k, t]) =>
      `<button class="seg-b ${p.narration === k ? 'on' : ''}" data-nar="${k}">${t}</button>`).join('')}
        </div>
      </div>
      <div class="field">
        <label>预览</label>
        <div class="read-preview" id="readPreview">
          <div class="state-line">【26年1月3日 15:00 | 积分:500 | ¥2,840 | HP:100 | 体力:100】</div>
          <p>灰雾在你面前缓缓流动。<strong>远处传来钟声</strong>，敲了七下就停了。</p>
          <p><span class="gm-say">「你来得比我预想的早。」</span>那人转过身来，<span class="gm-think">（他数过我的脚步。）</span></p>
        </div>
      </div>
      <div class="cd-hint">阅读设置立刻生效，不用点保存。</div>`;

    /* ── 游戏 ── */
    const tabGame = `
      <div class="field">
        <label>数值结算方式</label>
        <select id="cfgSettle">
          <option value="auto" ${c.stateSettle === 'auto' ? 'selected' : ''}>自动（推荐）—— 状态块缺东西时补一次结算请求</option>
          <option value="always" ${c.stateSettle === 'always' ? 'selected' : ''}>总是分两步 —— 最准，但每回合多一次请求</option>
          <option value="off" ${c.stateSettle === 'off' ? 'selected' : ''}>只用一次请求 —— 最省，但人物与任务可能记不全</option>
        </select>
        <div class="desc">
          很多模型不会老实按格式在正文末尾追加完整 JSON，经常只回一句「小结」就交差，
          人物、任务、世界进度全都不写。选「自动」时，只要状态块里缺这些东西，系统就会再发一个
          专注的结算请求补齐。想最稳就选「总是分两步」。
        </div>
      </div>
      <div class="field">
        <label>携带的历史回合数</label>
        <input type="number" id="cfgWin" value="${c.historyWindow}" min="4" max="60" step="2" />
        <div class="desc">越大越记得住前文，但更贵更慢。超出部分会被压成前情提要 —— 原文不会丢，导出小说还是全的。</div>
      </div>
      ${isServer && c.lanUrls && c.lanUrls.length ? `
      <div class="field">
        <label>多端同步地址</label>
        <div class="result info">
          手机 / 平板连同一个 Wi-Fi，用下面的地址打开，就能接着玩同一个存档：<br>
          ${c.lanUrls.map(u => `<code>${esc(u)}</code>`).join('<br>')}
          ${Game.saveId ? `<br>当前存档直链：<code>${esc(c.lanUrls[0] + '/?save=' + Game.saveId)}</code>` : ''}
        </div>
      </div>` : ''}`;

    /* ── API ── */
    const tabApi = `
      ${isServer ? '' : `<div class="result err" style="margin-bottom:14px">
        ⚠ 当前是<b>纯前端模式</b>（没有检测到本地服务器）。存档存在这个浏览器里，
        API Key 也存在浏览器里，且浏览器直连厂商接口可能被 CORS 拦截。
        想要更稳的体验和多端同步，请把 <b>public/</b> 用本地服务器打开（见「高级 → 网页模式」）。
      </div>`}
      ${isServer && Backend.guestMode ? `<div class="result err" style="margin-bottom:14px">
        ⚠ 你现在用的是<b>自己填的那份接口</b>，不是这台服务器配好的那个。<br>
        当前：<code>${esc(c.providerLabel || c.provider || '')}</code>${c.model ? ` · <code>${esc(c.model)}</code>` : ''}
        ${c.apiKey ? `<br>Key：<code>${esc(String(c.apiKey).slice(0, 10))}…${esc(String(c.apiKey).slice(-4))}</code>` : '<br>（没有 Key）'}<br>
        <span class="desc">如果一直报「无效的令牌 / 401 / 余额不足」，问题多半在这把 Key 上。</span>
        <div class="row2" style="margin-top:9px">
          <button class="btn" id="cfgUseServer">↩ 改回用这台服务器配好的接口</button>
        </div>
      </div>` : ''}
      ${isServer ? `<div class="field">
        <label>走哪条线路</label>
        <div class="row2">
          <button class="btn ghost" id="cfgUseRelay">🏠 用这台服务器自带的接口（推荐）</button>
          <button class="btn ghost" id="cfgUseOwnKey">🔑 用我自己的 API Key</button>
        </div>
        <div class="desc" id="relayHint">
          ${Backend.guestMode
        ? '当前：<b>你自己的 Key</b>（直连你填的那个接口）'
        : '当前：<b>服务器自带</b>（用这台机器上配好的接口和额度）'}
        </div>
      </div>` : ''}
      <div class="field">
        <label>叙事引擎</label>
        <select id="cfgProvider">${provOptions}</select>
        <div class="desc" id="provHint"></div>
      </div>
      <div class="field" id="baseUrlField">
        <label>接口地址 BaseURL</label>
        <input type="text" id="cfgBaseUrl" value="${esc(c.baseUrl || '')}" placeholder="https://api.deepseek.com/v1" />
        <div class="desc">必须是 OpenAI 兼容接口，通常以 <code>/v1</code> 结尾。程序会自动拼接 <code>/chat/completions</code>。</div>
      </div>
      <div class="field">
        <label>模型名</label>
        <input type="text" id="cfgModel" value="${esc(c.model || '')}" placeholder="deepseek-chat" list="modelList" />
        <datalist id="modelList"></datalist>
        <div class="desc" id="modelHint"></div>
      </div>
      <div class="field" id="keyField">
        <label>API Key <span id="keyReq"></span></label>
        <input type="password" id="cfgKey" value="${esc(c.apiKey || '')}" placeholder="${c.hasKey ? '已配置（留空表示不修改）' : 'sk-...'}" autocomplete="off" />
        <div class="desc" id="keyDesc"></div>
      </div>
      <div class="field">
        <label>文风随机度（temperature）：<span id="tempLabel">${c.temperature}</span></label>
        <input type="range" id="cfgTemp" min="0" max="1.5" step="0.05" value="${c.temperature}" style="width:100%" />
        <div class="desc">0.8~1.0 比较稳，1.1 以上更放飞、更容易出意外剧情。</div>
      </div>
      <div class="field">
        <label>单次回复长度上限（tokens）</label>
        <input type="number" id="cfgMax" value="${c.maxTokens}" min="200" max="8000" step="100" />
      </div>
      <div id="testResult"></div>`;

    /* ── 高级 ── */
    const tabAdvanced = `
      <div class="field">
        <label>存档</label>
        <div class="row2">
          <button class="btn ghost" onclick="UI.exportText('dossier',null,'完整档案已导出')">⬇ 导出全部档案 TXT</button>
          <button class="btn ghost" onclick="UI.closeModal();UI.openImport()">📥 导入存档</button>
        </div>
        <div class="desc">导出的是纯文本（小说 + 人物卡 + 记忆档案），可以直接发给别人看。</div>
      </div>
      <div class="field">
        <label>网页模式（免安装）</label>
        <div class="desc" style="margin-bottom:9px">
          把 <code>public/</code> 整个目录传到任意静态托管（GitHub Pages / Vercel / Netlify 都免费），
          就变成一条网址，谁点谁玩、不用装任何东西。存档存在各自的浏览器里，天然隔离。
        </div>
        <button class="btn ghost" onclick="UI.openWebMode()">📖 怎么做，看这里</button>
      </div>
      <div class="field">
        <label>恢复默认</label>
        <div class="row2">
          <button class="btn ghost" id="setResetUi">↺ 重置界面与阅读设置</button>
        </div>
        <div class="desc">只重置主题、字体、字号这些显示偏好，不动 API 与存档。</div>
      </div>
      <div class="field">
        <label>关于</label>
        <div class="result info">
          都市无限流 · 主神空间<br>
          世界书 ${(window.GAME_WORLDBOOKS || []).length} 篇 ·
          装备 ${(D()?.equipment || []).length} 件 ·
          出身 ${(D()?.origins || []).length} 种 · 天赋 ${(D()?.talents || []).length} 个<br>
          运行模式：${isServer ? '完整模式（本地服务器）' : '网页模式（纯前端）'}<br>
          构建：<code>${esc(D()?.build || '未知')}</code>${D()?.buildVer ? ` · <span class="desc">版本 ${esc(D().buildVer)}</span>` : ''}
          ${(window.GAME_WORLDBOOKS || []).length ? '' : '<br><span style="color:var(--hp)">⚠ worldbooks.js 没加载 —— 网页模式不会注入世界书，记得一起上传</span>'}
        </div>
      </div>`;

    const TABS = [
      ['display', '🖥', '显示'],
      ['reading', '📖', '阅读'],
      ['game', '🎮', '游戏'],
      ['api', '🔑', 'API'],
      ['advanced', '⚙', '高级'],
    ];
    const body = `
      <div class="tabs sub set-tabs">
        ${TABS.map(([k, ic, nm]) =>
      `<button class="tab ${st.tab === k ? 'on' : ''}" data-stab="${k}">${ic} ${nm}</button>`).join('')}
      </div>
      <div class="set-body">
        ${st.tab === 'reading' ? tabReading
        : st.tab === 'game' ? tabGame
          : st.tab === 'api' ? tabApi
            : st.tab === 'advanced' ? tabAdvanced
              : tabDisplay}
      </div>`;

    this.openModal({
      title: opts.tab === 'api' ? 'API 管理' : '系统设置',
      wide: true,
      body,
      footer: `
        <button class="btn ghost" id="setReset">↺ 恢复默认</button>
        <div style="flex:1"></div>
        ${['game', 'api'].includes(st.tab) ? '<button class="btn ghost" id="cfgTest">测试连接</button>' : ''}
        <button class="btn ghost" onclick="UI.closeModal()">关闭</button>
        ${['game', 'api'].includes(st.tab) ? '<button class="btn" id="cfgSave">保存</button>' : ''}`,
      onMount: ov => {
        const redraw = () => UI.openSettings({ tab: UI._cfg.tab });
        // 本次设置面板是否处于「要用自己的 Key」模式。
        // 只有它为 true 时，collect() 才会把输框里的 Key 存下来 ——
        // 否则「改回服务器」之后，输框残留的旧 Key 又会被写回去（一直 401 出不来）。
        //
        // ⚠ 网页模式（静态托管）**必须**是 true：那里没有「服务器上配好的 Key」可退回，
        //   玩家填的就是唯一那把。以前写死成 guestMode —— 而 guestMode 只有服务器模式
        //   才会被置 true，于是网页版里「API Key」那一栏填什么都会被丢掉，
        //   表现就是「改了十次 key 还是 401」。
        let OV_OWN_KEY = Backend.mode !== 'server' || Boolean(Backend.guestMode);

        /* ── 标签切换 ── */
        ov.querySelectorAll('[data-stab]').forEach(b => b.onclick = () => { UI._cfg.tab = b.dataset.stab; redraw(); });

        /* ── 显示 ── */
        ov.querySelectorAll('#setTheme [data-theme]').forEach(b => b.onclick = () => {
          UI.setPref('theme', b.dataset.theme); redraw();
        });
        const sc = ov.querySelector('#setScale');
        if (sc) {
          sc.oninput = () => {
            ov.querySelector('#scaleLabel').textContent = Math.round(sc.value * 100) + '%';
            UI.setPref('scale', Number(sc.value), true);
          };
        }
        const an = ov.querySelector('#setAnim');
        if (an) an.onclick = () => { UI.setPref('fastAnim', !UI.prefs().fastAnim); redraw(); };

        /* ── 阅读 ── */
        ov.querySelectorAll('[data-font]').forEach(b => b.onclick = () => { UI.setPref('font', b.dataset.font); redraw(); });
        ov.querySelectorAll('#setLh [data-lh]').forEach(b => b.onclick = () => { UI.setPref('readLh', Number(b.dataset.lh)); redraw(); });
        ov.querySelectorAll('#setNar [data-nar]').forEach(b => b.onclick = () => { UI.setPref('narration', b.dataset.nar); redraw(); });
        const sz = ov.querySelector('#setSize');
        if (sz) {
          sz.oninput = () => {
            ov.querySelector('#sizeLabel').textContent = sz.value + 'px';
            UI.setPref('readSize', Number(sz.value), true);
          };
        }
        const rs = ov.querySelector('#setResetUi');
        if (rs) rs.onclick = () => {
          UI.savePrefs({ ...UI.DEFAULT_PREFS });
          applyPrefs();
          toast('界面与阅读设置已恢复默认', 'ok');
          redraw();
        };
        const rr = ov.querySelector('#setReset');
        if (rr) rr.onclick = () => {
          UI.savePrefs({ ...UI.DEFAULT_PREFS });
          applyPrefs();
          toast('已恢复默认（只影响界面与阅读）', 'ok');
          redraw();
        };

        /* ── 「走哪条线路」开关 ──
           必须放在设置页：向导第 0 步在「已经有可用接口」时会被整个跳过，
           玩家一旦填错 Key，不从这里就再也出不来（会一直吃 401）。
           实测踩过的坑：只清 localStorage 不清内存里的 cfg，界面看着没变化。 */
        const useServerBtn = ov.querySelector('#cfgUseServer');
        const useRelayBtn = ov.querySelector('#cfgUseRelay');
        const useOwnBtn = ov.querySelector('#cfgUseOwnKey');
        /**
         * 切回「用服务器配好的接口」。
         * ⚠ 光清 localStorage 不够 —— 输框里还留着那把旧 Key，
         *   下次点「保存设置」时 collect() 又把它写回 mid_guest_api_v1，
         *   于是「点了开关还是 401」。所以这里必须**连输框一起清空**。
         */
        const backToServer = async () => {
          await Backend.useServerApi();     // ← 清 localStorage + 重建 cfg
          OV_OWN_KEY = false;               // ← 关掉「用我自己的 Key」模式
          const kb = ov.querySelector('#cfgKey');
          if (kb) kb.value = '';            // ← 关键：别让旧 Key 被重新保存
          const kdesc = ov.querySelector('#keyDesc');
          if (kdesc) kdesc.textContent = '已切回服务器自带的接口，这里不用填。';
          toast('已改回用这台服务器配好的接口', 'ok');
          redraw();
        };
        if (useServerBtn) useServerBtn.onclick = backToServer;
        if (useRelayBtn) useRelayBtn.onclick = backToServer;
        if (useOwnBtn) useOwnBtn.onclick = () => {
          OV_OWN_KEY = true;                // 玩家明确要用自己的 → 允许保存
          const kb = ov.querySelector('#cfgKey');
          if (kb) { kb.value = ''; kb.focus(); }
          toast('在下面填你自己的接口地址和 Key，保存后生效', 'ok');
        };

        /* ── API（沿用原来的联动逻辑）── */
        const sel = ov.querySelector('#cfgProvider');
        if (sel) {
          const base = ov.querySelector('#cfgBaseUrl');
          const model = ov.querySelector('#cfgModel');
          const keyF = ov.querySelector('#keyField');
          const baseF = ov.querySelector('#baseUrlField');
          const hint = ov.querySelector('#provHint');
          const mHint = ov.querySelector('#modelHint');
          const dl = ov.querySelector('#modelList');
          const temp = ov.querySelector('#cfgTemp');

          const sync = (resetFields) => {
            const pr = Backend.providers[sel.value] || {};
            hint.textContent = pr.hint || '';
            dl.innerHTML = (pr.models || []).map(m => `<option value="${esc(m)}"></option>`).join('');
            mHint.textContent = (pr.models || []).length ? `可选：${pr.models.join(' / ')}` : '';
            baseF.style.display = sel.value === 'offline' ? 'none' : '';
            const isOffline = sel.value === 'offline';
            keyF.style.display = isOffline ? 'none' : '';
            if (!isOffline) {
              const req = ov.querySelector('#keyReq');
              const desc = ov.querySelector('#keyDesc');
              const localish = sel.value === 'ollama' || sel.value === 'lmstudio';
              if (pr.needsKey) {
                req.textContent = '（必填）'; req.style.color = 'var(--warn)';
                desc.innerHTML = '这个厂商必须填 Key，否则请求会被拒绝。';
              } else if (localish) {
                req.textContent = '（通常不需要）'; req.style.color = 'var(--muted)';
                desc.innerHTML = '本地模型一般不需要密钥，留空即可；如果本地网关配了鉴权就填上。';
              } else {
                req.textContent = '（按接口要求）'; req.style.color = 'var(--text-dim)';
                desc.innerHTML = '接口要鉴权就填上，不需要就留空 —— 比如把自定义地址指向 DeepSeek，就必须填。';
              }
              const store = isServer
                ? ' 保存在服务器的 config.local.json，不会发送到浏览器以外的任何地方。'
                : ' 保存在这个浏览器的 localStorage，请不要在公开的网站上这么做。';
              const env = c.keyEnv ? ` 也可以改用环境变量 <code>${c.keyEnv}</code> 而不用写在这里。` : '';
              desc.innerHTML += store + env;
            }
            if (resetFields) { base.value = pr.baseUrl || ''; model.value = pr.model || ''; }
          };
          sel.onchange = () => sync(true);
          sync(false);
          temp.oninput = () => { ov.querySelector('#tempLabel').textContent = temp.value; };
        }

        const collect = () => {
          const patch = {};
          const g = id => ov.querySelector(id);
          if (g('#cfgProvider')) {
            patch.provider = g('#cfgProvider').value;
            patch.baseUrl = g('#cfgBaseUrl').value.trim();
            patch.model = g('#cfgModel').value.trim();
            patch.temperature = Number(g('#cfgTemp').value);
            patch.maxTokens = Number(g('#cfgMax').value);
            const kv = g('#cfgKey').value.trim();
            // 只要输入框里的 key 和已存的不一样，就必须采用它 —— 否则换了 key
            // 也会退回到旧的那把，表现就是「一直 401 改不动」。
            const savedKey = String((Backend.cfg || {}).apiKey || '');
            if (kv && (OV_OWN_KEY || kv !== savedKey)) patch.apiKey = kv;
          }
          if (g('#cfgWin')) patch.historyWindow = Number(g('#cfgWin').value);
          if (g('#cfgSettle')) patch.stateSettle = g('#cfgSettle').value;
          return patch;
        };

        const sv = ov.querySelector('#cfgSave');
        if (sv) sv.onclick = async (e) => {
          e.target.disabled = true;
          try {
            await Backend.saveConfig(collect());
            await Backend.getConfig();
            applyBranding();
            toast('设置已保存', 'ok');
            UI.closeModal();
            if (typeof opts.onSaved === 'function') opts.onSaved();
          } catch (err) { toast(err.message, 'err'); }
          e.target.disabled = false;
        };

        const ts = ov.querySelector('#cfgTest');
        if (ts) ts.onclick = async (e) => {
          const box = ov.querySelector('#testResult');
          e.target.disabled = true;
          box.innerHTML = '<div class="result info">正在测试连接……（只测试，不会保存）</div>';
          try {
            const res = await Backend.testWith(collect());
            box.innerHTML = `<div class="result ${res.ok ? 'ok' : 'err'}">${res.ok ? '✅ ' : '❌ '}${esc(res.message)}</div>`;
          } catch (err) {
            box.innerHTML = `<div class="result err">❌ ${esc(err.message)}</div>`;
          }
          e.target.disabled = false;
        };
      },
    });
  },

  /** API 管理 —— 就是设置面板直接开在 API 那一页 */
  async openApi() { return this.openSettings({ tab: 'api' }); },

  /* 主神商店已移除 —— 装备由 AI 在剧情里直接给。移到这里是因为「出戏」。 */
  async openShop() {
    toast('没有商店了 —— 东西得靠任务拿。', 'warn');

  },

  /* ── 提示词 ── */
  async openPrompt() {
    const text = await Backend.getPrompt();
    this.openModal({
      title: 'Game Master 提示词',
      wide: true,
      body: `
        <div class="field">
          <div class="desc" style="margin-bottom:8px">
            这段文字会作为 system prompt 发给模型。<code>&lt;&lt;&lt;STATE ... STATE&gt;&gt;&gt;</code>
            是程序解析数值用的状态协议，删掉它数值就不会自动结算了。
            ${Backend.mode === 'server' ? '保存后立即生效，并写回 game_master.txt。' : '保存在这个浏览器里。'}
          </div>
          <textarea id="gmText" spellcheck="false">${esc(text)}</textarea>
        </div>`,
      footer: `<button class="btn ghost" onclick="UI.closeModal()">取消</button>
               <button class="btn" id="gmSave">保存</button>`,
      onMount: ov => {
        ov.querySelector('#gmSave').onclick = async e => {
          e.target.disabled = true;
          try {
            await Backend.setPrompt(ov.querySelector('#gmText').value);
            toast('提示词已保存', 'ok');
            UI.closeModal();
          } catch (err) { toast(err.message, 'err'); e.target.disabled = false; }
        };
      },
    });
  },

  /* ── 导入 / 导出 ── */
  openImport() {
    this.openModal({
      title: '导入 / 导出存档',
      body: `
        <div class="field">
          <label>导出当前存档</label>
          <div class="desc" style="margin-bottom:8px">把存档 JSON 复制走，换设备时粘贴回来就能接着玩。</div>
          <button class="btn ghost block" id="expBtn">复制当前存档 JSON</button>
        </div>
        <div class="field">
          <label>导入存档 JSON</label>
          <textarea id="impText" style="min-height:130px" placeholder='粘贴存档 JSON，或使用导出的文件内容'></textarea>
        </div>
        <div id="impResult"></div>`,
      footer: `<button class="btn ghost" onclick="UI.closeModal()">关闭</button>
               <button class="btn" id="impBtn">导入为新存档</button>`,
      onMount: ov => {
        ov.querySelector('#expBtn').onclick = async () => {
          if (!Game.saveId) return toast('还没有存档', 'err');
          try {
            let data;
            if (Backend.mode === 'server') {
              const r = await fetch(`./api/saves/${Game.saveId}/export`);
              data = await r.json();
            } else {
              data = Backend._all()[Game.saveId];
              data = { ...data, messages: Game.messages };
            }
            const txt = JSON.stringify(data, null, 2);
            await navigator.clipboard.writeText(txt).catch(() => {});
            ov.querySelector('#impText').value = txt;
            toast('已复制到剪贴板，也填在下面的框里了', 'ok');
          } catch (e) { toast(e.message, 'err'); }
        };
        ov.querySelector('#impBtn').onclick = async e => {
          const raw = ov.querySelector('#impText').value.trim();
          const box = ov.querySelector('#impResult');
          if (!raw) return;
          let data;
          try { data = JSON.parse(raw); } catch { box.innerHTML = '<div class="result err">❌ JSON 格式不对</div>'; return; }
          try {
            if (Backend.mode === 'server') {
              const { state } = await Backend.createSave(data.name || '导入的旅途');
              const r = await fetch(`./api/saves/${state.id}/import`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ save: { ...data, id: state.id } }),
              });
              if (!r.ok) throw new Error('导入失败');
              box.innerHTML = '<div class="result ok">✅ 导入成功</div>';
            } else {
              const s = { ...freshState(data.name || '导入的旅途'), ...data, id: uid() };
              Backend._put(s);
              box.innerHTML = '<div class="result ok">✅ 导入成功</div>';
            }
            renderSaves(await Backend.listSaves());
          } catch (err) { box.innerHTML = `<div class="result err">❌ ${esc(err.message)}</div>`; }
        };
      },
    });
  },

  /* ── 死亡 ── */
  openDeath() {
    if (document.querySelector('.overlay.death')) return;
    const s = Game.state || {};
    const canPay = s.score >= 300;
    const ov = this.openModal({
      title: '你死了',
      body: `
        <div style="text-align:center;padding:8px 0 4px">
          <div style="font-size:44px;line-height:1;margin-bottom:12px">🕯</div>
          <div style="color:var(--hp);font-size:15px;margin-bottom:8px">HP 归零</div>
          <div style="color:var(--text-dim);font-size:13px;line-height:1.8">
            灰雾重新包裹住你，痛觉一点点褪去。<br>
            主神空间那个没有感情的声音响起来：<br>
            「是否支付 <b style="color:var(--score)">300 积分</b>，重新凝聚形体？」<br>
            <span style="color:var(--muted);font-size:12px">当前积分：${s.score ?? 0}</span>
          </div>
        </div>`,
      footer: `
        <button class="btn danger" id="dNew">放弃这段旅途</button>
        <div style="flex:1"></div>
        <button class="btn" id="dRevive" ${canPay ? '' : 'disabled'}>支付 300 积分复活</button>`,
      onMount: o => {
        o.classList.add('death');
        o.querySelector('#dRevive').onclick = async e => {
          e.target.disabled = true;
          try {
            const st = await Backend.revive(Game.saveId, Game.state);
            Game.state = { ...Game.state, ...st, messages: undefined };
            renderState(Game.state);
            Game.addSystem('你在灰雾中重新睁开眼睛。心跳很重，但确实在跳。', 'good');
            UI.closeModal();
            if (Backend.mode === 'local') await Game.load(Game.saveId);
          } catch (err) { toast(err.message, 'err'); e.target.disabled = false; }
        };
        o.querySelector('#dNew').onclick = () => {
          UI.closeModal();
          UI.openNewSave();
        };
      },
    });
  },
};

/* ═══════════════ 9. 启动 ═══════════════ */
/** 背包 chip 点击：能穿的穿，能吃的吃，都不行就提示去剧情里用 */
Game.useItem = async function (itemId) {
  if (!this.state) return;
  const d = window.GAME_DATA;
  const inv = (this.state.inventory || []).find(i => i.id === itemId || i.name === itemId);
  const def = d?.equipment.find(x => x.id === (inv?.id || itemId));
  const equippable = def && Boolean(SLOT_ACCEPTS()[def.slot]);
  try {
    const r = equippable
      ? await Backend.equip(this.saveId, itemId, this.state)
      : await Backend.useItem(this.saveId, itemId, this.state);
    if (!r.ok) return toast(r.msg, 'err');
    if (r.state) this.state = { ...this.state, ...r.state, messages: undefined };
    else await this.load(this.saveId);
    renderState(this.state);
    this.addSystem(r.msg, 'good');
    toast(r.msg, 'ok');
    if (equippable) UI.openInventory();
  } catch (e) { toast(e.message, 'err'); }
};

Game.rest = async function (cost) {
  if (!this.state) return;
  const c = cost || window.GAME_DATA?.economy?.restCost || 500;
  try {
    this.state = await Backend.rest(this.saveId, c, this.state);
    renderState(this.state);
    this.addSystem(`进入恢复舱，HP / 体力 已回满（-${c} 积分）。`, 'good');
    toast('恢复完毕', 'ok');
  } catch (e) { toast(e.message, 'err'); }
};

window.UI = UI;
window.Game = Game;

document.addEventListener('DOMContentLoaded', () => {
  Game.boot().catch(e => {
    console.error(e);
    toast('初始化失败：' + e.message, 'err', 6000);
  });
});
