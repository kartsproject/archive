/**
 * 관리자 페이지 공통 기반 (docs/admin.md 3·4절, WBS 5.1).
 * 관리자 로그인 · 관리자 토큰 검증 · 관리 요청 분배 · 쓰기 공통 규칙(잠금·저장 직전 확인·관리기록).
 * 기능별 처리 함수(adminCodes_ 등)는 AdminCodes.js · AdminLogs.js · AdminMedia.js에 둔다.
 */

var ADMIN_TOKEN_LIFETIME_MS_ = 30 * 60 * 1000; // docs/admin.md 3절: 30분, 관리 요청마다 새 토큰
var ADMIN_ROLE_ = '관리자';
var ADMIN_NAME_MAX_ = 20; // 로그인 화면 이름 입력칸 최대 길이와 같다

// docs/admin.md 8절. Code.js가 이 목록에 있는 action만 handleAdmin_으로 보낸다.
var ADMIN_ACTIONS_ = [
  'adminPing',
  'adminCodes', 'adminCodeSave', 'adminCodeRevoke', 'adminLogs',
  'adminMaterials', 'adminMaterialUpdate', 'adminMaterialDelete', 'adminVideoCreate', 'adminVideoFinish'
];

function isAdminAction_(action) {
  return ADMIN_ACTIONS_.indexOf(action) !== -1;
}

// 처리 함수는 다른 파일에 있어 호출 시점에 찾는다. 아직 없는 함수면 ReferenceError가 나고
// handleAdmin_이 SERVER_ERROR로 돌려준다(그 단계가 구현되기 전 상태).
function adminHandlerFor_(action) {
  switch (action) {
    case 'adminPing': return function () { return null; }; // 업로드처럼 관문을 오래 안 부를 때 토큰만 잇는다
    case 'adminCodes': return adminCodes_;
    case 'adminCodeSave': return adminCodeSave_;
    case 'adminCodeRevoke': return adminCodeRevoke_;
    case 'adminLogs': return adminLogs_;
    case 'adminMaterials': return adminMaterials_;
    case 'adminMaterialUpdate': return adminMaterialUpdate_;
    case 'adminMaterialDelete': return adminMaterialDelete_;
    case 'adminVideoCreate': return adminVideoCreate_;
    case 'adminVideoFinish': return adminVideoFinish_;
  }
  return null;
}

/* ---------- 로그인 ---------- */

// handleAuth_와 같은 이유로 requestId가 같으면 먼저 만든 응답을 돌려준다(예비 요청 중복 방지).
function handleAdminAuth_(req) {
  if (!req.requestId) return jsonResult_(authenticateAdmin_(req));

  var cache = CacheService.getScriptCache();
  var key = 'adminauth_' + String(req.requestId).slice(0, 200);
  var saved = cache.get(key);
  if (saved) {
    try {
      return jsonResult_(JSON.parse(saved));
    } catch (err) {
      // 캐시가 깨졌으면 그냥 새로 처리한다
    }
  }

  var result = authenticateAdmin_(req);
  cache.put(key, JSON.stringify(result), 120);
  return jsonResult_(result);
}

// authenticate_와 같은 순서에 「권한」 확인을 더한다. 관리자가 아닌 코드도 AUTH_INVALID로만 답해
// 열람 코드가 맞다는 사실을 알려 주지 않는다(docs/admin.md 3절).
function authenticateAdmin_(req) {
  var code = req.code;
  var deviceId = req.deviceId;
  var name = String(req.name || '').trim().slice(0, ADMIN_NAME_MAX_);

  if (!code || !deviceId || !name) return authResult_(false, 'AUTH_INVALID', null);

  var row = findCodeRow_(code);
  if (!row || row['상태'] !== '사용' || !isAdminRow_(row)) {
    recordAuthFailure_(deviceId, codePrefix_(code));
    logAccess_('실패(AUTH_INVALID)', code, name, deviceId, 'adminAuth', '');
    return authResult_(false, 'AUTH_INVALID', null);
  }

  if (!isWithinExpiry_(row['사용기한'])) {
    recordAuthFailure_(deviceId, codePrefix_(code));
    logAccess_('실패(AUTH_EXPIRED)', code, name, deviceId, 'adminAuth', '');
    return authResult_(false, 'AUTH_EXPIRED', null);
  }

  if (isDeviceLocked_(deviceId)) {
    logAccess_('실패(AUTH_LOCKED)', code, name, deviceId, 'adminAuth', '');
    return authResult_(false, 'AUTH_LOCKED', null);
  }

  clearAuthFailures_(deviceId);
  var issued = issueAdminToken_(row, name);
  logAccess_('성공', code, name, deviceId, 'adminAuth', '');
  return authResult_(true, null, {
    token: issued.token,
    expiresAt: issued.expiresAt,
    name: name,
    label: String(row['이름'] || '')
  });
}

function isAdminRow_(row) {
  return String(row['권한'] || '').trim() === ADMIN_ROLE_;
}

// 열람 토큰과 같은 서명에 role·이름을 더한다. 이름은 「관리기록」에 남기려고 넣는다(본인 확인 아님).
function issueAdminToken_(codeRow, name) {
  var expiresAt = Date.now() + ADMIN_TOKEN_LIFETIME_MS_;
  var token = signToken_({
    code: codeRow['코드'],
    ver: Number(codeRow['버전']),
    exp: expiresAt,
    role: 'admin',
    nm: name
  });
  return { token: token, expiresAt: expiresAt };
}

/* ---------- 관리 요청 ---------- */

// 매 요청: 서명·만료·버전(verifyToken_) + role + 지금 시트의 권한·상태·사용기한.
// 시트에서 권한을 내리거나 정지하면 다음 요청부터 바로 막힌다.
function requireAdmin_(token) {
  var result = verifyToken_(token);
  if (!result.valid) return result;

  var row = result.row;
  if (result.payload.role !== 'admin' || !isAdminRow_(row) || row['상태'] !== '사용' || !isWithinExpiry_(row['사용기한'])) {
    return { valid: false, error: 'TOKEN_INVALID' };
  }
  return { valid: true, admin: { code: result.payload.code, name: result.payload.nm || '', row: row } };
}

// 처리 함수 계약: handler(req, admin) → 결과(data.result로 나감). 실패는 throw adminError_(코드).
// 성공 응답에는 새 토큰을 함께 담아 사용 중에는 30분이 계속 이어지게 한다.
function handleAdmin_(req) {
  var auth = requireAdmin_(req.token);
  if (!auth.valid) return jsonResponse_(false, auth.error, null);

  var result;
  try {
    var handler = adminHandlerFor_(req.action);
    if (!handler) return jsonResponse_(false, 'SERVER_ERROR', null);
    result = handler(req, auth.admin);
  } catch (err) {
    if (err && err.adminError) return jsonResponse_(false, err.adminError, null);
    console.error(req.action + ' 실패: ' + (err && err.stack ? err.stack : err));
    return jsonResponse_(false, 'SERVER_ERROR', null);
  }

  var issued = issueAdminToken_(auth.admin.row, auth.admin.name);
  return jsonResponse_(true, null, {
    result: result === undefined ? null : result,
    session: { token: issued.token, expiresAt: issued.expiresAt }
  });
}

// docs/admin.md 8절 오류 코드: INVALID_INPUT · CONFLICT · NOT_FOUND · BUSY
function adminError_(code) {
  var err = new Error(code);
  err.adminError = code;
  return err;
}

/* ---------- 쓰기 공통 규칙 (docs/admin.md 4절) ---------- */

// 잠금 → 작업 → 캐시 버전 올리기. 스크립트가 쓴 값에는 편집 트리거가 반응하지 않으므로
// 메뉴 작업과 마찬가지로 직접 올린다(Triggers.js).
function adminWrite_(work) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw adminError_('BUSY');
  try {
    var result = work();
    bumpCacheVersion_();
    return result;
  } finally {
    lock.releaseLock();
  }
}

// 관리 화면용으로 탭 전체를 읽는다. 캐시를 쓰지 않고, 값은 글자로 바꿔 화면이 보낸
// "읽었을 때의 값"과 저장 직전 값을 같은 모양으로 비교할 수 있게 한다. _row는 시트 행 번호.
function readAdminTable_(sheetName, program) {
  var sheet = getSheet_(sheetName, program);
  var values = sheet.getDataRange().getValues();
  var headers = values[0].map(String);
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    if (values[i].join('') === '') continue;
    rows.push(rowValuesToObject_(headers, values[i], i + 1));
  }
  return { sheet: sheet, headers: headers, rows: rows };
}

function rowValuesToObject_(headers, values, rowNumber) {
  var obj = { _row: rowNumber };
  for (var c = 0; c < headers.length; c++) {
    if (headers[c]) obj[headers[c]] = cellText_(values[c]);
  }
  return obj;
}

// 시각만 있는 칸은 시트가 1899-12-30 날짜를 붙여 돌려주므로 연도로 시각·날짜를 가른다.
function cellText_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return value.getFullYear() < 1900 ? formatTimeCell_(value) : formatDateCell_(value);
  }
  return String(value == null ? '' : value);
}

// 저장 직전 확인: before(화면이 읽었던 값)의 열이 지금도 모두 같을 때만 지금 행을 돌려준다.
// 그 사이 시트를 직접 고쳤거나 행이 밀렸으면 CONFLICT — 엉뚱한 행을 덮어쓰지 않기 위함.
function checkRowUnchanged_(sheet, headers, rowNumber, before) {
  rowNumber = Number(rowNumber);
  if (!before || typeof before !== 'object' || !(rowNumber >= 2) || rowNumber > sheet.getLastRow()) {
    throw adminError_('CONFLICT');
  }
  var values = sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
  var current = rowValuesToObject_(headers, values, rowNumber);
  Object.keys(before).forEach(function (key) {
    if (key === '_row') return;
    if (current[key] === undefined || current[key] !== String(before[key] == null ? '' : before[key])) {
      throw adminError_('CONFLICT');
    }
  });
  return current;
}

// changes { 열 이름: 새 값 }만 그 행에 쓴다. 없는 열 이름이면 INVALID_INPUT.
function writeRowChanges_(sheet, headers, rowNumber, changes) {
  Object.keys(changes).forEach(function (key) {
    var col = headers.indexOf(key);
    if (col === -1) throw adminError_('INVALID_INPUT');
    sheet.getRange(rowNumber, col + 1).setValue(sanitizeForSheet_(changes[key]));
  });
}

// 머리글 순서대로 새 행을 맨 아래에 쓰고 행 번호를 돌려준다. obj에 없는 열은 비운다.
function appendRowObject_(sheet, headers, obj) {
  var row = headers.map(function (h) {
    return (h && obj[h] != null) ? sanitizeForSheet_(obj[h]) : '';
  });
  var rowNumber = sheet.getLastRow() + 1;
  sheet.getRange(rowNumber, 1, 1, row.length).setValues([row]);
  return rowNumber;
}

// docs/admin.md 4절 「관리기록」 열 순서: 일시·코드·이름·작업·대상·이전 값·새 값.
// 지운 행은 이전 값에 행 전체가 남아 복구 근거가 된다. 로그와 달리 모아 두지 않고 바로 쓴다.
function recordAdminAction_(admin, work, target, before, after) {
  var sheet = getSheet_('관리기록');
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, 7).setValues([[
    new Date(),
    sanitizeForSheet_(admin.code),
    sanitizeForSheet_(admin.name),
    sanitizeForSheet_(work),
    sanitizeForSheet_(target),
    sanitizeForSheet_(before == null ? '' : JSON.stringify(before)),
    sanitizeForSheet_(after == null ? '' : JSON.stringify(after))
  ]]);
}
