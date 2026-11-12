/* =========================================================================
   个人生活助手 —— 记账 / 统计 / 金库
   设计：Apple Liquid Glass 材质 + Lucide 线性图标
   数据存储：localStorage（关闭浏览器不丢失）
   ========================================================================= */

'use strict';

/* ---------------------- 常量 ---------------------- */
const STORE_KEY = 'life_assistant_v1';
const DATA_VERSION = 6;
const DEFAULT_LIMIT = 1500;
/** 左上角应用名称的默认值（用户可在界面随时修改，覆盖后存于 data.appName） */
const DEFAULT_APP_NAME = '鱼叉的专属app';
/** 应用名称最大长度（字符） */
const APP_NAME_MAX = 20;

/* 分类：吃饭 / 奶茶 / 宵夜（原「餐饮」拆分）+ 宿舍 + 交通 / 购物 / 娱乐 / 其它 */
const CATEGORIES = ['吃饭', '奶茶', '宵夜', '宿舍', '交通', '购物', '娱乐', '其它'];

/* Lucide 图标名（替代 emoji，保持内容层统一线性风格） */
const CATEGORY_ICON = {
  吃饭: 'utensils', 奶茶: 'cup-soda', 宵夜: 'moon', 宿舍: 'bed-double',
  交通: 'bus', 购物: 'shopping-bag', 娱乐: 'gamepad-2', 其它: 'package',
};

/* 分类色板：低饱和、与设计系统一致 */
const CATEGORY_COLOR = {
  吃饭: '#17a073',
  奶茶: '#c76a9a',
  宵夜: '#d0803c',
  宿舍: '#7b6bc4',
  交通: '#4a7fc1',
  购物: '#c99a2e',
  娱乐: '#a3679f',
  其它: '#8798a0',
};

/* 每个分类色对应的浅色底（图标 chip 背景） */
const CATEGORY_TINT = {
  吃饭: '#e6f5ef',
  奶茶: '#f8ecf3',
  宵夜: '#fbeee2',
  宿舍: '#efedf9',
  交通: '#e8f0f9',
  购物: '#f9f2e0',
  娱乐: '#f4ecf3',
  其它: '#eef1f1',
};

/* 历史数据兼容：旧「餐饮」统一归入「吃饭」 */
const CATEGORY_ALIAS = { 餐饮: '吃饭' };
function normalizeCategory(cat) {
  return CATEGORY_ALIAS[cat] || cat;
}

/* --- 吃饭的子分类（餐次） ---
   仅当 category === '吃饭' 时有效；可不选（'' 表示没选，照常提交）。
   注意：这只影响记录本身与账单文案，统计仍按 category('吃饭') 聚合，输出不变。 */
const MEAL_PARENT = '吃饭';
const MEALS = ['早餐', '午饭', '晚饭'];
/* 餐次图标：早/午/晚 = 日出 / 日中 / 日落（刻意避开「宵夜」已用的 moon） */
const MEAL_ICON = { 早餐: 'sunrise', 午饭: 'sun', 晚饭: 'sunset' };

/** 非法 / 缺省餐次一律归一为空串 */
function normalizeMeal(meal) {
  return MEALS.indexOf(meal) > -1 ? meal : '';
}
/** 只有父分类是「吃饭」才保留餐次，其它分类恒为 '' */
function mealForCategory(category, meal) {
  return category === MEAL_PARENT ? normalizeMeal(meal) : '';
}

/* 该笔支出是否计入当月环形图（未设置的历史记录默认计入） */
function isCounted(tx) {
  return !(tx && tx.counted === false);
}

/* ---------------------- 观影常量 ---------------------- */
/** 观看状态：想看 / 在看 / 已看完 / 暂停 */
const SHOW_STATUSES = ['want', 'watching', 'watched', 'paused'];
const SHOW_STATUS_META = {
  want:     { label: '想看',   icon: 'bookmark',        cls: 'st-want' },
  watching: { label: '在看',   icon: 'play-circle',     cls: 'st-watching' },
  watched:  { label: '已看完', icon: 'check-circle-2',  cls: 'st-watched' },
  paused:   { label: '暂停',   icon: 'pause-circle',    cls: 'st-paused' },
};
/** 排序方式（key → 显示名） */
const SHOW_SORTS = { updated: '最近更新', created: '添加时间', title: '名称' };
/** 封面类型：外部 URL / 本地上传 / AI 生成（预留）/ 无 */
const SHOW_COVER_TYPES = ['none', 'url', 'local', 'ai'];
/** 本季进度区块最多先展示几张海报（超出折叠） */
const SHOW_SECTION_LIMIT = 6;
/** 单张封面上限（字节），超出拒绝写入 IndexedDB */
const COVER_MAX_BYTES = 5 * 1024 * 1024;

/* ---------------------- 英语单词常量 ---------------------- */
/* 一张卡片 = 一组词（1~N 个）；「单个单词」就是只有 1 个词的卡片。
   词与词之间互相独立、各占一行，便于区分形近词。 */
/** 单个单词最大长度（字符），超出截断，防止极端输入撑破卡片 */
const WORD_MAX_LEN = 40;
/** 单个释义最大长度（字符），超出截断；量级对齐 normalizeShow 里的 genre */
const MEANING_MAX_LEN = 60;

/* 账户顺序：微信 → 支付宝 → 银行（微信为默认付款方式）
   微信在金库中拆分为「零钱 / 零钱通」；记账默认走「零钱通」，零钱只保留余额展示。 */
const ACCOUNTS = {
  wechat: {
    name: '微信', icon: 'message-square-text',
    subAccounts: [
      { key: 'wechat_change', name: '零钱', icon: 'coins' },
      { key: 'wechat_lct', name: '零钱通', icon: 'piggy-bank', isDefault: true },
    ],
  },
  alipay: { name: '支付宝', icon: 'smartphone' },
  bank: { name: '银行', icon: 'landmark' },
};
const DEFAULT_ACCOUNT = 'wechat';

/* 金库余额键：微信拆为 wechat_change（零钱）/ wechat_lct（零钱通），其余账户同名 */
const VAULT_KEYS = ['wechat_change', 'wechat_lct', 'alipay', 'bank'];
const VAULT_META = {
  wechat_change: { name: '零钱', icon: 'coins', parent: 'wechat' },
  wechat_lct: { name: '零钱通', icon: 'piggy-bank', parent: 'wechat' },
  alipay: { name: '支付宝', icon: 'smartphone' },
  bank: { name: '银行', icon: 'landmark' },
};
/* 交易里的 account → 金库扣减键（微信默认扣「零钱通」） */
const ACCOUNT_TO_VAULT_KEY = { wechat: 'wechat_lct', alipay: 'alipay', bank: 'bank' };
function vaultKeyOf(account) {
  return ACCOUNT_TO_VAULT_KEY[account] || account;
}

/* 默认扣款改到零钱通之前的微信交易，当时扣的都是「零钱」。
   这些记录没有 vaultKey 字段，回滚时必须按当时的事实退零钱，不能跟着新默认走。 */
const LEGACY_WECHAT_VAULT_KEY = 'wechat_change';

/** 该笔交易当初实际动过的金库键。
 *  新记录带 vaultKey；历史微信记录没有该字段，按当时事实退「零钱」。 */
function vaultKeyOfTx(tx) {
  const k = tx && tx.vaultKey;
  if (k && VAULT_KEYS.indexOf(k) >= 0) return k;
  return (tx && tx.account === 'wechat') ? LEGACY_WECHAT_VAULT_KEY : vaultKeyOf(tx && tx.account);
}

/* ---------------------- 工具函数 ---------------------- */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const pad2 = (n) => String(n).padStart(2, '0');

/** 本地日期 YYYY-MM-DD（避免 UTC 偏移） */
function todayStr(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
/** 本地月份 YYYY-MM */
function monthStr(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}
const dateOf = (s) => (s || '').slice(0, 10);
const monthOf = (s) => (s || '').slice(0, 7);

/** 月份加减：'YYYY-MM' + n 个月，Date 自动处理跨年进位/借位 */
function addMonths(ym, n) {
  const [y, m] = (ym || monthStr()).split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

const money = (n) => '¥' + (Number(n) || 0).toFixed(2);
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const numOr = (v, dft) => (isFinite(Number(v)) ? Number(v) : dft);

function formatDateCN(s) {
  const d = dateOf(s);
  const [y, m, day] = d.split('-');
  const week = ['日', '一', '二', '三', '四', '五', '六'];
  const w = new Date(`${d}T00:00:00`).getDay();
  return `${y}/${m}/${day} 周${week[w]}`;
}

/* ---------------------- Lucide 图标 ---------------------- */
/** 生成一个 Lucide 图标占位元素（<i data-lucide>） */
function icon(name, cls) {
  return `<i data-lucide="${name}"${cls ? ` class="${cls}"` : ''}></i>`;
}
/** 渲染所有尚未实例化的 Lucide 图标（幂等，可重复调用） */
function refreshIcons(root) {
  try {
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      window.lucide.createIcons({
        attrs: { 'stroke-width': 1.9 },
        nameAttr: 'data-lucide',
        ...(root ? { root } : {}),
      });
    }
  } catch (e) {
    // 图标库缺失时静默降级为无图标，不影响任何数据功能
    console.warn('图标渲染失败（不影响功能）', e);
  }
}

/* 分类图标 chip（浅色底 + 分类色图标） */
function catChip(cat, size) {
  const name = normalizeCategory(cat);
  const ic = CATEGORY_ICON[name] || 'package';
  const fg = CATEGORY_COLOR[name] || '#8798a0';
  const bg = CATEGORY_TINT[name] || '#eef1f1';
  return `<span class="cat-chip${size === 'lg' ? ' cat-lg' : ''}" style="--chip-bg:${bg};--chip-fg:${fg}">${icon(ic)}</span>`;
}

/* ---------------------- 观影数据规范化（纯函数，可单测） ---------------------- */
const clampInt = (v, dft) => {
  const n = Math.floor(Number(v));
  return isFinite(n) ? n : dft;
};
const strOr = (v) => (typeof v === 'string' ? v : '');

/** 把季/集规整为 ≥1 的整数 */
function normSeasonEp(v, dft) {
  return Math.max(1, clampInt(v, dft));
}
/** 可空正整数（未知 → null，绝不虚构） */
function normOptPositiveInt(v) {
  if (v == null || v === '') return null;
  const n = Math.floor(Number(v));
  return isFinite(n) && n >= 1 ? n : null;
}
/** 年份：非法 → null，合法 → clamp 1900–2100 */
function normYear(v) {
  if (v == null || v === '') return null;
  const n = Math.floor(Number(v));
  if (!isFinite(n)) return null;
  return Math.min(2100, Math.max(1900, n));
}
/** 评分：非法 → null，合法 → clamp 0–10（保留一位小数不强制） */
function normRating(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!isFinite(n)) return null;
  return Math.min(10, Math.max(0, Math.round(n * 10) / 10));
}
/** 封面 URL 白名单：仅 http(s) 与 data:image，其余视为无效（防 XSS） */
function safeCoverUrl(url) {
  const s = String(url == null ? '' : url).trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  if (/^data:image\//i.test(s)) return s;
  return '';
}

/** 规范化一条剧集；返回 false 表示该条非法应被丢弃 */
function normalizeShow(s) {
  if (!s || typeof s !== 'object') return false;
  const title = strOr(s.title).trim();
  if (!title) return false; // 标题必填

  s.id = strOr(s.id) || 'show_' + uid();
  s.title = title.slice(0, 120);
  s.originalTitle = strOr(s.originalTitle).slice(0, 120);
  s.year = normYear(s.year);
  s.genre = strOr(s.genre).slice(0, 60);
  s.status = SHOW_STATUSES.indexOf(s.status) > -1 ? s.status : 'want';

  // 一季 = 一条记录：不再有「季」维度，进度只记「本季第几集」
  s.episode = normSeasonEp(s.episode, 1);
  s.currentSeasonEpisodes = normOptPositiveInt(s.currentSeasonEpisodes);
  // 退役字段：显式清掉，避免旧数据残留（迁移已在 migrate 中处理，这里兜底）
  delete s.season;
  delete s.totalSeasons;

  s.coverType = SHOW_COVER_TYPES.indexOf(s.coverType) > -1 ? s.coverType : 'none';
  s.coverUrl = safeCoverUrl(s.coverUrl);
  s.coverKey = strOr(s.coverKey);
  // 一致性兜底：URL 型必须有合法 url，本地/AI 型必须有 key，否则降级
  if (s.coverType === 'url' && !s.coverUrl) s.coverType = 'none';
  if ((s.coverType === 'local' || s.coverType === 'ai') && !s.coverKey) s.coverType = 'none';

  s.externalId = strOr(s.externalId);
  s.summary = strOr(s.summary).slice(0, 2000);
  s.rating = normRating(s.rating);
  s.note = strOr(s.note).slice(0, 2000);

  s.createdAt = Number(s.createdAt) || Date.now();
  s.updatedAt = Number(s.updatedAt) || s.createdAt;
  s.lastWatchedAt = Number(s.lastWatchedAt) || null;
  s.finishedAt = /^\d{4}-\d{2}-\d{2}$/.test(strOr(s.finishedAt)) ? s.finishedAt : '';
  return true;
}

/** 规范化一条观看记录；返回 false 表示应被丢弃 */
function normalizeWatchLog(l) {
  if (!l || typeof l !== 'object') return false;
  const showId = strOr(l.showId);
  if (!showId) return false;
  l.id = strOr(l.id) || 'log_' + uid();
  l.showId = showId;
  l.at = Number(l.at) || Date.now();
  l.kind = ['progress', 'status', 'finish'].indexOf(l.kind) > -1 ? l.kind : 'progress';
  l.season = normOptPositiveInt(l.season);
  l.episode = normOptPositiveInt(l.episode);
  l.note = strOr(l.note).slice(0, 200);
  return true;
}

/* ---------------------- 英语单词规范化（纯函数，可单测） ---------------------- */
/**
 * 规范化一个单词。接受字符串（旧写法）或 { id, text, meaning } 对象，统一产出对象形式。
 * 每个词保留稳定 id：后续加「复习记录」时可直接按词挂数据，无需再迁移结构。
 * meaning 为可选中文字义，缺省为空串（旧数据自动兜底，故无需升 DATA_VERSION）。
 * 返回 false 表示该词非法（空串）应被丢弃。
 */
function normalizeWord(w) {
  const src = (w && typeof w === 'object') ? w : { text: w };
  const text = strOr(src.text).trim().slice(0, WORD_MAX_LEN);
  if (!text) return false;
  return {
    id: strOr(src.id) || 'w_' + uid(),
    text,
    meaning: strOr(src.meaning).trim().slice(0, MEANING_MAX_LEN),
  };
}

/**
 * 规范化一张单词卡片；返回 false 表示该卡非法应被丢弃。
 * 空卡（没有任何有效单词）直接丢弃；同卡内大小写不敏感去重。
 */
function normalizeWordCard(c) {
  if (!c || typeof c !== 'object') return false;
  const raw = Array.isArray(c.words) ? c.words : [];
  const words = [];
  const seen = new Set();
  raw.forEach((w) => {
    const nw = normalizeWord(w);
    if (!nw) return;
    const key = nw.text.toLowerCase();
    if (seen.has(key)) return;   // 同一张卡里不重复存同一个词
    seen.add(key);
    words.push(nw);
  });
  if (!words.length) return false;

  c.id = strOr(c.id) || 'wc_' + uid();
  c.words = words;
  c.createdAt = Number(c.createdAt) || Date.now();
  c.updatedAt = Number(c.updatedAt) || c.createdAt;
  return true;
}

/**
 * 把「一行一个单词」的文本框内容解析为 [{ text, meaning }] 数组。
 * 每行格式：`单词` 或 `单词<空白>释义` —— 按行内**第一个空白**切分，释义可含空格。
 * 逐行 trim、丢空行、只按换行切分；按单词（不区分大小写）去重，保留先出现者。
 */
function parseWordEntries(text) {
  const out = [];
  const seen = new Set();
  String(text == null ? '' : text).split(/\r?\n/).forEach((line) => {
    const t = line.trim();
    if (!t) return;
    const i = t.search(/\s/);
    const word = (i < 0 ? t : t.slice(0, i)).slice(0, WORD_MAX_LEN);
    const meaning = (i < 0 ? '' : t.slice(i + 1)).trim().slice(0, MEANING_MAX_LEN);
    if (!word) return;
    const key = word.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ text: word, meaning });
  });
  return out;
}

/**
 * 把文本框内容解析为单词字符串数组（= parseWordEntries 只取词形的简写）。
 * 契约保持不变：既有调用方与测试依赖「返回字符串数组」。
 */
function parseWordsInput(text) {
  return parseWordEntries(text).map((e) => e.text);
}

/**
 * 编辑保存时按词形（不区分大小写）沿用旧词 id，保证词的 id 在多次编辑后保持稳定，
 * 后续「复习记录」按 id 挂数据才不会因编辑而断链。词形匹配不到的新词则不带 id，由
 * normalizeWord 生成。
 */
function mergeWordIds(entries, oldWords) {
  const map = new Map();
  (oldWords || []).forEach((w) => {
    if (w && w.text) map.set(String(w.text).toLowerCase(), w.id);
  });
  return (entries || []).map((e) => {
    const id = map.get(String(e.text).toLowerCase());
    return id ? { id, text: e.text, meaning: e.meaning } : { text: e.text, meaning: e.meaning };
  });
}

/** 搜索：匹配卡内任意单词或释义（不区分大小写）；空关键词返回全部（新数组） */
function filterWordCards(list, query) {
  const q = String(query || '').trim().toLowerCase();
  const src = list || [];
  if (!q) return src.slice();
  return src.filter((c) => (c.words || []).some(
    (w) => String(w && w.text || '').toLowerCase().indexOf(q) > -1
      || String(w && w.meaning || '').toLowerCase().indexOf(q) > -1
  ));
}

/* ---------------------- 数据层 ---------------------- */
const Store = {
  data: null,

  load() {
    let raw = null;
    try {
      raw = localStorage.getItem(STORE_KEY);
    } catch (e) {
      console.warn('localStorage 不可用', e);
    }

    let parsed = null;
    if (raw) {
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        // 数据损坏：先备份原始串，避免直接丢失
        console.warn('本地数据解析失败，已备份原始串', e);
        try { localStorage.setItem(STORE_KEY + '_backup_' + Date.now(), raw); } catch (_) {}
        parsed = null;
      }
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      this.reset();
      return this.data;
    }

    this.data = parsed;
    this.migrate();
    this.sanitize();
    return this.data;
  },

  /** 数据版本迁移：v1→v2（餐饮→吃饭）；v2→v3（微信拆为零钱/零钱通）；v3→v4（新增观影模块）；v4→v5（一季一条）；v5→v6（新增英语单词模块） */
  migrate() {
    const v = Number(this.data.version || 1);

    if (v < 2) {
      (this.data.transactions || []).forEach((t) => {
        if (t && t.category) t.category = normalizeCategory(t.category);
      });
    }

    if (v < 3) {
      // 旧版 vault.wechat 余额整体迁入「零钱」，零钱通从 0 开始
      const old = this.data.vault || {};
      const legacyWechat = numOr(old.wechat, 0);
      this.data.vault = {
        wechat_change: legacyWechat,
        wechat_lct: numOr(old.wechat_lct, 0),
        alipay: numOr(old.alipay, 0),
        bank: numOr(old.bank, 0),
      };
      // 交易记录里的 account 保持 'wechat' 不变（默认扣零钱）
    }

    if (v < 4) {
      // v3 → v4：新增「观影」模块，老数据补空数组；不改动 transactions / budgets / vault
      if (!Array.isArray(this.data.shows)) this.data.shows = [];
      if (!Array.isArray(this.data.watchLogs)) this.data.watchLogs = [];
    }

    if (v < 5) {
      // v4 → v5：「一季一条」，移除季维度。
      // 旧记录的 season>1 时把季号并入标题（否则同名多季条目无法分辨），
      // 例：进击的巨人 + season 3 → 「进击的巨人3」，与新流程产出的标题格式一致。
      // totalSeasons 无复用价值，直接丢弃（用户确认「不用管，可以删除」）。
      (this.data.shows || []).forEach((s) => {
        if (!s || typeof s !== 'object') return;
        const legacySeason = normOptPositiveInt(s.season);
        if (legacySeason != null && legacySeason > 1) {
          const base = strOr(s.title).trim() || '未命名';
          // 幂等：标题已以该数字结尾则不重复追加
          if (!new RegExp(legacySeason + '$').test(base)) s.title = (base + legacySeason).slice(0, 120);
        }
        delete s.season;
        delete s.totalSeasons;
      });
    }

    if (v < 6) {
      // v5 → v6：新增「英语单词」模块，老数据补空数组；
      // 不改动 transactions / budgets / vault / shows / watchLogs 中任何既有字段。
      if (!Array.isArray(this.data.wordCards)) this.data.wordCards = [];
    }

    this.data.version = DATA_VERSION;
    this.save();
  },

  /** 结构校验与兜底：确保关键字段存在且类型正确 */
  sanitize() {
    if (!Array.isArray(this.data.transactions)) this.data.transactions = [];
    if (!this.data.budgets || typeof this.data.budgets !== 'object') this.data.budgets = {};
    if (!this.data.vault || typeof this.data.vault !== 'object') this.data.vault = {};

    // 金库键标准化（兼容任何残缺结构）
    const v = this.data.vault;
    this.data.vault = {
      wechat_change: numOr(v.wechat_change, numOr(v.wechat, 0)),
      wechat_lct: numOr(v.wechat_lct, 0),
      alipay: numOr(v.alipay, 0),
      bank: numOr(v.bank, 0),
    };

    // 过滤非法交易记录，并补齐缺失字段
    this.data.transactions = this.data.transactions.filter((t) => {
      if (!t || typeof t !== 'object') return false;
      const amt = Number(t.amount);
      if (!isFinite(amt) || amt <= 0) return false;
      if (t.type !== 'expense' && t.type !== 'income') return false;
      if (!t.date || typeof t.date !== 'string') return false;
      t.amount = round2(amt);
      t.account = ACCOUNTS.hasOwnProperty(t.account) ? t.account : DEFAULT_ACCOUNT;
      t.category = t.type === 'expense' ? normalizeCategory(t.category || '其它') : '';
      t.meal = t.type === 'expense' ? mealForCategory(t.category, t.meal) : '';
      t.counted = t.counted !== false;   // 默认计入环形图
      // 金库键兜底：非法值清空，让回滚走账户默认池
      // （adjustVault 对非法 key 是静默 return，脏数据会导致「账删了、钱没退」）
      if (t.vaultKey !== undefined && VAULT_KEYS.indexOf(t.vaultKey) < 0) delete t.vaultKey;
      t.remark = typeof t.remark === 'string' ? t.remark : '';
      t.createdAt = Number(t.createdAt) || Date.parse(t.date) || Date.now();
      if (!t.id) t.id = uid();
      return true;
    });

    if (!Array.isArray(this.data.customNav)) this.data.customNav = [];

    // 观影：剧集数组（非法条目直接丢弃）+ 观看记录（孤儿记录一并清理）
    if (!Array.isArray(this.data.shows)) this.data.shows = [];
    this.data.shows = this.data.shows.filter((s) => normalizeShow(s));
    if (!Array.isArray(this.data.watchLogs)) this.data.watchLogs = [];
    this.data.watchLogs = this.data.watchLogs.filter((l) => normalizeWatchLog(l));
    const showIds = new Set(this.data.shows.map((s) => s.id));
    this.data.watchLogs = this.data.watchLogs.filter((l) => showIds.has(l.showId));

    // 英语单词：卡片数组（非法条目直接丢弃，空卡也丢）
    if (!Array.isArray(this.data.wordCards)) this.data.wordCards = [];
    this.data.wordCards = this.data.wordCards.filter((c) => normalizeWordCard(c));

    // 应用名称兜底：缺失 / 非字符串 / 空串 → 回落到默认名
    if (typeof this.data.appName !== 'string' || !this.data.appName.trim()) {
      this.data.appName = DEFAULT_APP_NAME;
    } else {
      this.data.appName = this.data.appName.trim().slice(0, APP_NAME_MAX);
    }
  },

  reset() {
    this.data = {
      version: DATA_VERSION,
      appName: DEFAULT_APP_NAME,      // 左上角应用名称（可修改）
      transactions: [],
      budgets: {},                    // { "YYYY-MM": limit }
      vault: { wechat_change: 0, wechat_lct: 0, alipay: 0, bank: 0 },
      customNav: [],                  // 预留扩展功能
      shows: [],                      // 观影：剧集
      watchLogs: [],                  // 观影：观看记录
      wordCards: [],                  // 英语单词：卡片（一卡一组词，1~N 个）
    };
    this.save();
  },

  save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.data));
      // 登录云同步后，本地变更自动上传（cloud.js；未启用时为空操作）
      if (typeof scheduleAutoPush === 'function') scheduleAutoPush();
      return true;
    } catch (e) {
      console.error('保存失败', e);
      toast('保存失败：本地存储空间不足或被禁用', 'err');
      return false;
    }
  },

  /* --- 交易 --- */
  addTransaction(tx) {
    this.data.transactions.push(tx);
    this.save();
  },
  removeTransaction(id) {
    const i = this.data.transactions.findIndex((t) => t.id === id);
    if (i > -1) { this.data.transactions.splice(i, 1); this.save(); return true; }
    return false;
  },
  getTransactions(month) {
    return this.data.transactions
      .filter((t) => monthOf(t.date) === month)
      .sort((a, b) => (b.date + String(b.createdAt)).localeCompare(a.date + String(a.createdAt)));
  },
  getByDate(date) {
    return this.data.transactions
      .filter((t) => dateOf(t.date) === date)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  },

  /* --- 预算 --- */
  getLimit(month) {
    const v = this.data.budgets[month];
    if (v == null) return DEFAULT_LIMIT;
    const n = Number(v);
    return isFinite(n) && n >= 0 ? n : DEFAULT_LIMIT;
  },
  setLimit(month, value) {
    this.data.budgets[month] = round2(numOr(value, DEFAULT_LIMIT));
    this.save();
  },

  /* --- 金库 --- */
  getVault() { return this.data.vault; },

  /** 调整金库余额。key 可以是「金库键」（wechat_change / wechat_lct / alipay / bank），
   *  也可以是交易账户键（wechat → 默认落到零钱通）。 */
  adjustVault(key, delta) {
    const vaultKey = vaultKeyOf(key);
    if (!Object.prototype.hasOwnProperty.call(this.data.vault, vaultKey)) return;
    const d = numOr(delta, 0);
    this.data.vault[vaultKey] = round2(this.data.vault[vaultKey] + d);
    this.save();
  },

  /** 微信账户余额 = 零钱 + 零钱通 */
  wechatTotal() {
    const v = this.data.vault;
    return round2(v.wechat_change + v.wechat_lct);
  },

  totalAssets() {
    const v = this.data.vault;
    return round2(v.wechat_change + v.wechat_lct + v.alipay + v.bank);
  },

  /* --- 观影：剧集 --- */
  getShows() { return this.data.shows; },
  getShow(id) { return this.data.shows.find((s) => s.id === id); },

  addShow(show) {
    const s = Object.assign({}, show);
    if (!normalizeShow(s)) return null; // title 为空则拒绝
    this.data.shows.push(s);
    this.save();
    return s;
  },

  updateShow(id, patch) {
    const s = this.getShow(id);
    if (!s) return null;
    Object.assign(s, patch);
    if (!normalizeShow(s)) return null; // 清空标题等非法改动 → 回退（已被就地改写，保守直接返回）
    s.updatedAt = Date.now();
    this.save();
    return s;
  },

  removeShow(id) {
    const i = this.data.shows.findIndex((s) => s.id === id);
    if (i < 0) return false;
    const [removed] = this.data.shows.splice(i, 1);
    // 级联删除该剧集的所有观看记录
    this.data.watchLogs = this.data.watchLogs.filter((l) => l.showId !== id);
    // 异步清理本地封面（IndexedDB 不可用时是空操作）
    if (removed && removed.coverKey && typeof coverDelete === 'function') {
      coverDelete(removed.coverKey);
    }
    this.save();
    return true;
  },

  /** 写入观看进度：同时刷新 lastWatchedAt / updatedAt 并留痕（一季一条，只需集数） */
  updateProgress(id, episode, opts) {
    const s = this.getShow(id);
    if (!s) return null;
    s.episode = normSeasonEp(episode, s.episode);
    const now = Date.now();
    s.lastWatchedAt = now;
    s.updatedAt = now;
    // 首次推进进度自动进入「在看」
    if (s.status === 'want') s.status = 'watching';
    this.addWatchLog({
      showId: id, kind: 'progress',
      episode: s.episode,
      note: (opts && opts.note) || '',
    });
    this.save();
    return s;
  },

  /** 只改状态，绝不动进度与资料 */
  changeShowStatus(id, status) {
    const s = this.getShow(id);
    if (!s || SHOW_STATUSES.indexOf(status) < 0) return null;
    const from = s.status;
    s.status = status;
    s.updatedAt = Date.now();
    this.addWatchLog({
      showId: id, kind: 'status', episode: s.episode,
      note: `${SHOW_STATUS_META[from] ? SHOW_STATUS_META[from].label : from} → ${SHOW_STATUS_META[status].label}`,
    });
    this.save();
    return s;
  },

  /** 标记已看完：保留全部资料，可补日期 / 评分 / 观后感 */
  finishShow(id, opts) {
    const s = this.getShow(id);
    if (!s) return null;
    const o = opts || {};
    s.status = 'watched';
    s.finishedAt = /^\d{4}-\d{2}-\d{2}$/.test(o.date || '') ? o.date : todayStr();
    if (o.rating != null && o.rating !== '') s.rating = normRating(o.rating);
    if (typeof o.note === 'string' && o.note) s.note = o.note.slice(0, 2000);
    const now = Date.now();
    s.updatedAt = now;
    s.lastWatchedAt = s.lastWatchedAt || now;
    this.addWatchLog({
      showId: id, kind: 'finish', episode: s.episode,
      note: '标记为已看完',
    });
    this.save();
    return s;
  },

  /** 内部：追加一条观看记录（补 id / at） */
  addWatchLog(log) {
    if (!Array.isArray(this.data.watchLogs)) this.data.watchLogs = [];
    const l = Object.assign({ id: 'log_' + uid(), at: Date.now() }, log || {});
    if (!normalizeWatchLog(l)) return;
    this.data.watchLogs.push(l);
    // 只保留最近 500 条，防止无限膨胀（但绝不删除非本剧集的记录）
    if (this.data.watchLogs.length > 500) {
      this.data.watchLogs = this.data.watchLogs.slice(-500);
    }
  },

  /** 某剧集的观看记录（倒序，默认取最近 limit 条） */
  getWatchLogs(showId, limit) {
    const list = this.data.watchLogs
      .filter((l) => l.showId === showId)
      .sort((a, b) => b.at - a.at);
    return limit ? list.slice(0, limit) : list;
  },

  /* --- 英语单词：卡片 --- */
  getWordCards() { return this.data.wordCards; },
  getWordCard(id) { return this.data.wordCards.find((c) => c.id === id); },

  /** 新增一张卡片。words 可以是字符串数组或 { text } 对象数组；无有效单词则拒绝 */
  addWordCard(card) {
    const c = Object.assign({}, card);
    if (!normalizeWordCard(c)) return null;
    this.data.wordCards.push(c);
    this.save();
    return c;
  },

  /** 更新卡片（如替换整组单词）。更新后无有效单词则拒绝 */
  updateWordCard(id, patch) {
    const c = this.getWordCard(id);
    if (!c) return null;
    Object.assign(c, patch);
    if (!normalizeWordCard(c)) return null;
    c.updatedAt = Date.now();
    this.save();
    return c;
  },

  removeWordCard(id) {
    const i = this.data.wordCards.findIndex((c) => c.id === id);
    if (i < 0) return false;
    this.data.wordCards.splice(i, 1);
    this.save();
    return true;
  },
};

/* ---------------------- 状态 ---------------------- */
const state = {
  page: 'ledger',
  entryType: 'expense',
  account: 'wechat',
  ledgerMonth: monthStr(),
  billQuery: '',
  billCategory: '',
  billScope: 'all',
  statsDate: todayStr(),
  summaryYear: new Date().getFullYear(), // 月度总结浏览年份（动态当年）
  summaryMonth: monthStr(),              // 月度总结选中月份 'YYYY-MM'
  summaryCategory: null,                 // 当前展开的支出分类
  // 观影页 UI 状态（切页不重置，保持用户筛选）
  showStatus: 'all',                     // all | want | watching | watched | paused
  showQuery: '',
  showSort: 'updated',
  showExpanded: { continue: false, watching: false, want: false, watched: false, paused: false },
  showSectionLimit: SHOW_SECTION_LIMIT,
  // 英语单词页 UI 状态（切页不重置，保持用户搜索词）
  wordQuery: '',
};

/* ---------------------- Toast ---------------------- */
let toastTimer = null;
function toast(msg, kind) {
  const el = $('#toast');
  if (!el) return;
  el.innerHTML = icon(kind === 'err' ? 'circle-alert' : 'check') +
    `<span>${escapeHtml(msg)}</span>`;
  el.classList.toggle('err', kind === 'err');
  el.classList.add('show');
  refreshIcons(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2000);
}

/* ---------------------- 弹窗 ---------------------- */
/**
 * 打开弹窗。自动把内容切成「可滚动主体 + 底部固定操作区」，
 * 保证内容过长时提交按钮永远可见（不会溢出到屏幕外）。
 * 规则：DOM 中最后一个 .modal-actions 会被移出滚动区固定在底部。
 */
function openModal(html) {
  const modal = $('#modal');
  modal.innerHTML = html;

  try {
    // 已手动包过或无需处理时直接跳过
    if (!modal.querySelector('.modal-scroll') && typeof window !== 'undefined' && window.DOMParser) {
      const actions = modal.querySelector('.modal-actions');
      const scroll = document.createElement('div');
      scroll.className = 'modal-scroll';
      // 把所有「非底部操作区」的节点移入滚动区，操作区留在外层固定
      Array.prototype.slice.call(modal.childNodes).forEach((node) => {
        if (node !== actions) scroll.appendChild(node);
      });
      // 插到操作区**之前**：.modal 是 column 布局，操作区必须是最后一个子元素
      // 才落在底部（否则按钮会跑到标题上方）。actions 为 null 时等价于 appendChild。
      modal.insertBefore(scroll, actions);
    }
  } catch (e) {
    // 结构处理失败不影响弹窗正常显示
  }

  $('#modalMask').classList.add('show');
  refreshIcons($('#modal'));
}
function closeModal() {
  $('#modalMask').classList.remove('show');
  $('#modal').innerHTML = '';
}
$('#modalMask').addEventListener('click', (e) => { if (e.target.id === 'modalMask') closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

/* =========================================================================
   观影 —— 纯函数（筛选 / 排序 / 分组 / 校验 / 进度运算，可单测）
   ========================================================================= */

/** 校验集数：必须是 ≥1 的整数；若本季总集数已知且集数超出则判无效 */
function validateEpisode(episode, curEpisodes) {
  const e = Math.floor(Number(episode));
  if (!isFinite(e) || e < 1) return { ok: false, episode: null, error: '集数需为 ≥1 的整数' };
  const cap = normOptPositiveInt(curEpisodes);
  if (cap != null && e > cap) {
    return { ok: false, episode: e, error: `本季共 ${cap} 集，集数不能超过 ${cap}` };
  }
  return { ok: true, episode: e, error: '' };
}

/** 筛选：状态 + 关键词（匹配标题 / 原名 / 类型 / 简介），两者可叠加 */
function filterShows(list, status, query) {
  const q = String(query || '').trim().toLowerCase();
  return (list || []).filter((s) => {
    if (status && status !== 'all' && s.status !== status) return false;
    if (!q) return true;
    const hay = [s.title, s.originalTitle, s.genre, s.summary]
      .map((x) => String(x || '').toLowerCase()).join(' ');
    return hay.indexOf(q) > -1;
  });
}

/** 排序：返回新数组（不修改原数组） */
function sortShows(list, sortKey) {
  const arr = (list || []).slice();
  if (sortKey === 'created') {
    arr.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  } else if (sortKey === 'title') {
    arr.sort((a, b) => String(a.title).localeCompare(String(b.title), 'zh'));
  } else {
    // 默认 updated：最近更新在前
    arr.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }
  return arr;
}

/** 分区：继续观看（在看且有观看记录）/ 在看 / 想看 / 已看完 / 暂停 */
function groupShows(list) {
  const src = list || [];
  const g = { continue: [], watching: [], want: [], watched: [], paused: [] };
  src.forEach((s) => {
    if (s.status === 'watching' && s.lastWatchedAt) g.continue.push(s);
    else if (s.status === 'watching') g.watching.push(s);
    else if (s.status === 'want') g.want.push(s);
    else if (s.status === 'watched') g.watched.push(s);
    else if (s.status === 'paused') g.paused.push(s);
  });
  // 各区块按最近更新排序
  Object.keys(g).forEach((k) => { g[k] = sortShows(g[k], 'updated'); });
  return g;
}

/** 进度 +1：已知本季总集数且已在最后一集 → 停在末集（一季一条，不跨季）；未知则只 +1 */
function incEpisode(show) {
  if (!show) return null;
  const cap = normOptPositiveInt(show.currentSeasonEpisodes);
  const episode = normSeasonEp(show.episode, 1);
  if (cap != null && episode >= cap) {
    return { episode: cap }; // 已到本季末集，不再前进（也不自动标记为已看完）
  }
  return { episode: episode + 1 };
}

/** 进度 -1：带下限保护（第 1 集不再后退） */
function decEpisode(show) {
  if (!show) return null;
  const episode = normSeasonEp(show.episode, 1);
  return { episode: episode > 1 ? episode - 1 : 1 };
}

/** 进度文案：已知本季总集数 → 「第 5 / 10 集」；未知 → 「第 5 集」 */
function showProgressText(show) {
  if (!show) return '';
  const e = normSeasonEp(show.episode, 1);
  const cap = normOptPositiveInt(show.currentSeasonEpisodes);
  return cap != null ? `第 ${e} / ${cap} 集` : `第 ${e} 集`;
}

/** 进度百分比：总集数未知返回 null（渲染层据此不画进度条） */
function showProgressPercent(show) {
  if (!show) return null;
  const cap = normOptPositiveInt(show.currentSeasonEpisodes);
  if (cap == null) return null;
  const e = normSeasonEp(show.episode, 1);
  return Math.min(100, Math.round((e / cap) * 100));
}

/** 详情页/编辑页进度输入是否应提示越界 */
function progressWarn(show) {
  if (!show) return '';
  const cap = normOptPositiveInt(show.currentSeasonEpisodes);
  const e = normSeasonEp(show.episode, 1);
  if (cap != null && e > cap) return `集数（${e}）已超出本季总集数（${cap}）`;
  return '';
}

/* =========================================================================
   观影 —— 封面存储（IndexedDB，不可用时自动降级为内存 Map）
   所有 API 均返回 Promise 且「永不 reject」，失败一律返回 null / false。
   ========================================================================= */
const COVER_DB_NAME = 'life_assistant_media';
const COVER_DB_VERSION = 1;
const COVER_STORE = 'covers';

let coverDbInstance = null;       // 打开后的 IDBDatabase 单例
let coverDbFailed = false;        // 打开失败后不再重试
const coverMemStore = new Map();  // 降级存储：key -> Blob/File
const coverUrlCache = new Map();  // key -> objectURL（避免重复创建导致泄漏）
/**
 * 渲染轮次标记，用于异步回填防竞态。
 * 按 root（DOM 子树）分别计数：页面网格与弹窗是两个独立会话，
 * 各自递增互不干扰，避免「后发起的 hydrate 把先发起的回调判定为过期而丢弃」。
 */
const coverTokens = new WeakMap();

/** 同步探测当前环境是否具备 IndexedDB */
function coverDbAvailable() {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch (e) {
    return false;
  }
}

/** 打开（或创建）封面数据库；失败返回 null（永不 reject） */
function coverDbOpen() {
  return new Promise((resolve) => {
    if (!coverDbAvailable() || coverDbFailed) return resolve(null);
    if (coverDbInstance) return resolve(coverDbInstance);
    let req;
    try {
      req = indexedDB.open(COVER_DB_NAME, COVER_DB_VERSION);
    } catch (e) {
      coverDbFailed = true;
      return resolve(null);
    }
    if (!req || typeof req.addEventListener !== 'function') {
      coverDbFailed = true;
      return resolve(null);
    }
    req.addEventListener('upgradeneeded', () => {
      try {
        const db = req.result;
        if (!db.objectStoreNames.contains(COVER_STORE)) db.createObjectStore(COVER_STORE);
      } catch (e) { /* 忽略升级异常，后续写入自然失败并降级 */ }
    });
    req.addEventListener('success', () => {
      coverDbInstance = req.result;
      resolve(coverDbInstance);
    });
    req.addEventListener('error', () => { coverDbFailed = true; resolve(null); });
    req.addEventListener('blocked', () => { coverDbFailed = true; resolve(null); });
  });
}

/** 事务包装：把一次读写包进 Promise，出错/缺能力一律走 fail 值 */
function coverTx(mode, fn, fail) {
  return coverDbOpen().then((db) => {
    if (!db) return fail;
    return new Promise((resolve) => {
      let tx;
      try {
        tx = db.transaction(COVER_STORE, mode);
      } catch (e) {
        return resolve(fail);
      }
      let result = fail;
      try {
        const store = tx.objectStore(COVER_STORE);
        const req = fn(store);
        if (req && typeof req.addEventListener === 'function') {
          req.addEventListener('success', () => { if (req.result !== undefined) result = req.result; });
          req.addEventListener('error', () => { result = fail; });
        }
      } catch (e) {
        return resolve(fail);
      }
      tx.addEventListener('complete', () => resolve(result === undefined ? fail : result));
      tx.addEventListener('abort', () => resolve(fail));
      tx.addEventListener('error', () => resolve(fail));
    });
  }).catch(() => fail);
}

/** 保存封面（key + Blob/File）→ true / false */
function coverSave(key, blob) {
  if (!key || !blob) return Promise.resolve(false);
  if (!coverDbAvailable()) {
    coverMemStore.set(key, blob);
    return Promise.resolve(false);
  }
  return coverTx('readwrite', (store) => store.put(blob, key), false)
    .then((r) => r !== false);
}

/** 读取封面 → Blob / null（IDB 不可用时回落到内存 Map） */
function coverGet(key) {
  if (!key) return Promise.resolve(null);
  if (!coverDbAvailable()) return Promise.resolve(coverMemStore.get(key) || null);
  return coverTx('readonly', (store) => store.get(key), null);
}

/** 删除封面 → true / false */
function coverDelete(key) {
  if (!key) return Promise.resolve(false);
  if (!coverDbAvailable()) { coverMemStore.delete(key); return Promise.resolve(false); }
  // 同时释放可能存在的 objectURL，避免内存泄漏
  revokeCoverURL(key);
  return coverTx('readwrite', (store) => store.delete(key), false)
    .then((r) => r !== false);
}

/** 释放某个 key 的 objectURL 并从缓存移除 */
function revokeCoverURL(key) {
  const url = coverUrlCache.get(key);
  if (url && typeof URL !== 'undefined' && URL.revokeObjectURL) {
    try { URL.revokeObjectURL(url); } catch (e) { /* 忽略 */ }
  }
  coverUrlCache.delete(key);
}

/** 读取封面并生成可用的 objectURL → string / null（带缓存） */
function coverGetURL(key) {
  if (!key) return Promise.resolve(null);
  if (coverUrlCache.has(key)) return Promise.resolve(coverUrlCache.get(key));
  return coverGet(key).then((blob) => {
    if (!blob) return null;
    try {
      if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return null;
      const url = URL.createObjectURL(blob);
      coverUrlCache.set(key, url);
      return url;
    } catch (e) {
      return null;
    }
  }).catch(() => null);
}

/** 校验并保存用户选择的图片文件 → { ok, key, error } */
function saveCoverFile(file) {
  return new Promise((resolve) => {
    if (!file) return resolve({ ok: false, error: '未选择文件' });
    if (!/^image\//i.test(file.type || '')) {
      return resolve({ ok: false, error: '请选择图片文件（jpg / png / webp 等）' });
    }
    if (file.size && file.size > COVER_MAX_BYTES) {
      return resolve({ ok: false, error: '图片过大，请选择 5MB 以内的图片' });
    }
    const key = 'img_' + uid();
    // IDB 不可用时 coverSave 会写入内存 Map，同样返回 ok（本机可用）
    const store = coverDbAvailable() ? coverSave(key, file) : Promise.resolve(coverMemStore.set(key, file) && false);
    store.then(() => resolve({ ok: true, key, error: '' }));
  });
}

/** 异步回填本地封面：扫描 [data-cover-type="local"|"ai"][data-cover-key] 并设置 src */
function hydrateCovers(root) {
  if (!root) return;
  const token = (coverTokens.get(root) || 0) + 1;
  coverTokens.set(root, token);
  const nodes = root.querySelectorAll('[data-cover-type="local"][data-cover-key], [data-cover-type="ai"][data-cover-key]');
  Array.prototype.forEach.call(nodes, (img) => {
    const key = img.getAttribute('data-cover-key');
    if (!key) return;
    const apply = (url) => {
      if (coverTokens.get(root) !== token) return;  // 仅同一 root 的新一轮渲染才丢弃
      if (!url) { img.classList.add('cover-failed'); return; }
      img.src = url;
      img.setAttribute('data-loaded', '1');
    };
    if (coverUrlCache.has(key)) { apply(coverUrlCache.get(key)); return; }
    coverGetURL(key).then(apply).catch(() => apply(null));
  });
}

/* =========================================================================
   观影 —— 渲染层
   ========================================================================= */

/** 状态徽标（右上角） */
function showBadgeHtml(show) {
  const m = SHOW_STATUS_META[show.status] || SHOW_STATUS_META.want;
  return `<span class="poster-badge ${m.cls}">${icon(m.icon)}${m.label}</span>`;
}

/** 封面占位（无封面 / 加载中） */
function coverPlaceholder() {
  return `<span class="cover-ph">${icon('clapperboard')}</span>`;
}

/** 封面元素：外部 URL 直接给 src；本地 / AI 只带 data 属性由 hydrateCovers 异步回填 */
function coverImgHtml(show) {
  const alt = escapeHtml(show.title);
  if (show.coverType === 'url' && show.coverUrl) {
    // 外链海报（如 TVmaze）加载失败时降级为占位图，避免裂图
    return `<img class="cover-img" src="${escapeHtml(show.coverUrl)}" alt="${alt}" loading="lazy"
      data-loaded="1" onerror="this.classList.add('cover-failed')" />`;
  }
  if ((show.coverType === 'local' || show.coverType === 'ai') && show.coverKey) {
    return `<img class="cover-img" alt="${alt}" loading="lazy"
      data-cover-type="${show.coverType}" data-cover-key="${escapeHtml(show.coverKey)}" />`;
  }
  return coverPlaceholder();
}

/** 进度条（总集数未知则不画） */
function showProgressBarHtml(show) {
  const pct = showProgressPercent(show);
  if (pct == null) return '';
  return `<div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>`;
}

/** 单张海报卡 */
function showCardHtml(show) {
  const warn = progressWarn(show);
  const sub = [show.year, show.genre].filter(Boolean).map(escapeHtml).join(' · ');
  const showProgress = show.status === 'watching' || show.status === 'paused';
  return `
    <article class="poster-card" data-id="${escapeHtml(show.id)}" role="button" tabindex="0">
      <div class="poster-media">
        ${coverImgHtml(show)}
        ${showBadgeHtml(show)}
      </div>
      <div class="poster-body">
        <h3 class="poster-title" title="${escapeHtml(show.title)}">${escapeHtml(show.title)}</h3>
        <div class="poster-sub">${sub || '&nbsp;'}</div>
        ${showProgress ? `
          ${showProgressBarHtml(show)}
          <div class="progress-text">${icon('clock')}${escapeHtml(showProgressText(show))}</div>
        ` : ''}
        ${warn ? `<div class="progress-warn">${icon('alert-triangle')}${escapeHtml(warn)}</div>` : ''}
        <div class="poster-acts">
          ${show.status === 'watching' ? `
            <button class="btn-mini" data-act="continue" data-id="${escapeHtml(show.id)}" title="看下一集">
              ${icon('play')}下一集
            </button>` : ''}
          <button class="btn-mini" data-act="edit" data-id="${escapeHtml(show.id)}" title="编辑">${icon('pencil')}</button>
        </div>
      </div>
    </article>`;
}

/** 单个区块（标题 + 网格 + 展开/收起） */
function showSectionHtml(key, list, iconName, title) {
  if (!list.length) return '';
  const expanded = !!state.showExpanded[key];
  const limit = state.showSectionLimit;
  const visible = expanded ? list : list.slice(0, limit);
  const needToggle = list.length > limit;
  return `
    <section class="shows-section" data-section="${key}">
      <div class="shows-section-head">
        <h2>${icon(iconName)}${escapeHtml(title)}<span class="sec-count">${list.length}</span></h2>
        ${needToggle ? `<button class="link-all" data-act="${expanded ? 'collapse' : 'view-all'}" data-section="${key}">
          ${expanded ? '收起' : `查看全部 ${list.length}`}${icon(expanded ? 'chevron-up' : 'chevron-right')}
        </button>` : ''}
      </div>
      <div class="poster-grid">${visible.map(showCardHtml).join('')}</div>
    </section>`;
}

/** 统计概览 */
function renderShowsStats() {
  const el = $('#showsStats');
  if (!el) return;
  const all = Store.getShows();
  const count = (st) => all.filter((s) => s.status === st).length;
  const items = [
    { st: 'watching', label: '在看' },
    { st: 'want', label: '想看' },
    { st: 'watched', label: '已看完' },
    { st: 'paused', label: '暂停' },
  ];
  el.innerHTML = items.map((it) => `
    <div class="show-stat">
      <div class="show-stat-num">${count(it.st)}</div>
      <div class="show-stat-label">${icon(SHOW_STATUS_META[it.st].icon)}${it.label}</div>
    </div>`).join('');
}

/** 筛选标签（含各状态数量） */
function renderShowsFilters() {
  const el = $('#showsFilters');
  if (!el) return;
  const all = Store.getShows();
  const tabs = [{ st: 'all', label: '全部', n: all.length }].concat(
    SHOW_STATUSES.map((st) => ({ st, label: SHOW_STATUS_META[st].label, n: all.filter((s) => s.status === st).length }))
  );
  el.innerHTML = tabs.map((t) => `
    <button class="chip${state.showStatus === t.st ? ' active' : ''}" data-status="${t.st}">
      ${escapeHtml(t.label)}<b>${t.n}</b>
    </button>`).join('');
}

/** 空态 */
function renderEmptyShows() {
  return `
    <div class="empty">
      <span class="empty-icon">${icon('clapperboard')}</span>
      <span class="empty-title">还没有任何剧集</span>
      <span class="empty-desc">点击右上角「添加剧集」，粘贴海报链接开始收藏</span>
    </div>`;
}

/** 观影页总渲染入口 */
function renderShows() {
  const box = $('#showsSections');
  if (!box) return;

  // 概览与筛选始终刷新
  renderShowsStats();
  renderShowsFilters();

  // 同步排序下拉的当前值（切页回来保持一致）
  const sortSel = $('#showSortSel');
  if (sortSel && sortSel.value !== state.showSort) sortSel.value = state.showSort;
  const searchEl = $('#showSearch');
  if (searchEl && searchEl.value !== state.showQuery) searchEl.value = state.showQuery;

  const all = Store.getShows();
  if (!all.length) {
    box.innerHTML = renderEmptyShows();
    hydrateCovers(box);
    return;
  }

  const filtered = sortShows(filterShows(all, state.showStatus, state.showQuery), state.showSort);
  if (!filtered.length) {
    box.innerHTML = `
      <div class="empty">
        <span class="empty-icon">${icon('search-x')}</span>
        <span class="empty-title">没有匹配的剧集</span>
        <span class="empty-desc">换个关键词或切换筛选条件试试</span>
      </div>`;
    hydrateCovers(box);
    return;
  }

  // 处于「全部」且无搜索时按状态分区；否则平铺一个结果区块
  const isBrowseAll = state.showStatus === 'all' && !state.showQuery.trim();
  let html = '';
  if (isBrowseAll) {
    const g = groupShows(all);
    html += showSectionHtml('continue', g.continue, 'play-circle', '继续观看');
    html += showSectionHtml('watching', g.watching, 'tv', '在看');
    html += showSectionHtml('want', g.want, 'bookmark', '想看清单');
    html += showSectionHtml('paused', g.paused, 'pause-circle', '暂停');
    html += showSectionHtml('watched', g.watched, 'check-circle-2', '已看完');
  } else {
    html += `<section class="shows-section">
      <div class="shows-section-head"><h2>${icon('list')}筛选结果<span class="sec-count">${filtered.length}</span></h2></div>
      <div class="poster-grid">${filtered.map(showCardHtml).join('')}</div>
    </section>`;
  }
  box.innerHTML = html || renderEmptyShows();
  hydrateCovers(box);
}

/* =========================================================================
   观影 —— 封面选择器（URL / 本地 / AI 预留）
   ========================================================================= */
let coverPickerState = { type: 'none', url: '', key: '', previewUrl: '' };

/** 构建封面选择器（返回 HTML；事件在 openModal 后由 bindCoverPicker 绑定） */
function coverPickerHtml(cur) {
  const type = cur && cur.coverType ? cur.coverType : 'none';
  const url = (cur && cur.coverUrl) || '';
  const key = (cur && cur.coverKey) || '';
  const noCoverActive = type === 'none';
  const urlActive = type === 'url';
  const localActive = type === 'local' || type === 'ai';
  return `
    <div class="cover-picker" id="coverPicker">
      <div class="field-label">封面</div>
      <div class="cover-tabs">
        <button type="button" class="cover-tab${noCoverActive ? ' active' : ''}" data-cover-tab="none">无封面</button>
        <button type="button" class="cover-tab${urlActive ? ' active' : ''}" data-cover-tab="url">图片链接</button>
        <button type="button" class="cover-tab${localActive ? ' active' : ''}" data-cover-tab="local">本地上传</button>
        <button type="button" class="cover-tab" data-cover-tab="ai">AI 生成</button>
      </div>

      <div class="cover-pane" data-cover-pane="none"${noCoverActive ? '' : ' hidden'}>
        <p class="cover-hint">不使用封面，卡片显示渐变占位图。</p>
      </div>

      <div class="cover-pane" data-cover-pane="url"${urlActive ? '' : ' hidden'}>
        <input class="input" id="coverUrlInput" type="url" placeholder="粘贴海报图片链接（https://...）"
               value="${escapeHtml(url)}" />
        <p class="cover-hint">右键网图 → 复制图片地址，粘贴到这里即可。</p>
        <div class="cover-preview" id="coverUrlPreview"></div>
      </div>

      <div class="cover-pane" data-cover-pane="local"${localActive ? '' : ' hidden'}>
        <label class="cover-drop" for="coverFileInput">
          ${icon('upload')}选择本地图片
        </label>
        <input type="file" id="coverFileInput" accept="image/*" hidden />
        <p class="cover-hint">支持 jpg / png / webp，5MB 以内。图片保存在本机（不上传云端）。</p>
        <div class="cover-preview" id="coverLocalPreview"></div>
      </div>

      <div class="cover-pane cover-ai-pane" data-cover-pane="ai" hidden>
        <p class="cover-hint">
          ${icon('sparkles')}AI 生成封面为预留能力，当前尚未接入生成服务。
        </p>
        <p class="cover-hint muted">你可以自行生成好图片后，切到「本地上传」选择该文件即可。</p>
        <button type="button" class="btn btn-ghost" disabled>生成封面（待配置）</button>
      </div>
    </div>`;
}

/** 绑定封面选择器事件；同步到模块级 coverPickerState */
function bindCoverPicker() {
  const picker = $('#coverPicker');
  if (!picker) return;
  picker.querySelectorAll('.cover-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const t = tab.dataset.coverTab;
      if (t === 'ai') {
        // AI 为预留：仅切换说明面板，不真正生成
        picker.querySelectorAll('.cover-pane').forEach((p) => { p.hidden = p.dataset.coverPane !== 'ai'; });
        picker.querySelectorAll('.cover-tab').forEach((x) => x.classList.toggle('active', x === tab));
        return;
      }
      picker.querySelectorAll('.cover-pane').forEach((p) => { p.hidden = p.dataset.coverPane !== t; });
      picker.querySelectorAll('.cover-tab').forEach((x) => x.classList.toggle('active', x === tab));
    });
  });

  const urlInput = $('#coverUrlInput');
  const urlPreview = $('#coverUrlPreview');
  const renderUrlPreview = () => {
    const u = safeCoverUrl(urlInput.value);
    urlPreview.innerHTML = u ? `<img src="${escapeHtml(u)}" alt="封面预览" />` : '';
  };
  if (urlInput) {
    urlInput.addEventListener('input', renderUrlPreview);
    renderUrlPreview();
  }

  const fileInput = $('#coverFileInput');
  const localPreview = $('#coverLocalPreview');
  if (fileInput) {
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      const r = await saveCoverFile(file);
      if (!r.ok) { toast(r.error, 'err'); fileInput.value = ''; return; }
      coverPickerState.key = r.key;
      coverPickerState.type = 'local';
      const m = picker.querySelector('[data-cover-tab="local"]');
      if (m) {
        picker.querySelectorAll('.cover-pane').forEach((p) => { p.hidden = p.dataset.coverPane !== 'local'; });
        picker.querySelectorAll('.cover-tab').forEach((x) => x.classList.toggle('active', x === m));
      }
      const url = await coverGetURL(r.key);
      localPreview.innerHTML = url
        ? `<img src="${escapeHtml(url)}" alt="封面预览" />`
        : `<span class="cover-hint muted">${icon('check')}图片已保存到本机（当前环境无法预览）</span>`;
      toast('封面已选择');
    });
  }
}

/**
 * 把「已有的」本地封面回显到 #coverLocalPreview（编辑弹窗打开时用）。
 * 异步读取，不阻塞弹窗打开；命中缓存则同步渲染避免闪烁。
 */
function hydrateCoverPicker() {
  const preview = document.getElementById('coverLocalPreview');
  if (!preview) return;
  const key = coverPickerState.key;
  if (!key) { preview.innerHTML = ''; return; }
  // 命中缓存：同步渲染，避免先空一帧再出图
  if (coverUrlCache.has(key)) {
    preview.innerHTML = `<img src="${escapeHtml(coverUrlCache.get(key))}" alt="封面预览" />`;
    return;
  }
  coverGetURL(key).then((url) => {
    // 弹窗可能已被关闭 / 被新一轮 openModal 替换，节点脱离文档就丢弃
    if (!preview.isConnected) return;
    preview.innerHTML = url
      ? `<img src="${escapeHtml(url)}" alt="封面预览" />`
      : `<span class="cover-hint muted">${icon('check')}封面已保存在本机（当前环境无法预览）</span>`;
  }).catch(() => {
    if (preview.isConnected) {
      preview.innerHTML = `<span class="cover-hint muted">${icon('check')}封面已保存在本机</span>`;
    }
  });
}

/** 从弹窗 DOM 读取封面选择结果 */
function readCoverPicker(scope) {
  const root = scope || document;
  const picker = root.querySelector ? root.querySelector('#coverPicker') : null;
  if (!picker) return { coverType: 'none', coverUrl: '', coverKey: '' };
  const activeTab = picker.querySelector('.cover-tab.active');
  const tab = activeTab ? activeTab.dataset.coverTab : 'none';
  if (tab === 'url') {
    const u = safeCoverUrl((root.querySelector('#coverUrlInput') || {}).value);
    if (u) return { coverType: 'url', coverUrl: u, coverKey: '' };
    return { coverType: 'none', coverUrl: '', coverKey: '' };
  }
  if (tab === 'local' || tab === 'ai') {
    if (coverPickerState.key) return { coverType: tab === 'ai' ? 'ai' : 'local', coverUrl: '', coverKey: coverPickerState.key };
    return { coverType: 'none', coverUrl: '', coverKey: '' };
  }
  if (tab === 'ai') return { coverType: 'none', coverUrl: '', coverKey: '' };
  return { coverType: 'none', coverUrl: '', coverKey: '' };
}

/* =========================================================================
   观影 —— TVmaze 搜索（自动填充剧集信息）
   ---------------------------------------------------------------------
   设计：搜索结果只「填空」，绝不覆盖用户已写内容；
   TVmaze 不可用时给出明确提示，且完全不影响手动填写。
   ========================================================================= */

/** 搜索结果缓存：showId -> 剧集对象（供选季时取回名称等） */
let showCache = {};
/** 最近一次搜索结果（供结果区点击时取回剧集对象） */
let lastSearchResult = [];

/** 搜索区骨架（嵌在剧集表单顶部） */
function showSearchBlockHtml() {
  return `
    <div class="show-search-block" id="showSearchBlock">
      <label class="field-label">${icon('search')}从 TVmaze 搜索 <span class="opt">选填</span></label>
      <div class="show-search-row">
        <input class="input" id="tvmazeQuery" type="text" maxlength="80"
               placeholder="输入剧名，如 进击的巨人" />
        <button type="button" class="btn btn-ghost" id="tvmazeSearchBtn">搜索</button>
      </div>
      <p class="cover-hint">搜索后选择「第几季」，会自动填入标题、年份、评分、简介与该季海报。只填空项，不会覆盖你已填写的内容。</p>
      <div class="tvmaze-results" id="tvmazeResults"></div>
      <div class="tvmaze-seasons" id="tvmazeSeasons" hidden></div>
      <p class="tvmaze-status" id="tvmazeStatus" hidden></p>
    </div>`;
}

/** 设置搜索状态行（loading / error / 提示） */
function setTvmazeStatus(msg, kind) {
  const el = document.getElementById('tvmazeStatus');
  if (!el) return;
  if (!msg) { el.hidden = true; el.textContent = ''; el.className = 'tvmaze-status'; return; }
  el.hidden = false;
  el.textContent = msg;
  el.className = 'tvmaze-status' + (kind ? ' is-' + kind : '');
}

/** 渲染搜索结果（剧集列表，点击进入季选择） */
function renderTvmazeShows(list) {
  const box = document.getElementById('tvmazeResults');
  const seasonBox = document.getElementById('tvmazeSeasons');
  if (!box) return;
  if (seasonBox) { seasonBox.hidden = true; seasonBox.innerHTML = ''; }
  if (!list || !list.length) {
    box.innerHTML = '';
    setTvmazeStatus('没有找到匹配的剧集，换个关键词或直接手动填写。', 'error');
    return;
  }
  setTvmazeStatus(`找到 ${list.length} 条结果，点选一部剧：`, '');
  box.innerHTML = list.map((s) => `
    <div class="tvmaze-result" data-show-id="${escapeHtml(s.id)}" title="${escapeHtml(s.name)}">
      ${s.image
        ? `<img src="${escapeHtml(s.image)}" alt="${escapeHtml(s.name)}" loading="lazy" />`
        : `<div class="tvmaze-noimg">${icon('film')}</div>`}
      <div class="tvmaze-result-name">${escapeHtml(s.name)}</div>
      <div class="tvmaze-result-meta">${s.year != null ? s.year : ''}${s.rating != null ? ' · ★' + s.rating : ''}</div>
    </div>`).join('');
}

/** 渲染某剧的季列表（点选后填充表单） */
function renderTvmazeSeasons(list, show) {
  const box = document.getElementById('tvmazeSeasons');
  if (!box) return;
  if (!list || !list.length) {
    box.hidden = true;
    setTvmazeStatus('这部剧没有可用的季信息，请手动填写。', 'error');
    return;
  }
  box.hidden = false;
  const name = (show && (show.cnName || show.name)) || '所选剧集';
  setTvmazeStatus(`《${name}》共 ${list.length} 季，点选你要添加的那一季：`, '');
  box.innerHTML = list.map((s) => `
    <button type="button" class="tvmaze-season" data-season-number="${s.number}">
      ${s.image ? `<img src="${escapeHtml(s.image)}" alt="${escapeHtml(s.label)}" loading="lazy" />` : ''}
      <span class="tvmaze-season-label">${escapeHtml(show && show.cnName ? seasonalLabel(s.number) : s.label)}</span>
      <span class="tvmaze-season-ep">${escapeHtml(s.epText)}</span>
    </button>`).join('');
}

/** 只有季号时组一个中文标签（用于已取到中文名的场合） */
function seasonalLabel(num) {
  const n = normOptPositiveInt(num);
  return n == null ? '' : `第 ${n} 季`;
}

/** 内部：搜索框取词并查询剧集 */
function doTvmazeSearch() {
  const input = document.getElementById('tvmazeQuery');
  const q = input ? input.value.trim() : '';
  if (!q) { toast('请输入剧名', 'err'); if (input) input.focus(); return; }
  setTvmazeStatus('搜索中…', 'loading');
  const box = document.getElementById('tvmazeResults');
  const seasonBox = document.getElementById('tvmazeSeasons');
  if (box) box.innerHTML = '';
  if (seasonBox) { seasonBox.hidden = true; seasonBox.innerHTML = ''; }
  tvmazeSearchShows(q).then((list) => {
    if (!document.getElementById('tvmazeResults')) return;  // 弹窗已关闭
    lastSearchResult = list;
    showCache = {};
    list.forEach((s) => { showCache[s.id] = s; });
    renderTvmazeShows(list);
  }).catch(() => {
    setTvmazeStatus('TVmaze 暂时不可用，请手动填写。', 'error');
  });
}

/** 内部：选中某剧 → 先取中文名，再拉取其季列表 */
function pickTvmazeShow(showId) {
  const box = document.getElementById('tvmazeResults');
  if (!box) return;
  const all = Array.prototype.slice.call(box.querySelectorAll('.tvmaze-result'));
  all.forEach((n) => { n.classList.toggle('active', n.dataset.showId === String(showId)); });
  setTvmazeStatus('正在获取季列表…', 'loading');
  const show = showCache[String(showId)] || {};
  // 并行：季列表 + 中文别名。中文名查不到时返回 ''，不打断流程
  Promise.all([tvmazeGetSeasons(showId), tvmazeGetChineseTitle(showId)]).then((res) => {
    if (!document.getElementById('tvmazeResults')) return;  // 弹窗已关闭
    const seasons = res[0] || [];
    const cnName = res[1] || '';
    const merged = Object.assign({}, show, { cnName: cnName });
    showCache[String(showId)] = merged;   // 记回缓存，选季时直接取用
    renderTvmazeSeasons(seasons, merged);
    // 没有中文名 → 用状态行提示（toast 只有 err 一种告警态，这里不改 toast 语义）
    if (!cnName) {
      setTvmazeStatus(`《${show.name || '所选剧集'}》暂无中文译名，标题会先用英文原名，可手动改。点选你要添加的那一季：`, '');
    }
  }).catch(() => {
    setTvmazeStatus('获取季列表失败，请手动填写。', 'error');
  });
}

/** 内部：选中某季 → 按「只填空」写入表单 */
function pickTvmazeSeason(showId, seasonNumber) {
  const show = showCache[String(showId)];
  if (!show) { setTvmazeStatus('剧集信息已失效，请重新搜索。', 'error'); return; }
  const num = normOptPositiveInt(seasonNumber);
  if (num == null) return;
  tvmazeGetSeasons(showId).then((seasons) => {
    const season = seasons.filter((s) => s.number === num)[0];
    if (!season) { setTvmazeStatus('未找到该季信息。', 'error'); return; }
    const fields = tvmazeSeasonToFields(show, season, show.cnName || '');
    const filled = applyTvmazeFields(fields, coverPickerState);
    // 封面若被写入，同步界面到「图片链接」页签
    if (filled.indexOf('封面') > -1) syncCoverPickerToState();
    toast(filled.length
      ? `已填入：${filled.join('、')}`
      : '表单已有内容，未作改动（搜索只填空项）');
    setTvmazeStatus(filled.length ? '已填入所选季的信息。' : '表单已填写完整，无需补充。', '');
  }).catch(() => {
    setTvmazeStatus('获取季信息失败，请手动填写。', 'error');
  });
}

/** 绑定搜索区事件（在弹窗打开后调用） */
function bindShowSearch() {
  showCache = {};
  setTvmazeStatus('');
  const btn = document.getElementById('tvmazeSearchBtn');
  const input = document.getElementById('tvmazeQuery');
  const results = document.getElementById('tvmazeResults');
  const seasons = document.getElementById('tvmazeSeasons');
  if (btn) btn.addEventListener('click', doTvmazeSearch);
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); doTvmazeSearch(); }
    });
  }
  // 结果区先记下剧集数据，供选季时使用
  if (results) {
    results.addEventListener('click', (e) => {
      const node = e.target && e.target.closest ? e.target.closest('.tvmaze-result') : null;
      if (!node) return;
      pickTvmazeShow(node.dataset.showId);
    });
  }
  if (seasons) {
    seasons.addEventListener('click', (e) => {
      const node = e.target && e.target.closest ? e.target.closest('.tvmaze-season') : null;
      if (!node) return;
      const activeShow = document.querySelector('#tvmazeResults .tvmaze-result.active');
      if (!activeShow) return;
      pickTvmazeSeason(activeShow.dataset.showId, node.dataset.seasonNumber);
    });
  }
}

/** 把「图片链接」封面同步到界面（applyTvmazeFields 改了状态后调用） */
function syncCoverPickerToState() {
  const picker = document.getElementById('coverPicker');
  if (!picker) return;
  if (coverPickerState.type !== 'url') return;
  const tab = picker.querySelector('[data-cover-tab="url"]');
  if (tab) {
    picker.querySelectorAll('.cover-pane').forEach((p) => { p.hidden = p.dataset.coverPane !== 'url'; });
    picker.querySelectorAll('.cover-tab').forEach((x) => x.classList.toggle('active', x === tab));
  }
  const urlInput = document.getElementById('coverUrlInput');
  if (urlInput && !urlInput.value) {
    urlInput.value = coverPickerState.url || '';
    urlInput.dispatchEvent(new Event('input'));
  }
}

/* =========================================================================
   观影 —— 表单弹窗
   ========================================================================= */
function showFormHtml(s) {
  const v = s || {};
  const status = v.status || 'want';
  const statusSegs = SHOW_STATUSES.map((st) =>
    `<button type="button" class="seg${st === status ? ' active' : ''}" data-status="${st}">
      ${icon(SHOW_STATUS_META[st].icon)}${SHOW_STATUS_META[st].label}</button>`).join('');
  return `
    <h3>${icon('clapperboard')}${v.id ? '编辑剧集' : '添加剧集'}</h3>
    <div class="show-form">
      ${showSearchBlockHtml()}
      <div class="form-row">
        <div class="form-field">
          <label class="field-label">标题 <em>*</em></label>
          <input class="input" id="showTitle" type="text" maxlength="120"
                 placeholder="例如：进击的巨人" value="${escapeHtml(v.title || '')}" />
        </div>
      </div>
      <div class="form-row">
        <div class="form-field">
          <label class="field-label">原文标题</label>
          <input class="input" id="showOriginalTitle" type="text" maxlength="120"
                 placeholder="选填，例如：Shingeki no Kyojin" value="${escapeHtml(v.originalTitle || '')}" />
        </div>
        <div class="form-field">
          <label class="field-label">年份</label>
          <input class="input" id="showYear" type="number" min="1900" max="2100"
                 placeholder="例如：2013" value="${v.year != null ? v.year : ''}" />
        </div>
      </div>
      <div class="form-row">
        <div class="form-field">
          <label class="field-label">类型 / 题材</label>
          <input class="input" id="showGenre" type="text" maxlength="60"
                 placeholder="例如：动画 / 悬疑" value="${escapeHtml(v.genre || '')}" />
        </div>
        <div class="form-field">
          <label class="field-label">评分（0–10）</label>
          <input class="input" id="showRating" type="number" min="0" max="10" step="0.1"
                 placeholder="选填" value="${v.rating != null ? v.rating : ''}" />
        </div>
      </div>
      <div class="form-row">
        <div class="form-field">
          <label class="field-label">状态</label>
          <div class="segs segs-status" id="showStatusSegs">${statusSegs}</div>
        </div>
      </div>
      <div class="form-row">
        <div class="form-field">
          <label class="field-label">第几集</label>
          <input class="input" id="showEpisode" type="number" min="1" step="1" value="${v.episode || 1}" />
        </div>
        <div class="form-field">
          <label class="field-label">本季总集数</label>
          <input class="input" id="showSeasonEpisodes" type="number" min="1" step="1"
                 placeholder="未知留空" value="${v.currentSeasonEpisodes != null ? v.currentSeasonEpisodes : ''}" />
        </div>
      </div>
      <div class="form-field">
        <label class="field-label">简介</label>
        <textarea class="input" id="showSummary" rows="3" maxlength="2000"
                  placeholder="选填">${escapeHtml(v.summary || '')}</textarea>
      </div>
      <div class="form-field">
        <label class="field-label">观后感 / 备注</label>
        <textarea class="input" id="showNote" rows="2" maxlength="2000"
                  placeholder="选填">${escapeHtml(v.note || '')}</textarea>
      </div>
      ${coverPickerHtml(v)}
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="modalCancel">取消</button>
      <button class="btn btn-primary" id="modalOk">${v.id ? '保存' : '添加'}</button>
    </div>`;
}

/** 从表单读取数据（不校验业务规则，交给调用方） */
function readShowForm() {
  const g = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };
  const activeStatus = document.querySelector('#showStatusSegs .seg.active');
  const cover = readCoverPicker(document);
  return {
    title: g('showTitle').trim(),
    originalTitle: g('showOriginalTitle').trim(),
    year: g('showYear'),
    genre: g('showGenre').trim(),
    status: activeStatus ? activeStatus.dataset.status : 'want',
    episode: g('showEpisode'),
    currentSeasonEpisodes: g('showSeasonEpisodes'),
    summary: g('showSummary').trim(),
    note: g('showNote').trim(),
    rating: g('showRating'),
    coverType: cover.coverType,
    coverUrl: cover.coverUrl,
    coverKey: cover.coverKey,
  };
}

/** 绑定状态分段控件 */
function bindStatusSegs() {
  const wrap = $('#showStatusSegs');
  if (!wrap) return;
  wrap.querySelectorAll('.seg').forEach((b) => {
    b.addEventListener('click', () => {
      wrap.querySelectorAll('.seg').forEach((x) => x.classList.toggle('active', x === b));
    });
  });
}

function openAddShowModal() {
  coverPickerState = { type: 'none', url: '', key: '', previewUrl: '' };
  openModal(showFormHtml(null));
  bindStatusSegs();
  bindCoverPicker();
  bindShowSearch();
  const t = $('#showTitle');
  if (t) t.focus();
  $('#modalCancel').addEventListener('click', closeModal);
  $('#modalOk').addEventListener('click', () => {
    const f = readShowForm();
    if (!f.title) { toast('请填写标题', 'err'); $('#showTitle').focus(); return; }
    const created = Store.addShow(f);
    if (!created) { toast('添加失败：标题无效', 'err'); return; }
    closeModal();
    toast('已添加《' + created.title + '》');
    renderShows();
  });
}

function openEditShowModal(id) {
  const s = Store.getShow(id);
  if (!s) return;
  coverPickerState = { type: s.coverType, url: s.coverUrl, key: s.coverKey, previewUrl: '' };
  openModal(showFormHtml(s));
  bindStatusSegs();
  bindCoverPicker();
  bindShowSearch();
  hydrateCoverPicker();   // 回显已有本地封面（否则编辑时本地面板一片空白）
  $('#modalCancel').addEventListener('click', closeModal);
  $('#modalOk').addEventListener('click', () => {
    const f = readShowForm();
    if (!f.title) { toast('请填写标题', 'err'); $('#showTitle').focus(); return; }
    // 封面若被替换为新的本地图，旧图异步清理
    const oldKey = s.coverKey;
    Store.updateShow(id, {
      title: f.title, originalTitle: f.originalTitle, year: f.year, genre: f.genre,
      status: f.status, episode: f.episode,
      currentSeasonEpisodes: f.currentSeasonEpisodes,
      summary: f.summary, note: f.note, rating: f.rating,
      coverType: f.coverType, coverUrl: f.coverUrl, coverKey: f.coverKey,
      lastWatchedAt: s.lastWatchedAt, finishedAt: s.finishedAt,
    });
    if (oldKey && oldKey !== f.coverKey) coverDelete(oldKey);
    closeModal();
    toast('已保存');
    renderShows();
  });
}

/* --- 进度调整弹窗 --- */
function openProgressModal(id) {
  const s = Store.getShow(id);
  if (!s) return;
  openModal(`
    <h3>${icon('sliders-horizontal')}调整观看进度</h3>
    <p>《${escapeHtml(s.title)}》当前：${escapeHtml(showProgressText(s))}</p>
    <div class="form-row">
      <div class="form-field">
        <label class="field-label">第几集</label>
        <input class="input" id="progressEpisodeInput" type="number" min="1" step="1" value="${s.episode}" />
      </div>
    </div>
    <div class="form-field">
      <label class="field-label">备注（选填）</label>
      <input class="input" id="progressNoteInput" type="text" maxlength="200" placeholder="例如：这集很精彩" />
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="modalCancel">取消</button>
      <button class="btn btn-primary" id="modalOk">保存进度</button>
    </div>
  `);
  const ei = $('#progressEpisodeInput');
  if (ei) ei.focus();
  $('#modalCancel').addEventListener('click', closeModal);
  $('#modalOk').addEventListener('click', () => {
    const check = validateEpisode(ei.value, s.currentSeasonEpisodes);
    if (!check.ok) { toast(check.error, 'err'); return; }
    const noteEl = $('#progressNoteInput');
    Store.updateProgress(id, check.episode, { note: noteEl ? noteEl.value.trim() : '' });
    closeModal();
    toast(`进度更新为 第 ${check.episode} 集`);
    renderShows();
  });
}

/* --- 标记已看完 --- */
function openFinishModal(id) {
  const s = Store.getShow(id);
  if (!s) return;
  openModal(`
    <h3>${icon('check-circle-2')}标记为已看完</h3>
    <p>将《${escapeHtml(s.title)}》记为已看完，资料与进度都会保留，之后仍可改回「在看」。</p>
    <div class="form-row">
      <div class="form-field">
        <label class="field-label">完成日期</label>
        <input class="input" id="showFinishDate" type="date" value="${todayStr()}" />
      </div>
      <div class="form-field">
        <label class="field-label">评分（0–10，选填）</label>
        <input class="input" id="showFinishRating" type="number" min="0" max="10" step="0.1"
               value="${s.rating != null ? s.rating : ''}" />
      </div>
    </div>
    <div class="form-field">
      <label class="field-label">观后感（选填）</label>
      <textarea class="input" id="showFinishNote" rows="3" maxlength="2000"
                placeholder="看完想说点什么">${escapeHtml(s.note || '')}</textarea>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="modalCancel">取消</button>
      <button class="btn btn-primary" id="modalOk">确认已看完</button>
    </div>
  `);
  $('#modalCancel').addEventListener('click', closeModal);
  $('#modalOk').addEventListener('click', () => {
    const d = $('#showFinishDate').value;
    const r = $('#showFinishRating').value;
    const n = $('#showFinishNote').value.trim();
    Store.finishShow(id, { date: d, rating: r, note: n });
    closeModal();
    toast('已标记为看完 🎉');
    renderShows();
  });
}

/* --- 删除确认 --- */
function openDeleteShowModal(id) {
  const s = Store.getShow(id);
  if (!s) return;
  openModal(`
    <h3>${icon('trash-2')}删除剧集</h3>
    <p>将删除《${escapeHtml(s.title)}》及其全部观看记录，此操作不可撤销。</p>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="modalCancel">取消</button>
      <button class="btn btn-danger-soft" id="modalOk">确认删除</button>
    </div>
  `);
  $('#modalCancel').addEventListener('click', closeModal);
  $('#modalOk').addEventListener('click', () => {
    Store.removeShow(id);
    closeModal();
    toast('已删除');
    renderShows();
  });
}

/* --- 详情弹窗 --- */
function openShowDetail(id) {
  const s = Store.getShow(id);
  if (!s) return;
  const m = SHOW_STATUS_META[s.status] || SHOW_STATUS_META.want;
  const meta = [
    s.year ? ['上映年份', String(s.year)] : null,
    s.genre ? ['类型', s.genre] : null,
    s.currentSeasonEpisodes != null ? ['本季集数', String(s.currentSeasonEpisodes)] : null,
    s.rating != null ? ['评分', String(s.rating)] : null,
    s.finishedAt ? ['看完于', s.finishedAt] : null,
  ].filter(Boolean).map(([k, val]) => `
    <div class="detail-meta-item"><span>${escapeHtml(k)}</span><b>${escapeHtml(val)}</b></div>`).join('');

  const logs = Store.getWatchLogs(id, 10);
  const logHtml = logs.length ? `
    <div class="watchlog">
      <h4>${icon('history')}观看记录</h4>
      <ul class="watchlog-list">
        ${logs.map((l) => {
          const when = new Date(l.at);
          const ts = `${when.getFullYear()}/${pad2(when.getMonth() + 1)}/${pad2(when.getDate())} ${pad2(when.getHours())}:${pad2(when.getMinutes())}`;
          let desc = l.note;
          if (!desc) {
            if (l.kind === 'progress') desc = `第 ${l.episode} 集`;
            else if (l.kind === 'finish') desc = '标记为已看完';
            else desc = '状态变更';
          }
          return `<li><span class="log-time">${ts}</span><span class="log-desc">${escapeHtml(desc)}</span></li>`;
        }).join('')}
      </ul>
    </div>` : '';

  const progressNote = showProgressWarnText(s);
  openModal(`
    <div class="show-detail">
      <div class="detail-top">
        <div class="detail-poster">
          ${coverImgHtml(s)}
        </div>
        <div class="detail-info">
          <h3>${escapeHtml(s.title)}</h3>
          ${s.originalTitle ? `<div class="detail-original">${escapeHtml(s.originalTitle)}</div>` : ''}
          <div class="detail-badge"><span class="poster-badge ${m.cls}">${icon(m.icon)}${m.label}</span></div>
          <div class="detail-progress">${icon('clock')}${escapeHtml(showProgressText(s))}</div>
          ${progressNote ? `<div class="progress-warn">${icon('alert-triangle')}${escapeHtml(progressNote)}</div>` : ''}
        </div>
      </div>
      ${meta ? `<div class="detail-meta">${meta}</div>` : ''}
      ${s.summary ? `<div class="detail-desc"><h4>简介</h4><p>${escapeHtml(s.summary)}</p></div>` : ''}
      ${s.note ? `<div class="detail-desc"><h4>观后感</h4><p>${escapeHtml(s.note)}</p></div>` : ''}
      ${logHtml}
      <div class="detail-acts">
        <button class="btn btn-ghost" data-act="prev" data-id="${escapeHtml(id)}">${icon('minus')}上一集</button>
        <button class="btn btn-primary" data-act="continue" data-id="${escapeHtml(id)}">${icon('play')}看下一集</button>
        <button class="btn btn-ghost" data-act="progress" data-id="${escapeHtml(id)}">${icon('sliders-horizontal')}改进度</button>
        <button class="btn btn-ghost" data-act="finish" data-id="${escapeHtml(id)}">${icon('check-circle-2')}已看完</button>
        <button class="btn btn-ghost" data-act="edit" data-id="${escapeHtml(id)}">${icon('pencil')}编辑</button>
        <button class="btn btn-danger-soft" data-act="delete" data-id="${escapeHtml(id)}">${icon('trash-2')}删除</button>
      </div>
    </div>
  `);
  hydrateCovers($('#modal'));
  // 详情内操作按钮（一次性绑定到当前弹窗 DOM）
  $('#modal').querySelectorAll('.detail-acts [data-act]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const act = btn.dataset.act;
      const sid = btn.dataset.id;
      if (act === 'prev') { handleDecEpisode(sid); openShowDetail(sid); }
      else if (act === 'continue') { handleIncEpisode(sid); openShowDetail(sid); }
      else if (act === 'progress') openProgressModal(sid);
      else if (act === 'finish') openFinishModal(sid);
      else if (act === 'edit') openEditShowModal(sid);
      else if (act === 'delete') openDeleteShowModal(sid);
    });
  });
}

/** 详情内进度越界提示（复用 progressWarn 但改名避免与渲染层混淆） */
function showProgressWarnText(show) {
  return progressWarn(show);
}

/* --- 进度推进/回退的统一入口（写库 + 重渲染） --- */
function handleIncEpisode(id) {
  const s = Store.getShow(id);
  if (!s) return;
  const r = incEpisode(s);
  Store.updateProgress(id, r.episode);
  toast(`进度：${showProgressText(Store.getShow(id))}`);
  renderShows();
}
function handleDecEpisode(id) {
  const s = Store.getShow(id);
  if (!s) return;
  const r = decEpisode(s);
  Store.updateProgress(id, r.episode);
  toast(`进度：${showProgressText(Store.getShow(id))}`);
  renderShows();
}

/* =========================================================================
   观影 —— 事件委托与初始化
   ========================================================================= */
function initShowsPage() {
  const page = document.getElementById('page-shows');
  if (!page) return;

  // 容器级委托：所有动态内容点击统一在此处理（重建 innerHTML 后无需重绑）
  page.addEventListener('click', (e) => {
    const t = e.target;

    // 1) 筛选标签
    const chip = t.closest('.chip[data-status]');
    if (chip) {
      state.showStatus = chip.dataset.status;
      renderShows();
      return;
    }

    // 2) 添加按钮
    if (t.closest('#showAddBtn')) { openAddShowModal(); return; }

    // 3) 展开 / 收起
    const toggle = t.closest('button[data-act="view-all"], button[data-act="collapse"]');
    if (toggle) {
      const key = toggle.dataset.section;
      if (key) state.showExpanded[key] = !state.showExpanded[key];
      renderShows();
      return;
    }

    // 4) 卡片 / 区块上的具体操作
    const actBtn = t.closest('button[data-act][data-id]');
    if (actBtn) {
      const act = actBtn.dataset.act;
      const id = actBtn.dataset.id;
      if (act === 'continue') handleIncEpisode(id);
      else if (act === 'edit') openEditShowModal(id);
      else openShowDetail(id);
      return;
    }

    // 5) 兜底：点击卡片空白处 → 详情
    const card = t.closest('.poster-card[data-id]');
    if (card) { openShowDetail(card.dataset.id); return; }
  });

  // 键盘可达性：卡片回车 / 空格打开详情
  page.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest('.poster-card[data-id]');
    if (card) { e.preventDefault(); openShowDetail(card.dataset.id); }
  });

  // 搜索（防抖 200ms）
  const searchEl = document.getElementById('showSearch');
  if (searchEl) {
    let timer = null;
    searchEl.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        state.showQuery = searchEl.value || '';
        renderShows();
      }, 200);
    });
  }

  // 排序
  const sortSel = document.getElementById('showSortSel');
  if (sortSel) {
    sortSel.addEventListener('change', () => {
      state.showSort = sortSel.value || 'updated';
      renderShows();
    });
  }

  // 观影页外链（位于页头「添加剧集」旁）：确保新窗口打开（href 已在 HTML 设定，这里仅兜底）
  const link = document.getElementById('showsLink');
  if (link) {
    link.addEventListener('click', () => { /* 交给浏览器默认行为；HREF/target 已在 HTML 声明 */ });
  }
}

/* =========================================================================
   英语单词 —— 渲染 / 弹窗 / 初始化
   卡片是「内容层」，沿用实体白卡；弹窗 / Toast 走全局毛玻璃，无需另写样式。
   ========================================================================= */

/** 卡片排序：最近更新在前（新加的卡片自然排在最上面） */
function sortWordCards(list) {
  return (list || []).slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

/**
 * 单个单词行的 HTML（每行的 li 必须保留 .word-item，测试/样式按它计数）。
 * 有释义：渲染「固定宽度灰条 + 释义」两块，默认灰条盖住释义，点击互切（见 toggleWordMeaning）。
 * 无释义：只渲染单词本身，不出现灰条也不留占位。
 */
function wordItemHtml(w) {
  const text = escapeHtml(w.text);
  const meaning = strOr(w.meaning).trim();
  if (!meaning) {
    return `<li class="word-item"><span class="word-text">${text}</span></li>`;
  }
  return `<li class="word-item"><span class="word-text">${text}</span>`
    + `<span class="word-meaning" role="button" tabindex="0" aria-pressed="false" title="点击查看释义">`
    + `<span class="word-meaning-bar" aria-hidden="true"></span>`
    + `<span class="word-meaning-text">${escapeHtml(meaning)}</span>`
    + `</span></li>`;
}

/** 一张单词卡片的 HTML（高度随词数自然变化，由 .word-board 固定网格排列） */
function wordCardHtml(card) {
  const words = Array.isArray(card.words) ? card.words : [];
  const id = escapeHtml(card.id);
  const items = words.map(wordItemHtml).join('');
  return `
    <article class="word-card" data-id="${id}">
      <div class="word-card-head">
        <span class="word-card-count">${icon('layers')}${words.length} 个词</span>
        <div class="word-card-acts">
          <button class="btn-icon" data-act="edit" data-id="${id}" title="编辑" aria-label="编辑卡片">${icon('pencil')}</button>
          <button class="btn-icon del" data-act="delete" data-id="${id}" title="删除" aria-label="删除卡片">${icon('trash-2')}</button>
        </div>
      </div>
      <ul class="word-list">${items}</ul>
    </article>`;
}

/**
 * 切换某一行的「遮挡 / 揭开」状态：只改 DOM class，不写 Store。
 * 因此切页重渲染或刷新后自动回到全部遮挡（复习时总能先自测再揭晓）。
 */
function toggleWordMeaning(li) {
  if (!li) return;
  const on = li.classList.toggle('on');
  const box = li.querySelector('.word-meaning');
  if (box) {
    box.setAttribute('aria-pressed', on ? 'true' : 'false');
    box.setAttribute('title', on ? '点击遮住释义' : '点击查看释义');
  }
}

/** 空态提示 */
function renderEmptyWords() {
  return `
    <div class="empty">
      <span class="empty-icon">${icon('spell-check')}</span>
      <span class="empty-title">还没有单词卡片</span>
      <span class="empty-desc">点击右上角「新增卡片」，每行输入一个单词，一组形近词放同一张卡</span>
    </div>`;
}

/** 搜索无结果（与观影页同款空态，图标沿用既有 lucide 图标） */
function renderNoMatchWords() {
  return `
    <div class="empty">
      <span class="empty-icon">${icon('search-x')}</span>
      <span class="empty-title">没有匹配的卡片</span>
      <span class="empty-desc">搜索会同时匹配单词与释义，换个关键词试试</span>
    </div>`;
}

/* --- 释义「短条 / 长块」判定 -------------------------------------------------
   短释义沿用统一 58×15 小灰条（不泄露长短）；需要两行的长释义用「等大的灰块」。
   两类外观都只作用在绝对定位的覆盖层上，所以判定本身**不参与布局**：
   判错、判晚都只会是观感差异，绝不产生位移。
   （宽度变化会让折行数改变，故 resize / 字体就绪后重算。） */

/**
 * 纯函数：释义盒高 h 与单行行高 line 相比，是否需要占两行以上。
 * 量不到尺寸（如 jsdom 无布局、页面隐藏）时保守判为「长」——宁可盖满，也不露馅。
 */
function isMeaningMultiline(h, line) {
  if (!(h > 0) || !(line > 0)) return true;
  return h > line * 1.5;
}

/**
 * 扫描容器内的词行，按实测行数给 .word-item 加 / 去 .w-short。
 * 只切 class、不重建 DOM，因此不会重置用户已经揭开的 .on 状态。
 * 无释义的行（没有 .word-meaning-text）直接跳过。
 */
function markWordMeaningLines(root) {
  const scope = root || document;
  const items = scope.querySelectorAll('.word-item');
  for (let i = 0; i < items.length; i++) {
    const li = items[i];
    const text = li.querySelector('.word-meaning-text');
    if (!text) continue;
    const h = text.getBoundingClientRect ? text.getBoundingClientRect().height : 0;
    const cs = window.getComputedStyle ? window.getComputedStyle(text) : null;
    const line = cs ? parseFloat(cs.lineHeight) : 0;
    li.classList.toggle('w-short', !isMeaningMultiline(h, line));
  }
}

/** 卡片之间（含上下）的间距，与 style.css 里 .word-board 的 --sp-3 保持一致 */
const WORD_CARD_GAP = 12;

/**
 * 紧排布局：量出每张卡片的高度，让它跨 ceil(高度 + 间距) 行（配合 .packed 的
 * 1px 行高、0 行间距）。这样同一列里卡片上下的间距恒为 WORD_CARD_GAP，
 * 矮卡下方不会再被同行的高卡撑出空洞。
 * 卡片自身高度与跨行数无关（align-items: start），所以量之前不必先摘 .packed。
 * 量不到高度时（页面隐藏 / 无布局）清掉内联跨行并摘掉 .packed，退回普通网格 ——
 * 宁可留空隙，也绝不让卡片叠在一起。
 */
function layoutWordCardSpans(root) {
  const el = root || $('#wordBoard');
  if (!el) return;
  const cards = el.querySelectorAll('.word-card');
  if (!cards.length) { el.classList.remove('packed'); return; }

  const spans = [];
  for (let i = 0; i < cards.length; i++) {
    const h = cards[i].getBoundingClientRect().height;
    if (!(h > 0)) break;
    spans.push(Math.ceil(h) + WORD_CARD_GAP);
  }
  if (spans.length !== cards.length) {
    for (let i = 0; i < cards.length; i++) cards[i].style.gridRowEnd = '';
    el.classList.remove('packed');
    return;
  }
  for (let i = 0; i < cards.length; i++) {
    cards[i].style.gridRowEnd = 'span ' + spans[i];
  }
  el.classList.add('packed');
}

/** 在本页实测一次；页面隐藏时元素量不到尺寸，直接跳过 */
function measureWordLines() {
  const page = document.getElementById('page-words');
  if (!page || !page.classList.contains('active')) return;
  const board = document.getElementById('wordBoard') || page;
  markWordMeaningLines(board);
  layoutWordCardSpans(board);
}

let wordLineTimer = null;
/** 窗口尺寸变化会改变折行，去抖后统一重算 */
function scheduleWordLineRecalc() {
  if (wordLineTimer) clearTimeout(wordLineTimer);
  wordLineTimer = setTimeout(measureWordLines, 120);
}

/** 英语单词页总渲染入口（搜索只筛卡片、不动数据，清空关键词即恢复全部） */
function renderWords() {
  const board = $('#wordBoard');
  if (!board) return;

  // 同步搜索框当前值（切页回来 / 重渲染后保持一致）
  const searchEl = $('#wordSearch');
  if (searchEl && searchEl.value !== state.wordQuery) searchEl.value = state.wordQuery;

  const all = sortWordCards(Store.getWordCards());
  const matched = all.length ? sortWordCards(filterWordCards(all, state.wordQuery)) : [];

  // 有搜索词时才显示命中数量（沿用观影页「筛选结果 N」的反馈方式）
  const result = $('#wordResult');
  if (result) {
    result.textContent = strOr(state.wordQuery).trim() ? `找到 ${matched.length} 张卡片` : '';
  }

  if (!all.length) {
    board.innerHTML = renderEmptyWords();
    refreshIcons(board);
    layoutWordCardSpans(board);   // 摘掉 .packed：1px 行高会让空态塌陷
    return;
  }
  if (!matched.length) {
    board.innerHTML = renderNoMatchWords();
    refreshIcons(board);
    layoutWordCardSpans(board);   // 同上，无结果态也一样
    return;
  }

  board.innerHTML = matched.map(wordCardHtml).join('');
  refreshIcons(board);
  markWordMeaningLines(board);
  layoutWordCardSpans(board);
}

/** 新增卡片 */
function openAddWordCardModal() { openWordCardModal(null); }

/** 编辑卡片（把整组词回填到文本框，可改可删） */
function openEditWordCardModal(id) {
  const c = Store.getWordCard(id);
  if (!c) return;
  openWordCardModal(c);
}

/** 新增 / 编辑共用的弹窗（一行一个单词，可在词后空一格写释义，可整段粘贴） */
function openWordCardModal(card) {
  const editing = !!card;
  // 回填：无释义的词只写词形，避免多出一个无意义的尾随空格
  const initial = editing
    ? card.words.map((w) => (w.meaning ? `${w.text} ${w.meaning}` : w.text)).join('\n')
    : '';
  openModal(`
    <h3>${icon(editing ? 'pencil' : 'plus')}${editing ? '编辑卡片' : '新增卡片'}</h3>
    <p>每行输入一个单词，可在单词后空一格写中文释义；一张卡片放一组形近词，只放一个词也可以。</p>
    <div class="form-field">
      <label class="field-label" for="wordInput">${icon('languages')}单词 <span class="opt">每行「单词 释义」</span></label>
      <textarea class="input" id="wordInput" rows="5"
        placeholder="affect v. 影响，感动&#10;effect n. 效果，作用&#10;infect v. 传染，感染"></textarea>
    </div>
    <div class="field-hint" id="wordHint"></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="modalCancel">取消</button>
      <button class="btn btn-primary" id="modalOk">${editing ? '保存' : '添加'}</button>
    </div>
  `);

  const ta = $('#wordInput');
  const hint = $('#wordHint');
  ta.value = initial;

  const refreshHint = () => {
    const entries = parseWordEntries(ta.value);
    const withMeaning = entries.filter((e) => e.meaning).length;
    hint.textContent = entries.length
      ? `共 ${entries.length} 个词${withMeaning ? `，其中 ${withMeaning} 个含释义` : '（还没填释义）'}`
      : '至少输入一个单词';
    hint.classList.toggle('err', entries.length === 0);
  };
  refreshHint();
  ta.addEventListener('input', refreshHint);
  ta.focus();
  try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch (e) { /* 忽略 */ }

  $('#modalCancel').addEventListener('click', closeModal);
  $('#modalOk').addEventListener('click', () => {
    const entries = parseWordEntries(ta.value);
    if (!entries.length) { toast('请至少输入一个单词', 'err'); ta.focus(); return; }
    if (editing) {
      // 按词形沿用旧 id，编辑后词的 id 不变
      Store.updateWordCard(card.id, { words: mergeWordIds(entries, card.words) });
      toast('卡片已更新');
    } else {
      Store.addWordCard({ words: entries });
      toast('已添加卡片');
    }
    closeModal();
    renderWords();
  });
}

/** 删除卡片（二次确认，沿用通用弹窗） */
function openDeleteWordCardModal(id) {
  const c = Store.getWordCard(id);
  if (!c) return;
  const preview = c.words.map((w) => w.text).join('、');
  const shown = preview.length > 60 ? preview.slice(0, 60) + '…' : preview;
  openModal(`
    <h3>${icon('trash-2')}删除卡片</h3>
    <p>将删除这张卡片（${c.words.length} 个词：${escapeHtml(shown)}），此操作不可撤销。</p>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="modalCancel">取消</button>
      <button class="btn btn-danger-soft" id="modalOk">${icon('trash-2')}删除</button>
    </div>
  `);
  $('#modalCancel').addEventListener('click', closeModal);
  $('#modalOk').addEventListener('click', () => {
    Store.removeWordCard(id);
    closeModal();
    renderWords();
    toast('卡片已删除');
  });
}

function initWordsPage() {
  const page = document.getElementById('page-words');
  if (!page) return;

  // 容器级事件委托：卡片被重建后无需重新绑定
  page.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest('#wordAddBtn')) { openAddWordCardModal(); return; }
    // 灰条 / 释义：点一下切换遮挡状态（逐词独立，互不影响）
    const box = t.closest('.word-meaning');
    if (box) { toggleWordMeaning(box.closest('.word-item')); return; }
    const btn = t.closest('button[data-act][data-id]');
    if (btn) {
      if (btn.dataset.act === 'edit') openEditWordCardModal(btn.dataset.id);
      else if (btn.dataset.act === 'delete') openDeleteWordCardModal(btn.dataset.id);
    }
  });

  // 键盘等价操作：灰条/释义可聚焦，回车或空格同样切换
  page.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    const box = e.target.closest && e.target.closest('.word-meaning');
    if (!box) return;
    e.preventDefault();
    toggleWordMeaning(box.closest('.word-item'));
  });

  // 搜索（防抖 200ms，与观影页一致）：同时匹配单词与释义
  const searchEl = document.getElementById('wordSearch');
  if (searchEl) {
    let timer = null;
    searchEl.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        state.wordQuery = searchEl.value || '';
        renderWords();
      }, 200);
    });
  }

  // 卡片宽度随窗口变化 → 释义折行数可能变，去抖后重算「短条 / 长块」
  // （只切 class，不动 DOM、不动已揭开状态）
  window.addEventListener('resize', scheduleWordLineRecalc);
  // 字体加载完成后折行才最终确定，再量一次
  if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
    try { document.fonts.ready.then(measureWordLines).catch(function () {}); } catch (e) { /* 忽略 */ }
  }
}

/* =========================================================================
   页面路由
   ========================================================================= */
function switchPage(page) {
  state.page = page;
  $$('.nav-item[data-page]').forEach((b) => b.classList.toggle('active', b.dataset.page === page));
  $$('.page').forEach((p) => p.classList.toggle('active', p.id === 'page-' + page));
  if (page === 'stats') renderStats();
  if (page === 'vault') renderVault();
  if (page === 'shows') renderShows();
  if (page === 'words') renderWords();
}

$$('.nav-item[data-page]').forEach((btn) => {
  btn.addEventListener('click', () => switchPage(btn.dataset.page));
});

/* =========================================================================
   记账页
   ========================================================================= */

/* --- 环形仪表盘（r=90 → 周长） --- */
const GAUGE_CIRC = 2 * Math.PI * 90;

function renderGauge() {
  const month = state.ledgerMonth;
  const isCurrent = month === monthStr();

  // 本月支出（与账单月份联动，默认本月）；仅统计「计入环形图」的支出
  const txs = Store.getTransactions(month);
  const countedExpenses = txs.filter((t) => t.type === 'expense' && isCounted(t));
  const spent = round2(countedExpenses.reduce((s, t) => s + t.amount, 0));
  const limit = Store.getLimit(month);
  const remain = round2(limit - spent);

  /* 超额判据统一为「上限 - 已花」为负：limit = 0 时只要有支出也算超额
     （旧实现按 ratio > 1 判色、按 remain < 0 判数值，两者会打架） */
  const over = remain < 0;
  const overAmount = Math.abs(remain);
  const ratio = limit > 0 ? spent / limit : (spent > 0 ? 1 : 0);
  const pct = Math.round(ratio * 100);
  const pctText = (limit > 0 || spent === 0) ? pct + '%' : '100%+';
  const overPct = pct - 100; // 超出上限的百分比，仅 limit > 0 时有意义

  // 环形填充
  const fill = $('#gaugeFill');
  const shown = Math.min(ratio, 1); // 环最多填满，超额用颜色表达
  fill.style.strokeDashoffset = String(GAUGE_CIRC * (1 - shown));

  // 颜色分级
  let color = 'var(--brand-500)', cls = '', label = '正常';
  if (over) {
    color = 'var(--danger)'; cls = 'danger';
    label = limit > 0 ? `已超上限 ${overPct}%` : '已超上限';
  } else if (ratio >= 0.7) {
    color = 'var(--warn)'; cls = 'warn'; label = '接近上限，注意控制';
  }
  fill.style.stroke = color;

  const pctEl = $('#gaugePct');
  pctEl.textContent = pctText;
  pctEl.style.color = color;

  $('#gaugeSpent').textContent = money(spent);
  $('#gaugeLimit').textContent = money(limit);
  $('#gaugeSub').textContent = isCurrent ? '本月已花 / 上限' : `${month} 已花 / 上限`;

  /* 主数值行：未超额说「剩余可支配」，超额改说「已超额」，金额一律不带负号 */
  const remainLabel = $('#gaugeRemainLabel');
  const remainRow = $('#gaugeRemainRow');
  const remainEl = $('#gaugeRemain');
  if (remainLabel) remainLabel.textContent = over ? '本月已超额' : '本月剩余可支配';
  if (remainRow) remainRow.classList.toggle('over', over);
  remainEl.textContent = money(overAmount);
  remainEl.style.color = over ? 'var(--danger)' : 'var(--brand-700)';

  /* 日均行 = 剩余可支配 ÷ 剩余天数。超额或已无剩余天数时该数没有意义，整行隐藏。
     注意必须用内联 style.display：.gauge-row 是作者样式 display:flex，会盖掉 [hidden] */
  const remainDays = remainDaysOf(month);
  const dailyRow = $('#gaugeDailyRow');
  if (dailyRow) dailyRow.style.display = (over || remainDays <= 0) ? 'none' : '';
  if (!over && remainDays > 0) renderGaugeDaily(remain, remainDays);

  const st = $('#gaugeState');
  st.className = 'gauge-state ' + cls;
  st.innerHTML = icon(cls === 'danger' ? 'circle-alert' : (cls === 'warn' ? 'trending-up' : 'shield-check')) + label;
  refreshIcons(st);

  // 概览卡片
  const income = round2(txs.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0));
  const rawExpense = round2(txs.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0));
  const ovE = $('#ovExpense');
  if (ovE) {
    ovE.textContent = money(rawExpense);
    $('#ovIncome').textContent = money(income);
    const ovR = $('#ovRemain');
    ovR.textContent = money(overAmount);
    ovR.style.color = over ? 'var(--danger)' : 'var(--ink-900)';
    const ovHead = $('#ovRemainHead');
    if (ovHead) ovHead.textContent = over ? '超出预算' : '剩余预算';
    $('#ovExpenseFoot').textContent = rawExpense > spent
      ? `含未计入 ${money(rawExpense - spent)}`
      : '计入预算的支出';
    $('#ovIncomeFoot').textContent = income > 0 ? '已入账收入' : '本月暂无收入';
    $('#ovRemainFoot').textContent = over
      ? (limit > 0 ? `已超上限 ${overPct}%` : '已超出上限')
      : '本月可用';
  }
  const sub = $('#ledgerSub');
  if (sub) sub.textContent = `掌握 ${month} 每一笔收支`;
}

/** 该月剩余天数：历史月 0（不再分配）；当月含今天；未来月整月 */
function remainDaysOf(month) {
  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const cur = monthStr();
  if (month < cur) return 0;
  if (month === cur) return daysInMonth - new Date().getDate() + 1;
  return daysInMonth;
}

/** 展示剩余日均可用额度（仅在「未超额且仍有剩余天数」时调用，故必为正数） */
function renderGaugeDaily(remain, remainDays) {
  const el = $('#gaugeDaily');
  if (!el) return;
  el.textContent = money(remain / remainDays);
  el.style.color = 'var(--ink-900)';
  el.title = `剩余 ${money(remain)} ÷ 剩余 ${remainDays} 天`;
}

/* --- 分类选择器（图标网格 + 隐藏原生 select 同步）+ 吃饭餐次子选择 --- */
function buildCatPicker(form) {
  const picker = form.querySelector('[data-cat-picker]');
  const native = form.querySelector('select.f-category');
  if (!picker || !native) return;

  // 隐藏的原生下拉：保留给测试与无 JS 降级，值始终与选择同步
  native.innerHTML = CATEGORIES.map((c) => `<option value="${c}">${c}</option>`).join('');

  picker.innerHTML = CATEGORIES.map((c, i) => `
    <button type="button" class="cat-opt${i === 0 ? ' selected' : ''}" data-cat="${c}" aria-pressed="${i === 0}">
      ${catChip(c)}
      <span class="cat-opt-name">${c}</span>
    </button>`).join('');

  native.value = CATEGORIES[0];

  /* ---- 餐次子选择器：是 [data-cat-picker] 的兄弟节点（刻意不放进网格内部，
     否则主循环 querySelectorAll 会把餐次按钮当成分类按钮）。
     复用 .cat-picker / .cat-opt / .cat-chip 类，因此零新增 CSS。 ---- */
  let mealPicker = form.querySelector('[data-meal-picker]');
  if (!mealPicker) {
    picker.insertAdjacentHTML('afterend', `
      <div class="cat-picker" data-meal-picker style="display:none;margin-top:var(--sp-2)">
        ${MEALS.map((m) => `
          <button type="button" class="cat-opt meal-opt" data-meal="${m}" aria-pressed="false">
            <span class="cat-chip" style="--chip-bg:${CATEGORY_TINT[MEAL_PARENT]};--chip-fg:${CATEGORY_COLOR[MEAL_PARENT]}">${icon(MEAL_ICON[m])}</span>
            <span class="cat-opt-name">${m}</span>
          </button>`).join('')}
        <input type="hidden" class="f-meal" value="" />
      </div>`);
    mealPicker = form.querySelector('[data-meal-picker]');
  }
  const mealInput = mealPicker.querySelector('.f-meal');
  const mealBtns = Array.prototype.slice.call(mealPicker.querySelectorAll('.meal-opt'));
  /** 是否已点开「吃饭」（初始折叠：即使「吃饭」默认选中也不展开） */
  let mealOpen = false;

  const clearMeal = () => {
    mealInput.value = '';
    mealBtns.forEach((b) => {
      b.classList.remove('selected');
      b.setAttribute('aria-pressed', 'false');
    });
  };

  /** 按「是否点开 + 当前分类是否为吃饭」同步显隐；收起时一并清空餐次 */
  const syncMealPicker = () => {
    const show = mealOpen && native.value === MEAL_PARENT;
    // 必须用 style.display：.cat-picker 的 display:grid 会盖过 [hidden] 的 UA 样式
    mealPicker.style.display = show ? '' : 'none';
    if (!show) clearMeal();
  };

  // 主分类：互斥高亮 + 同步隐藏 select；只有点「吃饭」才展开餐次
  picker.querySelectorAll('.cat-opt[data-cat]').forEach((btn) => {
    btn.addEventListener('click', () => {
      picker.querySelectorAll('.cat-opt[data-cat]').forEach((b) => {
        const on = b === btn;
        b.classList.toggle('selected', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      native.value = btn.dataset.cat;          // 同步给隐藏 select（表单提交读取）
      mealOpen = btn.dataset.cat === MEAL_PARENT;
      syncMealPicker();
    });
  });

  // 餐次：单选，再次点已选 = 取消（可不选）
  mealBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const on = !btn.classList.contains('selected');
      mealBtns.forEach((b) => {
        const sel = b === btn && on;
        b.classList.toggle('selected', sel);
        b.setAttribute('aria-pressed', sel ? 'true' : 'false');
      });
      mealInput.value = on ? btn.dataset.meal : '';
    });
  });

  syncMealPicker();   // 初始折叠
}

/* --- 账户选择（分段控件，带图标） --- */
function buildAccountSegs(form) {
  const wrap = form.querySelector('.segs-account');
  if (!wrap) return;

  wrap.innerHTML = Object.entries(ACCOUNTS).map(([key, info]) => `
      <button type="button" class="seg${key === DEFAULT_ACCOUNT ? ' active' : ''}" data-account="${key}">
        ${icon(info.icon)}
        <span class="seg-name">${info.name}</span>
      </button>`).join('');

  // 账户切换
  wrap.querySelectorAll('.seg').forEach((s) => {
    s.addEventListener('click', () => {
      wrap.querySelectorAll('.seg').forEach((x) => x.classList.toggle('active', x === s));
    });
  });
}

/* --- 记账表单（支持记账页 / 统计页多处实例） --- */
function initEntryForms() {
  $$('.entry-form').forEach((form) => {
    // .tab 页签与表单是兄弟节点，需从包含它们的卡片/页面范围内查找
    const scope = form.closest('.card') || form.closest('.page') || form.parentElement;

    buildCatPicker(form);
    buildAccountSegs(form);

    const tabsOf = () => Array.from(scope.querySelectorAll('.tab'));
    const segsAcc = () => Array.from(form.querySelectorAll('.segs-account .seg'));
    const accountOf = () => {
      const active = segsAcc().find((s) => s.classList.contains('active'));
      return active ? active.dataset.account : DEFAULT_ACCOUNT;
    };

    // 支出 / 收入 切换
    tabsOf().forEach((t) => {
      t.addEventListener('click', () => applyEntryType(form, t.dataset.type));
    });

    // 金额输入：清除错误态
    const amountWrap = form.querySelector('[data-amount-wrap]');
    const amountInput = form.querySelector('.f-amount');
    amountInput.addEventListener('input', () => amountWrap && amountWrap.classList.remove('invalid'));
    const dateInput = form.querySelector('.f-date');
    const dateHint = form.querySelector('[data-entry-date-hint]');
    const todayButton = form.querySelector('[data-entry-today]');
    let followsToday = true;
    let dateTimer;
    const refreshEntryDate = () => {
      const today = todayStr();
      if (followsToday) dateInput.value = today;
      if (!dateHint) return;
      const selected = dateInput.value;
      dateHint.hidden = !selected || selected === today;
      if (!dateHint.hidden) {
        const now = new Date();
        const yesterday = todayStr(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
        dateHint.textContent = `当前记账日期：${selected === yesterday ? '昨天（' + selected + '）' : selected}`;
      } else dateHint.textContent = '';
    };
    const scheduleEntryDateCheck = () => {
      clearTimeout(dateTimer);
      const now = new Date();
      const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      dateTimer = setTimeout(() => { refreshEntryDate(); scheduleEntryDateCheck(); }, tomorrow - now + 100);
    };
    dateInput.addEventListener('change', () => {
      followsToday = !dateInput.value || dateInput.value === todayStr();
      if (dateInput.value) refreshEntryDate();
      else if (dateHint) { dateHint.hidden = true; dateHint.textContent = ''; }
    });
    if (todayButton) todayButton.addEventListener('click', () => {
      followsToday = true;
      refreshEntryDate();
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) { refreshEntryDate(); scheduleEntryDateCheck(); }
    });
    scheduleEntryDateCheck();

    // 提交
    form.addEventListener('submit', (e) => {
      e.preventDefault();

      const raw = amountInput.value.trim();
      const amount = parseFloat(raw);
      if (!raw || !isFinite(amount) || amount <= 0) {
        if (amountWrap) {
          amountWrap.classList.add('invalid');
          // 重新触发抖动动画
          void amountWrap.offsetWidth;
        }
        toast('请输入有效金额', 'err');
        amountInput.focus();
        return;
      }
      if (amountWrap) amountWrap.classList.remove('invalid');

      const type = form.dataset.type || 'expense';
      const isExpense = type === 'expense';
      const account = accountOf();
      if (!dateInput.value) followsToday = true;
      refreshEntryDate();
      const date = dateInput.value || todayStr();
      const catVal = form.querySelector('.f-category').value;
      const mealEl = form.querySelector('.f-meal');

      const tx = {
        id: uid(),
        type,
        amount: round2(amount),
        category: isExpense ? catVal : '',
        // 餐次只在「支出 + 吃饭」时才有意义，其余一律留空
        meal: isExpense && catVal === MEAL_PARENT && mealEl ? mealEl.value : '',
        account,
        // 这笔实际动的金库键，供删除 / 改账户时按当初的池回滚
        vaultKey: vaultKeyOf(account),
        remark: form.querySelector('.f-remark').value.trim(),
        date,
        counted: true,               // 是否计入当月环形图（默认计入）
        createdAt: Date.now(),
      };

      // 提交按钮反馈（忙碌 → 成功）
      const btn = form.querySelector('.submit-btn');
      const btnSpan = btn.querySelector('span');
      const btnIcon = btn.querySelector('i');
      const prevText = btnSpan ? btnSpan.textContent : '';
      btn.setAttribute('aria-busy', 'true');
      if (btnSpan) btnSpan.textContent = '记录中…';
      if (btnIcon) btnIcon.setAttribute('data-lucide', 'loader-circle');
      refreshIcons(btn);

      Store.addTransaction(tx);
      // 联动金库：支出扣款，收入入账（按本笔记录的金库键落账）
      Store.adjustVault(tx.vaultKey, isExpense ? -tx.amount : tx.amount);

      // 若记录日期所在月份非当前查看月份，自动跳转
      const txMonth = monthOf(date);
      if (txMonth !== state.ledgerMonth) {
        state.ledgerMonth = txMonth;
        $('#ledgerMonth').value = txMonth;
      }

      // 表单重置（分类按既有行为「粘性」保留；餐次每笔归零，需重新选）
      amountInput.value = '';
      form.querySelector('.f-remark').value = '';
      refreshEntryDate();
      if (mealEl) {
        mealEl.value = '';
        const mp = form.querySelector('[data-meal-picker]');
        if (mp) {
          mp.querySelectorAll('.meal-opt').forEach((b) => {
            b.classList.remove('selected');
            b.setAttribute('aria-pressed', 'false');
          });
        }
      }

      renderLedger();
      if ($('#page-stats').classList.contains('active')) renderStats();
      if ($('#page-vault').classList.contains('active')) renderVault();

      // 恢复按钮
      btn.removeAttribute('aria-busy');
      if (btnSpan) btnSpan.textContent = prevText;
      if (btnIcon) btnIcon.setAttribute('data-lucide', 'check');
      refreshIcons(btn);

      toast(isExpense ? `已记录支出 ${money(tx.amount)}` : `已记录收入 ${money(tx.amount)}`);
    });

    // 默认状态
    applyEntryType(form, 'expense');
    refreshEntryDate();
  });
}

/** 切换某个表单的支出/收入状态 */
function applyEntryType(form, type) {
  form.dataset.type = type;
  const isExpense = type === 'expense';
  const scope = form.closest('.card') || form.closest('.page') || form.parentElement;
  scope.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.type === type));

  const rowCat = form.querySelector('.row-category');
  if (rowCat) rowCat.style.display = isExpense ? '' : 'none';

  const lbl = form.querySelector('.label-account');
  if (lbl) {
    lbl.innerHTML = icon('credit-card') + (isExpense ? '扣款账户' : '来源账户');
    refreshIcons(lbl);
  }

  const btn = form.querySelector('.submit-btn');
  if (btn) {
    const span = btn.querySelector('span');
    if (span) span.textContent = isExpense ? '记录支出' : '记录收入';
  }

  // 支出默认扣款账户：微信；收入默认来源账户：银行
  const dft = isExpense ? DEFAULT_ACCOUNT : 'bank';
  form.querySelectorAll('.segs-account .seg').forEach((s) =>
    s.classList.toggle('active', s.dataset.account === dft));
}

/* --- 账单行（记账页 / 统计页 / 金库页共用） --- */
function billRow(t, opts) {
  const o = opts || {};
  const isExpense = t.type === 'expense';
  const cat = isExpense ? normalizeCategory(t.category) : '收入';
  const acc = ACCOUNTS[t.account] || { name: t.account, icon: 'wallet' };
  const counted = isCounted(t);
  // 餐次只拼在「吃饭」支出上；统计页当日账单传 showMeal:false 保持原样
  const meal = (isExpense && o.showMeal !== false && cat === MEAL_PARENT) ? normalizeMeal(t.meal) : '';
  const title = meal ? `${cat} · ${meal}` : cat;

  const chip = isExpense
    ? catChip(cat, o.large ? 'lg' : '')
    : `<span class="cat-chip" style="--chip-bg:var(--income-soft);--chip-fg:var(--income)">${icon('banknote')}</span>`;

  const actions = [];
  if (isExpense && o.interactive) {
    actions.push(`<button class="btn-mini ${counted ? 'on' : 'off'}" data-act="toggle-count"
        title="${counted ? '点击后该笔不计入当月环形图' : '点击后该笔计入当月环形图'}">
        ${icon(counted ? 'check' : 'x')}${counted ? '已计入' : '未计入'}</button>`);
    actions.push(`<button class="btn-mini" data-act="account" title="修改扣款账户">
        ${icon('arrow-left-right')}改账户</button>`);
  }
  if (o.interactive) {
    actions.push(`<button class="btn-mini" data-act="edit" title="编辑这笔记录">
        ${icon('pencil')}编辑</button>`);
    actions.push(`<button class="btn-mini del" data-act="del" title="删除这笔记录">
        ${icon('trash-2')}删除</button>`);
  }

  return `
    <li class="bill-item${isExpense && !counted ? ' excluded' : ''}"${t.id ? ` data-id="${t.id}"` : ''}>
      <div class="bill-cat">${chip}</div>
      <div class="bill-main">
        <div class="bill-top">
          <span class="bill-title">${escapeHtml(title)}</span>
          ${isExpense && !counted ? `<span class="bill-flag">${icon('eye-off')}不计入</span>` : ''}
        </div>
        ${t.remark ? `<div class="bill-remark">${escapeHtml(t.remark)}</div>` : ''}
        <div class="bill-meta">
          <span class="bill-tag">${icon(acc.icon)}${escapeHtml(acc.name)}</span>
          <span class="bill-date">${formatDateCN(t.date)}</span>
        </div>
      </div>
      <div class="bill-amt ${isExpense ? 'out' : 'in'}">${isExpense ? '-' : '+'}${money(t.amount).slice(1)}</div>
      ${actions.length ? `<div class="bill-actions">${actions.join('')}</div>` : ''}
    </li>`;
}

/* --- 账单列表 --- */
function renderBillList(month) {
  const list = $('#billList');
  const query = state.billQuery.trim().toLocaleLowerCase();
  const filtering = !!query || !!state.billCategory;
  const base = filtering && state.billScope === 'all'
    ? Store.data.transactions.slice().sort((a, b) => (b.date + String(b.createdAt)).localeCompare(a.date + String(a.createdAt)))
    : Store.getTransactions(month);
  const txs = filtering ? base.filter((t) =>
    (!query || (t.remark || '').toLocaleLowerCase().includes(query)) &&
    (!state.billCategory || (t.type === 'expense' && normalizeCategory(t.category) === state.billCategory))
  ) : base;

  const expense = round2(txs.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0));
  const income = round2(txs.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0));
  const countedExpense = round2(txs.filter((t) => t.type === 'expense' && isCounted(t)).reduce((s, t) => s + t.amount, 0));
  const excludedExpense = round2(expense - countedExpense);
  $('#listSummary').innerHTML = txs.length
    ? `<span>${filtering ? '筛选结果 · ' : ''}共 <b>${txs.length}</b> 笔</span>
       <span>支出 <b>${money(expense)}</b></span>
       ${filtering ? '' : `<span>计入环形图 <b>${money(countedExpense)}</b></span>
       ${excludedExpense > 0 ? `<span>不计入 <b>${money(excludedExpense)}</b></span>` : ''}`}
       <span>收入 <b class="income">${money(income)}</b></span>
       <span>结余 <b>${money(income - expense)}</b></span>`
    : '';

  if (!txs.length) {
    list.innerHTML = `
      <li class="empty">
        <span class="empty-icon">${icon('notebook-pen')}</span>
        <span class="empty-title">${filtering ? '没有找到符合条件的账单' : '本月暂无记录'}</span>
        <span class="empty-desc">${filtering ? '试试其他关键词、分类或搜索范围' : '在上方表单记一笔，账单会实时出现在这里'}</span>
      </li>`;
    refreshIcons(list);
    return;
  }

  list.innerHTML = txs.map((t) => billRow(t, { interactive: true })).join('');
  refreshIcons(list);
}

const billCategoryFilter = $('#billCategoryFilter');
billCategoryFilter.innerHTML += CATEGORIES.map((cat) => `<option value="${escapeHtml(cat)}">${escapeHtml(cat)}</option>`).join('');
$('#billSearch').addEventListener('input', (e) => { state.billQuery = e.target.value; renderBillList(state.ledgerMonth); });
billCategoryFilter.addEventListener('change', (e) => { state.billCategory = e.target.value; renderBillList(state.ledgerMonth); });
$('#billSearchScope').addEventListener('change', (e) => { state.billScope = e.target.value; renderBillList(state.ledgerMonth); });

/* --- 账单操作（事件委托） --- */
$('#billList').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = btn.closest('.bill-item').dataset.id;
  if (btn.dataset.act === 'del') confirmDelete(id);
  if (btn.dataset.act === 'edit') openEditTransaction(id);
  if (btn.dataset.act === 'account') openChangeAccount(id);
  if (btn.dataset.act === 'toggle-count') toggleCounted(id);
});

/** 编辑交易：一次性保存交易与金库，失败时保留原有数据。 */
function openEditTransaction(id) {
  const tx = Store.data.transactions.find((t) => t.id === id);
  if (!tx) return;
  const isExpense = tx.type === 'expense';
  const category = normalizeCategory(tx.category);
  const categories = CATEGORIES.includes(category) ? CATEGORIES : [category, ...CATEGORIES];
  const options = (values, selected) => values.map(([value, label]) =>
    `<option value="${escapeHtml(value)}"${value === selected ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('');
  openModal(`
    <h3>${icon('pencil')}编辑${isExpense ? '支出' : '收入'}</h3>
    <div class="form-field"><label class="field-label" for="editTxAmount">金额</label>
      <input class="input" id="editTxAmount" type="number" min="0.01" step="0.01" value="${escapeHtml(tx.amount)}" /></div>
    ${isExpense ? `<div class="form-field"><label class="field-label" for="editTxCategory">分类</label>
      <select class="input" id="editTxCategory">${options(categories.map((c) => [c, c]), category)}</select></div>
    <div class="form-field" id="editTxMealField"><label class="field-label" for="editTxMeal">餐次（选填）</label>
      <select class="input" id="editTxMeal">${options([['', '不选择'], ...MEALS.map((m) => [m, m])], normalizeMeal(tx.meal))}</select></div>` : ''}
    <div class="form-field"><label class="field-label" for="editTxAccount">${isExpense ? '扣款账户' : '收入账户'}</label>
      <select class="input" id="editTxAccount">${options(Object.entries(ACCOUNTS).map(([key, info]) => [key, info.name]), tx.account)}</select></div>
    <div class="form-field"><label class="field-label" for="editTxDate">日期</label>
      <input class="input" id="editTxDate" type="date" value="${escapeHtml(dateOf(tx.date))}" /></div>
    <div class="form-field"><label class="field-label" for="editTxRemark">备注（选填）</label>
      <input class="input" id="editTxRemark" type="text" value="${escapeHtml(tx.remark || '')}" /></div>
    <div class="modal-actions"><button type="button" class="btn btn-ghost" id="modalCancel">取消</button>
      <button type="button" class="btn btn-primary" id="modalOk">保存</button></div>`);

  if (isExpense) {
    const cat = $('#editTxCategory');
    const mealField = $('#editTxMealField');
    const syncMeal = () => {
      mealField.hidden = cat.value !== MEAL_PARENT;
      if (mealField.hidden) $('#editTxMeal').value = '';
    };
    cat.addEventListener('change', syncMeal);
    syncMeal();
  }
  $('#modalCancel').addEventListener('click', closeModal);
  $('#modalOk').addEventListener('click', () => {
    const amountInput = $('#editTxAmount');
    const amount = round2(Number(amountInput.value));
    const dateInput = $('#editTxDate');
    if (!amountInput.value || !Number.isFinite(amount) || amount <= 0 || !amountInput.validity.valid) {
      toast('请输入有效金额', 'err'); amountInput.focus(); return;
    }
    if (!dateInput.value || !dateInput.validity.valid) {
      toast('请选择有效日期', 'err'); dateInput.focus(); return;
    }
    const current = Store.data.transactions.find((t) => t.id === id);
    if (!current) { toast('这笔记录已不存在', 'err'); return; }
    const account = $('#editTxAccount').value;
    const oldKey = vaultKeyOfTx(current);
    const newKey = account === current.account ? oldKey : vaultKeyOf(account);
    const updated = { ...current, amount, account, date: dateInput.value, remark: $('#editTxRemark').value.trim() };
    if (isExpense) {
      updated.category = $('#editTxCategory').value;
      updated.meal = mealForCategory(updated.category, $('#editTxMeal').value);
    }
    if (account !== current.account) updated.vaultKey = newKey;
    const vault = { ...Store.data.vault };
    const sign = isExpense ? -1 : 1;
    if (oldKey !== newKey || amount !== current.amount) {
      vault[oldKey] = round2(vault[oldKey] - sign * current.amount);
      vault[newKey] = round2(vault[newKey] + sign * amount);
    }
    const next = { ...Store.data, vault, transactions: Store.data.transactions.map((t) => t === current ? updated : t) };
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(next));
    } catch (e) {
      console.error('保存失败', e);
      toast('保存失败：本地存储空间不足或被禁用', 'err');
      return;
    }
    Store.data = next;
    if (typeof scheduleAutoPush === 'function') {
      try { scheduleAutoPush(); } catch (e) { console.error('云同步调度失败', e); }
    }
    state.ledgerMonth = monthOf(updated.date);
    $('#ledgerMonth').value = state.ledgerMonth;
    closeModal();
    renderLedger();
    if (state.page === 'stats') renderStats();
    if (state.page === 'vault') renderVault();
    toast('账单已更新');
  });
  $('#editTxAmount').focus();
}

/** 切换某笔支出是否计入当月环形图 */
function toggleCounted(id) {
  const tx = Store.data.transactions.find((t) => t.id === id);
  if (!tx || tx.type !== 'expense') return;
  tx.counted = !isCounted(tx);
  Store.save();
  renderLedger();
  if (state.page === 'stats') renderStats();
  toast(tx.counted ? '该笔已计入当月花费' : '该笔已改为不计入当月花费');
}

/** 删除前二次确认，避免误删 */
function confirmDelete(id) {
  const tx = Store.data.transactions.find((t) => t.id === id);
  if (!tx) return;
  const cat = tx.type === 'expense' ? normalizeCategory(tx.category) : '收入';
  openModal(`
    <h3>${icon('circle-alert')}确认删除</h3>
    <p>将删除「${escapeHtml(cat)} · ${money(tx.amount)}」这笔记录，并把金额回滚到对应账户。此操作不可撤销。</p>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="modalCancel">取消</button>
      <button class="btn btn-danger-soft" id="modalOk">删除</button>
    </div>
  `);
  $('#modalCancel').addEventListener('click', closeModal);
  $('#modalOk').addEventListener('click', () => { closeModal(); deleteTx(id); });
}

function deleteTx(id) {
  const tx = Store.data.transactions.find((t) => t.id === id);
  if (!tx) return;
  // 回滚金库：按这笔当初实际动的池退回（历史微信账退零钱，新账退零钱通）
  Store.adjustVault(vaultKeyOfTx(tx), tx.type === 'expense' ? tx.amount : -tx.amount);
  Store.removeTransaction(id);
  renderLedger();
  if (state.page === 'stats') renderStats();
  if (state.page === 'vault') renderVault();
  toast('已删除该笔记录');
}

/* --- 改账户 --- */
function openChangeAccount(id) {
  const tx = Store.data.transactions.find((t) => t.id === id);
  if (!tx) return;
  const opts = Object.entries(ACCOUNTS).map(([k, v]) =>
    `<button type="button" class="seg${k === tx.account ? ' active' : ''}" data-acc="${k}">
       ${icon(v.icon)}<span class="seg-name">${v.name}</span>
     </button>`
  ).join('');

  openModal(`
    <h3>${icon('arrow-left-right')}修改扣款账户</h3>
    <p>当前：${ACCOUNTS[tx.account].name} · ${money(tx.amount)}。切换后，系统会把原账户金额加回，再从新账户扣除等额金额。</p>
    <div class="segmented" id="modalSegs">${opts}</div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="modalCancel">取消</button>
      <button class="btn btn-primary" id="modalOk">确认修改</button>
    </div>
  `);

  let picked = tx.account;
  $('#modalSegs').addEventListener('click', (e) => {
    const seg = e.target.closest('.seg');
    if (!seg) return;
    picked = seg.dataset.acc;
    $$('#modalSegs .seg').forEach((s) => s.classList.toggle('active', s === seg));
  });
  $('#modalCancel').addEventListener('click', closeModal);
  $('#modalOk').addEventListener('click', () => {
    if (picked === tx.account) { closeModal(); return; }
    // 1) 原账户按「当初实际动的池」加回  2) 新账户按当前默认规则扣除
    Store.adjustVault(vaultKeyOfTx(tx), tx.amount);
    Store.adjustVault(vaultKeyOf(picked), -tx.amount);
    tx.account = picked;
    tx.vaultKey = vaultKeyOf(picked);   // 同步改写，保证日后回滚找对池
    Store.save();
    closeModal();
    renderLedger();
    if (state.page === 'vault') renderVault();
    toast(`已改为「${ACCOUNTS[picked].name}」，金额已同步调整`);
  });
}

/* --- 修改月度上限 --- */
$('#editLimitBtn').addEventListener('click', () => {
  const month = state.ledgerMonth;
  const cur = Store.getLimit(month);
  openModal(`
    <h3>${icon('target')}修改资金上限</h3>
    <p>${month} 的月度消费上限（默认 ¥${DEFAULT_LIMIT}）</p>
    <div class="form-field">
      <label class="field-label">上限金额</label>
      <input type="number" class="input" id="limitInput" step="0.01" min="0" value="${cur}" />
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="modalCancel">取消</button>
      <button class="btn btn-primary" id="modalOk">保存</button>
    </div>
  `);
  $('#limitInput').focus();
  $('#modalCancel').addEventListener('click', closeModal);
  $('#modalOk').addEventListener('click', () => {
    const v = parseFloat($('#limitInput').value);
    if (isNaN(v) || v < 0) { toast('请输入有效数值', 'err'); return; }
    Store.setLimit(month, round2(v));
    closeModal();
    renderGauge();
    toast('资金上限已更新');
  });
  $('#limitInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#modalOk').click();
  });
});

/* =========================================================================
   统计页
   ========================================================================= */
function renderStats() {
  const date = state.statsDate;
  const txs = Store.getByDate(date).filter((t) => t.type === 'expense');

  const byCat = {};
  txs.forEach((t) => {
    const c = normalizeCategory(t.category);
    byCat[c] = (byCat[c] || 0) + t.amount;
  });
  const total = round2(Object.values(byCat).reduce((s, v) => s + v, 0));

  $('#statsTitle').textContent = txs.length
    ? `${formatDateCN(date)} 支出分类占比`
    : '当日支出分类占比';
  $('#statsTotal').textContent = money(total);

  const entries = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const svg = $('#donutSvg');
  const legend = $('#statsLegend');

  const R = 78, C = 2 * Math.PI * R;

  if (!entries.length) {
    svg.innerHTML = `<circle cx="110" cy="110" r="${R}" stroke="#eef2f5" stroke-width="26"></circle>`;
    legend.innerHTML = `
      <li class="empty" style="padding:0">
        <span class="empty-icon">${icon('chart-pie')}</span>
        <span class="empty-title">当天没有支出记录</span>
        <span class="empty-desc">换个日期，或在上方快捷记账中记一笔</span>
      </li>`;
  } else {
    let offset = 0;
    const arcs = entries.map(([cat, amt]) => {
      const frac = amt / total;
      const len = C * frac;
      const color = CATEGORY_COLOR[cat] || '#8798a0';
      const el = `<circle class="donut-seg" cx="110" cy="110" r="${R}"
          stroke="${color}" stroke-width="26"
          stroke-dasharray="${len} ${C - len}"
          stroke-dashoffset="${-offset}"><title>${cat} ${money(amt)}</title></circle>`;
      offset += len;
      return el;
    }).join('');
    svg.innerHTML = `<circle cx="110" cy="110" r="${R}" stroke="#f1f4f6" stroke-width="26"></circle>${arcs}`;

    legend.innerHTML = entries.map(([cat, amt]) => {
      const frac = amt / total;
      const color = CATEGORY_COLOR[cat] || '#8798a0';
      return `
        <li class="legend-item">
          <span class="legend-dot" style="background:${color}"></span>
          <span class="legend-name">${icon(CATEGORY_ICON[cat] || 'package')}${escapeHtml(cat)}</span>
          <span class="legend-bar"><i style="width:${(frac * 100).toFixed(1)}%;background:${color}"></i></span>
          <span class="legend-amt">${money(amt)}</span>
          <span class="legend-pct">${(frac * 100).toFixed(1)}%</span>
        </li>`;
    }).join('');
  }
  refreshIcons(legend);

  // 近 7 日收支趋势
  renderStatsTrend(date);

  // 当日账单
  const dayList = Store.getByDate(date);
  const ul = $('#statsBillList');
  if (!dayList.length) {
    ul.innerHTML = `
      <li class="empty">
        <span class="empty-icon">${icon('receipt-text')}</span>
        <span class="empty-title">当天暂无账单</span>
      </li>`;
  } else {
    // 统计页的当日账单保持原样：不拼接餐次（餐次只在记账页 / 金库页展示）
    ul.innerHTML = dayList.map((t) => billRow(t, { showMeal: false })).join('');
  }
  refreshIcons(ul);

  // 月度总结（12 月网格 + 明细 + 年度对比图）
  renderMonthlySummary();
}

/** 近 7 日收支趋势（以选中日期为终点） */
function renderStatsTrend(endDate) {
  const el = $('#statsTrend');
  if (!el) return;

  const end = new Date(`${endDate}T00:00:00`);
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(end.getTime());
    d.setDate(end.getDate() - i);
    days.push(todayStr(d));
  }

  const agg = days.map((ds) => {
    const list = Store.getByDate(ds);
    return {
      date: ds,
      exp: round2(list.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0)),
      inc: round2(list.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0)),
    };
  });

  const max = Math.max(1, ...agg.map((a) => Math.max(a.exp, a.inc)));
  const week = ['日', '一', '二', '三', '四', '五', '六'];
  el.style.setProperty('--trend-label-width', `${Math.max(...agg.map((a) => money(a.exp).length))}ch`);

  el.innerHTML = agg.map((a) => {
    const d = new Date(`${a.date}T00:00:00`);
    const expH = Math.round((a.exp / max) * 100);
    const incH = Math.round((a.inc / max) * 100);
    return `
      <div class="trend-col" title="${a.date} 支出${money(a.exp)} 收入${money(a.inc)}">
        <div class="trend-bars">
          <span class="trend-bar exp" style="height:${Math.max(expH, a.exp > 0 ? 4 : 2)}%">
            <span class="trend-value">${money(a.exp)}</span>
          </span>
          <span class="trend-bar inc" style="height:${Math.max(incH, a.inc > 0 ? 4 : 2)}%"></span>
        </div>
        <span class="trend-x">${week[d.getDay()]}</span>
      </div>`;
  }).join('');
}

$('#statsDate').addEventListener('change', (e) => {
  state.statsDate = e.target.value || todayStr();
  renderStats();
});

/* =========================================================================
   月度总结：12 月网格 + 选中月分类明细（环比）+ 12 月支出对比图
   ========================================================================= */

/** 某年 12 个月的支出总额（全部支出，忽略 counted 标记） */
function monthTotals(year) {
  const out = [];
  for (let m = 1; m <= 12; m++) {
    const ym = `${year}-${pad2(m)}`;
    const txs = Store.getTransactions(ym).filter((t) => t.type === 'expense');
    out.push({
      month: m,
      ym,
      total: round2(txs.reduce((s, t) => s + t.amount, 0)),
      count: txs.length,
    });
  }
  return out;
}

/** 某月按分类的支出合计（全部支出，忽略 counted 标记） */
function monthCategoryTotals(ym) {
  const txs = Store.getTransactions(ym).filter((t) => t.type === 'expense');
  const byCat = {};
  txs.forEach((t) => {
    const c = normalizeCategory(t.category);
    byCat[c] = (byCat[c] || 0) + t.amount;
  });
  return {
    byCat,
    total: round2(txs.reduce((s, t) => s + t.amount, 0)),
    count: txs.length,
  };
}

/** 环比 delta 片段：prev 为 0 → 新增；相等 → 持平；否则 ↑↓ 金额 + 百分比 */
function deltaHtml(cur, prev) {
  if (prev === 0 && cur === 0) return `<span class="msum-delta flat">${icon('minus')}—</span>`;
  if (prev === 0) return `<span class="msum-delta up">${icon('trending-up')}新增</span>`;
  const d = round2(cur - prev);
  if (d === 0) return `<span class="msum-delta flat">${icon('minus')}持平</span>`;
  const pct = Math.abs((d / prev) * 100).toFixed(1);
  const up = d > 0;
  return `<span class="msum-delta ${up ? 'up' : 'down'}">
    ${icon(up ? 'trending-up' : 'trending-down')}${up ? '+' : '-'}${money(Math.abs(d)).slice(1)}
    <b>${up ? '+' : '-'}${pct}%</b></span>`;
}

function renderMonthlySummary() {
  const grid = $('#msumGrid');
  if (!grid) return;

  const year = state.summaryYear;
  const totals = monthTotals(year);

  // 年份标题
  const yearEl = $('#msumYear');
  if (yearEl) yearEl.textContent = String(year);
  const chartTitle = $('#msumChartTitle');
  if (chartTitle) chartTitle.textContent = `${year} 年各月支出对比`;

  // ---- 12 个月按钮（2 行 × 6 列） ----
  grid.innerHTML = totals.map((t) => {
    const hasData = t.count > 0;
    const active = t.ym === state.summaryMonth;
    return `
      <button type="button"
        class="month-btn${active ? ' active' : ''}${hasData ? '' : ' empty'}"
        data-month="${t.ym}" aria-pressed="${active}"
        title="${t.month}月 ${hasData ? money(t.total) : '暂无支出'}">
        <span class="month-btn-m">${t.month}月</span>
        <span class="month-btn-amt">${hasData ? money(t.total) : '—'}</span>
      </button>`;
  }).join('');

  // ---- 详情面板 ----
  const panel = $('#msumPanel');
  const ym = state.summaryMonth;
  const showComparison = ym < monthStr();
  const cur = monthCategoryTotals(ym);
  const prev = monthCategoryTotals(addMonths(ym, -1));

  if (cur.count === 0) {
    panel.hidden = false;
    panel.innerHTML = `
      <div class="msum-panel-head">
        <span class="msum-panel-title">${icon('calendar-range')}${ym} 月度明细${showComparison ? '' : '<em>月结束后显示环比</em>'}</span>
        <span class="msum-panel-total">${money(0)}</span>
      </div>
      <div class="empty" style="padding:var(--sp-6) 0">
        <span class="empty-icon">${icon('chart-column')}</span>
        <span class="empty-title">${ym} 暂无支出记录</span>
        <span class="empty-desc">换一个月份，或到记账页记一笔</span>
      </div>`;
  } else {
    panel.hidden = false;
    const rows = CATEGORIES
      .map((cat) => ({ cat, amt: round2(cur.byCat[cat] || 0), prevAmt: round2(prev.byCat[cat] || 0) }))
      .filter((r) => r.amt > 0)
      .sort((a, b) => b.amt - a.amt);
    const max = rows.length ? rows[0].amt : 1;

    const body = rows.map((r) => {
      const color = CATEGORY_COLOR[r.cat] || '#8798a0';
      return `
        <li><button type="button" class="rank-item msum-row" data-summary-category="${escapeHtml(r.cat)}"
          aria-expanded="${state.summaryCategory === r.cat}" aria-controls="msumCategoryBills">
          <span class="rank-name">${icon(CATEGORY_ICON[r.cat] || 'package')}${escapeHtml(r.cat)}</span>
          <span class="rank-track"><i style="width:${((r.amt / max) * 100).toFixed(1)}%;background:${color}"></i></span>
          <span class="rank-amt">${money(r.amt)}</span>
          ${showComparison ? deltaHtml(r.amt, r.prevAmt) : ''}
          ${icon(state.summaryCategory === r.cat ? 'chevron-up' : 'chevron-down')}
        </button></li>`;
    }).join('');

    const selected = rows.find((r) => r.cat === state.summaryCategory);
    const categoryBills = selected
      ? Store.getTransactions(ym).filter((t) => t.type === 'expense' && normalizeCategory(t.category) === selected.cat)
      : [];
    const details = selected ? `
      <div class="msum-category-head"><strong>${escapeHtml(selected.cat)}账单</strong>
        <span>${categoryBills.length} 笔 · ${money(selected.amt)}</span></div>
      <ul class="bill-list">${categoryBills.map((t) => billRow(t)).join('')}</ul>` : '';

    panel.innerHTML = `
      <div class="msum-panel-head">
        <span class="msum-panel-title">${icon('git-compare')}${ym} 月度明细
          <em>${showComparison ? `对比 ${addMonths(ym, -1)}` : '月结束后显示环比'}</em></span>
        <span class="msum-panel-total">${money(cur.total)} ${showComparison ? deltaHtml(cur.total, prev.total) : ''}</span>
      </div>
      <ul class="rank-list msum-rows">${body}</ul>
      <div id="msumCategoryBills" class="msum-category-bills"${selected ? '' : ' hidden'}>${details}</div>
      <div class="msum-panel-foot">${cur.count} 笔支出 · 全部支出合计 ${money(cur.total)}</div>`;
  }

  // ---- 12 个月对比条形图 ----
  const chart = $('#msumChart');
  const maxTotal = Math.max(1, ...totals.map((t) => t.total));
  chart.innerHTML = totals.map((t) => {
    const h = Math.round((t.total / maxTotal) * 100);
    const active = t.ym === state.summaryMonth;
    return `
      <button type="button" class="msum-col${active ? ' active' : ''}" data-month="${t.ym}"
        title="${t.month}月 ${money(t.total)}">
        <span class="msum-col-val">${t.total > 0 ? Math.round(t.total) : ''}</span>
        <span class="msum-col-bar-wrap"><i class="msum-col-bar"
          style="height:${t.total > 0 ? Math.max(h, 3) : 2}%"></i></span>
        <span class="msum-col-x">${t.month}月</span>
      </button>`;
  }).join('');

  refreshIcons(grid);
  refreshIcons(panel);
  refreshIcons(chart);
}

/** 月度总结交互：年份切换 + 月份选择（事件委托，只绑一次） */
function initMonthlySummary() {
  const card = $('#monthlySummaryCard');
  if (!card) return;
  let lastMonth = monthStr();
  let midnightTimer;
  const refreshIfMonthChanged = () => {
    const currentMonth = monthStr();
    if (currentMonth !== lastMonth) {
      lastMonth = currentMonth;
      if (state.page === 'stats') renderMonthlySummary();
    }
  };
  const scheduleMidnightCheck = () => {
    clearTimeout(midnightTimer);
    const now = new Date();
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    midnightTimer = setTimeout(() => {
      refreshIfMonthChanged();
      scheduleMidnightCheck();
    }, tomorrow - now + 100);
  };
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      refreshIfMonthChanged();
      scheduleMidnightCheck();
    }
  });
  scheduleMidnightCheck();
  card.addEventListener('click', (e) => {
    const yearBtn = e.target.closest('#msumPrevYear, #msumNextYear');
    if (yearBtn) {
      state.summaryYear += (yearBtn.id === 'msumNextYear' ? 1 : -1);
      state.summaryMonth = `${state.summaryYear}-01`; // 切年后落到该年 1 月
      state.summaryCategory = null;
      renderMonthlySummary();
      return;
    }
    const monthBtn = e.target.closest('.month-btn, .msum-col');
    if (monthBtn && monthBtn.dataset.month) {
      state.summaryMonth = monthBtn.dataset.month;
      state.summaryCategory = null;
      renderMonthlySummary();
      return;
    }
    const categoryBtn = e.target.closest('[data-summary-category]');
    if (categoryBtn) {
      const category = categoryBtn.dataset.summaryCategory;
      state.summaryCategory = state.summaryCategory === category ? null : category;
      renderMonthlySummary();
      const newButton = Array.from(card.querySelectorAll('[data-summary-category]'))
        .find((button) => button.dataset.summaryCategory === category);
      if (newButton) newButton.focus();
    }
  });
}

/* =========================================================================
   金库页
   ========================================================================= */
function renderVault() {
  const v = Store.getVault();
  $('#totalAssets').textContent = money(Store.totalAssets());
  renderStorageNote();

  $('#vaultGrid').innerHTML = Object.entries(ACCOUNTS).map(([key, info]) => {
    // 微信：拆成「零钱 / 零钱通」两个子板块
    if (Array.isArray(info.subAccounts) && info.subAccounts.length) {
      const total = round2(info.subAccounts.reduce((s, sub) => s + (v[sub.key] || 0), 0));
      const subCards = info.subAccounts.map((sub) => {
        const bal = v[sub.key] || 0;
        return `
          <div class="vault-sub">
            <div class="vault-sub-head">
              ${icon(sub.icon)}
              <span class="vault-sub-name">${sub.name}</span>
            </div>
            <div class="vault-sub-amount ${bal < 0 ? 'neg' : ''}">${money(bal)}</div>
            <button class="btn-mini" data-vault-act="set" data-acc="${sub.key}">${icon('pencil')}改余额</button>
          </div>`;
      }).join('');
      return `
        <div class="vault-card vault-card-split">
          <div class="vault-head">
            <span class="vault-icon">${icon(info.icon)}</span>
            <span class="vault-name">${info.name}</span>
            <span class="vault-total ${total < 0 ? 'neg' : ''}">${money(total)}</span>
          </div>
          <div class="vault-subs">${subCards}</div>
        </div>`;
    }

    // 普通账户
    const bal = v[key] || 0;
    return `
      <div class="vault-card">
        <div class="vault-head">
          <span class="vault-icon">${icon(info.icon)}</span>
          <span class="vault-name">${info.name}</span>
        </div>
        <div class="vault-amount ${bal < 0 ? 'neg' : ''}">${money(bal)}</div>
        <div class="vault-actions">
          <button class="btn-mini" data-vault-act="set" data-acc="${key}">${icon('pencil')}改余额</button>
        </div>
      </div>`;
  }).join('');

  // 账户流水（全部交易，按时间倒序，取最近 50 条）
  const all = Store.data.transactions
    .slice()
    .sort((a, b) => (b.date + String(b.createdAt)).localeCompare(a.date + String(a.createdAt)))
    .slice(0, 50);

  const ul = $('#vaultBillList');
  if (!all.length) {
    ul.innerHTML = `
      <li class="empty">
        <span class="empty-icon">${icon('arrow-left-right')}</span>
        <span class="empty-title">暂无流水记录</span>
        <span class="empty-desc">记账后，账户流水会在这里按时间倒序展示</span>
      </li>`;
    refreshIcons($('#vaultGrid'));
    refreshIcons(ul);
    return;
  }
  ul.innerHTML = all.map((t) => billRow(t, {})).join('');

  refreshIcons($('#vaultGrid'));
  refreshIcons(ul);
}

/* --- 本地存储状态提示 --- */
function renderStorageNote() {
  const el = $('#storageNote');
  if (!el) return;
  let bytes = 0;
  try { bytes = (localStorage.getItem(STORE_KEY) || '').length; } catch (_) {}
  const kb = (bytes / 1024).toFixed(1);
  const count = Store.data.transactions.length;
  el.innerHTML = `${icon('shield-check')}数据已保存在本机浏览器 · ${count} 笔记录 · 约 ${kb} KB`;
  refreshIcons(el);
}

/* --- 导出 / 导入备份（防止换浏览器或清理数据导致丢失） --- */
function exportData() {
  const payload = {
    app: 'life-assistant',
    exportedAt: new Date().toISOString(),
    data: Store.data,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `记账数据备份_${todayStr()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('已导出备份文件');
}

function importData() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const data = parsed && parsed.data ? parsed.data : parsed;
        if (!data || !Array.isArray(data.transactions)) throw new Error('格式不正确');
        Store.data = data;
        Store.migrate();
        Store.sanitize();
        Store.save();
        renderLedger();
        renderStats();
        renderVault();
        toast(`已导入 ${Store.data.transactions.length} 笔记录`);
      } catch (err) {
        toast('导入失败：文件格式不正确', 'err');
      }
    };
    reader.readAsText(file);
  });
  input.click();
}

$('#exportBtn').addEventListener('click', exportData);
$('#importBtn').addEventListener('click', importData);

$('#vaultGrid').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-vault-act="set"]');
  if (!btn) return;
  const key = btn.dataset.acc;                 // 金库键：wechat_change / wechat_lct / alipay / bank
  const info = VAULT_META[key] || { name: key };
  const cur = Store.getVault()[key] || 0;
  openModal(`
    <h3>${icon('coins')}调整「${info.name}」余额</h3>
    <p>直接设置该板块当前余额（允许为负数）</p>
    <div class="form-field">
      <label class="field-label">余额</label>
      <input type="number" class="input" id="vaultInput" step="0.01" value="${cur}" />
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="modalCancel">取消</button>
      <button class="btn btn-primary" id="modalOk">保存</button>
    </div>
  `);
  $('#vaultInput').focus();
  $('#vaultInput').select();
  $('#modalCancel').addEventListener('click', closeModal);
  $('#modalOk').addEventListener('click', () => {
    const nv = parseFloat($('#vaultInput').value);
    if (isNaN(nv)) { toast('请输入有效数值', 'err'); return; }
    if (!Object.prototype.hasOwnProperty.call(Store.data.vault, key)) return;
    Store.data.vault[key] = round2(nv);
    Store.save();
    closeModal();
    renderVault();
    toast(`${info.name} 余额已更新`);
  });
  $('#vaultInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#modalOk').click(); });
});

/* =========================================================================
   应用名称（左上角可随时修改）
   ========================================================================= */
/** 把已保存（或指定的）名称应用到界面与页面标题 */
function applyAppName(name) {
  const n = (name || Store.data.appName || DEFAULT_APP_NAME).trim().slice(0, APP_NAME_MAX) || DEFAULT_APP_NAME;
  const el = $('#brandName');
  if (el) el.textContent = n;
  document.title = n;
}

/** 打开改名弹窗 */
function openRenameModal() {
  const cur = Store.data.appName || DEFAULT_APP_NAME;
  openModal(`
    <h3>${icon('pencil')}修改应用名称</h3>
    <p>给这个 App 起个只属于你的名字，会显示在左上角与浏览器标签页。</p>
    <div class="form-field">
      <input class="input" id="appNameInput" type="text" maxlength="${APP_NAME_MAX}"
        value="${escapeHtml(cur)}" placeholder="例如：鱼叉的专属app" />
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="modalCancel">取消</button>
      <button class="btn btn-primary" id="modalOk">保存</button>
    </div>
  `);
  const input = $('#appNameInput');
  input.focus();
  input.select();

  const save = () => {
    const v = input.value.trim();
    if (!v) { toast('名称不能为空', 'err'); input.focus(); return; }
    Store.data.appName = v.slice(0, APP_NAME_MAX);
    Store.save();
    applyAppName(Store.data.appName);
    closeModal();
    toast('应用名称已更新');
  };
  $('#modalCancel').addEventListener('click', closeModal);
  $('#modalOk').addEventListener('click', save);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
}

$('#brandName').addEventListener('click', openRenameModal);

/* =========================================================================
   添加功能（预留扩展位）
   ========================================================================= */
$('#addFuncBtn').addEventListener('click', () => {
  openModal(`
    <h3>${icon('sparkles')}添加功能</h3>
    <p>这里是为后续功能预留的扩展入口。可以把你想要的新模块告诉我，我来帮你加上。</p>
    <div class="modal-actions">
      <button class="btn btn-primary" id="modalOk">知道了</button>
    </div>
  `);
  $('#modalOk').addEventListener('click', closeModal);
});

/* ---------------------- 安全转义 ---------------------- */
function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* =========================================================================
   统一渲染 & 初始化
   ========================================================================= */
function renderLedger() {
  renderGauge();
  renderBillList(state.ledgerMonth);
}

$('#ledgerMonth').addEventListener('change', (e) => {
  state.ledgerMonth = e.target.value || monthStr();
  renderLedger();
});

function init() {
  Store.load();
  state.ledgerMonth = monthStr();
  state.statsDate = todayStr();

  $('#ledgerMonth').value = state.ledgerMonth;
  $('#statsDate').value = state.statsDate;

  // 应用自定义名称（左上角 + 页面标题）
  applyAppName();

  // 静态图标（侧边栏 / 标题等）
  refreshIcons(document.body);

  initEntryForms();
  initMonthlySummary();
  initShowsPage();
  initWordsPage();
  switchPage('ledger');
  renderLedger();
  refreshIcons(document.body);

  // 云同步（独立模块，SDK 缺失时静默跳过，App 仍以纯本地模式运行）
  if (typeof initCloudSync === 'function') initCloudSync();
}

document.addEventListener('DOMContentLoaded', init);
if (document.readyState !== 'loading') init();
