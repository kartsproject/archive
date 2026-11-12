/**
 * 수업 자료 화면 + 열람기. docs/screens.md 6·7절.
 * - 일정표 칸을 누르면 목록 카드를 거치지 않고 열람기(가운데 재생·확대 + 오른쪽 영상·사진 목록)를 바로 펼친다(2026-10-07 결정).
 *   작품은 세션ID가 없어 이 화면 대상이 아님(인물 상세에서 다룸)
 * - 참여자 칩은 세션 단위로 한 번만 표시 (참여자 탭이 세션ID 단위라 자료별 구분이 없음)
 * - 영상은 화면 안에서 Vimeo로 재생하고 새 탭으로 열지 않는다(도메인 제한이 사이트 밖에서 무력화되므로).
 *   사진은 진입 시 photos 요청으로 미리 받아 두고, 빠진 것은 클릭 시 photo 요청으로 받아 확대 표시한다.
 * - 사진묶음(전체 사진 폴더) 열람 방식은 아직 미정이라(docs/decisions.md 9절) 항목만 보여주고 클릭은 막는다.
 * - 인물 상세는 여러 수업의 자료가 섞여 있어 예전처럼 목록 카드 → 모달 열람기로 연다(buildMaterialsSection).
 */
function renderMaterialsEmptyState(title, note) {
  const wrap = document.createElement('div');
  wrap.className = 'placeholder';
  const h = document.createElement('div');
  h.className = 'placeholder-title';
  h.textContent = title;
  const p = document.createElement('div');
  p.className = 'placeholder-note';
  p.textContent = note;
  wrap.append(h, p);
  return wrap;
}

function buildMaterialItem(material, onOpen) {
  const item = document.createElement('div');
  const isBundle = material.type === '사진묶음';
  item.className = 'material-item' + (isBundle ? ' disabled' : ' clickable');

  const type = document.createElement('div');
  type.className = 'material-type';
  type.textContent = material.type;
  item.appendChild(type);

  const name = document.createElement('div');
  name.className = 'material-name';
  name.textContent = material.fileName || '(파일명 없음)';
  item.appendChild(name);

  if (material.spec) {
    const spec = document.createElement('div');
    spec.className = 'material-spec';
    spec.textContent = material.spec;
    item.appendChild(spec);
  }

  if (isBundle) {
    const pending = document.createElement('div');
    pending.className = 'material-pending';
    pending.textContent = '열람 방식 확인 중';
    item.appendChild(pending);
  } else {
    item.addEventListener('click', () => onOpen(material));
  }

  return item;
}

function renderMaterialsList(container, items, onOpen) {
  container.replaceChildren();
  if (items.length === 0) {
    container.appendChild(renderMaterialsEmptyState('등록된 자료가 없습니다', '아직 업로드된 자료가 없습니다.'));
    return;
  }
  const grid = document.createElement('div');
  grid.className = 'material-list';
  items.forEach(m => grid.appendChild(buildMaterialItem(m, onOpen)));
  container.appendChild(grid);
}

// 영상·사진 자료를 탭(둘 다 있을 때)이나 단일 목록(하나만 있을 때)으로 묶어서 보여준다.
// 인물 상세 화면(클래스 자료·학생 작품)이 쓰고, 카드를 누르면 모달 열람기로 연다.
function buildMaterialsSection(videoItems, photoItems) {
  const wrap = document.createElement('div');
  const listContainer = document.createElement('div');
  // "사진묶음"(전체 폴더)만 확대 대상에서 빼고, 사진 · 작품(이미지)은 모두 확대 가능하다.
  const enlargeablePhotoItems = photoItems.filter(m => m.type !== '사진묶음');

  function showTab(tab) {
    if (tab === 'video') {
      renderMaterialsList(listContainer, videoItems, m => openMaterialModal('video', videoItems, videoItems.indexOf(m)));
    } else {
      renderMaterialsList(listContainer, photoItems, m => {
        if (m.type === '사진묶음') return; // buildMaterialItem에서 이미 클릭을 막지만 한 번 더 방어
        openMaterialModal('photo', enlargeablePhotoItems, enlargeablePhotoItems.indexOf(m));
      });
    }
  }

  if (videoItems.length === 0 && photoItems.length === 0) {
    wrap.appendChild(renderMaterialsEmptyState('등록된 자료가 없습니다', '아직 업로드된 자료가 없습니다.'));
    return wrap;
  }
  if (videoItems.length > 0 && photoItems.length > 0) {
    const tabs = document.createElement('div');
    tabs.className = 'materials-tabs';
    const videoTab = document.createElement('button');
    videoTab.type = 'button';
    videoTab.className = 'materials-tab active';
    videoTab.textContent = `영상 (${videoItems.length})`;
    const photoTab = document.createElement('button');
    photoTab.type = 'button';
    photoTab.className = 'materials-tab';
    photoTab.textContent = `사진 (${photoItems.length})`;
    videoTab.addEventListener('click', () => {
      videoTab.classList.add('active');
      photoTab.classList.remove('active');
      showTab('video');
    });
    photoTab.addEventListener('click', () => {
      photoTab.classList.add('active');
      videoTab.classList.remove('active');
      showTab('photo');
    });
    tabs.append(videoTab, photoTab);
    wrap.append(tabs, listContainer);
    showTab('video');
  } else if (videoItems.length > 0) {
    wrap.appendChild(listContainer);
    showTab('video');
  } else {
    wrap.appendChild(listContainer);
    showTab('photo');
  }
  return wrap;
}

// 「일정」 탭 분야 값(한글) ↔ 프로그램 슬러그로 세션 하나의 라우트를 만든다.
// 검색 결과·인물 상세의 참여 이력에서 공통으로 쓴다.
function sessionRoute(session) {
  const slugEntry = Object.entries(DISCIPLINE_SLUG).find(([kr]) => kr === session.discipline);
  const programInfo = PROGRAM_INFO.find(p => p.name === session.program);
  if (!slugEntry || !programInfo) return null;
  return `#/${slugEntry[1]}/${programInfo.slug}/${session.sessionId}`;
}

/* ---------- 사진 보관함 (미리 받기 + 메모리 보관, 2026-09-30 결정) ----------
 * 사진은 요청 한 번의 왕복(약 3초)이 크기보다 커서, 자료 페이지에 들어가면 photos 요청으로
 * 그 수업의 사진을 한 번에 받아 메모리에 담아 둔다(docs/api.md 3-5). 묶음에서 빠진 큰 사진과
 * 인물 상세의 사진은 클릭할 때 photo로 받고, 받은 것은 같은 보관함에 담는다.
 * 디스크(sessionStorage 등)에는 쓰지 않는다 — 탭을 닫으면 사라지고, 로그아웃하면 비운다.
 */
const PHOTO_CACHE_MAX_CHARS = 30 * 1024 * 1024; // 약 30MB. 넘으면 가장 오래 안 본 사진부터 버린다

const photoStore = {
  cache: new Map(),   // fileId → data URL (Map 순서 = 최근에 본 순서)
  chars: 0,
  pending: new Map(), // fileId → 받는 중인 요청(묶음 또는 한 장). 같은 사진을 두 번 요청하지 않게 한다
  generation: 0       // 로그아웃하면 올라가, 그 전에 보낸 요청의 결과를 버리게 한다
};

function photoDataUrl(photo) {
  return `data:${photo.mimeType};base64,${photo.base64}`;
}

function cachePhoto(fileId, src) {
  if (photoStore.cache.has(fileId)) photoStore.chars -= photoStore.cache.get(fileId).length;
  photoStore.cache.delete(fileId);
  photoStore.cache.set(fileId, src);
  photoStore.chars += src.length;
  while (photoStore.chars > PHOTO_CACHE_MAX_CHARS && photoStore.cache.size > 1) {
    const [oldestId, oldestSrc] = photoStore.cache.entries().next().value;
    photoStore.cache.delete(oldestId);
    photoStore.chars -= oldestSrc.length;
  }
}

function getCachedPhoto(fileId) {
  const src = photoStore.cache.get(fileId);
  if (!src) return null;
  photoStore.cache.delete(fileId); // 최근에 본 것으로 옮긴다
  photoStore.cache.set(fileId, src);
  return src;
}

function clearPhotoCache() {
  photoStore.cache.clear();
  photoStore.chars = 0;
  photoStore.pending.clear();
  photoStore.generation++;
}

// 자료 페이지 진입 시 뒤에서 한 번 보낸다. 실패해도 조용히 넘어가고, 클릭하면 한 장씩 받는다.
function prefetchSessionPhotos(sessionId, photoItems) {
  const token = getToken();
  if (!token) return;
  const targets = [...new Set(photoItems.filter(m => m.type === '사진' && m.link).map(m => String(m.link)))]
    .filter(id => !photoStore.cache.has(id) && !photoStore.pending.has(id));
  if (targets.length === 0) return; // 공개 사진이 없거나 이미 다 받아 둔 수업

  const generation = photoStore.generation;
  const batch = api.photos(token, sessionId)
    .then(res => {
      if (generation !== photoStore.generation) return;
      res.photos.forEach(p => cachePhoto(String(p.fileId), photoDataUrl(p)));
    })
    .catch(() => {})
    .finally(() => {
      targets.forEach(id => { if (photoStore.pending.get(id) === batch) photoStore.pending.delete(id); });
    });
  targets.forEach(id => photoStore.pending.set(id, batch));
}

// 보관함 → 받는 중인 요청 → 새 photo 요청 순서로 찾는다.
// 묶음에서 빠진 사진은 묶음이 끝난 뒤 보관함에 없으므로 그때 한 장 요청으로 넘어간다.
function loadPhotoSrc(fileId) {
  const id = String(fileId);
  const cached = getCachedPhoto(id);
  if (cached) return Promise.resolve(cached);

  const pending = photoStore.pending.get(id);
  if (pending) return pending.then(() => loadPhotoSrc(id));

  const generation = photoStore.generation;
  const request = api.photo(getToken(), id)
    .then(res => {
      const src = photoDataUrl(res);
      if (generation === photoStore.generation) cachePhoto(id, src);
      return src;
    })
    .finally(() => { if (photoStore.pending.get(id) === request) photoStore.pending.delete(id); });
  photoStore.pending.set(id, request);
  return request;
}

/* ---------- 열람기 (사이드바 목록 + 가운데 재생·확대) ----------
 * 수업 자료 화면에서는 화면 안에 바로 펼치고(2026-10-07 결정), 인물 상세에서는 모달로 띄운다(2026-09-18 결정).
 * 둘 다 같은 함수로 그리며, 열람기마다 자기 상태를 따로 갖는다.
 * - listType: 사이드바에 보이는 목록(영상·사진 탭), type·index: 가운데에 띄운 자료
 *   → 영상을 틀어 둔 채 사진 탭을 둘러볼 수 있도록 둘을 나눠 둔다.
 * - describe: 가운데 제목·목록 이름을 정한다. 기본은 파일명(모달), 수업 화면은 수업명(buildSessionViewer).
 */
function describeByFileName(viewer, type, index, material) {
  const name = material.fileName || `${type === 'video' ? '영상' : '사진'} ${index + 1}`;
  return { title: material.fileName || '', listLabel: name, fileLine: '' };
}

function createViewer(parts) {
  return {
    ...parts, lists: { video: [], photo: [] }, listType: null, type: null, index: -1, requestId: 0,
    describe: describeByFileName,
    startTime: 0 // 다음에 띄울 영상의 시작 시각(초). 시각 링크로 들어왔을 때 한 번만 쓴다
  };
}

const VIMEO_ORIGIN = 'https://player.vimeo.com';

// Vimeo 플레이어에 현재 재생 시각(초)을 묻는다. 플레이어가 쓰는 postMessage 규약을 그대로 써서
// 외부 라이브러리(player.js) 없이 처리한다. 응답이 없으면 2초 뒤 실패로 본다.
function requestVimeoCurrentTime(iframe) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      window.removeEventListener('message', onMessage);
      reject(new Error('timeout'));
    }, 2000);
    function onMessage(e) {
      if (e.origin !== VIMEO_ORIGIN || e.source !== iframe.contentWindow) return;
      let data = e.data;
      if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch (err) { return; }
      }
      if (!data || data.method !== 'getCurrentTime') return;
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      resolve(Math.max(0, Math.floor(Number(data.value) || 0)));
    }
    window.addEventListener('message', onMessage);
    iframe.contentWindow.postMessage({ method: 'getCurrentTime' }, VIMEO_ORIGIN);
  });
}

// 75 → "01:15", 3920 → "1:05:20"
function formatPlayTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function clearViewer(viewer) {
  viewer.videoFrame.replaceChildren();
  viewer.videoFrame.classList.add('hidden');
  viewer.photoFrame.replaceChildren();
  viewer.photoFrame.classList.add('hidden');
  viewer.lists = { video: [], photo: [] };
  viewer.type = null;
  viewer.index = -1;
  viewer.requestId++; // 남아있던 사진 요청 결과를 무시하게 한다
}

function buildViewerTab(viewer, type, label) {
  const tab = document.createElement('button');
  tab.type = 'button';
  tab.className = 'materials-tab' + (viewer.listType === type ? ' active' : '');
  tab.textContent = `${label} (${viewer.lists[type].length})`;
  tab.addEventListener('click', () => {
    viewer.listType = type;
    renderViewerSidebar(viewer);
  });
  return tab;
}

function renderViewerSidebar(viewer) {
  const { video, photo } = viewer.lists;
  // 영상·사진이 모두 있을 때만 탭으로 나누고, 한 종류뿐이면 「영상 목록 (N)」 제목만 둔다
  if (video.length > 0 && photo.length > 0) {
    const tabs = document.createElement('div');
    tabs.className = 'sidebar-tabs';
    tabs.append(buildViewerTab(viewer, 'video', '영상'), buildViewerTab(viewer, 'photo', '사진'));
    viewer.sidebarHead.classList.add('has-tabs');
    viewer.sidebarHead.replaceChildren(tabs);
  } else {
    viewer.sidebarHead.classList.remove('has-tabs');
    viewer.sidebarHead.textContent = (viewer.listType === 'video' ? '영상 목록' : '사진 목록') + ` (${viewer.lists[viewer.listType].length})`;
  }

  viewer.sidebarList.replaceChildren();
  viewer.lists[viewer.listType].forEach((m, i) => {
    const isBundle = m.type === '사진묶음';
    const isActive = viewer.listType === viewer.type && i === viewer.index;
    const item = document.createElement('div');
    item.className = 'sidebar-list-item' + (isActive ? ' active' : '') + (isBundle ? ' disabled' : '');

    const index = document.createElement('div');
    index.className = 'sidebar-list-index';
    index.textContent = String(i + 1).padStart(2, '0');
    item.appendChild(index);

    const { listLabel, fileLine } = viewer.describe(viewer, viewer.listType, i, m);
    const text = document.createElement('div');
    text.className = 'sidebar-list-text';
    const label = document.createElement('div');
    label.className = 'sidebar-list-label';
    label.textContent = listLabel;
    text.appendChild(label);
    if (fileLine) {
      const file = document.createElement('div');
      file.className = 'sidebar-list-file';
      file.textContent = fileLine;
      text.appendChild(file);
    }
    item.appendChild(text);

    if (isBundle) {
      // 사진묶음(전체 사진 폴더)은 열람 방식이 미정이라(docs/decisions.md 9절) 항목만 보여 준다
      const note = document.createElement('div');
      note.className = 'sidebar-list-note';
      note.textContent = '열람 방식 확인 중';
      item.appendChild(note);
      viewer.sidebarList.appendChild(item);
      return;
    }

    if (viewer.listType === 'video') {
      const play = document.createElement('div');
      play.className = 'sidebar-list-play';
      play.textContent = '▶';
      item.appendChild(play);
    }

    item.addEventListener('click', () => showViewerItem(viewer, viewer.listType, i));
    viewer.sidebarList.appendChild(item);
  });
}

function showViewerItem(viewer, type, index) {
  viewer.listType = type;
  viewer.type = type;
  viewer.index = index;
  renderViewerSidebar(viewer);
  loadViewerItem(viewer);
}

function showViewerMessage(viewer, message) {
  viewer.videoFrame.classList.add('hidden');
  viewer.videoFrame.replaceChildren();
  viewer.photoFrame.classList.remove('hidden');
  const status = document.createElement('div');
  status.className = 'photo-frame-status';
  status.textContent = message;
  viewer.photoFrame.replaceChildren(status);
}

function loadViewerItem(viewer) {
  const material = viewer.lists[viewer.type][viewer.index];
  viewer.requestId++;
  const requestId = viewer.requestId;

  const { title, fileLine } = viewer.describe(viewer, viewer.type, viewer.index, material);
  // 여러 칸에 걸친 통녹화는 「자료」 「시작 위치」부터 튼다(2026-11-12). 시각 링크로 들어왔으면 그 시각이 먼저다
  const sheetStart = viewer.type === 'video' && material.start > 0 ? Math.floor(material.start) : 0;
  const startSec = viewer.startTime > 0 ? viewer.startTime : sheetStart;
  viewer.startTime = 0;
  viewer.eyebrow.textContent = viewer.type === 'video' ? '영상' : '사진';
  viewer.title.textContent = title;
  if (viewer.fileName) {
    const startNote = sheetStart > 0 ? `이 수업은 ${formatPlayTime(sheetStart)}부터` : '';
    viewer.fileName.textContent = [fileLine, startNote].filter(Boolean).join(' · ');
  }
  if (viewer.onItemShown) viewer.onItemShown(viewer);

  if (viewer.type === 'video') {
    viewer.photoFrame.classList.add('hidden');
    viewer.photoFrame.replaceChildren();
    viewer.videoFrame.classList.remove('hidden');
    viewer.videoFrame.replaceChildren();
    // 시작 시각이 있으면 그 시각에 맞춰 띄운다(#t=초s, Vimeo 임베드 기본 기능). 재생은 이용자가 누른다
    const start = startSec > 0 ? `#t=${startSec}s` : '';
    const iframe = document.createElement('iframe');
    iframe.src = `${VIMEO_ORIGIN}/video/${encodeURIComponent(material.link)}?title=0&byline=0&portrait=0${start}`;
    iframe.allow = 'autoplay; fullscreen; picture-in-picture';
    iframe.allowFullscreen = true;
    viewer.videoFrame.appendChild(iframe);
    return;
  }

  const showPhoto = src => {
    const img = document.createElement('img');
    img.src = src;
    img.alt = material.fileName || '';
    viewer.photoFrame.replaceChildren(img);
  };

  // 미리 받아 둔 사진은 "불러오는 중"을 거치지 않고 바로 그린다
  const cached = getCachedPhoto(String(material.link));
  if (cached) {
    viewer.videoFrame.classList.add('hidden');
    viewer.videoFrame.replaceChildren();
    viewer.photoFrame.classList.remove('hidden');
    showPhoto(cached);
    return;
  }

  showViewerMessage(viewer, '불러오는 중…');
  loadPhotoSrc(material.link).then(src => {
    if (requestId !== viewer.requestId) return; // 그 사이 다른 자료를 골랐거나 열람기를 닫았음
    showPhoto(src);
  }).catch(() => {
    if (requestId !== viewer.requestId) return;
    showViewerMessage(viewer, '사진을 불러오지 못했습니다.');
  });
}

/* ---------- 모달 열람기 (인물 상세에서 사용) ---------- */
const materialModal = { el: null, closeBtn: null, viewer: null };

function initMaterialModal() {
  if (materialModal.el) return;
  materialModal.el = document.getElementById('material-modal');
  materialModal.closeBtn = document.getElementById('material-modal-close');
  materialModal.viewer = createViewer({
    eyebrow: document.getElementById('material-modal-eyebrow'),
    title: document.getElementById('material-modal-title'),
    videoFrame: document.getElementById('material-video-frame'),
    photoFrame: document.getElementById('material-photo-frame'),
    sidebarHead: document.getElementById('material-sidebar-head'),
    sidebarList: document.getElementById('material-sidebar-list')
  });

  // 인물 상세에서 여는 영상(학생 작품 등)에도 내려받기 단추를 둔다. 닫기 단추 왼쪽에 붙인다.
  const modalActions = document.createElement('div');
  modalActions.className = 'viewer-actions modal-actions hidden';
  const modalToast = document.createElement('div');
  modalToast.className = 'viewer-toast';
  modalToast.setAttribute('role', 'status');
  modalActions.appendChild(modalToast);
  materialModal.closeBtn.before(modalActions);
  const modalDownload = attachDownloadAction(materialModal.viewer, modalActions, modalToast);
  materialModal.viewer.onItemShown = v => {
    modalActions.classList.toggle('hidden', v.type !== 'video' || !modalDownload.available());
    modalDownload.reset();
  };

  materialModal.closeBtn.addEventListener('click', closeMaterialModal);
  materialModal.el.addEventListener('click', e => { if (e.target === materialModal.el) closeMaterialModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !materialModal.el.classList.contains('hidden')) closeMaterialModal(); });
}

function closeMaterialModal() {
  if (!materialModal.el) return;
  materialModal.el.classList.add('hidden');
  clearViewer(materialModal.viewer);
}

function openMaterialModal(type, items, startIndex) {
  initMaterialModal();
  const viewer = materialModal.viewer;
  viewer.lists = { video: type === 'video' ? items : [], photo: type === 'photo' ? items : [] };
  showViewerItem(viewer, type, startIndex >= 0 ? startIndex : 0);
  materialModal.el.classList.remove('hidden');
}

/* ---------- 화면 안 열람기 (수업 자료 화면, 2026-10-07 결정) ---------- */
let sessionViewer = null;

// 다른 화면으로 옮기거나 로그아웃할 때 부른다. 숨긴 화면에 플레이어가 남으면 소리가 계속 나고, 사진이 DOM에 남는다.
function clearSessionViewer() {
  if (!sessionViewer) return;
  clearViewer(sessionViewer);
  sessionViewer.sidebarList.replaceChildren();
  sessionViewer = null;
}

// 제목은 파일명 대신 수업명(「오프닝」)으로 보여 주고, 파일명은 아래에 작게 남긴다(2026-10-07).
// 파일명은 원본 찾기표에서 하드의 원본 위치를 찾는 열쇠라 화면에서 없애지 않는다(docs/decisions.md 9절).
// 「소제목」(반·악기 이름)이 있으면 그 이름 안에서 번호를 매긴다: 「전공실기 · 해금2 · 영상 1」(2026-10-08).
function describeBySession(className) {
  return (viewer, type, index, material) => {
    if (material.type === '사진묶음') return { title: className, listLabel: '사진묶음', fileLine: material.fileName || '' };
    const typeKr = type === 'video' ? '영상' : '사진';
    const list = viewer.lists[type];
    const sub = material.subtitle || '';
    const group = list.filter(m => (m.subtitle || '') === sub);
    const numbered = `${typeKr} ${group.indexOf(material) + 1}`;
    let label = numbered;
    if (sub) label = group.length > 1 ? `${sub} · ${numbered}` : sub;
    return {
      title: list.length > 1 || sub ? `${className} · ${label}` : className,
      listLabel: label,
      fileLine: material.fileName || ''
    };
  };
}

/* ---------- 영상 내려받기 (2026-11-03, docs/api.md 3-6) ----------
   「접근코드」의 「내려받기」가 허용인 코드만 단추가 보인다(data 응답의 canDownload). 단추를 누르면 관문이
   Vimeo에서 화질별 내려받기 링크를 받아 오고, 고른 화질을 브라우저가 파일로 저장한다. 링크는 24시간 뒤 만료.
   허용 여부는 관문이 요청마다 다시 확인한다 — 화면의 canDownload는 단추를 보일지만 정한다. */
const DOWNLOAD_ERROR_MESSAGE = {
  DOWNLOAD_NOT_ALLOWED: '이 접근코드는 내려받기가 허용되지 않았습니다.',
  NOT_FOUND: '내려받을 파일이 없습니다. 영상 변환이 끝나지 않았을 수 있습니다.',
  VIMEO_ERROR: 'Vimeo 연결에 문제가 있습니다. 잠시 후 다시 해 주세요.',
  NETWORK_ERROR: '연결에 실패했습니다. 잠시 후 다시 해 주세요.',
  TIMEOUT: '응답이 늦습니다. 잠시 후 다시 해 주세요.'
};

function canDownloadVideos() {
  return !!(AppState.data && AppState.data.canDownload);
}

function formatFileSize(bytes) {
  if (!(bytes > 0)) return '';
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}

function startFileDownload(url) {
  // Vimeo 내려받기 링크는 「파일로 저장」 머리글을 주므로 지금 화면을 벗어나지 않는다
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// actions(단추 칸)에 「내려받기」 단추와 화질 목록을 붙인다. reset()은 다른 자료로 넘어갈 때 목록을 닫는다.
function attachDownloadAction(viewer, actions, toast) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ghost-btn';
  btn.textContent = '내려받기';
  const menu = document.createElement('div');
  menu.className = 'download-menu hidden';
  menu.setAttribute('role', 'menu');
  actions.insertBefore(btn, toast);
  actions.appendChild(menu);

  let requestNo = 0;
  const close = () => { menu.classList.add('hidden'); btn.setAttribute('aria-expanded', 'false'); };
  const refreshVisible = () => btn.classList.toggle('hidden', !canDownloadVideos());
  refreshVisible();

  const showMenu = (...children) => {
    menu.replaceChildren(...children);
    menu.classList.remove('hidden');
    btn.setAttribute('aria-expanded', 'true');
  };
  const note = text => {
    const div = document.createElement('div');
    div.className = 'download-menu-note';
    div.textContent = text;
    return div;
  };

  btn.addEventListener('click', async () => {
    if (!menu.classList.contains('hidden')) { close(); return; }
    const material = viewer.type === 'video' ? viewer.lists.video[viewer.index] : null;
    if (!material || !material.link) return;
    const no = ++requestNo;
    showMenu(note('화질 목록을 받는 중…'));
    let result;
    try {
      result = await api.download(getToken(), material.link);
    } catch (e) {
      if (no !== requestNo) return;
      if (e.code === 'TOKEN_EXPIRED' || e.code === 'TOKEN_INVALID') { logout(); return; }
      if (e.code === 'DOWNLOAD_NOT_ALLOWED' && AppState.data) { AppState.data.canDownload = false; refreshVisible(); }
      close();
      showToast(toast, DOWNLOAD_ERROR_MESSAGE[e.code] || '내려받기를 준비하지 못했습니다. 잠시 후 다시 해 주세요.');
      return;
    }
    if (no !== requestNo) return;

    const head = note('화질을 고르면 파일로 저장됩니다.');
    const items = result.files.map(f => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'download-menu-item';
      item.setAttribute('role', 'menuitem');
      const label = document.createElement('span');
      label.className = 'download-menu-label';
      label.textContent = f.label + (f.label === '원본' && f.height ? ` (${f.height}p)` : '');
      const size = document.createElement('span');
      size.className = 'download-menu-size';
      size.textContent = formatFileSize(f.size) || f.sizeText || '';
      item.append(label, size);
      item.addEventListener('click', () => {
        startFileDownload(f.link);
        close();
        showToast(toast, '내려받기를 시작했습니다.');
      });
      return item;
    });
    const foot = note('받은 파일은 외부 유출·재배포를 금지합니다.');
    showMenu(head, ...items, foot);
  });

  // 목록 밖을 누르거나 Esc를 누르면 닫는다
  document.addEventListener('click', e => {
    if (!menu.classList.contains('hidden') && !actions.contains(e.target)) close();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

  return {
    reset() { requestNo++; close(); refreshVisible(); },
    available: canDownloadVideos
  };
}

// 「현재 시각 링크 복사」: 지금 보고 있는 영상과 재생 시각을 붙인 사이트 주소를 복사한다(2026-10-07).
// 받은 사람도 접근코드로 로그인해야 열리고, 로그인 뒤 이 주소로 이어진다(app.js enterApp).
async function copyTimeLink(viewer, routeBase, toast) {
  const iframe = viewer.videoFrame.querySelector('iframe');
  if (!iframe || viewer.type !== 'video') return;
  let seconds = null;
  try { seconds = await requestVimeoCurrentTime(iframe); } catch (e) { /* 시각 없이 영상 링크만 복사 */ }

  const params = new URLSearchParams({ v: String(viewer.index + 1) });
  if (seconds > 0) params.set('t', String(seconds));
  const url = `${location.origin}${location.pathname}#${routeBase}?${params}`;
  const copied = await copyText(url);

  if (!copied) showToast(toast, '복사하지 못했습니다. 다시 눌러 주세요.');
  else if (seconds === null) showToast(toast, '재생 시각을 읽지 못해 영상 처음 링크를 복사했습니다.');
  else showToast(toast, `${formatPlayTime(seconds)} 시점 링크를 복사했습니다.`);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    // 클립보드 권한이 막힌 브라우저용 예비 방법
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
    area.remove();
    return ok;
  }
}

function showToast(toast, message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toast.hideTimer);
  toast.hideTimer = setTimeout(() => toast.classList.remove('show'), 2500);
}

// options: { routeBase: '/music/workshop/세션ID', className, startVideo: 0부터, startTime: 초 }
function buildSessionViewer(videoItems, photoItems, options) {
  const panel = document.createElement('div');
  panel.className = 'viewer-panel';

  // 가운데 머리말·재생 칸은 모달과 같은 모양을 쓴다
  const main = document.createElement('div');
  main.className = 'viewer-main';
  const head = document.createElement('div');
  head.className = 'modal-head';
  const headText = document.createElement('div');
  headText.className = 'viewer-head-text';
  const eyebrow = document.createElement('div');
  eyebrow.className = 'modal-eyebrow';
  const title = document.createElement('div');
  title.className = 'modal-title';
  const fileName = document.createElement('div');
  fileName.className = 'viewer-file';
  headText.append(eyebrow, title, fileName);

  const actions = document.createElement('div');
  actions.className = 'viewer-actions hidden';
  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'ghost-btn';
  copyBtn.textContent = '현재 시각 링크 복사';
  const toast = document.createElement('div');
  toast.className = 'viewer-toast';
  toast.setAttribute('role', 'status');
  actions.append(copyBtn, toast);
  head.append(headText, actions);
  const videoFrame = document.createElement('div');
  videoFrame.className = 'video-frame hidden';
  const photoFrame = document.createElement('div');
  photoFrame.className = 'photo-frame hidden';
  main.append(head, videoFrame, photoFrame);

  const sidebar = document.createElement('div');
  sidebar.className = 'viewer-sidebar';
  const sidebarInner = document.createElement('div');
  sidebarInner.className = 'viewer-sidebar-inner';
  const sidebarHead = document.createElement('div');
  sidebarHead.className = 'sidebar-head';
  const sidebarList = document.createElement('div');
  sidebarList.className = 'viewer-sidebar-list';
  sidebarInner.append(sidebarHead, sidebarList);
  sidebar.appendChild(sidebarInner);

  panel.append(createBrackets(), main, sidebar);

  const viewer = createViewer({ eyebrow, title, fileName, videoFrame, photoFrame, sidebarHead, sidebarList });
  viewer.lists = { video: videoItems, photo: photoItems };
  viewer.describe = describeBySession(options.className);
  // 링크 복사 버튼은 가운데에 영상이 떠 있을 때만 보인다
  const download = attachDownloadAction(viewer, actions, toast);
  viewer.onItemShown = v => {
    actions.classList.toggle('hidden', v.type !== 'video');
    download.reset();
  };
  copyBtn.addEventListener('click', () => copyTimeLink(viewer, options.routeBase, toast));

  // 첫 영상을 띄우고(자동 재생은 하지 않음), 영상이 없으면 첫 사진을 띄운다.
  // 시각 링크로 들어왔으면 그 영상을 그 시각에 맞춰 띄운다.
  const firstPhoto = photoItems.findIndex(m => m.type !== '사진묶음');
  const linkedVideo = options.startVideo >= 0 && options.startVideo < videoItems.length ? options.startVideo : -1;
  if (linkedVideo >= 0) {
    viewer.startTime = options.startTime > 0 ? options.startTime : 0;
    showViewerItem(viewer, 'video', linkedVideo);
  } else if (videoItems.length > 0) {
    showViewerItem(viewer, 'video', 0);
  } else if (firstPhoto >= 0) {
    showViewerItem(viewer, 'photo', firstPhoto);
  } else {
    // 사진묶음만 있는 수업
    viewer.listType = 'photo';
    renderViewerSidebar(viewer);
    eyebrow.textContent = '사진';
    showViewerMessage(viewer, '사진묶음은 열람 방식을 확인하고 있습니다.');
  }

  sessionViewer = viewer;
  return panel;
}

/* ---------- 화면 진입 ---------- */
function renderMaterialsView(discipline, program, sessionId, query) {
  const disciplineInfo = DISCIPLINE_INFO[discipline];
  const disciplineKr = Object.keys(DISCIPLINE_SLUG).find(k => DISCIPLINE_SLUG[k] === discipline);
  const programInfo = PROGRAM_INFO.find(p => p.slug === program);
  if (!disciplineInfo || !programInfo) { navigate('#/'); return; }

  const el = document.getElementById('view-materials');
  clearSessionViewer();
  el.replaceChildren();

  if (!AppState.data) {
    el.appendChild(renderMaterialsEmptyState('불러오는 중', '자료를 불러오는 중입니다.'));
    showView('view-materials');
    updateDisciplineSwitcher(discipline);
    return;
  }

  const session = AppState.data.sessions.find(s => s.sessionId === sessionId && s.discipline === disciplineKr && s.program === programInfo.name);

  // 일정표뿐 아니라 인물 상세의 "참여 클래스"·검색의 "수업"에서도 들어올 수 있어
  // 항상 일정표로 고정하지 않고, 실제 들어온 경로로 돌아가게 브라우저 히스토리를 따른다.
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'schedule-back-btn';
  back.setAttribute('aria-label', '뒤로 가기');
  back.textContent = '←';
  back.addEventListener('click', () => window.history.back());

  if (!session) {
    const header = document.createElement('div');
    header.className = 'materials-header';
    header.append(back);
    el.append(header, renderMaterialsEmptyState('세션을 찾을 수 없습니다', '일정표에서 다시 선택해 주세요.'));
    showView('view-materials');
    updateDisciplineSwitcher(discipline);
    return;
  }

  const { location } = parseNote(session.note);
  const header = document.createElement('div');
  header.className = 'materials-header';

  const titleWrap = document.createElement('div');
  titleWrap.className = 'materials-title-wrap';
  const eyebrow = document.createElement('div');
  eyebrow.className = 'materials-eyebrow';
  eyebrow.textContent = `${session.date} · ${session.startTime}–${session.endTime}`;
  const title = document.createElement('div');
  title.className = 'materials-title';
  title.textContent = session.className;
  const sub = document.createElement('div');
  sub.className = 'materials-sub';
  sub.textContent = [session.instructor, location].filter(Boolean).join(' · ');
  titleWrap.append(eyebrow, title, sub);
  header.append(back, titleWrap);

  const participants = AppState.data.participants.filter(p => p.sessionId === sessionId);
  const participantsWrap = document.createElement('div');
  participantsWrap.className = 'materials-participants';
  participants.forEach(p => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'participant-chip';
    chip.textContent = p.name;
    chip.addEventListener('click', () => navigate(`#/person/${encodeURIComponent(p.studentId || p.name)}`));
    participantsWrap.appendChild(chip);
  });

  const materials = AppState.data.materials.filter(m => m.sessionId === sessionId);
  const videoItems = materials.filter(m => m.type === '영상');
  const photoItems = materials.filter(m => m.type === '사진' || m.type === '사진묶음');

  el.append(header);
  if (participants.length > 0) el.append(participantsWrap);

  if (videoItems.length === 0 && photoItems.length === 0) {
    el.appendChild(renderMaterialsEmptyState('영상 준비중', '아직 등록된 영상·사진이 없습니다.'));
  } else {
    // 이 수업의 사진을 뒤에서 한 번에 받아 둔다(인물 상세에서는 하지 않음 — 사진이 많음).
    // 열람기보다 먼저 보내야, 첫 사진을 띄울 때 한 장 요청을 따로 보내지 않고 이 묶음을 기다린다.
    prefetchSessionPhotos(sessionId, photoItems);
    const routeBase = `/${discipline}/${program}/${encodeURIComponent(sessionId)}`;
    // 시각 링크(?v=영상 순번&t=초)로 들어온 경우. 숫자가 아니면 무시하고 첫 영상을 띄운다
    const params = new URLSearchParams(query || '');
    const startVideo = parseInt(params.get('v'), 10) - 1;
    const startTime = parseInt(params.get('t'), 10);
    el.appendChild(buildSessionViewer(videoItems, photoItems, {
      routeBase,
      className: session.className,
      startVideo: Number.isNaN(startVideo) ? -1 : startVideo,
      startTime: Number.isNaN(startTime) ? 0 : startTime
    }));
    // 적용한 뒤에는 주소창을 수업 주소로 되돌린다. 남겨 두면 다른 영상을 보다 새로고침해도 링크 시각으로 돌아간다
    if (query) history.replaceState(null, '', `#${routeBase}`);
  }

  showView('view-materials');
  updateDisciplineSwitcher(discipline);
}

registerRoute(
  /^\/(?<discipline>music|dance|trad|art)\/(?<program>workshop|mentoring|camp)\/(?<sessionId>[^/?]+)(?:\?(?<query>.*))?$/,
  ({ discipline, program, sessionId, query }) => renderMaterialsView(discipline, program, decodeURIComponent(sessionId), query)
);
