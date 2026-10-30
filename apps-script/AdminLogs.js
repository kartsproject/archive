/**
 * 관리자 페이지 [접속 기록] 탭 (docs/admin.md 6절, WBS 5.3).
 * 「로그」 탭은 시간순으로 쌓이므로 아래에서부터 조각씩 읽고, 기간보다 앞선 줄이 나오면 멈춘다.
 * 지금 관문이 기록하는 것은 로그인(auth·adminAuth)뿐이다.
 */

var LOG_READ_CHUNK_ = 1000;
var LOG_RESULT_MAX_ = 2000;          // docs/admin.md 6절: 최대 2,000줄
var LOG_DEFAULT_DAYS_ = 7;
var LOG_MAX_RANGE_DAYS_ = 366;
var LOG_COLUMNS_ = 7;                // Log.js 열 순서: 일시·결과·코드·이름·기기ID·요청·대상 자료
var LOG_DEVICE_ID_CHARS_ = 8;        // 기기 구분에 충분한 앞부분만 보낸다

// req.from · req.to: 'yyyy-MM-dd'(한국 시각 기준, 둘 다 포함). 비우면 최근 7일.
function adminLogs_(req) {
  var range = logRange_(req.from, req.to);

  // 성공 기록은 1분마다 모아 쓰므로(Log.js) 먼저 비워서 방금 접속도 보이게 한다.
  flushLogBuffer_();

  var sheet = getSheet_('로그');
  var lastRow = sheet.getLastRow();
  var rows = [];
  var truncated = false;
  var reachedStart = false;

  for (var end = lastRow; end >= 2 && !reachedStart && !truncated; end -= LOG_READ_CHUNK_) {
    var start = Math.max(2, end - LOG_READ_CHUNK_ + 1);
    var values = sheet.getRange(start, 1, end - start + 1, LOG_COLUMNS_).getValues();
    for (var i = values.length - 1; i >= 0; i--) {
      var time = logTime_(values[i][0]);
      if (time === null) continue;
      if (time < range.from) { reachedStart = true; break; }
      if (time > range.to) continue;
      if (rows.length >= LOG_RESULT_MAX_) { truncated = true; break; }
      rows.push({
        time: time,
        result: String(values[i][1]),
        code: String(values[i][2]),
        name: String(values[i][3]),
        device: String(values[i][4]).slice(0, LOG_DEVICE_ID_CHARS_),
        request: String(values[i][5]),
        target: String(values[i][6])
      });
    }
  }

  return {
    from: range.fromText,
    to: range.toText,
    rows: rows,               // 최신순
    truncated: truncated,
    codeLabels: codeLabels_()
  };
}

// 코드 → 「이름」(주체). 로그에는 코드만 남아 화면에서 누구 코드인지 함께 보여 주려는 것.
function codeLabels_() {
  var labels = {};
  readAdminTable_('접근코드').rows.forEach(function (r) {
    if (r['코드']) labels[r['코드']] = r['이름'] || '';
  });
  return labels;
}

function logRange_(fromText, toText) {
  var tz = Session.getScriptTimeZone();
  var todayText = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  toText = isValidDateText_(toText) ? toText : todayText;
  if (!isValidDateText_(fromText)) {
    var d = new Date(toText + 'T00:00:00+09:00');
    d.setDate(d.getDate() - (LOG_DEFAULT_DAYS_ - 1));
    fromText = Utilities.formatDate(d, tz, 'yyyy-MM-dd');
  }
  var from = new Date(fromText + 'T00:00:00+09:00').getTime();
  var to = new Date(toText + 'T23:59:59.999+09:00').getTime();
  if (from > to || to - from > LOG_MAX_RANGE_DAYS_ * 86400000) throw adminError_('INVALID_INPUT');
  return { from: from, to: to, fromText: fromText, toText: toText };
}

// 일시 칸은 관문이 Date로 쓴다. 손으로 고친 글자 칸도 읽을 수 있으면 읽는다.
function logTime_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') return value.getTime();
  var t = new Date(String(value)).getTime();
  return isNaN(t) ? null : t;
}
