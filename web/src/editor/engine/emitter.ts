/** A small typed event hub. Handlers added or removed while an event is being delivered take effect on the next one. */
export class Emitter<Events extends { [K in keyof Events]: (...args: never[]) => void }> {
  private handlers: { [K in keyof Events]?: Set<Events[K]> } = {};

  on<K extends keyof Events>(event: K, handler: Events[K]): () => void {
    const set = (this.handlers[event] ??= new Set<Events[K]>());
    set.add(handler);
    return () => set.delete(handler);
  }

  emit<K extends keyof Events>(event: K, ...args: Parameters<Events[K]>): void {
    const set = this.handlers[event];
    if (!set) return;
    for (const handler of [...set]) handler(...args);
  }

  clear(): void {
    this.handlers = {};
  }
}
