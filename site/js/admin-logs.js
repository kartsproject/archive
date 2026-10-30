/**
 * 관리자 페이지 [접속 기록] 탭 (docs/admin.md 6절, WBS 5.3).
 * 기간을 정해 관문에서 받고(AdminLogs.js), 코드·결과·구분 거르기와 요약·CSV는 화면에서 한다.
 * 다른 탭 파일과 이름이 겹치지 않게 전체를 함수 안에 둔다.
 */
(() => {
  const REQUEST_LABEL = { auth: '열람 로그인', adminAuth: '관리자 로그인' };
  const FAIL_LABEL = { AUTH_INVALID: '코드 오류', AUTH_EXPIRED: '기한 지남', AUTH_LOCKED: '잠김' };
  const UNKNOWN_CODE = '(등록되지 않은 코드)';

  const state = { rows: [], codeLabels: {}, from: '', to: '', truncated: false, loaded: false };
  const filters = { code: '', result: 'all', kind: 'all' };
  let ui = {};

  registerAdminTab('logs', { render, onShow });

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

  const dateText = d => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(d);
  const timeText = ms => new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).format(new Date(ms));
  const daysAgo = n => dateText(new Date(Date.now() - n * 86400000));

  // 로그아웃하면 탭을 처음부터 다시 그리므로(admin-app.js) 받아 둔 기록도 여기서 버린다.
  function render(container) {
    Object.assign(state, { rows: [], codeLabels: {}, from: '', to: '', truncated: false, loaded: false });
    Object.assign(filters, { code: '', result: 'all', kind: 'all' });

    ui.from = el('input', { className: 'admin-input', type: 'date', value: daysAgo(6) });
    ui.to = el('input', { className: 'admin-input', type: 'date', value: daysAgo(0) });
    ui.code = el('select', { className: 'admin-select', on: { change: () => { filters.code = ui.code.value; renderList(); } } });
    ui.result = el('select', { className: 'admin-select', on: { change: () => { filters.result = ui.result.value; renderList(); } } },
      el('option', { value: 'all', text: '전체' }), el('option', { value: 'ok', text: '성공만' }), el('option', { value: 'fail', text: '실패만' }));
    ui.kind = el('select', { className: 'admin-select', on: { change: () => { filters.kind = ui.kind.value; renderList(); } } },
      el('option', { value: 'all', text: '전체' }), el('option', { value: 'auth', text: '열람 로그인' }), el('option', { value: 'adminAuth', text: '관리자 로그인' }));
    ui.summary = el('div');
    ui.list = el('div');
    ui.count = el('span', { className: 'logs-count' });
    ui.status = el('div');

    const quick = (label, days) => el('button', {
      className: 'admin-btn', type: 'button', text: label,
      on: { click: () => { ui.from.value = daysAgo(days - 1); ui.to.value = daysAgo(0); loadLogs(); } }
    });

    container.append(
      el('h2', { className: 'admin-section-title', text: '접속 기록' }),
      el('p', { className: 'admin-section-desc', text: '누가 언제 로그인했는지 봅니다. 코드의 이름(주체)과 로그인 때 입력한 이름이 함께 나옵니다.' }),
      el('div', { className: 'admin-toolbar' },
        el('label', { className: 'admin-field' }, el('span', { text: '시작일' }), ui.from),
        el('label', { className: 'admin-field' }, el('span', { text: '종료일' }), ui.to),
        el('button', { className: 'admin-btn primary', type: 'button', text: '조회', on: { click: loadLogs } }),
        quick('오늘', 1), quick('7일', 7), quick('30일', 30)
      ),
      ui.status,
      el('h3', { className: 'logs-subtitle', text: '코드별 요약' }),
      ui.summary,
      el('h3', { className: 'logs-subtitle', text: '기록' }),
      el('div', { className: 'admin-toolbar' },
        el('label', { className: 'admin-field' }, el('span', { text: '코드' }), ui.code),
        el('label', { className: 'admin-field' }, el('span', { text: '결과' }), ui.result),
        el('label', { className: 'admin-field' }, el('span', { text: '구분' }), ui.kind),
        el('div', { className: 'spacer' }),
        ui.count,
        el('button', { className: 'admin-btn', type: 'button', text: 'CSV 내려받기', on: { click: downloadCsv } })
      ),
      ui.list,
      el('p', {
        className: 'admin-notice',
        text: '「입력한 이름」은 이용자가 로그인할 때 직접 적은 값이라 본인 확인이 된 이름이 아닙니다. 지금은 로그인 기록만 남고, 영상을 본 기록은 남지 않습니다.'
      })
    );
  }

  function onShow() {
    if (!state.loaded) loadLogs();
  }

  async function loadLogs() {
    if (ui.from.value && ui.to.value && ui.from.value > ui.to.value) {
      showAdminToast('시작일이 종료일보다 늦습니다.', 'error');
      return;
    }
    ui.status.replaceChildren(el('div', { className: 'admin-loading', text: '불러오는 중…' }));
    ui.summary.replaceChildren();
    ui.list.replaceChildren();
    try {
      const result = await adminCall('adminLogs', { from: ui.from.value, to: ui.to.value });
      Object.assign(state, { rows: result.rows, codeLabels: result.codeLabels, from: result.from, to: result.to, truncated: result.truncated, loaded: true });
      ui.from.value = result.from;
      ui.to.value = result.to;
      ui.status.replaceChildren(state.truncated
        ? el('p', { className: 'admin-notice logs-warn', text: '기록이 많아 최근 2,000줄만 보여 줍니다. 기간을 줄여 다시 조회해 주세요.' })
        : '');
      renderCodeFilter();
      renderSummary();
      renderList();
    } catch (e) {
      ui.status.replaceChildren(adminPlaceholder(adminErrorMessage(e)));
    }
  }

  const isKnown = code => Object.prototype.hasOwnProperty.call(state.codeLabels, code);
  const labelOf = code => (isKnown(code) ? state.codeLabels[code] : '');
  const isSuccess = row => row.result === '성공';
  const resultText = row => {
    if (isSuccess(row)) return '성공';
    const m = /^실패\((.+)\)$/.exec(row.result);
    return m ? `실패 · ${FAIL_LABEL[m[1]] || m[1]}` : row.result;
  };

  function renderCodeFilter() {
    const codes = [...new Set(state.rows.map(r => r.code))].filter(isKnown).sort();
    ui.code.replaceChildren(
      el('option', { value: '', text: '전체' }),
      codes.map(c => el('option', { value: c, text: labelOf(c) ? `${labelOf(c)} (${c})` : c })),
      el('option', { value: UNKNOWN_CODE, text: UNKNOWN_CODE })
    );
    if (filters.code && filters.code !== UNKNOWN_CODE && !codes.includes(filters.code)) filters.code = '';
    ui.code.value = filters.code;
  }

  // 등록되지 않은 코드(오타·무작위 시도)는 입력값을 요약에 늘어놓지 않고 한 줄로 묶는다.
  function renderSummary() {
    const groups = new Map();
    state.rows.forEach(row => {
      const key = isKnown(row.code) ? row.code : UNKNOWN_CODE;
      if (!groups.has(key)) groups.set(key, { ok: 0, fail: 0, last: 0, devices: new Set(), names: new Set() });
      const g = groups.get(key);
      if (isSuccess(row)) {
        g.ok++;
        g.last = Math.max(g.last, row.time);
        if (row.device) g.devices.add(row.device);
        if (row.name) g.names.add(row.name);
      } else {
        g.fail++;
      }
    });
    if (groups.size === 0) { ui.summary.replaceChildren(adminPlaceholder('이 기간에는 기록이 없습니다.')); return; }

    const entries = [...groups.entries()].sort((a, b) => b[1].last - a[1].last);
    const namesText = set => {
      const names = [...set];
      return names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} 외 ${names.length - 3}명`;
    };
    ui.summary.replaceChildren(el('div', { className: 'admin-table-wrap' },
      el('table', { className: 'admin-table' },
        el('thead', {}, el('tr', {}, ['이름(주체)', '코드', '로그인', '실패', '마지막 접속', '기기 수', '입력한 이름'].map(h => el('th', { text: h })))),
        el('tbody', {}, entries.map(([code, g]) => el('tr', {},
          el('td', { text: code === UNKNOWN_CODE ? '—' : labelOf(code) }),
          el('td', { className: 'mono', text: code }),
          el('td', { className: 'num', text: String(g.ok) }),
          el('td', { className: 'num' }, g.fail ? el('span', { className: 'admin-badge warn', text: String(g.fail) }) : '0'),
          el('td', { className: 'mono', text: g.last ? timeText(g.last) : '—' }),
          el('td', { className: 'num', text: String(g.devices.size) }),
          el('td', { text: namesText(g.names) })
        )))
      )
    ));
  }

  function filteredRows() {
    return state.rows.filter(row => {
      if (filters.code === UNKNOWN_CODE ? isKnown(row.code) : (filters.code && row.code !== filters.code)) return false;
      if (filters.result === 'ok' && !isSuccess(row)) return false;
      if (filters.result === 'fail' && isSuccess(row)) return false;
      if (filters.kind !== 'all' && row.request !== filters.kind) return false;
      return true;
    });
  }

  function renderList() {
    if (!state.loaded) return;
    const rows = filteredRows();
    ui.count.textContent = `${rows.length.toLocaleString()}건`;
    if (rows.length === 0) { ui.list.replaceChildren(adminPlaceholder('조건에 맞는 기록이 없습니다.')); return; }
    ui.list.replaceChildren(el('div', { className: 'admin-table-wrap logs-list' },
      el('table', { className: 'admin-table' },
        el('thead', {}, el('tr', {}, ['일시', '결과', '이름(주체)', '코드', '입력한 이름', '구분', '기기'].map(h => el('th', { text: h })))),
        el('tbody', {}, rows.map(row => el('tr', {},
          el('td', { className: 'mono', text: timeText(row.time) }),
          el('td', {}, el('span', { className: `admin-badge ${isSuccess(row) ? 'ok' : 'warn'}`, text: resultText(row) })),
          el('td', { text: labelOf(row.code) || '—' }),
          el('td', { className: 'mono', text: row.code }),
          el('td', { text: row.name }),
          el('td', { text: REQUEST_LABEL[row.request] || row.request }),
          el('td', { className: 'mono logs-device', text: row.device })
        )))
      )
    ));
  }

  // 엑셀에서 열 때 한글이 깨지지 않게 BOM을 붙이고, =·+·-·@로 시작하는 칸은 수식으로 읽히지 않게 막는다.
  function downloadCsv() {
    if (!state.loaded) return;
    const rows = filteredRows();
    if (rows.length === 0) { showAdminToast('내려받을 기록이 없습니다.', 'error'); return; }
    const cell = value => {
      let text = String(value == null ? '' : value);
      if (/^[=+\-@]/.test(text)) text = "'" + text;
      return `"${text.replace(/"/g, '""')}"`;
    };
    const lines = [['일시', '결과', '이름(주체)', '코드', '입력한 이름', '구분', '기기'].map(cell).join(',')];
    rows.forEach(row => {
      lines.push([timeText(row.time), resultText(row), labelOf(row.code), row.code, row.name, REQUEST_LABEL[row.request] || row.request, row.device].map(cell).join(','));
    });
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = el('a', { href: url, download: `접속기록_${state.from}_${state.to}.csv` });
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
})();
