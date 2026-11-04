// Minimal next/server surface for eval runs. The loop uses only after() and
// already falls back to immediate execution when it throws outside a request.
export function after(task: () => Promise<void> | void) {
  void task();
}
