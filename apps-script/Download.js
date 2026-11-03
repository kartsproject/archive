/**
 * 영상 내려받기 (docs/api.md 3-6, 2026-11-03 사용자 결정).
 * Vimeo 플레이어를 사이트 안에 넣어 재생하면 Vimeo가 내려받기 버튼을 주지 않고, 영상도 Vimeo에서 숨김이라
 * vimeo.com 영상 페이지로도 받을 수 없다. 그래서 관문이 Vimeo API의 「download」 링크(24시간 뒤 만료,
 * 브라우저가 재생 대신 파일로 저장)를 받아 화질별 목록으로 돌려준다.
 *
 * 허용 범위: 「접근코드」 탭 「내려받기」 열이 `허용`인 코드만 — 요청마다 지금 시트 값을 다시 본다.
 * 대상: 공개여부가 `공개`인 「영상」 · 「작품(영상)」만.
 * Vimeo 토큰(VIMEO_TOKEN)에 `video_files` 권한이 있어야 한다(없으면 VIMEO_ERROR).
 * 받은 링크는 24시간 동안 누구에게나 전달될 수 있다 — 도메인 제한을 거치지 않으므로 허용할 코드를 좁게 둔다.
 */

var DOWNLOAD_ALLOWED_VALUE_ = '허용';
var DOWNLOAD_VIDEO_TYPES_ = { '영상': true, '작품(영상)': true };

function canDownload_(codeRow) {
  return !!codeRow && String(codeRow['내려받기'] || '').trim() === DOWNLOAD_ALLOWED_VALUE_;
}

function handleDownload_(req) {
  var result = verifyToken_(req.token);
  if (!result.valid) return jsonResponse_(false, result.error, null);

  var code = result.row['코드'];
  var link = String(req.link == null ? '' : req.link).trim();
  if (!canDownload_(result.row)) {
    logAccess_('실패(DOWNLOAD_NOT_ALLOWED)', code, '', req.deviceId, 'download', link);
    return jsonResponse_(false, 'DOWNLOAD_NOT_ALLOWED', null);
  }

  var material = findPublicVideoMaterial_(link);
  if (!material) return jsonResponse_(false, 'NOT_FOUND', null);

  var files;
  try {
    files = vimeoDownloadFiles_(link);
  } catch (err) {
    if (err.adminError) return jsonResponse_(false, err.adminError, null); // VIMEO_ERROR · INVALID_INPUT
    throw err;
  }
  if (files.length === 0) return jsonResponse_(false, 'NOT_FOUND', null); // 변환 중이거나 내려받을 파일이 없음

  logAccess_('성공', code, '', req.deviceId, 'download', material.fileName || link);
  return jsonResponse_(true, null, { fileName: material.fileName || '', files: files });
}

// photo의 findPublicPhotoMaterial_과 같은 방식 — 공개 자료 목록에서 링크(Vimeo 영상 ID)로 찾는다.
function findPublicVideoMaterial_(link) {
  if (!link) return null;
  var materials = getDataPayload_().materials;
  for (var i = 0; i < materials.length; i++) {
    if (String(materials[i].link) === link && DOWNLOAD_VIDEO_TYPES_[materials[i].type]) return materials[i];
  }
  return null;
}

// Vimeo 응답의 download 배열을 화질 높은 순으로 다듬는다. 링크는 Vimeo가 정한 만료 시각까지만 쓸 수 있다.
function vimeoDownloadFiles_(videoId) {
  var data = vimeoRequest_('GET', vimeoVideoPath_(videoId) + '?fields=download').data;
  var list = (data && data.download) || [];
  return list
    .filter(function (f) { return f && f.link; })
    .map(function (f) {
      var isSource = f.quality === 'source';
      return {
        label: isSource ? '원본' : (f.rendition || (f.height ? f.height + 'p' : f.quality || '')),
        width: f.width || null,
        height: f.height || null,
        size: f.size || null,
        sizeText: f.size_short || '',
        link: f.link,
        expires: f.expires || ''
      };
    })
    .sort(function (a, b) {
      if (a.label === '원본') return -1;   // 원본(올린 압축본)을 맨 위에
      if (b.label === '원본') return 1;
      return (b.height || 0) - (a.height || 0);
    });
}
