/**
 * 관리자 페이지 틀 (docs/admin.md 2·3절, WBS 5.1). 로그인·관리자 토큰·탭 전환·관문 호출·공통 알림만 맡는다.
 * 탭 내용은 admin-codes.js · admin-logs.js · admin-media.js가 registerAdminTab()으로 붙인다.
 * 권한 판단은 하지 않는다 — 관문이 요청마다 관리자 토큰과 시트의 「권한」을 확인한다.
 */

// 클릭재킹 방지 (app.js와 같은 이유, docs/decisions.md 6-3절)
if (window.top !== window.self) {
  window.top.location = window.self.location;
}

// 열람 사이트 토큰(api.js의 karts_token)과 섞이지 않게 다른 키를 쓴다(docs/admin.md 2절).
const ADMIN_TOKEN_KEY = 'karts_admin_token';
const ADMIN_TOKEN_EXPIRES_KEY = 'karts_admin_token_expires_at';
const ADMIN_WHO_KEY = 'karts_admin_who';
const ADMIN_TAB_KEY = 'karts_admin_tab';
const ADMIN_WRITE_TIMEOUT_MS = 90000; // 저장 요청은 입구 대기(최대 1분)보다 오래 기다린다

function getAdminToken() { return sessionStorage.getItem(ADMIN_TOKEN_KEY); }
function getAdminTokenExpiresAt() { return Number(sessionStorage.getItem(ADMIN_TOKEN_EXPIRES_KEY) || 0); }
function setAdminToken(token, expiresAt) {
  sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
  sessionStorage.setItem(ADMIN_TOKEN_EXPIRES_KEY, String(expiresAt));
}
function clearAdminSession() {
  sessionStorage.removeItem(ADMIN_TOKEN_KEY);
  sessionStorage.removeItem(ADMIN_TOKEN_EXPIRES_KEY);
  sessionStorage.removeItem(ADMIN_WHO_KEY);
}

const ADMIN_ERROR_MESSAGE = {
  AUTH_INVALID: '접근코드가 올바르지 않습니다.',
  AUTH_EXPIRED: '접근코드 사용기한이 지났습니다.',
  AUTH_LOCKED: '여러 번 실패해 잠시 후 다시 시도할 수 있습니다.',
  TOKEN_INVALID: '접속이 끝났습니다. 다시 로그인해 주세요.',
  TOKEN_EXPIRED: '접속이 끝났습니다. 다시 로그인해 주세요.',
  CONFLICT: '그 사이 시트가 바뀌었습니다. 새로고침한 뒤 다시 해 주세요.',
  INVALID_INPUT: '입력한 값을 다시 확인해 주세요.',
  NOT_FOUND: '대상을 찾을 수 없습니다. 새로고침해 주세요.',
  BUSY: '다른 저장 작업이 진행 중입니다. 잠시 후 다시 해 주세요.',
  VIMEO_ERROR: 'Vimeo 연결에 문제가 있습니다. 잠시 후 다시 해 주세요. 계속되면 관문 실행 기록을 확인해야 합니다.',
  NETWORK_ERROR: '연결에 실패했습니다. 잠시 후 다시 시도해 주세요.',
  TIMEOUT: '응답이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.',
  SERVER_ERROR: '일시적인 오류입니다. 잠시 후 다시 시도해 주세요.'
};

// 저장 요청이 시간 초과되면 관문에서는 저장됐을 수도 있어 안내를 달리한다.
function adminErrorMessage(e, { write = false } = {}) {
  if (write && e && e.code === 'TIMEOUT') return '응답이 늦습니다. 저장됐는지 새로고침해서 확인해 주세요.';
  return ADMIN_ERROR_MESSAGE[e && e.code] || ADMIN_ERROR_MESSAGE.SERVER_ERROR;
}

/**
 * 관리 요청 공통 호출. 관문 응답 data는 { result, session }이며 session의 새 토큰으로 바꿔 끼운다.
 * write: true면 예비 요청을 보내지 않고(두 번 저장 방지) 오래 기다린다.
 * 토큰이 끝났으면 로그인 화면으로 돌아가고 오류를 그대로 던진다.
 */
async function adminCall(action, payload = {}, { write = false } = {}) {
  const token = getAdminToken();
  if (!token || Date.now() >= getAdminTokenExpiresAt()) {
    adminLogout(ADMIN_ERROR_MESSAGE.TOKEN_EXPIRED);
    throw new GatewayError('TOKEN_EXPIRED');
  }
  try {
    const data = await callGateway(
      { ...payload, action, token },
      write ? { hedge: false, timeoutMs: ADMIN_WRITE_TIMEOUT_MS } : {}
    );
    setAdminToken(data.session.token, data.session.expiresAt);
    return data.result;
  } catch (e) {
    if (e.code === 'TOKEN_EXPIRED' || e.code === 'TOKEN_INVALID') adminLogout(ADMIN_ERROR_MESSAGE[e.code]);
    throw e;
  }
}

/* ---------- 탭 ---------- */

// registerAdminTab('codes', { render(container), onShow(container) })
// render는 탭을 처음 열 때 한 번, onShow는 열 때마다 부른다. 로그아웃하면 내용을 지우고 처음부터 다시 그린다.
const AdminTabs = {};
function registerAdminTab(id, { render, onShow } = {}) {
  AdminTabs[id] = { render, onShow, rendered: false };
}

const TAB_IDS = ['codes', 'logs', 'media'];
const adminTabsNav = document.getElementById('admin-tabs');

adminTabsNav.addEventListener('click', e => {
  const btn = e.target.closest('button[data-tab]');
  if (btn) showAdminTab(btn.dataset.tab);
});

function showAdminTab(id) {
  if (!TAB_IDS.includes(id)) id = TAB_IDS[0];
  try { sessionStorage.setItem(ADMIN_TAB_KEY, id); } catch (e) { /* 저장 못 해도 동작에는 지장 없음 */ }
  adminTabsNav.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.tab === id));
  TAB_IDS.forEach(t => document.getElementById(`tab-${t}`).classList.toggle('hidden', t !== id));

  const container = document.getElementById(`tab-${id}`);
  const tab = AdminTabs[id];
  if (!tab) {
    if (!container.hasChildNodes()) container.appendChild(adminPlaceholder('준비 중인 기능입니다.'));
    return;
  }
  if (!tab.rendered) {
    tab.rendered = true;
    container.replaceChildren();
    if (tab.render) tab.render(container);
  }
  if (tab.onShow) tab.onShow(container);
}

function adminPlaceholder(text) {
  const div = document.createElement('div');
  div.className = 'admin-placeholder';
  div.textContent = text;
  return div;
}

/* ---------- 로그인 ---------- */

const gateScreen = document.getElementById('gate-screen');
const adminScreen = document.getElementById('admin-screen');
const codeInput = document.getElementById('code-input');
const nameInput = document.getElementById('name-input');
const gateError = document.getElementById('gate-error');
const gateSubmitBtn = document.getElementById('gate-submit');
const adminWho = document.getElementById('admin-who');

gateSubmitBtn.addEventListener('click', trySubmitAdminGate);
codeInput.addEventListener('keydown', e => { if (e.key === 'Enter') trySubmitAdminGate(); });
nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') trySubmitAdminGate(); });

async function trySubmitAdminGate() {
  const rawCode = codeInput.value.trim();
  const name = nameInput.value.trim();
  gateError.textContent = '';

  if (rawCode.length === 0) { gateError.textContent = '접근코드를 입력해 주세요.'; return; }
  if (name.length === 0) { gateError.textContent = '이름을 입력해 주세요.'; return; }

  const code = convertHangulToEnglish(rawCode).toUpperCase();

  gateSubmitBtn.disabled = true;
  gateSubmitBtn.textContent = '확인하는 중…';
  try {
    const auth = await callGateway({
      action: 'adminAuth', code, name, deviceId: getDeviceId(), requestId: newRequestId()
    });
    setAdminToken(auth.token, auth.expiresAt);
    const who = auth.label ? `${auth.name} · ${auth.label}` : auth.name;
    try { sessionStorage.setItem(ADMIN_WHO_KEY, who); } catch (e) { /* 표시용이라 없어도 됨 */ }
    enterAdmin();
  } catch (e) {
    gateError.textContent = adminErrorMessage(e);
  } finally {
    gateSubmitBtn.disabled = false;
    gateSubmitBtn.textContent = '들어가기';
  }
}

function enterAdmin() {
  gateScreen.classList.add('hidden');
  adminScreen.classList.remove('hidden');
  adminWho.textContent = sessionStorage.getItem(ADMIN_WHO_KEY) || '';
  let saved = null;
  try { saved = sessionStorage.getItem(ADMIN_TAB_KEY); } catch (e) { /* 첫 탭으로 */ }
  showAdminTab(saved || TAB_IDS[0]);
}

document.getElementById('logout-btn').addEventListener('click', () => adminLogout(''));

// 다른 사람이 같은 PC를 쓸 수 있으므로 화면에 그려 둔 관리 내용도 함께 지운다.
function adminLogout(message) {
  clearAdminSession();
  TAB_IDS.forEach(id => {
    document.getElementById(`tab-${id}`).replaceChildren();
    if (AdminTabs[id]) AdminTabs[id].rendered = false;
  });
  closeAdminDialog(false);
  adminScreen.classList.add('hidden');
  gateScreen.classList.remove('hidden');
  codeInput.value = '';
  nameInput.value = '';
  adminWho.textContent = '';
  gateError.textContent = message || '';
}

/* ---------- 공통 알림 ---------- */

const adminToast = document.getElementById('admin-toast');
let adminToastTimer = null;

// kind: 'ok' | 'error'
function showAdminToast(message, kind = 'ok') {
  adminToast.textContent = message;
  adminToast.classList.toggle('error', kind === 'error');
  adminToast.classList.remove('hidden');
  clearTimeout(adminToastTimer);
  adminToastTimer = setTimeout(() => adminToast.classList.add('hidden'), kind === 'error' ? 6000 : 3000);
}

/**
 * 확인 창. body는 문자열(textContent로 넣음) 또는 DOM 노드. 확인을 누르면 true.
 * openAdminDialog({ title, body, okLabel, danger, validate })
 * validate()가 문구를 돌려주면 창을 닫지 않고 그 문구를 보여 준다(입력 양식용).
 */
const adminDialog = document.getElementById('admin-dialog');
const adminDialogTitle = document.getElementById('admin-dialog-title');
const adminDialogBody = document.getElementById('admin-dialog-body');
const adminDialogOk = document.getElementById('admin-dialog-ok');
const adminDialogError = document.createElement('div');
adminDialogError.className = 'admin-dialog-error';
adminDialog.insertBefore(adminDialogError, adminDialog.querySelector('.admin-dialog-actions'));
let adminDialogResolve = null;
let adminDialogValidate = null;

function openAdminDialog({ title = '', body = '', okLabel = '확인', danger = false, validate = null } = {}) {
  closeAdminDialog(false);
  adminDialogTitle.textContent = title;
  adminDialogBody.replaceChildren();
  if (typeof body === 'string') adminDialogBody.textContent = body;
  else if (body) adminDialogBody.appendChild(body);
  adminDialogError.textContent = '';
  adminDialogValidate = validate;
  adminDialogOk.textContent = okLabel;
  adminDialogOk.classList.toggle('danger', danger);
  adminDialog.showModal();
  return new Promise(resolve => { adminDialogResolve = resolve; });
}

function closeAdminDialog(result) {
  if (adminDialog.open) adminDialog.close();
  if (adminDialogResolve) {
    const resolve = adminDialogResolve;
    adminDialogResolve = null;
    resolve(result);
  }
}

adminDialogOk.addEventListener('click', () => {
  const problem = adminDialogValidate ? adminDialogValidate() : '';
  if (problem) { adminDialogError.textContent = problem; return; }
  closeAdminDialog(true);
});
document.getElementById('admin-dialog-cancel').addEventListener('click', () => closeAdminDialog(false));
adminDialog.addEventListener('cancel', e => { e.preventDefault(); closeAdminDialog(false); }); // Esc

/* ---------- 부트스트랩 ---------- */
// 탭 스크립트(admin-*.js)가 이 파일 뒤에 실리며 registerAdminTab을 부르므로,
// 모든 스크립트가 실린 뒤(DOMContentLoaded)에 첫 화면을 그린다.
document.addEventListener('DOMContentLoaded', () => {
  if (getAdminToken() && Date.now() < getAdminTokenExpiresAt()) {
    enterAdmin();
  } else {
    clearAdminSession();
    gateScreen.classList.remove('hidden');
  }
});
