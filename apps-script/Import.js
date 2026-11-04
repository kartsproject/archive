/**
 * 예전 프로그램 시트 3개(워크숍 · 심화 멘토링 · 겨울 심화캠프)의 탭을 이 시트로 가져온다 — 시트 합치기 (2026-11-04, docs/setup-new-account.md 3단계).
 *
 * 쓰는 법
 *  1. 예전 프로그램 시트 3개를 이 계정이 볼 수 있게 공유한다(뷰어면 됨).
 *  2. 스크립트 속성에 예전 시트 주소(또는 ID)를 넣는다 — OLD_WORKSHOP_SHEET · OLD_MENTORING_SHEET · OLD_CAMP_SHEET.
 *     아직 없는 프로그램은 비워 두면 빈 탭을 만든다.
 *  3. importProgramSheets를 ▶로 실행한다.
 *
 * 하는 일
 *  - 예전 시트의 「일정 · 자료 · 출석부 · 참여자」 탭을 통째로 복사해(값 · 서식 · 선택 목록 그대로) 「워크숍_일정」처럼 이름을 바꿔 붙인다.
 *  - 이미 같은 이름의 탭이 있으면 건드리지 않는다 — 여러 번 실행해도 안전. 다시 가져오려면 그 탭을 지우고 실행한다.
 *  - 예전 시트는 바꾸지 않는다(읽기만).
 */
var IMPORT_TABS_ = ['일정', '자료', '출석부', '참여자'];

function importProgramSheets() {
  var target = SpreadsheetApp.getActiveSpreadsheet();
  var props = PropertiesService.getScriptProperties();
  var made = 0, skipped = 0, problems = [];

  PROGRAMS_.forEach(function (program) {
    var raw = props.getProperty(program.old) || '';
    var source = null;
    if (raw) {
      var m = String(raw).match(/\/d\/([a-zA-Z0-9_-]{20,})/) || String(raw).match(/^\s*([a-zA-Z0-9_-]{20,})\s*$/);
      if (!m) { problems.push(program.old + ' 값이 시트 주소나 ID가 아님'); return; }
      try { source = SpreadsheetApp.openById(m[1]); }
      catch (err) { problems.push(program.name + ' 예전 시트를 열 수 없음 — 이 계정에 공유됐는지 확인 (' + err.message + ')'); return; }
      Logger.log(program.name + ': 「' + source.getName() + '」에서 가져옴');
    } else {
      Logger.log(program.name + ': ' + program.old + '가 비어 있어 빈 탭을 만듦');
    }

    IMPORT_TABS_.forEach(function (tab) {
      var name = programTabName_(program, tab);
      if (target.getSheetByName(name)) { skipped++; Logger.log('  ' + name + ': 이미 있어 건드리지 않음'); return; }
      var from = source && source.getSheetByName(tab);
      if (source && !from) problems.push(program.name + ' 예전 시트에 「' + tab + '」 탭이 없어 빈 탭으로 만듦');
      var sheet;
      if (from) {
        sheet = from.copyTo(target).setName(name);
        if (from.getFrozenRows()) sheet.setFrozenRows(from.getFrozenRows());
        Logger.log('  ' + name + ': 가져옴 (' + Math.max(0, from.getLastRow() - 1) + '줄)');
      } else {
        sheet = createProgramTab_(target, name, tab);
        Logger.log('  ' + name + ': 빈 탭 만듦');
      }
      made++;
    });
  });

  orderProgramTabs_(target);
  bumpCacheVersion_();
  Logger.log('— 만든 탭 ' + made + ' · 이미 있음 ' + skipped + (problems.length ? ' · 확인 필요 ' + problems.length : ''));
  problems.forEach(function (p) { Logger.log('❌ ' + p); });
  if (!problems.length) Logger.log('✅ 끝 — checkSetup으로 확인하세요. 스크립트 속성 OLD_…_SHEET는 지워도 됩니다.');
}

// 머리글 · 선택 목록이 있는 빈 프로그램 탭 (setupProgramSheets와 같은 모양)
function createProgramTab_(spreadsheet, name, tab) {
  var sheet = spreadsheet.insertSheet(name, spreadsheet.getSheets().length);
  var headers = PROGRAM_TAB_HEADERS_[tab];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sheet.setFrozenRows(1);
  var dropdowns = PROGRAM_TAB_DROPDOWNS_[tab] || {};
  Object.keys(dropdowns).forEach(function (header) {
    var rule = SpreadsheetApp.newDataValidation().requireValueInList(dropdowns[header], true).setAllowInvalid(false).build();
    sheet.getRange(2, headers.indexOf(header) + 1, sheet.getMaxRows() - 1, 1).setDataValidation(rule);
  });
  return sheet;
}

// 공통 탭 뒤에 프로그램 순서(워크숍 → 멘토링 → 캠프) · 탭 순서(일정 → 자료 → 출석부 → 참여자)로 늘어놓고 프로그램마다 탭 색을 달리한다
var PROGRAM_TAB_COLORS_ = { ws: '#2E7D9A', mt: '#8E6BBF', camp: '#C9822B' };
function orderProgramTabs_(spreadsheet) {
  var wanted = [];
  PROGRAMS_.forEach(function (program) {
    IMPORT_TABS_.forEach(function (tab) {
      var sheet = spreadsheet.getSheetByName(programTabName_(program, tab));
      if (sheet) { sheet.setTabColor(PROGRAM_TAB_COLORS_[program.code]); wanted.push(sheet); }
    });
  });
  // 하나씩 맨 끝으로 보내면 끝에 원하는 순서대로 쌓인다
  wanted.forEach(function (sheet) {
    spreadsheet.setActiveSheet(sheet);
    spreadsheet.moveActiveSheet(spreadsheet.getSheets().length);
  });
  if (spreadsheet.getSheets().length) spreadsheet.setActiveSheet(spreadsheet.getSheets()[0]);
}
