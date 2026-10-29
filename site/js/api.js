/**
 * 관문(Apps Script 웹앱) 호출 공통 모듈. docs/api.md 참조.
 * 토큰은 sessionStorage, 기기ID는 localStorage(인증 수단 아님, 실패 제한·로그 구분용).
 * 관문 주소는 화면 코드와 함께 공개된다고 가정한다(docs/decisions.md 6-3절) — 실제 보호는
 * 관문이 매 요청마다 토큰·공개여부를 검증하는 데서 나온다.
 */
const GATEWAY_URL = 'https://script.google.com/macros/s/AKfycbw1lMcmd21VQGWjtStaTKxH05Qsg5lkOZUDZV_NyyhA-OBM_cbdULZQTdUqq8HrLsMH/exec';

const TOKEN_KEY = 'karts_token';
const TOKEN_EXPIRES_KEY = 'karts_token_expires_at';
const DEVICE_ID_KEY = 'karts_device_id';

function getDeviceId() {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

function getToken() { return sessionStorage.getItem(TOKEN_KEY); }
function getTokenExpiresAt() { return Number(sessionStorage.getItem(TOKEN_EXPIRES_KEY) || 0); }
function setToken(token, expiresAt) {
  sessionStorage.setItem(TOKEN_KEY, token);
  sessionStorage.setItem(TOKEN_EXPIRES_KEY, String(expiresAt));
}
function clearToken() {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(TOKEN_EXPIRES_KEY);
}

class GatewayError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

const GATEWAY_TIMEOUT_MS = 20000;
const HEDGE_AFTER_MS = 3000;

async function requestOnce(body, signal) {
  let res;
  try {
    res = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      signal
    });
  } catch (e) {
    throw new GatewayError(e.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR');
  }
  let json;
  try {
    json = await res.json();
  } catch (e) {
    throw new GatewayError('SERVER_ERROR');
  }
  if (!json.ok) throw new GatewayError(json.error || 'SERVER_ERROR');
  return json.data;
}

/**
 * Apps Script는 스크립트가 1초 만에 끝나도 Google 입구에서 수십 초를 기다리는 일이 있다
 * (docs/decisions.md 9절 "응답 속도"). 지연은 요청마다 무작위로 걸리므로,
 * 3초 안에 응답이 없으면 같은 요청을 한 번 더 보내고 먼저 오는 응답을 쓴다.
 * auth는 requestId로 관문이 중복을 걸러 토큰·로그가 두 번 생기지 않는다.
 * 뒤에서 미리 받는 요청(photos)은 서두를 필요가 없어 hedge: false로 예비 요청을 보내지 않는다.
 * 관리자 페이지의 저장 요청도 두 번 쓰이면 안 되므로 hedge: false로 보내고, 입구 대기(최대 1분)보다
 * 먼저 포기해 "실패"로 보였는데 실제로는 저장되는 일을 줄이려고 timeoutMs를 길게 준다.
 */
function callGateway(body, { hedge = true, timeoutMs = GATEWAY_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const controllers = [];
    let inFlight = 0;
    let settled = false;
    let firstError = null;
    let hedgeTimer = null;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(hedgeTimer);
      controllers.forEach(c => c.abort());
      fn(value);
    };

    const send = () => {
      const controller = new AbortController();
      controllers.push(controller);
      inFlight++;
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      requestOnce(body, controller.signal)
        .then(data => finish(resolve, data))
        .catch(err => {
          inFlight--;
          if (settled) return;
          firstError = firstError || err;
          // 관문이 판단한 오류(코드 오류·토큰 만료 등)는 다시 보내도 결과가 같다.
          if (err.code !== 'TIMEOUT' && err.code !== 'NETWORK_ERROR') return finish(reject, err);
          if (inFlight === 0) finish(reject, firstError);
        })
        .finally(() => clearTimeout(timer));
    };

    send();
    if (hedge) hedgeTimer = setTimeout(() => { if (!settled) send(); }, HEDGE_AFTER_MS);
  });
}

function newRequestId() {
  return crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
}

const api = {
  async auth(code, name) {
    return callGateway({ action: 'auth', code, name, deviceId: getDeviceId(), requestId: newRequestId() });
  },
  async ping(token) {
    return callGateway({ action: 'ping', token });
  },
  async data(token) {
    return callGateway({ action: 'data', token });
  },
  async photo(token, fileId) {
    return callGateway({ action: 'photo', token, fileId });
  },
  // docs/api.md 3-5. 자료 페이지 진입 시 뒤에서 한 번 보내는 미리 받기용 요청
  async photos(token, sessionId) {
    return callGateway({ action: 'photos', token, sessionId }, { hedge: false });
  }
};
