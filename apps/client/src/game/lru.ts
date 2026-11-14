/**
 * Caché LRU acotada (PURA). `onEvict` libera lo que sale (p. ej. `texture.dispose()` de las etiquetas del mapa
 * solar), también al vaciarla con `clear()`.
 */
export class LruCache<K, V> {
  private readonly map = new Map<K, V>();
  constructor(
    readonly capacity: number,
    private readonly onEvict: (value: V, key: K) => void = () => {},
  ) {}

  get size(): number {
    return this.map.size;
  }

  get(key: K): V | undefined {
    const v = this.map.get(key);
    if (v === undefined) return undefined;
    // Usado: pasa al final (el más reciente).
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }

  set(key: K, value: V): void {
    const old = this.map.get(key);
    if (old !== undefined) {
      this.map.delete(key);
      if (old !== value) this.onEvict(old, key);
    }
    this.map.set(key, value);
    while (this.map.size > Math.max(0, this.capacity)) {
      const oldest = this.map.keys().next();
      if (oldest.done) break;
      const v = this.map.get(oldest.value)!;
      this.map.delete(oldest.value);
      this.onEvict(v, oldest.value);
    }
  }

  clear(): void {
    for (const [k, v] of this.map) this.onEvict(v, k);
    this.map.clear();
  }
}
