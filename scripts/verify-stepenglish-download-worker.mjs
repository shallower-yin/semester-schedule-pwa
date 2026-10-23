import assert from 'node:assert/strict';
import worker from '../workers/pwa/index.mjs';

const prefix = 'https://schedule.nfsg.eu.cc/updates/stepenglish/';
const key = 'android/1.5.2/StepEnglish-v1.5.2.apk';
const calls = [];
const metadata = { size: 10, httpEtag: '"verified-apk"' };
const env = {
  ASSETS: { async fetch(request) { return new Response(`asset:${new URL(request.url).pathname}`); } },
  STEPENGLISH_RELEASES: {
    async head(objectKey) { calls.push(['head', objectKey]); return objectKey === key || objectKey === 'android/latest.json' ? metadata : null; },
    async get(objectKey, options) {
      calls.push(['get', objectKey, options]);
      const bytes = '0123456789';
      const range = options?.range;
      return { ...metadata, body: new Response(range ? bytes.slice(range.offset, range.offset + range.length) : bytes).body };
    },
  },
};
const request = (path, options) => worker.fetch(new Request(prefix + path, options), env);

assert.equal(await (await worker.fetch(new Request('https://schedule.nfsg.eu.cc/'), env)).text(), 'asset:/');
for (const path of ['private/secrets', 'windows/1.5.2/setup.exe', 'android/1.5.2/other.apk', 'android/1.5.2/StepEnglish-v1.5.1.apk']) {
  const before = calls.length;
  assert.equal((await request(path)).status, 404);
  assert.equal(calls.length, before, 'Unknown keys must not reach R2');
}
assert.equal((await request(key, { method: 'POST' })).status, 405);
const preflight = await request(key, { method: 'OPTIONS' });
assert.equal(preflight.status, 204);
assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), '*');
const full = await request(key);
assert.equal(full.status, 200);
assert.equal(full.headers.get('Content-Length'), '10');
assert.equal(await full.text(), '0123456789');
for (const [header, expected, contentRange] of [
  ['bytes=2-5', '2345', 'bytes 2-5/10'], ['bytes=7-', '789', 'bytes 7-9/10'], ['bytes=-2', '89', 'bytes 8-9/10'],
]) {
  const response = await request(key, { headers: { Range: header, 'If-Range': metadata.httpEtag } });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('Content-Range'), contentRange);
  assert.equal(await response.text(), expected);
}
for (const range of ['bytes=11-', 'bytes=-0', 'bytes=5-2', 'bytes=0-1,4-5', 'invalid']) {
  assert.equal((await request(key, { headers: { Range: range } })).status, 416);
}
assert.equal((await request(key, { headers: { 'If-Match': '"changed"' } })).status, 412);
assert.equal((await request(key, { headers: { 'If-None-Match': metadata.httpEtag } })).status, 304);
assert.equal(await (await request(key, { headers: { Range: 'bytes=2-', 'If-Range': '"changed"' } })).text(), '0123456789');
const head = await request(key, { method: 'HEAD', headers: { Range: 'bytes=2-' } });
assert.equal(head.status, 200);
assert.equal(head.headers.get('Content-Length'), '10');
assert.equal(await head.text(), '');
const manifest = await request('android/latest.json');
assert.equal(manifest.headers.get('Cache-Control'), 'no-store, max-age=0');
assert.match(manifest.headers.get('Content-Type'), /application\/json/);
assert.equal((await request('android/9.9.9/StepEnglish-v9.9.9.apk')).status, 404);
assert.equal((await worker.fetch(new Request(prefix + key), { ...env, STEPENGLISH_RELEASES: { async head() { throw new Error('unavailable'); } } })).status, 503);
console.log('StepEnglish download worker: asset routing, key isolation, GET/HEAD/CORS, resumable ranges, conditional requests and failures passed');
