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
  const IDLE_MS = 90_000, WARNING_MS = 15_000, AFTER_PRINT_MS = 10_000;
  const DATA_REFRESH_MS = 5 * 60_000;
  document.body.classList.add('kiosk-mode');
  const initialUrl = new URL(location.href);
  if (!initialUrl.searchParams.has('mode') && !initialUrl.hash) {
    initialUrl.searchParams.set('mode', 'memorial');
    history.replaceState(null, '', initialUrl);
  }
  const input = document.getElementById('keyword');
  const form = document.getElementById('searchForm');
  const modal = document.getElementById('detailModal');
  const main = document.querySelector('main');
  main.querySelector('.hint').textContent = '※ 결과를 선택하면 상세정보가 표시됩니다. 목록은 위아래로 스크롤할 수 있습니다.';
  const composer = new KioskHangulComposer();
  let pendingStart = 0, language = 'ko', shifted = false, nativeComposing = false;
  let printing = false, afterPrint = false, resetting = false, deadline = Date.now() + IDLE_MS;
  let closingModalForReset = false;
  let lastActivityAt = Date.now(), nextRefreshAt = Date.now() + DATA_REFRESH_MS, refreshingData = false;
  input.setAttribute('inputmode', 'none');
  input.setAttribute('spellcheck', 'false');
  const toggle = document.createElement('button');
  toggle.type = 'button'; toggle.className = 'kiosk-keyboard-toggle';
  toggle.textContent = '키보드 열기'; toggle.setAttribute('aria-controls', 'kioskKeyboard');
  const searchButton = form.querySelector('.btn-search');
  const searchActions = document.createElement('div');
  searchActions.className = 'kiosk-search-actions';
  searchButton.before(searchActions);
  const searchTools = document.createElement('div');
  searchTools.className = 'kiosk-search-tools';
  const homeButton = document.createElement('button');
  homeButton.type = 'button'; homeButton.className = 'kiosk-home'; homeButton.textContent = '처음으로';
  searchTools.append(toggle, homeButton);
  searchActions.append(searchButton, searchTools);
  const keyboard = document.createElement('section');
  keyboard.id = 'kioskKeyboard'; keyboard.className = 'kiosk-keyboard'; keyboard.hidden = true;
  keyboard.setAttribute('aria-label', '고인명 입력용 터치 키보드');
  const stage = document.createElement('div');
  stage.className = 'kiosk-stage';
  main.before(stage);
  stage.append(main, keyboard);
  const notice = document.createElement('aside');
  notice.className = 'kiosk-notice'; notice.hidden = true;
  const message = document.createElement('span');
  message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite');
  const continueBtn = document.createElement('button');
  continueBtn.type = 'button'; continueBtn.textContent = '계속 이용';
  notice.append(message, continueBtn); document.body.append(notice);

  function commitComposition() { composer.reset(); }
  let mainMotion = null, keyboardMotion = null;
  const motionOptions = { duration:360, easing:'cubic-bezier(.22,1,.36,1)' };
  function animateMain(previousTop) {
    mainMotion?.cancel();
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const offset = previousTop - main.getBoundingClientRect().top;
    if (Math.abs(offset) > 1) mainMotion = main.animate([
      {transform:`translateY(${offset}px)`}, {transform:'translateY(0)'}
    ], motionOptions);
  }
  function hideKeyboard() {
    const wasVisible = !keyboard.hidden;
    const previousTop = main.getBoundingClientRect().top;
    keyboardMotion?.cancel();
    commitComposition(); keyboard.hidden = true;
    document.body.classList.remove('kiosk-keyboard-open'); toggle.setAttribute('aria-expanded', 'false');
    if (wasVisible) animateMain(previousTop);
  }
  function showKeyboard() {
    if (modal.open || printing) return;
    if (!keyboard.hidden) { input.focus({preventScroll:true}); return; }
    const previousTop = main.getBoundingClientRect().top;
    keyboard.hidden = false; document.body.classList.add('kiosk-keyboard-open');
    toggle.setAttribute('aria-expanded', 'true'); input.focus({preventScroll:true});
    animateMain(previousTop);
    keyboardMotion?.cancel();
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) keyboardMotion = keyboard.animate([
      {transform:'translateY(-24px)', opacity:0}, {transform:'translateY(0)', opacity:1}
    ], motionOptions);
  }
  function activity(event) {
    if (printing || resetting) return;
    if (event?.target && notice.contains(event.target)) return;
    lastActivityAt = Date.now();
    afterPrint = false; deadline = lastActivityAt + IDLE_MS; notice.hidden = true;
  }
  function hasSessionContent() {
    return !!input.value.trim() || !!document.getElementById('result').textContent.trim() || modal.open;
  }
  function canRefreshData() {
    return !printing && !resetting && !afterPrint && !nativeComposing && !hasSessionContent() && Date.now() - lastActivityAt >= 10_000;
  }
  async function refreshWhileIdle() {
    if (document.hidden || refreshingData || Date.now() < nextRefreshAt || !canRefreshData()) return;
    refreshingData = true;
    // Defer the next attempt even if offline, to avoid repeated failing requests.
    nextRefreshAt = Date.now() + DATA_REFRESH_MS;
    try {
      if (!await refreshSearchData(canRefreshData)) nextRefreshAt = Date.now() + 60_000;
    } catch { /* Retain the last successful data while the network is unavailable. */ }
    finally { refreshingData = false; }
  }
  function reset() {
    if (printing) return;
    resetting = true; commitComposition(); notice.hidden = true; afterPrint = false;
    if (modal.open) {
      closingModalForReset = true;
      modal.close();
    }
    input.value = '';
    ['modalName','modalType','modalLoc','modalDate'].forEach(id => document.getElementById(id).textContent = '');
    language = 'ko'; shifted = false; nativeComposing = false; drawKeys();
    // Every kiosk session returns to the memorial search, including on reload.
    const url = new URL(location.href); url.searchParams.set('mode', 'memorial'); url.hash = '';
    history.replaceState(null, '', url);
    setMode('memorial');
    window.scrollTo({top:0, behavior:'instant'});
    deadline = Date.now() + IDLE_MS;
    lastActivityAt = Date.now();
    // Leave the first screen ready for the next visitor to type a Korean name.
    input.focus({preventScroll:true}); showKeyboard();
    setTimeout(() => { resetting = false; }, 0);
  }
  window.kioskController = { reset, hideKeyboard };
  homeButton.addEventListener('click', reset);

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
    rows.forEach(chars => {
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
  modal.addEventListener('close', () => {
    // The dialog's delayed close event must not hide the freshly reset keyboard.
    if (closingModalForReset) { closingModalForReset = false; return; }
    if (!resetting && !printing) { input.focus({preventScroll:true}); hideKeyboard(); }
  });
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
    if (!afterPrint && !hasSessionContent()) { notice.hidden = true; return; }
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
  setInterval(refreshWhileIdle, 15_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) updateNotice(); });
})();
