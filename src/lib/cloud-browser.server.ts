const API_URL = "https://api.browser-use.com/api/v4/browsers";

export type CloudBrowserResult = { status: "completed" | "error"; result: Record<string, unknown> };

const owned = new WeakMap<AbortSignal, Set<string>>();

function track(signal: AbortSignal): Set<string> {
  let ids = owned.get(signal);
  if (!ids) {
    ids = new Set<string>();
    owned.set(signal, ids);
  }
  return ids;
}

function apiKey(): string {
  const key = process.env["BROWSER_USE_API_KEY"];
  if (!key) throw new Error("A BROWSER_USE_API_KEY nincs beállítva.");
  return key;
}

async function call(path: string, method: string, body: unknown, signal: AbortSignal): Promise<Record<string, unknown>> {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: { "X-Browser-Use-API-Key": apiKey(), "Content-Type": "application/json" },
    body: body === undefined ? null : JSON.stringify(body),
    signal,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Browser Use (${response.status}): ${text.slice(0, 500)}`);
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

function failure(error: unknown): CloudBrowserResult {
  return { status: "error", result: { code: "CLOUD_BROWSER_FAILED", message: error instanceof Error ? error.message : "A felhőböngésző hibával leállt." } };
}

export async function startCloudBrowser(countryCode: string, timeoutMinutes: number, signal: AbortSignal): Promise<CloudBrowserResult> {
  try {
    const browser = await call("", "POST", { proxyCountryCode: countryCode || "us", timeout: Math.min(240, Math.max(1, timeoutMinutes || 240)), allowResizing: true, enableRecording: true }, signal);
    const id = String(browser.id ?? "");
    if (!id || !browser.cdpUrl) throw new Error("A böngésző nem adott vissza CDP címet.");
    track(signal).add(id);
    return { status: "completed", result: { browser_id: id, cdp_url: browser.cdpUrl, live_url: browser.liveUrl ?? null, usage: "Csatlakozz a VM-ből Playwrighttal: chromium.connect_over_cdp(cdp_url). Munka végén hívd a cloud_browser_stop eszközt." } };
  } catch (error) {
    return failure(error);
  }
}

export async function stopCloudBrowser(id: string, signal: AbortSignal): Promise<CloudBrowserResult> {
  try {
    await call(`/${encodeURIComponent(id)}`, "PATCH", { action: "stop" }, signal);
    track(signal).delete(id);
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      const state = await call(`/${encodeURIComponent(id)}`, "GET", undefined, signal);
      if (state.recordingUrl) return { status: "completed", result: { browser_id: id, stopped: true, recording_url: state.recordingUrl } };
      if (state.recordingAvailable === false) return { status: "completed", result: { browser_id: id, stopped: true, recording_url: null } };
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    return { status: "completed", result: { browser_id: id, stopped: true, recording_url: null, message: "A felvétel még feldolgozás alatt van." } };
  } catch (error) {
    return failure(error);
  }
}

export async function stopAllCloudBrowsers(signal: AbortSignal): Promise<void> {
  const set = track(signal);
  const ids = [...set];
  await Promise.allSettled(ids.map(async (id) => {
    await call(`/${encodeURIComponent(id)}`, "PATCH", { action: "stop" }, new AbortController().signal);
    set.delete(id);
  }));
}
