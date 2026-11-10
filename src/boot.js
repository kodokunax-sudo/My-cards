(() => {
  const button = document.getElementById('start-btn');
  const status = document.getElementById('boot-status');
  if (!button || !status) return;

  const isTouch = (navigator.maxTouchPoints || 0) > 0 ||
    ('ontouchstart' in window) ||
    (window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches);
  document.body.classList.add('menu');
  if (isTouch) document.body.classList.add('touch');

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
      setStatus('Загружаем 3D-движок, модели и окружение...');
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
