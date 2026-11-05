/**
 * 사이트 부트스트랩. WBS 3.1+3.2: 틀·라우팅·관문 연결만 담당한다.
 * 실제 화면(분야·프로그램·일정표·목록·검색·인물)은 3.3~3.7에서 채운다.
 */

// 클릭재킹 방지: GitHub Pages는 응답 헤더(X-Frame-Options)를 설정할 수 없어 코드로 막는다
// (docs/decisions.md 6-3절 "클릭재킹").
if (window.top !== window.self) {
  window.top.location = window.self.location;
}

// 「일정」 탭 분야 값 ↔ 세션ID 접두어(docs/sheet-schema.md 7절)
const DISCIPLINE_SLUG = { '음악': 'music', '무용': 'dance', '전통예술': 'trad', '미술': 'art' };

const AppState = {
  data: null, // api.data() 응답 캐시 (docs/decisions.md 2절: 인증 후 한 번만 받는다)
  pingTimer: null
};

const gateScreen = document.getElementById('gate-screen');
const appScreen = document.getElementById('app-screen');
const codeInput = document.getElementById('code-input');
const codeField = enhanceCodeInput(codeInput); // 한글 자판이어도 영문 · [보기] (hangul.js, 2026-11-05)
const nameInput = document.getElementById('name-input');
const gateError = document.getElementById('gate-error');
const gateSubmitBtn = document.getElementById('gate-submit');
const dataLoadingBadge = document.getElementById('data-loading');
const disciplineSwitch = document.getElementById('discipline-switch');

const GATE_ERROR_MESSAGE = {
  AUTH_INVALID: '접근코드가 올바르지 않습니다.',
  AUTH_EXPIRED: '접근코드 사용기한이 지났습니다.',
  AUTH_LOCKED: '여러 번 실패해 잠시 후 다시 시도할 수 있습니다.',
  NETWORK_ERROR: '연결에 실패했습니다. 잠시 후 다시 시도해 주세요.',
  TIMEOUT: '응답이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.',
  SERVER_ERROR: '일시적인 오류입니다. 잠시 후 다시 시도해 주세요.'
};

document.getElementById('gate-submit').addEventListener('click', trySubmitGate);
codeInput.addEventListener('keydown', e => { if (e.key === 'Enter') trySubmitGate(); });
nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') trySubmitGate(); });

async function trySubmitGate() {
  const rawCode = codeInput.value.trim();
  const name = nameInput.value.trim();
  gateError.textContent = '';

  if (rawCode.length === 0) { gateError.textContent = '접근코드를 입력해 주세요.'; return; }
  if (name.length === 0) { gateError.textContent = '이름을 입력해 주세요.'; return; }

  const code = convertHangulToEnglish(rawCode).replace(/[^A-Za-z0-9-]/g, ''); // 영문·숫자·-만, 대소문자 구별 (2026-11-05)

  setGateSubmitting(true);
  try {
    const auth = await api.auth(code, name);
    setToken(auth.token, auth.expiresAt);
    // data 응답(3.8초 안팎)을 기다리지 않고 바로 화면을 전환한다. 자료는 뒤에서 이어받는다.
    enterApp(auth.firstView);
    loadAppDataInBackground();
  } catch (e) {
    gateError.textContent = GATE_ERROR_MESSAGE[e.code] || GATE_ERROR_MESSAGE.SERVER_ERROR;
  } finally {
    setGateSubmitting(false);
  }
}

function setGateSubmitting(submitting) {
  gateSubmitBtn.disabled = submitting;
  gateSubmitBtn.textContent = submitting ? '입장하는 중…' : '입장하기';
}

async function loadAppDataInBackground() {
  dataLoadingBadge.classList.remove('hidden', 'retry');
  dataLoadingBadge.textContent = '자료 불러오는 중…';
  try {
    AppState.data = await api.data(getToken());
    dataLoadingBadge.classList.add('hidden');
    handleRouteChange(); // 데이터가 준비됐으니 현재 화면을 다시 그린다
  } catch (e) {
    if (e.code === 'TOKEN_EXPIRED' || e.code === 'TOKEN_INVALID') { logout(); return; }
    // 타임아웃·네트워크 오류 등은 조용히 사라지지 않고 다시 시도할 수 있게 남겨둔다.
    dataLoadingBadge.textContent = (GATE_ERROR_MESSAGE[e.code] || GATE_ERROR_MESSAGE.SERVER_ERROR) + ' · 다시 시도';
    dataLoadingBadge.classList.add('retry');
  }
}

dataLoadingBadge.addEventListener('click', () => {
  if (dataLoadingBadge.classList.contains('retry')) loadAppDataInBackground();
});

function enterApp(firstView) {
  gateScreen.classList.add('hidden');
  appScreen.classList.remove('hidden');
  scheduleTokenRenewal();
  renderDisciplineSwitcher();
  // 받은 링크(예: 시각 링크)로 들어와 로그인한 경우 그 화면으로 이어 간다.
  // 주소가 비어 있을 때만 접근코드의 첫 화면으로 보낸다(로그아웃하면 주소를 비운다).
  const hash = location.hash.replace(/^#/, '');
  if (hash && hash !== '/') handleRouteChange();
  else routeFromFirstView(firstView);
}

// 상단바 분야 전환: 코드 종류와 무관하게 언제든 다른 분야로 이동 가능해야 한다
// (docs/decisions.md 3절 "분야 이동").
function renderDisciplineSwitcher() {
  disciplineSwitch.replaceChildren();
  Object.entries(DISCIPLINE_SLUG).forEach(([kr, slug]) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.slug = slug;
    btn.textContent = kr;
    btn.addEventListener('click', () => navigate(`#/${slug}`));
    disciplineSwitch.appendChild(btn);
  });
}

function updateDisciplineSwitcher(activeSlug) {
  disciplineSwitch.querySelectorAll('button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.slug === activeSlug);
  });
}

// 「코드」 탭 "첫 화면" 값 해석. 분야 코드면 해당 분야로, STAFF는 분야 선택으로.
// 정확한 프로그램 선택 라우팅은 3.4에서 마무리한다.
function routeFromFirstView(firstView) {
  const slug = Object.entries(DISCIPLINE_SLUG).find(([kr]) => firstView && firstView.includes(kr));
  navigate(slug ? `#/${slug[1]}` : '#/');
}

function scheduleTokenRenewal() {
  if (AppState.pingTimer) clearInterval(AppState.pingTimer);
  // 토큰 유효시간 2시간(docs/api.md 5절), 30분마다 갱신해 여유를 둔다.
  AppState.pingTimer = setInterval(async () => {
    try {
      const res = await api.ping(getToken());
      setToken(res.token, res.expiresAt);
    } catch (e) {
      if (e.code === 'TOKEN_EXPIRED' || e.code === 'TOKEN_INVALID') logout();
    }
  }, 30 * 60 * 1000);
}

document.getElementById('logout-btn').addEventListener('click', logout);

function logout() {
  if (AppState.pingTimer) clearInterval(AppState.pingTimer);
  clearToken();
  AppState.data = null;
  closeMaterialModal(); // 모달은 앱 화면 밖에 있어, 토큰 만료로 로그아웃되면 사진이 로그인 화면 위에 남는다
  clearSessionViewer(); // 수업 자료 화면의 플레이어·사진도 지운다
  clearPhotoCache();    // 미리 받아 둔 사진을 메모리에서 비운다
  appScreen.classList.add('hidden');
  gateScreen.classList.remove('hidden');
  codeInput.value = '';
  codeField.hide();
  nameInput.value = '';
  gateError.textContent = '';
  location.hash = '';
}

document.getElementById('brand-home').addEventListener('click', () => navigate('#/'));

/* ---------- 화면 공통 헬퍼 ---------- */
function showView(id) {
  // 수업 자료 화면을 떠나면 열람기를 지운다. 숨기기만 하면 재생 중인 영상 소리가 계속 난다.
  if (id !== 'view-materials') clearSessionViewer();
  document.querySelectorAll('main .view').forEach(el => el.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
}

// 브라켓(뷰파인더) 모티프. 정적 마크업이라 innerHTML 없이 매번 새로 만든다.
function createBrackets() {
  const div = document.createElement('div');
  div.className = 'brackets';
  for (let i = 0; i < 4; i++) div.appendChild(document.createElement('i'));
  return div;
}

document.getElementById('search-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.value.trim()) {
    navigate('#/search/' + encodeURIComponent(e.target.value.trim()));
  }
});

/* ---------- 부트스트랩 ---------- */
// 토큰 유무·만료는 동기적으로 바로 알 수 있다. 세션이 살아 있으면 자료를 기다리지 않고
// 곧바로 화면에 들어가고, 자료는 로그인 직후와 똑같이 뒤에서 받는다
// (docs/decisions.md 9절: 새로고침이 data 응답을 기다려 오래 걸리던 문제).
// 토큰이 실제로 무효면 data 요청이 실패하면서 logout()이 로그인 화면으로 되돌린다.
(function bootSync() {
  const token = getToken();
  if (token && Date.now() < getTokenExpiresAt()) {
    appScreen.classList.remove('hidden');
    scheduleTokenRenewal();
    renderDisciplineSwitcher();
    handleRouteChange();
    loadAppDataInBackground();
  } else {
    clearToken();
    gateScreen.classList.remove('hidden');
  }
})();
