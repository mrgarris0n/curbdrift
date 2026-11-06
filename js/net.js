// An AbortSignal for one request: aborts after timeoutMs, or as soon as `outer` aborts (e.g. the
// survey it belongs to was superseded). Built on AbortController alone because AbortSignal.timeout
// is missing before Safari/iOS 16 and AbortSignal.any before 17.4.
export function requestSignal(timeoutMs, outer) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('request timed out', 'TimeoutError')), timeoutMs);
  const stop = () => clearTimeout(timer);
  controller.signal.addEventListener('abort', stop, { once: true });
  if (outer) {
    if (outer.aborted) controller.abort(outer.reason);
    else outer.addEventListener('abort', () => controller.abort(outer.reason), { once: true, signal: controller.signal });
  }
  return controller.signal;
}
