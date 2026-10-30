/**
 * Vimeo API 호출 (docs/admin.md 7-4, WBS 5.5). 관리자 페이지 [영상 관리]만 쓴다.
 * 토큰은 Script Properties `VIMEO_TOKEN`에만 두고 화면으로 보내지 않는다 — 화면에는 업로드 주소만 간다.
 * 토큰 권한은 public·private·create·edit·upload라 영상을 지우거나 다른 폴더로 옮기지 못한다.
 * 그래서 버릴 영상은 제목 앞에 「[삭제 필요]」만 붙이고 운영진이 Vimeo 화면에서 지운다(docs/admin-media-notes.md 2-1).
 * 설정·폴더 규칙은 기존 업로드 프로그램(archive-run.js)과 같다.
 */

var VIMEO_API_ = 'https://api.vimeo.com';
var VIMEO_DEFAULT_DOMAIN_ = 'kartsproject.github.io'; // 「설정」 「영상 허용 도메인」이 비었을 때 (2026-10-30 저장소 이전)
var VIMEO_DISCARD_PREFIX_ = '[삭제 필요] ';
var VIMEO_ROOT_FOLDER_ = 'K예술영재 아카이브';
// Vimeo 분야 폴더 이름은 시트 분야명과 다르다(전통예술 → 전통, 2026-10-30 폴더 목록 확인)
var VIMEO_DISCIPLINE_FOLDER_ = { '음악': '음악', '무용': '무용', '전통예술': '전통', '미술': '미술' };
// 멘토링·캠프의 폴더 이름은 정해지지 않았다(docs/admin.md 7-4 확인 필요 ②). 없는 프로그램은 영상 추가를 막는다.
var VIMEO_PROGRAM_FOLDER_ = { ws: '워크숍' };
var VIMEO_WEEKDAYS_ = ['일', '월', '화', '수', '목', '금', '토'];

// Vimeo 쪽 실패는 화면이 "Vimeo 연결 문제"로 안내할 수 있게 VIMEO_ERROR로 던진다. 자세한 내용은 실행 기록에만 남긴다.
function vimeoRequest_(method, path, body, okStatus) {
  var token = PropertiesService.getScriptProperties().getProperty('VIMEO_TOKEN');
  if (!token) {
    console.error('스크립트 속성 VIMEO_TOKEN이 없음 — Apps Script 편집기 프로젝트 설정에서 넣을 것');
    throw adminError_('VIMEO_ERROR');
  }
  okStatus = okStatus || [200, 201, 204];
  var options = {
    method: method.toLowerCase(),
    muteHttpExceptions: true,
    headers: { Authorization: 'bearer ' + token, Accept: 'application/vnd.vimeo.*+json;version=3.4' }
  };
  if (body) {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(body);
  }
  // 요청 하나가 관문 실행 시간을 오래 잡지 않게 짧게 세 번까지만 다시 해 본다(429·5xx)
  for (var attempt = 1; ; attempt++) {
    var res = UrlFetchApp.fetch(VIMEO_API_ + path, options);
    var status = res.getResponseCode();
    if (okStatus.indexOf(status) !== -1) {
      var text = res.getContentText();
      return { status: status, data: text ? JSON.parse(text) : {} };
    }
    if ((status === 429 || status >= 500) && attempt < 3) {
      Utilities.sleep(2000 * attempt);
      continue;
    }
    console.error('Vimeo ' + method + ' ' + path.split('?')[0] + ' → ' + status + ' ' + res.getContentText().slice(0, 300));
    throw adminError_('VIMEO_ERROR');
  }
}

// 편집기에서 한 번 실행해 외부 요청 권한을 승인하고 VIMEO_TOKEN이 맞는지 본다(읽기만 함, 토큰 값은 남기지 않음).
function checkVimeoConnection() {
  // 권한을 항목별로 승인하는 방식이라 새 권한이 생겨도 자동으로 다시 묻지 않을 수 있어, 여기서 승인 창을 띄운다
  ScriptApp.requireScopes(ScriptApp.AuthMode.FULL, ['https://www.googleapis.com/auth/script.external_request']);
  try {
    var data = vimeoRequest_('GET', '/oauth/verify').data;
    Logger.log('Vimeo 연결 성공 — 계정: ' + ((data.user && data.user.name) || '(이름 없음)') + ' · 권한: ' + (data.scope || '(알 수 없음)'));
  } catch (err) {
    Logger.log('Vimeo 연결 실패 — 위 실행 기록의 오류를 확인할 것 (' + (err.adminError || err.message) + ')');
  }
}

// 「자료」 링크 값이 그대로 주소에 들어가므로 숫자 ID만 받는다.
function vimeoVideoPath_(videoId) {
  var id = String(videoId == null ? '' : videoId).trim();
  if (!/^\d+$/.test(id)) throw adminError_('INVALID_INPUT');
  return '/videos/' + id;
}

/* ---------- 폴더 ---------- */

// 'K예술영재 아카이브 › 2026 워크숍 › 음악 › 08-07 (금)'. 연도는 「설정」 사업연도(없으면 일자의 연도).
// 폴더가 정해지지 않은 프로그램·분야면 null.
function vimeoFolderPath_(programCode, discipline, date) {
  var programFolder = VIMEO_PROGRAM_FOLDER_[programCode];
  var disciplineFolder = VIMEO_DISCIPLINE_FOLDER_[discipline];
  var m = String(date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!programFolder || !disciplineFolder || !m) return null;
  var year = String(getSetting_('사업연도', m[1])).trim();
  var weekday = VIMEO_WEEKDAYS_[new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay()];
  return [VIMEO_ROOT_FOLDER_, year + ' ' + programFolder, disciplineFolder, m[2] + '-' + m[3] + ' (' + weekday + ')'];
}

// GET /me/projects는 하위 폴더까지 모두 주고, 폴더마다 상위 폴더 주소가 붙어 있다(2026-10-30 확인).
function vimeoListFolders_() {
  var folders = [];
  var path = '/me/projects?per_page=100&fields=uri,name,metadata.connections.parent_folder.uri';
  while (path) {
    var page = vimeoRequest_('GET', path).data;
    (page.data || []).forEach(function (f) {
      var c = f.metadata && f.metadata.connections;
      folders.push({ uri: f.uri, name: f.name, parent: (c && c.parent_folder && c.parent_folder.uri) || null });
    });
    path = page.paging && page.paging.next ? page.paging.next : null;
  }
  return folders;
}

// 위에서부터 「이름 + 상위 폴더」가 맞는 폴더를 따라가고, 없는 단계만 만든다.
// 같은 이름 폴더가 두 번 생기지 않도록 쓰기 잠금(adminWrite_) 안에서 부른다.
function vimeoEnsureFolder_(segs) {
  var folders = vimeoListFolders_();
  var parent = null;
  segs.forEach(function (name) {
    var found = null;
    for (var i = 0; i < folders.length; i++) {
      if (folders[i].name === name && folders[i].parent === parent) { found = folders[i]; break; }
    }
    if (!found) {
      var body = { name: name };
      if (parent) body.parent_folder_uri = parent;
      var created = vimeoRequest_('POST', '/me/projects?fields=uri', body).data;
      found = { uri: created.uri, name: name, parent: parent };
      folders.push(found);
      console.log('Vimeo 폴더 만듦: ' + segs.slice(0, segs.indexOf(name) + 1).join(' › '));
    }
    parent = found.uri;
  });
  return parent;
}

/* ---------- 영상 ---------- */

// 빈 영상을 만들고 tus 업로드 주소를 받는다. 숨김·허용 도메인에서만 재생·내려받기 차단·폴더를 이때 정한다.
// 제목은 파일명에서 확장자를 뗀 것(「자료」 파일명과 같게 유지, docs/admin.md 7-2).
function vimeoCreateUpload_(title, size, folderUri) {
  var v = vimeoRequest_('POST', '/me/videos?fields=uri,upload.upload_link', {
    upload: { approach: 'tus', size: size },
    name: title,
    folder_uri: folderUri,
    privacy: { view: 'disable', embed: 'whitelist', download: false, add: false, comments: 'nobody' }
  }).data;
  if (!v.uri || !v.upload || !v.upload.upload_link) {
    console.error('Vimeo 영상 생성 응답에 업로드 주소가 없음');
    throw adminError_('VIMEO_ERROR');
  }
  return { videoId: v.uri.split('/').pop(), uploadLink: v.upload.upload_link };
}

// 'complete' · 'in_progress' · 'error' 등. 영상이 없으면 'missing'.
function vimeoUploadStatus_(videoId) {
  var res = vimeoRequest_('GET', vimeoVideoPath_(videoId) + '?fields=upload.status', null, [200, 404]);
  if (res.status === 404) return 'missing';
  return (res.data.upload && res.data.upload.status) || '';
}

// 「설정」 「영상 허용 도메인」. 쉼표로 여러 개를 적을 수 있다(주소 이전 중 옛 도메인을 함께 둘 때).
function vimeoAllowedDomains_() {
  var raw = String(getSetting_('영상 허용 도메인', VIMEO_DEFAULT_DOMAIN_));
  var domains = raw.split(',').map(function (d) {
    return d.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  }).filter(function (d) {
    return /^[a-z0-9.-]+$/.test(d);
  });
  return domains.length ? domains : [VIMEO_DEFAULT_DOMAIN_];
}

// 업로드가 끝난 영상에 허용 도메인을 등록하고, 공개 설정·폴더·도메인을 다시 읽어 확인한다.
// 기대와 다르면 VIMEO_ERROR — 「자료」에 등록하지 않는다(사이트 밖에서 재생되는 영상이 생기지 않게).
function vimeoFinishSettings_(videoId, folderUri) {
  var path = vimeoVideoPath_(videoId);
  var domains = vimeoAllowedDomains_();
  domains.forEach(function (d) {
    vimeoRequest_('PUT', path + '/privacy/domains/' + encodeURIComponent(d));
  });

  var v = vimeoRequest_('GET', path + '?fields=privacy.view,privacy.embed,privacy.download,parent_folder.uri').data;
  var p = v.privacy || {};
  var problems = [];
  if (p.view !== 'disable' || p.embed !== 'whitelist' || p.download !== false) problems.push('공개 설정 ' + JSON.stringify(p));
  if (folderUri && (!v.parent_folder || v.parent_folder.uri !== folderUri)) problems.push('폴더가 다름');
  var registered = (vimeoRequest_('GET', path + '/privacy/domains?per_page=100').data.data || []).map(function (d) { return d.domain; });
  domains.forEach(function (d) {
    if (registered.indexOf(d) === -1) problems.push('허용 도메인 없음 ' + d);
  });
  if (problems.length) {
    console.error('Vimeo ' + videoId + ' 설정 확인 실패: ' + problems.join(', '));
    throw adminError_('VIMEO_ERROR');
  }
}

// 지운 자료·등록 전에 실패한 영상: 지금 Vimeo 제목 앞에 「[삭제 필요]」를 붙인다(이미 붙어 있으면 그대로).
// 영상이 이미 없으면 false.
function vimeoMarkDiscard_(videoId) {
  var path = vimeoVideoPath_(videoId);
  var res = vimeoRequest_('GET', path + '?fields=name', null, [200, 404]);
  if (res.status === 404) return false;
  var name = String(res.data.name || '');
  if (name.indexOf(VIMEO_DISCARD_PREFIX_) === 0) return true;
  vimeoRequest_('PATCH', path + '?fields=uri', { name: VIMEO_DISCARD_PREFIX_ + name });
  return true;
}
