// bus — 宿主事件总线。插件处理器抛错只影响自己，不阻断主程序。

export function createBus({ onError } = {}) {
  const listeners = new Map();

  function on(event, handler) {
    if (typeof handler !== 'function') throw new Error('事件处理器必须是函数');
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(handler);
    return () => off(event, handler);
  }

  function off(event, handler) {
    const set = listeners.get(event);
    if (!set) return false;
    const removed = set.delete(handler);
    if (set.size === 0) listeners.delete(event);
    return removed;
  }

  function once(event, handler) {
    const wrapped = (...args) => {
      off(event, wrapped);
      handler(...args);
    };
    return on(event, wrapped);
  }

  function emit(event, ...args) {
    let failures = 0;
    for (const fn of [...(listeners.get(event) || [])]) {
      try {
        fn(...args);
      } catch (err) {
        failures += 1;
        try {
          onError?.(event, err);
        } catch {
          console.warn('[pt] bus error handler failed');
        }
      }
    }
    return failures;
  }

  return {
    on,
    off,
    once,
    emit,
    listenerCount: (event) => (listeners.get(event)?.size || 0),
    eventNames: () => [...listeners.keys()],
  };
}

export const bus = createBus();
