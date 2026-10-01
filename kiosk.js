/* Two-set Korean composition, independent of the operating-system IME. */
class KioskHangulComposer {
  static initials = [...'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'];
  static vowels = [...'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ'];
  static finals = ['', ...'ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ'];
  static vowelPairs = { 'ㅗㅏ':'ㅘ', 'ㅗㅐ':'ㅙ', 'ㅗㅣ':'ㅚ', 'ㅜㅓ':'ㅝ', 'ㅜㅔ':'ㅞ', 'ㅜㅣ':'ㅟ', 'ㅡㅣ':'ㅢ', 'ㅘㅣ':'ㅙ', 'ㅝㅣ':'ㅞ' };
  static finalPairs = { 'ㄱㅅ':'ㄳ', 'ㄴㅈ':'ㄵ', 'ㄴㅎ':'ㄶ', 'ㄹㄱ':'ㄺ', 'ㄹㅁ':'ㄻ', 'ㄹㅂ':'ㄼ', 'ㄹㅅ':'ㄽ', 'ㄹㅌ':'ㄾ', 'ㄹㅍ':'ㄿ', 'ㄹㅎ':'ㅀ', 'ㅂㅅ':'ㅄ' };
  constructor() { this.reset(); }
  reset() { this.state = ['', '', '']; this.history = []; }
  get pending() {
    const [l,v,t] = this.state;
    if (!l || !v) return l || v;
    return String.fromCharCode(0xac00 + (KioskHangulComposer.initials.indexOf(l) * 21 + KioskHangulComposer.vowels.indexOf(v)) * 28 + KioskHangulComposer.finals.indexOf(t));
  }
  push(char) {
    const C = KioskHangulComposer;
    const previous = [...this.state];
    let [l,v,t] = this.state;
    let commit = '';
    const isVowel = C.vowels.includes(char);
    if (!l && !v) { if (isVowel) v = char; else l = char; }
    else if (!v && l && isVowel) v = char;
    else if (isVowel && v && !t && C.vowelPairs[v + char]) v = C.vowelPairs[v + char];
    else if (isVowel && l && v && t) {
      const pair = Object.entries(C.finalPairs).find(([,value]) => value === t)?.[0];
      this.state = [l, v, pair ? pair[0] : ''];
      commit = this.pending;
      l = pair ? pair[1] : t; v = char; t = '';
    } else if (!isVowel && l && v && !t && C.finals.includes(char)) t = char;
    else if (!isVowel && t && C.finalPairs[t + char]) t = C.finalPairs[t + char];
    else { commit = this.pending; l = isVowel ? '' : char; v = isVowel ? char : ''; t = ''; }
    this.state = [l,v,t];
    this.history = commit ? (l && v ? [['','',''],[l,'','']] : [['','','']]) : [...this.history, previous];
    return { commit, pending:this.pending };
  }
  backspace() { this.state = this.history.pop() || ['','','']; return this.pending; }
}
if (typeof module !== 'undefined' && module.exports) module.exports = KioskHangulComposer;

(() => {
  if (typeof document === 'undefined' || new URLSearchParams(location.search).get('kiosk') !== '1') return;
  const IDLE_MS = 90_000, WARNING_MS = 15_000, AFTER_PRINT_MS = 15_000;
  document.body.classList.add('kiosk-mode');
  const initialUrl = new URL(location.href);
  if (!initialUrl.searchParams.has('mode') && !initialUrl.hash) {
    initialUrl.searchParams.set('mode', 'memorial');
    history.replaceState(null, '', initialUrl);
  }
  const input = document.getElementById('keyword');
  const form = document.getElementById('searchForm');
  const modal = document.getElementById('detailModal');
  const composer = new KioskHangulComposer();
  let pendingStart = 0, language = 'ko', shifted = false, nativeComposing = false;
  let printing = false, afterPrint = false, resetting = false, deadline = Date.now() + IDLE_MS;
  input.setAttribute('inputmode', 'none');
  input.setAttribute('spellcheck', 'false');
  const toggle = document.createElement('button');
  toggle.type = 'button'; toggle.className = 'kiosk-keyboard-toggle';
  toggle.textContent = '키보드 열기'; toggle.setAttribute('aria-controls', 'kioskKeyboard');
  const searchButton = form.querySelector('.btn-search');
  const searchActions = document.createElement('div');
  searchActions.className = 'kiosk-search-actions';
  searchButton.before(searchActions);
  searchActions.append(searchButton, toggle);
  const keyboard = document.createElement('section');
  keyboard.id = 'kioskKeyboard'; keyboard.className = 'kiosk-keyboard'; keyboard.hidden = true;
  keyboard.setAttribute('aria-label', '고인명 입력용 터치 키보드');
  document.body.append(keyboard);
  const notice = document.createElement('aside');
  notice.className = 'kiosk-notice'; notice.hidden = true;
  const message = document.createElement('span');
  message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite');
  const continueBtn = document.createElement('button');
  continueBtn.type = 'button'; continueBtn.textContent = '계속 이용';
  notice.append(message, continueBtn); document.body.append(notice);

  function commitComposition() { composer.reset(); }
  function hideKeyboard() {
    commitComposition(); keyboard.hidden = true;
    document.body.classList.remove('kiosk-keyboard-open'); toggle.setAttribute('aria-expanded', 'false');
  }
  function showKeyboard() {
    if (modal.open || printing) return;
    keyboard.hidden = false; document.body.classList.add('kiosk-keyboard-open');
    toggle.setAttribute('aria-expanded', 'true'); input.focus({preventScroll:true});
  }
  function activity(event) {
    if (printing || resetting) return;
    if (event?.target && notice.contains(event.target)) return;
    afterPrint = false; deadline = Date.now() + IDLE_MS; notice.hidden = true;
  }
  function reset() {
    if (printing) return;
    resetting = true; hideKeyboard(); notice.hidden = true; afterPrint = false;
    if (modal.open) modal.close();
    input.value = '';
    ['modalName','modalType','modalLoc','modalDate'].forEach(id => document.getElementById(id).textContent = '');
    language = 'ko'; shifted = false; drawKeys();
    // Every kiosk session returns to the memorial search, including on reload.
    const url = new URL(location.href); url.searchParams.set('mode', 'memorial'); url.hash = '';
    history.replaceState(null, '', url);
    setMode('memorial');
    window.scrollTo({top:0, behavior:'instant'});
    deadline = Date.now() + IDLE_MS;
    // No focus stealing or automatic keyboard popup while the welcome screen waits.
    input.focus({preventScroll:true}); hideKeyboard();
    setTimeout(() => { resetting = false; }, 0);
  }
  window.kioskController = { reset, hideKeyboard };

  function emitInput() { input.dispatchEvent(new Event('input', {bubbles:true})); }
  function replace(start, end, text) {
    if (input.value.length - (end - start) + text.length > input.maxLength) return false;
    input.setRangeText(text, start, end, 'end'); return true;
  }
  let internalInput = false;
  function keyPress(key) {
    activity();
    if (key === 'close') { hideKeyboard(); input.focus({preventScroll:true}); hideKeyboard(); return; }
    if (key === 'lang') { commitComposition(); language = language === 'ko' ? 'en' : 'ko'; shifted = false; drawKeys(); return; }
    if (key === 'shift') { shifted = !shifted; drawKeys(); return; }
    if (key === 'search') { commitComposition(); hideKeyboard(); form.requestSubmit(); return; }
    input.focus({preventScroll:true});
    let start = input.selectionStart, end = input.selectionEnd;
    if (composer.pending && (start !== end || start !== pendingStart + composer.pending.length)) commitComposition();
    if (key === 'clear') { input.value = ''; commitComposition(); }
    else if (key === 'back') {
      if (composer.pending) {
        const oldLength = composer.pending.length;
        const next = composer.backspace(); replace(pendingStart, pendingStart + oldLength, next);
      } else if (start !== end) replace(start, end, '');
      else if (start > 0) replace(start - 1, start, '');
    } else if (language === 'ko' && /^[ㄱ-ㅣ]$/.test(key)) {
      const oldPending = composer.pending;
      const savedState = [...composer.state], savedHistory = composer.history.map(s => [...s]);
      if (!oldPending) pendingStart = start;
      const output = composer.push(key);
      if (replace(pendingStart, oldPending ? pendingStart + oldPending.length : end, output.commit + output.pending)) pendingStart += output.commit.length;
      else { composer.state = savedState; composer.history = savedHistory; }
    } else { commitComposition(); replace(start, end, key === 'space' ? ' ' : key); }
    internalInput = true; emitInput(); internalInput = false;
    if (shifted && !['back','clear'].includes(key)) { shifted = false; drawKeys(); }
  }
  function drawKeys() {
    keyboard.replaceChildren();
    const heading = document.createElement('div'); heading.className = 'kiosk-keyboard-heading';
    heading.textContent = language === 'ko' ? '고인명 입력 · 한글 두벌식' : '고인명 입력 · English';
    keyboard.append(heading);
    const rows = language === 'ko'
      ? (shifted ? ['ㅃㅉㄸㄲㅆㅛㅕㅑㅒㅖ','ㅁㄴㅇㄹㅎㅗㅓㅏㅣ','ㅋㅌㅊㅍㅠㅜㅡ'] : ['ㅂㅈㄷㄱㅅㅛㅕㅑㅐㅔ','ㅁㄴㅇㄹㅎㅗㅓㅏㅣ','ㅋㅌㅊㅍㅠㅜㅡ'])
      : (shifted ? ['QWERTYUIOP','ASDFGHJKL','ZXCVBNM'] : ['qwertyuiop','asdfghjkl','zxcvbnm']);
    function button(row, label, key, className = '') {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'kiosk-key ' + className;
      b.textContent = label; b.dataset.key = key;
      if (key === 'back') b.setAttribute('aria-label', '한 글자 삭제');
      if (key === 'shift') b.setAttribute('aria-pressed', String(shifted));
      row.append(b);
    }
    [...['1234567890'], ...rows].forEach(chars => {
      const row = document.createElement('div'); row.className = 'kiosk-key-row';
      [...chars].forEach(char => button(row,char,char)); keyboard.append(row);
    });
    const actions = document.createElement('div'); actions.className = 'kiosk-key-row';
    [['Shift','shift','action'],['한/영','lang','action'],['띄어쓰기','space','action space'],['삭제','back','action'],['전체 지우기','clear','action'],['검색','search','search'],['닫기','close','action']].forEach(args => button(actions,...args));
    keyboard.append(actions);
  }
  drawKeys();
  keyboard.addEventListener('pointerdown', event => { if (event.target.closest('button')) event.preventDefault(); });
  keyboard.addEventListener('click', event => { const key = event.target.closest('button')?.dataset.key; if (key) keyPress(key); });
  toggle.addEventListener('click', () => { activity(); showKeyboard(); });
  input.addEventListener('pointerdown', () => { commitComposition(); showKeyboard(); });
  input.addEventListener('focus', () => { if (!resetting && !afterPrint) showKeyboard(); });
  input.addEventListener('input', () => { if (!internalInput) commitComposition(); });
  input.addEventListener('keydown', event => {
    commitComposition();
    if (event.key === 'Enter' && (event.isComposing || nativeComposing || event.keyCode === 229)) event.preventDefault();
  });
  input.addEventListener('compositionstart', () => { nativeComposing = true; });
  input.addEventListener('compositionend', () => { nativeComposing = false; });
  form.addEventListener('submit', hideKeyboard);
  modal.addEventListener('close', () => { if (!resetting && !printing) { input.focus({preventScroll:true}); hideKeyboard(); } });
  continueBtn.addEventListener('click', () => { activity(); if (!modal.open) { input.focus({preventScroll:true}); hideKeyboard(); } });
  ['pointerdown','keydown','input','wheel'].forEach(type => document.addEventListener(type, activity, {capture:true, passive:true}));
  document.addEventListener('scroll', activity, {capture:true, passive:true});
  window.addEventListener('beforeprint', () => { printing = true; hideKeyboard(); notice.hidden = true; });
  window.addEventListener('afterprint', () => {
    if (!printing) return;
    printing = false; afterPrint = true; deadline = Date.now() + AFTER_PRINT_MS;
    updateNotice();
  });
  function updateNotice() {
    if (printing || resetting) return;
    const remaining = deadline - Date.now();
    if (remaining <= 0) { reset(); return; }
    notice.hidden = remaining > WARNING_MS;
    if (!notice.hidden) {
      const parent = modal.open ? modal : document.body;
      if (notice.parentElement !== parent) parent.append(notice);
      const text = `${String(Math.ceil(remaining / 1000)).padStart(2, '0')}초 후에 첫화면으로 돌아갑니다.`;
      if (message.textContent !== text) message.textContent = text;
    }
  }
  setInterval(updateNotice, 250);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) updateNotice(); });
})();
