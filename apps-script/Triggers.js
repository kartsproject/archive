/**
 * 캐시 무효화·로그 기록을 맡는 트리거 (docs/decisions.md 9절 "응답 속도").
 * 편집기에서 installTriggers()를 한 번 실행하면 설치된다. 다시 실행해도 중복되지 않는다.
 *
 * - 시트를 편집하면 캐시 버전을 올려 다음 요청이 시트를 새로 읽게 한다(2026-11-04부터 시트 파일 하나라 트리거도 하나).
 * - 1분마다 모아 둔 접속 기록을 「로그」 탭에 쓴다.
 * 설치형 onEdit 트리거는 **사람이 시트를 고칠 때만** 동작한다. 스크립트가 쓴 값에는 반응하지 않아,
 * 메뉴 작업(세션ID 생성·출석부 변환·영상 매칭) 끝에서는 코드가 직접 캐시 버전을 올린다.
 */
function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    var handler = trigger.getHandlerFunction();
    if (handler === 'onSheetEdit' || handler === 'flushLogs') ScriptApp.deleteTrigger(trigger);
  });

  ScriptApp.newTrigger('onSheetEdit').forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet()).onEdit().create();
  ScriptApp.newTrigger('flushLogs').timeBased().everyMinutes(1).create();

  Logger.log('트리거 설치 완료: 시트 편집 감지 1개 + 로그 기록 1개');
}

function onSheetEdit() {
  bumpCacheVersion_();
}

function flushLogs() {
  flushLogBuffer_();
}
