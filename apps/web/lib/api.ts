/** Calls the API from the browser; resolves to the JSON body or throws the API's Spanish message. */
export async function postJson<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) throw new Error(data?.error ?? 'Algo salió mal. Intenta de nuevo.');
  return data as T;
}
