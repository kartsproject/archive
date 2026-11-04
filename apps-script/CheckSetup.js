/**
 * 설정 점검 (2026-11-04 WBS 5.8 새 구글 계정 이전 — docs/setup-new-account.md).
 * Apps Script 편집기에서 checkSetup을 골라 ▶로 실행하면, 관문이 동작하는 데 필요한 것을 하나씩 확인해
 * 실행 기록에 ✅ / ❌ 로 남긴다. 아무것도 바꾸지 않으므로 몇 번이고 실행해도 된다.
 * 비밀값(서명 키 · 토큰)은 있는지만 보고 값은 적지 않는다.
 */
function checkSetup() {
  var ok = 0, bad = 0;
  function pass(msg) { ok++; Logger.log('✅ ' + msg); }
  function fail(msg) { bad++; Logger.log('❌ ' + msg); }
  var props = PropertiesService.getScriptProperties();

  Logger.log('실행 계정: ' + Session.getEffectiveUser().getEmail());

  // 1. 서명 키
  if (props.getProperty('TOKEN_SECRET')) pass('TOKEN_SECRET 있음');
  else fail('TOKEN_SECRET 없음 → setupTokenSecret을 한 번 실행');

  // 2. 공통 시트 탭
  var common = SpreadsheetApp.getActiveSpreadsheet();
  ['접근코드', '설정', '학생', '로그'].forEach(function (name) {
    if (common.getSheetByName(name)) pass('공통 「' + name + '」 탭 있음');
    else fail('「' + name + '」 탭이 없음 — 예전 공통 시트의 사본인지 확인');
  });
  if (common.getSheetByName('관리기록')) pass('「관리기록」 탭 있음');
  else fail('「관리기록」 탭 없음 → setupAdminSheets를 한 번 실행');

  // 3. 접근코드
  try {
    var codes = sheetRowsAsObjects_('접근코드').filter(function (r) { return String(r['코드'] || '').trim(); });
    if (codes.length) pass('접근코드 ' + codes.length + '개');
    else fail('접근코드가 하나도 없음 — 「접근코드」 탭에 줄을 넣을 것');
  } catch (err) { fail('접근코드를 읽지 못함 — ' + err.message); }

  // 4. 프로그램 탭 12개 (2026-11-04부터 이 시트 안 — 워크숍_일정 등)
  PROGRAMS_.forEach(function (program) {
    var missing = Object.keys(PROGRAM_TAB_HEADERS_).filter(function (t) {
      return t !== '읽어보기' && !common.getSheetByName(programTabName_(program, t));
    }).map(function (t) { return programTabName_(program, t); });
    if (missing.length) fail('탭이 없음: ' + missing.join(', ') + ' → importProgramSheets(예전 시트 가져오기) 또는 setupProgramSheets(빈 탭) 실행');
    else {
      var rows = 0;
      try { rows = sheetRowsAsObjects_('일정', program).length; } catch (err) { /* 위에서 확인 */ }
      pass(program.name + ' 탭 4개 있음 (일정 ' + rows + '줄)');
    }
  });
  var oldProps = PROGRAMS_.map(function (p) { return p.old; }).concat(['SHEET_ID_WORKSHOP', 'SHEET_ID_MENTORING', 'SHEET_ID_CAMP'])
    .filter(function (k) { return props.getProperty(k); });
  if (oldProps.length) Logger.log('ℹ️ 더 이상 쓰지 않는 스크립트 속성: ' + oldProps.join(', ') + ' — 가져오기가 끝났으면 지워도 됨');

  // 5. 트리거
  var handlers = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
  var edits = handlers.filter(function (h) { return h === 'onSheetEdit'; }).length;
  var flush = handlers.filter(function (h) { return h === 'flushLogs'; }).length;
  if (edits === 1 && flush === 1) pass('트리거 설치됨 (시트 편집 1 · 로그 1)');
  else fail('트리거가 맞지 않음 (시트 편집 ' + edits + '/1 · 로그 ' + flush + '/1) → installTriggers 실행');

  // 6. Vimeo
  if (!props.getProperty('VIMEO_TOKEN')) {
    fail('VIMEO_TOKEN 없음 → 스크립트 속성에 Vimeo 토큰을 넣을 것');
  } else {
    try {
      var v = vimeoRequest_('GET', '/oauth/verify').data;
      var scope = String(v.scope || '');
      pass('Vimeo 연결됨 — 계정 ' + ((v.user && v.user.name) || '?'));
      if (scope.indexOf('video_files') === -1) fail('Vimeo 토큰에 video_files 권한이 없음 — 영상 내려받기가 안 됨');
    } catch (err) { fail('Vimeo 연결 실패 — 토큰 확인 (' + (err.adminError || err.message) + ')'); }
  }

  // 7. 사진 파일 접근 (드라이브) — 「자료」의 사진 · 작품(이미지) 링크(파일 ID)를 이 계정이 열 수 있어야 화면에 보인다
  var photos = [];
  PROGRAMS_.forEach(function (program) {
    try {
      sheetRowsAsObjects_('자료', program).forEach(function (m) {
        if ((m['자료유형'] === '사진' || m['자료유형'] === '작품(이미지)') && m['링크']) photos.push(String(m['링크']).trim());
      });
    } catch (err) { /* 탭 문제는 4번에서 알림 */ }
  });
  if (!photos.length) {
    pass('사진 자료 없음 (확인할 것 없음)');
  } else {
    var sample = photos.slice(0, 30), denied = [];
    sample.forEach(function (id) { try { DriveApp.getFileById(id).getName(); } catch (err) { denied.push(id.slice(0, 6) + '…'); } });
    if (denied.length) fail('사진 ' + sample.length + '장 중 ' + denied.length + '장을 열 수 없음 — 사진이 든 드라이브 폴더를 이 계정에 공유할 것');
    else pass('사진 파일 열림 (' + sample.length + '장 확인, 전체 ' + photos.length + '장)');
  }

  // 8. 웹앱 배포
  var url = ScriptApp.getService().getUrl();
  if (url) Logger.log('ℹ️ 이 스크립트의 웹앱 주소: ' + url + '\n   → 저장소 site/js/api.js의 GATEWAY_URL이 이 주소와 같아야 함 (끝이 /exec)');
  else fail('웹앱 배포가 아직 없음 → 배포 › 새 배포 › 웹 앱 (실행: 나, 액세스: 모든 사용자)');

  Logger.log('— 결과: 통과 ' + ok + ' · 확인 필요 ' + bad + (bad ? ' (❌ 줄의 → 안내대로 고친 뒤 다시 실행)' : ' — 준비 끝'));
}
