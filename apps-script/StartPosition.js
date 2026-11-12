/**
 * 「자료」 「시작 위치」 열 — 여러 수업 칸에 걸친 긴 통녹화를 칸마다 그 수업 시작 지점부터 재생한다(2026-11-12).
 * 값은 「1:05:30」(시:분:초)이나 「65:30」(분:초). 비우면 처음부터. 관문은 초 단위 숫자(start)로 내보낸다.
 * docs/sheet-schema.md 3-3, docs/decisions.md 9절 「통녹화 시작 위치」.
 */

var START_POSITION_HEADER_ = '시작 위치';
var START_POSITION_INPUT_TAB_ = '시작위치_입력';
var START_POSITION_MAX_ = 24 * 3600; // 하루를 넘는 영상은 없으므로 그보다 큰 값은 잘못 적은 것으로 본다

// 시트 값 → 초. 비었거나 형식이 틀리면 0(처음부터 재생).
// 열 서식이 「일반 텍스트」가 아니면 시트가 「1:05:30」을 시각(Date)으로 바꿔 두므로 그 경우도 읽는다.
function parseStartSeconds_(value) {
  if (value == null || value === '') return 0;
  var text;
  if (Object.prototype.toString.call(value) === '[object Date]') {
    text = Utilities.formatDate(value, Session.getScriptTimeZone(), 'H:mm:ss');
  } else if (typeof value === 'number') {
    // 시트가 시각을 하루의 비율(0.0455…)로 줄 때와 초를 숫자로 적었을 때
    var sec = value < 1 ? Math.round(value * 86400) : Math.round(value);
    return sec > 0 && sec < START_POSITION_MAX_ ? sec : 0;
  } else {
    text = String(value).trim();
  }
  var m = text.match(/^(\d{1,2}):(\d{1,2}):(\d{1,2})$/);
  var seconds;
  if (m) {
    seconds = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  } else {
    m = text.match(/^(\d{1,3}):(\d{1,2})$/);
    if (!m) return 0;
    seconds = Number(m[1]) * 60 + Number(m[2]);
  }
  return seconds > 0 && seconds < START_POSITION_MAX_ ? seconds : 0;
}

function formatStartSeconds_(seconds) {
  var h = Math.floor(seconds / 3600);
  var m = Math.floor((seconds % 3600) / 60);
  var s = seconds % 60;
  return h + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
}

/**
 * 시트 메뉴 「시작 위치 입력」. 「시작위치_입력」 탭(머리글: 세션ID · 파일명 · 시작 위치, 다른 열은 무시)을 읽어
 * 고른 프로그램 「자료」 탭에서 세션ID와 파일명이 같은 행의 「시작 위치」에 적는다.
 * 「시작 위치」 열이 없으면 맨 끝에 만들고, 시트가 시각으로 바꾸지 않도록 열 서식을 일반 텍스트로 둔다.
 * 입력 탭의 「시작 위치」가 비어 있으면 그 행의 값을 지운다(처음부터 재생).
 */
function applyStartPositionsFor_(program) {
  var ui = SpreadsheetApp.getUi();
  var input = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(START_POSITION_INPUT_TAB_);
  if (!input) {
    ui.alert('「' + START_POSITION_INPUT_TAB_ + '」 탭이 없습니다.\n\n새 탭을 만들어 이름을 「' + START_POSITION_INPUT_TAB_ +
      '」로 바꾸고, 첫 행에 세션ID · 파일명 · 시작 위치 머리글이 있는 표를 붙여 넣은 뒤 다시 실행하세요.');
    return;
  }
  // 표시값으로 읽는다 — 붙여 넣을 때 시트가 「1:05:30」을 시각으로 바꿔도 보이는 글자 그대로 받는다.
  var inValues = input.getDataRange().getDisplayValues();
  var inHeaders = inValues[0].map(function (h) { return String(h).trim(); });
  var ci = { session: inHeaders.indexOf('세션ID'), file: inHeaders.indexOf('파일명'), start: inHeaders.indexOf(START_POSITION_HEADER_) };
  if (ci.session === -1 || ci.file === -1 || ci.start === -1) {
    ui.alert('「' + START_POSITION_INPUT_TAB_ + '」 탭 첫 행에 세션ID · 파일명 · 시작 위치 머리글이 모두 있어야 합니다.');
    return;
  }

  var sheet = getSheet_('자료', program);
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
  var startCol = headers.indexOf(START_POSITION_HEADER_) + 1;
  if (startCol === 0) {
    startCol = lastCol + 1;
    if (startCol > sheet.getMaxColumns()) sheet.insertColumnAfter(lastCol);
    sheet.getRange(1, startCol).setValue(START_POSITION_HEADER_);
  }
  // 일반 텍스트 — 시트가 「1:05:30」을 시각으로 바꾸지 않게 열 전체에 미리 둔다(머리글 행 제외)
  if (sheet.getMaxRows() >= 2) sheet.getRange(2, startCol, sheet.getMaxRows() - 1, 1).setNumberFormat('@');
  var sessionCol = headers.indexOf('세션ID');
  var fileCol = headers.indexOf('파일명');
  if (sessionCol === -1 || fileCol === -1) {
    ui.alert(program.name + ' 「자료」 탭에서 세션ID · 파일명 열을 찾지 못했습니다.');
    return;
  }

  var lastRow = sheet.getLastRow();
  var rowsByKey = {};
  if (lastRow >= 2) {
    var values = sheet.getRange(2, 1, lastRow - 1, Math.max(sessionCol, fileCol) + 1).getValues();
    values.forEach(function (row, i) {
      var key = String(row[sessionCol]).trim() + '|' + String(row[fileCol]).trim();
      (rowsByKey[key] = rowsByKey[key] || []).push(i + 2);
    });
  }

  var startRange = lastRow >= 2 ? sheet.getRange(2, startCol, lastRow - 1, 1) : null;
  var startValues = startRange ? startRange.getValues() : [];
  var applied = 0;
  var cleared = 0;
  var missing = [];
  var invalid = [];
  for (var r = 1; r < inValues.length; r++) {
    var sessionId = String(inValues[r][ci.session]).trim();
    var fileName = String(inValues[r][ci.file]).trim();
    if (!sessionId && !fileName) continue;
    var raw = String(inValues[r][ci.start]).trim();
    var seconds = parseStartSeconds_(raw);
    if (raw && !seconds) { invalid.push((r + 1) + '행 ' + raw); continue; }
    var targets = rowsByKey[sessionId + '|' + fileName];
    if (!targets) { missing.push(sessionId + ' ' + fileName); continue; }
    targets.forEach(function (rowNumber) {
      startValues[rowNumber - 2][0] = seconds ? formatStartSeconds_(seconds) : '';
    });
    if (seconds) applied++; else cleared++;
  }

  if (startRange) startRange.setValues(startValues);

  var lines = [program.name + ' 「자료」에 시작 위치 ' + applied + '건을 적었습니다.' + (cleared ? ' (비움 ' + cleared + '건)' : '')];
  if (missing.length) {
    lines.push('', '「자료」에서 찾지 못한 행 ' + missing.length + '건 (세션ID·파일명 확인):');
    lines.push(missing.slice(0, 15).join('\n') + (missing.length > 15 ? '\n...외 ' + (missing.length - 15) + '건' : ''));
  }
  if (invalid.length) {
    lines.push('', '형식이 틀려 건너뛴 행 ' + invalid.length + '건 (예: 1:05:30):');
    lines.push(invalid.slice(0, 15).join('\n'));
  }
  ui.alert('시작 위치 입력', lines.join('\n'), ui.ButtonSet.OK);
}
