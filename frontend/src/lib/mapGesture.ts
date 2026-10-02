/** Shared tap-vs-drag suppression: a map drag ending <350ms ago eats the click. */
let lastDragEnd = 0;

export function markMapDragged() {
  lastDragEnd = Date.now();
}

export function mapDragSuppressed(): boolean {
  return Date.now() - lastDragEnd < 350;
}
