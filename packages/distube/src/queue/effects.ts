/** @internal */
export function runDetachedEffect(effect: () => void | Promise<void>, report: (error: unknown) => void): void {
  queueMicrotask(() => {
    void Promise.resolve().then(effect).catch(report);
  });
}
