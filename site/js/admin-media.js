/**
 * 관리자 페이지 [영상 관리] 탭 (docs/admin.md 7절, WBS 5.4·5.5). 설계와 달라진 점은 docs/admin-media-notes.md.
 * - 5.4: 관리자용 일정표(비공개 포함) → 칸을 누르면 그 칸의 영상 → 소제목·공개여부 수정, 삭제
 * - 5.5: 칸을 골라 편집된 영상 파일을 브라우저에서 Vimeo로 바로 올리고(tus) 「자료」에 등록
 * Vimeo 토큰은 화면에 오지 않는다. 관문(adminVideoCreate)이 영상을 만들어 업로드 주소만 주고,
 * 다 올리면 관문(adminVideoFinish)이 확인한 뒤 「자료」에 적는다. 외부 값은 모두 textContent로 넣는다.
 */

const MEDIA_PROGRAMS = [
  { code: 'ws', name: '워크숍' },
  { code: 'mt', name: '심화 멘토링' },
  { code: 'camp', name: '겨울 심화캠프' }
];
const MEDIA_DISCIPLINES = ['음악', '무용', '전통예술', '미술'];
const MEDIA_PREF_KEY = 'karts_admin_media_pref';
const MEDIA_WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const MEDIA_TONES = [265, 175, 28, 212, 340, 145, 48, 192, 300, 100]; // view-schedule.js와 같은 칸 색

const TUS_CHUNK_BYTES = 16 * 1024 * 1024; // 끊겼을 때 다시 보내는 양과 요청 수의 절충
const TUS_MAX_FAILS = 10;                 // 인터넷은 되는데 연달아 실패하면 멈추고 [다시 시도]를 보여 준다
const MEDIA_PING_MS = 5 * 60 * 1000;      // 관리자 토큰 30분 — 업로드 중에는 관문을 안 부르므로 따로 잇는다
const MEDIA_FINISH_TRIES = 8;             // 마지막 조각을 보낸 뒤 Vimeo가 「완료」로 바뀔 때까지 기다리는 횟수

const mediaState = {
  root: null,
  program: 'ws',
  discipline: '음악',
  data: null,
  selected: null,   // 고른 칸의 세션ID
  loading: false,
  jobs: [],         // 올리는 파일들 (화면을 새로 그려도 남는다)
  pingTimer: null
};

/* ---------- 작은 도우미 ---------- */

function mediaEl(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}

function mediaButton(label, className, onClick) {
  const b = mediaEl('button', 'admin-btn' + (className ? ' ' + className : ''), label);
  b.type = 'button';
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

function mediaSelect(options, value) {
  const s = mediaEl('select', 'admin-select');
  options.forEach(o => {
    const opt = mediaEl('option', null, o.label != null ? o.label : o);
    opt.value = o.value != null ? o.value : o;
    s.appendChild(opt);
  });
  s.value = value;
  return s;
}

function mediaWait(ms) { return new Promise(r => setTimeout(r, ms)); }

function mediaDateLabel(date) {
  const [y, m, d] = String(date).split('-').map(Number);
  if (!y) return String(date || '');
  return `${m}.${d}(${MEDIA_WEEKDAYS[new Date(y, m - 1, d).getDay()]})`;
}

function mediaMinutes(hhmm) {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function mediaSize(bytes) {
  return bytes >= 1e9 ? (bytes / 1e9).toFixed(2) + ' GB' : (bytes / 1e6).toFixed(1) + ' MB';
}

// VIMEO_ERROR 문구도 admin-app.js 공통 문구 표에 있다
function mediaErrorMessage(e, opts) {
  return adminErrorMessage(e, opts);
}

function mediaProgramName(code) {
  return (MEDIA_PROGRAMS.find(p => p.code === code) || {}).name || code;
}

/* ---------- 데이터 ---------- */

function mediaVideos(sessionId) {
  if (!mediaState.data) return [];
  return mediaState.data.materials.filter(m => m['세션ID'] === sessionId && m['자료유형'] === '영상');
}

// 관문에 남은 「업로드 중」 기록 수(이 창에서 올리는 것 + 다른 창·끝나지 않은 업로드)
function mediaPendingCount(sessionId) {
  return mediaState.data ? mediaState.data.pending.filter(p => p.sessionId === sessionId).length : 0;
}

function mediaSessions() {
  if (!mediaState.data) return [];
  return mediaState.data.sessions.filter(s => s.discipline === mediaState.discipline);
}

async function mediaLoad({ quiet = false } = {}) {
  if (mediaState.loading) return;
  mediaState.loading = true;
  const program = mediaState.program;
  if (!quiet) {
    mediaState.data = null;
    mediaRenderBody();
  }
  try {
    const data = await adminCall('adminMaterials', { program });
    if (program !== mediaState.program) return; // 그 사이 프로그램을 바꿈
    mediaState.data = data;
    if (mediaState.selected && !data.sessions.some(s => s.sessionId === mediaState.selected)) mediaState.selected = null;
  } catch (e) {
    if (!quiet) mediaState.data = { error: mediaErrorMessage(e) };
    else showAdminToast(mediaErrorMessage(e), 'error');
  } finally {
    mediaState.loading = false;
    mediaRenderBody();
  }
}

/* ---------- 틀 ---------- */

// 처음 열 때와 로그아웃 뒤 다시 들어왔을 때 불린다. 로그아웃하면 화면이 지워져 올리던 것도 멈추므로
// 남은 업로드 줄은 버린다(다음 사람에게 파일 이름이 보이지 않게). Vimeo 쪽은 24시간 뒤 관문이 정리한다.
function mediaRender(container) {
  mediaState.jobs.forEach(j => { j.status = 'cancelled'; if (j.xhr) j.xhr.abort(); });
  mediaState.jobs = [];
  mediaStopPing();
  mediaState.root = container;
  mediaState.data = null;
  mediaState.selected = null;
  try {
    const pref = JSON.parse(sessionStorage.getItem(MEDIA_PREF_KEY) || '{}');
    if (MEDIA_PROGRAMS.some(p => p.code === pref.program)) mediaState.program = pref.program;
    if (MEDIA_DISCIPLINES.includes(pref.discipline)) mediaState.discipline = pref.discipline;
  } catch (e) { /* 기본값으로 */ }

  container.appendChild(mediaEl('h2', 'admin-section-title', '영상 관리'));
  container.appendChild(mediaEl('p', 'admin-section-desc',
    '일정표 칸을 누르면 그 칸의 영상이 아래에 나옵니다. 비공개 영상도 보입니다. 소제목·공개여부를 고치거나 지울 수 있고, 워크숍은 편집된 영상을 바로 올릴 수 있습니다.'));

  const toolbar = mediaEl('div', 'admin-toolbar');
  const programField = mediaEl('label', 'admin-field', '프로그램');
  const programSelect = mediaSelect(MEDIA_PROGRAMS.map(p => ({ label: p.name, value: p.code })), mediaState.program);
  programField.appendChild(programSelect);
  const disciplineField = mediaEl('div', 'admin-field', '분야');
  const disciplineTabs = mediaEl('div', 'media-discipline-tabs');
  MEDIA_DISCIPLINES.forEach(d => {
    const b = mediaButton(d, d === mediaState.discipline ? 'primary' : '', () => {
      mediaState.discipline = d;
      mediaState.selected = null;
      disciplineTabs.querySelectorAll('button').forEach(x => x.classList.toggle('primary', x.textContent === d));
      mediaSavePref();
      mediaRenderBody();
    });
    disciplineTabs.appendChild(b);
  });
  disciplineField.appendChild(disciplineTabs);
  const refresh = mediaButton('새로고침', '', () => mediaLoad());
  toolbar.append(programField, disciplineField, mediaEl('div', 'spacer'), refresh);
  programSelect.addEventListener('change', () => {
    mediaState.program = programSelect.value;
    mediaState.selected = null;
    mediaSavePref();
    mediaLoad();
  });

  const jobs = mediaEl('div', 'media-jobs');
  jobs.id = 'media-jobs';
  const body = mediaEl('div', 'media-body');
  body.id = 'media-body';
  container.append(toolbar, jobs, body);
  mediaRenderJobs();
}

function mediaSavePref() {
  try {
    sessionStorage.setItem(MEDIA_PREF_KEY, JSON.stringify({ program: mediaState.program, discipline: mediaState.discipline }));
  } catch (e) { /* 저장 못 해도 동작에는 지장 없음 */ }
}

function mediaRenderBody() {
  const body = mediaState.root && mediaState.root.querySelector('#media-body');
  if (!body) return;
  body.replaceChildren();
  const data = mediaState.data;
  if (!data) { body.appendChild(mediaEl('div', 'admin-loading', '불러오는 중…')); return; }
  if (data.error) {
    const box = adminPlaceholder(data.error);
    box.appendChild(document.createElement('br'));
    box.appendChild(mediaButton('다시 불러오기', '', () => mediaLoad()));
    body.appendChild(box);
    return;
  }
  const sessions = mediaSessions();
  if (!sessions.length) {
    body.appendChild(adminPlaceholder(`${mediaProgramName(mediaState.program)} 「일정」에 ${mediaState.discipline} 수업이 없습니다.`));
    return;
  }
  body.appendChild(mediaState.program === 'ws' ? mediaWorkshopGrid(sessions) : mediaSessionTable(sessions));
  const detail = mediaEl('div', 'media-detail');
  detail.id = 'media-detail';
  body.appendChild(detail);
  mediaRenderDetail();
}

/* ---------- 관리자 일정표 ---------- */

function mediaToneMap() {
  const map = {};
  return name => {
    const key = String(name || '').replace(/\(.*?\)/g, '').replace(/\s+[A-Z]$/, '').trim();
    if (!(key in map)) map[key] = MEDIA_TONES[Object.keys(map).length % MEDIA_TONES.length];
    return map[key];
  };
}

// 칸 안 내용: 시간 · 수업명 · 강사 · 영상 수(공개/비공개) · 업로드 중. 관리자는 영상이 없는 칸도 누를 수 있다(추가하려고).
function mediaFillCell(el, session, timeLabel) {
  const videos = mediaVideos(session.sessionId);
  const open = videos.filter(v => v['공개여부'] === '공개').length;
  const closed = videos.length - open;
  const pending = mediaPendingCount(session.sessionId);
  el.classList.add(videos.length ? 'has-materials' : 'idle', 'clickable', 'media-cell');
  if (session.sessionId === mediaState.selected) el.classList.add('media-selected');
  el.tabIndex = 0;

  if (timeLabel) el.appendChild(mediaEl('div', 'session-time', timeLabel));
  el.appendChild(mediaEl('div', 'cell-class', session.className));
  if (session.instructor) el.appendChild(mediaEl('div', 'cell-sub', session.instructor));
  if (videos.length) {
    el.appendChild(mediaEl('div', 'cell-state ready', `영상 ${videos.length}` + (closed ? ` · 미공개 ${closed}` : '')));
  }
  if (pending) el.appendChild(mediaEl('div', 'cell-state media-pending-state', `올리는 중 ${pending}`));

  const select = () => {
    mediaState.selected = session.sessionId;
    mediaState.root.querySelectorAll('.media-cell.media-selected').forEach(x => x.classList.remove('media-selected'));
    el.classList.add('media-selected');
    mediaRenderDetail();
    const detail = mediaState.root.querySelector('#media-detail');
    if (detail) detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  el.addEventListener('click', select);
  el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(); } });
  return el;
}

// 열람 일정표(view-schedule.js buildWorkshopGrid)와 같은 모양: 수업 칸을 길이만큼 세로로 늘이고
// 같은 시간 수업은 좌우로 나눈다. 관리자 페이지는 그 파일을 싣지 않아 그리는 방법만 따라 만든다.
function mediaAssignLanes(items) {
  const clusters = [];
  let current = null, clusterEnd = -Infinity;
  items.forEach(it => {
    if (!current || it.start >= clusterEnd) { current = []; clusters.push(current); clusterEnd = -Infinity; }
    current.push(it);
    clusterEnd = Math.max(clusterEnd, it.end);
  });
  clusters.forEach(cluster => {
    const laneEnds = [];
    cluster.forEach(it => {
      let lane = laneEnds.findIndex(end => end <= it.start);
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(0); }
      laneEnds[lane] = it.end;
      it.lane = lane;
    });
    cluster.forEach(it => { it.laneCount = laneEnds.length; });
  });
  return Math.max(1, ...items.map(it => it.laneCount || 1));
}

function mediaSeq(s) {
  return Number(String(s.sessionId || '').split('-').pop()) || 0;
}

function mediaWorkshopGrid(sessions) {
  const toneOf = mediaToneMap();
  const byDate = {};
  sessions.forEach(s => { (byDate[s.date] = byDate[s.date] || []).push(s); });
  const dates = Object.keys(byDate).sort();

  let gridStart = Infinity, gridEnd = -Infinity;
  const parsed = {};
  dates.forEach(date => {
    parsed[date] = byDate[date].map(s => {
      const start = mediaMinutes(s.startTime);
      const end = Math.max(mediaMinutes(s.endTime), start + 1);
      gridStart = Math.min(gridStart, start);
      gridEnd = Math.max(gridEnd, end);
      return { session: s, start, end };
    }).sort((a, b) => a.start - b.start || mediaSeq(a.session) - mediaSeq(b.session));
  });
  gridStart = Math.floor(gridStart / 30) * 30;
  gridEnd = Math.ceil(gridEnd / 30) * 30;
  const slotCount = Math.max(1, (gridEnd - gridStart) / 30);

  const columns = {}, startsAt = {}, occupied = {};
  dates.forEach(date => {
    const cols = mediaAssignLanes(parsed[date]);
    columns[date] = cols;
    startsAt[date] = {};
    occupied[date] = Array.from({ length: slotCount }, () => new Array(cols).fill(false));
    parsed[date].forEach(it => {
      const rowStart = Math.floor((it.start - gridStart) / 30);
      const rowEnd = Math.min(slotCount, Math.max(rowStart + 1, Math.ceil((it.end - gridStart) / 30)));
      const colStart = Math.floor(it.lane * cols / it.laneCount);
      const colEnd = Math.floor((it.lane + 1) * cols / it.laneCount);
      if (occupied[date][rowStart][colStart]) return;
      for (let r = rowStart; r < rowEnd; r++) for (let c = colStart; c < colEnd; c++) occupied[date][r][c] = true;
      startsAt[date][`${rowStart}:${colStart}`] = { ...it, rowSpan: rowEnd - rowStart, colSpan: colEnd - colStart };
    });
  });

  const wrap = mediaEl('div', 'schedule-table-wrap media-grid-wrap');
  const table = mediaEl('table', 'schedule-grid workshop-grid');
  const colgroup = document.createElement('colgroup');
  const timeCol = mediaEl('col', 'time-col-width');
  colgroup.appendChild(timeCol);
  dates.forEach(date => {
    for (let c = 0; c < columns[date]; c++) {
      const col = document.createElement('col');
      col.style.width = `${100 / dates.length / columns[date]}%`;
      colgroup.appendChild(col);
    }
  });
  table.appendChild(colgroup);

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  headRow.appendChild(mediaEl('th', 'time-col', '시간'));
  dates.forEach((date, i) => {
    const th = mediaEl('th', 'col-head');
    th.colSpan = columns[date];
    th.append(mediaEl('div', 'col-head-main', `DAY ${i + 1}`), mediaEl('div', 'col-head-sub', mediaDateLabel(date)));
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (let slot = 0; slot < slotCount; slot++) {
    const tr = document.createElement('tr');
    const mins = gridStart + slot * 30;
    tr.appendChild(mediaEl('td', 'time-col' + (mins % 60 ? ' half' : ''),
      `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`));
    dates.forEach(date => {
      for (let c = 0; c < columns[date]; c++) {
        const block = startsAt[date][`${slot}:${c}`];
        if (block) {
          const td = mediaEl('td', 'cell-block');
          td.rowSpan = block.rowSpan;
          td.colSpan = block.colSpan;
          const card = mediaEl('div', 'block');
          card.style.setProperty('--h', toneOf(block.session.className));
          td.appendChild(mediaFillCell(card, block.session, `${block.session.startTime}–${block.session.endTime}`));
          tr.appendChild(td);
          continue;
        }
        if (occupied[date][slot][c]) continue;
        tr.appendChild(mediaEl('td', 'cell-empty'));
      }
    });
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

// 멘토링·캠프: 일자·시간 순 목록(관리용이라 열람 화면 모양을 따르지 않는다)
function mediaSessionTable(sessions) {
  const wrap = mediaEl('div', 'admin-table-wrap');
  const table = mediaEl('table', 'admin-table media-session-table');
  const isMentoring = mediaState.program === 'mt';
  const head = document.createElement('tr');
  ['일자', '시간', ...(isMentoring ? ['권역 · 회차'] : []), '수업명', '영상'].forEach(h => head.appendChild(mediaEl('th', null, h)));
  const thead = document.createElement('thead');
  thead.appendChild(head);
  const tbody = document.createElement('tbody');
  sessions.slice()
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || mediaMinutes(a.startTime) - mediaMinutes(b.startTime) || mediaSeq(a) - mediaSeq(b))
    .forEach(s => {
      const tr = document.createElement('tr');
      const videos = mediaVideos(s.sessionId);
      const closed = videos.filter(v => v['공개여부'] !== '공개').length;
      tr.append(mediaEl('td', 'mono', mediaDateLabel(s.date)), mediaEl('td', 'mono', `${s.startTime}–${s.endTime}`));
      if (isMentoring) tr.appendChild(mediaEl('td', null, [s.region, s.round ? `${s.round}회차` : ''].filter(Boolean).join(' · ')));
      tr.append(
        mediaEl('td', null, s.className),
        mediaEl('td', 'num', videos.length ? `${videos.length}` + (closed ? ` (미공개 ${closed})` : '') : '–')
      );
      mediaFillRow(tr, s);
      tbody.appendChild(tr);
    });
  table.append(thead, tbody);
  wrap.appendChild(table);
  return wrap;
}

function mediaFillRow(tr, session) {
  tr.classList.add('media-cell', 'clickable');
  if (session.sessionId === mediaState.selected) tr.classList.add('media-selected');
  tr.tabIndex = 0;
  const select = () => {
    mediaState.selected = session.sessionId;
    mediaState.root.querySelectorAll('.media-cell.media-selected').forEach(x => x.classList.remove('media-selected'));
    tr.classList.add('media-selected');
    mediaRenderDetail();
  };
  tr.addEventListener('click', select);
  tr.addEventListener('keydown', e => { if (e.key === 'Enter') select(); });
}

/* ---------- 칸의 영상 목록 (5.4) ---------- */

function mediaRenderDetail() {
  const detail = mediaState.root && mediaState.root.querySelector('#media-detail');
  if (!detail) return;
  detail.replaceChildren();
  const session = mediaState.data && mediaState.data.sessions.find(s => s.sessionId === mediaState.selected);
  if (!session) {
    detail.appendChild(mediaEl('div', 'admin-notice', '위 일정표에서 칸을 누르세요.'));
    return;
  }

  const head = mediaEl('div', 'media-detail-head');
  const title = mediaEl('div', 'media-detail-title', `${mediaDateLabel(session.date)} ${session.startTime}–${session.endTime} · ${session.className}`);
  const sub = mediaEl('div', 'media-detail-sub', [session.sessionId, session.instructor].filter(Boolean).join(' · '));
  head.append(title, sub);
  detail.appendChild(head);

  const videos = mediaVideos(session.sessionId);
  if (videos.length) {
    detail.appendChild(mediaVideoTable(videos));
  } else {
    detail.appendChild(mediaEl('div', 'admin-notice', '이 칸에 등록된 영상이 없습니다.'));
  }

  const pending = mediaState.data.pending.filter(p => p.sessionId === session.sessionId)
    .filter(p => !mediaState.jobs.some(j => j.videoId === p.videoId && j.status !== 'done'));
  if (pending.length) {
    detail.appendChild(mediaEl('div', 'admin-notice media-warn',
      `등록되지 않은 업로드 ${pending.length}개(${pending.map(p => p.fileName).join(', ')}) — 다른 창에서 올리는 중이거나 중간에 멈춘 것입니다. 24시간 안에 등록되지 않으면 Vimeo 제목에 [삭제 필요]가 붙고 번호가 풀립니다.`));
  }

  if (mediaState.data.canUpload) {
    detail.appendChild(mediaAddForm(session));
  } else {
    detail.appendChild(mediaEl('div', 'admin-notice', `${mediaProgramName(mediaState.program)}는 Vimeo 폴더 이름이 정해지면 영상을 추가할 수 있습니다(지금은 보기·수정·삭제만).`));
  }
}

function mediaVideoTable(videos) {
  const wrap = mediaEl('div', 'admin-table-wrap');
  const table = mediaEl('table', 'admin-table media-video-table');
  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  ['파일명', '소제목', '공개여부', 'Vimeo', ''].forEach(h => hr.appendChild(mediaEl('th', null, h)));
  thead.appendChild(hr);
  const tbody = document.createElement('tbody');
  const uses = mediaState.data.linkUses || {};

  videos.forEach(m => {
    const tr = document.createElement('tr');
    const subtitle = mediaEl('input', 'admin-input media-subtitle');
    subtitle.value = m['소제목'] || '';
    subtitle.maxLength = 40;
    subtitle.placeholder = '예: 피아노1';
    const visibilityOptions = ['공개', '비공개'];
    if (!visibilityOptions.includes(m['공개여부'])) visibilityOptions.unshift(m['공개여부'] || '검수대기');
    const visibility = mediaSelect(visibilityOptions, m['공개여부'] || visibilityOptions[0]);

    const save = mediaButton('저장', 'primary');
    save.disabled = true;
    const dirty = () => {
      save.disabled = subtitle.value.trim() === (m['소제목'] || '') && visibility.value === m['공개여부'];
    };
    subtitle.addEventListener('input', dirty);
    visibility.addEventListener('change', dirty);
    save.addEventListener('click', () => mediaSaveRow(m, subtitle.value.trim(), visibility.value, save));
    subtitle.addEventListener('keydown', e => { if (e.key === 'Enter' && !save.disabled) save.click(); });

    const del = mediaButton('삭제', 'danger', () => mediaDeleteRow(m, uses, { tr, del, save, subtitle, visibility }));
    const actions = mediaEl('td', 'media-actions');
    actions.append(save, del);

    const subtitleTd = document.createElement('td');
    subtitleTd.appendChild(subtitle);
    const visTd = document.createElement('td');
    visTd.appendChild(visibility);
    tr.append(mediaEl('td', 'mono', m['파일명']), subtitleTd, visTd, mediaEl('td', 'mono', m['링크']), actions);
    tbody.appendChild(tr);
  });
  table.append(thead, tbody);
  wrap.appendChild(table);
  return wrap;
}

async function mediaSaveRow(m, subtitle, visibility, btn) {
  const changes = {};
  if (subtitle !== (m['소제목'] || '')) changes['소제목'] = subtitle;
  if (visibility !== m['공개여부']) changes['공개여부'] = visibility;
  if (!Object.keys(changes).length) return;
  btn.disabled = true;
  btn.textContent = '저장 중…';
  try {
    await adminCall('adminMaterialUpdate', { program: mediaState.program, row: m._row, before: m, changes }, { write: true });
    showAdminToast('저장했습니다.');
    await mediaLoad({ quiet: true });
  } catch (e) {
    showAdminToast(mediaErrorMessage(e, { write: true }), 'error');
    btn.disabled = false;
    btn.textContent = '저장';
    if (e.code === 'CONFLICT') mediaLoad({ quiet: true });
  }
}

async function mediaDeleteRow(m, uses, row) {
  const others = Math.max(0, (uses[String(m['링크'])] || 1) - 1);
  const body = [
    m['파일명'] + (m['소제목'] ? ` (${m['소제목']})` : ''),
    '',
    '「자료」에서 이 줄을 지웁니다. 지운 내용은 「관리기록」에 남습니다.',
    others
      ? `이 영상은 다른 칸·학생 작품 ${others}줄에도 등록되어 있어 Vimeo 영상은 그대로 둡니다.`
      : '다른 곳에 등록된 줄이 없어 Vimeo 영상 제목 앞에 [삭제 필요]를 붙입니다. Vimeo에서 영상을 지우는 것은 운영진이 직접 합니다.'
  ].join('\n');
  const ok = await openAdminDialog({ title: '영상 삭제', body, okLabel: '삭제', danger: true });
  if (!ok) return;
  // 시트 행 삭제와 Vimeo 제목 표시에 몇 초 걸리므로 그동안 그 줄을 잠그고 「삭제 중…」을 보여 준다
  const controls = [row.del, row.save, row.subtitle, row.visibility];
  const wasDisabled = controls.map(c => c.disabled);
  controls.forEach(c => { c.disabled = true; });
  row.tr.classList.add('media-busy');
  row.del.textContent = '삭제 중…';
  // 위쪽 「올리기」 상자에도 삭제 줄을 띄운다
  const s = (mediaState.data.sessions || []).find(x => x.sessionId === m['세션ID']);
  const job = {
    kind: 'delete',
    program: mediaState.program,
    sessionLabel: s ? `${mediaDateLabel(s.date)} ${s.startTime} ${s.className}` : (m['세션ID'] || ''),
    fileName: m['파일명'],
    subtitle: m['소제목'] || '',
    status: 'deleting',  // deleting · done · failed
    message: '「자료」 줄 삭제·Vimeo 정리 중'
  };
  mediaState.jobs.push(job);
  mediaRenderJobs();
  try {
    const r = await adminCall('adminMaterialDelete', { program: mediaState.program, row: m._row, before: m }, { write: true });
    const vimeoFailed = r.vimeo && r.vimeo.includes('실패');
    job.status = 'done';
    job.message = vimeoFailed ? '「자료」에서 지웠지만 Vimeo 제목 표시는 실패했습니다. 「관리기록」을 보고 손으로 정리해 주세요.'
      : r.vimeo === '[삭제 필요] 표시' ? '「자료」에서 지웠습니다. Vimeo 영상 제목에 [삭제 필요]를 붙였습니다.'
      : r.remaining ? '「자료」에서 지웠습니다. 다른 줄에서 쓰는 영상이라 Vimeo는 그대로 둡니다.'
      : '「자료」에서 지웠습니다.';
    showAdminToast(vimeoFailed ? '지웠습니다. Vimeo 제목 표시는 실패해 「관리기록」을 보고 손으로 정리해야 합니다.' : '지웠습니다.',
      vimeoFailed ? 'error' : 'ok');
  } catch (e) {
    job.status = 'failed';
    job.message = mediaErrorMessage(e, { write: true });
    showAdminToast(job.message, 'error');
    controls.forEach((c, i) => { c.disabled = wasDisabled[i]; });
    row.tr.classList.remove('media-busy');
    row.del.textContent = '삭제';
  }
  mediaRenderJobs();
  mediaLoad({ quiet: true });
}

/* ---------- 영상 추가 (5.5) ---------- */

// 칸 안의 [영상 추가] 상자: 파일을 고르면 파일마다 소제목·공개여부·학생 작품 입력 줄이 생긴다.
function mediaAddForm(session) {
  const box = mediaEl('div', 'media-add');
  const head = mediaEl('div', 'media-add-head');
  head.appendChild(mediaEl('div', 'media-add-title', '영상 추가'));
  head.appendChild(mediaEl('div', 'admin-section-desc',
    '편집된 영상을 그대로 Vimeo에 올리고 이 칸의 「자료」에 등록합니다. 파일명은 자동으로 정해집니다(세션ID_번호). 올리는 동안 이 창을 닫거나 새로고침하지 마세요.'));
  box.appendChild(head);

  const picker = mediaEl('input', 'media-file-input');
  picker.type = 'file';
  picker.multiple = true;
  picker.accept = 'video/*,.mts,.mkv';
  const pickBtn = mediaButton('파일 고르기', '', () => picker.click());
  const list = mediaEl('div', 'media-file-list');
  const submit = mediaButton('올리기', 'primary');
  submit.disabled = true;
  const bar = mediaEl('div', 'admin-toolbar media-add-bar');
  bar.append(pickBtn, mediaEl('div', 'spacer'), submit);
  box.append(picker, bar, list);

  let entries = [];
  const redraw = () => {
    list.replaceChildren();
    entries.forEach((entry, i) => list.appendChild(mediaFileRow(entry, () => { entries.splice(i, 1); redraw(); })));
    submit.disabled = entries.length === 0;
    submit.textContent = entries.length ? `${entries.length}개 올리기` : '올리기';
  };
  picker.addEventListener('change', () => {
    Array.from(picker.files).forEach(file => entries.push({ file, subtitle: '', visibility: '공개', isWork: false, studentName: '' }));
    picker.value = '';
    redraw();
  });
  submit.addEventListener('click', async () => {
    const missing = entries.find(e => e.isWork && !e.studentName.trim());
    if (missing) { showAdminToast(`${missing.file.name}: 학생명을 적어 주세요.`, 'error'); return; }
    submit.disabled = true;
    submit.textContent = '준비 중…';
    const ok = await mediaStartUploads(session, entries);
    if (ok) { entries = []; redraw(); } else { submit.disabled = false; submit.textContent = `${entries.length}개 올리기`; }
  });
  return box;
}

function mediaFileRow(entry, onRemove) {
  const row = mediaEl('div', 'media-file-row');
  const name = mediaEl('div', 'media-file-name');
  name.append(mediaEl('span', null, entry.file.name), mediaEl('span', 'media-file-size', mediaSize(entry.file.size)));

  const subtitle = mediaEl('input', 'admin-input');
  subtitle.placeholder = '소제목 (예: 피아노1)';
  subtitle.maxLength = 40;
  subtitle.value = entry.subtitle;
  subtitle.addEventListener('input', () => { entry.subtitle = subtitle.value; });

  const visibility = mediaSelect(['공개', '비공개'], entry.visibility);
  visibility.addEventListener('change', () => { entry.visibility = visibility.value; });

  const workLabel = mediaEl('label', 'media-check');
  const work = document.createElement('input');
  work.type = 'checkbox';
  work.checked = entry.isWork;
  workLabel.append(work, document.createTextNode('학생 작품으로도 등록'));
  const student = mediaEl('input', 'admin-input media-student');
  student.placeholder = '학생명';
  student.maxLength = 40;
  student.value = entry.studentName;
  student.classList.toggle('hidden', !entry.isWork);
  student.addEventListener('input', () => { entry.studentName = student.value; });
  work.addEventListener('change', () => {
    entry.isWork = work.checked;
    student.classList.toggle('hidden', !work.checked);
    if (work.checked) student.focus();
  });
  // 연주회처럼 학생 단위 영상은 소제목을 학생명으로 두므로(8.21 2줄 방식), 소제목이 비어 있으면 함께 채운다
  student.addEventListener('change', () => {
    if (!subtitle.value.trim() && student.value.trim()) { subtitle.value = student.value.trim(); entry.subtitle = subtitle.value; }
  });

  const remove = mediaButton('빼기', '', onRemove);
  row.append(name, subtitle, visibility, workLabel, student, remove);
  return row;
}

// 관문이 파일 전체의 번호를 한 번에 정하고 영상을 만든 뒤 업로드 주소를 준다 → 한 파일씩 차례로 올린다.
async function mediaStartUploads(session, entries) {
  const program = mediaState.program;
  let created;
  try {
    created = await adminCall('adminVideoCreate', {
      program, sessionId: session.sessionId,
      files: entries.map(e => ({ name: e.file.name, size: e.file.size }))
    }, { write: true });
  } catch (e) {
    showAdminToast(mediaErrorMessage(e, { write: true }), 'error');
    return false;
  }
  created.items.forEach((item, i) => {
    const e = entries[i];
    mediaState.jobs.push({
      file: e.file,
      program,
      sessionLabel: `${mediaDateLabel(session.date)} ${session.startTime} ${session.className}`,
      videoId: item.videoId,
      uploadLink: item.uploadLink,
      fileName: item.fileName,
      subtitle: e.subtitle.trim(),
      visibility: e.visibility,
      student: e.isWork ? { name: e.studentName.trim(), studentId: '' } : null,
      status: 'waiting',   // waiting · uploading · finishing · done · failed · cancelled
      failedAt: '',        // upload · finish — [다시 시도]가 어디서부터 할지
      sent: 0,
      message: '',
      xhr: null
    });
  });
  showAdminToast(`${created.items.length}개를 올립니다. Vimeo 폴더: ${created.folder}`);
  mediaRenderJobs();
  mediaLoad({ quiet: true }); // 칸에 「올리는 중」 표시
  mediaRunQueue();
  return true;
}

/* ---------- 업로드 줄 ---------- */

let mediaQueueRunning = false;

async function mediaRunQueue() {
  if (mediaQueueRunning) return;
  mediaQueueRunning = true;
  mediaStartPing();
  try {
    for (;;) {
      const job = mediaState.jobs.find(j => j.status === 'waiting');
      if (!job) break;
      await mediaRunJob(job);
    }
  } finally {
    mediaQueueRunning = false;
    if (!mediaBusy()) mediaStopPing();
  }
}

async function mediaRunJob(job) {
  if (job.failedAt !== 'finish') {
    job.status = 'uploading';
    job.message = '';
    mediaRenderJobs();
    try {
      await tusUpload(job);
    } catch (e) {
      if (job.status === 'cancelled') return;
      job.status = 'failed';
      job.failedAt = 'upload';
      job.message = e.message || '업로드 실패';
      mediaRenderJobs();
      return;
    }
  }
  job.status = 'finishing';
  job.failedAt = '';
  job.message = 'Vimeo 확인·「자료」 등록 중';
  mediaRenderJobs();
  try {
    for (let i = 0; ; i++) {
      const r = await adminCall('adminVideoFinish', {
        program: job.program, videoId: job.videoId, subtitle: job.subtitle, visibility: job.visibility, student: job.student
      }, { write: true });
      if (r.done) break;
      if (i >= MEDIA_FINISH_TRIES) throw Object.assign(new Error('Vimeo가 아직 업로드를 처리하는 중입니다. 잠시 뒤 [다시 시도]를 눌러 주세요.'), { code: 'NOT_COMPLETE' });
      await mediaWait(4000);
    }
    job.status = 'done';
    job.message = '등록 완료 — Vimeo 변환이 끝나면(몇 분) 사이트에서 재생됩니다.';
    job.file = null; // 끝난 파일은 놓아 준다
  } catch (e) {
    job.status = 'failed';
    job.failedAt = 'finish';
    job.message = e.code === 'NOT_COMPLETE' ? e.message : mediaErrorMessage(e, { write: true });
  }
  mediaRenderJobs();
  mediaLoad({ quiet: true });
}

function mediaBusy() {
  return mediaState.jobs.some(j => ['waiting', 'uploading', 'finishing', 'deleting'].includes(j.status));
}

// 업로드 중에는 관문을 부르지 않으므로 관리자 토큰(30분)이 끝나지 않게 이어 준다.
function mediaStartPing() {
  if (mediaState.pingTimer) return;
  mediaState.pingTimer = setInterval(() => {
    if (!mediaBusy()) { mediaStopPing(); return; }
    adminCall('adminPing').catch(() => { /* 다음 번에 다시. 토큰이 끝났으면 adminCall이 로그인 화면으로 보낸다 */ });
  }, MEDIA_PING_MS);
}

function mediaStopPing() {
  clearInterval(mediaState.pingTimer);
  mediaState.pingTimer = null;
}

async function mediaCancelJob(job) {
  const ok = await openAdminDialog({
    title: '업로드 취소',
    body: `${job.fileName}\n\n올리기를 그만두고 Vimeo에 만든 영상 제목 앞에 [삭제 필요]를 붙입니다. 「자료」에는 등록되지 않습니다.`,
    okLabel: '취소하기', danger: true
  });
  if (!ok) return;
  const wasRunning = job.status === 'uploading';
  job.status = 'cancelled';
  if (job.xhr) job.xhr.abort();
  job.message = '취소 처리 중…';
  mediaRenderJobs();
  try {
    await adminCall('adminVideoFinish', { program: job.program, videoId: job.videoId, cancel: true }, { write: true });
    job.message = '취소했습니다. Vimeo 영상 제목에 [삭제 필요]가 붙었습니다.';
  } catch (e) {
    job.message = '취소는 했지만 Vimeo 정리에 실패했습니다(24시간 뒤 자동 정리). ' + mediaErrorMessage(e, { write: true });
  }
  job.file = null;
  mediaRenderJobs();
  mediaLoad({ quiet: true });
  if (!wasRunning) mediaRunQueue();
}

function mediaRenderJobs() {
  const box = mediaState.root && mediaState.root.querySelector('#media-jobs');
  if (!box) return;
  box.replaceChildren();
  if (!mediaState.jobs.length) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');

  const head = mediaEl('div', 'media-jobs-head');
  const hasDelete = mediaState.jobs.some(j => j.kind === 'delete');
  const hasUpload = mediaState.jobs.some(j => j.kind !== 'delete');
  head.appendChild(mediaEl('div', 'media-add-title', hasDelete ? (hasUpload ? '올리기·삭제' : '삭제') : '올리기'));
  const doneCount = mediaState.jobs.filter(j => j.status === 'done').length;
  head.appendChild(mediaEl('div', 'media-jobs-count', `${doneCount} / ${mediaState.jobs.filter(j => j.status !== 'cancelled').length} 완료`));
  if (!mediaBusy()) {
    head.appendChild(mediaButton('목록 비우기', '', () => {
      // 다시 시도할 수 있는 업로드 줄만 남긴다(삭제 줄은 다시 시도가 없음)
      mediaState.jobs = mediaState.jobs.filter(j => j.status === 'failed' && j.kind !== 'delete');
      mediaRenderJobs();
    }));
  }
  box.appendChild(head);

  mediaState.jobs.forEach(job => {
    const isDelete = job.kind === 'delete';
    const row = mediaEl('div', 'media-job ' + job.status);
    const info = mediaEl('div', 'media-job-info');
    info.append(
      mediaEl('div', 'media-job-name', job.fileName + (job.subtitle ? ` · ${job.subtitle}` : '')),
      mediaEl('div', 'media-job-sub', `${mediaProgramName(job.program)} · ${job.sessionLabel}` + (job.file ? ` · ${job.file.name}` : ''))
    );
    const progress = mediaEl('progress', 'media-progress');
    progress.max = 100;
    // 삭제는 진행률을 알 수 없어 지우는 동안 값을 넣지 않는다(움직이는 막대)
    if (!(isDelete && job.status === 'deleting')) {
      progress.value = job.status === 'done' || job.status === 'finishing' ? 100 : (job.file && job.file.size ? Math.floor(job.sent / job.file.size * 100) : 0);
    }
    const label = isDelete ? {
      deleting: '삭제 중',
      done: '삭제됨',
      failed: '실패'
    }[job.status] : {
      waiting: '기다리는 중',
      uploading: job.file ? `${mediaSize(job.sent)} / ${mediaSize(job.file.size)}` : '올리는 중',
      finishing: '등록 중',
      done: '완료',
      failed: '멈춤',
      cancelled: '취소'
    }[job.status];
    const state = mediaEl('div', 'media-job-state', label);
    const actions = mediaEl('div', 'media-actions');
    // 삭제 줄에는 버튼이 없다
    if (!isDelete && job.status === 'failed') {
      actions.appendChild(mediaButton('다시 시도', 'primary', () => { job.status = 'waiting'; mediaRenderJobs(); mediaRunQueue(); }));
    }
    if (!isDelete && ['waiting', 'uploading', 'failed'].includes(job.status)) {
      actions.appendChild(mediaButton('취소', 'danger', () => mediaCancelJob(job)));
    }
    row.append(info, progress, state, actions);
    if (job.message) row.appendChild(mediaEl('div', 'media-job-msg', job.message));
    box.appendChild(row);
  });
}

// 진행률만 바뀔 때는 줄 전체를 다시 그리지 않는다(초당 여러 번 불림)
function mediaUpdateProgress(job) {
  const box = mediaState.root && mediaState.root.querySelector('#media-jobs');
  if (!box) return;
  const i = mediaState.jobs.indexOf(job);
  const row = box.querySelectorAll('.media-job')[i];
  if (!row || !job.file) return;
  row.querySelector('.media-progress').value = Math.floor(job.sent / job.file.size * 100);
  row.querySelector('.media-job-state').textContent = `${mediaSize(job.sent)} / ${mediaSize(job.file.size)}`;
}

/* ---------- tus 업로드 (외부 라이브러리 없이) ---------- */
// docs/admin-media-notes.md 1절: Vimeo 업로드 서버는 브라우저 요청을 받아 주고 Upload-Offset을 읽을 수 있다.
// HEAD로 서버가 받은 위치를 묻고, 그 위치부터 조각을 PATCH로 보낸다. 끊기면 HEAD부터 다시 해 남은 위치에서 잇는다.

class TusError extends Error {}

async function tusOffset(link) {
  const res = await fetch(link, { method: 'HEAD', headers: { 'Tus-Resumable': '1.0.0' }, cache: 'no-store' });
  const offset = res.headers.get('Upload-Offset');
  if (res.status !== 200 || offset == null) throw new TusError(`업로드 서버 응답 ${res.status}`);
  return Number(offset);
}

// 조각 하나를 보낸다. 진행률을 보려고 fetch 대신 XHR을 쓴다(fetch는 보내는 양을 알 수 없음).
function tusPatch(job, offset, blob) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    job.xhr = xhr;
    xhr.open('PATCH', job.uploadLink);
    xhr.setRequestHeader('Tus-Resumable', '1.0.0');
    xhr.setRequestHeader('Upload-Offset', String(offset));
    xhr.setRequestHeader('Content-Type', 'application/offset+octet-stream');
    xhr.upload.onprogress = e => { job.sent = offset + e.loaded; mediaUpdateProgress(job); };
    xhr.onload = () => {
      job.xhr = null;
      const next = xhr.getResponseHeader('Upload-Offset');
      if (xhr.status === 204 && next != null) resolve(Number(next));
      else reject(new TusError(`업로드 서버 응답 ${xhr.status}`));
    };
    xhr.onerror = () => { job.xhr = null; reject(new TusError('연결이 끊겼습니다')); };
    xhr.onabort = () => { job.xhr = null; reject(new TusError('중단됨')); };
    xhr.send(blob);
  });
}

function mediaWaitOnline() {
  if (navigator.onLine) return Promise.resolve();
  return new Promise(resolve => window.addEventListener('online', resolve, { once: true }));
}

async function tusUpload(job) {
  const size = job.file.size;
  let fails = 0;
  for (;;) {
    if (job.status === 'cancelled') throw new TusError('취소됨');
    if (!mediaState.root || !mediaState.root.isConnected) throw new TusError('화면이 닫혔습니다'); // 로그아웃 등
    try {
      let offset = await tusOffset(job.uploadLink);
      job.sent = offset;
      mediaUpdateProgress(job);
      while (offset < size) {
        if (job.status === 'cancelled') throw new TusError('취소됨');
        offset = await tusPatch(job, offset, job.file.slice(offset, Math.min(offset + TUS_CHUNK_BYTES, size)));
        job.sent = offset;
        fails = 0;
        mediaUpdateProgress(job);
      }
      return;
    } catch (e) {
      if (job.status === 'cancelled') throw e;
      // 인터넷이 끊긴 동안은 실패로 세지 않고 다시 연결될 때까지 기다린다
      if (!navigator.onLine) {
        job.message = '인터넷 연결이 끊겼습니다. 다시 연결되면 이어 올립니다.';
        mediaRenderJobs();
        await mediaWaitOnline();
        job.message = '';
        mediaRenderJobs();
        continue;
      }
      if (++fails > TUS_MAX_FAILS) throw new TusError(`${e.message} — 여러 번 실패했습니다. [다시 시도]를 누르면 올린 곳부터 이어 갑니다.`);
      job.message = `${e.message} — ${fails}번째 다시 시도 중`;
      mediaRenderJobs();
      await mediaWait(Math.min(3000 * fails, 30000));
      job.message = '';
    }
  }
}

// 올리는 중 창을 닫거나 새로고침하면 이어 올릴 수 없다(파일을 다시 읽을 수 없음) → 경고
window.addEventListener('beforeunload', e => {
  if (!mediaBusy()) return;
  e.preventDefault();
  e.returnValue = '';
});

registerAdminTab('media', {
  render: mediaRender,
  onShow: () => { if (!mediaState.data && !mediaState.loading) mediaLoad(); }
});
