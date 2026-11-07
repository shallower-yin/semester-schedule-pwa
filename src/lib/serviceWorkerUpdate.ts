const DEFAULT_WAIT_TIMEOUT_MS = 60_000;

/** Update and activate the current origin's waiting worker in one user action. */
export async function activateWaitingServiceWorker(timeoutMs = DEFAULT_WAIT_TIMEOUT_MS): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) throw new Error("当前页面尚未注册后台更新服务。");

  if (!registration.waiting) {
    if (!registration.installing) await registration.update();
    await waitForWaitingWorker(registration, timeoutMs);
  }
  const waiting = registration.waiting;
  if (!waiting) throw new Error("新版本尚未准备好，请稍后重试。");

  await new Promise<void>((resolve, reject) => {
    let timer: number | undefined;
    const cleanup = () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      if (timer !== undefined) window.clearTimeout(timer);
    };
    const onControllerChange = () => {
      // Ignore a controllerchange from another registration. The target worker
      // must be the active worker before the page is reloaded.
      if (registration.active !== waiting) return;
      cleanup();
      resolve();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    timer = window.setTimeout(() => { cleanup(); reject(new Error("新版本接管超时，请稍后重试。")); }, timeoutMs);
    try {
      waiting.postMessage({ type: "SKIP_WAITING" });
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

async function waitForWaitingWorker(registration: ServiceWorkerRegistration, timeoutMs: number): Promise<void> {
  if (registration.waiting) return;
  const installing = registration.installing;
  if (!installing) throw new Error("新版本尚未开始安装，请稍后重试。");
  await new Promise<void>((resolve, reject) => {
    let timer: number | undefined;
    const cleanup = () => {
      installing.removeEventListener("statechange", onStateChange);
      if (timer !== undefined) window.clearTimeout(timer);
    };
    const onStateChange = () => {
      if (installing.state === "installed" && registration.waiting) { cleanup(); resolve(); }
      else if (installing.state === "redundant") { cleanup(); reject(new Error("新版本安装失败，请稍后重试。")); }
    };
    installing.addEventListener("statechange", onStateChange);
    timer = window.setTimeout(() => { cleanup(); reject(new Error("等待新版本安装超时，请稍后重试。")); }, timeoutMs);
    onStateChange();
  });
}
