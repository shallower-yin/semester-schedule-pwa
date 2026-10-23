const PREFIX = '/updates/stepenglish/';
const VERSION = /^\d+\.\d+\.\d+(?:[.+-][0-9A-Za-z.-]+)?$/;

function publicHeaders() {
  return new Headers({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Range, If-Range, If-Match, If-None-Match',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, ETag',
    'X-Content-Type-Options': 'nosniff',
  });
}

function releaseKey(pathname) {
  const key = pathname.slice(PREFIX.length);
  if (key === 'android/latest.json') return key;
  const parts = key.split('/');
  if (parts.length === 3 && parts[0] === 'android' && VERSION.test(parts[1])
    && parts[2] === `StepEnglish-v${parts[1]}.apk`) return key;
  return null;
}

function byteRange(value, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value || '');
  if (!match || !size || !match[1] && !match[2]) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= size) return null;
  return { offset: start, length: end - start + 1 };
}

async function rangedScheduleApk(request, env) {
  if (request.method !== 'GET' || !request.headers.has('Range')) return env.ASSETS.fetch(request);
  // Workers Static Assets can return the full file for a Range request. Keep
  // first downloads streaming, and slice only these small, versioned APKs for
  // a resume. SHA verification in the client still covers the complete file.
  const cleanHeaders = new Headers(request.headers);
  for (const name of ['Range', 'If-Range', 'If-Match', 'If-None-Match']) cleanHeaders.delete(name);
  const full = await env.ASSETS.fetch(new Request(request.url, { method: 'GET', headers: cleanHeaders }));
  if (full.status !== 200) return full;
  const headers = new Headers(full.headers);
  const etag = headers.get('ETag');
  const ifMatch = request.headers.get('If-Match');
  if (ifMatch && ifMatch !== '*' && ifMatch !== etag) {
    await full.body?.cancel();
    return new Response(null, { status: 412, headers: publicHeaders() });
  }
  const ifRange = request.headers.get('If-Range');
  if (ifRange && ifRange !== etag) return full;
  const bytes = await full.arrayBuffer();
  const range = byteRange(request.headers.get('Range'), bytes.byteLength);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Expose-Headers', 'ETag, Content-Range, Accept-Ranges, Content-Length');
  if (!range) {
    headers.delete('Content-Length');
    headers.set('Content-Range', `bytes */${bytes.byteLength}`);
    return new Response(null, { status: 416, headers });
  }
  headers.delete('Content-Encoding');
  headers.set('Content-Length', String(range.length));
  headers.set('Content-Range', `bytes ${range.offset}-${range.offset + range.length - 1}/${bytes.byteLength}`);
  return new Response(bytes.slice(range.offset, range.offset + range.length), { status: 206, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (/^\/android\/semester-schedule-v[1-9]\d*\.apk$/.test(url.pathname)) return rangedScheduleApk(request, env);
    if (!url.pathname.startsWith(PREFIX)) return env.ASSETS.fetch(request);
    const headers = publicHeaders();
    headers.set('Cache-Control', 'no-store, max-age=0');
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405, headers });
    const key = releaseKey(url.pathname);
    if (!key) return new Response('Not found', { status: 404, headers });
    try {
      const metadata = await env.STEPENGLISH_RELEASES.head(key);
      if (!metadata) return new Response('Not found', { status: 404, headers });
      const isManifest = key.endsWith('/latest.json');
      headers.set('Content-Type', isManifest ? 'application/json; charset=utf-8' : 'application/vnd.android.package-archive');
      headers.set('Cache-Control', isManifest ? 'no-store, max-age=0' : 'public, max-age=31536000, immutable');
      headers.set('ETag', metadata.httpEtag);
      headers.set('Accept-Ranges', 'bytes');
      const ifMatch = request.headers.get('If-Match');
      if (ifMatch && ifMatch !== '*' && ifMatch !== metadata.httpEtag) return new Response(null, { status: 412, headers });
      const ifNoneMatch = request.headers.get('If-None-Match');
      if (ifNoneMatch === '*' || ifNoneMatch === metadata.httpEtag) return new Response(null, { status: 304, headers });
      const requestedRange = request.method === 'GET' ? request.headers.get('Range') : null;
      const ifRange = request.headers.get('If-Range');
      const useRange = requestedRange && (!ifRange || ifRange === metadata.httpEtag);
      const range = useRange ? byteRange(requestedRange, metadata.size) : null;
      if (useRange && !range) {
        headers.set('Content-Range', `bytes */${metadata.size}`);
        return new Response(null, { status: 416, headers });
      }
      headers.set('Content-Length', String(range?.length ?? metadata.size));
      if (request.method === 'HEAD') return new Response(null, { status: 200, headers });
      const object = await env.STEPENGLISH_RELEASES.get(key, range ? { range } : undefined);
      if (!object) return new Response('Not found', { status: 404, headers: publicHeaders() });
      if (object.httpEtag !== metadata.httpEtag) {
        await object.body.cancel();
        return new Response(null, { status: 412, headers: publicHeaders() });
      }
      if (range) headers.set('Content-Range', `bytes ${range.offset}-${range.offset + range.length - 1}/${metadata.size}`);
      return new Response(object.body, { status: range ? 206 : 200, headers });
    } catch (_) {
      return new Response('Download service unavailable', { status: 503, headers: publicHeaders() });
    }
  },
};
