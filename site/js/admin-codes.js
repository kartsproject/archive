/**
 * 관리자 페이지 [접근코드] 탭 (docs/admin.md 5절, WBS 5.2).
 * 목록 · 추가 · 수정 · 정지 · 접속 끊기. 검사는 화면에서 한 번 하지만 최종 판단은 관문(AdminCodes.js)이 한다.
 * 다른 탭 파일과 이름이 겹치지 않게 전체를 함수 안에 둔다.
 */
(() => {
  const FIRST_VIEWS = ['분야 선택', '음악', '무용', '전통예술', '미술'];
  const TARGET_SUGGESTIONS = ['운영진', '음악', '무용', '전통예술', '미술', '발주기관'];
  const STATUS_VALUES = ['사용', '정지'];
  const ROLE_VALUES = ['열람', '관리자'];
  const TARGET_SLUG = { '운영진': 'STAFF', '음악': 'MUSIC', '무용': 'DANCE', '전통예술': 'TRAD', '미술': 'ART' };
  const SAFE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 헷갈리는 0 O 1 I L 제외 (docs/admin.md 5절)
  const CODE_PATTERN = /^[A-Z0-9-]{4,20}$/;
  const ADMIN_CODE_MIN_LENGTH = 12;
  // 화면에 보여 주고 고칠 수 있는 열. 버전은 [접속 끊기]·코드 변경으로만 바뀐다.
  const EDIT_FIELDS = ['코드', '이름', '배포 대상', '첫 화면', '사용기한', '상태', '권한', '비고'];

  const state = { headers: [], rows: [], currentCode: '', loaded: false, busy: false };
  let tableArea = null;

  registerAdminTab('codes', { render, onShow });

  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    Object.entries(props).forEach(([key, value]) => {
      if (key === 'text') node.textContent = value;
      else if (key === 'className') node.className = value;
      else if (key === 'on') Object.entries(value).forEach(([ev, fn]) => node.addEventListener(ev, fn));
      else node[key] = value;
    });
    children.flat().forEach(child => { if (child != null) node.append(child); });
    return node;
  }

  // 로그아웃하면 탭을 처음부터 다시 그리므로(admin-app.js) 받아 둔 목록도 여기서 버린다.
  function render(container) {
    Object.assign(state, { headers: [], rows: [], currentCode: '', loaded: false, busy: false });
    tableArea = el('div');
    container.append(
      el('h2', { className: 'admin-section-title', text: '접근코드' }),
      el('p', {
        className: 'admin-section-desc',
        text: '주체(기관·담당)마다 코드를 따로 만들어 나눠 주면 접속 기록에서 누가 들어왔는지 구분할 수 있습니다. 코드는 지우지 않고 정지합니다.'
      }),
      el('div', { className: 'admin-toolbar' },
        el('button', { className: 'admin-btn primary', type: 'button', text: '+ 새 코드', on: { click: () => openCodeForm(null) } }),
        el('div', { className: 'spacer' }),
        el('button', { className: 'admin-btn', type: 'button', text: '새로고침', on: { click: loadCodes } })
      ),
      tableArea,
      el('p', {
        className: 'admin-notice',
        text: '「접속 끊기」는 그 코드로 들어와 있는 사람을 모두 로그아웃시킵니다. 코드는 그대로 쓸 수 있어 다시 로그인하면 됩니다. 지금 로그인한 코드는 이 화면에서 정지·권한 변경·접속 끊기를 할 수 없습니다.'
      })
    );
  }

  function onShow() {
    if (!state.loaded) loadCodes();
  }

  async function loadCodes() {
    tableArea.replaceChildren(el('div', { className: 'admin-loading', text: '불러오는 중…' }));
    try {
      const result = await adminCall('adminCodes');
      state.headers = result.headers;
      state.rows = result.rows;
      state.currentCode = result.currentCode;
      state.loaded = true;
      renderTable();
    } catch (e) {
      tableArea.replaceChildren(adminPlaceholder(adminErrorMessage(e)));
    }
  }

  function shownFields() {
    return EDIT_FIELDS.filter(f => state.headers.includes(f));
  }

  function todayText() {
    return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
  }

  function renderTable() {
    if (state.rows.length === 0) {
      tableArea.replaceChildren(adminPlaceholder('등록된 접근코드가 없습니다.'));
      return;
    }
    const fields = shownFields();
    const today = todayText();
    const head = el('tr', {}, fields.map(f => el('th', { text: f === '이름' ? '이름(주체)' : f })), el('th', { text: '버전' }), el('th', { text: '' }));
    const body = state.rows.map(row => {
      const isSelf = row['코드'] === state.currentCode;
      const cells = fields.map(f => el('td', {}, cellContent(f, row, today, isSelf)));
      const actions = el('td', { className: 'codes-actions' },
        el('button', { className: 'admin-btn', type: 'button', text: '수정', on: { click: () => openCodeForm(row) } }),
        el('button', {
          className: 'admin-btn danger', type: 'button', text: '접속 끊기', disabled: isSelf,
          title: isSelf ? '지금 로그인한 코드입니다' : '',
          on: { click: () => revokeCode(row) }
        })
      );
      return el('tr', { className: isSelf ? 'codes-self' : '' }, cells, el('td', { className: 'num', text: row['버전'] || '' }), actions);
    });
    tableArea.replaceChildren(
      el('div', { className: 'admin-table-wrap' },
        el('table', { className: 'admin-table codes-table' }, el('thead', {}, head), el('tbody', {}, body))
      )
    );
  }

  function cellContent(field, row, today, isSelf) {
    const value = row[field] || '';
    if (field === '코드') {
      return el('div', { className: 'codes-code' },
        el('span', { className: 'mono', text: value }),
        el('button', { className: 'codes-copy', type: 'button', text: '복사', on: { click: () => copyCode(value) } }),
        isSelf ? el('span', { className: 'admin-badge ok', text: '지금 로그인' }) : null
      );
    }
    if (field === '상태') return el('span', { className: `admin-badge ${value === '사용' ? 'ok' : 'warn'}`, text: value || '—' });
    if (field === '권한') return value === '관리자' ? el('span', { className: 'admin-badge ok', text: '관리자' }) : el('span', { text: value || '열람' });
    if (field === '사용기한') {
      const expired = value && value < today;
      return el('span', {}, value, expired ? el('span', { className: 'admin-badge warn codes-expired', text: '기한 지남' }) : null);
    }
    return value;
  }

  async function copyCode(code) {
    try {
      await navigator.clipboard.writeText(code);
      showAdminToast('코드를 복사했습니다.');
    } catch (e) {
      showAdminToast('복사하지 못했습니다. 코드를 직접 선택해 복사해 주세요.', 'error');
    }
  }

  /* ---------- 추가·수정 양식 ---------- */

  function generateCode(target, role) {
    const random = n => {
      const bytes = crypto.getRandomValues(new Uint8Array(n));
      return Array.from(bytes, b => SAFE_CHARS[b % SAFE_CHARS.length]).join('');
    };
    if (role === '관리자') return `KA-ADMIN-${random(6)}`;
    return `KA-${TARGET_SLUG[target] || 'CODE'}-${random(4)}`;
  }

  function selectWith(values, current) {
    const options = values.includes(current) || !current ? values : [current, ...values];
    const select = el('select', { className: 'admin-select' }, options.map(v => el('option', { value: v, text: v })));
    select.value = current || values[0];
    return select;
  }

  function field(label, input, hint) {
    return el('label', { className: 'admin-field codes-form-field' },
      el('span', { text: label }), input, hint ? el('span', { className: 'codes-form-hint', text: hint }) : null);
  }

  // row가 null이면 새 코드
  async function openCodeForm(row) {
    if (state.busy) return;
    const isNew = !row;
    const isSelf = !isNew && row['코드'] === state.currentCode;
    const fields = shownFields();
    const v = isNew
      ? { '코드': '', '이름': '', '배포 대상': '', '첫 화면': '분야 선택', '사용기한': '', '상태': '사용', '권한': '열람', '비고': '' }
      : row;

    const inputs = {};
    inputs['이름'] = el('input', { className: 'admin-input', value: v['이름'] || '', maxLength: 40, placeholder: '예: ○○재단 담당자' });
    inputs['배포 대상'] = el('input', { className: 'admin-input', value: v['배포 대상'] || '', maxLength: 20 });
    inputs['배포 대상'].setAttribute('list', 'codes-target-list');
    inputs['첫 화면'] = selectWith(FIRST_VIEWS, v['첫 화면']);
    inputs['사용기한'] = el('input', { className: 'admin-input', type: 'date', value: v['사용기한'] || '' });
    inputs['상태'] = selectWith(STATUS_VALUES, v['상태']);
    inputs['권한'] = selectWith(ROLE_VALUES, v['권한'] || '열람');
    inputs['비고'] = el('input', { className: 'admin-input', value: v['비고'] || '', maxLength: 200 });
    inputs['코드'] = el('input', { className: 'admin-input mono', value: v['코드'] || '', maxLength: 20, autocomplete: 'off' });

    // 새 코드는 무작위 코드를 미리 넣어 두고, 사람이 직접 고치기 전까지는 대상·권한에 맞춰 다시 만든다.
    let codeTouched = !isNew;
    const regenerate = () => { inputs['코드'].value = generateCode(inputs['배포 대상'].value.trim(), inputs['권한'].value); };
    if (isNew) regenerate();
    inputs['코드'].addEventListener('input', () => {
      codeTouched = true;
      const pos = inputs['코드'].selectionStart;
      inputs['코드'].value = convertHangulToEnglish(inputs['코드'].value).toUpperCase();
      inputs['코드'].setSelectionRange(pos, pos);
    });
    ['배포 대상', '권한'].forEach(k => inputs[k].addEventListener('change', () => { if (!codeTouched) regenerate(); }));

    if (isSelf) ['코드', '상태', '권한'].forEach(k => { inputs[k].disabled = true; });

    const codeRow = el('div', { className: 'codes-code-input' }, inputs['코드'],
      isNew ? el('button', { className: 'admin-btn', type: 'button', text: '다시 만들기', on: { click: () => { codeTouched = false; regenerate(); } } }) : null);

    const hints = {
      '코드': isSelf ? '지금 로그인한 코드라 바꿀 수 없습니다.' : '대문자·숫자·-만, 4~20자. 관리자 코드는 12자 이상.' + (isNew ? '' : ' 바꾸면 기존 접속이 끊깁니다.'),
      '이름': '누구에게 준 코드인지 적습니다. 접속 기록에 함께 보입니다.',
      '첫 화면': '로그인하면 처음 보이는 화면입니다.'
    };
    const form = el('div', { className: 'codes-form' },
      el('datalist', { id: 'codes-target-list' }, TARGET_SUGGESTIONS.map(t => el('option', { value: t }))),
      fields.map(f => field(f === '이름' ? '이름(주체)' : f, f === '코드' ? codeRow : inputs[f], hints[f]))
    );

    const collect = () => {
      const values = {};
      fields.forEach(f => { values[f] = inputs[f].value.trim(); });
      values['코드'] = values['코드'].toUpperCase();
      return values;
    };

    const validate = () => {
      const values = collect();
      if (!values['이름']) return '이름(주체)을 입력해 주세요.';
      if (!CODE_PATTERN.test(values['코드'])) return '코드는 대문자·숫자·-만 써서 4~20자로 만들어 주세요.';
      if (values['권한'] === '관리자' && values['코드'].length < ADMIN_CODE_MIN_LENGTH) return `관리자 코드는 ${ADMIN_CODE_MIN_LENGTH}자 이상이어야 합니다.`;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(values['사용기한'])) return '사용기한을 골라 주세요.';
      const duplicate = state.rows.some(r => r !== row && String(r['코드']).toUpperCase() === values['코드']);
      if (duplicate) return '이미 있는 코드입니다.';
      return '';
    };

    const ok = await openAdminDialog({
      title: isNew ? '새 접근코드' : '접근코드 수정',
      body: form,
      okLabel: isNew ? '만들기' : '저장',
      validate
    });
    if (!ok) return;

    const values = collect();
    if (isNew) {
      await save({ mode: 'add', fields: values }, `코드를 만들었습니다: ${values['코드']}`);
      return;
    }
    const changes = {};
    fields.forEach(f => { if ((row[f] || '') !== values[f]) changes[f] = values[f]; });
    if (Object.keys(changes).length === 0) { showAdminToast('바뀐 내용이 없습니다.'); return; }
    const message = '코드' in changes ? '저장했습니다. 코드가 바뀌어 기존 접속은 끊겼습니다.' : '저장했습니다.';
    await save({ mode: 'update', row: row._row, before: beforeOf(row), changes }, message);
  }

  // 저장 직전 확인용: 화면이 읽었던 값 그대로(행 번호 제외)
  function beforeOf(row) {
    const before = { ...row };
    delete before._row;
    return before;
  }

  async function save(payload, successMessage) {
    state.busy = true;
    try {
      await adminCall('adminCodeSave', payload, { write: true });
      showAdminToast(successMessage);
    } catch (e) {
      showAdminToast(adminErrorMessage(e, { write: true }), 'error');
    } finally {
      state.busy = false;
    }
    if (getAdminToken()) loadCodes(); // 성공이든 실패든 시트의 지금 모습으로 다시 그린다
  }

  async function revokeCode(row) {
    if (state.busy) return;
    const ok = await openAdminDialog({
      title: '접속 끊기',
      body: `「${row['이름'] || ''}」 코드(${row['코드']})로 들어와 있는 사람을 모두 로그아웃시킵니다.\n코드는 그대로 쓸 수 있어 다시 로그인하면 됩니다.`,
      okLabel: '접속 끊기',
      danger: true
    });
    if (!ok) return;
    state.busy = true;
    try {
      await adminCall('adminCodeRevoke', { row: row._row, before: beforeOf(row) }, { write: true });
      showAdminToast('접속을 끊었습니다.');
    } catch (e) {
      showAdminToast(adminErrorMessage(e, { write: true }), 'error');
    } finally {
      state.busy = false;
    }
    if (getAdminToken()) loadCodes();
  }
})();
