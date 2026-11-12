/* =========================================================================
   轻量端到端测试：用 jsdom 加载 index.html + app.js，模拟真实操作
   运行：node test/run-tests.js
   ========================================================================= */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
const failures = [];

function ok(cond, msg) {
  if (cond) { pass++; console.log('  \u2713 ' + msg); }
  else { fail++; failures.push(msg); console.log('  \u2717 ' + msg); }
}
function section(t) { console.log('\n=== ' + t + ' ==='); }

/* ---------- 构建 DOM 环境 ---------- */
// app.js 使用顶层 const，用 window.eval 声明不会挂到 window 上。
// 解决办法：把 app.js 包装成 IIFE，并把需要观测的内部对象显式挂到 window.__app。
function boot() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const dom = new JSDOM(html, {
    url: 'http://localhost/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const { window } = dom;

  const appJs = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const tvmazeJs = fs.readFileSync(path.join(ROOT, 'tvmaze.js'), 'utf8');
  const cloudJs = fs.readFileSync(path.join(ROOT, 'cloud.js'), 'utf8');
  // 环境桩：jsdom 无 fetch / AbortController。
  // 默认让 fetch 直接失败，模拟「网络不可用」，保证既有用例不受联网逻辑影响；
  // 需要联网的用例用 withFetch() 临时替换。
  window.fetch = function () {
    return Promise.reject(new Error('network disabled in tests'));
  };
  if (typeof window.AbortController === 'undefined') {
    window.AbortController = function () { this.signal = null; this.abort = function () {}; };
  }
  // app.js / tvmaze.js / cloud.js 合并进同一 IIFE（三者按名互相调用）
  // 测试将三个独立脚本拼进同一作用域；等全部模块声明后再触发初始化，
  // 避免 jsdom 已加载时 app.js 提前访问尚未初始化的 cloud.js 变量。
  const deferredAppJs = appJs.replace("if (document.readyState !== 'loading') init();", '');
  const instrumented =
    '(function(){\n' + deferredAppJs + '\n' + tvmazeJs + '\n' + cloudJs + '\n' +
    'window.__app = { Store, state, CATEGORIES, CATEGORY_ICON, CATEGORY_COLOR, ACCOUNTS, ' +
    'normalizeCategory, MEALS, MEAL_PARENT, normalizeMeal, mealForCategory, ' +
    'renderLedger, renderStats, renderVault, switchPage, todayStr, monthStr, ' +
    'renderMonthlySummary, monthTotals, monthCategoryTotals, addMonths, ' +
    'applyAppName, openRenameModal, DEFAULT_APP_NAME, DATA_VERSION, ' +
    'SHOW_STATUSES, SHOW_STATUS_META, SHOW_SORTS, SHOW_COVER_TYPES, ' +
    'normalizeShow, normalizeWatchLog, validateEpisode, filterShows, sortShows, groupShows, ' +
    'incEpisode, decEpisode, showProgressText, showProgressPercent, progressWarn, ' +
    'renderShows, renderShowsStats, renderShowsFilters, showCardHtml, showSectionHtml, ' +
    'coverImgHtml, coverPlaceholder, showProgressBarHtml, ' +
    'openAddShowModal, openEditShowModal, openShowDetail, openFinishModal, openDeleteShowModal, ' +
    'openProgressModal, initShowsPage, readShowForm, showFormHtml, ' +
    'COVER_DB_NAME, COVER_STORE, coverDbAvailable, coverSave, coverGet, coverDelete, ' +
    'coverGetURL, hydrateCovers, saveCoverFile, revokeCoverURL, ' +
    'coverTokens, coverUrlCache, coverPickerHtml, readCoverPicker, hydrateCoverPicker, ' +
    'stripHtml, tvmazeSearchShows, tvmazeGetSeasons, tvmazeSeasonToFields, applyTvmazeFields, ' +
    'tvmazeSeasonTitle, mapTvmazeShow, pickChineseAka, stripTradHalf, tvmazeGetChineseTitle, ' +
    'showSearchBlockHtml, renderTvmazeShows, setTvmazeStatus, ' +
    'CLOUD_PUBLIC_CONFIG, CLOUD_TABLE, ensureCloudClient, isCloudSignedIn, renderSyncEntry, ' +
    'renderCloudCard, openLoginModal, cloudPush, cloudPull, scheduleAutoPush, escapeHtml, ' +
    'WORD_MAX_LEN, MEANING_MAX_LEN, normalizeWord, normalizeWordCard, ' +
    'parseWordsInput, parseWordEntries, mergeWordIds, filterWordCards, ' +
    'sortWordCards, wordCardHtml, wordItemHtml, toggleWordMeaning, renderWords, ' +
    'renderEmptyWords, renderNoMatchWords, ' +
    'openAddWordCardModal, openEditWordCardModal, openWordCardModal, openDeleteWordCardModal, ' +
    'isMeaningMultiline, markWordMeaningLines, measureWordLines, scheduleWordLineRecalc, ' +
    'WORD_CARD_GAP, layoutWordCardSpans, ' +
    'deleteTx, vaultKeyOf, vaultKeyOfTx, VAULT_KEYS, ' +
    'initWordsPage };\n' +
    // coverPickerState 是被整体重新赋值的 let 变量，直接放进对象会快照化，
    // 因此用 getter 暴露实时值
    'Object.defineProperty(window.__app, "coverPickerState", { get: function(){ return coverPickerState; } });\n' +
    '})();';
  window.eval(instrumented);
  window.document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));
  return window;
}

/**
 * 在单个用例内临时替换 fetch，返回一个可解析的响应。
 * @param {object} w   boot() 返回的 window
 * @param {function} impl 接收 url，返回 {ok, status, body}
 */
function withFetch(w, impl) {
  w.fetch = function (url) {
    const r = impl(String(url));
    if (!r) return Promise.reject(new Error('no match'));
    if (r.reject) return Promise.reject(r.reject);
    return Promise.resolve({
      ok: r.ok !== false,
      status: r.status || 200,
      json: function () { return Promise.resolve(r.body); },
    });
  };
}

/* ---------- 工具 ---------- */
function click(w, el) {
  el.dispatchEvent(new w.Event('click', { bubbles: true }));
}
function submit(w, form) {
  form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
}
function setVal(w, el, v) {
  el.value = v;
  el.dispatchEvent(new w.Event('input', { bubbles: true }));
  el.dispatchEvent(new w.Event('change', { bubbles: true }));
}
/**
 * 把 style.css 内联注入 jsdom。
 * jsdom 默认不加载外链样式表，计算样式（getComputedStyle）读不到任何规则；
 * 需要验证「零位移结构契约」的用例先调它。
 */
function injectCss(w) {
  const s = w.document.createElement('style');
  s.textContent = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  w.document.head.appendChild(s);
  return s;
}
const money = (n) => '¥' + (Number(n) || 0).toFixed(2);
/** 取某个 jsdom 窗口里的应用内部 state（供测试直接改筛选条件） */
const state = (w) => w.__app.state;
const todayStr = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/* =========================================================================
   测试用例
   ========================================================================= */
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

/* ---------- 需求 1：环形图更大 ---------- */
test('需求1 环形仪表盘尺寸加大', (w) => {
  const wrap = w.document.querySelector('.gauge-wrap');
  const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  const m = css.match(/\.gauge-wrap\s*\{[^}]*width:\s*(\d+)px/);
  ok(!!m, '存在 .gauge-wrap 尺寸定义');
  const size = m ? parseInt(m[1], 10) : 0;
  ok(size >= 280, `环形图尺寸 >= 280px（当前 ${size}px）`);
  ok(!!wrap, '页面中存在环形仪表盘容器');
});

/* ---------- 需求 2：统计页专注分析（不再内嵌记账表单） ---------- */
test('需求2 统计页只做分析，入口统一到记账页', (w) => {
  // 切到统计页
  click(w, w.document.querySelector('.nav-item[data-page="stats"]'));
  const statsPage = w.document.querySelector('#page-stats');
  ok(!!statsPage.classList.contains('active'), '成功切换到统计页');

  // 统计页不应再内嵌记账表单，也不应有支出/收入页签
  ok(!statsPage.querySelector('form.entry-form'), '统计页已移除快捷记账表单');
  ok(statsPage.querySelectorAll('.tab').length === 0, '统计页已移除支出/收入切换页签');

  // 分析模块仍然完整
  ok(!!w.document.querySelector('#donutSvg'), '统计页保留分类占比环形图');
  ok(!statsPage.querySelector('#statsRank'), '统计页移除重复的分类支出排行');
  ok(!!w.document.querySelector('#statsTrend'), '统计页保留近 7 日收支趋势');
  ok(!statsPage.querySelector('.stats-grid'), '统计页趋势不再受双栏网格限制');
  ok(w.document.querySelector('#statsTrend').closest('.card'), '近 7 日趋势仍在独立卡片内');

  // 记账入口统一在记账页，且功能正常（跨页写库不漏）
  const ledgerForm = w.document.querySelector('#page-ledger form.entry-form');
  ok(!!ledgerForm, '记账页记账表单仍在');
  const before = w.eval('JSON.parse(localStorage.getItem("life_assistant_v1")).transactions.length');
  ledgerForm.querySelector('.f-amount').value = '9.5';
  submit(w, ledgerForm);
  const after = w.eval('JSON.parse(localStorage.getItem("life_assistant_v1")).transactions.length');
  ok(after === before + 1, '记账页提交后新增了一笔记录');
});

/* ---------- 需求 3：分类调整 ---------- */
test('需求3 分类拆分为 吃饭/奶茶/宵夜 + 宿舍', (w) => {
  const list = w.__app.CATEGORIES;
  ['吃饭', '奶茶', '宵夜', '宿舍'].forEach((c) => {
    ok(list.includes(c), `分类包含「${c}」`);
  });
  ok(!list.includes('餐饮'), '已移除旧的「餐饮」分类');

  // 下拉里确实有这些选项（两个页面各一个表单）
  const ledgerForm = w.document.querySelector('#page-ledger form.entry-form');
  const opts = Array.from(ledgerForm.querySelectorAll('select option')).map((o) => o.value);
  ['吃饭', '奶茶', '宵夜', '宿舍'].forEach((c) => {
    ok(opts.includes(c), `下拉框含「${c}」选项`);
  });

  // 四个新分类各有图标与颜色
  const icons = w.__app.CATEGORY_ICON;
  const colors = w.__app.CATEGORY_COLOR;
  ['吃饭', '奶茶', '宵夜', '宿舍'].forEach((c) => {
    ok(!!icons[c], `「${c}」有图标`);
    ok(!!colors[c], `「${c}」有颜色`);
  });

  // 历史「餐饮」数据归一化到「吃饭」
  ok(w.__app.normalizeCategory('餐饮') === '吃饭', '旧「餐饮」自动映射为「吃饭」');
});

/* ---------- 需求 3b：吃饭的餐次子选择（早餐/午饭/晚饭） ---------- */

/** 取记账页表单与餐次容器（多处复用） */
function mealDom(w) {
  const form = w.document.querySelector('#page-ledger form.entry-form');
  return { form, mp: form.querySelector('[data-meal-picker]'), mealInput: form.querySelector('.f-meal') };
}
/** 点某个主分类 */
function pickCat(w, name) {
  const btn = w.document.querySelector(`#page-ledger .cat-opt[data-cat="${name}"]`);
  click(w, btn);
  return btn;
}
/** 点某个餐次 */
function pickMeal(w, name) {
  const btn = w.document.querySelector(`#page-ledger .meal-opt[data-meal="${name}"]`);
  click(w, btn);
  return btn;
}

test('需求3b 餐次初始折叠（点「吃饭」才展开）', (w) => {
  const { mp } = mealDom(w);
  ok(!!mp, '餐次容器存在');
  ok(mp.style.display === 'none', '初始收起（即使「吃饭」默认选中）');
  const btns = Array.from(mp.querySelectorAll('.meal-opt'));
  ok(btns.length === 3, `三个餐次按钮（当前 ${btns.length}）`);
  ok(btns.map((b) => b.dataset.meal).join(',') === '早餐,午饭,晚饭', '顺序为 早餐/午饭/晚饭');
  ok(btns.every((b) => b.querySelector('.cat-opt-name').textContent === b.dataset.meal), '按钮文字与取值一致');
  ok(btns.every((b) => !b.classList.contains('selected')), '初始均未选中（可不选）');
  // 容器必须是网格的兄弟节点，不能嵌进 [data-cat-picker]，否则主循环会误选到餐次按钮
  ok(!w.document.querySelector('[data-cat-picker] [data-meal-picker]'), '餐次容器未嵌进分类网格内部');
});

test('需求3b 点「吃饭」展开、点其它分类收起并清空', (w) => {
  const { mp, mealInput } = mealDom(w);
  pickCat(w, '吃饭');
  ok(mp.style.display !== 'none', '点「吃饭」后展开');
  pickMeal(w, '午饭');
  ok(mealInput.value === '午饭', '已写入餐次');
  pickCat(w, '奶茶');
  ok(mp.style.display === 'none', '切到「奶茶」后收起');
  ok(mealInput.value === '', '收起时清空已选餐次');
  ok(Array.from(mp.querySelectorAll('.meal-opt')).every((b) => !b.classList.contains('selected')), '收起时取消高亮');
  pickCat(w, '吃饭');
  ok(mp.style.display !== 'none', '再点「吃饭」又能展开');
  pickCat(w, '吃饭');   // 复原默认态
});

test('需求3b 选餐次不污染分类值（隐藏 select 恒为「吃饭」）', (w) => {
  const { form, mealInput } = mealDom(w);
  pickCat(w, '吃饭');
  pickMeal(w, '午饭');
  ok(mealInput.value === '午饭', '餐次写入 .f-meal');
  ok(form.querySelector('.f-category').value === '吃饭', '隐藏 select 仍为「吃饭」');
  const lunch = w.document.querySelector('#page-ledger .meal-opt[data-meal="午饭"]');
  ok(lunch.classList.contains('selected'), '「午饭」进入选中态');
  ok(lunch.getAttribute('aria-pressed') === 'true', 'aria-pressed=true');
  pickMeal(w, '早餐');
  ok(!w.document.querySelector('#page-ledger .meal-opt[data-meal="午饭"]').classList.contains('selected'),
    '改点「早餐」后「午饭」取消选中');
  ok(w.document.querySelector('#page-ledger .meal-opt[data-meal="早餐"]').classList.contains('selected'), '「早餐」被选中');
  ok(mealInput.value === '早餐', '餐次值随之更新');
  pickMeal(w, '早餐');   // 再次点已选 = 取消
  ok(mealInput.value === '', '再次点同一餐次即取消（可不选）');
});

test('需求3b 提交写入 meal，category 仍为吃饭', (w) => {
  const { Store, todayStr } = w.__app;
  const { form } = mealDom(w);
  Store.data.transactions = [];
  Store.data.vault = { wechat_change: 0, wechat_lct: 0, alipay: 0, bank: 0 };
  pickCat(w, '吃饭');
  pickMeal(w, '午饭');
  form.querySelector('.f-amount').value = '18';
  submit(w, form);
  const txs = Store.data.transactions;
  ok(txs.length === 1, '记入一笔');
  ok(txs[0].category === '吃饭', 'category 仍为「吃饭」');
  ok(txs[0].meal === '午饭', 'meal 写入「午饭」');
  ok(txs[0].date === todayStr(), '日期正常');
});

test('需求3b 不选餐次也能提交（meal 为空串）', (w) => {
  const { Store } = w.__app;
  const { form } = mealDom(w);
  Store.data.transactions = [];
  pickCat(w, '吃饭');
  form.querySelector('.f-amount').value = '9';
  submit(w, form);
  ok(Store.data.transactions.length === 1, '照常记入一笔');
  ok(Store.data.transactions[0].category === '吃饭', 'category 为「吃饭」');
  ok(Store.data.transactions[0].meal === '', 'meal 为空串');
});

test('需求3b 切到其它分类后提交，meal 为空', (w) => {
  const { Store } = w.__app;
  const { form } = mealDom(w);
  Store.data.transactions = [];
  pickCat(w, '吃饭');
  pickMeal(w, '晚饭');
  pickCat(w, '奶茶');
  form.querySelector('.f-amount').value = '13';
  submit(w, form);
  const t = Store.data.transactions[0];
  ok(t.category === '奶茶', 'category 为「奶茶」');
  ok(t.meal === '', '非「吃饭」时 meal 归空');
  pickCat(w, '吃饭');
});

test('需求3b 提交后餐次归零但分类保留', (w) => {
  const { Store } = w.__app;
  const { form, mealInput, mp } = mealDom(w);
  Store.data.transactions = [];
  pickCat(w, '吃饭');
  pickMeal(w, '午饭');
  form.querySelector('.f-amount').value = '20';
  submit(w, form);
  ok(mealInput.value === '', '提交后餐次清空（每笔重新选）');
  ok(Array.from(mp.querySelectorAll('.meal-opt')).every((b) => !b.classList.contains('selected')), '提交后无餐次高亮');
  ok(form.querySelector('.f-category').value === '吃饭', '分类按既有行为保留「吃饭」');
});

test('需求3b 账单标题显示「吃饭 · 午饭」，收入与统计页不拼', (w) => {
  const { Store, todayStr } = w.__app;
  const ds = todayStr();
  Store.data.transactions = [];
  Store.data.vault = { wechat_change: 0, wechat_lct: 0, alipay: 0, bank: 0 };
  Store.addTransaction({ id: 'm1', type: 'expense', amount: 18, category: '吃饭', meal: '午饭', account: 'wechat', remark: '', date: ds, createdAt: 1 });
  Store.addTransaction({ id: 'm2', type: 'expense', amount: 7, category: '吃饭', account: 'wechat', remark: '', date: ds, createdAt: 2 }); // 旧记录无 meal
  Store.addTransaction({ id: 'm3', type: 'income', amount: 100, category: '', meal: '', account: 'bank', remark: '', date: ds, createdAt: 3 });

  // 记账页账单：应显示「吃饭 · 午饭」，无餐次的旧记录仍显示「吃饭」
  w.__app.switchPage('ledger');
  w.__app.renderLedger();
  const ledgerHtml = w.document.querySelector('#billList').innerHTML;
  ok(ledgerHtml.includes('吃饭 · 午饭'), '记账页显示「吃饭 · 午饭」');
  ok(ledgerHtml.includes('>吃饭<'), '无餐次的旧记录仍显示「吃饭」（不逐字节改变）');
  ok(!ledgerHtml.includes('收入 ·'), '收入行不拼餐次');
  ok(ledgerHtml.includes('>收入<'), '收入行标题为「收入」');

  // 统计页当日账单：保持原样，不出现分隔符
  w.__app.switchPage('stats');
  w.document.querySelector('#statsDate').value = ds;
  w.__app.renderStats();
  const statsHtml = w.document.querySelector('#statsBillList').innerHTML;
  ok(!statsHtml.includes('·'), '统计页当日账单不含餐次分隔符');
  ok(statsHtml.includes('>吃饭<'), '统计页当日账单仍显示「吃饭」');
});

test('需求3b sanitize 归一非法 meal', (w) => {
  const { Store } = w.__app;
  const ds = w.__app.todayStr();
  Store.data.transactions = [
    { id: 'a', type: 'expense', amount: 1, category: '吃饭', meal: 'brunch', account: 'wechat', remark: '', date: ds },
    { id: 'b', type: 'expense', amount: 2, category: '奶茶', meal: '午饭', account: 'wechat', remark: '', date: ds },
    { id: 'c', type: 'expense', amount: 3, category: '吃饭', meal: '晚饭', account: 'wechat', remark: '', date: ds },
    { id: 'd', type: 'income', amount: 4, category: '', meal: '午饭', account: 'bank', remark: '', date: ds },
    { id: 'e', type: 'expense', amount: 5, category: '吃饭', account: 'wechat', remark: '', date: ds },
  ];
  Store.sanitize();
  const byId = {};
  Store.data.transactions.forEach((t) => { byId[t.id] = t; });
  ok(byId.a.meal === '', '非法餐次「brunch」→ 空串');
  ok(byId.b.meal === '', '非「吃饭」分类的餐次 → 空串');
  ok(byId.c.meal === '晚饭', '合法餐次原样保留');
  ok(byId.d.meal === '', '收入记录餐次 → 空串');
  ok(byId.e.meal === '', '缺失 meal 补为空串');
});

test('需求3b 回归：餐次不改变分类统计', (w) => {
  const { Store } = w.__app;
  const ds = w.__app.todayStr();
  const ym = w.__app.monthStr();
  Store.data.transactions = [];
  Store.data.vault = { wechat_change: 0, wechat_lct: 0, alipay: 0, bank: 0 };
  // 两笔「吃饭」分别选了不同餐次，统计上必须仍并成一条「吃饭」
  Store.addTransaction({ id: 'r1', type: 'expense', amount: 20, category: '吃饭', meal: '早餐', account: 'wechat', remark: '', date: ds, createdAt: 1 });
  Store.addTransaction({ id: 'r2', type: 'expense', amount: 30, category: '吃饭', meal: '晚饭', account: 'wechat', remark: '', date: ds, createdAt: 2 });
  Store.addTransaction({ id: 'r3', type: 'expense', amount: 15, category: '奶茶', meal: '', account: 'wechat', remark: '', date: ds, createdAt: 3 });

  w.__app.switchPage('stats');
  w.document.querySelector('#statsDate').value = ds;
  w.__app.renderStats();
  const legend = w.document.querySelector('#statsLegend').innerHTML;
  ok((legend.match(/吃饭/g) || []).length === 1, '图例里「吃饭」只出现 1 次（未被餐次拆开）');
  ok(legend.includes('奶茶'), '图例含「奶茶」');
  ok(w.document.querySelector('#statsTotal').textContent === '¥65.00', '当日总支出 = 65.00');
  const segs = w.document.querySelectorAll('#donutSvg .donut-seg').length;
  ok(segs === 2, `环形图仍只有 2 个分类扇区（当前 ${segs}）`);

  const mc = w.__app.monthCategoryTotals(ym);
  const keys = Object.keys(mc.byCat).sort();
  ok(keys.length === 2 && keys.indexOf('吃饭') > -1 && keys.indexOf('奶茶') > -1,
    `byCat 只有「吃饭」「奶茶」两个键（当前 ${keys.join(',')}）`);
  ok(mc.byCat['吃饭'] === 50, '「吃饭」= 两笔之和 50（早+晚已合并）');
  ok(!('早餐' in mc.byCat) && !('晚饭' in mc.byCat), 'byCat 里没有餐次键');
});

/* ---------- 需求 4：账户顺序 ---------- */
test('需求4 账户顺序 微信→支付宝→银行，默认微信', (w) => {
  const segs = Array.from(w.document.querySelectorAll('#page-ledger .segs-account .seg'));
  const order = segs.map((s) => s.dataset.account);
  ok(JSON.stringify(order) === JSON.stringify(['wechat', 'alipay', 'bank']),
    `账户顺序为 wechat,alipay,bank（当前 ${order.join(',')}）`);
  ok(segs[0].classList.contains('active'), '默认选中第一个（微信）');

  // 账户常量顺序也调整
  const accts = Object.keys(w.__app.ACCOUNTS);
  ok(accts[0] === 'wechat' && accts[accts.length - 1] === 'bank',
    `ACCOUNTS 顺序微信在前银行在后（${accts.join(',')}）`);

  // 实际提交一笔，验证默认扣微信
  w.__app.Store.data.transactions = [];
  w.__app.Store.data.vault = { wechat_change: 0, wechat_lct: 0, alipay: 0, bank: 0 };
  const form = w.document.querySelector('#page-ledger form.entry-form');
  form.querySelector('.f-amount').value = '11';
  submit(w, form);
  const txs = w.__app.Store.data.transactions;
  ok(txs.length === 1 && txs[0].account === 'wechat', '默认记账扣款账户为微信');
  ok(w.__app.Store.data.vault.wechat_lct === -11, '微信默认从「零钱通」扣减（零钱通 -11）');
  ok(w.__app.Store.data.vault.wechat_change === 0, '「零钱」余额不受影响');
  ok(txs[0].vaultKey === 'wechat_lct', '账单记录了实际扣款池（vaultKey = wechat_lct）');
});

/* ---------- 需求 5：剩余日均可用额度 ---------- */
test('需求5 显示剩余日均可用额度', (w) => {
  const el = w.document.querySelector('#gaugeDaily');
  ok(!!el, '记账页存在「剩余日均可用」元素');

  const { Store, state } = w.__app;
  const m = w.__app.monthStr();
  const ds = w.__app.todayStr();
  Store.data.transactions = [];
  Store.setLimit(m, 1500);
  Store.addTransaction({ id: 't1', type: 'expense', amount: 300, category: '吃饭', account: 'wechat', remark: '', date: ds, createdAt: Date.now() });
  w.__app.switchPage('ledger');
  w.__app.renderLedger();

  const txt = el.textContent;
  ok(/¥\d/.test(txt), `日均可用显示为金额（当前「${txt}」）`);

  // 逻辑校验：日均 = 剩余 / 本月剩余天数（含当天）
  const d = new Date();
  const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const remainDays = daysInMonth - d.getDate() + 1;
  const expect = ((1500 - 300) / remainDays).toFixed(2);
  const got = (txt.match(/¥(-?[\d.]+)/) || [])[1];
  ok(got === expect, `日均金额计算正确（期望 ${expect}，实际 ${got}）`);

  // 超额后「日均额度」没有意义（旧版会算出 -¥xx），改为整行隐藏，超额金额由主数值行承担
  Store.data.transactions = [];
  Store.addTransaction({ id: 't2', type: 'expense', amount: 2000, category: '吃饭', account: 'wechat', remark: '', date: ds, createdAt: Date.now() });
  w.__app.renderLedger();
  const row = w.document.querySelector('#gaugeDailyRow');
  ok(row && row.style.display === 'none', '超额时日均行整行隐藏');
  ok(w.document.querySelector('#gaugeRemainLabel').textContent === '本月已超额',
    '超额时主数值行文案切为「本月已超额」');
  ok(w.document.querySelector('#gaugeRemain').textContent === '¥500.00',
    '主数值行只显示超额金额、不带负号');
  ok(w.document.querySelector('#gaugeState').textContent.includes('已超上限'),
    '徽章改为显示超出上限的比例');
});

/* ---------- 需求 5b：超额态文案与恢复正常态 ---------- */
test('需求5b 超额态文案与复原', (w) => {
  const { Store } = w.__app;
  const m = w.__app.monthStr();
  const ds = w.__app.todayStr();
  const q = (sel) => w.document.querySelector(sel);
  const dailyRow = () => q('#gaugeDailyRow');

  // 1) 未超额：上限 1500 / 支出 300
  Store.data.transactions = [];
  Store.setLimit(m, 1500);
  Store.addTransaction({ id: 'ov1', type: 'expense', amount: 300, category: '吃饭', account: 'wechat', remark: '', date: ds, createdAt: Date.now() });
  w.__app.switchPage('ledger');
  w.__app.renderLedger();
  ok(dailyRow().style.display === '', '未超额时日均行正常显示');
  ok(q('#gaugeRemainLabel').textContent === '本月剩余可支配', '未超额时标签为「本月剩余可支配」');
  ok(q('#gaugeRemain').textContent === '¥1200.00', '未超额时显示剩余金额 1200');
  ok(!q('#gaugeRemainRow').classList.contains('over'), '未超额时主数值行不带 over 类');
  ok(q('#ovRemainHead').textContent === '剩余预算', '顶部卡标题为「剩余预算」');
  ok(q('#gaugeState').textContent.includes('正常'), '徽章为「正常」');

  // 2) 超额：上限 1500 / 支出 2000 → 超 500，进度 133%（超上限 33%）
  Store.data.transactions = [];
  Store.addTransaction({ id: 'ov2', type: 'expense', amount: 2000, category: '吃饭', account: 'wechat', remark: '', date: ds, createdAt: Date.now() });
  w.__app.renderLedger();
  ok(dailyRow().style.display === 'none', '超额时日均行隐藏');
  ok(q('#gaugeRemainLabel').textContent === '本月已超额', '超额时标签切为「本月已超额」');
  ok(q('#gaugeRemain').textContent === '¥500.00', '超额金额 500 且不带负号');
  ok(q('#gaugeRemainRow').classList.contains('over'), '超额时主数值行带 over 类（标签转危险色）');
  ok(q('#gaugeState').textContent.includes('已超上限 33%'), '徽章显示「已超上限 33%」');
  ok(q('#gaugePct').textContent === '133%', '百分比保留 133%（不截断）');
  ok(q('#ovRemainHead').textContent === '超出预算', '顶部卡标题切为「超出预算」');
  ok(q('#ovRemain').textContent === '¥500.00', '顶部卡显示超额金额 500');
  ok(q('#ovRemainFoot').textContent === '已超上限 33%', '顶部卡脚注显示超出比例');

  // 3) 上限调到 2500（支出不变）→ 应恢复未超额态，验证隐藏可逆
  Store.setLimit(m, 2500);
  w.__app.renderLedger();
  ok(dailyRow().style.display === '', '上限调高后日均行重新显示');
  ok(q('#gaugeRemainLabel').textContent === '本月剩余可支配', '标签恢复「本月剩余可支配」');
  ok(q('#gaugeRemain').textContent === '¥500.00', '剩余金额为 500');
  ok(!q('#gaugeRemainRow').classList.contains('over'), 'over 类被摘除');
  ok(q('#ovRemainHead').textContent === '剩余预算', '顶部卡标题恢复「剩余预算」');
});

/* ---------- 需求 6：本地持久化 ---------- */
test('需求6 数据持久化到 localStorage', (w) => {
  const { Store } = w.__app;
  const ds = w.__app.todayStr();
  Store.data.transactions = [];
  Store.data.vault = { wechat_change: 0, wechat_lct: 0, alipay: 0, bank: 0 };
  Store.addTransaction({ id: 'persist1', type: 'expense', amount: 66, category: '奶茶', account: 'wechat', remark: '测试持久化', date: ds, createdAt: Date.now() });
  Store.adjustVault('wechat', -66);

  const raw = w.eval('localStorage.getItem("life_assistant_v1")');
  ok(!!raw && raw.includes('persist1'), '数据已写入 localStorage');

  // 重新 boot 一个全新 DOM，共享同一 localStorage 模拟"重开浏览器"
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const dom2 = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true });
  dom2.window.localStorage.setItem('life_assistant_v1', raw);
  const appJs = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  dom2.window.eval('(function(){' + appJs + 'window.__app={Store,state,monthStr,todayStr};})();');
  dom2.window.document.dispatchEvent(new dom2.window.Event('DOMContentLoaded', { bubbles: true }));
  const reloaded = JSON.stringify(dom2.window.__app.Store.data.transactions);
  ok(reloaded.includes('persist1'), '重新打开后数据仍存在（未丢失）');
  ok(dom2.window.__app.Store.data.vault.wechat_lct === -66, '金库余额也一并持久化（零钱通）');

  // 最近账单列表能渲染出该记录
  const listHtml = dom2.window.document.querySelector('#billList').innerHTML;
  ok(listHtml.includes('奶茶'), '重开后账单列表正确渲染');

  // 数据版本字段
  ok(dom2.window.__app.Store.data.version >= 2, '数据包含版本号（便于后续迁移）');

  // 旧版本数据（餐饮 + 旧 vault）自动迁移
  const legacy = JSON.stringify({
    transactions: [{ id: 'old1', type: 'expense', amount: 30, category: '餐饮', account: 'wechat', remark: '', date: ds, createdAt: 1 }],
    budgets: {}, vault: { bank: 0, alipay: 0, wechat: 128.5 },
  });
  const dom3 = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true });
  dom3.window.localStorage.setItem('life_assistant_v1', legacy);
  dom3.window.eval('(function(){' + fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8') + 'window.__app={Store};})();');
  dom3.window.document.dispatchEvent(new dom3.window.Event('DOMContentLoaded', { bubbles: true }));
  const migratedTx = dom3.window.__app.Store.data.transactions[0];
  const migratedVault = dom3.window.__app.Store.data.vault;
  ok(migratedTx.category === '吃饭', '旧「餐饮」数据迁移为「吃饭」');
  ok(migratedVault.wechat_change === 128.5, '旧 wechat 余额整体迁入「零钱」');
  ok(migratedVault.wechat_lct === 0, '「零钱通」初始为 0');
  ok(!('wechat' in migratedVault), '旧 wechat 键已被移除');
  ok(dom3.window.__app.Store.data.version === 6, '数据版本升级为 6');
  ok(Array.isArray(dom3.window.__app.Store.data.shows), '迁移后补齐 shows 数组');
  ok(Array.isArray(dom3.window.__app.Store.data.watchLogs), '迁移后补齐 watchLogs 数组');
  ok(Array.isArray(dom3.window.__app.Store.data.wordCards), '迁移后补齐 wordCards 数组');

  // 损坏数据（非法 JSON）不应导致崩溃，且会备份原始串
  const dom4 = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true });
  dom4.window.localStorage.setItem('life_assistant_v1', '{坏掉的JSON');
  let crashed = false;
  try {
    dom4.window.eval('(function(){' + fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8') + 'window.__app={Store};})();');
    dom4.window.document.dispatchEvent(new dom4.window.Event('DOMContentLoaded', { bubbles: true }));
  } catch (e) { crashed = true; }
  ok(!crashed, '损坏数据不会导致程序崩溃');
  ok(Array.isArray(dom4.window.__app.Store.data.transactions), '损坏数据后自动重置为可用结构');

  // 非法交易记录被过滤
  const dirty = JSON.stringify({
    version: 2,
    transactions: [
      { id: 'good', type: 'expense', amount: 10, category: '奶茶', account: 'wechat', date: ds, createdAt: 1 },
      { id: 'bad1', type: 'expense', amount: -5, category: '吃饭', account: 'wechat', date: ds },
      { id: 'bad2', type: 'xxx', amount: 10, category: '吃饭', account: 'wechat', date: ds },
      { id: 'bad3', type: 'expense', amount: 'NaN', category: '吃饭', account: 'wechat', date: ds },
    ],
    budgets: {}, vault: { wechat: 0 },
  });
  const dom5 = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true });
  dom5.window.localStorage.setItem('life_assistant_v1', dirty);
  dom5.window.eval('(function(){' + fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8') + 'window.__app={Store};})();');
  dom5.window.document.dispatchEvent(new dom5.window.Event('DOMContentLoaded', { bubbles: true }));
  ok(dom5.window.__app.Store.data.transactions.length === 1, '非法记录被过滤，仅保留有效记录');
  ok(!!dom5.window.__app.Store.data.vault.alipay === true ||
     dom5.window.__app.Store.data.vault.alipay === 0, '缺失账户被补全为 0');
});

/* ---------- 需求 7：微信拆分零钱 / 零钱通 ---------- */
test('需求7 金库微信拆分为零钱与零钱通', (w) => {
  const { Store } = w.__app;

  // 金库页渲染：微信卡片内含两个子板块
  w.__app.switchPage('vault');
  w.__app.renderVault();

  const splitCard = w.document.querySelector('.vault-card-split');
  ok(!!splitCard, '金库页存在「微信」拆分卡片');

  const subNames = Array.from(splitCard.querySelectorAll('.vault-sub-name')).map((e) => e.textContent);
  ok(subNames.length === 2, `微信卡片下有 2 个子板块（当前 ${subNames.length}）`);
  ok(subNames[0] === '零钱' && subNames[1] === '零钱通', `子板块为 零钱/零钱通（${subNames.join('/')}）`);

  // 两个子板块各有独立「改余额」按钮，指向不同金库键
  const subBtns = Array.from(splitCard.querySelectorAll('button[data-vault-act="set"]'));
  const keys = subBtns.map((b) => b.dataset.acc);
  ok(keys.includes('wechat_change') && keys.includes('wechat_lct'),
    `零钱/零钱通各自独立（${keys.join(',')}）`);

  // 余额独立：零钱 100 / 零钱通 500
  Store.data.vault = { wechat_change: 100, wechat_lct: 500, alipay: 0, bank: 0 };
  Store.save();
  w.__app.renderVault();
  const splitCard2 = w.document.querySelector('.vault-card-split');   // 重新查询（DOM 已重建）
  const amounts = Array.from(splitCard2.querySelectorAll('.vault-sub-amount')).map((e) => e.textContent);
  ok(amounts[0] === '¥100.00' && amounts[1] === '¥500.00',
    `两个子板块余额相互独立（${amounts.join(' / ')}）`);

  // 微信卡片头部显示合计 = 零钱 + 零钱通
  const headTotal = splitCard2.querySelector('.vault-total').textContent;
  ok(headTotal === '¥600.00', `微信卡片显示合计（${headTotal}）`);

  // 总资产 = 零钱 + 零钱通 + 支付宝 + 银行
  Store.data.vault = { wechat_change: 100, wechat_lct: 500, alipay: 200, bank: 300 };
  Store.save();
  ok(Store.totalAssets() === 1100, `总资产汇总正确（当前 ${Store.totalAssets()}）`);
  w.__app.renderVault();
  ok(w.document.querySelector('#totalAssets').textContent === '¥1100.00', '页面总资产显示正确');
});

test('需求7 记账扣款默认走零钱通且不影响零钱', (w) => {
  const { Store } = w.__app;
  Store.data.transactions = [];
  Store.data.vault = { wechat_change: 200, wechat_lct: 800, alipay: 0, bank: 0 };
  Store.save();

  w.__app.switchPage('ledger');
  const form = w.document.querySelector('#page-ledger form.entry-form');
  // 默认账户应为微信
  const activeAcc = form.querySelector('.segs-account .seg.active').dataset.account;
  ok(activeAcc === 'wechat', '记账表单默认付款账户为微信');

  form.querySelector('.f-amount').value = '50';
  submit(w, form);

  const v = Store.data.vault;
  ok(v.wechat_lct === 750, `扣款从「零钱通」扣减（800 → ${v.wechat_lct}）`);
  ok(v.wechat_change === 200, '「零钱」完全不受影响');

  // 收入默认入账：微信收入也进零钱通
  const card = form.closest('.card');
  const incomeTab = Array.from(card.querySelectorAll('.tab')).find((t) => t.dataset.type === 'income');
  click(w, incomeTab);
  const accSegs = Array.from(form.querySelectorAll('.segs-account .seg'));
  click(w, accSegs.find((s) => s.dataset.account === 'wechat'));
  form.querySelector('.f-amount').value = '30';
  submit(w, form);
  ok(Store.data.vault.wechat_lct === 780, `微信收入入「零钱通」（750 → ${Store.data.vault.wechat_lct}）`);
  ok(Store.data.vault.wechat_change === 200, '零钱依旧不受影响');
});

/* ---------- 需求 7b：历史账单回滚仍按当初的池 ---------- */
test('需求7b 历史微信账单回滚退零钱，新账单退零钱通', (w) => {
  const { Store } = w.__app;
  const ds = w.__app.todayStr();
  Store.data.transactions = [];
  Store.data.vault = { wechat_change: 1000, wechat_lct: 1000, alipay: 0, bank: 0 };

  // 1) 历史账单：没有 vaultKey 字段（改造前的记录），当初扣的是「零钱」
  const legacy = { id: 'legacy1', type: 'expense', amount: 100, category: '吃饭', account: 'wechat', remark: '', date: ds, createdAt: Date.now() };
  Store.addTransaction(legacy);
  Store.data.vault.wechat_change = 900;   // 还原当初从零钱扣的 100
  Store.data.vault.wechat_lct = 1000;
  w.__app.deleteTx('legacy1');
  ok(Store.data.vault.wechat_change === 1000, `旧账删除后金额退回「零钱」（当前 ${Store.data.vault.wechat_change}）`);
  ok(Store.data.vault.wechat_lct === 1000, '旧账删除不影响「零钱通」');

  // 2) 新账单：带 vaultKey = wechat_lct，删除后应退回零钱通
  const fresh = { id: 'fresh1', type: 'expense', amount: 100, category: '吃饭', account: 'wechat', vaultKey: 'wechat_lct', remark: '', date: ds, createdAt: Date.now() };
  Store.addTransaction(fresh);
  Store.data.vault.wechat_lct = 900;   // 模拟当初从零钱通扣了 100
  Store.data.vault.wechat_change = 1000;
  w.__app.deleteTx('fresh1');
  ok(Store.data.vault.wechat_lct === 1000, `新账删除后金额退回「零钱通」（当前 ${Store.data.vault.wechat_lct}）`);
  ok(Store.data.vault.wechat_change === 1000, '新账删除不影响「零钱」');

  // 3) 旧账改账户：原账户（零钱）加回，新账户按当前默认规则扣除
  Store.data.vault = { wechat_change: 900, wechat_lct: 1000, alipay: 0, bank: 0 };
  const legacy2 = { id: 'legacy2', type: 'expense', amount: 100, category: '吃饭', account: 'wechat', remark: '', date: ds, createdAt: Date.now() };
  Store.addTransaction(legacy2);
  ok(w.__app.vaultKeyOfTx(legacy2) === 'wechat_change', '无 vaultKey 的微信旧账按「零钱」回滚');
  ok(w.__app.vaultKeyOfTx({ account: 'wechat', vaultKey: 'wechat_lct' }) === 'wechat_lct', '带 vaultKey 的按记录值回滚');
  ok(w.__app.vaultKeyOfTx({ account: 'alipay' }) === 'alipay', '非微信账户回滚到同名金库键');
  ok(w.__app.vaultKeyOfTx({ account: 'wechat', vaultKey: '瞎写的键' }) === 'wechat_change', '非法 vaultKey 退回历史默认（零钱）');

  Store.data.transactions = [];
});

/* ---------- 需求 7c：非法 vaultKey 会被 sanitize 清理 ---------- */
test('需求7c 非法 vaultKey 在加载时被清理', (w) => {
  const { Store } = w.__app;
  const ds = w.__app.todayStr();
  Store.data.transactions = [
    { id: 'bad1', type: 'expense', amount: 10, category: '吃饭', account: 'wechat', vaultKey: '不存在的键', remark: '', date: ds, createdAt: Date.now() },
    { id: 'ok1', type: 'expense', amount: 10, category: '吃饭', account: 'wechat', vaultKey: 'wechat_lct', remark: '', date: ds, createdAt: Date.now() },
  ];
  Store.sanitize();
  const bad = Store.data.transactions.find((t) => t.id === 'bad1');
  const okTx = Store.data.transactions.find((t) => t.id === 'ok1');
  ok(!('vaultKey' in bad), '非法 vaultKey 被删除（回滚时走账户默认池）');
  ok(okTx.vaultKey === 'wechat_lct', '合法的 vaultKey 被保留');
});

/* ---------- 需求 8：账单明细可切换是否计入环形图 ---------- */
test('需求8 账单明细可切换是否计入环形图', (w) => {
  const { Store } = w.__app;
  const ds = w.__app.todayStr();
  const m = w.__app.monthStr();
  Store.data.transactions = [];
  Store.data.vault = { wechat_change: 0, wechat_lct: 0, alipay: 0, bank: 0 };
  Store.setLimit(m, 1000);

  // 两笔支出：100 + 200
  Store.addTransaction({ id: 'e1', type: 'expense', amount: 100, category: '吃饭', account: 'wechat', remark: '', date: ds, counted: true, createdAt: 1 });
  Store.addTransaction({ id: 'e2', type: 'expense', amount: 200, category: '奶茶', account: 'wechat', remark: '', date: ds, counted: true, createdAt: 2 });
  w.__app.switchPage('ledger');
  w.__app.renderLedger();

  // 初始：环形图已花 300，进度 30%
  ok(w.document.querySelector('#gaugeSpent').textContent === '¥300.00', '初始环形图已花 = 300');
  ok(w.document.querySelector('#gaugePct').textContent === '30%', '初始进度 = 30%');

  // 每笔支出都有切换按钮，且默认显示「已计入」
  const btns = Array.from(w.document.querySelectorAll('#billList button[data-act="toggle-count"]'));
  ok(btns.length === 2, `每笔支出都有计入开关（${btns.length} 个）`);
  ok(btns[0].textContent.includes('已计入'), '默认状态为「已计入」');

  // 点击第一笔（200 或 100，按渲染顺序）切换为不计入
  click(w, btns[0]);
  const excludedId = btns[0].closest('.bill-item').dataset.id;
  const excludedAmt = excludedId === 'e1' ? 100 : 200;
  const leftAmt = 300 - excludedAmt;

  ok(Store.data.transactions.find((t) => t.id === excludedId).counted === false, '该笔被标记为不计入');
  ok(w.document.querySelector('#gaugeSpent').textContent === money(leftAmt),
    `环形图已花减少为 ${leftAmt}`);
  ok(w.document.querySelector('#listSummary').innerHTML.includes('不计入'), '汇总区出现「不计入」金额');

  // 该行有视觉标记
  const row = w.document.querySelector(`#billList .bill-item[data-id="${excludedId}"]`);
  ok(row.classList.contains('excluded'), '不计入的行有淡化样式');
  ok(!!row.querySelector('.bill-flag'), '不计入的行有「不计入」标签');

  // 再点一次恢复计入
  const btnNow = row.querySelector('button[data-act="toggle-count"]');
  click(w, btnNow);
  ok(Store.data.transactions.find((t) => t.id === excludedId).counted === true, '再次点击恢复计入');
  ok(w.document.querySelector('#gaugeSpent').textContent === '¥300.00', '环形图恢复为 300');

  // 持久化：重新加载后不计入状态保留
  click(w, w.document.querySelector(`#billList .bill-item[data-id="e2"] button[data-act="toggle-count"]`));
  const raw = w.eval('localStorage.getItem("life_assistant_v1")');
  ok(JSON.parse(raw).transactions.find((t) => t.id === 'e2').counted === false, '不计入状态已持久化');
});

test('需求8 全部不计入时环形图为 0', (w) => {
  const { Store } = w.__app;
  const ds = w.__app.todayStr();
  const m = w.__app.monthStr();
  Store.data.transactions = [];
  Store.setLimit(m, 1000);
  Store.addTransaction({ id: 'x1', type: 'expense', amount: 500, category: '吃饭', account: 'wechat', remark: '', date: ds, counted: false, createdAt: 1 });
  Store.addTransaction({ id: 'x2', type: 'expense', amount: 300, category: '购物', account: 'wechat', remark: '', date: ds, counted: false, createdAt: 2 });
  w.__app.switchPage('ledger');
  w.__app.renderLedger();

  ok(w.document.querySelector('#gaugeSpent').textContent === '¥0.00', '全部不计入时已花为 0');
  ok(w.document.querySelector('#gaugePct').textContent === '0%', '进度为 0%');
  // 日均上限此时应等于 上限/剩余天数
  const daily = w.document.querySelector('#gaugeDaily').textContent;
  ok(/¥\d/.test(daily), `日均上限仍可正常显示（${daily}）`);

  // 但账单列表汇总里总支出仍是 800（只是不计入环形图）
  ok(w.document.querySelector('#listSummary').innerHTML.includes('¥800.00'), '总支出仍如实显示 800');
});

/* ---------- 回归：整体可用性 ---------- */
test('回归 核心链路正常', (w) => {
  click(w, w.document.querySelector('.nav-item[data-page="ledger"]'));
  const form = w.document.querySelector('#page-ledger form.entry-form');
  setVal(w, form.querySelector('input[type="number"]'), '25');
  setVal(w, form.querySelector('input[type="text"]'), '午饭');
  submit(w, form);
  const html = w.document.querySelector('#billList').innerHTML;
  ok(html.includes('25.00'), '记账后账单列表出现该笔金额');

  // 改账户
  const btn = w.document.querySelector('#billList button[data-act="account"]');
  ok(!!btn, '支出记录带「改账户」按钮');
  if (btn) {
    click(w, btn);
    const segs = w.document.querySelectorAll('#modalSegs .seg');
    ok(segs.length >= 3, '改账户弹窗列出账户');
    click(w, Array.from(segs).find((s) => s.dataset.acc === 'bank'));
    click(w, w.document.querySelector('#modalOk'));
    const vault = w.__app.Store.data.vault;
    ok(typeof vault.bank === 'number', '改账户后金库已更新');
  }

  // 统计页渲染
  click(w, w.document.querySelector('.nav-item[data-page="stats"]'));
  ok(w.document.querySelector('#donutSvg').innerHTML.length > 0, '统计页环形图已渲染');

  // 金库页
  click(w, w.document.querySelector('.nav-item[data-page="vault"]'));
  ok(w.document.querySelectorAll('.vault-card').length === 3, '金库页展示 3 个账户（微信/支付宝/银行）');
  const names = Array.from(w.document.querySelectorAll('.vault-name')).map((e) => e.textContent);
  ok(names[0] === '微信' && names[2] === '银行', `金库账户顺序为 微信…银行（${names.join('>')}）`);
});

test('回归 改账户金额联动正确', (w) => {
  const { Store } = w.__app;
  const ds = w.__app.todayStr();
  Store.data.transactions = [];
  Store.data.vault = { wechat_change: 0, wechat_lct: 0, alipay: 100, bank: 50 };
  Store.addTransaction({ id: 'c1', type: 'expense', amount: 40, category: '奶茶', account: 'wechat', remark: '', date: ds, createdAt: Date.now() });
  Store.adjustVault('wechat', -40);   // 微信 -40
  w.__app.switchPage('ledger');
  w.__app.renderLedger();

  // 模拟改账户：微信 → 支付宝（原账户加回，新账户扣除）
  const tx = Store.data.transactions[0];
  Store.adjustVault(tx.account, tx.amount);
  Store.adjustVault('alipay', -tx.amount);
  tx.account = 'alipay';
  Store.save();
  ok(Store.data.vault.wechat_lct === 0, '原账户（微信零钱通）金额已加回至 0');
  ok(Store.data.vault.alipay === 60, '新账户（支付宝）扣除 40 后为 60');
  ok(Store.data.vault.bank === 50, '无关账户（银行）不受影响');
  ok(Store.data.vault.wechat_change === 0, '「零钱」在改账户过程中不受影响');
});

test('回归 收入不影响记账环只入金库', (w) => {
  const { Store, state } = w.__app;
  const ds = w.__app.todayStr();
  Store.data.transactions = [];
  Store.data.vault = { wechat_change: 0, wechat_lct: 0, alipay: 0, bank: 0 };
  w.__app.switchPage('ledger');
  const form = w.document.querySelector('#page-ledger form.entry-form');
  // 切到收入（.tab 是表单的兄弟节点，位于同一张卡片内）
  const card = form.closest('.card');
  const incomeTab = Array.from(card.querySelectorAll('.tab')).find((t) => t.dataset.type === 'income');
  ok(!!incomeTab, '存在收入页签');
  click(w, incomeTab);
  form.querySelector('.f-amount').value = '500';
  submit(w, form);

  const spent = Store.getTransactions(w.__app.monthStr())
    .filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  ok(spent === 0, '收入不计入本月支出（记账环不受影响）');
  const total = Store.totalAssets();
  ok(total === 500, `收入 500 使总资产增加（当前 ${total}）`);
});

test('回归 分类统计与图例', (w) => {
  const { Store } = w.__app;
  const ds = w.__app.todayStr();
  Store.data.transactions = [];
  Store.data.vault = { wechat_change: 0, wechat_lct: 0, alipay: 0, bank: 0 };
  [
    ['吃饭', 20], ['奶茶', 15], ['宵夜', 10], ['宿舍', 5], ['交通', 8],
  ].forEach(([c, a], i) => {
    Store.addTransaction({ id: 's' + i, type: 'expense', amount: a, category: c, account: 'wechat', remark: '', date: ds, createdAt: i });
  });
  w.__app.switchPage('stats');
  w.document.querySelector('#statsDate').value = ds;
  w.__app.renderStats();

  const legend = w.document.querySelector('#statsLegend').innerHTML;
  ['吃饭', '奶茶', '宵夜', '宿舍', '交通'].forEach((c) => {
    ok(legend.includes(c), `统计图例含「${c}」`);
  });
  ok(w.document.querySelector('#statsTotal').textContent === '¥58.00', '当日总支出 = 58.00');
  const segs = w.document.querySelectorAll('#donutSvg .donut-seg').length;
  ok(segs === 5, `环形图渲染 5 个分类扇区（当前 ${segs}）`);
});

test('回归 月度上限与日均联动', (w) => {
  const { Store } = w.__app;
  const m = w.__app.monthStr();
  const ds = w.__app.todayStr();
  Store.data.transactions = [];
  Store.setLimit(m, 3000);
  ok(Store.getLimit(m) === 3000, '月度上限可修改为 3000');

  // 记一笔后日均下降
  w.__app.switchPage('ledger');
  const before = w.document.querySelector('#gaugeDaily').textContent;
  Store.addTransaction({ id: 'd1', type: 'expense', amount: 500, category: '吃饭', account: 'wechat', remark: '', date: ds, createdAt: Date.now() });
  Store.adjustVault('wechat', -500);
  w.__app.renderLedger();
  const after = w.document.querySelector('#gaugeDaily').textContent;
  ok(before !== after, `支出后日均上限发生变化（${before} → ${after}）`);

  // 上限为 0 时不崩溃
  Store.setLimit(m, 0);
  w.__app.renderLedger();
  ok(true, '上限为 0 时渲染不崩溃');
});

test('连续补账保留日期并可回到今天', (w) => {
  const { Store, state } = w.__app;
  const RealDate = w.Date;
  let now = new RealDate(2026, 4, 1, 12).getTime();
  w.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  };
  w.document.dispatchEvent(new w.Event('visibilitychange'));
  const form = w.document.querySelector('#page-ledger .entry-form');
  const date = form.querySelector('.f-date');
  const amount = form.querySelector('.f-amount');
  const hint = form.querySelector('[data-entry-date-hint]');
  Store.data.transactions = [];
  setVal(w, date, '2026-04-30');
  ok(hint.textContent.includes('昨天'), '历史日期显示昨天提示');
  amount.value = '10'; submit(w, form);
  amount.value = '20'; submit(w, form);
  ok(Store.data.transactions.length === 2 && Store.data.transactions.every((t) => t.date === '2026-04-30'), '连续两笔使用同一历史日期');
  ok(date.value === '2026-04-30' && state.ledgerMonth === '2026-04', '跨月补账保留日期并切换账单月份');
  click(w, w.document.querySelector('#page-ledger .tab[data-type="income"]'));
  amount.value = '5'; submit(w, form);
  ok(Store.data.transactions[2].date === '2026-04-30' && Store.data.transactions[2].type === 'income', '收入也保留补账日期');
  now = new RealDate(2026, 4, 2, 1).getTime();
  w.document.dispatchEvent(new w.Event('visibilitychange'));
  ok(date.value === '2026-04-30' && hint.textContent.includes('2026-04-30'), '跨午夜后手选历史日期保持不变');
  click(w, form.querySelector('[data-entry-today]'));
  ok(date.value === '2026-05-02' && hint.hidden, '回到今天并隐藏历史日期提示');
  now = new RealDate(2026, 4, 3, 1).getTime();
  w.document.dispatchEvent(new w.Event('visibilitychange'));
  ok(date.value === '2026-05-03', '默认今天在跨日后更新');
  setVal(w, date, ''); amount.value = '1'; submit(w, form);
  ok(Store.data.transactions[3].date === '2026-05-03', '空日期提交时使用今天');
  w.Date = RealDate;
});

test('账单搜索：跨月份、分类和范围', (w) => {
  const { Store, state } = w.__app;
  Store.data.transactions = [
    { id: 's1', type: 'expense', amount: 30, category: '购物', account: 'wechat', remark: '蓝牙耳机', date: '2026-04-02', createdAt: 1 },
    { id: 's2', type: 'expense', amount: 15, category: '娱乐', account: 'wechat', remark: '耳机', date: '2026-05-02', createdAt: 2 },
    { id: 's3', type: 'income', amount: 50, category: '', account: 'bank', remark: '耳机退款', date: '2026-03-02', createdAt: 3 },
    { id: 's4', type: 'expense', amount: 8, category: '餐饮', account: 'wechat', remark: '', date: '2026-04-03', createdAt: 4 },
  ];
  state.ledgerMonth = '2026-04';
  w.__app.renderLedger();
  ok(w.document.querySelectorAll('#billList .bill-item').length === 2, '未筛选时仍显示所选月份');
  setVal(w, w.document.querySelector('#billSearch'), '耳机');
  let items = w.document.querySelectorAll('#billList .bill-item');
  ok(items.length === 3 && items[0].dataset.id === 's2' && items[2].dataset.id === 's3', '默认跨月搜索备注，包含收入并按日期排序');
  ok(w.document.querySelector('#listSummary').textContent.includes('筛选结果') && w.document.querySelector('#listSummary').textContent.includes('¥45.00'), '汇总标明筛选结果且金额正确');
  setVal(w, w.document.querySelector('#billCategoryFilter'), '购物');
  ok(w.document.querySelectorAll('#billList .bill-item').length === 1 && w.document.querySelector('#billList .bill-item').dataset.id === 's1', '关键词与分类叠加');
  setVal(w, w.document.querySelector('#billCategoryFilter'), '');
  setVal(w, w.document.querySelector('#billSearchScope'), 'month');
  ok(w.document.querySelectorAll('#billList .bill-item').length === 1, '可限制搜索到所选月份');
  setVal(w, w.document.querySelector('#billSearch'), '没有此项');
  ok(w.document.querySelector('#billList').textContent.includes('没有找到'), '无结果显示提示');
  setVal(w, w.document.querySelector('#billSearch'), '');
  setVal(w, w.document.querySelector('#billCategoryFilter'), '吃饭');
  ok(w.document.querySelector('#billList .bill-item').dataset.id === 's4', '历史餐饮分类归入吃饭');
  setVal(w, w.document.querySelector('#billCategoryFilter'), '');
  ok(w.document.querySelectorAll('#billList .bill-item').length === 2, '清除条件恢复月度账单');
});

test('账单编辑：余额、跨月和保存失败', (w) => {
  const { Store, state } = w.__app;
  Store.data.vault = { wechat_change: 100, wechat_lct: 50, alipay: 100, bank: 100 };
  Store.data.transactions = [
    { id: 'edit-old', type: 'expense', amount: 20, category: '吃饭', meal: '午饭', account: 'wechat', remark: '午餐', date: '2026-04-01', counted: false, createdAt: 10 },
    { id: 'edit-income', type: 'income', amount: 30, category: '', account: 'bank', remark: '', date: '2026-04-02', createdAt: 11 },
  ];
  state.ledgerMonth = '2026-04';
  w.__app.renderLedger();
  const edit = (id) => click(w, w.document.querySelector(`[data-id="${id}"] [data-act="edit"]`));
  edit('edit-old');
  ok(w.document.querySelector('#editTxMeal').value === '午饭', '编辑表单回填餐次');
  w.document.querySelector('#editTxRemark').value = '修改备注';
  click(w, w.document.querySelector('#modalOk'));
  ok(Store.data.vault.wechat_change === 100 && Store.data.vault.wechat_lct === 50, '仅修改备注不改变历史微信余额');
  ok(Store.data.transactions[0].counted === false && Store.data.transactions[0].createdAt === 10 && !('vaultKey' in Store.data.transactions[0]), '保留计入状态、时间和历史账户');
  edit('edit-old');
  w.document.querySelector('#editTxAmount').value = '25';
  click(w, w.document.querySelector('#modalOk'));
  ok(Store.data.vault.wechat_change === 95 && Store.data.vault.wechat_lct === 50, '历史微信账单修改金额仍使用零钱账户');
  edit('edit-old');
  w.document.querySelector('#editTxAmount').value = '35';
  w.document.querySelector('#editTxAccount').value = 'alipay';
  w.document.querySelector('#editTxDate').value = '2026-05-02';
  click(w, w.document.querySelector('#modalOk'));
  ok(Store.data.vault.wechat_change === 120 && Store.data.vault.alipay === 65, '支出变更时回滚原账户并扣除新账户');
  ok(state.ledgerMonth === '2026-05' && Store.data.transactions[0].vaultKey === 'alipay', '跨月后跳转并保存新账户');
  state.ledgerMonth = '2026-04'; w.__app.renderLedger();
  edit('edit-income');
  w.document.querySelector('#editTxAmount').value = '40';
  w.document.querySelector('#editTxAccount').value = 'wechat';
  click(w, w.document.querySelector('#modalOk'));
  ok(Store.data.vault.bank === 70 && Store.data.vault.wechat_lct === 90, '收入变更时回滚原入账并存入新账户');
  edit('edit-income');
  const before = JSON.stringify(Store.data);
  w.document.querySelector('#editTxAmount').value = '88';
  const oldSet = w.Storage.prototype.setItem;
  w.Storage.prototype.setItem = function () { throw new Error('test failure'); };
  click(w, w.document.querySelector('#modalOk'));
  w.Storage.prototype.setItem = oldSet;
  ok(JSON.stringify(Store.data) === before && w.document.querySelector('#editTxAmount'), '保存失败保留原数据和编辑表单');
  click(w, w.document.querySelector('#modalCancel'));
  ok(JSON.stringify(Store.data) === before, '取消编辑不改变数据');
});

/* ---------- 需求 9：月度总结 ---------- */
test('需求9 月度总结：12月网格 + 明细 + 环比 + 全年对比', (w) => {
  const { Store, state } = w.__app;

  // boot 每次都是空 store，自行注入数据
  Store.data.transactions = [];
  const add = (id, amount, category, date, counted) => Store.addTransaction({
    id, type: 'expense', amount, category, account: 'wechat', remark: '',
    date, counted: counted !== false, createdAt: Date.now(),
  });
  // 3 月：吃饭 100 + 奶茶 50 = 150
  add('m3a', 100, '吃饭', '2026-03-05');
  add('m3b', 50, '奶茶', '2026-03-08');
  // 4 月：吃饭 200 + 奶茶 50 + 交通 30 = 280
  add('m4a', 200, '吃饭', '2026-04-02');
  add('m4b', 50, '奶茶', '2026-04-03');
  add('m4c', 30, '交通', '2026-04-04');

  w.__app.switchPage('stats');
  state.summaryYear = 2026;
  state.summaryMonth = '2026-04';
  w.__app.renderMonthlySummary();

  // --- 12 个按钮，2 行 × 6 列 ---
  const grid = w.document.querySelector('#msumGrid');
  const btns = grid.querySelectorAll('.month-btn');
  ok(btns.length === 12, `月份网格渲染 12 个按钮（当前 ${btns.length}）`);
  const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  ok(/\.month-grid\s*\{[^}]*grid-template-columns:\s*repeat\(6,/.test(css), 'CSS 定义 6 列网格（2 行 × 6）');

  // --- 选中月高亮 ---
  const activeBtn = grid.querySelector('.month-btn.active');
  ok(!!activeBtn && activeBtn.dataset.month === '2026-04', '选中月按钮高亮为 2026-04');

  // --- 详情面板：分类合计正确（全部支出） ---
  const panel = w.document.querySelector('#msumPanel');
  ok(!panel.hidden, '详情面板已展开');
  ok(panel.textContent.includes('¥280.00'), '4 月合计显示 ¥280.00');
  const rows = Array.from(panel.querySelectorAll('.msum-row'));
  ok(rows.length > 0, '月度总结保留分类支出排行');
  const eatRow = rows.find((li) => li.querySelector('.rank-name').textContent.includes('吃饭'));
  ok(!!eatRow && eatRow.querySelector('.rank-amt').textContent === '¥200.00', '吃饭行 = ¥200.00');
  ok(rows.length === 3, `明细列出 3 个分类（当前 ${rows.length}）`);

  // --- 环比：吃饭 200 vs 上月 100 → +100 (+100.0%) ---
  const eatDelta = eatRow.querySelector('.msum-delta').textContent.replace(/\s+/g, '');
  ok(eatDelta.includes('+') && eatDelta.includes('100.0%'), `吃饭环比 +100.0%（当前「${eatDelta}」）`);
  // 交通上月无数据 → 新增
  const transRow = rows.find((li) => li.querySelector('.rank-name').textContent.includes('交通'));
  ok(transRow.querySelector('.msum-delta').textContent.includes('新增'), '交通（上月无）显示「新增」');

  // --- 12 个月对比图 ---
  const colsBar = w.document.querySelectorAll('#msumChart .msum-col');
  ok(colsBar.length === 12, `对比图渲染 12 列（当前 ${colsBar.length}）`);
  const aprCol = Array.from(colsBar).find((c) => c.dataset.month === '2026-04');
  ok(!!aprCol && aprCol.classList.contains('active'), '对比图高亮选中月');

  // --- 统计口径：全部支出（含 counted:false）---
  add('m4d', 70, '购物', '2026-04-05', false); // 不计入环形图
  w.__app.renderMonthlySummary();
  const panelText2 = w.document.querySelector('#msumPanel').textContent;
  ok(panelText2.includes('¥350.00'), '含不计入的支出后 4 月合计 = ¥350.00（口径为全部支出）');
});

test('月度总结按分类查看账单', (w) => {
  const { Store, state } = w.__app;
  Store.data.transactions = [
    { id: 'shop1', type: 'expense', amount: 30, category: '购物', account: 'wechat', remark: '买书', date: '2026-04-03', createdAt: 1 },
    { id: 'shop2', type: 'expense', amount: 20, category: '购物', account: 'bank', remark: '', date: '2026-04-10', counted: false, createdAt: 2 },
    { id: 'old', type: 'expense', amount: 12, category: '餐饮', account: 'wechat', remark: '午餐', date: '2026-04-04', createdAt: 3 },
    { id: 'othermonth', type: 'expense', amount: 99, category: '购物', account: 'wechat', date: '2026-05-01', createdAt: 4 },
    { id: 'income', type: 'income', amount: 999, category: '购物', account: 'wechat', date: '2026-04-05', createdAt: 5 },
  ];
  w.__app.switchPage('stats');
  state.summaryYear = 2026;
  state.summaryMonth = '2026-04';
  w.__app.renderMonthlySummary();
  const button = (cat) => w.document.querySelector(`[data-summary-category="${cat}"]`);
  click(w, button('购物'));
  let details = w.document.querySelector('#msumCategoryBills');
  let bills = details.querySelectorAll('.bill-item');
  ok(button('购物').getAttribute('aria-expanded') === 'true', '分类按钮显示展开状态');
  ok(bills.length === 2 && details.textContent.includes('¥50.00') && details.textContent.includes('2 笔'), '仅显示当月购物支出及合计');
  ok(bills[0].dataset.id === 'shop2' && bills[1].dataset.id === 'shop1', '账单按日期从近到远排列');
  ok(details.textContent.includes('买书') && details.textContent.includes('不计入'), '显示备注与不计入标记');
  ok(!bills[0].querySelector('.bill-remark') && !details.querySelector('.bill-actions'), '无备注正常显示且明细不可修改');
  click(w, button('吃饭'));
  details = w.document.querySelector('#msumCategoryBills');
  ok(details.querySelectorAll('.bill-item').length === 1 && details.textContent.includes('午餐'), '切换分类并将历史餐饮归入吃饭');
  click(w, button('吃饭'));
  ok(w.document.querySelector('#msumCategoryBills').hidden, '再次点击收起明细');
  click(w, button('购物'));
  click(w, w.document.querySelector('#msumGrid [data-month="2026-05"]'));
  ok(state.summaryCategory === null && w.document.querySelector('#msumCategoryBills').hidden, '切换月份收起明细');
  click(w, button('购物'));
  click(w, w.document.querySelector('#msumNextYear'));
  ok(state.summaryCategory === null && w.document.querySelector('#msumPanel').textContent.includes('暂无支出'), '切换年份收起明细并显示空月份');
});

test('月度环比只在月份结束后显示', (w) => {
  const { Store, state } = w.__app;
  const RealDate = w.Date;
  let now = new RealDate(2026, 11, 31, 23, 59, 0).getTime();
  w.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  };
  w.document.dispatchEvent(new w.Event('visibilitychange'));
  Store.data.transactions = [
    { id: 'nov', type: 'expense', amount: 20, category: '购物', account: 'wechat', date: '2026-11-10', createdAt: 1 },
    { id: 'dec', type: 'expense', amount: 30, category: '购物', account: 'wechat', date: '2026-12-10', createdAt: 2 },
    { id: 'new', type: 'expense', amount: 5, category: '娱乐', account: 'wechat', date: '2026-12-11', createdAt: 3 },
  ];
  w.__app.switchPage('stats');
  state.summaryYear = 2026;
  state.summaryMonth = '2026-12';
  w.__app.renderMonthlySummary();
  const panel = () => w.document.querySelector('#msumPanel');
  ok(panel().textContent.includes('月结束后显示环比') && !panel().querySelector('.msum-delta'), '月末当天隐藏总额及分类环比');
  click(w, w.document.querySelector('[data-summary-category="购物"]'));
  ok(panel().textContent.includes('¥30.00') && panel().querySelectorAll('.bill-item').length === 1, '未结束月份保留金额与分类账单');
  now = new RealDate(2027, 0, 1, 0, 0, 0).getTime();
  w.document.dispatchEvent(new w.Event('visibilitychange'));
  ok(panel().textContent.includes('对比 2026-11') && panel().textContent.includes('50.0%'), '跨年后返回页面自动显示上一月环比');
  ok(panel().textContent.includes('新增') && panel().querySelectorAll('.bill-item').length === 1, '新增分类显示环比且展开状态保留');
  state.summaryYear = 2027;
  state.summaryMonth = '2027-01';
  w.__app.renderMonthlySummary();
  ok(panel().textContent.includes('暂无支出') && panel().textContent.includes('月结束后显示环比'), '空的当月提示月结束后显示');
  state.summaryMonth = '2027-02';
  w.__app.renderMonthlySummary();
  ok(!panel().querySelector('.msum-delta'), '未来月份不显示环比');
  w.Date = RealDate;
});

test('需求9 月份算术跨年正确', (w) => {
  const { addMonths } = w.__app;
  ok(addMonths('2026-01', -1) === '2025-12', '2026-01 上月 = 2025-12');
  ok(addMonths('2026-12', 1) === '2027-01', '2026-12 下月 = 2027-01');
  ok(addMonths('2026-06', 0) === '2026-06', '加减 0 个月不变');
  ok(addMonths('2026-03', -14) === '2025-01', '跨多个月/年正确（2026-03 −14 → 2025-01）');
});

test('需求9 年度切换与空数据兜底', (w) => {
  const { Store, state } = w.__app;
  Store.data.transactions = [];
  Store.addTransaction({
    id: 'y25', type: 'expense', amount: 88, category: '吃饭', account: 'wechat',
    remark: '', date: '2025-07-10', counted: true, createdAt: Date.now(),
  });
  w.__app.switchPage('stats');

  state.summaryYear = 2025;
  state.summaryMonth = '2025-07';
  w.__app.renderMonthlySummary();
  ok(w.document.querySelector('#msumYear').textContent === '2025', '年份标题显示 2025');
  ok(w.document.querySelector('#msumPanel').textContent.includes('¥88.00'), '2025-07 明细 = ¥88.00');

  // 点击「上一年」箭头 → 2024（无数据）
  click(w, w.document.querySelector('#msumPrevYear'));
  ok(state.summaryYear === 2024, '点击上一年箭头 → 2024');
  ok(w.document.querySelector('#msumYear').textContent === '2024', '标题更新为 2024');
  ok(w.document.querySelectorAll('#msumGrid .month-btn.empty').length === 12, '空年份 12 个按钮均为空态');
  ok(w.document.querySelector('#msumPanel').textContent.includes('暂无支出'), '空年份详情面板显示空态');

  // 点两次「下一年」回到 2026
  click(w, w.document.querySelector('#msumNextYear'));
  click(w, w.document.querySelector('#msumNextYear'));
  ok(state.summaryYear === 2026, '点击下一年箭头回到 2026');
});

test('需求9 点击月份按钮切换明细', (w) => {
  const { Store, state } = w.__app;
  Store.data.transactions = [];
  Store.addTransaction({
    id: 'may', type: 'expense', amount: 123, category: '娱乐', account: 'wechat',
    remark: '', date: '2026-05-20', counted: true, createdAt: Date.now(),
  });
  w.__app.switchPage('stats');
  state.summaryYear = 2026;
  state.summaryMonth = '2026-01';
  w.__app.renderMonthlySummary();

  const mayBtn = w.document.querySelector('#msumGrid .month-btn[data-month="2026-05"]');
  ok(!!mayBtn, '存在 2026-05 月按钮');
  click(w, mayBtn);
  ok(state.summaryMonth === '2026-05', '点击后选中月变为 2026-05');
  ok(w.document.querySelector('#msumPanel').textContent.includes('¥123.00'), '明细切到 5 月 = ¥123.00');
  // 重新查询（innerHTML 重建后原引用已失效）
  const mayBtn2 = w.document.querySelector('#msumGrid .month-btn[data-month="2026-05"]');
  ok(mayBtn2.classList.contains('active'), '5 月按钮变为高亮');

  // 点击对比图列同样可切换
  const janCol = w.document.querySelector('#msumChart .msum-col[data-month="2026-01"]');
  click(w, janCol);
  ok(state.summaryMonth === '2026-01', '点击对比图列也能切换月份');
});

/* ---------- 需求 10：应用名称可随时修改 ---------- */
test('需求10 左上角应用名称可修改并持久化', (w) => {
  const { Store } = w.__app;

  // 默认名称
  const brand = w.document.querySelector('#brandName');
  ok(!!brand, '左上角品牌名元素存在');
  ok(brand.textContent === w.__app.DEFAULT_APP_NAME, `默认名称为「${w.__app.DEFAULT_APP_NAME}」`);
  ok(w.document.title === w.__app.DEFAULT_APP_NAME, '页面标题与名称一致');

  // 点击品牌名 → 弹出改名弹窗
  click(w, brand);
  const input = w.document.querySelector('#appNameInput');
  ok(!!input, '点击品牌名后弹出改名输入框');

  // 输入新名并保存
  setVal(w, input, '我的小账本');
  click(w, w.document.querySelector('#modalOk'));
  ok(Store.data.appName === '我的小账本', 'Store.data.appName 已更新');
  ok(brand.textContent === '我的小账本', '左上角文案已更新');
  ok(w.document.title === '我的小账本', '页面标题已同步');

  // 持久化：写入 localStorage
  const saved = JSON.parse(w.eval('localStorage.getItem("life_assistant_v1")'));
  ok(saved.appName === '我的小账本', '已持久化到 localStorage');

  // 首尾空白会被裁剪
  w.__app.applyAppName('  测试名  ');
  ok(w.document.querySelector('#brandName').textContent === '测试名', '首尾空白被裁剪');

  // 空名称兜底：不允许保存为空（沿用 store 中当前名称）
  const nameBefore = Store.data.appName;
  click(w, w.document.querySelector('#brandName'));
  const input2 = w.document.querySelector('#appNameInput');
  setVal(w, input2, '   ');
  click(w, w.document.querySelector('#modalOk'));
  ok(Store.data.appName === nameBefore, `空名称被拒绝，保留原值「${nameBefore}」`);

  // sanitize 对残缺数据的兜底
  Store.data.appName = '';
  Store.sanitize();
  ok(Store.data.appName === w.__app.DEFAULT_APP_NAME, 'sanitize 将空名称回落到默认名');
  Store.data.appName = 12345;
  Store.sanitize();
  ok(Store.data.appName === w.__app.DEFAULT_APP_NAME, 'sanitize 将非字符串名称回落到默认名');

  // 超长名称被截断
  Store.data.appName = '一二三四五六七八九十一二三四五六七八九十甲乙丙丁';
  Store.sanitize();
  ok(Store.data.appName.length === 20, `超长名称被截断为 20 字符（当前 ${Store.data.appName.length}）`);
});

/* =========================================================================
   需求 11：云同步（登录入口 / 离线兜底 / 失败路径 / 安全边界）
   ========================================================================= */

test('需求11 云同步入口与配置齐备', (w) => {
  const doc = w.document;
  const app = w.__app;

  // 界面元素
  ok(!!doc.getElementById('syncBtn'), '侧边栏存在「云同步」入口按钮');
  ok(!!doc.getElementById('cloudSyncCard'), '金库页存在云同步卡片');
  ok(!!doc.getElementById('cloudSyncBadge'), '云同步卡片有状态徽章');

  // publicConfig 四个字段都在（都是可安全下发前端的值）
  const cfg = app.CLOUD_PUBLIC_CONFIG;
  ok(!!cfg.resourceId, 'publicConfig.resourceId 已配置');
  ok(cfg.endpoint === 'https://yucha-finance-app.app.workbuddy.host', 'endpoint 为发布域名');
  ok(!!cfg.oauthRelayBaseUrl, 'oauthRelayBaseUrl 已配置（Web 微信登录所需）');
  ok(!!cfg.publishableKey, 'publishableKey 已配置');

  // 数据表名
  ok(app.CLOUD_TABLE === 'finance_state', '云数据表名为 finance_state');
});

test('需求11 SDK 未加载时降级为纯本地模式', (w) => {
  const app = w.__app;
  // 测试环境无 WorkBuddyCloud 全局 → ensureCloudClient 应返回 null，而不是抛错
  ok(typeof w.WorkBuddyCloud === 'undefined', '测试环境确实没有 SDK（模拟离线/未加载）');
  let threw = false;
  let client = null;
  try { client = app.ensureCloudClient(); } catch (e) { threw = true; }
  ok(!threw, 'SDK 缺失时初始化不抛异常');
  ok(client === null, 'SDK 缺失时返回 null（降级为纯本地模式）');
  ok(app.isCloudSignedIn() === false, '未登录状态下 isCloudSignedIn() 为 false');
});

test('需求11 未登录时数据仍正常保存到本地（离线兜底）', (w) => {
  const app = w.__app;
  const Store = app.Store;
  const before = Store.data.transactions.length;

  Store.addTransaction({
    id: 'cloud_local_1', type: 'expense', amount: 9.9, category: '奶茶',
    account: 'wechat', date: app.todayStr(), remark: '离线记账', createdAt: Date.now(),
  });
  ok(Store.data.transactions.length === before + 1, '未登录也能正常记账');

  const stored = JSON.parse(w.localStorage.getItem('life_assistant_v1'));
  ok(stored.transactions.some((t) => t.id === 'cloud_local_1'), '数据已写入 localStorage');

  // 未登录时自动上传钩子应直接返回，不产生任何请求
  let threw = false;
  try { app.scheduleAutoPush(); } catch (e) { threw = true; }
  ok(!threw, '未登录时 scheduleAutoPush 安全空转');
});

test('需求11 未登录时上传/下载有明确提示而非静默失败', async (w) => {
  const app = w.__app;
  const pushRes = await app.cloudPush(true);
  ok(pushRes === false, '未登录时 cloudPush 返回 false');
  ok(w.document.getElementById('toast').textContent.includes('请先登录'), '上传给出「请先登录」提示');

  const pullRes = await app.cloudPull(true);
  ok(pullRes === false, '未登录时 cloudPull 返回 false');
  ok(w.document.getElementById('toast').textContent.includes('请先登录'), '下载给出「请先登录」提示');
});

test('需求11 登录弹窗结构完整且校验先行', (w) => {
  const app = w.__app;
  app.openLoginModal();
  const doc = w.document;

  ok(!!doc.getElementById('cloudEmailInput'), '弹窗含邮箱输入框');
  ok(!!doc.getElementById('cloudCodeInput'), '弹窗含验证码输入框');
  ok(!!doc.getElementById('cloudSendBtn'), '弹窗含「获取验证码」按钮');
  ok(!!doc.getElementById('modalOk'), '弹窗含「登录」提交按钮');
  ok(doc.getElementById('cloudSendBtn').type === 'button',
    '「获取验证码」为 type=button（避免触发表单提交）');

  // 非法邮箱：不发请求，直接提示
  const emailEl = doc.getElementById('cloudEmailInput');
  emailEl.value = 'not-an-email';
  click(w, doc.getElementById('cloudSendBtn'));
  const hint = () => doc.getElementById('cloudHint').textContent;
  ok(hint().includes('邮箱'), '非法邮箱给出格式提示');

  // 邮箱合法但未获取验证码就提交：应提示先获取
  emailEl.value = 'a@b.com';
  doc.getElementById('cloudCodeInput').value = '123456';
  click(w, doc.getElementById('modalOk'));
  ok(hint().includes('获取验证码'), '未获取验证码就提交时提示先去获取');
});

/* =========================================================================
   观影模块 —— A 数据 / 迁移
   ========================================================================= */
test('观影A 数据版本为 6 且新字段齐备', (w) => {
  const d = w.__app.Store.data;
  ok(d.version === 6, 'DATA_VERSION 为 6');
  ok(Array.isArray(d.shows), 'shows 为数组');
  ok(Array.isArray(d.watchLogs), 'watchLogs 为数组');
  ok(Array.isArray(d.wordCards), 'wordCards 为数组');
  ok(w.__app.DATA_VERSION === 6, '导出常量 DATA_VERSION 为 6');
});

test('观影A v4 旧数据迁移：季号并入标题并移除季字段', (w) => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const legacy = JSON.stringify({
    version: 4, appName: '测试', customNav: [],
    transactions: [], budgets: {}, vault: {},
    shows: [
      { id: 'a', title: '进击的巨人', season: 3, episode: 5, totalSeasons: 4, currentSeasonEpisodes: 22, status: 'watching' },
      { id: 'b', title: '某部电影', season: 1, episode: 1, currentSeasonEpisodes: 1, status: 'want' },
    ],
    watchLogs: [],
  });
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true });
  dom.window.localStorage.setItem('life_assistant_v1', legacy);
  dom.window.eval('(function(){' + fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8') +
    'window.__app={Store, DATA_VERSION};})();');
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded', { bubbles: true }));
  const d = dom.window.__app.Store.data;
  ok(d.version === 6, 'v4 → v6 升级成功');
  const a = d.shows.find((s) => s.id === 'a');
  const b = d.shows.find((s) => s.id === 'b');
  ok(a.title === '进击的巨人3', 'season=3 的季号并入标题');
  ok(!('season' in a) && !('totalSeasons' in a), '季与总季数字段已移除');
  ok(a.episode === 5 && a.currentSeasonEpisodes === 22, '集数与本季集数保留');
  ok(b.title === '某部电影', 'season=1 不追加数字后缀');
});

test('观影A 旧版（v3）数据迁移后补空数组且不破坏原数据', (w) => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const legacy = JSON.stringify({
    version: 3, appName: '测试', customNav: [],
    transactions: [{ id: 't1', type: 'expense', amount: 20, category: '奶茶', account: 'wechat', date: '2026-01-05', createdAt: 1 }],
    budgets: { '2026-01': 800 }, vault: { wechat_change: 50, wechat_lct: 0, alipay: 0, bank: 0 },
  });
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true });
  dom.window.localStorage.setItem('life_assistant_v1', legacy);
  dom.window.eval('(function(){' + fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8') +
    'var _c=typeof coverDelete!=="undefined"?{coverDelete:coverDelete}:{};' +
    'window.__app={Store, DATA_VERSION, normalizeShow, normalizeWatchLog};})();');
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded', { bubbles: true }));
  const d = dom.window.__app.Store.data;
  ok(d.version === 6, 'v3 → v6 升级成功');
  ok(Array.isArray(d.shows) && d.shows.length === 0, 'shows 补为空数组');
  ok(Array.isArray(d.watchLogs) && d.watchLogs.length === 0, 'watchLogs 补为空数组');
  ok(Array.isArray(d.wordCards) && d.wordCards.length === 0, 'wordCards 补为空数组');
  ok(d.transactions.length === 1, '原有交易未被破坏');
  ok(d.budgets['2026-01'] === 800, '原有预算未被破坏');
  ok(d.vault.wechat_change === 50, '原有金库未被破坏');
});

test('观影A sanitize 丢弃非法剧集并兜底字段', (w) => {
  const dom = boot();
  const app = dom.__app;
  app.Store.data.shows = [
    { id: 's1', title: '合法剧', status: 'bogus', season: 0, episode: -3, year: 1800, rating: 99, coverType: 'bad' },
    { id: 's2', title: '' },              // 空标题 → 丢弃
    null, 'str', 42,                       // 非对象 → 丢弃
    { id: 's3', title: '无封面类型', coverType: 'url', coverUrl: 'javascript:alert(1)' },
  ];
  dom.__app.Store.sanitize();
  const shows = app.Store.data.shows;
  ok(shows.length === 2, '仅保留 2 条合法剧集');
  const s1 = shows.find((s) => s.id === 's1');
  ok(s1.status === 'want', '非法 status 回落为 want');
  ok(s1.episode === 1, '非法集数回落为 1');
  ok(!('season' in s1), '非法 season 字段被清除');
  ok(s1.year === 1900, '年份下界 clamp 到 1900');
  ok(s1.rating === 10, '评分上界 clamp 到 10');
  ok(s1.coverType === 'none', '非法封面类型回落 none');
  const s3 = shows.find((s) => s.id === 's3');
  ok(s3.coverType === 'none' && s3.coverUrl === '', 'javascript: 协议封面被拒绝 → none');
});

test('观影A sanitize 清理孤儿观看记录', (w) => {
  const app = w.__app;
  app.Store.data.shows = [{ id: 'keep', title: '留存' }];
  app.Store.data.watchLogs = [
    { id: 'l1', showId: 'keep', kind: 'progress', at: 1 },
    { id: 'l2', showId: 'ghost', kind: 'progress', at: 2 },  // 无对应剧集 → 丢弃
    { id: 'l3', kind: 'progress' },                          // 缺 showId → 丢弃
  ];
  app.Store.sanitize();
  ok(app.Store.data.watchLogs.length === 1, '孤儿观看记录被清理');
  ok(app.Store.data.watchLogs[0].showId === 'keep', '保留有效观看记录');
});

test('观影A normalizeShow 允许合法的 data:image 封面', (w) => {
  const dom = boot();
  const s = { title: 'X', coverType: 'url', coverUrl: 'data:image/png;base64,AAAA' };
  dom.__app.normalizeShow(s);
  ok(s.coverType === 'url', 'data:image 封面被接受');
  const s2 = { title: 'Y', coverType: 'url', coverUrl: 'http://x/y.jpg' };
  dom.__app.normalizeShow(s2);
  ok(s2.coverUrl === 'http://x/y.jpg', 'http 封面被接受');
});

/* =========================================================================
   观影模块 —— B 数据操作
   ========================================================================= */
test('观影B 新增剧集并持久化到 localStorage', (w) => {
  const app = w.__app;
  const s = app.Store.addShow({ title: '进击的巨人', year: 2013, status: 'want' });
  ok(!!s && !!s.id, '返回带 id 的剧集对象');
  ok(app.Store.getShows().length === 1, '剧集已入内存');
  const raw = JSON.parse(w.localStorage.getItem('life_assistant_v1'));
  ok(raw.shows.length === 1, '剧集已写入 localStorage');
  ok(raw.shows[0].title === '进击的巨人', '标题正确持久化');
});

test('观影B 空标题被拒绝新增', (w) => {
  const app = w.__app;
  const before = app.Store.getShows().length;
  const s = app.Store.addShow({ title: '   ' });
  ok(s === null, '空标题返回 null');
  ok(app.Store.getShows().length === before, '未新增任何剧集');
});

test('观影B 编辑剧集刷新 updatedAt', (w) => {
  const app = w.__app;
  const s = app.Store.addShow({ title: '原题', year: 2020 });
  const oldUp = s.updatedAt;
  const r = app.Store.updateShow(s.id, { title: '新题', genre: '科幻' });
  ok(r.title === '新题' && r.genre === '科幻', '字段已被更新');
  ok(r.updatedAt >= oldUp, 'updatedAt 已刷新');
});

test('观影B 删除剧集级联清理观看记录', (w) => {
  const app = w.__app;
  const a = app.Store.addShow({ title: 'A剧' });
  const b = app.Store.addShow({ title: 'B剧' });
  app.Store.updateProgress(a.id, 2);
  app.Store.updateProgress(b.id, 3);
  ok(app.Store.data.watchLogs.length === 2, '两条观看记录已写入');
  app.Store.removeShow(a.id);
  ok(app.Store.getShow(a.id) === undefined, 'A 剧已删除');
  ok(app.Store.data.watchLogs.length === 1, 'A 剧的观看记录被级联删除');
  ok(app.Store.data.watchLogs[0].showId === b.id, 'B 剧记录保留');
});

test('观影B 观看记录可按剧集倒序查询', (w) => {
  const app = w.__app;
  const s = app.Store.addShow({ title: '记录剧' });
  app.Store.updateProgress(s.id, 1);
  app.Store.updateProgress(s.id, 2);
  app.Store.changeShowStatus(s.id, 'paused');
  const logs = app.Store.getWatchLogs(s.id, 10);
  ok(logs.length === 3, '三条记录');
  ok(logs.filter((l) => l.kind === 'status').length === 1, '含一条状态变更记录');
  ok(logs[0].at >= logs[2].at, '按时间倒序（不早于最旧一条）');
  ok(logs.some((l) => l.kind === 'progress' && l.episode === 2), '含第 2 集进度记录');
});

/* =========================================================================
   观影模块 —— C 进度（核心）
   ========================================================================= */
test('观影C validateEpisode 正整数校验（一季一条，只有集数）', (w) => {
  const v = w.__app.validateEpisode;
  ok(v(5).ok, '合法集数通过');
  ok(!v(0).ok, '集数 0 非法');
  ok(!v(-3).ok, '负数集数非法');
  ok(v(2.7).episode === 2, '小数集数被向下取整');
  ok(v(5, 10).ok, '本季 10 集、第 5 集合法');
  const r = v(11, 10);
  ok(!r.ok, '超出本季总集数判非法');
  ok(r.error.includes('10'), '错误信息含本季总集数');
  ok(v(100, null).ok, '总集数未知时不设上限');
});

test('观影C incEpisode 未知本季总集数只 +1', (w) => {
  const app = w.__app;
  const s = { episode: 5, currentSeasonEpisodes: null };
  const r = app.incEpisode(s);
  ok(r.episode === 6, '集数 +1');
  ok(!('season' in r), '结果不含季字段');
});

test('观影C incEpisode 到达本季末集则停在末集（不跨季）', (w) => {
  const app = w.__app;
  const s = { episode: 10, currentSeasonEpisodes: 10 };
  const r = app.incEpisode(s);
  ok(r.episode === 10, '末集不再前进');
  const s2 = { episode: 9, currentSeasonEpisodes: 10 };
  ok(app.incEpisode(s2).episode === 10, '倒数第二集可推进到末集');
});

test('观影C incEpisode 末集不回绕（一季一条的核心保证）', (w) => {
  const app = w.__app;
  // 连续 +1 多次，必须稳定停在 cap，绝不出现「第 1 集」的回绕
  let s = { episode: 10, currentSeasonEpisodes: 10 };
  for (let i = 0; i < 5; i++) s = { episode: app.incEpisode(s).episode, currentSeasonEpisodes: 10 };
  ok(s.episode === 10, '反复 +1 稳定停在末集');
  ok(s.episode !== 1, '不会回绕到第 1 集');
});

test('观影C decEpisode 逐集回退且下限保护', (w) => {
  const app = w.__app;
  ok(app.decEpisode({ episode: 5 }).episode === 4, '第 5 集回退到第 4 集');
  ok(app.decEpisode({ episode: 1 }).episode === 1, '第 1 集不再后退');
  ok(app.decEpisode({ episode: 1, currentSeasonEpisodes: 12 }).episode === 1, '受下限保护不受集数影响');
});

test('观影C 改状态不删除进度与资料', (w) => {
  const app = w.__app;
  const s = app.Store.addShow({ title: '改状态剧', summary: '简介保留', rating: 8 });
  app.Store.updateProgress(s.id, 7);
  app.Store.changeShowStatus(s.id, 'paused');
  const after = app.Store.getShow(s.id);
  ok(after.status === 'paused', '状态已改为暂停');
  ok(after.episode === 7, '进度未被清空');
  ok(after.summary === '简介保留', '简介未被清空');
  ok(after.rating === 8, '评分未被清空');
});

test('观影C 标记已看完保留资料并可改回在看继续推进', (w) => {
  const app = w.__app;
  const s = app.Store.addShow({ title: '完结剧', genre: '悬疑' });
  app.Store.updateProgress(s.id, 3);
  app.Store.finishShow(s.id, { date: '2026-02-01', rating: 9.5, note: '神作' });
  const fin = app.Store.getShow(s.id);
  ok(fin.status === 'watched', '状态为已看完');
  ok(fin.finishedAt === '2026-02-01', '完成日期已记录');
  ok(fin.rating === 9.5, '评分已记录');
  ok(fin.note === '神作', '观后感已记录');
  ok(fin.episode === 3, '进度资料保留');
  // 改回在看后仍可推进
  app.Store.changeShowStatus(s.id, 'watching');
  const r = app.incEpisode(app.Store.getShow(s.id));
  ok(r.episode === 4, '改回在在后可继续推进');
});

test('观影C 首次推进进度自动从「想看」转为「在看」', (w) => {
  const app = w.__app;
  const s = app.Store.addShow({ title: '自动转态剧', status: 'want' });
  app.Store.updateProgress(s.id, 1);
  ok(app.Store.getShow(s.id).status === 'watching', '进度推进后状态变为在看');
  ok(!!app.Store.getShow(s.id).lastWatchedAt, 'lastWatchedAt 已写入');
});

test('观影C 本季总集数变化后末集判定随之更新', (w) => {
  const app = w.__app;
  const s = app.Store.addShow({ title: '集数可变剧', currentSeasonEpisodes: 12 });
  app.Store.updateProgress(s.id, 12);
  let r = app.incEpisode(app.Store.getShow(s.id));
  ok(r.episode === 12, '12 集为末集，停住');
  // 用户把本季总集数改为 8，则第 8 集即为末集、第 12 集已越界
  app.Store.updateShow(s.id, { currentSeasonEpisodes: 8 });
  app.Store.updateProgress(s.id, 8);
  r = app.incEpisode(app.Store.getShow(s.id));
  ok(r.episode === 8, '按新的本季总集数判定末集');
  ok(app.progressWarn({ episode: 12, currentSeasonEpisodes: 8 }) !== '', '越界时给出提示');
  ok(app.progressWarn({ episode: 5, currentSeasonEpisodes: 8 }) === '', '未越界不提示');
});

/* =========================================================================
   观影模块 —— I2 搜索区 / 一季一条 表单
   ========================================================================= */
test('观影I2 表单已移除季字段，只保留集数与本季总集数', (w) => {
  const app = w.__app;
  app.openAddShowModal();
  ok(!w.document.getElementById('showSeason'), '「第几季」输入框已移除');
  ok(!w.document.getElementById('showTotalSeasons'), '「总季数」输入框已移除');
  ok(!!w.document.getElementById('showEpisode'), '「第几集」输入框保留');
  ok(!!w.document.getElementById('showSeasonEpisodes'), '「本季总集数」输入框保留');
});

test('观影I2 表单含 TVmaze 搜索区', (w) => {
  const app = w.__app;
  app.openAddShowModal();
  ok(!!w.document.getElementById('showSearchBlock'), '搜索区存在');
  ok(!!w.document.getElementById('tvmazeQuery'), '搜索输入框存在');
  ok(!!w.document.getElementById('tvmazeSearchBtn'), '搜索按钮存在');
  ok(!!w.document.getElementById('tvmazeResults'), '结果容器存在');
});

test('观影I2 readShowForm 不再产出季字段', (w) => {
  const app = w.__app;
  app.openAddShowModal();
  w.document.getElementById('showTitle').value = '测试剧';
  w.document.getElementById('showEpisode').value = '5';
  w.document.getElementById('showSeasonEpisodes').value = '12';
  const f = app.readShowForm();
  ok(f.title === '测试剧' && f.episode === '5', '标题与集数已读取');
  ok(!('season' in f) && !('totalSeasons' in f), '表单结果不含季字段');
});

test('观影I2 新增的剧集不含 season / totalSeasons', (w) => {
  const app = w.__app;
  const s = app.Store.addShow({ title: '一季一条测试', episode: 3, currentSeasonEpisodes: 10 });
  ok(!('season' in s), '新增记录无 season 字段');
  ok(!('totalSeasons' in s), '新增记录无 totalSeasons 字段');
  ok(s.episode === 3, '集数正常保存');
});

test('观影I2 进度文案不含季前缀', (w) => {
  const app = w.__app;
  ok(app.showProgressText({ episode: 5, currentSeasonEpisodes: 10 }) === '第 5 / 10 集', '已知集数显示区间');
  ok(app.showProgressText({ episode: 5 }) === '第 5 集', '未知集数只显示集号');
  ok(app.showProgressText({ episode: 5, currentSeasonEpisodes: 10 }).indexOf('S') < 0, '不含 S 前缀');
});

/* =========================================================================
   观影模块 —— E 封面 / 降级
   ========================================================================= */
test('观影E jsdom 无 IndexedDB 时能力探测返回 false 且优雅降级', (w) => {
  const app = w.__app;
  ok(typeof w.indexedDB === 'undefined', 'jsdom 环境确实没有 indexedDB');
  ok(app.coverDbAvailable() === false, 'coverDbAvailable 返回 false');
});

test('观影E 无 IDB 时封面 API 全部返回安全值且不抛错', async (w) => {
  const app = w.__app;
  let threw = false;
  let saveR, getR, delR, urlR;
  try {
    saveR = await app.coverSave('k1', { fake: 'blob' });
    getR = await app.coverGet('k1');
    urlR = await app.coverGetURL('k1');
    delR = await app.coverDelete('k1');
  } catch (e) { threw = true; }
  ok(!threw, '封面 API 调用不抛错');
  ok(saveR === false, 'coverSave 降级返回 false');
  ok(getR !== undefined, 'coverGet 返回值不抛错');
  ok(urlR === null || urlR === undefined, 'coverGetURL 降级返回 null');
  ok(delR === false, 'coverDelete 降级返回 false');
});

test('观影E 空 key 的封面 API 立即安全返回', async (w) => {
  const app = w.__app;
  ok((await app.coverGet('')) === null, '空 key coverGet → null');
  ok((await app.coverSave('', { x: 1 })) === false, '空 key coverSave → false');
  ok((await app.coverDelete('')) === false, '空 key coverDelete → false');
});

test('观影E 本地封面仅存 key 引用，HTML 中不含 Base64 内联图', (w) => {
  const app = w.__app;
  const s = app.Store.addShow({ title: '本地封面剧' });
  app.Store.updateShow(s.id, { coverType: 'local', coverKey: 'img_test123' });
  const saved = app.Store.getShow(s.id);
  ok(saved.coverType === 'local' && saved.coverKey === 'img_test123', '仅保存 key 引用');
  const json = w.localStorage.getItem('life_assistant_v1');
  ok(json.indexOf('data:image') === -1, 'localStorage 中不含 data:image 内联数据');
  ok(json.indexOf('img_test123') > -1, 'localStorage 中含封面 key');
});

test('观影E saveCoverFile 拒绝非图片与超大文件', async (w) => {
  const app = w.__app;
  const notImg = await app.saveCoverFile({ type: 'text/plain', size: 100, name: 'a.txt' });
  ok(notImg.ok === false && /图片/.test(notImg.error), '非图片被拒绝并给出提示');
  const tooBig = await app.saveCoverFile({ type: 'image/png', size: 9 * 1024 * 1024, name: 'a.png' });
  ok(tooBig.ok === false && /5MB|过大/.test(tooBig.error), '超大图片被拒绝');
  const good = await app.saveCoverFile({ type: 'image/png', size: 1024, name: 'a.png' });
  ok(good.ok === true && /^img_/.test(good.key), '合法图片返回 img_ 前缀 key');
});

test('观影E hydrateCovers 在无 IDB 时不抛错并标记失败', (w) => {
  const app = w.__app;
  const wrap = w.document.createElement('div');
  wrap.innerHTML = '<img data-cover-type="local" data-cover-key="nope" />';
  let threw = false;
  try { app.hydrateCovers(wrap); } catch (e) { threw = true; }
  ok(!threw, 'hydrateCovers 不抛错');
  ok(app.hydrateCovers(null) === undefined, '传入 null 安全返回');
});

/* =========================================================================
   观影模块 —— F 交互 / 结构
   ========================================================================= */
test('观影F 导航存在第 4 个「观影」入口', (w) => {
  const items = w.document.querySelectorAll('.nav-item[data-page]');
  ok(items.length === 5, '共有 5 个导航项');
  const showsNav = w.document.querySelector('.nav-item[data-page="shows"]');
  ok(!!showsNav, '存在 data-page="shows" 的导航项');
  ok(showsNav.textContent.includes('观影'), '文案为「观影」');
  ok(!!showsNav.querySelector('i[data-lucide="clapperboard"]'), '图标为 clapperboard');
});

test('观影F 点击导航第 4 项切换到观影页', (w) => {
  const nav = w.document.querySelector('.nav-item[data-page="shows"]');
  click(w, nav);
  const page = w.document.querySelector('#page-shows');
  ok(page.classList.contains('active'), '观影页已激活');
  ok(!w.document.querySelector('#page-ledger').classList.contains('active'), '记账页已隐藏');
  ok(nav.classList.contains('active'), '导航项高亮');
});

test('观影F 观影页含搜索 / 排序 / 添加 / 统计 / 筛选 / 区块容器', (w) => {
  const page = w.document.querySelector('#page-shows');
  ['showAddBtn', 'showSearch', 'showSortSel', 'showsStats', 'showsFilters', 'showsSections', 'showsLink']
    .forEach((id) => ok(!!page.querySelector('#' + id), `存在 #${id}`));
});

test('观影F 观影页外链指向 libvio.app 且新窗口打开', (w) => {
  const a = w.document.querySelector('#showsLink');
  ok(!!a, '存在 #showsLink');
  ok(a.getAttribute('href') === 'https://www.libvio.app/', 'href 指向 https://www.libvio.app/');
  ok(a.target === '_blank', '新窗口打开（target=_blank）');
  ok(/noopener/.test(a.getAttribute('rel') || ''), 'rel 含 noopener（防逆向引用）');
  ok(a.textContent.includes('点此去看剧'), '文案为「点此去看剧」');
});

/* =========================================================================
   观影模块 —— D 渲染 / 筛选 / 排序
   ========================================================================= */
test('观影D 四区块 + 统计概览正确渲染', (w) => {
  const app = w.__app;
  app.Store.reset();
  const a = app.Store.addShow({ title: '在看剧', status: 'watching' });
  app.Store.updateProgress(a.id, 3);            // 有观看记录 → 进「继续观看」
  const b = app.Store.addShow({ title: '刚标记在看', status: 'watching' }); // 无记录 → 进「在看」
  app.Store.addShow({ title: '想看剧', status: 'want' });
  app.Store.addShow({ title: '已看完剧', status: 'watched' });
  app.Store.addShow({ title: '暂停剧', status: 'paused' });

  app.renderShows();
  const secs = w.document.querySelectorAll('#showsSections .shows-section');
  ok(secs.length === 5, '渲染出 5 个区块（继续观看 + 在看 + 想看 + 暂停 + 已看完）');
  const names = Array.prototype.map.call(
    w.document.querySelectorAll('#showsSections .shows-section-head h2'), (h) => h.textContent);
  ok(names.some((n) => n.includes('继续观看')), '含「继续观看」区块');
  ok(names.some((n) => n.includes('已看完')), '含「已看完」区块');
  ok(!!b, '第二部在看剧已创建');

  const stats = w.document.querySelectorAll('#showsStats .show-stat');
  ok(stats.length === 4, '统计概览 4 项');
  const statText = w.document.querySelector('#showsStats').textContent;
  ok(statText.includes('在看') && statText.includes('已看完'), '统计含在看/已看完标签');
  // 两部在看 → 统计「在看」计数为 2
  const watchingNum = w.document.querySelector('#showsStats .show-stat .show-stat-num').textContent;
  ok(watchingNum === '2', '「在看」统计数为 2');
});

test('观影D 筛选 + 搜索叠加生效', (w) => {
  const app = w.__app;
  app.Store.reset();
  app.Store.addShow({ title: '海绵宝宝', status: 'want', genre: '动画' });
  app.Store.addShow({ title: '火影忍者', status: 'watching', genre: '动画' });
  app.Store.addShow({ title: '绝命毒师', status: 'watching', genre: '犯罪' });

  // 仅状态筛选
  state(w).showStatus = 'watching';
  state(w).showQuery = '';
  app.renderShows();
  ok(w.document.querySelectorAll('#showsSections .poster-card').length === 2, '「在看」筛出 2 部');

  // 状态 + 关键词叠加
  state(w).showQuery = '绝命';
  app.renderShows();
  const cards = w.document.querySelectorAll('#showsSections .poster-card');
  ok(cards.length === 1, '叠加关键词后仅 1 部');
  ok(cards[0].textContent.includes('绝命毒师'), '命中「绝命毒师」');

  // 恢复
  state(w).showStatus = 'all';
  state(w).showQuery = '';
});

test('观影D filterShows 匹配原名 / 类型 / 简介', (w) => {
  const app = w.__app;
  const list = [
    { title: 'A', originalTitle: 'Breaking Bad', genre: '犯罪', summary: '' },
    { title: 'B', originalTitle: '', genre: '喜剧', summary: '一段校园故事' },
  ];
  ok(app.filterShows(list, 'all', 'breaking').length === 1, '匹配原文标题（忽略大小写）');
  ok(app.filterShows(list, 'all', '喜剧').length === 1, '匹配类型');
  ok(app.filterShows(list, 'all', '校园').length === 1, '匹配简介');
});

test('观影D sortShows 三种排序', (w) => {
  const app = w.__app;
  const list = [
    { id: '1', title: 'B剧', createdAt: 100, updatedAt: 300 },
    { id: '2', title: 'A剧', createdAt: 300, updatedAt: 100 },
    { id: '3', title: 'C剧', createdAt: 200, updatedAt: 200 },
  ];
  ok(app.sortShows(list, 'updated')[0].id === '1', 'updated 降序 → 最近更新在前');
  ok(app.sortShows(list, 'created')[0].id === '2', 'created 降序 → 最近添加在前');
  ok(app.sortShows(list, 'title')[0].id === '2', 'title 升序 → A 剧在前');
  ok(list[0].id === '1', '原数组未被修改');
});

test('观影D groupShows 正确分区（有观看记录才进「继续观看」）', (w) => {
  const app = w.__app;
  const g = app.groupShows([
    { id: '1', status: 'watching', lastWatchedAt: 5, updatedAt: 5 },
    { id: '2', status: 'watching', lastWatchedAt: null, updatedAt: 6 },
    { id: '3', status: 'want', updatedAt: 1 },
    { id: '4', status: 'watched', updatedAt: 1 },
    { id: '5', status: 'paused', updatedAt: 1 },
  ]);
  ok(g.continue.length === 1 && g.continue[0].id === '1', '有观看记录的在看剧进「继续观看」');
  ok(g.watching.length === 1 && g.watching[0].id === '2', '无记录的在看剧单列');
  ok(g.want.length === 1 && g.watched.length === 1 && g.paused.length === 1, 'want/watched/paused 各 1');
});

test('观影D 未知本季总集数不画进度条、不显百分比', (w) => {
  const app = w.__app;
  const s = app.Store.addShow({ title: '集数未知', status: 'watching' });
  app.Store.updateProgress(s.id, 5);
  app.renderShows();
  const card = w.document.querySelector(`.poster-card[data-id="${s.id}"]`);
  ok(!!card, '卡片已渲染');
  ok(card.querySelectorAll('.progress-track').length === 0, '未知总集数不渲染进度条');
  ok(card.textContent.includes('第 5 集') && !card.textContent.includes('/'), '仅显示「第 5 集」，无百分比');
});

test('观影D 已知本季总集数渲染进度条与「第 x / y 集」', (w) => {
  const app = w.__app;
  const s = app.Store.addShow({ title: '集数已知', status: 'watching', currentSeasonEpisodes: 10 });
  app.Store.updateProgress(s.id, 4);
  app.renderShows();
  const card = w.document.querySelector(`.poster-card[data-id="${s.id}"]`);
  ok(card.querySelectorAll('.progress-track').length === 1, '渲染进度条');
  const fill = card.querySelector('.progress-fill');
  ok(fill.getAttribute('style').includes('40%'), '进度 40%');
  ok(card.textContent.includes('第 4 / 10 集'), '显示「第 4 / 10 集」');
});

test('观影D 卡片含 2:3 封面容器与状态标签', (w) => {
  const app = w.__app;
  app.Store.reset();
  const s = app.Store.addShow({ title: '封面剧', status: 'watched' });
  app.renderShows();
  const card = w.document.querySelector(`.poster-card[data-id="${s.id}"]`);
  ok(!!card.querySelector('.poster-media'), '含海报容器（aspect-ratio 2:3 由 CSS 保证）');
  const badge = card.querySelector('.poster-badge');
  ok(!!badge, '含状态标签');
  ok(badge.classList.contains('st-watched'), '已看完徽标类名正确');
  ok(card.querySelector('.cover-ph') || card.querySelector('.cover-img'), '含封面或占位');
});

test('观影D 空态与无结果态', (w) => {
  const app = w.__app;
  app.Store.reset();
  app.renderShows();
  ok(w.document.querySelector('#showsSections .empty'), '无数据时显示空态');
  ok(w.document.querySelector('#showsSections .empty').textContent.includes('还没有'), '空态文案正确');

  app.Store.addShow({ title: '唯一剧' });
  state(w).showQuery = 'zzz不存在zzz';
  app.renderShows();
  ok(w.document.querySelector('#showsSections .empty').textContent.includes('没有匹配'), '无结果态文案正确');
  state(w).showQuery = '';
});

test('观影F 事件委托：导航到观影页后点卡片可开详情（innerHTML 重建后仍生效）', (w) => {
  const app = w.__app;
  app.Store.reset();
  const s = app.Store.addShow({ title: '委托测试剧', year: 2021, summary: '简介内容' });
  app.switchPage('shows');
  const card = w.document.querySelector(`.poster-card[data-id="${s.id}"]`);
  ok(!!card, '卡片已渲染');
  click(w, card);
  ok(w.document.getElementById('modalMask').classList.contains('show'), '详情弹窗已打开');
  ok(w.document.querySelector('#modal').textContent.includes('委托测试剧'), '详情显示剧名');
});

test('观影F 卡片「下一集」按钮推进进度', (w) => {
  const app = w.__app;
  app.Store.reset();
  const s = app.Store.addShow({ title: '推进剧', status: 'watching', currentSeasonEpisodes: 5 });
  app.Store.updateProgress(s.id, 1);
  app.switchPage('shows');
  const btn = w.document.querySelector(`button[data-act="continue"][data-id="${s.id}"]`);
  ok(!!btn, '卡片上有「下一集」按钮');
  click(w, btn);
  ok(app.Store.getShow(s.id).episode === 2, '进度推进到第 2 集');
});

test('观影F 点击筛选标签切换状态筛选', (w) => {
  const app = w.__app;
  app.Store.reset();
  app.Store.addShow({ title: '想看甲', status: 'want' });
  app.Store.addShow({ title: '在看乙', status: 'watching' });
  app.switchPage('shows');
  const chip = w.document.querySelector('.chip[data-status="want"]');
  ok(!!chip, '存在「想看」筛选标签');
  click(w, chip);
  ok(app.state.showStatus === 'want', '筛选状态已切换为 want');
  ok(w.document.querySelectorAll('#showsSections .poster-card').length === 1, '仅显示 1 部');
});

test('观影F 新增剧集弹窗填写后成功入库', (w) => {
  const app = w.__app;
  app.Store.reset();
  app.switchPage('shows');
  click(w, w.document.querySelector('#showAddBtn'));
  ok(w.document.getElementById('modalMask').classList.contains('show'), '新增弹窗已打开');
  ok(!!w.document.getElementById('showTitle'), '弹窗含标题输入');
  ok(!!w.document.querySelector('#showStatusSegs .seg'), '弹窗含状态分段控件');
  w.document.getElementById('showTitle').value = '新剧一';
  w.document.getElementById('showYear').value = '2024';
  w.document.getElementById('showGenre').value = '科幻';
  click(w, w.document.getElementById('modalOk'));
  ok(app.Store.getShows().length === 1, '剧集已入库');
  ok(app.Store.getShows()[0].title === '新剧一', '标题正确');
  ok(app.Store.getShows()[0].year === 2024, '年份正确');
});

test('观影F 新增弹窗空标题被拒绝', (w) => {
  const app = w.__app;
  app.Store.reset();
  app.switchPage('shows');
  click(w, w.document.querySelector('#showAddBtn'));
  click(w, w.document.getElementById('modalOk'));
  ok(app.Store.getShows().length === 0, '未入库任何剧集');
  ok(w.document.getElementById('modalMask').classList.contains('show'), '弹窗保持打开');
});

test('观影F 编辑弹窗自动回填全部字段', (w) => {
  const app = w.__app;
  app.Store.reset();
  const s = app.Store.addShow({
    title: '回填剧', originalTitle: 'Original', year: 2019, genre: '悬疑',
    status: 'paused', episode: 7, currentSeasonEpisodes: 12,
    summary: '简介文本', note: '备注文本', rating: 8.5,
  });
  app.openEditShowModal(s.id);
  ok(w.document.getElementById('showTitle').value === '回填剧', '标题回填');
  ok(w.document.getElementById('showOriginalTitle').value === 'Original', '原文标题回填');
  ok(w.document.getElementById('showYear').value === '2019', '年份回填');
  ok(w.document.getElementById('showEpisode').value === '7', '集回填');
  ok(w.document.getElementById('showSeasonEpisodes').value === '12', '本季集数回填');
  ok(w.document.getElementById('showRating').value === '8.5', '评分回填');
  ok(w.document.querySelector('#showStatusSegs .seg.active').dataset.status === 'paused', '状态选中暂停');
  ok(w.document.getElementById('showSummary').value === '简介文本', '简介回填');
  ok(w.document.getElementById('showNote').value === '备注文本', '观后感回填');
});

test('观影F 改状态不影响进度（通过详情/状态操作链路）', (w) => {
  const app = w.__app;
  app.Store.reset();
  const s = app.Store.addShow({ title: '状态剧', status: 'watching', currentSeasonEpisodes: 10 });
  app.Store.updateProgress(s.id, 6);
  app.Store.changeShowStatus(s.id, 'paused');
  ok(app.Store.getShow(s.id).episode === 6, '进度保留');
  ok(app.Store.getShow(s.id).status === 'paused', '状态已改');
});

test('观影F 标记已看完弹窗默认日期为今天', (w) => {
  const app = w.__app;
  app.Store.reset();
  const s = app.Store.addShow({ title: '看完剧', status: 'watching' });
  app.openFinishModal(s.id);
  ok(!!w.document.getElementById('showFinishDate'), '含完成日期输入');
  ok(w.document.getElementById('showFinishDate').value === todayStr(), '默认日期为今天');
  w.document.getElementById('showFinishRating').value = '9';
  click(w, w.document.getElementById('modalOk'));
  ok(app.Store.getShow(s.id).status === 'watched', '状态改为已看完');
  ok(app.Store.getShow(s.id).rating === 9, '评分已记录');
});

test('观影F 删除确认弹窗二次确认后删除', (w) => {
  const app = w.__app;
  app.Store.reset();
  const s = app.Store.addShow({ title: '待删剧' });
  app.openDeleteShowModal(s.id);
  ok(w.document.querySelector('#modal').textContent.includes('待删剧'), '确认弹窗显示剧名');
  click(w, w.document.getElementById('modalOk'));
  ok(app.Store.getShow(s.id) === undefined, '剧集已删除');
});

test('观影F 详情弹窗含观看记录与操作组', (w) => {
  const app = w.__app;
  app.Store.reset();
  const s = app.Store.addShow({ title: '详情剧', status: 'watching', currentSeasonEpisodes: 8, summary: '故事简介' });
  app.Store.updateProgress(s.id, 3);
  app.openShowDetail(s.id);
  const modal = w.document.querySelector('#modal');
  ok(modal.textContent.includes('详情剧'), '显示剧名');
  ok(modal.textContent.includes('故事简介'), '显示简介');
  ok(!!modal.querySelector('.watchlog-list'), '含观看记录列表');
  ok(modal.querySelectorAll('.detail-acts [data-act]').length >= 5, '含多个操作按钮');
  ok(!!modal.querySelector('[data-act="continue"]'), '含「看下一集」');
  ok(!!modal.querySelector('[data-act="finish"]'), '含「已看完」');
});

test('观影F 详情内「看下一集」推进并刷新详情', (w) => {
  const app = w.__app;
  app.Store.reset();
  const s = app.Store.addShow({ title: '详情推进剧', status: 'watching', currentSeasonEpisodes: 6 });
  app.Store.updateProgress(s.id, 2);
  app.openShowDetail(s.id);
  click(w, w.document.querySelector('#modal [data-act="continue"]'));
  ok(app.Store.getShow(s.id).episode === 3, '进度推进到第 3 集');
  ok(w.document.querySelector('#modal').textContent.includes('第 3 / 6 集'), '详情已刷新为新进度');
});

test('观影F 封面选择器含三个可用 tab + AI 预留说明', (w) => {
  const app = w.__app;
  app.Store.reset();
  app.openAddShowModal();
  const tabs = w.document.querySelectorAll('#coverPicker .cover-tab');
  ok(tabs.length === 4, '4 个封面 tab（无封面 / 链接 / 本地 / AI）');
  const aiPane = w.document.querySelector('[data-cover-pane="ai"]');
  ok(!!aiPane && aiPane.textContent.includes('预留'), 'AI 面板明确标注为预留');
  const aiBtn = aiPane.querySelector('button');
  ok(!!aiBtn && aiBtn.disabled, 'AI 生成按钮处于禁用态（未接入时不假装可用）');
});

test('观影F 选择「图片链接」并填 URL 后保存为 url 类型', (w) => {
  const app = w.__app;
  app.Store.reset();
  app.openAddShowModal();
  w.document.getElementById('showTitle').value = '链接封面剧';
  click(w, w.document.querySelector('#coverPicker .cover-tab[data-cover-tab="url"]'));
  const urlInput = w.document.getElementById('coverUrlInput');
  urlInput.value = 'https://example.com/p.jpg';
  urlInput.dispatchEvent(new w.Event('input', { bubbles: true }));
  click(w, w.document.getElementById('modalOk'));
  const s = app.Store.getShows()[0];
  ok(s.coverType === 'url', '封面类型为 url');
  ok(s.coverUrl === 'https://example.com/p.jpg', '封面 URL 已保存');
});

/* =========================================================================
   观影模块 —— G 兼容（不干扰记账）
   ========================================================================= */
test('观影G 新增观影数据不影响记账 / 金库 / 预算', (w) => {
  const app = w.__app;
  app.Store.reset();
  const monthKey = app.monthStr();
  // 记一笔账 + 设预算 + 调金库
  app.Store.addTransaction({ id: 'gx1', type: 'expense', amount: 25, category: '奶茶', account: 'wechat', date: app.todayStr(), createdAt: Date.now() });
  app.Store.setLimit(monthKey, 1200);
  app.Store.adjustVault('wechat_change', 100);
  const txBefore = app.Store.data.transactions.length;
  const limitBefore = app.Store.getLimit(monthKey);
  const vaultBefore = app.Store.data.vault.wechat_change;

  // 大量的观影操作
  const s = app.Store.addShow({ title: '兼容剧', status: 'watching', currentSeasonEpisodes: 10 });
  app.Store.updateProgress(s.id, 1);
  app.Store.updateProgress(s.id, 2);
  app.Store.changeShowStatus(s.id, 'paused');
  app.Store.finishShow(s.id);
  app.Store.addShow({ title: '另一部' });

  ok(app.Store.data.transactions.length === txBefore, '交易记录数量不变');
  ok(app.Store.getLimit(monthKey) === limitBefore, '预算不变');
  ok(app.Store.data.vault.wechat_change === vaultBefore, '金库余额不变');
  ok(app.Store.data.shows.length === 2, '观影数据独立存在');
});

test('观影G 导出 / 导入保留观影数据', (w) => {
  const app = w.__app;
  app.Store.reset();
  const s = app.Store.addShow({ title: '导出剧', genre: '科幻', status: 'watching', currentSeasonEpisodes: 8 });
  app.Store.updateProgress(s.id, 3);
  const snapshot = JSON.parse(JSON.stringify(app.Store.data));
  ok(Array.isArray(snapshot.shows) && snapshot.shows.length === 1, '快照包含剧集');
  ok(snapshot.shows[0].title === '导出剧', '标题正确');
  ok(snapshot.watchLogs.length >= 1, '快照包含观看记录');
  // 模拟导入：清空后回填
  app.Store.reset();
  ok(app.Store.getShows().length === 0, '重置后无剧集');
  app.Store.data = snapshot;
  app.Store.migrate();
  app.Store.sanitize();
  app.Store.save();
  ok(app.Store.getShows().length === 1, '导入后剧集恢复');
  ok(app.Store.getShows()[0].episode === 3, '进度恢复');
});

/* =========================================================================
   观影模块 —— H 云同步
   ========================================================================= */
test('观影H 观影数据随快照进入云同步 payload', (w) => {
  const app = w.__app;
  app.Store.reset();
  app.Store.addShow({ title: '云同步剧', status: 'watching' });
  // cloudPush/cloudPull 传的是整个 Store.data，验证序列化后包含 shows
  const payload = JSON.parse(JSON.stringify(app.Store.data));
  ok(Array.isArray(payload.shows) && payload.shows.length === 1, 'payload 含 shows');
  ok(Array.isArray(payload.watchLogs), 'payload 含 watchLogs');
  ok(Array.isArray(payload.wordCards), 'payload 含 wordCards');
  ok(payload.version === 6, 'payload 版本为 6');
});

test('观影H 本地封面仅同步 key（二进制不上云）', (w) => {
  const app = w.__app;
  app.Store.reset();
  const s = app.Store.addShow({ title: '云端封面剧' });
  app.Store.updateShow(s.id, { coverType: 'local', coverKey: 'img_cloud_1' });
  const payload = JSON.stringify(app.Store.data);
  ok(payload.indexOf('img_cloud_1') > -1, 'payload 含封面 key');
  ok(payload.indexOf('data:image') === -1, 'payload 不含图片二进制（Base64）');
});

test('观影H 云端拉取后 renderShows 可正常降级渲染（无本机图）', (w) => {
  const app = w.__app;
  app.Store.reset();
  // 模拟从云端拉回的、本机没有对应图片的剧集
  app.Store.data.shows = [{ id: 'cloud1', title: '云端剧', status: 'watched', coverType: 'local', coverKey: 'missing_key' }];
  app.Store.sanitize();
  let threw = false;
  try { app.renderShows(); } catch (e) { threw = true; }
  ok(!threw, 'renderShows 不抛错');
  ok(!!w.document.querySelector('.poster-card[data-id="cloud1"]'), '卡片正常渲染');
  ok(!!w.document.querySelector('.cover-ph') || !!w.document.querySelector('[data-cover-key]'), '缺图走占位或延迟回填');
});

/* =========================================================================
   观影模块 —— I 编辑封面回显 / hydrate 会话隔离（本次修复）
   ========================================================================= */
test('观影I 编辑时已有本地封面会回显（不再空白）', async (w) => {
  const app = w.__app;
  app.Store.reset();
  const s = app.Store.addShow({ title: '回显剧' });
  app.Store.updateShow(s.id, { coverType: 'local', coverKey: 'img_echo' });

  app.openEditShowModal(s.id);
  // 等异步回显完成（jsdom 无 objectURL，会走降级分支）
  await new Promise((r) => setTimeout(r, 20));

  const preview = w.document.getElementById('coverLocalPreview');
  ok(!!preview, '存在本地面板预览容器');
  ok(preview.innerHTML.length > 0, '编辑时本地面板不再空白');
  ok(/本机/.test(preview.textContent), '无法预览时给出「已保存在本机」的明确提示');
  const localTab = w.document.querySelector('#coverPicker .cover-tab[data-cover-tab="local"]');
  ok(localTab.classList.contains('active'), '本地上传 tab 处于高亮');
});

test('观影I hydrateCoverPicker 命中缓存时同步回显', (w) => {
  const app = w.__app;
  app.Store.reset();
  const s = app.Store.addShow({ title: '缓存剧' });
  app.Store.updateShow(s.id, { coverType: 'local', coverKey: 'img_cached' });
  app.coverUrlCache.set('img_cached', 'blob:mock-url');

  app.openEditShowModal(s.id);
  // 同步分支：无需 await
  const img = w.document.querySelector('#coverLocalPreview img');
  ok(!!img, '命中缓存时同步渲染出图片');
  ok(img.getAttribute('src') === 'blob:mock-url', '图片 src 等于缓存中的 objectURL');
});

test('观影I hydrateCoverPicker 空 key 不渲染且不抛错', (w) => {
  const app = w.__app;
  app.Store.reset();
  let threw = false;
  try {
    app.openAddShowModal(); // 新增时无封面 key
  } catch (e) { threw = true; }
  ok(!threw, '新增弹窗打开不抛错');
  const preview = w.document.getElementById('coverLocalPreview');
  ok(preview && preview.innerHTML === '', '无封面时本地面板保持为空');
});

test('观影I 编辑 URL 封面：链接面板回填、本地面板为空', (w) => {
  const app = w.__app;
  app.Store.reset();
  const s = app.Store.addShow({ title: '链接封面剧' });
  app.Store.updateShow(s.id, { coverType: 'url', coverUrl: 'https://example.com/p.jpg' });

  app.openEditShowModal(s.id);
  ok(w.document.getElementById('coverUrlInput').value === 'https://example.com/p.jpg', '链接输入框回填原链接');
  ok(w.document.getElementById('coverLocalPreview').innerHTML === '', 'URL 型封面时本地面板为空');
  const urlTab = w.document.querySelector('#coverPicker .cover-tab[data-cover-tab="url"]');
  ok(urlTab.classList.contains('active'), '图片链接 tab 高亮');
});

test('观影I 网格与弹窗的 hydrate 会话互不冲刷', (w) => {
  const app = w.__app;
  app.Store.reset();
  ['甲', '乙', '丙'].forEach((t, i) => {
    const s = app.Store.addShow({ title: t, status: 'watching' });
    app.Store.updateShow(s.id, { coverType: 'local', coverKey: 'img_' + i });
  });
  app.switchPage('shows');
  const gridRoot = w.document.getElementById('showsSections');
  const tokenBefore = app.coverTokens.get(gridRoot);
  ok(typeof tokenBefore === 'number', '网格 root 已记录 token');

  // 打开详情弹窗（另一个 hydrate 会话，root = #modal）
  const first = app.Store.getShows()[0];
  app.openShowDetail(first.id);

  ok(app.coverTokens.get(gridRoot) === tokenBefore, '弹窗 hydrate 未改动网格的 token（会话隔离）');
  ok(typeof app.coverTokens.get(w.document.getElementById('modal')) === 'number', '弹窗 root 拥有独立 token');

  // 再次 renderShows 才会递增网格自己的 token
  app.renderShows();
  ok(app.coverTokens.get(gridRoot) === tokenBefore + 1, '同一 root 再渲染时 token 正常递增（防竞态能力保留）');
});

test('观影I 编辑时不改封面 → 保留旧 key 且不删除', (w) => {
  const app = w.__app;
  app.Store.reset();
  const s = app.Store.addShow({ title: '原名', status: 'watching' });
  app.Store.updateShow(s.id, { coverType: 'local', coverKey: 'img_keep' });

  app.openEditShowModal(s.id);
  w.document.getElementById('showTitle').value = '改后的名字';
  click(w, w.document.getElementById('modalOk'));

  const after = app.Store.getShow(s.id);
  ok(after.title === '改后的名字', '名字已更新');
  ok(after.coverKey === 'img_keep', '未动封面时保留原 coverKey');
  ok(after.coverType === 'local', '封面类型保持 local');
});

test('观影I 编辑时切到链接 tab → 采用 URL 且清空 key', (w) => {
  const app = w.__app;
  app.Store.reset();
  const s = app.Store.addShow({ title: '换链接剧' });
  app.Store.updateShow(s.id, { coverType: 'local', coverKey: 'img_old' });

  app.openEditShowModal(s.id);
  click(w, w.document.querySelector('#coverPicker .cover-tab[data-cover-tab="url"]'));
  const input = w.document.getElementById('coverUrlInput');
  input.value = 'https://example.com/new.jpg';
  input.dispatchEvent(new w.Event('input', { bubbles: true }));
  click(w, w.document.getElementById('modalOk'));

  const after = app.Store.getShow(s.id);
  ok(after.coverType === 'url', '封面类型切换为 url');
  ok(after.coverUrl === 'https://example.com/new.jpg', '新链接已保存');
  ok(after.coverKey === '', 'key 已清空');
});

test('观影I 切 tab 往返不清 key（防止误删旧封面）', (w) => {
  const app = w.__app;
  app.Store.reset();
  const s = app.Store.addShow({ title: '往返剧' });
  app.Store.updateShow(s.id, { coverType: 'local', coverKey: 'img_roundtrip' });

  app.openEditShowModal(s.id);
  // url → none → local 往返切换
  click(w, w.document.querySelector('#coverPicker .cover-tab[data-cover-tab="url"]'));
  click(w, w.document.querySelector('#coverPicker .cover-tab[data-cover-tab="none"]'));
  click(w, w.document.querySelector('#coverPicker .cover-tab[data-cover-tab="local"]'));

  const r = app.readCoverPicker(w.document);
  ok(r.coverType === 'local', '切回本地面板后类型仍为 local');
  ok(r.coverKey === 'img_roundtrip', '原 key 未被清空，避免误删封面');

  click(w, w.document.getElementById('modalOk'));
  ok(app.Store.getShow(s.id).coverKey === 'img_roundtrip', '保存后封面保留');
});

/* =========================================================================
   观影模块 —— J TVmaze 搜索（全部用 fetch 桩，不依赖真实网络）
   ========================================================================= */

/** 构造一份 TVmaze search 响应 */
function tvmazeSearchBody() {
  return [
    { score: 0.9, show: { id: 919, name: 'Attack on Titan', premiered: '2013-04-07', rating: { average: 8.9 },
      genres: ['Action', 'Anime', 'Fantasy', 'Horror'], image: { medium: 'https://static.tvmaze.com/a.jpg', original: 'https://static.tvmaze.com/a-o.jpg' },
      summary: '<p>Known in Japan as <b>Shingeki no Kyojin</b> &amp; more.</p>', url: 'https://www.tvmaze.com/shows/919' } },
    { score: 0.5, show: { id: 100, name: '无图剧', premiered: '', rating: { average: null }, genres: [], image: null, summary: null, url: '' } },
  ];
}
/** 构造一份 /shows/:id/seasons 响应（含 episodeOrder 为 null 的季） */
function tvmazeSeasonsBody() {
  return [
    { number: 1, premiereDate: '2013-04-07', endDate: '2015-04-09', episodeOrder: 25, image: { medium: 'https://static.tvmaze.com/s1.jpg' } },
    { number: 2, premiereDate: '2017-04-01', endDate: '2018-04-09', episodeOrder: 12, image: { medium: 'https://static.tvmaze.com/s2.jpg' } },
    { number: 3, premiereDate: '2018-07-22', endDate: '2019-06-30', episodeOrder: 22, image: { medium: 'https://static.tvmaze.com/s3.jpg' } },
    { number: 4, premiereDate: '2020-12-06', endDate: '2023-11-05', episodeOrder: null, image: { medium: 'https://static.tvmaze.com/s4.jpg' } },
  ];
}

/** 构造一份 /shows/:id/akas 响应（含简繁各一 + 非 CN + 非中文） */
function tvmazeAkasBody() {
  return [
    { name: 'Кино', country: { code: 'RU', name: 'Russia' } },
    { name: '進擊的巨人', country: { code: 'CN', name: 'China' } },
    { name: '进击的巨人', country: { code: 'CN', name: 'China' } },
    { name: 'Attack on Titan', country: { code: 'US', name: 'United States' } },
  ];
}
/** 只有繁体、没有简体的 akas（用于验证回退到第一条 CN） */
function tvmazeAkasTradOnlyBody() {
  return [
    { name: '絕命毒師', country: { code: 'CN', name: 'China' } },
    { name: 'Heisenberg', country: { code: 'DE', name: 'Germany' } },
  ];
}

test('观影J stripHtml 去标签与实体', (w) => {
  const f = w.__app.stripHtml;
  ok(f('<p>Hello <b>world</b></p>') === 'Hello world', '标签被移除');
  ok(f('A &amp; B &lt;C&gt;') === 'A & B <C>', '实体被解码');
  ok(f(null) === '' && f(undefined) === '', '空值返回空字符串');
  ok(f('多   空格') === '多 空格', '连续空白被压缩');
});

test('观影J tvmazeSearchShows 正常映射结果', async (w) => {
  const app = w.__app;
  withFetch(w, (url) => {
    if (url.indexOf('/search/shows') > -1) return { body: tvmazeSearchBody() };
    return null;
  });
  const list = await app.tvmazeSearchShows('进击的巨人');
  ok(list.length === 2, '返回 2 条结果');
  const a = list[0];
  ok(a.id === '919' && a.name === 'Attack on Titan', 'id 与名称正确');
  ok(a.year === 2013, 'premiered 提取年份');
  ok(a.rating === 8.9, '评分正确');
  ok(a.genreText === 'Action / Anime / Fantasy / Horror', '类型数组已拼接');
  ok(a.summary.indexOf('<') < 0 && a.summary.indexOf('Shingeki no Kyojin') > -1, '简介去标签且保留文本');
  ok(list[1].image === '' && list[1].rating === null, '缺失字段安全降级');
});

test('观影J tvmazeSearchShows 网络失败返回空数组且不抛错', async (w) => {
  const app = w.__app;
  withFetch(w, () => ({ reject: new Error('boom') }));
  let threw = false;
  let list = null;
  try { list = await app.tvmazeSearchShows('任意'); } catch (e) { threw = true; }
  ok(!threw, '不抛异常');
  ok(Array.isArray(list) && list.length === 0, '返回空数组');
});

test('观影J tvmazeSearchShows 服务端错误返回空数组', async (w) => {
  const app = w.__app;
  withFetch(w, () => ({ ok: false, status: 503, body: null }));
  const list = await app.tvmazeSearchShows('任意');
  ok(Array.isArray(list) && list.length === 0, '非 200 响应返回空数组');
});

test('观影J tvmazeSearchShows 空关键词不发请求', async (w) => {
  const app = w.__app;
  let called = false;
  withFetch(w, () => { called = true; return { body: [] }; });
  const list = await app.tvmazeSearchShows('   ');
  ok(called === false, '空关键词不发起请求');
  ok(list.length === 0, '返回空数组');
});

test('观影J tvmazeGetSeasons 含集数未知的季仍返回', async (w) => {
  const app = w.__app;
  withFetch(w, () => ({ body: tvmazeSeasonsBody() }));
  const seasons = await app.tvmazeGetSeasons('919');
  ok(seasons.length === 4, '返回 4 季');
  ok(seasons[2].number === 3 && seasons[2].episodeOrder === 22, '第 3 季 22 集');
  ok(seasons[3].episodeOrder === null, '第 4 季集数未知保留为 null');
  ok(seasons[3].epText === '集数未知', '未知集数显示为「集数未知」');
  ok(seasons[0].label === '第 1 季', '季标签正确');
});

test('观影J tvmazeGetSeasons 失败返回空数组', async (w) => {
  const app = w.__app;
  withFetch(w, () => ({ reject: new Error('down') }));
  const seasons = await app.tvmazeGetSeasons('919');
  ok(Array.isArray(seasons) && seasons.length === 0, '失败返回空数组');
  const empty = await app.tvmazeGetSeasons('');
  ok(empty.length === 0, '空 id 返回空数组');
});

test('观影J tvmazeSeasonTitle 季号拼接规则', (w) => {
  const f = w.__app.tvmazeSeasonTitle;
  ok(f('进击的巨人', 1) === '进击的巨人', '第 1 季不追加数字');
  ok(f('进击的巨人', 2) === '进击的巨人2', '第 2 季追加 2');
  ok(f('进击的巨人', 10) === '进击的巨人10', '第 10 季追加 10');
  ok(f('剧名', null) === '剧名', '季号未知不追加');
});

test('观影J tvmazeSeasonToFields 字段映射完整', (w) => {
  const app = w.__app;
  const show = app.mapTvmazeShow(tvmazeSearchBody()[0].show);
  const season = (() => { const raw = tvmazeSeasonsBody()[2]; return { number: 3, episodeOrder: 22, premiereDate: raw.premiereDate, image: raw.image.medium }; })();
  const f = app.tvmazeSeasonToFields(show, season);
  ok(f.title === 'Attack on Titan3', '标题含季号');
  ok(f.originalTitle === '', 'v3.2 起不再回填原文标题（保持整洁）');
  ok(f.year === 2018, '年份取该季首播年');
  ok(f.genre === 'Action / Anime / Fantasy / Horror', '类型拼接');
  ok(f.rating === 8.9, '评分');
  ok(f.currentSeasonEpisodes === 22, '本季集数来自 episodeOrder');
  ok(f.coverUrl === 'https://static.tvmaze.com/s3.jpg', '封面取该季海报');
  ok(f.externalId === '919', 'externalId 记录剧 id');
});

test('观影J tvmazeSeasonToFields 第 1 季无数字后缀', (w) => {
  const app = w.__app;
  const show = app.mapTvmazeShow(tvmazeSearchBody()[0].show);
  const f = app.tvmazeSeasonToFields(show, { number: 1, episodeOrder: 25, premiereDate: '2013-04-07', image: 'https://static.tvmaze.com/s1.jpg' });
  ok(f.title === 'Attack on Titan', '第 1 季标题不加后缀');
  ok(f.originalTitle === '', '原文标题始终留空');
  ok(f.year === 2013, '年份取第 1 季首播年');
});

test('观影J tvmazeSeasonToFields 集数未知时留空', (w) => {
  const app = w.__app;
  const show = app.mapTvmazeShow(tvmazeSearchBody()[0].show);
  const f = app.tvmazeSeasonToFields(show, { number: 4, episodeOrder: null, premiereDate: '2020-12-06', image: '' });
  ok(f.currentSeasonEpisodes === '', '集数未知留空而非 0');
  ok(f.coverUrl === show.image, '该季无海报时回退到剧集主海报');
});

/* ---------- v3.2 中文标题 ---------- */

test('观影J pickChineseAka 优先取简体中文名', (w) => {
  const f = w.__app.pickChineseAka;
  ok(f(tvmazeAkasBody()) === '进击的巨人', '简繁并存时选简体');
  ok(f(tvmazeAkasTradOnlyBody()) === '絕命毒師', '只有繁体时回退到第一条 CN 别名');
  ok(f([]) === '', '空数组返回空串');
  ok(f(null) === '' && f(undefined) === '', '非数组返回空串');
  ok(f([{ name: 'Attack on Titan', country: { code: 'US' } }]) === '', '只有非 CN 别名返回空串');
  ok(f([{ name: '  甄嬛传  ', country: { code: 'CN' } }]) === '甄嬛传', '首尾空白被裁掉');
  ok(f([{ name: 'Lang ya bang', country: { code: 'CN' } }]) === '', '纯拼音的 CN 别名不算中文名（琅琊榜实例）');
  ok(f([{ name: 'Lang ya bang', country: { code: 'CN' } }, { name: '琅琊榜', country: { code: 'CN' } }]) === '琅琊榜',
    '拼音与中文并存时取中文');
});

test('观影J pickChineseAka 合并别名「简体 / 繁体」取简体半边', (w) => {
  const f = w.__app.pickChineseAka;
  const body = [{ name: '绝命毒师 / 絕命毒師', country: { code: 'CN' } }];
  ok(f(body) === '绝命毒师', '斜杠合并形态取简体那半');
  // 真正的并列剧名（两侧都是简体）不应被裁
  const par = [{ name: '琅琊榜 / 伪装者', country: { code: 'CN' } }];
  ok(f(par) === '琅琊榜 / 伪装者', '两侧均为简体时不误裁');
  ok(w.__app.stripTradHalf('欢乐颂') === '欢乐颂', '无斜杠原样返回');
  ok(w.__app.stripTradHalf('') === '', '空串安全');
});

test('观影J tvmazeGetChineseTitle 取回中文名', async (w) => {
  const app = w.__app;
  withFetch(w, (url) => {
    if (url.indexOf('/akas') > -1) return { body: tvmazeAkasBody() };
    return null;
  });
  const cn = await app.tvmazeGetChineseTitle('919');
  ok(cn === '进击的巨人', '从 akas 取到简体中文名');
});

test('观影J tvmazeGetChineseTitle 失败/无中文名一律返回空串且不抛错', async (w) => {
  const app = w.__app;
  withFetch(w, () => ({ reject: new Error('down') }));
  let threw = false;
  let cn = 'x';
  try { cn = await app.tvmazeGetChineseTitle('919'); } catch (e) { threw = true; }
  ok(!threw, '不抛异常');
  ok(cn === '', '网络失败返回空串');

  withFetch(w, () => ({ body: [{ name: 'The Office', country: { code: 'US' } }] }));
  ok(await app.tvmazeGetChineseTitle('526') === '', '无 CN 别名返回空串');

  const empty = await app.tvmazeGetChineseTitle('');
  ok(empty === '', '空 id 返回空串且不发请求');
});

test('观影J tvmazeSeasonToFields 传入中文名时标题用中文', (w) => {
  const app = w.__app;
  const show = app.mapTvmazeShow(tvmazeSearchBody()[0].show);
  const season = { number: 3, episodeOrder: 22, premiereDate: '2018-07-22', image: 'https://static.tvmaze.com/s3.jpg' };
  const f = app.tvmazeSeasonToFields(show, season, '进击的巨人');
  ok(f.title === '进击的巨人3', '中文名 + 季号');
  ok(f.originalTitle === '', '原文标题仍留空');
  ok(f.externalId === '919', '其余字段不受影响');
  // 未传中文名时退回英文
  const en = app.tvmazeSeasonToFields(show, season);
  ok(en.title === 'Attack on Titan3', '无中文名退回英文原名');
  // 传空串等同未传
  ok(app.tvmazeSeasonToFields(show, season, '').title === 'Attack on Titan3', '空串等同未传');
  // 第 1 季中文名不加后缀
  const s1 = app.tvmazeSeasonToFields(show, { number: 1, episodeOrder: 25, premiereDate: '2013-04-07', image: '' }, '进击的巨人');
  ok(s1.title === '进击的巨人', '第 1 季中文名不加后缀');
});

test('观影J 选剧后再选季：标题用中文名（端到端）', async (w) => {
  const app = w.__app;
  app.Store.reset();
  app.openAddShowModal();
  const d = w.document;
  withFetch(w, (url) => {
    if (url.indexOf('/search/shows') > -1) return { body: tvmazeSearchBody() };
    if (url.indexOf('/seasons') > -1) return { body: tvmazeSeasonsBody() };
    if (url.indexOf('/akas') > -1) return { body: tvmazeAkasBody() };
    return null;
  });
  const btn = d.getElementById('tvmazeSearchBtn');
  d.getElementById('tvmazeQuery').value = '进击的巨人';
  btn.dispatchEvent(new w.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 40));
  const results = d.querySelectorAll('#tvmazeResults .tvmaze-result');
  ok(results.length === 2, '搜索出 2 条结果');
  results[0].dispatchEvent(new w.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 60));
  const seasons = d.querySelectorAll('#tvmazeSeasons .tvmaze-season');
  ok(seasons.length === 4, '季列表渲染 4 季');
  seasons[2].dispatchEvent(new w.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 60));
  ok(d.getElementById('showTitle').value === '进击的巨人3', '标题最终为中文名 + 季号');
  ok(d.getElementById('showOriginalTitle').value === '', '原文标题保持为空');
  ok(d.getElementById('showYear').value === '2018', '年份被填入');
  ok(d.getElementById('showSeasonEpisodes').value === '22', '集数被填入');
});

test('观影J 无中文名时退回英文并在状态行提示（端到端）', async (w) => {
  const app = w.__app;
  app.Store.reset();
  app.openAddShowModal();
  const d = w.document;
  withFetch(w, (url) => {
    if (url.indexOf('/search/shows') > -1) return { body: tvmazeSearchBody() };
    if (url.indexOf('/seasons') > -1) return { body: tvmazeSeasonsBody() };
    if (url.indexOf('/akas') > -1) return { body: [{ name: 'Attack on Titan', country: { code: 'US' } }] };
    return null;
  });
  d.getElementById('tvmazeQuery').value = 'Attack on Titan';
  d.getElementById('tvmazeSearchBtn').dispatchEvent(new w.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 40));
  const first = d.querySelector('#tvmazeResults .tvmaze-result');
  first.dispatchEvent(new w.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 60));
  const status = d.getElementById('tvmazeStatus');
  ok(status.textContent.indexOf('暂无中文译名') > -1, '状态行给出中文名缺失的提示');
  const seasons = d.querySelectorAll('#tvmazeSeasons .tvmaze-season');
  ok(seasons.length === 4, '季列表照常渲染（不被提示打断）');
  seasons[2].dispatchEvent(new w.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 60));
  ok(d.getElementById('showTitle').value === 'Attack on Titan3', '退回英文原名加季号');
});

test('观影J applyTvmazeFields 只填空、绝不覆盖已有内容', (w) => {
  const app = w.__app;
  app.Store.reset();
  app.openAddShowModal();
  const d = w.document;
  d.getElementById('showTitle').value = '我自己的标题';
  d.getElementById('showYear').value = '1999';
  const filled = app.applyTvmazeFields({
    title: 'Attack on Titan3', originalTitle: 'Attack on Titan', year: 2018,
    genre: 'Action', rating: 8.9, summary: '简介', currentSeasonEpisodes: 22, coverUrl: 'https://static.tvmaze.com/s3.jpg',
  }, app.coverPickerState);
  ok(d.getElementById('showTitle').value === '我自己的标题', '已填标题不被覆盖');
  ok(d.getElementById('showYear').value === '1999', '已填年份不被覆盖');
  ok(d.getElementById('showOriginalTitle').value === 'Attack on Titan', '空字段被填入');
  ok(d.getElementById('showGenre').value === 'Action', '空类型被填入');
  ok(d.getElementById('showSeasonEpisodes').value === '22', '空集数被填入');
  ok(filled.indexOf('标题') < 0, '反馈中不含被跳过的标题');
  ok(filled.indexOf('年份') < 0, '反馈中不含被跳过的年份');
});

test('观影J applyTvmazeFields 绝不触碰观后感 / 备注', (w) => {
  const app = w.__app;
  app.Store.reset();
  app.openAddShowModal();
  const d = w.document;
  // 用户已写观后感
  d.getElementById('showNote').value = '我的私人观后感';
  app.applyTvmazeFields({
    title: '剧名', summary: 'API 简介', note: '绝不应写入的备注', currentSeasonEpisodes: 10,
  }, app.coverPickerState);
  ok(d.getElementById('showNote').value === '我的私人观后感', '已有观后感原样保留');
  // 即使用户没写，也不应被 API 内容填充
  d.getElementById('showNote').value = '';
  app.applyTvmazeFields({ title: '剧名', note: '绝不应写入的备注' }, app.coverPickerState);
  ok(d.getElementById('showNote').value === '', '观后感不会被 API 填充');
});

test('观影J 封面仅在「无封面」时被 TVmaze 填充', (w) => {
  const app = w.__app;
  app.Store.reset();
  app.openAddShowModal();
  const state = app.coverPickerState;
  // 场景 1：无封面 → 应填入
  state.type = 'none';
  app.applyTvmazeFields({ coverUrl: 'https://static.tvmaze.com/s3.jpg', title: 'T' }, state);
  ok(state.type === 'url', '无封面时采用 TVmaze 海报');
  ok(state.url === 'https://static.tvmaze.com/s3.jpg', 'URL 已写入状态');
});

test('观影J 已有本地封面时不被 TVmaze 覆盖', (w) => {
  const app = w.__app;
  app.Store.reset();
  app.openAddShowModal();
  const state = app.coverPickerState;
  state.type = 'local';
  state.key = 'img_mine';
  app.applyTvmazeFields({ coverUrl: 'https://static.tvmaze.com/s3.jpg', title: 'T' }, state);
  ok(state.type === 'local', '封面类型仍为本地');
  ok(state.key === 'img_mine', '本地封面 key 保留');
  ok(state.url === '', '未被写入 TVmaze 链接');
});

test('观影J 搜索区状态提示可切换且支持错误态', (w) => {
  const app = w.__app;
  app.Store.reset();
  app.openAddShowModal();
  const d = w.document;
  app.setTvmazeStatus('搜索中…', 'loading');
  ok(d.getElementById('tvmazeStatus').hidden === false, '状态行可见');
  ok(d.getElementById('tvmazeStatus').className.indexOf('is-loading') > -1, 'loading 样式生效');
  app.setTvmazeStatus('TVmaze 暂时不可用，请手动填写。', 'error');
  ok(d.getElementById('tvmazeStatus').textContent.indexOf('手动填写') > -1, '错误提示文案正确');
  ok(d.getElementById('tvmazeStatus').className.indexOf('is-error') > -1, 'error 样式生效');
  app.setTvmazeStatus('');
  ok(d.getElementById('tvmazeStatus').hidden === true, '空状态隐藏状态行');
});

test('观影J 搜索无结果时给出提示且表单仍可提交', (w) => {
  const app = w.__app;
  app.Store.reset();
  app.openAddShowModal();
  const d = w.document;
  app.renderTvmazeShows([]);
  ok(d.getElementById('tvmazeStatus').textContent.indexOf('没有找到') > -1, '无结果提示');
  // 手动填写仍能正常提交（网络不可用不阻塞）
  d.getElementById('showTitle').value = '手动添加的剧';
  click(w, d.getElementById('modalOk'));
  const shows = app.Store.getShows();
  ok(shows.length === 1 && shows[0].title === '手动添加的剧', '手动填写仍可正常添加');
});

test('观影J TVmaze 不可用时搜索不阻塞表单（端到端）', async (w) => {
  const app = w.__app;
  app.Store.reset();
  app.openAddShowModal();
  const d = w.document;
  withFetch(w, () => ({ reject: new Error('offline') }));
  d.getElementById('tvmazeQuery').value = '任意剧名';
  click(w, d.getElementById('tvmazeSearchBtn'));
  await new Promise((r) => setTimeout(r, 30));
  ok(d.getElementById('tvmazeStatus').textContent.length > 0, '出现失败提示');
  ok(d.getElementById('showTitle') !== null, '表单依然可用');
});

test('观影J externalId 可由 TVmaze 结果写入并持久化', (w) => {
  const app = w.__app;
  app.Store.reset();
  const s = app.Store.addShow({ title: '带外部ID的剧', externalId: '919', currentSeasonEpisodes: 22 });
  ok(s.externalId === '919', 'externalId 已写入');
  ok(app.Store.getShow(s.id).externalId === '919', '持久化后可读回');
});

/* =========================================================================
   英语单词模块 —— K 数据 / 渲染 / 交互
   ========================================================================= */
test('单词K 导航新增「英语单词」页且骨架齐备', (w) => {
  const nav = w.document.querySelector('.nav-item[data-page="words"]');
  ok(!!nav, '侧边栏存在「英语单词」导航项');
  ok(nav.textContent.indexOf('英语单词') > -1, '导航文案为「英语单词」');
  click(w, nav);
  const page = w.document.getElementById('page-words');
  ok(!!page && page.classList.contains('active'), '点击后切换到英语单词页');
  ok(!!w.document.getElementById('wordAddBtn'), '页头有「新增卡片」按钮');
  ok(!!w.document.getElementById('wordBoard'), '存在卡片板容器 #wordBoard');
});

test('单词K 空态渲染正确', (w) => {
  const app = w.__app;
  app.Store.reset();
  app.renderWords();
  const board = w.document.getElementById('wordBoard');
  ok(board.querySelector('.empty') !== null, '无卡片时显示空态');
  ok(board.textContent.indexOf('还没有单词卡片') > -1, '空态文案正确');
});

test('单词K parseWordsInput：一行一个、去空行、去重、限长', (w) => {
  const p = w.__app.parseWordsInput;
  ok(JSON.stringify(p('affect\neffect\ninfect')) === JSON.stringify(['affect', 'effect', 'infect']), '按行解析为单词数组');
  ok(p('').length === 0, '空文本解析为空数组');
  ok(p('\n  \n\n').length === 0, '只有空行时解析为空数组');
  const d = p('affect\nAFFECT\nEffect');
  ok(d.length === 2 && d[0] === 'affect' && d[1] === 'Effect', '大小写不敏感去重且保留先出现者');
  ok(p('  affect  ')[0] === 'affect', '首尾空白被裁剪');
  ok(p('a'.repeat(80))[0].length === w.__app.WORD_MAX_LEN, '超长单词被截断到上限');
});

test('单词K 新增卡片：单个单词也是一张卡', (w) => {
  const app = w.__app;
  app.Store.reset();
  app.renderWords();
  click(w, w.document.getElementById('wordAddBtn'));
  ok(w.document.getElementById('modalMask').classList.contains('show'), '弹窗已打开');
  setVal(w, w.document.getElementById('wordInput'), 'conscientious');
  click(w, w.document.getElementById('modalOk'));
  const cards = app.Store.getWordCards();
  ok(cards.length === 1, '新增了 1 张卡片');
  ok(cards[0].words.length === 1, '单个单词存为只有 1 个词的卡');
  ok(cards[0].words[0].text === 'conscientious', '单词文本正确');
  ok(typeof cards[0].words[0].id === 'string' && cards[0].words[0].id.length > 0, '每个词有稳定 id（便于后续挂释义）');
  const domCards = w.document.querySelectorAll('#wordBoard .word-card');
  ok(domCards.length === 1, '卡片板渲染出 1 张卡');
  ok(domCards[0].textContent.indexOf('conscientious') > -1, '卡片显示该单词');
});

test('单词K 一组形近词存一卡，卡内一词一行', (w) => {
  const app = w.__app;
  app.Store.reset();
  app.renderWords();
  click(w, w.document.getElementById('wordAddBtn'));
  setVal(w, w.document.getElementById('wordInput'), 'affect\neffect\ninfect');
  ok(w.document.getElementById('wordHint').textContent.indexOf('3') > -1, '输入时实时统计词数');
  click(w, w.document.getElementById('modalOk'));
  const card = app.Store.getWordCards()[0];
  ok(card.words.length === 3, '一张卡存下 3 个形近词');
  const el = w.document.querySelector('#wordBoard .word-card');
  ok(el.querySelectorAll('.word-item').length === 3, '每个词各占一行（3 个 .word-item）');
  ok(el.querySelector('.word-card-count').textContent.indexOf('3') > -1, '卡片头部显示词数');
});

test('单词K 空输入被拒绝，弹窗不关闭', (w) => {
  const app = w.__app;
  app.Store.reset();
  app.renderWords();
  click(w, w.document.getElementById('wordAddBtn'));
  setVal(w, w.document.getElementById('wordInput'), '   \n\n  ');
  click(w, w.document.getElementById('modalOk'));
  ok(app.Store.getWordCards().length === 0, '没有创建空卡片');
  ok(w.document.getElementById('modalMask').classList.contains('show'), '弹窗保持打开以便继续输入');
});

test('单词K 编辑卡片：已有单词回填并可替换整组', (w) => {
  const app = w.__app;
  app.Store.reset();
  const c = app.Store.addWordCard({ words: ['affect', 'effect', 'infect'] });
  app.renderWords();
  click(w, w.document.querySelector('#wordBoard .word-card button[data-act="edit"]'));
  const ta = w.document.getElementById('wordInput');
  ok(ta.value === 'affect\neffect\ninfect', '已有单词按行回填到文本框');
  setVal(w, ta, 'desert\ndessert');
  click(w, w.document.getElementById('modalOk'));
  const after = app.Store.getWordCard(c.id);
  ok(after.words.length === 2, '整组词被替换为 2 个');
  ok(after.words[0].text === 'desert' && after.words[1].text === 'dessert', '新词内容正确');
  ok(w.document.querySelectorAll('#wordBoard .word-item').length === 2, '界面同步更新');
});

test('单词K 删除需二次确认，取消不删', (w) => {
  const app = w.__app;
  app.Store.reset();
  app.Store.addWordCard({ words: ['desert', 'dessert'] });
  app.renderWords();
  click(w, w.document.querySelector('#wordBoard .word-card button[data-act="delete"]'));
  ok(w.document.getElementById('modal').textContent.indexOf('desert') > -1, '确认弹窗展示将要删除的单词');
  click(w, w.document.getElementById('modalCancel'));
  ok(app.Store.getWordCards().length === 1, '取消后卡片仍在');
  click(w, w.document.querySelector('#wordBoard .word-card button[data-act="delete"]'));
  click(w, w.document.getElementById('modalOk'));
  ok(app.Store.getWordCards().length === 0, '确认后卡片被删除');
  ok(w.document.querySelector('#wordBoard .empty') !== null, '删空后回到空态');
});

test('单词K 用户输入渲染前转义（防 XSS）', (w) => {
  const app = w.__app;
  app.Store.reset();
  app.Store.addWordCard({ words: ['<img src=x onerror=alert(1)>'] });
  app.renderWords();
  const html = w.document.getElementById('wordBoard').innerHTML;
  ok(html.indexOf('&lt;img') > -1, '尖括号被转义为实体');
  ok(html.indexOf('<img') === -1, '未注入真实 <img> 元素');
});

test('单词K normalizeWordCard：空卡丢弃 / 同卡去重 / 容错', (w) => {
  const n = w.__app.normalizeWordCard;
  ok(n({ words: [] }) === false, '空数组卡片被丢弃');
  ok(n({ words: ['   ', ''] }) === false, '全是空白词的卡片被丢弃');
  ok(n({ words: 'not-an-array' }) === false, 'words 非数组时安全拒绝');
  ok(n(null) === false, 'null 安全拒绝');
  const c = { words: ['Affect', 'affect', 'effect'] };
  ok(n(c) === true, '合法卡片通过');
  ok(c.words.length === 2, '同一张卡内大小写不敏感去重');
  ok(c.words[0].text === 'Affect' && c.words[1].text === 'effect', '保留先出现的写法');
  ok(typeof c.id === 'string' && !!c.id, '补齐卡片 id');
  ok(typeof c.createdAt === 'number' && typeof c.updatedAt === 'number', '补齐时间戳');
});

test('单词K normalizeWord 兼容字符串与对象两种写法', (w) => {
  const n = w.__app.normalizeWord;
  const a = n('conscientious');
  ok(a && a.text === 'conscientious' && typeof a.id === 'string', '字符串输入被规整为对象');
  const b = n({ id: 'w_fixed', text: '  desert  ' });
  ok(b.id === 'w_fixed' && b.text === 'desert', '对象输入保留 id 并裁剪空白');
  ok(n('') === false && n('   ') === false, '空词返回 false');
  ok(n(null) === false, 'null 返回 false');
});

test('单词K filterWordCards / sortWordCards 纯函数', (w) => {
  const { filterWordCards, sortWordCards } = w.__app;
  const list = [
    { id: '1', words: [{ text: 'affect' }, { text: 'effect' }], updatedAt: 10 },
    { id: '2', words: [{ text: 'desert' }], updatedAt: 30 },
  ];
  ok(filterWordCards(list, '').length === 2, '空关键词返回全部');
  ok(filterWordCards(list, 'AFF').length === 1, '匹配卡内任意单词且不区分大小写');
  ok(filterWordCards(list, 'zzz').length === 0, '无匹配返回空');
  const sorted = sortWordCards(list);
  ok(sorted[0].id === '2', '按最近更新倒序排列');
  ok(list[0].id === '1', '不修改原数组');
});

test('单词K v5 旧数据迁移：补 wordCards 空数组且不破坏原数据', (w) => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const legacy = JSON.stringify({
    version: 5, appName: '测试', customNav: [],
    transactions: [{ id: 't1', type: 'expense', amount: 20, category: '奶茶', account: 'wechat', date: '2026-01-05', createdAt: 1 }],
    budgets: { '2026-01': 800 }, vault: { wechat_change: 50, wechat_lct: 0, alipay: 0, bank: 0 },
    shows: [], watchLogs: [],
  });
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true });
  dom.window.localStorage.setItem('life_assistant_v1', legacy);
  dom.window.eval('(function(){' + fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8') +
    'window.__app={Store, DATA_VERSION, normalizeWordCard};})();');
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded', { bubbles: true }));
  const d = dom.window.__app.Store.data;
  ok(d.version === 6, 'v5 → v6 升级成功');
  ok(Array.isArray(d.wordCards) && d.wordCards.length === 0, 'wordCards 补为空数组');
  ok(d.transactions.length === 1, '原有交易未被破坏');
  ok(d.budgets['2026-01'] === 800, '原有预算未被破坏');
  ok(d.vault.wechat_change === 50, '原有金库未被破坏');
});

test('单词K 样式：实体白卡 + 固定网格，复用既有 token', (w) => {
  const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  const board = css.match(/\.word-board\s*\{[^}]*\}/);
  ok(!!board && /display:\s*grid/.test(board[0]), '.word-board 用网格排列');
  ok(!!board && /repeat\(auto-fill,\s*minmax\(240px,\s*1fr\)\)/.test(board[0]), '列宽复用既有 auto-fill / minmax 范式');
  ok(!!board && /align-items:\s*start/.test(board[0]), '矮卡不拉伸');
  ok(!!board && !/[\s;{]columns\s*:/.test(board[0]), '已不再使用多列瀑布流（多列会按高度做列平衡 → 卡片换列）');
  ok(/\.word-card\s*\{[^}]*break-inside:\s*avoid/.test(css), '卡片不跨列断开');
  const m = css.match(/\.word-card\s*\{[^}]*\}/);
  ok(!!m && /var\(--surface\)/.test(m[0]), '卡片背景复用 --surface（实体白卡）');
  ok(!!m && /var\(--r-md\)/.test(m[0]), '圆角复用 --r-md');
  ok(!!m && /var\(--shadow-xs\)/.test(m[0]), '阴影复用 --shadow-xs');
});

/* =========================================================================
   英语单词 —— L 释义 / 灰条遮挡
   ========================================================================= */
test('单词L parseWordEntries：一行「单词 释义」，按第一个空白切分', (w) => {
  const p = w.__app.parseWordEntries;
  const a = p('affect v. 影响，感动\neffect n. 效果，作用');
  ok(a.length === 2, '解析出 2 条词条');
  ok(a[0].text === 'affect' && a[0].meaning === 'v. 影响，感动', '词形与释义正确');
  ok(a[1].text === 'effect' && a[1].meaning === 'n. 效果，作用', '第二条词形与释义正确');
  const b = p('ephemeral');
  ok(b.length === 1 && b[0].text === 'ephemeral' && b[0].meaning === '', '只写单词时释义为空串');
  const c = p('dessert\tn. 甜点');
  ok(c.length === 1 && c[0].text === 'dessert' && c[0].meaning === 'n. 甜点', 'Tab 同样作为词与释义的分隔符');
  const d = p('infect   v. 传染');
  ok(d[0].text === 'infect' && d[0].meaning === 'v. 传染', '多个连续空白折叠，释义不带前导空白');
  const e = p('affect 甲\nAFFECT 乙');
  ok(e.length === 1 && e[0].meaning === '甲', '按词形去重，保留先出现者');
  ok(p('\r\naffect 甲\r\n').length === 1, 'Windows 换行同样解析正确');
  ok(p('a'.repeat(80) + ' 释义')[0].text.length === w.__app.WORD_MAX_LEN, '超长单词截断到上限');
  ok(p('word ' + 'm'.repeat(120))[0].meaning.length === w.__app.MEANING_MAX_LEN, '超长释义截断到上限');
  const f = p('   甲   ');
  ok(f.length === 1 && f[0].text === '甲' && f[0].meaning === '', '行首第一个非空白片段一律视为单词');
  ok(p('\n  \n\t\n').length === 0, '纯空白行全部丢弃');
});

test('单词L parseWordsInput 契约不变：仍只返回词形字符串数组', (w) => {
  const p = w.__app.parseWordsInput;
  ok(JSON.stringify(p('affect v. 影响\neffect\ninfect n. 传染'))
    === JSON.stringify(['affect', 'effect', 'infect']), '带释义时也只返回词形');
  ok(p('').length === 0 && p('\n \n').length === 0, '空输入仍返回空数组');
  ok(w.__app.parseWordsInput('a'.repeat(80))[0].length === w.__app.WORD_MAX_LEN, '限长行为不变');
});

test('单词L normalizeWord 补齐 meaning（旧数据自动兜底）', (w) => {
  const n = w.__app.normalizeWord;
  ok(n('desert').meaning === '', '旧字符串数据兜底为空释义');
  ok(n({ id: 'w1', text: 'dessert' }).meaning === '', '缺 meaning 的对象兜底为空串');
  ok(n({ text: 'affect', meaning: '  v. 影响，感动  ' }).meaning === 'v. 影响，感动', '释义首尾空白被裁剪');
  ok(n({ text: 'word', meaning: 'm'.repeat(120) }).meaning.length === w.__app.MEANING_MAX_LEN, '释义超长截断');
  ok(n({ text: 'word', meaning: 123 }).meaning === '', '非字符串释义安全降级为空串');
  const a = n({ id: 'w_keep', text: 'effect', meaning: 'n. 效果' });
  ok(a.id === 'w_keep' && a.text === 'effect' && a.meaning === 'n. 效果', 'id / text / meaning 三者并存');
});

test('单词L mergeWordIds：编辑后按词形沿用旧 id', (w) => {
  const m = w.__app.mergeWordIds;
  const old = [{ id: 'w_a', text: 'Affect' }, { id: 'w_b', text: 'effect' }];
  const out = m([{ text: 'affect', meaning: 'v. 影响' }, { text: 'desert', meaning: '' }], old);
  ok(out[0].id === 'w_a', '词形匹配（不区分大小写）沿用旧 id');
  ok(out[1].id === undefined, '新词不带 id，交由 normalizeWord 生成');
  ok(out[0].meaning === 'v. 影响', '释义随行带出');
  ok(m([{ text: 'a', meaning: '' }], null)[0].id === undefined, 'oldWords 为空时安全');
});

test('单词L filterWordCards 同时匹配释义', (w) => {
  const f = w.__app.filterWordCards;
  const list = [
    { id: '1', words: [{ text: 'affect', meaning: '影响，感动' }], updatedAt: 1 },
    { id: '2', words: [{ text: 'desert' }], updatedAt: 2 },
  ];
  ok(f(list, '影响').length === 1, '可按中文释义搜索');
  ok(f(list, 'desert').length === 1, '词形匹配不受影响');
  ok(f(list, 'zzz').length === 0, '无匹配返回空');
  ok(f(list, '').length === 2, '空关键词返回全部');
});

test('单词L 有释义的行渲染灰条，无释义的行不渲染占位', (w) => {
  const app = w.__app;
  app.Store.reset();
  app.Store.addWordCard({ words: [{ text: 'affect', meaning: 'v. 影响，感动' }, { text: 'ephemeral' }] });
  app.renderWords();
  const items = w.document.querySelectorAll('#wordBoard .word-item');
  ok(items.length === 2, '两个词各占一行');
  ok(!!items[0].querySelector('.word-meaning-bar'), '有释义的行有灰条');
  ok(items[0].querySelector('.word-meaning-text').textContent === 'v. 影响，感动', '释义文本已渲染');
  ok(!items[1].querySelector('.word-meaning-bar'), '无释义的行不出现灰条');
  ok(!items[1].querySelector('.word-meaning'), '无释义的行不出现任何占位元素');
  ok(items[1].textContent.trim() === 'ephemeral', '无释义的行只有单词本身');
});

test('单词L 点灰条揭开、再点释义遮回，且逐词独立', (w) => {
  const app = w.__app;
  app.Store.reset();
  app.Store.addWordCard({ words: [{ text: 'affect', meaning: 'v. 影响' }, { text: 'effect', meaning: 'n. 效果' }] });
  app.renderWords();
  const row = (i) => w.document.querySelectorAll('#wordBoard .word-item')[i];
  ok(!row(0).classList.contains('on'), '默认处于遮挡态');
  ok(row(0).querySelector('.word-meaning').getAttribute('aria-pressed') === 'false', '默认 aria-pressed=false');
  click(w, row(0).querySelector('.word-meaning-bar'));
  ok(row(0).classList.contains('on'), '点灰条后该行揭开');
  ok(row(0).querySelector('.word-meaning').getAttribute('aria-pressed') === 'true', 'aria-pressed 同步为 true');
  ok(!row(1).classList.contains('on'), '另一行不受影响（逐词独立）');
  click(w, row(0).querySelector('.word-meaning-text'));
  ok(!row(0).classList.contains('on'), '再点释义重新遮回');
  ok(row(0).querySelector('.word-meaning').getAttribute('aria-pressed') === 'false', 'aria-pressed 回到 false');
  ok(!row(1).classList.contains('on'), '另一行始终未被波及');
});

test('单词L 灰条支持键盘操作（回车 / 空格）', (w) => {
  const app = w.__app;
  app.Store.reset();
  app.Store.addWordCard({ words: [{ text: 'affect', meaning: 'v. 影响' }] });
  app.renderWords();
  const box = w.document.querySelector('#wordBoard .word-meaning');
  ok(box.getAttribute('tabindex') === '0' && box.getAttribute('role') === 'button', '灰条可聚焦且语义为按钮');
  box.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  ok(box.closest('.word-item').classList.contains('on'), '回车揭开');
  box.dispatchEvent(new w.KeyboardEvent('keydown', { key: ' ', bubbles: true }));
  ok(!box.closest('.word-item').classList.contains('on'), '空格遮回');
  // 落在卡片其它位置的点击 / 回车不应误触发
  const head = w.document.querySelector('#wordBoard .word-card-count');
  click(w, head);
  ok(!w.document.querySelector('#wordBoard .word-item').classList.contains('on'), '点卡片头部不误触发揭开');
  head.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  ok(!w.document.querySelector('#wordBoard .word-item').classList.contains('on'), '卡片其它区域回车不误触发');
});

test('单词L 切换页面 / 重渲染后遮挡状态复位', (w) => {
  const app = w.__app;
  app.Store.reset();
  app.Store.addWordCard({ words: [{ text: 'affect', meaning: 'v. 影响' }] });
  app.renderWords();
  click(w, w.document.querySelector('#wordBoard .word-meaning'));
  ok(w.document.querySelector('#wordBoard .word-item').classList.contains('on'), '已揭开');
  app.switchPage('ledger');
  app.switchPage('words');
  ok(!w.document.querySelector('#wordBoard .word-item').classList.contains('on'), '重渲染后回到全部遮挡');
});

test('单词L 释义渲染前同样转义（防 XSS）', (w) => {
  const app = w.__app;
  app.Store.reset();
  app.Store.addWordCard({ words: [{ text: 'safe', meaning: '<img src=x onerror=alert(1)>' }] });
  app.renderWords();
  const html = w.document.getElementById('wordBoard').innerHTML;
  ok(html.indexOf('&lt;img') > -1, '释义里的尖括号被转义为实体');
  ok(html.indexOf('<img') === -1, '未注入真实 <img> 元素');
});

test('单词L 编辑回填带释义、保存后释义保留且词 id 不变', (w) => {
  const app = w.__app;
  app.Store.reset();
  const c = app.Store.addWordCard({ words: [{ text: 'affect', meaning: 'v. 影响' }, { text: 'effect' }] });
  const idAffect = c.words[0].id;
  app.renderWords();
  click(w, w.document.querySelector('#wordBoard .word-card button[data-act="edit"]'));
  const ta = w.document.getElementById('wordInput');
  ok(ta.value === 'affect v. 影响\neffect', '回填为「单词 释义」，无释义的词不补尾随空格');
  setVal(w, ta, 'affect v. 影响，感动\neffect n. 效果，作用');
  ok(w.document.getElementById('wordHint').textContent.indexOf('2 个含释义') > -1, '提示实时统计含释义词数');
  click(w, w.document.getElementById('modalOk'));
  const after = app.Store.getWordCard(c.id);
  ok(after.words[0].meaning === 'v. 影响，感动', '释义更新成功');
  ok(after.words[0].id === idAffect, '词 id 在编辑后保持稳定');
  ok(after.words[1].text === 'effect' && after.words[1].meaning === 'n. 效果，作用', '原本无释义的词补上了释义');
  ok(w.document.querySelectorAll('#wordBoard .word-item').length === 2, '界面同步更新');
});

test('单词L 新增卡片：空行被丢弃，释义随词存入', (w) => {
  const app = w.__app;
  app.Store.reset();
  app.renderWords();
  click(w, w.document.getElementById('wordAddBtn'));
  setVal(w, w.document.getElementById('wordInput'), 'affect v. 影响\n   \ndesert n. 沙漠');
  click(w, w.document.getElementById('modalOk'));
  const card = app.Store.getWordCards()[0];
  ok(card.words.length === 2, '空行不算词');
  ok(card.words[0].meaning === 'v. 影响' && card.words[1].meaning === 'n. 沙漠', '释义被存入数据');
});

test('单词L 旧单词数据（无 meaning）加载后自动兜底且版本不升', (w) => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const legacy = JSON.stringify({
    version: 6,
    wordCards: [{ id: 'wc_old', words: [{ id: 'w_a', text: 'affect' }, { id: 'w_b', text: 'effect' }], createdAt: 1, updatedAt: 1 }],
  });
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true });
  dom.window.localStorage.setItem('life_assistant_v1', legacy);
  dom.window.eval('(function(){' + fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8') +
    'window.__app={Store, DATA_VERSION};})();');
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded', { bubbles: true }));
  const d = dom.window.__app.Store.data;
  ok(d.version === 6 && dom.window.__app.DATA_VERSION === 6, '版本保持 6（释义走 sanitize 兜底，非结构变更）');
  ok(d.wordCards.length === 1, '旧卡片未被丢弃');
  ok(d.wordCards[0].words.length === 2, '旧单词未被丢弃');
  ok(d.wordCards[0].words[0].meaning === '', '旧词自动补空释义');
  ok(d.wordCards[0].words[0].id === 'w_a' && d.wordCards[0].words[1].id === 'w_b', '旧词 id 原样保留');
});

test('单词L 样式：灰条为绝对覆盖层 + 揭开只切可见性，复用既有 token', (w) => {
  const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  const bar = css.match(/\.word-meaning-bar\s*\{[^}]*\}/);
  ok(!!bar, '存在灰条规则');
  ok(!!bar && /position:\s*absolute/.test(bar[0]) && /inset:\s*0/.test(bar[0]), '灰条是绝对定位覆盖层，不占布局空间（零位移前提）');
  ok(!!bar && /var\(--ink-200\)/.test(bar[0]), '灰条底色复用 --ink-200');
  const short = css.match(/\.word-item\.w-short\s+\.word-meaning-bar\s*\{[^}]*\}/);
  ok(!!short && /width:\s*58px/.test(short[0]) && /height:\s*15px/.test(short[0]), '短释义仍退化成 58×15 小灰条');
  ok(!!short && /position:\s*absolute|inset:\s*auto/.test(short[0]), '小灰条同样走绝对定位，不参与布局');
  const txt = css.match(/\.word-meaning-text\s*\{[^}]*\}/);
  ok(!!txt && /visibility:\s*hidden/.test(txt[0]), '释义常驻占位、只是默认不可见 → 行高恒定');
  ok(!!txt && !/display:\s*none/.test(txt[0]), '释义不再用 display:none（那会改变布局、导致位移）');
  ok(!!txt && /var\(--ink-500\)/.test(txt[0]) && /var\(--fs-sm\)/.test(txt[0]), '释义复用次级文字色与字号 token');
  ok(/\.word-item\.on\s+\.word-meaning-bar\s*\{[^}]*display:\s*none/.test(css), '揭开后灰条让位');
  ok(/\.word-item\.on\s+\.word-meaning-text\s*\{[^}]*visibility:\s*visible/.test(css), '揭开后释义显现');
});

/* =========================================================================
   英语单词 —— M 揭开释义零位移（固定网格 + 释义常驻占位）
   ========================================================================= */
test('单词M 卡片板为固定网格，卡片永不换列', (w) => {
  const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  const board = css.match(/\.word-board\s*\{[^}]*\}/);
  ok(!!board && /display:\s*grid/.test(board[0]), '.word-board 改为网格');
  ok(!!board && /repeat\(auto-fill,\s*minmax\(240px,\s*1fr\)\)/.test(board[0]), '列宽复用既有 auto-fill / minmax 范式');
  ok(!!board && /gap:/.test(board[0]), '行列间距走网格 gap');
  ok(!!board && !/[\s;{]columns\s*:/.test(board[0]), '不再使用多列（grid-template-columns 不算）');
  ok(/@media\s*\(max-width:\s*560px\)\s*\{\s*\.word-board\s*\{[^}]*grid-template-columns:\s*1fr/.test(css), '窄屏单列');
  const card = css.match(/\.word-card\s*\{[^}]*\}/);
  ok(!!card && /margin:\s*0\s*;/.test(card[0]), '卡片外边距归零，行距交给网格 gap，避免叠加');
});

test('单词M 零位移结构契约：文字常驻占位 + 灰条绝对定位 + 揭开不重建 DOM', (w) => {
  const app = w.__app;
  app.Store.reset();
  app.Store.addWordCard({ words: [{ text: 'affect', meaning: 'v. 影响，感动' }] });
  app.renderWords();
  injectCss(w);

  const card = w.document.querySelector('#wordBoard .word-card');
  const row = w.document.querySelector('#wordBoard .word-item');
  const text = row.querySelector('.word-meaning-text');
  const bar = row.querySelector('.word-meaning-bar');

  ok(w.getComputedStyle(text).display !== 'none', '释义文字始终参与布局（不再是 display:none）');
  ok(w.getComputedStyle(text).visibility === 'hidden', '遮住时只是不可见');
  ok(w.getComputedStyle(bar).position === 'absolute', '灰条是绝对定位覆盖层，不占布局空间');

  click(w, bar);
  ok(w.getComputedStyle(text).visibility === 'visible', '揭开后释义可见');
  ok(w.getComputedStyle(bar).display === 'none', '揭开后灰条让位');
  ok(w.document.querySelector('#wordBoard .word-card') === card, '揭开不重建卡片节点');
  ok(w.document.querySelector('#wordBoard .word-item') === row, '揭开不重建词行节点');
});

test('单词M 释义短 / 长判定：纯函数 + 实测后只切 .w-short', (w) => {
  const app = w.__app;
  ok(app.isMeaningMultiline(19, 18.85) === false, '单行高 → 判为短');
  ok(app.isMeaningMultiline(38, 18.85) === true, '两行高 → 判为长');
  ok(app.isMeaningMultiline(19, 0) === true, '读不到行高 → 保守按长');
  ok(app.isMeaningMultiline(0, 18.85) === true, '量不到高度 → 保守按长');
  ok(app.isMeaningMultiline(0, 0) === true, '都量不到 → 保守按长');

  app.Store.reset();
  app.Store.addWordCard({ words: [
    { text: 'affect', meaning: 'v. 影响' },
    { text: 'abandon', meaning: 'v. 放弃，抛弃；遗弃，离弃；中止，停止' },
  ] });
  app.renderWords();
  const rows = w.document.querySelectorAll('#wordBoard .word-item');
  ok(rows.length === 2, '两个词各占一行');

  // jsdom 不实现布局，getBoundingClientRect 恒为 0：这里打桩出「单行 / 两行」两种实测结果
  rows[0].querySelector('.word-meaning-text').getBoundingClientRect = () => ({ height: 19 });
  rows[1].querySelector('.word-meaning-text').getBoundingClientRect = () => ({ height: 38 });
  const realCss = w.getComputedStyle;
  w.getComputedStyle = function (el) {
    if (el && el.classList && el.classList.contains('word-meaning-text')) return { lineHeight: '18.85px' };
    return realCss.call(w, el);
  };
  app.markWordMeaningLines(w.document.getElementById('wordBoard'));

  ok(rows[0].classList.contains('w-short'), '单行释义加 .w-short（小灰条）');
  ok(!rows[1].classList.contains('w-short'), '两行释义不加 .w-short（等大灰块）');
  w.getComputedStyle = realCss;
});

test('单词M 重算短 / 长不重建 DOM，已揭开状态不被重置', (w) => {
  const app = w.__app;
  app.Store.reset();
  app.Store.addWordCard({ words: [{ text: 'affect', meaning: 'v. 影响' }] });
  app.renderWords();
  const card = w.document.querySelector('#wordBoard .word-card');
  const row = w.document.querySelector('#wordBoard .word-item');
  click(w, row.querySelector('.word-meaning-bar'));
  ok(row.classList.contains('on'), '已揭开');

  app.markWordMeaningLines(w.document.getElementById('wordBoard'));
  ok(w.document.querySelector('#wordBoard .word-card') === card, '重算不重建卡片节点');
  ok(w.document.querySelector('#wordBoard .word-item') === row, '重算不重建词行节点');
  ok(row.classList.contains('on'), '重算后仍保持揭开状态');

  let threw = false;
  try { w.dispatchEvent(new w.Event('resize')); } catch (e) { threw = true; }
  ok(!threw, '窗口 resize 触发的重算不会抛错');
});

test('单词N 紧排：卡片跨行 = 高度 + 间距，量不到高度时退回普通网格', (w) => {
  const app = w.__app;
  const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  const packed = css.match(/\.word-board\.packed\s*\{[^}]*\}/);
  ok(!!packed, '存在 .packed 紧排规则');
  ok(!!packed && /grid-auto-rows:\s*1px/.test(packed[0]), '紧排把行高压到 1px');
  ok(!!packed && /row-gap:\s*0/.test(packed[0]), '紧排去掉行间距（间距改由跨行数承担）');
  const base = css.match(/\.word-board\s*\{[^}]*\}/);
  ok(!!base && /column-gap:\s*var\(--sp-3\)|gap:\s*var\(--sp-3\)/.test(base[0]), '基础网格仍保留既有间距 token');
  ok(app.WORD_CARD_GAP > 0, '卡片间距常量存在（与 --sp-3 一致）');

  app.Store.reset();
  app.Store.addWordCard({ words: [{ text: 'a', meaning: '甲' }] });
  app.Store.addWordCard({ words: [{ text: 'b', meaning: '乙' }] });
  app.renderWords();
  const board = w.document.getElementById('wordBoard');
  const cards = board.querySelectorAll('.word-card');
  ok(cards.length === 2, '两张卡片');
  ok(!board.classList.contains('packed'), 'jsdom 量不到高度 → 不启用紧排（宁可留空隙，也绝不叠卡）');
  ok(cards[0].style.gridRowEnd === '', '不启用紧排时不留内联跨行');

  // 打桩出真实高度后，跨行数应为 ceil(高度) + 间距（小数向上取整，保证间距不小于 GAP）
  cards[0].getBoundingClientRect = () => ({ height: 100.4 });
  cards[1].getBoundingClientRect = () => ({ height: 55 });
  app.layoutWordCardSpans(board);
  ok(board.classList.contains('packed'), '量到高度 → 启用紧排');
  ok(cards[0].style.gridRowEnd === 'span ' + (101 + app.WORD_CARD_GAP), '跨行数 = ceil(高度) + 间距');
  ok(cards[1].style.gridRowEnd === 'span ' + (55 + app.WORD_CARD_GAP), '第二张同理');

  // 又量不到（页面隐藏）→ 必须清掉内联跨行，否则残留的 span 会在普通网格里乱跨行
  cards[0].getBoundingClientRect = () => ({ height: 0 });
  app.layoutWordCardSpans(board);
  ok(!board.classList.contains('packed'), '又量不到 → 摘掉紧排');
  ok(cards[0].style.gridRowEnd === '' && cards[1].style.gridRowEnd === '', '并清掉内联跨行');
});

test('单词N 紧排不改卡片高度，揭开释义后跨行数也不变', (w) => {
  const app = w.__app;
  app.Store.reset();
  app.Store.addWordCard({ words: [{ text: 'affect', meaning: 'v. 影响，感动，假装，做作，装模作样' }] });
  app.renderWords();
  const board = w.document.getElementById('wordBoard');
  const card = board.querySelector('.word-card');
  card.getBoundingClientRect = () => ({ height: 120 });
  app.layoutWordCardSpans(board);
  const span = card.style.gridRowEnd;
  ok(span === 'span ' + (120 + app.WORD_CARD_GAP), '跨行数按卡片高度算好');
  click(w, card.querySelector('.word-meaning-bar'));
  ok(board.querySelector('.word-card') === card, '揭开不重建卡片节点');
  ok(card.style.gridRowEnd === span, '揭开后跨行数不变（卡片高度不受可见性切换影响）');
});

/* =========================================================================
   弹窗结构 & 英语单词页搜索
   ========================================================================= */

test('弹窗 操作区固定在底部：滚动区排在操作区之前', (w) => {
  const app = w.__app;
  app.Store.reset();
  app.renderWords();
  click(w, w.document.getElementById('wordAddBtn'));

  const kids = Array.prototype.slice.call(w.document.getElementById('modal').children)
    .map((el) => el.className);
  ok(kids.indexOf('modal-scroll') > -1, '内容被包进 .modal-scroll 滚动区');
  ok(kids[kids.length - 1] === 'modal-actions', '操作区是弹窗最后一个子元素（落在底部）');
  ok(kids.indexOf('modal-scroll') < kids.indexOf('modal-actions'), '滚动区排在操作区之前');

  // 全局修复：观影页的新增弹窗同样受益
  click(w, w.document.getElementById('modalCancel'));
  app.switchPage('shows');
  click(w, w.document.getElementById('showAddBtn'));
  const kids2 = Array.prototype.slice.call(w.document.getElementById('modal').children)
    .map((el) => el.className);
  ok(kids2[kids2.length - 1] === 'modal-actions', '观影页弹窗的操作区也在底部');
  ok(kids2.indexOf('modal-scroll') < kids2.indexOf('modal-actions'), '观影页滚动区同样在操作区之前');
});

test('单词O 搜索框骨架齐备且样式复用既有 token', (w) => {
  const app = w.__app;
  app.Store.reset();
  app.renderWords();
  ok(!!w.document.getElementById('wordSearch'), '存在搜索框 #wordSearch');
  ok(!!w.document.getElementById('wordResult'), '存在命中数量 #wordResult');
  ok(w.document.getElementById('wordSearch').getAttribute('placeholder').indexOf('释义') > -1, '占位文案提示可按释义搜索');

  const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  const tb = css.match(/\.word-toolbar\s*\{[^}]*\}/);
  ok(!!tb && /display:\s*flex/.test(tb[0]), '.word-toolbar 用 flex 排布');
  ok(!!tb && /var\(--sp-3\)/.test(tb[0]), '工具栏间距复用 --sp-3');
  const se = css.match(/\.word-search\s*\{[^}]*\}/);
  ok(!!se && /position:\s*relative/.test(se[0]), '.word-search 相对定位，图标绝对定位在框内');
  ok(!!se && /var\(--sp-3\)|flex:\s*1/.test(se[0]), '搜索框占满剩余宽度');
  const ic = css.match(/\.word-search\s+\.icon\s*\{[^}]*\}/);
  ok(!!ic && /var\(--ink-300\)/.test(ic[0]), '搜索图标复用 --ink-300');
  ok(!!ic && /pointer-events:\s*none/.test(ic[0]), '图标不挡输入点击');
  ok(/\.word-search\s+\.input\s*\{[^}]*padding-left:\s*36px/.test(css), '输入框左侧留出图标位');
  const rs = css.match(/\.word-result\s*\{[^}]*\}/);
  ok(!!rs && /var\(--ink-400\)/.test(rs[0]), '命中数量复用 --ink-400');
});

test('单词O 搜索按单词筛选，清空即恢复全部', (w) => {
  const app = w.__app;
  app.Store.reset();
  app.Store.addWordCard({ words: [{ text: 'affect', meaning: 'v. 影响' }, { text: 'effect', meaning: 'n. 效果' }] });
  app.Store.addWordCard({ words: [{ text: 'desert', meaning: 'n. 沙漠' }, { text: 'dessert', meaning: 'n. 甜点' }] });
  app.switchPage('words');
  ok(w.document.querySelectorAll('#wordBoard .word-card').length === 2, '未搜索时显示全部卡片');
  ok(w.document.getElementById('wordResult').textContent === '', '无关键词时不显示命中数量');

  state(w).wordQuery = 'affect';
  app.renderWords();
  ok(w.document.querySelectorAll('#wordBoard .word-card').length === 1, '只留下命中单词的卡片');
  ok(w.document.getElementById('wordResult').textContent.indexOf('1') > -1, '显示命中数量');
  ok(w.document.getElementById('wordSearch').value === 'affect', '搜索框的值随状态同步');

  state(w).wordQuery = '';
  app.renderWords();
  ok(w.document.querySelectorAll('#wordBoard .word-card').length === 2, '清空关键词恢复全部');
  ok(w.document.getElementById('wordResult').textContent === '', '命中数量随之清空');
});

test('单词O 搜索同时匹配释义', (w) => {
  const app = w.__app;
  app.Store.reset();
  app.Store.addWordCard({ words: [{ text: 'desert', meaning: 'n. 沙漠；v. 抛弃' }] });
  app.Store.addWordCard({ words: [{ text: 'stationery', meaning: 'n. 文具' }] });
  app.switchPage('words');

  state(w).wordQuery = '文具';
  app.renderWords();
  const cards = w.document.querySelectorAll('#wordBoard .word-card');
  ok(cards.length === 1, '按释义也能筛出卡片');
  ok(cards[0].textContent.indexOf('stationery') > -1, '命中的是含该释义的卡');
  state(w).wordQuery = '';
});

test('单词O 搜索无结果时显示「没有匹配」空态，并摘掉紧排模式', (w) => {
  const app = w.__app;
  app.Store.reset();
  app.Store.addWordCard({ words: [{ text: 'affect' }] });
  app.switchPage('words');
  // jsdom 不实现布局（getBoundingClientRect 恒为 0），先给卡片高度打桩，
  // 制造出「已经紧排」的状态，才能验证无结果时会把 .packed 摘掉
  Array.prototype.slice.call(w.document.querySelectorAll('#wordBoard .word-card')).forEach((c) => {
    c.getBoundingClientRect = () => ({ height: 120 });
  });
  app.layoutWordCardSpans(w.document.getElementById('wordBoard'));
  ok(w.document.getElementById('wordBoard').classList.contains('packed'), '有卡片时处于紧排模式');

  state(w).wordQuery = 'zzz不存在zzz';
  app.renderWords();
  const empty = w.document.querySelector('#wordBoard .empty');
  ok(!!empty, '无结果显示空态');
  ok(empty.textContent.indexOf('没有匹配') > -1, '无结果文案正确');
  ok(empty.textContent.indexOf('还没有单词卡片') === -1, '不误用「还没有卡片」的初始空态');
  ok(!w.document.getElementById('wordBoard').classList.contains('packed'),
    '无结果态摘掉 .packed（1px 行高会让空态塌陷）');
  state(w).wordQuery = '';
});

test('单词O 完全没有卡片时，始终显示初始空态', (w) => {
  const app = w.__app;
  app.Store.reset();
  app.switchPage('words');
  state(w).wordQuery = 'zzz';
  app.renderWords();
  const empty = w.document.querySelector('#wordBoard .empty');
  ok(!!empty && empty.textContent.indexOf('还没有单词卡片') > -1, '无卡片时优先显示初始空态');
  ok(!w.document.getElementById('wordBoard').classList.contains('packed'), '初始空态同样不带 .packed');
  state(w).wordQuery = '';
});

test('单词O 搜索不写 Store，搜索态下揭开释义仍零位移', (w) => {
  const app = w.__app;
  app.Store.reset();
  app.Store.addWordCard({ words: [{ text: 'affect', meaning: 'v. 影响；感动，假装' }] });
  app.switchPage('words');
  state(w).wordQuery = 'affect';
  app.renderWords();

  const before = JSON.stringify(app.Store.data.wordCards);
  const card = w.document.querySelector('#wordBoard .word-card');
  const span = card.style.gridRowEnd;
  click(w, card.querySelector('.word-meaning-bar'));
  ok(JSON.stringify(app.Store.data.wordCards) === before, '搜索与揭开都不写 Store');
  ok(w.document.querySelector('#wordBoard .word-card') === card, '揭开不重建卡片节点');
  ok(card.style.gridRowEnd === span, '揭开后跨行数不变');
  ok(w.document.querySelector('#wordBoard .word-item').classList.contains('on'), '搜索态下依然能揭开');
  state(w).wordQuery = '';
});

/* =========================================================================
   运行
   ========================================================================= */
console.log('个人生活助手 —— 端到端测试');
console.log('时间：' + new Date().toLocaleString('zh-CN'));

const only = process.argv[2]; // 可指定只跑某个用例关键词

/* 顺序执行，支持 async 用例（await 后再关闭 jsdom，避免断言丢失） */
(async () => {
  for (let i = 0; i < tests.length; i++) {
    const t = tests[i];
    if (only && !t.name.includes(only)) continue;
    section(`[${i + 1}] ${t.name}`);
    let w;
    try {
      w = boot();
      await t.fn(w);
    } catch (e) {
      fail++;
      failures.push(t.name + ' 抛出异常: ' + e.message);
      console.log('  \u2717 用例异常: ' + e.message);
      if (process.env.DEBUG) console.log(e.stack);
    } finally {
      if (w) w.close();
    }
  }

  console.log('\n========================================');
  console.log(`结果：通过 ${pass} / 失败 ${fail}`);
  if (failures.length) {
    console.log('\n失败项：');
    failures.forEach((f) => console.log('  - ' + f));
  }
  console.log('========================================');
  process.exit(fail ? 1 : 0);
})();
