/**
 * docs/api.md 3-3 data 응답 조립. 시트 헤더(한글) → 화면이 쓰는 영어 camelCase 필드로 옮긴다.
 * 세 프로그램 시트를 읽어 한 배열로 합치므로 응답 모양은 시트를 나누기 전과 같다.
 */

// 세 프로그램 시트의 같은 탭을 읽어, 행마다 mapRow(row, program) 결과를 모은다.
function collectFromPrograms_(sheetName, mapRow) {
  var out = [];
  PROGRAMS_.forEach(function (program) {
    sheetRowsAsObjects_(sheetName, program).forEach(function (row) {
      var mapped = mapRow(row, program);
      if (mapped) out.push(mapped);
    });
  });
  return out;
}

function getSessions_() {
  return collectFromPrograms_('일정', function (row, program) {
    return {
      sessionId: row['세션ID'],
      program: program.name, // 시트 열이 아니라 읽은 시트로 정한다 (docs/sheet-schema.md 3-2)
      discipline: row['분야'],
      date: formatDateCell_(row['일자']),
      startTime: formatTimeCell_(row['시작시각']),
      endTime: formatTimeCell_(row['종료시각']),
      region: row['권역'],
      round: row['회차'],
      className: row['수업명'],
      instructor: row['강사명'],
      note: row['비고'] // 장소 등 정식 열이 없는 값을 임시로 담아 둔 자리 (확인 필요, docs/sheet-schema.md 3-2)
    };
  });
}

// 공개여부 = 공개인 것만 내보낸다 (docs/decisions.md 6절: 요청마다 검증).
function getPublicMaterials_() {
  return collectFromPrograms_('자료', function (row) {
    if (row['공개여부'] !== '공개') return null;
    return {
      sessionId: row['세션ID'],
      type: row['자료유형'],
      fileName: row['파일명'],
      link: row['링크'],
      spec: row['규격'],
      studentName: row['학생명'],
      studentId: row['학생ID'],
      discipline: row['분야'],
      subtitle: row['소제목'], // 한 칸 안 영상의 반·악기 이름(「해금2」). 열이 없는 시트는 빈 값 (2026-10-08)
      start: parseStartSeconds_(row['시작 위치']) // 이 칸에서 재생을 시작할 위치(초). 비우면 0 = 처음부터 (2026-11-12)
    };
  });
}

function getParticipants_() {
  return collectFromPrograms_('참여자', function (row) {
    return {
      name: row['성명'],
      studentId: row['학생ID'],
      sessionId: row['세션ID']
    };
  });
}

// photo 요청 전용: 링크(Drive 파일ID)로 자료를 찾되, 사진 계열(사진·작품(이미지))만 인정한다.
// getDataPayload_()가 공개여부 = 공개인 행만 담으므로, 요청 시점에도 공개여부가 다시 확인된다
// (docs/decisions.md 6절). 시트가 편집되면 캐시 버전이 올라가 비공개로 바꾼 자료는 곧바로 빠진다.
function findPublicPhotoMaterial_(fileId) {
  var photoTypes = { '사진': true, '작품(이미지)': true };
  var materials = getDataPayload_().materials;
  for (var i = 0; i < materials.length; i++) {
    if (materials[i].link === fileId && photoTypes[materials[i].type]) return materials[i];
  }
  return null;
}

// { 항목: 값 } 형태로 돌려준다.
function getSettingsMap_() {
  return cached_('settings', function () {
    var map = {};
    sheetRowsAsObjects_('설정').forEach(function (row) {
      if (row['항목']) map[row['항목']] = row['값'];
    });
    return map;
  });
}

// data 응답 본문. 시트 4개를 여는 가장 무거운 작업이라 캐시에 담아 둔다 (docs/decisions.md 9절).
function getDataPayload_() {
  return cached_('data', function () {
    return {
      sessions: getSessions_(),
      materials: getPublicMaterials_(),
      participants: getParticipants_(),
      settings: getSettingsMap_()
    };
  });
}
