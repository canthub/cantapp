export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export async function api(path, { method = 'GET', body, form } = {}) {
  const opts = { method, headers: { 'X-Requested-With': 'cantapp' }, credentials: 'same-origin' };
  if (form) opts.body = form;
  else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(`/api${path}`, opts);
  } catch {
    throw new ApiError('Nincs internetkapcsolat. Próbáld újra!', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `Hiba történt (${res.status}).`, res.status);
  return data;
}

export function toast(message, type = 'ok') {
  window.dispatchEvent(new CustomEvent('app-toast', { detail: { message, type } }));
}
