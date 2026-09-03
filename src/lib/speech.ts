/** Two-voice briefing playback on the browser's Web Speech API (no server audio needed). */

export interface BriefingLine { speaker: "Analyst" | "Advisor"; line: string }

function pickVoices(): { analyst: SpeechSynthesisVoice | null; advisor: SpeechSynthesisVoice | null } {
  const voices = window.speechSynthesis?.getVoices?.() ?? [];
  const en = voices.filter((v) => v.lang.toLowerCase().startsWith("en"));
  const pool = en.length ? en : voices;
  const prefer = (names: string[]) => pool.find((v) => names.some((n) => v.name.toLowerCase().includes(n))) ?? null;
  const analyst = prefer(["samantha", "google us english", "zira", "aria", "jenny", "female"]) ?? pool[0] ?? null;
  const advisor = prefer(["daniel", "google uk english male", "david", "guy", "alex", "male"]) ?? pool.find((v) => v !== analyst) ?? analyst;
  return { analyst, advisor };
}

export function supportsSpeech(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

export function speakBriefing(lines: BriefingLine[], onLine: (index: number) => void, onEnd: () => void): () => void {
  const synth = window.speechSynthesis;
  synth.cancel();
  let cancelled = false;
  const { analyst, advisor } = pickVoices();

  const speakAt = (i: number) => {
    if (cancelled || i >= lines.length) { onEnd(); return; }
    const u = new SpeechSynthesisUtterance(lines[i].line);
    const voice = lines[i].speaker === "Analyst" ? analyst : advisor;
    if (voice) u.voice = voice;
    u.rate = 1.02;
    u.pitch = lines[i].speaker === "Analyst" ? 1.05 : 0.92;
    u.onstart = () => onLine(i);
    u.onend = () => speakAt(i + 1);
    u.onerror = () => speakAt(i + 1);
    synth.speak(u);
  };

  // Voices load asynchronously on some browsers.
  if (synth.getVoices().length === 0) {
    const once = () => { synth.removeEventListener("voiceschanged", once); speakAt(0); };
    synth.addEventListener("voiceschanged", once);
    setTimeout(() => { synth.removeEventListener("voiceschanged", once); if (!cancelled) speakAt(0); }, 600);
  } else {
    speakAt(0);
  }

  return () => { cancelled = true; synth.cancel(); };
}
