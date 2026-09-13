// Abort the actual HTTP operation, including reading the body. No orphaned races.
function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  return fetch(url, { ...options, signal });
}

module.exports = { fetchWithTimeout };
