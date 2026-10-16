/* ══════════════════════════════════════════════════════════════════════
   界面偏好（显示 / 阅读）
   存在浏览器 localStorage 里 —— 这是「这台设备看着舒服」的设置，
   不跟存档走，也不会同步给别人。
   ══════════════════════════════════════════════════════════════════════ */
(function () {
  const KEY = 'dsh_ui_prefs';

  const DEFAULT = {
    theme: 'dark',        // dark | light | auto
    scale: 1,             // 0.85 ~ 1.25
    fastAnim: false,      // true = 关掉动画
    font: 'system',
    readSize: 14.5,
    readLh: 1.85,
    narration: 'color',   // color | plain
  };

  // 全部用系统自带字体 —— 不用等网络字体下载，也不用担心挂掉
  const FONTS = [
    { id: 'system', name: '系统默认', desc: '无衬线，最清晰', css: '"PingFang SC", "Microsoft YaHei", "Hiragino Sans GB", system-ui, sans-serif' },
    { id: 'song', name: '宋体', desc: '衬线，书卷感', css: '"Songti SC", "SimSun", "Noto Serif SC", serif' },
    { id: 'kai', name: '楷体', desc: '手写气质', css: '"Kaiti SC", "KaiTi", "STKaiti", "楷体", serif' },
    { id: 'hei', name: '黑体', desc: '现代，笔画均匀', css: '"Microsoft YaHei", "PingFang SC", "Heiti SC", sans-serif' },
    { id: 'mono', name: '等宽', desc: '像在读文档', css: 'ui-monospace, "Cascadia Mono", Consolas, monospace' },
  ];

  function load() {
    try {
      return Object.assign({}, DEFAULT, JSON.parse(localStorage.getItem(KEY) || '{}'));
    } catch (e) {
      return Object.assign({}, DEFAULT);
    }
  }

  function save(p) {
    try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) { /* 隐私模式禁了存储，忽略 */ }
  }

  function reset() {
    save(Object.assign({}, DEFAULT));
    apply();
  }

  /** 把偏好写进 DOM：主题走 data-theme，其余走 CSS 变量 */
  function apply() {
    const p = load();
    const root = document.documentElement;
    const sysLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    const theme = p.theme === 'auto' ? (sysLight ? 'light' : 'dark') : p.theme;

    root.dataset.theme = theme;
    root.style.setProperty('--ui-scale', String(p.scale));
    root.style.setProperty('--read-size', p.readSize + 'px');
    root.style.setProperty('--read-lh', String(p.readLh));
    const f = FONTS.find(x => x.id === p.font) || FONTS[0];
    root.style.setProperty('--read-font', f.css);
    if (document.body) {
      document.body.classList.toggle('no-anim', Boolean(p.fastAnim));
      document.body.classList.toggle('plain-narration', p.narration === 'plain');
    }
  }

  // 「跟随系统」时要跟着系统变
  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => { if (load().theme === 'auto') apply(); };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }

  window.Prefs = { KEY, DEFAULT, FONTS, load, save, apply, reset };
  window.applyPrefs = apply;
})();
