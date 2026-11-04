/** Reject non-public destinations, including URL-normalized IPv4-in-IPv6. */
export function relayFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  return globalThis.fetch(input, { ...init, redirect: "error" });
}

export function isPrivateAddress(value: string): boolean {
  const address = value.toLowerCase().replace(/^\[|\]$/g, "");
  if (address.includes(":")) {
    const halves = address.split("::");
    const left = halves[0].split(":").filter(Boolean);
    const right = (halves[1] ?? "").split(":").filter(Boolean);
    const words = halves.length === 2 ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right] : left;
    if (words.length !== 8) return true;
    const n = words.map(w => Number.parseInt(w, 16));
    if (n.slice(0, 5).every(w => w === 0) && (n[5] === 0xffff || n[5] === 0)) {
      return isPrivateAddress(`${n[6] >> 8}.${n[6] & 255}.${n[7] >> 8}.${n[7] & 255}`);
    }
    // Global unicast only. Blocks loopback, link local, ULA, multicast,
    // translation/transition encodings rather than accidentally tunnelling IPv4.
    return (n[0] & 0xe000) !== 0x2000 || n[0] === 0x2002 || (n[0] === 0x2001 && n[1] === 0);
  }
  const p = address.split(".").map(Number);
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19));
}

export async function validatePublicRelayBaseUrl(value: unknown): Promise<string> {
  let url: URL;
  try { url = new URL(String(value ?? "").trim()); } catch { throw new Error("中转地址无效，请填写公网 HTTPS 基础地址。"); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("中转地址必须是无账号参数的公网 HTTPS 基础地址。");
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname === "metadata.google.internal" || isPrivateAddress(hostname)) throw new Error("中转地址不能指向本机、内网或云元数据服务。");
  if (!hostname.includes(":") && !/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    const resolved = (await Promise.all([Deno.resolveDns(hostname, "A").catch(() => [] as string[]), Deno.resolveDns(hostname, "AAAA").catch(() => [] as string[])])).flat();
    if (!resolved.length || resolved.some(isPrivateAddress)) throw new Error("中转域名无法解析为公网地址。");
  }
  return url.toString().replace(/\/+$/, "");
}
