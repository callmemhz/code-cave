export function debounce<A extends unknown[]>(
  fn: (...a: A) => void, ms: number,
): (...a: A) => void {
  let t: ReturnType<typeof setTimeout> | null = null;
  return (...args: A) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
