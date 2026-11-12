/* =========================================================================
   云同步模块 —— WorkBuddy 云服务（Auth + Database）
   -------------------------------------------------------------------------
   职责：
     · 用 publicConfig 初始化 WorkBuddy 云客户端（整个 App 只初始化一次）
     · 邮箱验证码登录 / 注册 / 退出
     · 把本地账本（Store.data）整份快照推到云端；从云端拉回并覆盖本地
   设计：
     · localStorage 仍是主存储与离线兜底；登录后才与云端双向同步
     · 云端表 finance_state：一行一用户，payload JSONB 存整份账本快照
     · owner_id 由数据库 DEFAULT auth.uid() 填充，前端绝不传
   ========================================================================= */

'use strict';

/* ---------------------- 云环境配置（来自 workbuddy_cloud_service 的 publicConfig） ---------------------- */
const CLOUD_PUBLIC_CONFIG = {
  resourceId: 'wbcs_Ic9G1Hr906Nwf1glVIBUy4',
  endpoint: 'https://yucha-finance-app.app.workbuddy.host',
  oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
  publishableKey: 'wbpk_R8aZcmyhb1PrsiJmeLt3hJ_sPDCgzPRZYnePzm3oAwHR0o3S93RMI54',
};

const CLOUD_TABLE = 'finance_state';
// 自动上传保持关闭；已有云端记录允许用户确认后发送带版本条件的手动更新。
/** 登录态缓存的用户邮箱（只用于界面展示，不含敏感凭证） */
const CLOUD_EMAIL_KEY = 'life_assistant_cloud_email';

/* ---------------------- 云客户端（惰性初始化，全 App 单例） ---------------------- */
let cloudClient = null;
/** 当前会话缓存：{ user } 或 null（未登录） */
let cloudSession = null;
let cloudStatus = '待确认';
let cloudComparison = null;
let cloudCheckGeneration = 0;
let cloudExternalChange = false;

/** 初始化云客户端；SDK 未加载或不可用时返回 null（App 继续以纯本地模式运行） */
function ensureCloudClient() {
  if (cloudClient) return cloudClient;
  const WBC = window.WorkBuddyCloud;
  if (!WBC || typeof WBC.createWorkBuddyCloud !== 'function') {
    console.warn('[云同步] SDK 未加载，当前以纯本地模式运行');
    return null;
  }
  try {
    cloudClient = WBC.createWorkBuddyCloud({
      endpoint: CLOUD_PUBLIC_CONFIG.endpoint,
      oauthRelayBaseUrl: CLOUD_PUBLIC_CONFIG.oauthRelayBaseUrl,
      publishableKey: CLOUD_PUBLIC_CONFIG.publishableKey,
    });
    return cloudClient;
  } catch (e) {
    console.error('[云同步] 初始化失败', e);
    return null;
  }
}

/* ---------------------- 界面：侧边栏同步按钮 ---------------------- */
/** 刷新侧边栏「云同步」按钮的状态与文案 */
function renderSyncEntry() {
  const wrap = document.getElementById('syncIconWrap');
  const text = document.getElementById('syncText');
  const btn = document.getElementById('syncBtn');
  if (!wrap || !text || !btn) return;

  const on = isCloudSignedIn();
  wrap.innerHTML = icon(on ? 'cloud' : 'cloud-off');
  text.textContent = on ? `云同步：${cloudStatus}` : '开启云同步';
  btn.classList.toggle('on', on);
  refreshIcons(wrap);
}

/** 刷新金库页「云同步」卡片 */
function renderCloudCard() {
  const card = document.getElementById('cloudSyncCard');
  if (!card) return;
  const badge = document.getElementById('cloudSyncBadge');
  const body = document.getElementById('cloudSyncBody');
  if (!badge || !body) return;

  const signed = isCloudSignedIn();
  const email = getCloudEmail();

  badge.textContent = signed ? cloudStatus : '未登录';
  badge.classList.toggle('on', signed);

  if (!signed) {
    body.innerHTML = `
      <p class="sync-desc">登录后先比较本机与云端账本，不会自动覆盖。</p>
      <div class="sync-actions">
        <button class="btn btn-primary" id="cloudLoginBtn" type="button">
          ${icon('log-in')}登录 / 注册
        </button>
      </div>`;
    body.querySelector('#cloudLoginBtn').addEventListener('click', openLoginModal);
    refreshIcons(body);
    return;
  }

  const comparison = cloudComparison;
  const latestBackup = latestCloudRestoreBackup();
  const summary = comparison ? `
    <div class="cloud-comparison" aria-live="polite">
      <p>本机：${escapeHtml(cloudSummary(comparison.local))}</p>
      <p>云端：${comparison.remote ? escapeHtml(cloudSummary(comparison.remote.payload)) : '暂无账本'}</p>
      <p>云端更新时间：${escapeHtml(comparison.remote && comparison.remote.updated_at || '暂无')}</p>
      <p>${comparison.equal ? '两边数据一致。' : '两边数据不同，请先导出备份，再选择处理方式。'}</p>
      <p>操作涉及整份数据，包括账单、金库、观影和单词。</p>
    </div>` : '<p class="sync-desc">请先比较本机与云端；未确认前不会自动覆盖。</p>';
  body.innerHTML = `
    <p class="sync-desc">
      ${icon('cloud')}已登录：<b>${escapeHtml(email || '当前账号')}</b>
      <br><span class="sync-sub">当前状态：${escapeHtml(cloudStatus)}。自动上传已暂停，手动上传前请备份并确认其他设备没有修改云端。</span>
    </p>
    ${summary}
    <div class="sync-actions">
      <button class="btn btn-primary" id="cloudCompareBtn" type="button">
        ${icon('refresh-cw')}比较本机和云端
      </button>
      ${latestBackup ? '<button class="btn btn-ghost" id="cloudExportPreviousBtn" type="button">导出恢复前本机备份</button>' : ''}
      ${comparison ? `<button class="btn btn-ghost" id="cloudExportLocalBtn" type="button">导出本机备份</button>
      ${comparison.remote ? '<button class="btn btn-ghost" id="cloudExportRemoteBtn" type="button">导出云端备份</button>' : ''}
      <button class="btn btn-ghost" id="cloudPushBtn" type="button"${comparison.remote && comparison.remote.id && comparison.remote.updated_at ? '' : ' disabled title="没有可验证的云端版本，暂不能上传"'}>保留本地并上传</button>
      ${comparison.remote ? '<button class="btn btn-ghost" id="cloudPullBtn" type="button">恢复云端到本地</button>' : ''}
      <button class="btn btn-ghost" id="cloudLaterBtn" type="button">稍后处理</button>` : ''}
      <button class="btn btn-ghost" id="cloudLogoutBtn" type="button">${icon('log-out')}退出登录</button>
    </div>`;
  body.querySelector('#cloudCompareBtn').addEventListener('click', () => compareCloud());
  const previousBackup = body.querySelector('#cloudExportPreviousBtn');
  if (previousBackup) previousBackup.addEventListener('click', () => exportCloudSnapshot(latestBackup, '恢复前本机账本'));
  if (comparison) {
    body.querySelector('#cloudExportLocalBtn').addEventListener('click', () => exportData());
    const remoteExport = body.querySelector('#cloudExportRemoteBtn');
    if (remoteExport) remoteExport.addEventListener('click', () => exportCloudSnapshot(comparison.remote.payload));
    body.querySelector('#cloudPushBtn').addEventListener('click', () => confirmCloudAction('push'));
    const pull = body.querySelector('#cloudPullBtn');
    if (pull) pull.addEventListener('click', () => confirmCloudAction('pull'));
    body.querySelector('#cloudLaterBtn').addEventListener('click', () => { cloudComparison = null; setCloudStatus('待确认'); });
  }
  body.querySelector('#cloudLogoutBtn').addEventListener('click', cloudSignOut);
  refreshIcons(body);
}

/* ---------------------- 登录 / 注册（邮箱验证码） ---------------------- */
/** 保存本次「获取验证码」的结果，供后续提交校验使用（不跨事件丢失） */
let pendingEmailOtp = null;

function getCloudEmail() {
  try { return localStorage.getItem(CLOUD_EMAIL_KEY) || ''; } catch (_) { return ''; }
}
function setCloudEmail(email) {
  try {
    if (email) localStorage.setItem(CLOUD_EMAIL_KEY, email);
    else localStorage.removeItem(CLOUD_EMAIL_KEY);
  } catch (_) {}
}

function openLoginModal() {
  openModal(`
    <h3>${icon('cloud')}开启云同步</h3>
    <p>输入邮箱获取验证码即可登录。首次登录会自动为你创建账号。</p>
    <div class="form-field">
      <label class="field-label" for="cloudEmailInput">${icon('mail')}邮箱</label>
      <input class="input" id="cloudEmailInput" type="email" placeholder="you@example.com"
        autocomplete="email" />
    </div>
    <div class="form-field">
      <label class="field-label" for="cloudCodeInput">${icon('key-round')}验证码</label>
      <div class="otp-row">
        <input class="input" id="cloudCodeInput" type="text" inputmode="numeric"
          placeholder="6 位数字" maxlength="6" autocomplete="one-time-code" />
        <button class="btn btn-ghost otp-send" id="cloudSendBtn" type="button">获取验证码</button>
      </div>
      <div class="field-hint" id="cloudHint"></div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="modalCancel" type="button">取消</button>
      <button class="btn btn-primary" id="modalOk" type="button">${icon('log-in')}登录</button>
    </div>
  `);

  const emailEl = document.getElementById('cloudEmailInput');
  const codeEl = document.getElementById('cloudCodeInput');
  const sendBtn = document.getElementById('cloudSendBtn');
  const hint = document.getElementById('cloudHint');
  const okBtn = document.getElementById('modalOk');
  emailEl.focus();

  const setHint = (msg, isErr) => {
    hint.textContent = msg || '';
    hint.classList.toggle('err', !!isErr);
  };

  // 「获取验证码」：只负责发送。失败时不进入校验流程，也不谎称已发送。
  sendBtn.addEventListener('click', async () => {
    const email = emailEl.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setHint('请输入正确的邮箱地址', true);
      return;
    }
    const cloud = ensureCloudClient();
    if (!cloud) { setHint('云服务不可用，请检查网络后重试', true); return; }

    sendBtn.disabled = true;
    setHint('发送中…', false);
    try {
      const sent = await cloud.auth.sendOtp({ email });
      if (sent.error) { setHint(sent.error.message || '验证码发送失败', true); sendBtn.disabled = false; return; }
      pendingEmailOtp = {
        email,
        verificationId: sent.data.verificationId,
        isExistingUser: sent.data.isExistingUser,
      };
      setHint('验证码已发送，请查收邮箱（含垃圾邮件）', false);
    } catch (e) {
      setHint('验证码发送失败，请稍后重试', true);
    }
    // 重新获取时重新计时，提交按钮保持可用
    startOtpCountdown(sendBtn, setHint);
  });

  // 「登录」：使用已保存的 challenge 校验，绝不在此处重新发送验证码
  okBtn.addEventListener('click', async () => {
    const email = emailEl.value.trim();
    const code = codeEl.value.trim();
    if (!pendingEmailOtp || pendingEmailOtp.email !== email) {
      setHint('请先点击「获取验证码」', true);
      return;
    }
    if (!code) { setHint('请输入验证码', true); return; }

    const cloud = ensureCloudClient();
    if (!cloud) { setHint('云服务不可用，请检查网络后重试', true); return; }

    okBtn.disabled = true;
    setHint('登录中…', false);
    try {
      const completed = await cloud.auth.verifyOtp({
        email: pendingEmailOtp.email,
        verificationId: pendingEmailOtp.verificationId,
        isExistingUser: pendingEmailOtp.isExistingUser,
        token: code,
      });
      if (completed.error) {
        // 保留已保存的 challenge：用户可直接改验证码重试，无需重新发送
        setHint(completed.error.message || '验证码不正确，请重试', true);
        okBtn.disabled = false;
        return;
      }
      const user = completed.data && completed.data.user ? completed.data.user : null;
      closeModal();
      await onCloudSignedIn(user);
    } catch (e) {
      setHint('登录失败，请稍后重试', true);
      okBtn.disabled = false;
    }
  });

  codeEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') okBtn.click(); });
  document.getElementById('modalCancel').addEventListener('click', closeModal);
}

/** 获取验证码后的 60 秒重发倒计时（只作用于发送按钮，不影响提交） */
let otpCountdownTimer = null;
function startOtpCountdown(btn, setHint) {
  let left = 60;
  btn.disabled = true;
  const orig = btn.textContent;
  clearInterval(otpCountdownTimer);
  const tick = () => {
    btn.textContent = `${left} 秒后重发`;
    if (left <= 0) {
      clearInterval(otpCountdownTimer);
      btn.disabled = false;
      btn.textContent = orig || '重新获取';
      return;
    }
    left -= 1;
  };
  tick();
  otpCountdownTimer = setInterval(tick, 1000);
}

/* ---------------------- 会话 ---------------------- */
function isCloudSignedIn() {
  return !!(cloudSession && cloudSession.user);
}

/** 登录后只比较，不自动覆盖任一端。 */
async function onCloudSignedIn(user) {
  cloudSession = { user };
  setCloudEmail(user && user.email ? user.email : '');
  cloudComparison = null;
  setCloudStatus('待确认');
  await compareCloud();
}

/** 退出登录：清会话。本地数据保留，不影响离线使用。 */
async function cloudSignOut() {
  const cloud = ensureCloudClient();
  try {
    if (cloud) await cloud.auth.signOut();
  } catch (_) {}
  cloudSession = null;
  cloudCheckGeneration++;
  cloudComparison = null;
  cloudStatus = '待确认';
  setCloudEmail('');
  renderSyncEntry();
  renderCloudCard();
  toast('已退出登录，数据仍保留在本机');
}

/** 启动时恢复会话（不触发同步，只刷新界面） */
async function restoreCloudSession() {
  const cloud = ensureCloudClient();
  if (!cloud) { renderSyncEntry(); renderCloudCard(); return; }
  try {
    const { data: session, error } = await cloud.auth.getSession();
    if (!error && session) {
      cloudSession = { user: session.user || null };
      if (session.user && session.user.email) setCloudEmail(session.user.email);
    } else {
      cloudSession = null;
    }
  } catch (_) {
    cloudSession = null;
  }
  renderSyncEntry();
  renderCloudCard();
  if (isCloudSignedIn()) await compareCloud();
}

/* ---------------------- 数据同步：整份账本快照 ---------------------- */
function setCloudStatus(status) {
  cloudStatus = status;
  renderSyncEntry();
  renderCloudCard();
}

function stableCloudJson(value) {
  if (Array.isArray(value)) return '[' + value.map(stableCloudJson).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map((k) => JSON.stringify(k) + ':' + stableCloudJson(value[k])).join(',') + '}';
  return JSON.stringify(value);
}

function cloudSummary(data) {
  const txs = Array.isArray(data && data.transactions) ? data.transactions : [];
  const dates = txs.map((t) => t && t.date).filter((d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)).map((d) => d.slice(0, 10)).sort();
  return `${txs.length} 笔账单 · ${dates.length ? `${dates[0]} 至 ${dates[dates.length - 1]}` : '无账单日期'}`;
}

async function readCloudSnapshot() {
  const cloud = ensureCloudClient();
  if (!cloud) throw new Error('云服务不可用');
  const result = await cloud.database.from(CLOUD_TABLE).select('id, payload, updated_at').limit(2);
  if (result.error) throw new Error(result.error.message || '读取云端失败');
  if (!Array.isArray(result.data)) throw new Error('云端返回格式异常');
  if (result.data.length > 1) throw new Error('云端存在多个账本，请勿覆盖');
  const row = result.data[0] || null;
  if (row && (!row.payload || typeof row.payload !== 'object' || Array.isArray(row.payload) || !Array.isArray(row.payload.transactions))) throw new Error('云端账本格式异常');
  return row ? JSON.parse(JSON.stringify(row)) : null;
}

async function compareCloud() {
  if (!isCloudSignedIn()) { toast('请先登录', 'err'); return false; }
  if (cloudExternalChange) { setCloudStatus('待确认'); toast('其他页面修改了本机账本，请刷新后重新比较', 'err'); return false; }
  const generation = ++cloudCheckGeneration;
  const account = cloudSession;
  const local = JSON.parse(JSON.stringify(Store.data));
  const localJson = stableCloudJson(local);
  let localRaw;
  try { localRaw = localStorage.getItem(STORE_KEY); } catch (_) { setCloudStatus('同步失败'); toast('无法读取本机数据', 'err'); return false; }
  try {
    if (!localRaw) throw new Error('unsaved');
    const stored = JSON.parse(localRaw);
    if (stableCloudJson(stored) !== localJson) {
      // Store.load() 在校验前持久化迁移结果；仅在隔离副本上重放处理，
      // 避免把正常的历史格式转换误认为未保存，也不会写入或上传账本。
      const normalized = Object.assign(Object.create(Store), { data: stored, save() { return true; } });
      normalized.migrate();
      normalized.sanitize();
      if (stableCloudJson(normalized.data) !== localJson) throw new Error('unsaved');
    }
  } catch (_) {
    cloudComparison = null;
    setCloudStatus('待确认');
    toast('本机内存与已保存账本不一致，请先导出备份并刷新页面', 'err');
    return false;
  }
  cloudComparison = null;
  setCloudStatus('同步中');
  try {
    const remote = await readCloudSnapshot();
    if (generation !== cloudCheckGeneration || cloudSession !== account) return false;
    if (stableCloudJson(Store.data) !== localJson || localStorage.getItem(STORE_KEY) !== localRaw) {
      setCloudStatus('待确认'); toast('本机数据已变化，请重新比较', 'err'); return false;
    }
    const equal = !!remote && stableCloudJson(remote.payload) === localJson;
    cloudComparison = { local, localJson, localRaw, remote, equal };
    setCloudStatus(equal ? '已同步' : '待确认');
    return true;
  } catch (e) {
    if (generation === cloudCheckGeneration) { cloudComparison = null; setCloudStatus('同步失败'); toast(`比较失败：${e.message}`, 'err'); }
    return false;
  }
}

function latestCloudRestoreBackup() {
  try {
    const prefix = `${STORE_KEY}_backup_before_cloud_`;
    const key = Object.keys(localStorage).filter((k) => k.startsWith(prefix) && !k.endsWith('_original')).sort().reverse()[0];
    return key ? JSON.parse(localStorage.getItem(key)) : null;
  } catch (_) { return null; }
}

function exportCloudSnapshot(payload, label = '云端账本') {
  const blob = new Blob([JSON.stringify({ app: 'life-assistant', exportedAt: new Date().toISOString(), data: payload }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${label}备份_${todayStr()}.json`; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function confirmCloudAction(action) {
  if (!cloudComparison) { toast('请先比较本机和云端', 'err'); return; }
  const comparison = cloudComparison;
  openModal(`
    <h3>${icon('circle-alert')}确认${action === 'push' ? '上传本机账本' : '恢复云端账本'}</h3>
    <p>${action === 'push' ? '云端整份账本将被本机版本覆盖' : '本机整份账本将被云端版本覆盖'}，包括账单、金库、观影和单词。请先导出两边备份。</p>
    ${action === 'push' ? '<p>上传会检查云端版本，但真实云服务的并发保护尚未验证。请先停止其他设备上的同步操作。</p>' : ''}
    <p>本机：${escapeHtml(cloudSummary(comparison.local))}<br>云端：${comparison.remote ? escapeHtml(cloudSummary(comparison.remote.payload)) : '暂无账本'}</p>
    <div class="modal-actions"><button class="btn btn-ghost" id="modalCancel" type="button">取消</button><button class="btn btn-danger-soft" id="modalOk" type="button">确认${action === 'push' ? '上传' : '恢复'}</button></div>`);
  $('#modalCancel').addEventListener('click', closeModal);
  $('#modalOk').addEventListener('click', async () => {
    $('#modalOk').disabled = true;
    closeModal();
    if (action === 'push') await cloudPush(true, comparison);
    else await cloudPull(true, comparison);
  });
}

async function verifyCloudComparison(expected) {
  if (!expected || cloudExternalChange || cloudComparison !== expected || stableCloudJson(Store.data) !== expected.localJson || localStorage.getItem(STORE_KEY) !== expected.localRaw) throw new Error('本机数据已变化，请重新比较');
  const row = await readCloudSnapshot();
  if (cloudComparison !== expected || stableCloudJson(Store.data) !== expected.localJson || localStorage.getItem(STORE_KEY) !== expected.localRaw || stableCloudJson(row) !== stableCloudJson(expected.remote)) throw new Error('本机或云端数据已变化，请重新比较');
  return row;
}

async function cloudPush(showToast, expected) {
  if (!isCloudSignedIn()) { if (showToast) toast('请先登录', 'err'); return false; }
  if (!expected) { if (showToast) toast('请先比较并确认', 'err'); return false; }
  try {
    const row = await verifyCloudComparison(expected);
    if (!row || !row.id || !row.updated_at) throw new Error('无法验证云端版本，上传已暂停');
    const priorTime = Date.parse(row.updated_at);
    if (!Number.isFinite(priorTime)) throw new Error('云端版本时间无效，上传已暂停');
    setCloudStatus('同步中');
    const result = await ensureCloudClient().database.from(CLOUD_TABLE)
      .update({ payload: expected.local, updated_at: new Date(Math.max(Date.now(), priorTime + 1)).toISOString() })
      .eq('id', row.id).eq('updated_at', row.updated_at).select();
    if (result.error) throw new Error(result.error.message || '上传失败');
    if (!Array.isArray(result.data) || result.data.length !== 1) throw new Error('云端版本已变化或无法确认更新结果');
    cloudComparison = null;
    setCloudStatus('待确认');
    if (showToast) toast('上传请求已完成，请重新比较确认');
    await compareCloud();
    return true;
  } catch (e) {
    cloudComparison = null; setCloudStatus('同步失败');
    if (showToast) toast(`${e.message}，请重新比较`, 'err');
    return false;
  }
}

async function cloudPull(showToast, expected) {
  if (!isCloudSignedIn()) { if (showToast) toast('请先登录', 'err'); return false; }
  if (!expected) { if (showToast) toast('请先比较并确认', 'err'); return false; }
  try {
    const row = await verifyCloudComparison(expected);
    if (!row) throw new Error('云端没有账本');
    const backup = JSON.stringify(Store.data);
    const backupKey = `${STORE_KEY}_backup_before_cloud_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(backupKey, backup);
    if (localStorage.getItem(backupKey) !== backup) throw new Error('本机备份未能验证');
    if (expected.localRaw && expected.localRaw !== backup) {
      localStorage.setItem(`${backupKey}_original`, expected.localRaw);
      if (localStorage.getItem(`${backupKey}_original`) !== expected.localRaw) throw new Error('原始本机备份未能验证');
    }
    const temporary = Object.assign(Object.create(Store), { data: JSON.parse(JSON.stringify(row.payload)), save() { return true; } });
    temporary.migrate(); temporary.sanitize();
    for (const field of ['transactions', 'shows', 'watchLogs', 'wordCards']) {
      if (Array.isArray(row.payload[field]) && temporary.data[field].length !== row.payload[field].length) throw new Error('云端账本校验会丢失记录，已停止恢复');
    }
    if (stableCloudJson(Store.data) !== expected.localJson || localStorage.getItem(STORE_KEY) !== expected.localRaw) throw new Error('本机数据已变化');
    localStorage.setItem(STORE_KEY, JSON.stringify(temporary.data));
    Store.data = temporary.data;
    cloudComparison = null;
    try {
      applyAppName(); renderLedger(); renderStats(); renderVault();
      if (typeof renderShows === 'function') renderShows();
      if (typeof renderWords === 'function') renderWords();
    } catch (e) { console.error('账本已恢复，但页面刷新失败', e); }
    setCloudStatus('待确认');
    if (showToast) toast('已恢复云端账本，本机原账本已备份');
    await compareCloud();
    return true;
  } catch (e) {
    cloudComparison = null; setCloudStatus('同步失败');
    if (showToast) toast(`恢复失败：${e.message}`, 'err');
    return false;
  }
}

/* ---------------------- 最近同步时间（仅界面展示） ---------------------- */
const CLOUD_SYNCED_KEY = 'life_assistant_cloud_synced_at';
function setLastSyncAt(iso) {
  try { localStorage.setItem(CLOUD_SYNCED_KEY, iso || new Date().toISOString()); } catch (_) {}
}

/* ---------------------- 变更后自动上传（节流） ---------------------- */
/** 未验证服务端条件更新前，不执行自动上传。 */
function scheduleAutoPush() {
  if (!isCloudSignedIn()) return;
  cloudCheckGeneration++;
  cloudComparison = null;
  setCloudStatus('待确认');
}

/* ---------------------- 初始化 ---------------------- */
function initCloudSync() {
  const btn = document.getElementById('syncBtn');
  if (btn) btn.addEventListener('click', () => {
    if (isCloudSignedIn()) {
      // 已登录 → 跳到金库页管理同步
      switchPage('vault');
      const card = document.getElementById('cloudSyncCard');
      if (card && card.scrollIntoView) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      openLoginModal();
    }
  });

  renderSyncEntry();
  renderCloudCard();
  window.addEventListener('storage', (e) => {
    if (e.key === STORE_KEY) {
      cloudExternalChange = true;
      if (isCloudSignedIn()) scheduleAutoPush();
    }
  });
  restoreCloudSession();
}
