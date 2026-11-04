import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { isPrivateAddress, relayFetch, validatePublicRelayBaseUrl } from "./publicRelayUrl.ts";

Deno.test("relay guard covers normalized mapped and transition addresses and DNS failures", async () => {
  for (const address of ["[::ffff:7f00:1]", "[0:0:0:0:0:ffff:a00:1]", "[::ffff:c0a8:101]", "[::ffff:ac10:1]", "[::1]", "[64:ff9b::7f00:1]", "[2002:7f00:1::]"]) assertEquals(isPrivateAddress(address), true, address);
  const dns = Deno.resolveDns;
  try {
    Deno.resolveDns = (async () => { throw new Error("offline"); }) as typeof Deno.resolveDns;
    await assertRejects(() => validatePublicRelayBaseUrl("https://missing.example/v1"));
    for (const host of ["[::ffff:127.0.0.1]", "[::ffff:10.0.0.1]", "2130706433", "0x7f000001"]) await assertRejects(() => validatePublicRelayBaseUrl(`https://${host}/v1`));
    assertEquals(await validatePublicRelayBaseUrl("https://93.184.216.34/v1"), "https://93.184.216.34/v1");
    Deno.resolveDns = (async (_name: string, type: string) => type === "AAAA" ? ["::ffff:7f00:1"] : ["93.184.216.34"]) as typeof Deno.resolveDns;
    await assertRejects(() => validatePublicRelayBaseUrl("https://mixed.example/v1"));
  } finally { Deno.resolveDns = dns; }
});

Deno.test("provider HTTP disallows redirects and preserves successful responses", async () => {
  const previous = globalThis.fetch;
  try {
    globalThis.fetch = ((_input: unknown, init?: RequestInit) => {
      assertEquals(init?.redirect, "error");
      return Promise.reject(new TypeError("redirect disallowed"));
    }) as typeof fetch;
    await assertRejects(() => relayFetch("https://public.example", { redirect: "follow" }), TypeError);
    globalThis.fetch = ((_input: unknown, init?: RequestInit) => { assertEquals(init?.redirect, "error"); return Promise.resolve(Response.json({ ok: true })); }) as typeof fetch;
    assertEquals(await (await relayFetch("https://public.example")).json(), { ok: true });
  } finally { globalThis.fetch = previous; }
});
