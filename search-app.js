(() => {
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('./search-service-worker.js', {scope:'./search.html', updateViaCache:'none'}).catch(error => {
      console.warn('고인검색 앱의 오프라인 화면을 준비하지 못했습니다.', error);
    });
  }
  const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (isStandalone() || new URLSearchParams(location.search).get('kiosk') === '1') return;
  const dismissedKey = 'ulsan_search_install_dismissed';
  let deferredPrompt = null;
  const banner = document.createElement('aside');
  banner.className = 'search-install'; banner.hidden = true;
  banner.setAttribute('aria-label', '고인검색 앱 설치');
  banner.innerHTML = '<div class="search-install-title">고인검색 앱으로 설치하세요</div><div class="search-install-text">접수 현황 앱과 별도로 설치해 고인검색 화면을 바로 열 수 있습니다.</div><div class="search-install-actions"><button type="button" class="search-install-action">앱 설치</button><button type="button" class="search-install-dismiss">닫기</button></div>';
  document.body.append(banner);
  const action = banner.querySelector('.search-install-action');
  const text = banner.querySelector('.search-install-text');
  function recentlyDismissed() {
    try { return Date.now() - Number(localStorage.getItem(dismissedKey) || 0) < 7 * 86400_000; }
    catch { return false; }
  }
  function dismiss() {
    banner.hidden = true;
    try { localStorage.setItem(dismissedKey, String(Date.now())); } catch {}
  }
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault(); deferredPrompt = event;
    if (!isStandalone() && !recentlyDismissed()) banner.hidden = false;
  });
  window.addEventListener('appinstalled', () => { deferredPrompt = null; banner.hidden = true; });
  banner.querySelector('.search-install-dismiss').addEventListener('click', dismiss);
  action.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    const prompt = deferredPrompt; deferredPrompt = null;
    try { await prompt.prompt(); await prompt.userChoice; }
    catch { /* The browser's menu remains available for installation. */ }
    banner.hidden = true;
  });
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (isIos && !recentlyDismissed()) {
    text.textContent = 'Safari에서 공유 버튼 → 홈 화면에 추가를 선택하면 고인검색 앱을 별도로 설치할 수 있습니다.';
    action.hidden = true; banner.hidden = false;
  }
})();
