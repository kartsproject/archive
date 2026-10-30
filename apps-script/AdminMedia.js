/**
 * 관리자 페이지 [영상 관리] 처리 함수 (docs/admin.md 7절, WBS 5.4·5.5).
 * 5.4 보기·수정·삭제: adminMaterials_ · adminMaterialUpdate_ · adminMaterialDelete_
 * 5.5 추가: adminVideoCreate_(빈 영상·업로드 주소) → 화면이 Vimeo로 직접 tus 업로드 → adminVideoFinish_(확인·「자료」 등록)
 * 쓰기는 모두 Admin.js 공통 규칙(adminWrite_ · checkRowUnchanged_ · recordAdminAction_)을 따른다.
 * 설계와 달라진 점은 docs/admin-media-notes.md.
 */

var MEDIA_PENDING_PREFIX_ = 'MEDIA_PENDING_'; // Script Properties: 업로드 중인 영상 하나에 하나(키 끝은 Vimeo 번호)
var MEDIA_PENDING_TTL_MS_ = 24 * 60 * 60 * 1000; // 24시간 안에 등록하지 않으면 버린 것으로 본다
var MEDIA_MAX_FILES_ = 20;
var MEDIA_VIDEO_EXTS_ = ['mp4', 'mov', 'm4v', 'mkv', 'avi', 'mts', 'webm'];
var MEDIA_VISIBILITY_ = ['공개', '비공개']; // 관리자 페이지에서 고르는 값(docs/admin.md 7-2). 검수대기는 시트에서만
var MEDIA_VIDEO_TYPES_ = ['영상', '작품(영상)'];
var MEDIA_TEXT_MAX_ = 40; // 소제목·학생명

function mediaProgram_(code) {
  for (var i = 0; i < PROGRAMS_.length; i++) {
    if (PROGRAMS_[i].code === code) return PROGRAMS_[i];
  }
  throw adminError_('INVALID_INPUT');
}

function mediaText_(value) {
  var text = String(value == null ? '' : value).trim();
  if (text.length > MEDIA_TEXT_MAX_) throw adminError_('INVALID_INPUT');
  return text;
}

function mediaTarget_(program, sessionId, fileName) {
  return program.name + ' › 자료 · ' + [sessionId, fileName].filter(String).join(' · ');
}

// 세 프로그램 시트 「자료」에서 Vimeo 링크(영상 계열)마다 몇 줄이 쓰는지 센다.
// 통녹화를 여러 칸에 등록하거나 연주회처럼 2줄로 등록하면 같은 링크가 여러 줄에 있다(docs/admin.md 7-3).
function mediaLinkUses_() {
  var uses = {};
  PROGRAMS_.forEach(function (program) {
    readAdminTable_('자료', program).rows.forEach(function (row) {
      var link = String(row['링크'] || '').trim();
      if (!link || MEDIA_VIDEO_TYPES_.indexOf(row['자료유형']) === -1) return;
      uses[link] = (uses[link] || 0) + 1;
    });
  });
  return uses;
}

/* ---------- 업로드 중인 영상 (docs/admin-media-notes.md 2-2) ---------- */

function mediaPendingAll_() {
  var props = PropertiesService.getScriptProperties().getProperties();
  var list = [];
  Object.keys(props).forEach(function (key) {
    if (key.indexOf(MEDIA_PENDING_PREFIX_) !== 0) return;
    try {
      list.push(JSON.parse(props[key]));
    } catch (err) {
      PropertiesService.getScriptProperties().deleteProperty(key);
    }
  });
  return list;
}

function mediaPendingGet_(videoId) {
  var raw = PropertiesService.getScriptProperties().getProperty(MEDIA_PENDING_PREFIX_ + String(videoId));
  return raw ? JSON.parse(raw) : null;
}

function mediaPendingPut_(pending) {
  PropertiesService.getScriptProperties().setProperty(MEDIA_PENDING_PREFIX_ + pending.videoId, JSON.stringify(pending));
}

function mediaPendingDelete_(videoId) {
  PropertiesService.getScriptProperties().deleteProperty(MEDIA_PENDING_PREFIX_ + String(videoId));
}

// 24시간이 지난 업로드는 Vimeo 제목에 [삭제 필요]를 붙이고 잡아 둔 번호를 푼다.
// adminVideoCreate_가 잠금 안에서 부른다. Vimeo가 잠시 안 되면 다음 기회에 다시 한다.
function mediaExpirePending_(admin) {
  var now = Date.now();
  mediaPendingAll_().forEach(function (p) {
    if (p.exp > now) return;
    try {
      vimeoMarkDiscard_(p.videoId);
    } catch (err) {
      return;
    }
    mediaPendingDelete_(p.videoId);
    recordAdminAction_(admin, '영상 정리', mediaTarget_(mediaProgram_(p.program), p.sessionId, p.fileName),
      p, { vimeo: '[삭제 필요] 표시', reason: '24시간 안에 등록되지 않음' });
  });
}

/* ---------- 5.4 보기 ---------- */

// 그 프로그램의 「일정」·「자료」 전체(비공개 포함). 캐시를 쓰지 않는다(docs/admin.md 7-1).
// 자료 행은 시트 열 이름 그대로 + _row — 화면이 수정·삭제할 때 이 값을 「읽었을 때의 값」으로 돌려보낸다.
function adminMaterials_(req) {
  var program = mediaProgram_(req.program);
  var sessions = readAdminTable_('일정', program).rows.map(function (row) {
    return {
      sessionId: row['세션ID'],
      discipline: row['분야'],
      date: row['일자'],
      startTime: row['시작시각'],
      endTime: row['종료시각'],
      region: row['권역'] || '',
      round: row['회차'] || '',
      className: row['수업명'],
      instructor: row['강사명'] || '',
      note: row['비고'] || ''
    };
  }).filter(function (s) { return s.sessionId; });

  var pending = mediaPendingAll_().filter(function (p) {
    return p.program === program.code && p.exp > Date.now();
  }).map(function (p) {
    return { sessionId: p.sessionId, fileName: p.fileName, videoId: p.videoId };
  });

  return {
    program: program.code,
    programName: program.name,
    canUpload: !!VIMEO_PROGRAM_FOLDER_[program.code],
    sessions: sessions,
    materials: readAdminTable_('자료', program).rows,
    linkUses: mediaLinkUses_(),
    pending: pending
  };
}

/* ---------- 5.4 수정·삭제 ---------- */

// 소제목·공개여부만 바꾼다. Vimeo 제목은 바꾸지 않는다(docs/admin.md 7-2).
function adminMaterialUpdate_(req, admin) {
  var program = mediaProgram_(req.program);
  var input = req.changes || {};
  var changes = {};
  Object.keys(input).forEach(function (key) {
    if (key === '소제목') changes['소제목'] = mediaText_(input[key]);
    else if (key === '공개여부' && MEDIA_VISIBILITY_.indexOf(input[key]) !== -1) changes['공개여부'] = input[key];
    else throw adminError_('INVALID_INPUT');
  });
  if (!Object.keys(changes).length) throw adminError_('INVALID_INPUT');

  return adminWrite_(function () {
    var t = readAdminTable_('자료', program);
    var before = checkRowUnchanged_(t.sheet, t.headers, req.row, req.before);
    writeRowChanges_(t.sheet, t.headers, before._row, changes);
    recordAdminAction_(admin, '자료 수정', mediaTarget_(program, before['세션ID'], before['파일명']), before, changes);
    return { ok: true };
  });
}

// 「자료」 행을 지운다. 지운 행 전체가 「관리기록」에 남는다.
// 같은 링크를 쓰는 행이 세 시트 어디에도 남지 않을 때만 Vimeo 제목에 [삭제 필요]를 붙인다(영구 삭제는 하지 않음).
function adminMaterialDelete_(req, admin) {
  var program = mediaProgram_(req.program);
  return adminWrite_(function () {
    var t = readAdminTable_('자료', program);
    var before = checkRowUnchanged_(t.sheet, t.headers, req.row, req.before);
    t.sheet.deleteRow(before._row);

    var link = String(before['링크'] || '').trim();
    var vimeo = '해당 없음';
    var remaining = 0;
    if (link && MEDIA_VIDEO_TYPES_.indexOf(before['자료유형']) !== -1 && /^\d+$/.test(link)) {
      remaining = mediaLinkUses_()[link] || 0;
      if (remaining > 0) {
        vimeo = '다른 행이 쓰고 있어 그대로 둠';
      } else {
        try {
          vimeo = vimeoMarkDiscard_(link) ? '[삭제 필요] 표시' : 'Vimeo에 없음';
        } catch (err) {
          // 행은 이미 지웠다. 표시는 「관리기록」을 보고 손으로 붙인다.
          vimeo = '[삭제 필요] 표시 실패 — 손으로 정리';
        }
      }
    }
    recordAdminAction_(admin, '자료 삭제', mediaTarget_(program, before['세션ID'], before['파일명']), before, { vimeo: vimeo });
    return { ok: true, vimeo: vimeo, remaining: remaining };
  });
}

/* ---------- 5.5 영상 추가 ---------- */

// 그 세션의 다음 영상번호: 「자료」 파일명(`{세션ID}_{번호}.확장자`)과 업로드 중인 번호 중 가장 큰 것 + 1.
function mediaNextNumber_(materials, sessionId) {
  var max = 0;
  var prefix = sessionId + '_';
  materials.forEach(function (row) {
    var name = String(row['파일명'] || '');
    if (name.indexOf(prefix) !== 0) return;
    var m = name.slice(prefix.length).match(/^(\d+)/);
    if (m) max = Math.max(max, Number(m[1]));
  });
  mediaPendingAll_().forEach(function (p) {
    if (p.sessionId === sessionId) max = Math.max(max, Number(p.number) || 0);
  });
  return max + 1;
}

function mediaFileExt_(name) {
  var m = String(name || '').match(/\.([A-Za-z0-9]+)$/);
  if (!m || MEDIA_VIDEO_EXTS_.indexOf(m[1].toLowerCase()) === -1) throw adminError_('INVALID_INPUT');
  return m[1]; // 확장자는 원래대로(docs/sheet-schema.md 9절)
}

// req { program, sessionId, files: [{ name, size }] } → { items: [{ videoId, uploadLink, fileName }] }
// 파일 전체의 번호를 한 번에 정하고 24시간 잡아 둔다. 화면에는 업로드 주소만 간다(토큰은 보내지 않음).
function adminVideoCreate_(req, admin) {
  var program = mediaProgram_(req.program);
  var files = req.files;
  if (!Array.isArray(files) || files.length === 0 || files.length > MEDIA_MAX_FILES_) throw adminError_('INVALID_INPUT');
  var parsed = files.map(function (f) {
    var size = Number(f && f.size);
    if (!(size > 0) || Math.floor(size) !== size) throw adminError_('INVALID_INPUT');
    return { original: String(f.name || '').slice(0, 200), ext: mediaFileExt_(f.name), size: size };
  });

  return adminWrite_(function () {
    var session = null;
    readAdminTable_('일정', program).rows.forEach(function (row) {
      if (row['세션ID'] && row['세션ID'] === req.sessionId) session = row;
    });
    if (!session) throw adminError_('NOT_FOUND'); // 일정표에 없는 칸에는 추가할 수 없다(docs/admin.md 7-4)
    var segs = vimeoFolderPath_(program.code, session['분야'], session['일자']);
    if (!segs) throw adminError_('INVALID_INPUT'); // 멘토링·캠프는 폴더 이름이 정해지기 전까지 막는다

    mediaExpirePending_(admin);
    var folderUri = vimeoEnsureFolder_(segs);
    var number = mediaNextNumber_(readAdminTable_('자료', program).rows, session['세션ID']);

    var made = [];
    try {
      var items = parsed.map(function (f) {
        var base = session['세션ID'] + '_' + (number < 10 ? '0' : '') + number;
        var created = vimeoCreateUpload_(base, f.size, folderUri);
        made.push(created.videoId);
        var pending = {
          videoId: created.videoId,
          program: program.code,
          sessionId: session['세션ID'],
          number: number,
          fileName: base + '.' + f.ext,
          original: f.original,
          size: f.size,
          folderUri: folderUri,
          code: admin.code,
          exp: Date.now() + MEDIA_PENDING_TTL_MS_
        };
        mediaPendingPut_(pending);
        number++;
        return { videoId: created.videoId, uploadLink: created.uploadLink, fileName: pending.fileName };
      });
    } catch (err) {
      // 중간 파일에서 실패하면 화면은 업로드 주소를 하나도 못 받는다 → 이번에 만든 영상은 바로 정리한다.
      // 정리도 실패한 것은 기록이 남아 24시간 뒤 mediaExpirePending_가 다시 정리한다.
      made.forEach(function (id) {
        try {
          var p = mediaPendingGet_(id);
          vimeoMarkDiscard_(id);
          mediaPendingDelete_(id);
          if (p) recordAdminAction_(admin, '영상 정리', mediaTarget_(program, p.sessionId, p.fileName), p, { vimeo: '[삭제 필요] 표시', reason: '여러 파일 중 영상 생성 실패' });
        } catch (cleanupErr) {
          // 남은 기록으로 나중에 정리
        }
      });
      throw err;
    }
    return { items: items, folder: segs.join(' › ') };
  });
}

// req { program, videoId, subtitle, visibility, student: { name, studentId } | null }
//   → { done: true, rows } · 아직 업로드 중이면 { done: false, uploadStatus }
// req { program, videoId, cancel: true } → 업로드를 그만둔 영상: 제목에 [삭제 필요]를 붙이고 번호를 푼다.
// 새 요청 이름을 만들지 않으려고(Admin.js 고치지 않음) 취소도 이 요청으로 받는다.
function adminVideoFinish_(req, admin) {
  var program = mediaProgram_(req.program);
  var videoId = String(req.videoId || '');
  if (!/^\d+$/.test(videoId)) throw adminError_('INVALID_INPUT');

  var pending = mediaPendingGet_(videoId);
  if (!pending || pending.program !== program.code) {
    if (req.cancel) return { done: true, cancelled: true };
    // 응답이 늦어 화면이 다시 보낸 경우: 이미 등록됐으면 성공으로 본다
    var registered = readAdminTable_('자료', program).rows.some(function (row) {
      return String(row['링크']).trim() === videoId;
    });
    if (registered) return { done: true, already: true };
    throw adminError_('NOT_FOUND');
  }

  if (req.cancel) {
    return adminWrite_(function () {
      var vimeo;
      try {
        vimeo = vimeoMarkDiscard_(videoId) ? '[삭제 필요] 표시' : 'Vimeo에 없음';
      } catch (err) {
        vimeo = '[삭제 필요] 표시 실패 — 손으로 정리';
      }
      mediaPendingDelete_(videoId);
      recordAdminAction_(admin, '영상 정리', mediaTarget_(program, pending.sessionId, pending.fileName),
        pending, { vimeo: vimeo, reason: '업로드 취소·실패' });
      return { done: true, cancelled: true, vimeo: vimeo };
    });
  }

  var visibility = MEDIA_VISIBILITY_.indexOf(req.visibility) !== -1 ? req.visibility : '';
  if (!visibility) throw adminError_('INVALID_INPUT');
  var subtitle = mediaText_(req.subtitle);
  var student = null;
  if (req.student) {
    student = { name: mediaText_(req.student.name), studentId: mediaText_(req.student.studentId) };
    if (!student.name) throw adminError_('INVALID_INPUT');
  }

  // Vimeo가 업로드를 아직 다 받지 못했으면 화면이 잠시 뒤 다시 부른다
  var status = vimeoUploadStatus_(videoId);
  if (status !== 'complete') return { done: false, uploadStatus: status };
  vimeoFinishSettings_(videoId, pending.folderUri);

  return adminWrite_(function () {
    if (!mediaPendingGet_(videoId)) return { done: true, already: true }; // 동시에 두 번 온 요청
    var t = readAdminTable_('자료', program);
    var session = null;
    readAdminTable_('일정', program).rows.forEach(function (row) {
      if (row['세션ID'] === pending.sessionId) session = row;
    });

    var note = '관리자 페이지에서 올림 · 원래 파일: ' + pending.original;
    var videoRow = {
      '세션ID': pending.sessionId,
      '자료유형': '영상',
      '파일명': pending.fileName,
      '링크': videoId,
      '공개여부': visibility,
      '비고': note,
      '소제목': subtitle
    };
    var rows = [videoRow];
    // 학생 작품으로도 등록: 8.21 연주회와 같은 2줄 방식 — 같은 파일명·링크, 세션ID를 비우고 학생명·분야를 적는다
    if (student) {
      rows.push({
        '세션ID': '',
        '자료유형': '작품(영상)',
        '파일명': pending.fileName,
        '링크': videoId,
        '공개여부': visibility,
        '학생명': student.name,
        '학생ID': student.studentId,
        '분야': session ? session['분야'] : '',
        '비고': note
      });
    }
    var rowNumbers = rows.map(function (row) {
      return appendRowObject_(t.sheet, t.headers, row);
    });
    mediaPendingDelete_(videoId);
    recordAdminAction_(admin, '영상 추가', mediaTarget_(program, pending.sessionId, pending.fileName), null, rows);
    return { done: true, rows: rowNumbers };
  });
}
