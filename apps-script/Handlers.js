/**
 * action별 처리. data·photo는 WBS 2.7·2.8에서 채운다.
 */

/**
 * 화면은 응답이 늦으면 같은 auth 요청을 한 번 더 보낸다(예비 요청, docs/decisions.md 9절).
 * 두 요청이 각각 토큰을 발급하고 로그를 남기면 기록이 중복되므로, 같은 requestId면 먼저 만든 응답을 그대로 돌려준다.
 */
function handleAuth_(req) {
  if (!req.requestId) return jsonResult_(authenticate_(req));

  var cache = CacheService.getScriptCache();
  var key = 'auth_' + String(req.requestId).slice(0, 200);
  var saved = cache.get(key);
  if (saved) {
    try {
      return jsonResult_(JSON.parse(saved));
    } catch (err) {
      // 캐시가 깨졌으면 그냥 새로 처리한다
    }
  }

  var result = authenticate_(req);
  cache.put(key, JSON.stringify(result), 120);
  return jsonResult_(result);
}

function jsonResult_(result) {
  return jsonResponse_(result.ok, result.error, result.data);
}

function authResult_(ok, error, data) {
  return { ok: ok, error: error, data: data };
}

// docs/api.md 3-1 검증 순서 그대로: 코드 존재 → 상태 → 사용기한 → 기기별 실패 횟수 → 발급·기록
function authenticate_(req) {
  var code = req.code;
  var deviceId = req.deviceId;
  var name = req.name;

  if (!code || !deviceId) return authResult_(false, 'AUTH_INVALID', null);

  var row = findCodeRow_(code);
  if (!row || row['상태'] !== '사용') {
    recordAuthFailure_(deviceId, codePrefix_(code));
    logAccess_('실패(AUTH_INVALID)', code, name, deviceId, 'auth', '');
    return authResult_(false, 'AUTH_INVALID', null);
  }

  if (!isWithinExpiry_(row['사용기한'])) {
    recordAuthFailure_(deviceId, codePrefix_(code));
    logAccess_('실패(AUTH_EXPIRED)', code, name, deviceId, 'auth', '');
    return authResult_(false, 'AUTH_EXPIRED', null);
  }

  if (isDeviceLocked_(deviceId)) {
    logAccess_('실패(AUTH_LOCKED)', code, name, deviceId, 'auth', '');
    return authResult_(false, 'AUTH_LOCKED', null);
  }

  clearAuthFailures_(deviceId);
  var issued = issueToken_(row);
  logAccess_('성공', code, name, deviceId, 'auth', '');
  return authResult_(true, null, {
    token: issued.token,
    expiresAt: issued.expiresAt,
    firstView: row['첫 화면']
  });
}

// docs/api.md 3-2. 새 토큰을 발급해 만료 시각을 늘린다 (docs/decisions.md 협의: 자체 서명 토큰 방식).
function handlePing_(req) {
  var result = verifyToken_(req.token);
  if (!result.valid) return jsonResponse_(false, result.error, null);

  var issued = issueToken_(result.row);
  return jsonResponse_(true, null, {
    token: issued.token,
    expiresAt: issued.expiresAt
  });
}

// docs/api.md 3-3. 인증 직후 1회 호출용 — 공개 자료를 한 번에 모아 반환한다.
function handleData_(req) {
  var result = verifyToken_(req.token);
  if (!result.valid) return jsonResponse_(false, result.error, null);

  // 공개 자료는 모두에게 같아 캐시를 쓰고, 코드마다 다른 값(내려받기 허용)만 여기서 덧붙인다.
  var payload = getDataPayload_();
  var out = {};
  Object.keys(payload).forEach(function (k) { out[k] = payload[k]; });
  out.canDownload = canDownload_(result.row);
  return jsonResponse_(true, null, out);
}

// docs/api.md 3-4. 사진·작품(이미지)만 대상. 실제 축소는 하지 않고 Drive에 올라간 파일을
// 그대로 전달한다 — "축소본"은 운영진이 대표 사진을 고를 때 이미 작게 준비해 올리는 것을 전제로 한다.
function handlePhoto_(req) {
  var result = verifyToken_(req.token);
  if (!result.valid) return jsonResponse_(false, result.error, null);

  var fileId = req.fileId;
  if (!fileId || !findPublicPhotoMaterial_(fileId)) {
    return jsonResponse_(false, 'NOT_FOUND', null);
  }

  try {
    var blob = DriveApp.getFileById(fileId).getBlob();
    return jsonResponse_(true, null, {
      base64: Utilities.base64Encode(blob.getBytes()),
      mimeType: blob.getContentType()
    });
  } catch (err) {
    return jsonResponse_(false, 'NOT_FOUND', null);
  }
}

var PHOTOS_MAX_FILE_BYTES_ = 1024 * 1024;      // 한 장 상한 1MB
var PHOTOS_MAX_TOTAL_BYTES_ = 4 * 1024 * 1024; // 합계 상한 4MB

// docs/api.md 3-5. 세션 하나의 공개 사진을 한 번에 담는다(자료 페이지 진입 시 미리 받기용).
// 사진 목록은 화면이 아니라 관문이 공개 자료에서 찾는다. 크기는 내용을 읽기 전에 확인해,
// 큰 사진과 합계 상한을 넘긴 사진은 skipped로 돌려 화면이 클릭 시 photo로 받게 한다.
function handlePhotos_(req) {
  var result = verifyToken_(req.token);
  if (!result.valid) return jsonResponse_(false, result.error, null);

  var sessionId = req.sessionId;
  if (!sessionId) return jsonResponse_(false, 'NOT_FOUND', null);

  var seen = {};
  var fileIds = [];
  getDataPayload_().materials.forEach(function (m) {
    if (m.sessionId !== sessionId || m.type !== '사진' || !m.link) return;
    var fileId = String(m.link);
    if (seen[fileId]) return; // 같은 파일을 여러 행에 적었으면 한 번만 담는다
    seen[fileId] = true;
    fileIds.push(fileId);
  });

  var photos = [];
  var skipped = [];
  var total = 0;
  var budgetSpent = false;
  fileIds.forEach(function (fileId) {
    if (budgetSpent) { skipped.push(fileId); return; } // 합계를 넘긴 뒤로는 드라이브를 열지 않는다
    try {
      var file = DriveApp.getFileById(fileId);
      var size = file.getSize();
      if (size >= PHOTOS_MAX_FILE_BYTES_) { skipped.push(fileId); return; }
      if (total + size > PHOTOS_MAX_TOTAL_BYTES_) { budgetSpent = true; skipped.push(fileId); return; }
      var blob = file.getBlob();
      photos.push({
        fileId: fileId,
        base64: Utilities.base64Encode(blob.getBytes()),
        mimeType: blob.getContentType()
      });
      total += size;
    } catch (err) {
      skipped.push(fileId); // 열 수 없는 파일은 클릭 시 photo가 NOT_FOUND로 알려 준다
    }
  });

  return jsonResponse_(true, null, { photos: photos, skipped: skipped });
}
