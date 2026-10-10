import type { KeySound } from "./keySounds";

/**
 * Typewriter sounds synthesized with the Web Audio API (no audio files): a filtered noise
 * "strike" for the type bar hitting the platen, a low "thud" for the body of the machine,
 * and for Enter a ratcheting carriage return followed by the margin bell.
 *
 * Every strike is slightly randomized so fast typing doesn't sound mechanical-in-a-bad-way.
 * The AudioContext is created lazily on the first keystroke, because browsers only allow
 * audio to start from a user gesture.
 */

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
let unsupportedLogged = false;

const rand = (min: number, max: number) => min + Math.random() * (max - min);

function getAudio(): { ctx: AudioContext; out: GainNode; noise: AudioBuffer } | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext;
    if (!Ctor) {
      if (!unsupportedLogged) console.warn("[sound] Web Audio is not supported in this browser");
      unsupportedLogged = true;
      return null;
    }
    ctx = new Ctor({ latencyHint: "interactive" });
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
    // Half a second of white noise, reused for every strike from a random offset.
    noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === "suspended") {
    ctx.resume().catch((err: unknown) => console.warn("[sound] could not resume audio:", err));
  }
  return master && noise ? { ctx, out: master, noise } : null;
}

interface BurstOptions {
  filter: BiquadFilterType;
  freq: number;
  q: number;
  gain: number;
  decay: number;
}

/** A short burst of filtered noise with a fast attack and exponential decay. */
function burst(a: NonNullable<ReturnType<typeof getAudio>>, at: number, o: BurstOptions) {
  const src = a.ctx.createBufferSource();
  src.buffer = a.noise;
  const filter = a.ctx.createBiquadFilter();
  filter.type = o.filter;
  filter.frequency.value = o.freq;
  filter.Q.value = o.q;
  const env = a.ctx.createGain();
  env.gain.setValueAtTime(0.0001, at);
  env.gain.exponentialRampToValueAtTime(o.gain, at + 0.0015);
  env.gain.exponentialRampToValueAtTime(0.0001, at + o.decay);
  src.connect(filter).connect(env).connect(a.out);
  src.start(at, rand(0, 0.4), o.decay + 0.02);
}

/** A low, quickly decaying tone: the machine's body resonating. */
function thud(a: NonNullable<ReturnType<typeof getAudio>>, at: number, freq: number, gain: number, decay: number) {
  const osc = a.ctx.createOscillator();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(freq, at);
  osc.frequency.exponentialRampToValueAtTime(freq * 0.6, at + decay);
  const env = a.ctx.createGain();
  env.gain.setValueAtTime(0.0001, at);
  env.gain.exponentialRampToValueAtTime(gain, at + 0.002);
  env.gain.exponentialRampToValueAtTime(0.0001, at + decay);
  osc.connect(env).connect(a.out);
  osc.start(at);
  osc.stop(at + decay + 0.02);
}

/** The margin bell: two inharmonic partials ringing out. */
function bell(a: NonNullable<ReturnType<typeof getAudio>>, at: number) {
  for (const [freq, gain] of [
    [2093, 0.22],
    [5230, 0.06],
  ] as const) {
    const osc = a.ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;
    const env = a.ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(gain, at + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, at + 1.1);
    osc.connect(env).connect(a.out);
    osc.start(at);
    osc.stop(at + 1.15);
  }
}

export function playKeySound(kind: KeySound): void {
  const a = getAudio();
  if (!a) return;
  const t = a.ctx.currentTime + 0.001;

  switch (kind) {
    case "key":
      burst(a, t, { filter: "bandpass", freq: rand(2600, 3800), q: 1.4, gain: rand(0.55, 0.8), decay: rand(0.035, 0.05) });
      burst(a, t, { filter: "highpass", freq: 6500, q: 0.7, gain: 0.25, decay: 0.012 });
      thud(a, t, rand(150, 190), 0.35, 0.06);
      break;
    case "space":
      burst(a, t, { filter: "bandpass", freq: rand(900, 1200), q: 1.1, gain: 0.5, decay: 0.07 });
      thud(a, t, rand(95, 115), 0.45, 0.09);
      break;
    case "backspace":
      burst(a, t, { filter: "bandpass", freq: rand(1700, 2100), q: 1.6, gain: 0.35, decay: 0.03 });
      thud(a, t, 140, 0.2, 0.05);
      break;
    case "return": {
      // Carriage return: a ratchet of rapid clicks while the carriage slides back…
      const clicks = 9;
      for (let i = 0; i < clicks; i++) {
        burst(a, t + i * 0.022, { filter: "bandpass", freq: 1400 + i * 120, q: 2, gain: 0.22, decay: 0.018 });
      }
      // …a clunk as it hits the stop, then the bell.
      const end = t + clicks * 0.022;
      burst(a, end, { filter: "bandpass", freq: 700, q: 1, gain: 0.6, decay: 0.09 });
      thud(a, end, 85, 0.5, 0.12);
      bell(a, end + 0.015);
      break;
    }
  }
}
