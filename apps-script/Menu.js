/**
 * docs/sheet-schema.md 10절 시트 메뉴. 공통 시트에 붙은 스크립트라 공통 시트를 열 때만 뜬다.
 * 메뉴 항목은 인자를 넘길 수 없어, 프로그램별 진입 함수를 따로 둔다.
 */
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('K예술영재 아카이브')
    .addSubMenu(programMenu_(ui, 'Workshop', '워크숍'))
    .addSubMenu(programMenu_(ui, 'Mentoring', '심화 멘토링'))
    .addSubMenu(programMenu_(ui, 'Camp', '겨울 심화캠프'))
    .addSeparator()
    .addItem('점검', 'runInspection')
    .addItem('캐시 비우기', 'clearCacheNow')
    .addItem('영상 허용 도메인 모두 등록', 'addVideoDomainsAll')
    .addToUi();
}

function programMenu_(ui, suffix, label) {
  return ui.createMenu(label)
    .addItem('세션ID 생성', 'generateSessionIds' + suffix)
    .addItem('출석부 변환', 'convertAttendance' + suffix)
    .addItem('영상 매칭', 'matchVideos' + suffix)
    .addItem('시작 위치 입력', 'applyStartPositions' + suffix);
}

// 스크립트가 쓴 값에는 편집 트리거가 반응하지 않으므로, 메뉴 작업 뒤에는 캐시를 직접 비운다.
function runAndClearCache_(program, work) {
  work(program);
  bumpCacheVersion_();
}

function generateSessionIdsWorkshop() { runAndClearCache_(getProgram_('ws'), generateSessionIdsFor_); }
function generateSessionIdsMentoring() { runAndClearCache_(getProgram_('mt'), generateSessionIdsFor_); }
function generateSessionIdsCamp() { runAndClearCache_(getProgram_('camp'), generateSessionIdsFor_); }

function convertAttendanceWorkshop() { runAndClearCache_(getProgram_('ws'), convertAttendanceFor_); }
function convertAttendanceMentoring() { runAndClearCache_(getProgram_('mt'), convertAttendanceFor_); }
function convertAttendanceCamp() { runAndClearCache_(getProgram_('camp'), convertAttendanceFor_); }

function matchVideosWorkshop() { runAndClearCache_(getProgram_('ws'), matchVideosFor_); }
function matchVideosMentoring() { runAndClearCache_(getProgram_('mt'), matchVideosFor_); }
function matchVideosCamp() { runAndClearCache_(getProgram_('camp'), matchVideosFor_); }

function applyStartPositionsWorkshop() { runAndClearCache_(getProgram_('ws'), applyStartPositionsFor_); }
function applyStartPositionsMentoring() { runAndClearCache_(getProgram_('mt'), applyStartPositionsFor_); }
function applyStartPositionsCamp() { runAndClearCache_(getProgram_('camp'), applyStartPositionsFor_); }

// 편집 트리거가 동작하지 않았거나 화면이 옛 자료를 보여줄 때 쓰는 수동 장치.
function clearCacheNow() {
  bumpCacheVersion_();
  flushLogBuffer_();
  SpreadsheetApp.getUi().alert('캐시를 비웠습니다. 다음 접속부터 시트를 새로 읽습니다.');
}

// 빠진 값·중복·연결 안 된 자료를 공통 시트와 세 프로그램 시트 전체에서 찾는다 (docs/sheet-schema.md 10절).
function runInspection() {
  var issues = [];

  // 학생ID는 동명이인 구분의 유일한 근거라, 오타가 있으면 조용히 구분이 깨진다 (docs/sheet-schema.md 13절).
  var studentIds = {};
  sheetRowsAsObjects_('학생').forEach(function (s, idx) {
    var id = s['학생ID'];
    if (!id) return;
    if (studentIds[id]) {
      issues.push('학생 ' + (idx + 2) + '행: 학생ID "' + id + '" 중복');
    } else {
      studentIds[id] = true;
    }
  });

  // 시트 하나를 못 열어도 나머지는 계속 점검한다.
  PROGRAMS_.forEach(function (program) {
    try {
      inspectProgram_(program, studentIds, issues);
    } catch (err) {
      issues.push(program.name + ': 점검할 수 없음 — ' + err.message);
    }
  });

  var message = issues.length === 0
    ? '문제를 찾지 못했습니다.'
    : issues.slice(0, 30).join('\n') + (issues.length > 30 ? '\n...외 ' + (issues.length - 30) + '건' : '');

  SpreadsheetApp.getUi().alert('점검 결과 (' + issues.length + '건)', message, SpreadsheetApp.getUi().ButtonSet.OK);
}

function inspectProgram_(program, studentIds, issues) {
  var label = program.name + ' › ';

  var sessions = sheetRowsAsObjects_('일정', program);
  var seenIds = {};
  sessions.forEach(function (s, idx) {
    if (!s['세션ID']) {
      issues.push(label + '일정 ' + (idx + 2) + '행: 세션ID가 비어있음');
    } else if (seenIds[s['세션ID']]) {
      issues.push(label + '일정: 세션ID "' + s['세션ID'] + '" 중복');
    } else {
      seenIds[s['세션ID']] = true;
    }
  });

  var isWork = { '작품(영상)': true, '작품(이미지)': true };
  var materials = sheetRowsAsObjects_('자료', program);
  materials.forEach(function (m, idx) {
    if (isWork[m['자료유형']]) return; // 학생 작품은 세션ID 없어도 정상 (docs/sheet-schema.md 5절)
    if (!m['세션ID']) {
      issues.push(label + '자료 ' + (idx + 2) + '행: 세션ID가 비어있음');
    } else if (!seenIds[m['세션ID']]) {
      issues.push(label + '자료 ' + (idx + 2) + '행: 세션ID "' + m['세션ID'] + '"가 같은 시트 「일정」에 없음');
    }
  });

  var attendanceValues = getSheet_('출석부', program).getDataRange().getValues();
  for (var r = 1; r < attendanceValues.length; r++) {
    var attendanceStudentId = attendanceValues[r][1];
    if (attendanceStudentId && !studentIds[attendanceStudentId]) {
      issues.push(label + '출석부 ' + (r + 1) + '행: 학생ID "' + attendanceStudentId + '"가 「학생」 탭에 없음');
    }
  }

  materials.forEach(function (m, idx) {
    var materialStudentId = m['학생ID'];
    if (materialStudentId && !studentIds[materialStudentId]) {
      issues.push(label + '자료 ' + (idx + 2) + '행: 학생ID "' + materialStudentId + '"가 「학생」 탭에 없음');
    }
  });
}
