(() => {
  const button = document.getElementById('start-btn');
  const status = document.getElementById('boot-status');
  if (!button || !status) return;

  const isTouch = (navigator.maxTouchPoints || 0) > 0 ||
    ('ontouchstart' in window) ||
    (window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches);
  document.body.classList.add('menu');
  if (isTouch) document.body.classList.add('touch');

  // Persist the app's downloaded scripts, audio and visual assets between visits.
  let offlineCacheReady = Promise.resolve();
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    offlineCacheReady = navigator.serviceWorker.register('./sw.js')
      .then(() => navigator.serviceWorker.ready)
      .then(() => new Promise((resolve) => {
        if (navigator.serviceWorker.controller) return resolve();
        const finish = () => resolve();
        navigator.serviceWorker.addEventListener('controllerchange', finish, { once: true });
        window.setTimeout(finish, 1400);
      }))
      .catch((error) => {
        console.warn('[Titan cache] Service worker unavailable:', error);
      });
  }
  try { navigator.storage?.persist?.(); } catch (error) { /* best effort on supported browsers */ }

  let loading = false;
  let loaded = false;

  function setStatus(message) {
    status.textContent = message;
  }
  window.__titanBootStatus = setStatus;

  function requestPhoneDisplayMode() {
    if (!isTouch) return;
    const root = document.documentElement;
    try {
      if (!document.fullscreenElement && typeof root.requestFullscreen === 'function') {
        const request = root.requestFullscreen({ navigationUI: 'hide' });
        if (request && typeof request.then === 'function') {
          request.then(() => {
            try {
              if (screen.orientation && screen.orientation.lock) {
                screen.orientation.lock('landscape').catch(() => {});
              }
            } catch (error) { /* manual rotation remains available */ }
          }).catch(() => {});
        }
      } else if (screen.orientation && screen.orientation.lock) {
        screen.orientation.lock('landscape').catch(() => {});
      }
    } catch (error) {
      // Browsers without fullscreen/orientation APIs still support landscape play.
    }
  }

  async function launchGame() {
    if (loading) return;
    if (loaded && typeof window.__titanStartGame === 'function') {
      window.__titanStartGame();
      return;
    }

    loading = true;
    button.disabled = true;
    button.textContent = 'ЗАГРУЗКА...';
    setStatus('Подключаем 3D-движок. Большие модели пока не загружены.');
    requestPhoneDisplayMode();

    try {
      // Give the browser two frames to paint the loading state before the
      // heavy world modules are requested and initialized.
      await new Promise((resolve) => requestAnimationFrame(() =>
        requestAnimationFrame(resolve)
      ));
      setStatus('Подготавливаем локальный кэш...');
      await offlineCacheReady;
      setStatus('Загружаем 3D-движок и ближайшую область...');
      await import('./main.js');

      if (typeof window.__titanStartGame !== 'function') {
        throw new Error('Сцена загрузилась не полностью: не найден запуск игры.');
      }
      loaded = true;
      loading = false;
      button.disabled = false;
      button.textContent = 'ИГРАТЬ';
      setStatus('Мир готов. Приятной прогулки!');
      window.__titanStartGame();
    } catch (error) {
      loading = false;
      button.disabled = false;
      button.textContent = 'ОБНОВИТЬ И ПОВТОРИТЬ';
      const message = error && error.message ? error.message : String(error || 'неизвестная ошибка');
      setStatus('Не удалось загрузить игру: ' + message + '. Нажми кнопку ещё раз после обновления страницы.');
      button.removeEventListener('click', launchGame);
      button.addEventListener('click', () => window.location.reload(), { once: true });
    }
  }

  button.addEventListener('click', launchGame);
})();
