// Sound notification utility
type SoundType = "success" | "error" | "warning" | "info" | "default";

const soundContext = new (class {
  private audioContext: AudioContext | null = null;
  private enabled = true;
  private volume = 0.5;

  private getContext(): AudioContext {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    }
    return this.audioContext;
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
  }

  setVolume(volume: number) {
    this.volume = Math.max(0, Math.min(1, volume));
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  play(type: SoundType) {
    if (!this.enabled) return;
    const ctx = this.getContext();
    if (ctx.state === "suspended") ctx.resume();

    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    // Different tones for different notification types
    const frequencies: Record<SoundType, { freq: number; type: OscillatorType; pattern: number[] }> = {
      success: { freq: 880, type: "sine", pattern: [0, 0.15, 0.3] },      // A5 - pleasant chime
      error: { freq: 220, type: "square", pattern: [0, 0.1, 0.2, 0.3] },  // A3 - alert
      warning: { freq: 440, type: "triangle", pattern: [0, 0.2, 0.4] },   // A4 - attention
      info: { freq: 660, type: "sine", pattern: [0, 0.2] },               // E5 - gentle
      default: { freq: 523, type: "sine", pattern: [0] },                 // C5 - simple
    };

    const { freq, type: oscType, pattern = [0] } = frequencies[type];
    oscillator.type = oscType;
    oscillator.frequency.value = freq;
    gainNode.gain.value = 0;

    const now = ctx.currentTime;
    pattern.forEach((delay) => {
      const time = now + delay;
      gainNode.gain.setValueAtTime(0, time);
      gainNode.gain.linearRampToValueAtTime(this.volume * 0.3, time + 0.02);
      gainNode.gain.exponentialRampToValueAtTime(0.001, time + 0.15);
    });

    oscillator.start(now);
    const lastDelay = pattern[pattern.length - 1] ?? 0;
    oscillator.stop(now + lastDelay + 0.2);
  }
})();

export function playNotificationSound(type: SoundType) {
  soundContext.play(type);
}

export function setSoundEnabled(enabled: boolean) {
  soundContext.setEnabled(enabled);
}

export function isSoundEnabled(): boolean {
  return soundContext.isEnabled();
}

export function setSoundVolume(volume: number) {
  soundContext.setVolume(volume);
}