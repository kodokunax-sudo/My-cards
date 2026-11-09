/**
 * Мобильное управление: виртуальный джойстик слева, свайп-обзор по сцене,
 * экранные кнопки справа. Активируется только на тач-устройствах.
 */
export function createTouchControls(player, actions = {}) {
  const isTouch = ('ontouchstart' in window) ||
    (window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches);

  if (!isTouch) return null;

  document.body.classList.add('touch');
  const layer = document.getElementById('touch-layer');
  const stick = document.getElementById('stick');
  const knob = document.getElementById('stick-knob');
  const canvas = document.getElementById('scene');

  layer.classList.remove('hidden');

  // ---------- джойстик ----------
  const MAX = 48;
  let stickId = null;
  let originX = 0, originY = 0;

  function stickStart(e) {
    stickId = e.pointerId;
    const r = stick.getBoundingClientRect();
    originX = r.left + r.width / 2;
    originY = r.top + r.height / 2;
    stick.setPointerCapture(e.pointerId);
    e.preventDefault();
  }
  function stickMove(e) {
    if (e.pointerId !== stickId) return;
    const dx = e.clientX - originX;
    const dy = e.clientY - originY;
    const len = Math.hypot(dx, dy);
    const k = len > MAX ? MAX / len : 1;
    const kx = dx * k, ky = dy * k;
    knob.style.transform = `translate(${kx}px, ${ky}px)`;
    player.setMoveVector(kx / MAX, -ky / MAX);
    e.preventDefault();
  }
  function stickEnd(e) {
    if (e.pointerId !== stickId) return;
    stickId = null;
    knob.style.transform = '';
    player.setMoveVector(0, 0);
  }
  stick.addEventListener('pointerdown', stickStart);
  stick.addEventListener('pointermove', stickMove);
  stick.addEventListener('pointerup', stickEnd);
  stick.addEventListener('pointercancel', stickEnd);

  // ---------- обзор свайпом ----------
  let lookId = null, lastX = 0, lastY = 0;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    lookId = e.pointerId;
    lastX = e.clientX; lastY = e.clientY;
    if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId !== lookId) return;
    player.look((e.clientX - lastX) * 1.6, (e.clientY - lastY) * 1.6);
    lastX = e.clientX; lastY = e.clientY;
  });
  const lookEnd = (e) => { if (e.pointerId === lookId) lookId = null; };
  canvas.addEventListener('pointerup', lookEnd);
  canvas.addEventListener('pointercancel', lookEnd);
  canvas.addEventListener('pointerleave', lookEnd);

  // ---------- экранные кнопки ----------
  layer.querySelectorAll('.tbtn').forEach((btn) => {
    const act = btn.dataset.act;
    let held = false;
    const down = (e) => {
      e.preventDefault();
      e.stopPropagation();
      btn.classList.add('active');
      if (act === 'up' || act === 'down') {
        held = true;
        player.setVertical(act === 'up' ? 1 : -1);
        return;
      }
      if (act === 'jump') {
        player.jump();
        btn.classList.remove('active');
        return;
      }
      if (act === 'run') {
        player.setRun(!player.run);
        btn.classList.toggle('active', player.run);
      }
      else if (act === 'fly') actions.fly?.();
      else if (act === 'tour') actions.tour?.();
      else if (act === 'sound') actions.sound?.();
    };
    const up = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (act === 'run') {
        btn.classList.toggle('active', player.run);
        return;
      }
      btn.classList.remove('active');
      if (act === 'up' || act === 'down') { held = false; player.setVertical(0); }
    };
    btn.addEventListener('pointerdown', down);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('pointerleave', up);
  });

  // «Звук» и «БЕГ» показывают состояние
  const runBtn = layer.querySelector('[data-act="run"]');
  const soundBtn = layer.querySelector('[data-act="sound"]');

  return {
    isTouch,
    setRunState(on) { runBtn?.classList.toggle('active', on); },
    setSoundState(on) { soundBtn?.classList.toggle('active', on); },
    setFlyState(on) { document.body.classList.toggle('fly', on); },
    setSwimState(on) { document.body.classList.toggle('swim', on); },
  };
}
