/**
 * Holding an arrow key repeats it ~30 times a second, which would skip
 * minutes in a moment. Like YouTube, a held key seeks at a steady, slower
 * pace: repeats closer than `ms` apart are ignored (a fresh press always counts).
 */
let lastAt = 0;
export function heldTooSoon(e: KeyboardEvent, ms = 350): boolean {
  const now = Date.now();
  if (e.repeat && now - lastAt < ms) return true;
  lastAt = now;
  return false;
}
