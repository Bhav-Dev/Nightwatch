/**
 * The last few things that went wrong when listening back, kept in memory for Settings in test
 * builds, so a play button that does nothing can be explained without a computer attached.
 */
const KEEP = 30;
const lines: string[] = [];

export function logPlayback(line: string): void {
  const t = new Date();
  const hh = String(t.getHours()).padStart(2, '0');
  const mm = String(t.getMinutes()).padStart(2, '0');
  const ss = String(t.getSeconds()).padStart(2, '0');
  lines.push(`${hh}:${mm}:${ss} ${line}`);
  if (lines.length > KEEP) lines.shift();
}

/** Newest first. */
export function playbackLog(): readonly string[] {
  return [...lines].reverse();
}
