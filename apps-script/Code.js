/**
 * 관문 진입점. 화면은 이 두 함수로만 관문에 닿는다.
 * docs/api.md 1절: 응답은 JSON만, { ok, error, data } 고정.
 */

function doPost(e) {
  try {
    var req = JSON.parse(e.postData.contents);
    return route_(req);
  } catch (err) {
    return jsonResponse_(false, 'SERVER_ERROR', null);
  }
}

function doGet(e) {
  // docs/api.md 1절: 토큰은 요청 본문으로만 전달한다(URL 금지). GET은 지원하지 않는다.
  return jsonResponse_(false, 'SERVER_ERROR', null);
}

function route_(req) {
  switch (req.action) {
    case 'auth':
      return handleAuth_(req);
    case 'ping':
      return handlePing_(req);
    case 'data':
      return handleData_(req);
    case 'photo':
      return handlePhoto_(req);
    case 'photos':
      return handlePhotos_(req);
    case 'adminAuth':
      return handleAdminAuth_(req);
    default:
      // 관리자 페이지 요청(docs/admin.md 8절)은 Admin.js가 관리자 토큰을 확인한 뒤 나눠 준다.
      if (isAdminAction_(req.action)) return handleAdmin_(req);
      return jsonResponse_(false, 'SERVER_ERROR', null);
  }
}

function jsonResponse_(ok, error, data) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: ok, error: error, data: data }))
    .setMimeType(ContentService.MimeType.JSON);
}
