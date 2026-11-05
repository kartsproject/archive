/**
 * 한영 전환 없이 한글 자판으로 입력된 접근코드를 영문으로 되돌리는 보정.
 * 기존 루트 index.html에서 재활용 (docs/screens.md 2절). 접근코드 검증 자체는
 * 관문이 담당하며, 이 함수는 입력값 보정 용도로만 쓴다.
 */
const CHO = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
const JUNG = ['ㅏ','ㅐ','ㅑ','ㅒ','ㅓ','ㅔ','ㅕ','ㅖ','ㅗ','ㅘ','ㅙ','ㅚ','ㅛ','ㅜ','ㅝ','ㅞ','ㅟ','ㅠ','ㅡ','ㅢ','ㅣ'];
const JONG = ['','ㄱ','ㄲ','ㄳ','ㄴ','ㄵ','ㄶ','ㄷ','ㄹ','ㄺ','ㄻ','ㄼ','ㄽ','ㄾ','ㄿ','ㅀ','ㅁ','ㅂ','ㅄ','ㅅ','ㅆ','ㅇ','ㅈ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
const JAMO_KEY = {
  'ㄱ':'r','ㄲ':'R','ㄴ':'s','ㄷ':'e','ㄸ':'E','ㄹ':'f','ㅁ':'a','ㅂ':'q','ㅃ':'Q','ㅅ':'t','ㅆ':'T','ㅇ':'d','ㅈ':'w','ㅉ':'W','ㅊ':'c','ㅋ':'z','ㅌ':'x','ㅍ':'v','ㅎ':'g',
  'ㅏ':'k','ㅐ':'o','ㅑ':'i','ㅒ':'O','ㅓ':'j','ㅔ':'p','ㅕ':'u','ㅖ':'P','ㅗ':'h','ㅛ':'y','ㅜ':'n','ㅠ':'b','ㅡ':'m','ㅣ':'l'
};
const COMPOUND_KEY = {
  'ㄳ':'rt','ㄵ':'sw','ㄶ':'sg','ㄺ':'fr','ㄻ':'fa','ㄼ':'fq','ㄽ':'ft','ㄾ':'fx','ㄿ':'fv','ㅀ':'fg','ㅄ':'qt',
  'ㅘ':'hk','ㅙ':'ho','ㅚ':'hl','ㅝ':'nj','ㅞ':'np','ㅟ':'nl','ㅢ':'ml'
};
function jamoToKey(j) { return JAMO_KEY[j] || COMPOUND_KEY[j] || j; }
function hangulSyllableToKeys(ch) {
  const code = ch.charCodeAt(0) - 0xAC00;
  if (code < 0 || code > 11171) return null;
  const cho = Math.floor(code / 588);
  const jung = Math.floor((code % 588) / 28);
  const jong = code % 28;
  let out = jamoToKey(CHO[cho]) + jamoToKey(JUNG[jung]);
  if (jong > 0) out += jamoToKey(JONG[jong]);
  return out;
}
function convertHangulToEnglish(str) {
  let out = '';
  for (const ch of str) {
    const keys = hangulSyllableToKeys(ch);
    out += (keys !== null) ? keys : (JAMO_KEY[ch] || ch);
  }
  return out;
}

/**
 * 접근코드 입력칸 (2026-11-05 사용자 요청) — 열람 화면(app.js) · 관리자 화면(admin-app.js) 로그인이 함께 쓴다.
 *  ① 영문 · 숫자 · - 만 들어간다. 한글 자판인 채로 치면 그 자리에서 영문으로 바꾸고(조합 중에는 두었다가 조합이 끝나면),
 *     그 밖의 글자(빈칸 · 기호)는 뺀다. 대문자 · 소문자는 친 그대로 둔다 — 코드는 대소문자를 구별한다(2026-11-05 사용자)
 *  ② 칸 오른쪽 눈 아이콘 단추로 입력한 코드를 보고 다시 숨긴다(보이는 중이면 빗금 친 눈)
 * 코드가 맞는지는 관문이 확인한다. 이 함수는 입력을 고쳐 보여 줄 뿐이다.
 * 홍보 사이트 assets/js/codefield.js와 같은 방식. 돌려주는 hide()는 로그인 화면을 다시 열 때 [보기]를 끈다.
 */
// [보기] 단추의 눈 아이콘(DOM으로 그림). 보이는 중이면 눈에 빗금
function eyeIcon(off) {
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs) => { const e = document.createElementNS(NS, tag); Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v)); return e; };
  const svg = el('svg', { viewBox: '0 0 24 24', width: '18', height: '18', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
  svg.appendChild(el('path', { d: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z' }));
  svg.appendChild(el('circle', { cx: '12', cy: '12', r: '3' }));
  if (off) svg.appendChild(el('path', { d: 'M4 4l16 16' }));
  return svg;
}
function enhanceCodeInput(input) {
  if (!input || input.dataset.cf) return { hide() {} };
  input.dataset.cf = '1';
  input.setAttribute('lang', 'en');
  input.spellcheck = false;
  const wrap = document.createElement('span');
  wrap.className = 'cf-wrap';
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'cf-eye';
  wrap.appendChild(btn);
  const show = on => {
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.replaceChildren(eyeIcon(on));
    btn.title = on ? '숨기기' : '보기';
    btn.setAttribute('aria-label', on ? '접근코드 숨기기' : '입력한 접근코드 보기');
    input.type = on ? 'text' : 'password'; // 보이는 동안 한글 입력기가 켜질 수 있다 — 아래 fix가 영문으로 바꾼다
  };
  show(false);
  btn.addEventListener('mousedown', e => e.preventDefault());
  btn.addEventListener('click', () => { show(btn.getAttribute('aria-pressed') !== 'true'); input.focus(); });
  const fix = () => {
    const v = input.value;
    const clean = s => convertHangulToEnglish(s).replace(/[^A-Za-z0-9-]/g, '');
    const n = clean(v);
    if (n === v) return;
    const p = input.selectionStart;
    const np = p == null ? n.length : clean(v.slice(0, p)).length;
    input.value = n;
    try { input.setSelectionRange(np, np); } catch (e) { /* 일부 브라우저의 비밀번호 칸 */ }
  };
  input.addEventListener('input', e => { if (!e.isComposing) fix(); });
  input.addEventListener('compositionend', () => setTimeout(fix, 0));
  input.addEventListener('blur', fix);
  return { hide() { show(false); } };
}
