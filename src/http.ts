const DEFAULT_TIMEOUT_MS = 15_000;

export interface HttpTarget {
  serverUrl: string;
  authHeader: string;
}

export async function oneDevGetJson(
  target: HttpTarget,
  pathAndQuery: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<any> {
  const url = `${target.serverUrl}${pathAndQuery}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: target.authHeader, Accept: 'application/json' },
      signal: controller.signal,
    });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error(`OneDev request timed out after ${timeoutMs}ms: GET ${pathAndQuery}`);
    }
    throw new Error(`OneDev request failed: GET ${pathAndQuery}: ${err?.message ?? err}`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const snippet = (await res.text().catch(() => '')).slice(0, 200);
    throw new Error(`OneDev HTTP ${res.status} for GET ${pathAndQuery}: ${snippet}`);
  }
  try {
    return await res.json();
  } catch {
    throw new Error(
      `OneDev returned a non-JSON response for GET ${pathAndQuery} — check that Server URL points at a OneDev server`,
    );
  }
}
