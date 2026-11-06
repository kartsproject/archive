/**
 * 시트 메뉴 「K예술영재 아카이브 › 영상 허용 도메인 모두 등록」 (2026-11-06, 사이트 주소를 archive.kartsproject.com으로 옮김).
 *
 * Vimeo 영상은 영상마다 「이 도메인에서만 재생」 목록을 따로 갖는다. 사이트 주소가 바뀌면
 * 이미 올린 영상 전부에 새 주소를 넣어야 새 주소에서 재생된다.
 * 세 프로그램 「자료」 탭의 영상 · 작품(영상) 링크(Vimeo 번호)마다, 「설정」 「영상 허용 도메인」의
 * 도메인을 모두 등록한다(이미 있으면 그대로 — 같은 요청을 다시 보내도 결과가 같다).
 *
 * 메뉴 함수는 6분까지만 돌 수 있어, 5분이 지나면 멈추고 어디까지 했는지 스크립트 속성에 적어 둔다.
 * 다시 실행하면 이어서 한다. Vimeo가 요청이 많다고 막으면(429) 그 자리에서 멈추고 나중에 다시 하라고 알린다.
 */

var VIMEO_DOMAIN_PROGRESS_KEY_ = 'VIMEO_DOMAIN_PROGRESS';
var VIMEO_DOMAIN_TIME_BUDGET_MS_ = 5 * 60 * 1000;

function addVideoDomainsAll() {
  var ui = SpreadsheetApp.getUi();
  var domains = vimeoAllowedDomains_();
  var ids = vimeoAllVideoIds_();
  var props = PropertiesService.getScriptProperties();
  var sig = domains.join(',') + '|' + ids.length;
  var progress = {};
  try { progress = JSON.parse(props.getProperty(VIMEO_DOMAIN_PROGRESS_KEY_) || '{}'); } catch (e) { progress = {}; }
  // 도메인이 바뀌었으면 처음부터. 영상 수만 바뀐 경우(새 업로드)는 이어서 한다 — 새 업로드는 업로드할 때 도메인이 들어간다.
  var resume = progress.domains === domains.join(',') && progress.lastId;
  var todo = resume ? ids.filter(function (id) { return Number(id) > Number(progress.lastId); }) : ids;

  var question = '아래 도메인을 영상 ' + todo.length + '개에 허용 도메인으로 등록합니다.\n\n' +
    domains.map(function (d) { return '· ' + d; }).join('\n') + '\n\n' +
    (resume ? '(지난번에 멈춘 곳부터 이어서 합니다. 전체 ' + ids.length + '개)\n\n' : '') +
    '새 사이트 주소가 목록에 없으면 「취소」를 누르고 「설정」 탭 「영상 허용 도메인」을 먼저 고치세요.\n' +
    '5분쯤 걸리며, 다 못 하면 다시 실행해 이어서 할 수 있습니다. 계속할까요?';
  if (todo.length === 0) {
    props.deleteProperty(VIMEO_DOMAIN_PROGRESS_KEY_);
    ui.alert('등록할 영상이 없습니다(이미 모두 끝났습니다). 처음부터 다시 하려면 한 번 더 실행하세요.');
    return;
  }
  if (ui.alert('영상 허용 도메인 모두 등록', question, ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;

  var token = props.getProperty('VIMEO_TOKEN');
  if (!token) {
    ui.alert('스크립트 속성 VIMEO_TOKEN이 없습니다. Apps Script 편집기 › 프로젝트 설정에서 넣어 주세요.');
    return;
  }
  var started = Date.now();
  var done = 0;
  var missing = [];
  var failed = [];
  var stopReason = '';
  for (var i = 0; i < todo.length; i++) {
    if (Date.now() - started > VIMEO_DOMAIN_TIME_BUDGET_MS_) { stopReason = 'time'; break; }
    var id = todo[i];
    var result = vimeoPutDomains_(token, id, domains);
    if (result === 'limited') { stopReason = 'limited'; break; }
    if (result === 'missing') missing.push(id);
    else if (result !== 'ok') failed.push(id + '(' + result + ')');
    done++;
    if (done % 20 === 0) {
      props.setProperty(VIMEO_DOMAIN_PROGRESS_KEY_, JSON.stringify({ domains: domains.join(','), lastId: id, sig: sig }));
      SpreadsheetApp.getActiveSpreadsheet().toast(done + ' / ' + todo.length + '개 처리', '영상 허용 도메인', 5);
    }
  }
  var lastId = done > 0 ? todo[done - 1] : progress.lastId;
  var left = todo.length - done;
  if (left > 0) {
    props.setProperty(VIMEO_DOMAIN_PROGRESS_KEY_, JSON.stringify({ domains: domains.join(','), lastId: lastId, sig: sig }));
  } else {
    props.deleteProperty(VIMEO_DOMAIN_PROGRESS_KEY_);
  }

  var lines = ['처리한 영상: ' + done + '개' + (left > 0 ? ' · 남은 영상: ' + left + '개' : ' — 모두 끝났습니다')];
  if (missing.length) lines.push('Vimeo에 없는 영상(지워졌거나 번호가 틀림) ' + missing.length + '개: ' + missing.slice(0, 15).join(', ') + (missing.length > 15 ? ' …' : ''));
  if (failed.length) lines.push('실패 ' + failed.length + '개: ' + failed.slice(0, 15).join(', ') + (failed.length > 15 ? ' …' : '') + '\n→ 메뉴를 다시 실행하면 이어서 하지만, 실패한 영상은 처음부터 다시 해야 들어갑니다(남은 영상이 없을 때 한 번 더 실행).');
  if (stopReason === 'time') lines.push('시간 제한(5분) 때문에 멈췄습니다. 메뉴를 한 번 더 실행하면 이어서 합니다.');
  if (stopReason === 'limited') lines.push('Vimeo가 잠시 요청을 막았습니다(요청 한도). 15분쯤 뒤에 메뉴를 다시 실행하면 이어서 합니다.');
  console.log('영상 허용 도메인: ' + lines.join(' / '));
  ui.alert('영상 허용 도메인 모두 등록', lines.join('\n\n'), ui.ButtonSet.OK);
}

// 세 프로그램 「자료」 탭의 영상 링크(숫자만), 겹치지 않게 · 번호 순서.
function vimeoAllVideoIds_() {
  var seen = {};
  PROGRAMS_.forEach(function (program) {
    var rows;
    try { rows = readAdminTable_('자료', program).rows; } catch (e) { return; } // 탭이 없는 프로그램
    rows.forEach(function (row) {
      if (MEDIA_VIDEO_TYPES_.indexOf(row['자료유형']) === -1) return;
      var link = String(row['링크'] || '').trim();
      var m = link.match(/^(\d+)$/) || link.match(/vimeo\.com\/(?:video\/)?(\d+)/);
      if (m) seen[m[1]] = true;
    });
  });
  return Object.keys(seen).sort(function (a, b) { return Number(a) - Number(b); });
}

// 한 영상에 도메인을 모두 넣는다. 'ok' · 'missing'(404) · 'limited'(429가 이어짐) · 그 밖은 HTTP 상태.
function vimeoPutDomains_(token, id, domains) {
  var options = {
    method: 'put',
    muteHttpExceptions: true,
    headers: { Authorization: 'bearer ' + token, Accept: 'application/vnd.vimeo.*+json;version=3.4' }
  };
  for (var d = 0; d < domains.length; d++) {
    var url = VIMEO_API_ + vimeoVideoPath_(id) + '/privacy/domains/' + encodeURIComponent(domains[d]);
    for (var attempt = 1; ; attempt++) {
      var res = UrlFetchApp.fetch(url, options);
      var status = res.getResponseCode();
      if (status === 200 || status === 201 || status === 204) break;
      if (status === 404) return 'missing';
      if (status === 429) {
        if (attempt >= 2) return 'limited';
        Utilities.sleep(10000);
        continue;
      }
      if (status >= 500 && attempt < 3) { Utilities.sleep(2000 * attempt); continue; }
      console.error('Vimeo PUT 허용 도메인 ' + id + ' → ' + status + ' ' + res.getContentText().slice(0, 200));
      return String(status);
    }
  }
  return 'ok';
}
