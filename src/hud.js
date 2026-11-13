import { FOUNTAIN_HEIGHT, PLAYER_HEIGHT, SCALE_FACTOR } from './config.js';

export function createHud() {
  const el = {
    dist: document.getElementById('stat-dist'),
    angle: document.getElementById('stat-angle'),
    height: document.getElementById('stat-height'),
    mode: document.getElementById('stat-mode'),
    worldClock: document.getElementById('world-clock'),
    toast: document.getElementById('toast'),
    compass: document.getElementById('compass'),
    oxygen: document.getElementById('oxygen-indicator'),
    oxygenText: document.getElementById('oxygen-text'),
    oxygenFill: document.getElementById('oxygen-fill'),
  };

  const ctx = el.compass.getContext('2d');
  const size = el.compass.width;
  const cx = size / 2, cy = size / 2, r = size / 2 - 12;

  let toastTimer = 0;
  let lastClockText = '';
  const fmt = (v) => v.toFixed(1).replace('.', ',');

  function drawCompass(yaw, bearing) {
    ctx.clearRect(0, 0, size, size);

    // циферблат
    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = 'rgba(12, 16, 24, 0.55)';
    ctx.beginPath(); ctx.arc(0, 0, r + 8, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(226, 200, 140, 0.45)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();

    ctx.rotate(-yaw);
    const marks = [['С', 0], ['В', Math.PI / 2], ['Ю', Math.PI], ['З', -Math.PI / 2]];
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const [t, a] of marks) {
      const x = Math.sin(a) * (r - 12), y = -Math.cos(a) * (r - 12);
      ctx.fillStyle = t === 'С' ? '#ffd98a' : 'rgba(236, 226, 204, 0.8)';
      ctx.fillText(t, x, y);
    }
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      const inner = r - 4, outer = r - (i % 9 === 0 ? 9 : 6);
      ctx.strokeStyle = 'rgba(236, 226, 204, 0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.sin(a) * inner, -Math.cos(a) * inner);
      ctx.lineTo(Math.sin(a) * outer, -Math.cos(a) * outer);
      ctx.stroke();
    }
    ctx.restore();

    // стрелка на фонтан
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(bearing - yaw);
    ctx.fillStyle = '#ff7a59';
    ctx.beginPath();
    ctx.moveTo(0, -r + 6);
    ctx.lineTo(7, -r + 22);
    ctx.lineTo(0, -r + 17);
    ctx.lineTo(-7, -r + 22);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  return {
    update(camera, player = null) {
      const dx = camera.position.x;
      const dz = camera.position.z;
      const dist = Math.hypot(dx, dz);
      const bearing = Math.atan2(-dx, -dz);       // азимут от игрока к центру
      const angle = Math.atan2(FOUNTAIN_HEIGHT - camera.position.y, Math.max(dist, 0.001)) * 180 / Math.PI;

      el.dist.textContent = `${fmt(dist)} м`;
      el.angle.textContent = `${fmt(angle)}°`;
      el.height.textContent = `${fmt(camera.position.y)} м`;

      const inWater = !!(player?.swimming || player?.underwater);
      el.oxygen?.classList.toggle('active', inWater);
      if (el.oxygenFill && el.oxygenText && inWater) {
        const ratio = Math.max(0, Math.min(1, player.oxygenRatio));
        el.oxygenFill.style.width = `${ratio * 100}%`;
        el.oxygen.classList.toggle('low', ratio < 0.28);
        el.oxygenText.textContent = player.underwater
          ? `${Math.ceil(player.oxygen)} СЕК`
          : 'НА ПОВЕРХНОСТИ';
      }
      if (el.mode && player?.swimming) el.mode.textContent = 'плавание';
      else if (el.mode && player?.mode) {
        const names = { walk: 'пешком', fly: 'полёт', cinematic: 'облёт' };
        el.mode.textContent = names[player.mode] || player.mode;
      }

      drawCompass(camera.rotation.y, bearing);
    },
    setWorldClock(dayPhaseSeconds, isNight) {
      if (!el.worldClock) return;
      const gameMinutes = (6 * 60 + Math.floor(Math.max(0, Number(dayPhaseSeconds) || 0))) % (24 * 60);
      const hours = String(Math.floor(gameMinutes / 60)).padStart(2, '0');
      const minutes = String(gameMinutes % 60).padStart(2, '0');
      const label = `${hours}:${minutes} · ${isNight ? 'НОЧЬ' : 'ДЕНЬ'}`;
      if (label === lastClockText) return;
      lastClockText = label;
      el.worldClock.textContent = label;
      el.worldClock.classList.toggle('night', !!isNight);
    },
    setMode(mode) {
      const names = { walk: 'пешком', fly: 'полёт', cinematic: 'облёт' };
      el.mode.textContent = names[mode] || mode;
      this.toast(
        mode === 'fly' ? 'Режим полёта: WASD + мышь, Space / Ctrl — высота, Shift — скорость'
          : mode === 'cinematic' ? 'Кинематографичный облёт — любой WASD возвращает управление'
            : 'Режим пешехода'
      );
    },
    toast(msg) {
      el.toast.textContent = msg;
      el.toast.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => el.toast.classList.remove('show'), 3200);
    },
    scale: { fountain: FOUNTAIN_HEIGHT, player: PLAYER_HEIGHT, factor: SCALE_FACTOR },
  };
}
