/**
 * 관리자 페이지 [접근코드] 탭 (docs/admin.md 5절, WBS 5.2).
 * 공통 규칙(잠금·저장 직전 확인·관리기록·캐시)은 Admin.js의 함수를 그대로 쓴다.
 */

var CODE_PATTERN_ = /^[A-Z0-9-]{4,20}$/;        // 로그인 입력칸 최대 20자, 대문자·숫자·-만
var ADMIN_CODE_MIN_LENGTH_ = 12;                // docs/admin.md 3절: 관리자 코드는 열람 코드보다 길게
var CODE_STATUS_VALUES_ = ['사용', '정지'];
var CODE_ROLE_VALUES_ = ['열람', ADMIN_ROLE_];
var CODE_TEXT_LIMITS_ = { '이름': 40, '배포 대상': 20, '첫 화면': 20, '비고': 200 };

// 목록. 행마다 _row(시트 행 번호)가 붙고, 화면은 이 값을 저장 직전 확인(before)으로 되돌려 보낸다.
function adminCodes_(req, admin) {
  var table = readAdminTable_('접근코드');
  return {
    headers: table.headers.filter(function (h) { return h; }),
    rows: table.rows,
    currentCode: admin.code
  };
}

// req.mode: 'add' { fields } | 'update' { row, before, changes }
function adminCodeSave_(req, admin) {
  if (req.mode === 'add') return addCode_(req.fields, admin);
  if (req.mode === 'update') return updateCode_(req.row, req.before, req.changes, admin);
  throw adminError_('INVALID_INPUT');
}

function addCode_(fields, admin) {
  if (!fields || typeof fields !== 'object') throw adminError_('INVALID_INPUT');
  return adminWrite_(function () {
    var table = readAdminTable_('접근코드');
    var row = normalizeCodeFields_(fields, table.headers);
    if (!row['코드'] || !row['이름'] || !row['사용기한']) throw adminError_('INVALID_INPUT');
    row['상태'] = row['상태'] || '사용';
    row['권한'] = row['권한'] || '열람';
    row['버전'] = 1;
    assertCodeRules_(row);
    assertCodeUnique_(table.rows, row['코드'], null);

    var rowNumber = appendRowObject_(table.sheet, table.headers, row);
    recordAdminAction_(admin, '코드 추가', row['코드'], null, row);
    return { row: rowNumber, code: row['코드'] };
  });
}

function updateCode_(rowNumber, before, changes, admin) {
  if (!changes || typeof changes !== 'object' || Object.keys(changes).length === 0) throw adminError_('INVALID_INPUT');
  return adminWrite_(function () {
    var table = readAdminTable_('접근코드');
    var current = checkRowUnchanged_(table.sheet, table.headers, rowNumber, before);
    var updates = normalizeCodeFields_(changes, table.headers);
    if ('버전' in updates) throw adminError_('INVALID_INPUT'); // 버전은 [접속 끊기]와 코드 변경으로만 올린다

    // 자기 잠금 방지(docs/admin.md 3절): 지금 로그인한 코드의 코드·상태·권한은 바꾸지 않는다
    if (current['코드'] === admin.code && ('코드' in updates || '상태' in updates || '권한' in updates)) {
      throw adminError_('INVALID_INPUT');
    }

    var merged = {};
    Object.keys(current).forEach(function (k) { merged[k] = current[k]; });
    Object.keys(updates).forEach(function (k) { merged[k] = updates[k]; });
    if (!merged['코드'] || !merged['이름'] || !merged['사용기한']) throw adminError_('INVALID_INPUT');
    assertCodeRules_(merged, current);

    // 코드 글자를 바꾸면 옛 코드로 받은 접속을 끊는다(docs/admin.md 5절)
    if ('코드' in updates && updates['코드'] !== current['코드']) {
      assertCodeUnique_(table.rows, updates['코드'], current._row);
      updates['버전'] = nextVersion_(current['버전']);
    }

    writeRowChanges_(table.sheet, table.headers, current._row, updates);
    recordAdminAction_(admin, '코드 수정', current['코드'], current, updates);
    return { row: current._row };
  });
}

// 버전 +1 → 그 코드로 받은 토큰이 다음 요청부터 TOKEN_EXPIRED (Token.js verifyToken_)
function adminCodeRevoke_(req, admin) {
  return adminWrite_(function () {
    var table = readAdminTable_('접근코드');
    var current = checkRowUnchanged_(table.sheet, table.headers, req.row, req.before);
    if (current['코드'] === admin.code) throw adminError_('INVALID_INPUT'); // 자기 접속을 끊지 않게
    var version = nextVersion_(current['버전']);
    writeRowChanges_(table.sheet, table.headers, current._row, { '버전': version });
    recordAdminAction_(admin, '접속 끊기', current['코드'], { '버전': current['버전'] }, { '버전': version });
    return { row: current._row, version: version };
  });
}

/* ---------- 검사 ---------- */

// 받은 값을 글자로 다듬는다. 시트에 없는 열이면 INVALID_INPUT. 코드는 대문자로.
function normalizeCodeFields_(fields, headers) {
  var out = {};
  Object.keys(fields).forEach(function (key) {
    if (key === '_row') return;
    if (headers.indexOf(key) === -1) throw adminError_('INVALID_INPUT');
    var value = String(fields[key] == null ? '' : fields[key]).trim();
    if (key === '코드') value = value.toUpperCase();
    if (CODE_TEXT_LIMITS_[key] && value.length > CODE_TEXT_LIMITS_[key]) throw adminError_('INVALID_INPUT');
    out[key] = value;
  });
  return out;
}

// current가 있으면(수정) 원래 값 그대로인 상태 등은 목록 밖 값이어도 둔다 — 손으로 넣은 예전 값을 존중.
function assertCodeRules_(row, current) {
  var unchanged = function (key) { return current && current[key] === row[key]; };

  if (!CODE_PATTERN_.test(row['코드']) && !unchanged('코드')) throw adminError_('INVALID_INPUT');
  if (row['권한'] === ADMIN_ROLE_ && row['코드'].length < ADMIN_CODE_MIN_LENGTH_) throw adminError_('INVALID_INPUT');
  if (row['상태'] && CODE_STATUS_VALUES_.indexOf(row['상태']) === -1 && !unchanged('상태')) throw adminError_('INVALID_INPUT');
  if (row['권한'] && CODE_ROLE_VALUES_.indexOf(row['권한']) === -1 && !unchanged('권한')) throw adminError_('INVALID_INPUT');
  if (!isValidDateText_(row['사용기한']) && !unchanged('사용기한')) throw adminError_('INVALID_INPUT');
}

function assertCodeUnique_(rows, code, exceptRow) {
  rows.forEach(function (r) {
    if (r._row !== exceptRow && String(r['코드']).trim().toUpperCase() === code) throw adminError_('INVALID_INPUT');
  });
}

function isValidDateText_(text) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text));
  if (!m) return false;
  var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]);
}

function nextVersion_(version) {
  return (Number(version) || 0) + 1;
}
