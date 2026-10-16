// 아주 작은 이벤트 버스. 이벤트 이름 목록은 docs/ARCHITECTURE.md 참고.

export class EventBus {
  constructor() {
    this.map = new Map();
  }
  /** 구독. 해제 함수를 돌려준다 */
  on(name, fn) {
    if (!this.map.has(name)) this.map.set(name, new Set());
    this.map.get(name).add(fn);
    return () => this.off(name, fn);
  }
  once(name, fn) {
    const off = this.on(name, (p) => {
      off();
      fn(p);
    });
    return off;
  }
  off(name, fn) {
    this.map.get(name)?.delete(fn);
  }
  emit(name, payload = {}) {
    const set = this.map.get(name);
    if (set) {
      for (const fn of [...set]) {
        try {
          fn(payload);
        } catch (err) {
          console.error(`[event ${name}]`, err);
        }
      }
    }
    const any = this.map.get('*');
    if (any) for (const fn of [...any]) fn(name, payload);
  }
}
