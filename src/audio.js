/** Процедурный звук: шум падающей воды + ветер, без внешних файлов. */
export function createAmbience() {
  let ctx = null;
  let master = null;
  let waterGain = null;
  let enabled = true;
  let started = false;

  function noiseBuffer(seconds = 3) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  function start() {
    if (started) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    started = true;

    master = ctx.createGain();
    master.gain.value = 0.0;
    master.connect(ctx.destination);

    const buf = noiseBuffer(4);

    // ровный шум падающей воды
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1150; bp.Q.value = 0.55;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 3200;
    waterGain = ctx.createGain();
    waterGain.gain.value = 0.5;
    src.connect(bp); bp.connect(lp); lp.connect(waterGain); waterGain.connect(master);

    // низкий гул
    const src2 = ctx.createBufferSource();
    src2.buffer = buf; src2.loop = true;
    const lp2 = ctx.createBiquadFilter();
    lp2.type = 'lowpass'; lp2.frequency.value = 260;
    const g2 = ctx.createGain(); g2.gain.value = 0.32;
    src2.connect(lp2); lp2.connect(g2); g2.connect(master);

    // ветер
    const src3 = ctx.createBufferSource();
    src3.buffer = buf; src3.loop = true;
    const lp3 = ctx.createBiquadFilter();
    lp3.type = 'lowpass'; lp3.frequency.value = 620;
    const g3 = ctx.createGain(); g3.gain.value = 0.10;
    src3.connect(lp3); lp3.connect(g3); g3.connect(master);

    // медленное «дыхание» фильтра
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 260;
    lfo.connect(lfoGain); lfoGain.connect(bp.frequency);
    lfo.start();

    src.start(); src2.start(); src3.start();
    master.gain.linearRampToValueAtTime(0.55, ctx.currentTime + 2.5);
  }

  return {
    start() {
      if (!started) start();
      if (ctx && ctx.state === 'suspended') ctx.resume();
    },
    toggle() {
      enabled = !enabled;
      if (master) {
        master.gain.cancelScheduledValues(ctx.currentTime);
        master.gain.linearRampToValueAtTime(enabled ? 0.55 : 0.0, ctx.currentTime + 0.4);
      }
      return enabled;
    },
    get enabled() { return enabled; },
    /** Громкость зависит от близости к фонтану. */
    setDistance(d) {
      if (!waterGain || !ctx) return;
      const near = Math.max(0, Math.min(1, 1 - (d - 25) / 140));
      waterGain.gain.setTargetAtTime(0.22 + near * 0.85, ctx.currentTime, 0.4);
    },
  };
}
