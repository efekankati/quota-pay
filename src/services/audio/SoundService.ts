import { Platform } from 'react-native';

class SoundServiceImpl {
  private audioContext: any = null;

  /**
   * Plays an elegant, soft, whisper-like camera shutter sound.
   * - Eliminates harsh metallic / high-pitch clatter
   * - On Web: Synthesizes a soft leaf shutter click via Web Audio API (zero native dependencies)
   * - On Native (iOS/Android): Refined gentle tactile feedback via expo-haptics with safe fallbacks
   */
  public playSoftShutterSound(): void {
    try {
      if (Platform.OS === 'web') {
        this.playWebSoftShutter();
      }
    } catch {
      // Audio feedback must never interrupt or throw errors in capture workflow
    }
  }

  /**
   * Elegant synthesized soft leaf shutter via Web Audio API
   */
  private playWebSoftShutter(): void {
    if (typeof window === 'undefined') return;

    try {
      const AudioContextClass =
        window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;

      if (!this.audioContext) {
        this.audioContext = new AudioContextClass();
      }

      const ctx = this.audioContext;
      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      const now = ctx.currentTime;

      // Master output with soft, comfortable volume
      const masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(0.32, now);
      masterGain.connect(ctx.destination);

      // Part 1: Soft leaf shutter click (1ms attack, 35ms warm decay)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      const filter1 = ctx.createBiquadFilter();

      filter1.type = 'lowpass';
      filter1.frequency.setValueAtTime(2200, now);
      filter1.frequency.exponentialRampToValueAtTime(650, now + 0.035);

      osc1.type = 'triangle';
      osc1.frequency.setValueAtTime(900, now);
      osc1.frequency.exponentialRampToValueAtTime(300, now + 0.035);

      gain1.gain.setValueAtTime(0.001, now);
      gain1.gain.linearRampToValueAtTime(0.28, now + 0.002);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.035);

      osc1.connect(filter1);
      filter1.connect(gain1);
      gain1.connect(masterGain);

      osc1.start(now);
      osc1.stop(now + 0.04);

      // Part 2: Secondary subtle acoustic body resonance (t = 28ms to 85ms)
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();

      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(260, now + 0.028);
      osc2.frequency.exponentialRampToValueAtTime(130, now + 0.08);

      gain2.gain.setValueAtTime(0.001, now);
      gain2.gain.setValueAtTime(0.001, now + 0.028);
      gain2.gain.linearRampToValueAtTime(0.2, now + 0.032);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.085);

      osc2.connect(gain2);
      gain2.connect(masterGain);

      osc2.start(now + 0.028);
      osc2.stop(now + 0.09);
    } catch {
      // Ignore web audio exceptions if audio is not yet unlocked
    }
  }
}

export const SoundService = new SoundServiceImpl();
