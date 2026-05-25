import type { SettingsSnapshot } from "@shared/ipc/contracts";

export function playCompletionSound(soundId: SettingsSnapshot["taskCompletionSoundId"]): void {
  const audioWindow = window as Window & {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  const AudioContextConstructor = audioWindow.AudioContext ?? audioWindow.webkitAudioContext;

  if (!AudioContextConstructor) {
    return;
  }

  const context = new AudioContextConstructor();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const frequency = soundId === "pop" ? 420 : soundId === "chime" ? 660 : soundId === "click" ? 320 : 520;

  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(0.08, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.16);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.18);
}
