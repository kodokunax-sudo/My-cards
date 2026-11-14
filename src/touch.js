/**
 * Мобильное управление: виртуальный джойстик слева, свайп-обзор по сцене,
 * экранные кнопки справа. Все касания обрабатываются без браузерной прокрутки.
 */
export function createTouchControls(player, actions = {}) {
  const coarsePointer = window.matchMedia &&
    window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  const isTouch = (navigator.maxTouchPoints || 0) > 0 ||
    ('ontouchstart' in window) || coarsePointer;

  if (!isTouch) return null;

  const layer = document.getElementById('touch-layer');
  const stick = document.getElementById('stick');
  const knob = document.getElementById('stick-knob');
  const canvas = document.getElementById('scene');
  if (!layer || !stick || !knob || !canvas) return null;

  document.body.classList.add('touch');
  layer.classList.remove('hidden');
  canvas.style.touchAction = 'none';

  const preventGesture = (event) => event.preventDefault();
  layer.addEventListener('contextmenu', preventGesture);
  layer.addEventListener('dragstart', preventGesture);

  // ---------- джойстик ----------
  const MAX = 48;
  let stickId = null;
  let originX = 0;
  let originY = 0;

  function stickStart(event) {
    if (stickId !== null) return;
    stickId = event.pointerId;
    const rect = stick.getBoundingClientRect();
    originX = rect.left + rect.width / 2;
    originY = rect.top + rect.height / 2;
    try { stick.setPointerCapture(event.pointerId); } catch (error) { /* fallback to pointer events */ }
    event.preventDefault();
    event.stopPropagation();
  }

  function stickMove(event) {
    if (event.pointerId !== stickId) return;
    const dx = event.clientX - originX;
    const dy = event.clientY - originY;
    const length = Math.hypot(dx, dy);
    const factor = length > MAX ? MAX / length : 1;
    const x = dx * factor;
    const y = dy * factor;
    knob.style.transform = `translate(${x}px, ${y}px)`;
    player.setMoveVector(x / MAX, -y / MAX);
    event.preventDefault();
  }

  function stickEnd(event) {
    if (event.pointerId !== stickId) return;
    stickId = null;
    knob.style.transform = '';
    player.setMoveVector(0, 0);
    event.preventDefault?.();
  }

  stick.addEventListener('pointerdown', stickStart);
  stick.addEventListener('pointermove', stickMove);
  stick.addEventListener('pointerup', stickEnd);
  stick.addEventListener('pointercancel', stickEnd);
  stick.addEventListener('lostpointercapture', stickEnd);

  // ---------- обзор свайпом по свободной части экрана ----------
  let lookId = null;
  let lastX = 0;
  let lastY = 0;

  canvas.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' || lookId !== null) return;
    lookId = event.pointerId;
    lastX = event.clientX;
    lastY = event.clientY;
    try { canvas.setPointerCapture(event.pointerId); } catch (error) { /* pointer capture can be unavailable */ }
    event.preventDefault();
  });

  canvas.addEventListener('pointermove', (event) => {
    if (event.pointerId !== lookId) return;
    player.look((event.clientX - lastX) * 1.6, (event.clientY - lastY) * 1.6);
    lastX = event.clientX;
    lastY = event.clientY;
    event.preventDefault();
  });

  function endLook(event) {
    if (event.pointerId !== lookId) return;
    lookId = null;
    event.preventDefault?.();
  }
  canvas.addEventListener('pointerup', endLook);
  canvas.addEventListener('pointercancel', endLook);
  canvas.addEventListener('lostpointercapture', endLook);

  // ---------- экранные кнопки ----------
  layer.querySelectorAll('.tbtn').forEach((button) => {
    const action = button.dataset.act;
    let heldPointer = null;

    const down = (event) => {
      if (heldPointer !== null) return;
      heldPointer = event.pointerId;
      event.preventDefault();
      event.stopPropagation();
      try { button.setPointerCapture(event.pointerId); } catch (error) { /* fallback to pointer events */ }
      button.classList.add('active');

      if (action === 'up' || action === 'down') {
        player.setVertical(action === 'up' ? 1 : -1);
        return;
      }
      if (action === 'jump') {
        player.jump();
        button.classList.remove('active');
        return;
      }
      if (action === 'run') {
        player.setRun(!player.run);
        button.classList.toggle('active', player.run);
      } else if (action === 'fly') {
        actions.fly?.();
      } else if (action === 'tour') {
        actions.tour?.();
      } else if (action === 'sound') {
        actions.sound?.();
      } else if (action === 'eat') {
        actions.eat?.();
      }
    };

    const up = (event) => {
      if (heldPointer !== event.pointerId) return;
      heldPointer = null;
      event.preventDefault();
      event.stopPropagation();
      if (action === 'run') {
        button.classList.toggle('active', player.run);
        return;
      }
      button.classList.remove('active');
      if (action === 'up' || action === 'down') player.setVertical(0);
    };

    button.addEventListener('pointerdown', down);
    button.addEventListener('pointerup', up);
    button.addEventListener('pointercancel', up);
    button.addEventListener('lostpointercapture', up);
  });

  const runButton = layer.querySelector('[data-act="run"]');
  const soundButton = layer.querySelector('[data-act="sound"]');

  return {
    isTouch,
    setRunState(on) { runButton?.classList.toggle('active', on); },
    setSoundState(on) { soundButton?.classList.toggle('active', on); },
    setFlyState(on) { document.body.classList.toggle('fly', on); },
    setSwimState(on) { document.body.classList.toggle('swim', on); },
  };
}
