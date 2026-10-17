import { test, vi, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { ReadableStream } from 'node:stream/web';
import { webFetchTool } from './web-fetch.js';
import {
  FetchTargetBlockedError,
  WEB_FETCH_MAX_REDIRECTS,
  assertFetchTargetAllowed,
} from '../utils/ssrf-guard.js';
import type { ToolContext } from './tool.js';
import type { WebFetchConfig } from '../core/types.js';

// DNS is mocked — the unit suite never performs a live lookup (#541).
// Hostname tests configure the resolver per case; the default answer is a
// single public IP so non-DNS tests can use hostname URLs freely.
const dnsLookupMock = vi.hoisted(() => vi.fn());
vi.mock('node:dns/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:dns/promises')>()),
  lookup: dnsLookupMock,
}));

// web_fetch is a read-only auto-approved tool — it carries no requestPermission
// gate of its own. Its permission layer is the SSRF policy gate, so the guard's
// assertFetchTargetAllowed is wrapped in a spy: the denied-path test injects a
// FetchTargetBlockedError while every other test delegates to the real check.
vi.mock('../utils/ssrf-guard.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../utils/ssrf-guard.js')>();
  return { ...mod, assertFetchTargetAllowed: vi.fn(mod.assertFetchTargetAllowed) };
});

function makeCtx(webFetch?: WebFetchConfig): ToolContext {
  return {
    workspaceRoot: '/workspace',
    config: {
      model: {
        provider: 'openai-compatible',
        baseUrl: 'http://provider.test/v1',
        model: 'test-model',
      },
      webFetch,
    },
  };
}

function stubFetch(handler: (url: string) => unknown) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    return handler(url);
  });
  return calls;
}

const exec = (args: Record<string, unknown>, ctx: ToolContext) =>
  webFetchTool.execute(args, ctx);

beforeEach(() => {
  dnsLookupMock.mockReset();
  dnsLookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  vi.mocked(assertFetchTargetAllowed).mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// SSRF protection
// ---------------------------------------------------------------------------

test('web_fetch blocks the cloud metadata IP before connect', async () => {
  const calls = stubFetch(() => new Response('internal'));
  await assert.rejects(
    exec({ url: 'http://169.254.169.254/latest/meta-data/' }, makeCtx()),
    /private\/reserved/,
  );
  assert.equal(calls.length, 0);
});

test('web_fetch blocks loopback and private literal targets', async () => {
  const calls = stubFetch(() => new Response('internal'));
  for (const url of [
    'http://127.0.0.1:8080/',
    'http://10.0.0.1/',
    'http://192.168.0.1/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[fd00::1]/',
  ]) {
    await assert.rejects(exec({ url }, makeCtx()), /private\/reserved|Blocked/, `${url}`);
  }
  assert.equal(calls.length, 0);
});

test('web_fetch re-validates every redirect hop — redirect to internal is blocked', async () => {
  const calls = stubFetch((url) =>
    url === 'http://93.184.216.34/start'
      ? new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest' } })
      : new Response('internal'),
  );
  await assert.rejects(
    exec({ url: 'http://93.184.216.34/start' }, makeCtx()),
    /private\/reserved/,
  );
  assert.equal(calls.length, 1); // the internal hop was never fetched
});

test('web_fetch blocks redirect to a private IP', async () => {
  stubFetch(() =>
    new Response(null, { status: 301, headers: { location: 'http://192.168.1.10/admin' } }),
  );
  await assert.rejects(
    exec({ url: 'http://93.184.216.34/' }, makeCtx()),
    /private\/reserved/,
  );
});

test('web_fetch rejects non-http(s) schemes without fetching', async () => {
  const calls = stubFetch(() => new Response('x'));
  await assert.rejects(exec({ url: 'file:///etc/passwd' }, makeCtx()), /scheme/);
  await assert.rejects(exec({ url: 'gopher://internal/' }, makeCtx()), /scheme/);
  assert.equal(calls.length, 0);
});

test('web_fetch rejects URLs with embedded credentials', async () => {
  const calls = stubFetch(() => new Response('x'));
  await assert.rejects(
    exec({ url: 'http://user:pw@93.184.216.34/' }, makeCtx()),
    /credentials/,
  );
  assert.equal(calls.length, 0);
});

test('web_fetch enforces webFetch.allowlist', async () => {
  const calls = stubFetch(() => new Response('x'));
  await assert.rejects(
    exec({ url: 'http://8.8.8.8/' }, makeCtx({ allowlist: ['docs.example.com'] })),
    /webFetch\.allowlist/,
  );
  assert.equal(calls.length, 0);
});

test('web_fetch allows allowlisted private hosts when allowPrivateHosts is set', async () => {
  stubFetch(() => new Response('local docs', { headers: { 'content-type': 'text/plain' } }));
  const out = await exec(
    { url: 'http://localhost:8080/api' },
    makeCtx({ allowlist: ['localhost:8080'], allowPrivateHosts: true }),
  );
  assert.equal(out, 'local docs');
});

// ---------------------------------------------------------------------------
// Download bounds
// ---------------------------------------------------------------------------

test('web_fetch streams the body and truncates at the byte cap', async () => {
  const chunk = new Uint8Array(512).fill(0x61); // 'a'
  let pulls = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(c) {
      pulls++;
      if (pulls > 20) {
        c.close();
        return;
      }
      c.enqueue(chunk);
    },
  });
  const fakeResponse = {
    status: 200,
    ok: true,
    statusText: 'OK',
    headers: new Headers({ 'content-type': 'text/plain' }),
    body: stream,
  };
  stubFetch(() => fakeResponse);

  const out = await exec({ url: 'http://8.8.8.8/big' }, makeCtx({ maxBytes: 2048 }));
  assert.match(out, /truncated during transfer/);
  assert.ok(out.length < 4096, `output should be capped, got ${out.length}`);
  assert.ok(pulls < 20, `stream should have been cancelled early, got ${pulls} pulls`);
});

test('web_fetch caps a buffered oversized body without a stream', async () => {
  const big = 'x'.repeat(64 * 1024);
  stubFetch(() => new Response(big, { headers: { 'content-type': 'text/plain' } }));
  const out = await exec({ url: 'http://8.8.8.8/big' }, makeCtx({ maxBytes: 4096 }));
  assert.match(out, /truncated during transfer/);
  assert.ok(out.length < 8192);
});

// ---------------------------------------------------------------------------
// Regression coverage — normal fetch behavior
// ---------------------------------------------------------------------------

test('web_fetch returns text content for a public URL', async () => {
  stubFetch(() => new Response('hello world', { headers: { 'content-type': 'text/plain' } }));
  assert.equal(await exec({ url: 'http://8.8.8.8/' }, makeCtx()), 'hello world');
});

test('web_fetch follows redirects to public targets', async () => {
  const calls = stubFetch((url) =>
    url === 'http://8.8.8.8/a'
      ? new Response(null, { status: 301, headers: { location: '/b' } })
      : new Response('final', { headers: { 'content-type': 'text/plain' } }),
  );
  assert.equal(await exec({ url: 'http://8.8.8.8/a' }, makeCtx()), 'final');
  assert.equal(calls.length, 2);
});

test('web_fetch pretty-prints JSON responses', async () => {
  stubFetch(
    () =>
      new Response('{"a":1}', { headers: { 'content-type': 'application/json' } }),
  );
  const out = await exec({ url: 'http://8.8.8.8/api' }, makeCtx());
  assert.equal(out, JSON.stringify({ a: 1 }, null, 2));
});

test('web_fetch strips HTML to text', async () => {
  stubFetch(
    () =>
      new Response('<p>Hello <b>world</b></p><script>evil()</script>', {
        headers: { 'content-type': 'text/html' },
      }),
  );
  const out = await exec({ url: 'http://8.8.8.8/' }, makeCtx());
  assert.match(out, /Hello world/);
  assert.ok(!out.includes('script'));
});

test('web_fetch surfaces HTTP errors', async () => {
  stubFetch(() => new Response('nope', { status: 404, statusText: 'Not Found' }));
  await assert.rejects(exec({ url: 'http://8.8.8.8/' }, makeCtx()), /HTTP 404/);
});

test('web_fetch fails after exceeding the redirect budget', async () => {
  stubFetch(
    () => new Response(null, { status: 302, headers: { location: 'http://8.8.8.8/next' } }),
  );
  await assert.rejects(exec({ url: 'http://8.8.8.8/a' }, makeCtx()), /maximum redirects/);
});

test('web_fetch validates arguments', async () => {
  await assert.rejects(exec({}, makeCtx()), /Missing required argument/);
  await assert.rejects(exec({ url: 'not a url' }, makeCtx()), /Invalid URL/);
});

// ---------------------------------------------------------------------------
// Documented request contract
// ---------------------------------------------------------------------------

test('web_fetch issues requests with manual redirect handling and a fixed UA', async () => {
  let seen: RequestInit | undefined;
  vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
    seen = init;
    return new Response('ok', { headers: { 'content-type': 'text/plain' } });
  });
  assert.equal(await exec({ url: 'http://8.8.8.8/' }, makeCtx()), 'ok');
  assert.equal(seen?.redirect, 'manual');
  assert.equal(new Headers(seen?.headers).get('user-agent'), 'sc-agent-cli/1.0');
});

test('web_fetch resolves public hostnames through the DNS gate', async () => {
  const calls = stubFetch(
    () => new Response('docs body', { headers: { 'content-type': 'text/plain' } }),
  );
  assert.equal(await exec({ url: 'http://docs.example.test/page' }, makeCtx()), 'docs body');
  assert.deepEqual(calls, ['http://docs.example.test/page']);
  assert.equal(dnsLookupMock.mock.calls.at(0)?.[0], 'docs.example.test');
  assert.deepEqual(dnsLookupMock.mock.calls.at(0)?.[1], { all: true, verbatim: true });
});

// ---------------------------------------------------------------------------
// Redirect handling — documented behavior
// ---------------------------------------------------------------------------

test('web_fetch errors on a redirect with no Location header', async () => {
  stubFetch(() => new Response(null, { status: 302 }));
  await assert.rejects(
    exec({ url: 'http://8.8.8.8/a' }, makeCtx()),
    /Failed to fetch http:\/\/8\.8\.8\.8\/a: Redirect 302 with no Location header/,
  );
});

test('web_fetch follows up to WEB_FETCH_MAX_REDIRECTS hops then returns the body', async () => {
  let n = 0;
  const calls = stubFetch(() => {
    n += 1;
    if (n <= WEB_FETCH_MAX_REDIRECTS) {
      return new Response(null, {
        status: 302,
        headers: { location: `http://8.8.8.8/r${n}` },
      });
    }
    return new Response('landed', { headers: { 'content-type': 'text/plain' } });
  });
  assert.equal(await exec({ url: 'http://8.8.8.8/r0' }, makeCtx()), 'landed');
  assert.equal(calls.length, WEB_FETCH_MAX_REDIRECTS + 1);
  assert.equal(calls.at(-1), `http://8.8.8.8/r${WEB_FETCH_MAX_REDIRECTS}`);
});

// ---------------------------------------------------------------------------
// Content-type branching
// ---------------------------------------------------------------------------

test('web_fetch falls back to raw text when a JSON body is malformed', async () => {
  stubFetch(() => new Response('{broken', { headers: { 'content-type': 'application/json' } }));
  assert.equal(await exec({ url: 'http://8.8.8.8/api' }, makeCtx()), '{broken');
});

test('web_fetch branches on content-type parameters (charset suffix)', async () => {
  stubFetch(
    () =>
      new Response('{"b":2}', {
        headers: { 'content-type': 'application/json; charset=utf-8' },
      }),
  );
  assert.equal(
    await exec({ url: 'http://8.8.8.8/api' }, makeCtx()),
    JSON.stringify({ b: 2 }, null, 2),
  );
});

test('web_fetch decodes non-text content-types as UTF-8 — no binary refusal', async () => {
  stubFetch(
    () =>
      new Response(new Uint8Array([104, 105, 33]), {
        headers: { 'content-type': 'application/octet-stream' },
      }),
  );
  assert.equal(await exec({ url: 'http://8.8.8.8/bin' }, makeCtx()), 'hi!');
});

// ---------------------------------------------------------------------------
// Rendered-output truncation
// ---------------------------------------------------------------------------

test('web_fetch truncates rendered output at 30000 characters', async () => {
  stubFetch(
    () => new Response('x'.repeat(31_000), { headers: { 'content-type': 'text/plain' } }),
  );
  const out = await exec({ url: 'http://8.8.8.8/doc' }, makeCtx());
  assert.equal(out, 'x'.repeat(30_000) + '\n\n[Truncated at 30000 characters]');
});

// ---------------------------------------------------------------------------
// Error paths — thrown Errors become tool-result messages in the agent loop;
// they must never propagate as anything that kills the run.
// ---------------------------------------------------------------------------

test('web_fetch wraps transport failures as a documented error result', async () => {
  stubFetch(() => Promise.reject(new TypeError('fetch failed')));
  await assert.rejects(
    exec({ url: 'http://8.8.8.8/' }, makeCtx()),
    /^Error: Failed to fetch http:\/\/8\.8\.8\.8\/: fetch failed$/,
  );
});

test('web_fetch reports DNS failures for unresolvable hosts without fetching', async () => {
  dnsLookupMock.mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND nx.test'));
  const calls = stubFetch(() => new Response('x'));
  await assert.rejects(
    exec({ url: 'http://nx.test/' }, makeCtx()),
    /Failed to fetch http:\/\/nx\.test\/: DNS lookup failed for nx\.test: getaddrinfo ENOTFOUND/,
  );
  assert.equal(calls.length, 0);
});

test('web_fetch reports empty DNS answers without fetching', async () => {
  dnsLookupMock.mockResolvedValueOnce([]);
  const calls = stubFetch(() => new Response('x'));
  await assert.rejects(
    exec({ url: 'http://nx.test/' }, makeCtx()),
    /Failed to fetch http:\/\/nx\.test\/: DNS lookup returned no addresses for nx\.test/,
  );
  assert.equal(calls.length, 0);
});

test('web_fetch converts an abort into a documented timeout error', async () => {
  vi.stubGlobal(
    'fetch',
    (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        if (!init?.signal) {
          reject(new Error('fetch stub received no AbortSignal'));
          return;
        }
        init.signal.addEventListener('abort', () => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        });
      }),
  );
  await assert.rejects(
    exec({ url: 'http://8.8.8.8/slow', timeout: 5 }, makeCtx()),
    /Request timed out after 5ms/,
  );
});

// ---------------------------------------------------------------------------
// Denied path — mocked permission layer. For web_fetch the policy gate lives in
// the SSRF guard; a denial must surface unwrapped (no "Failed to fetch" prefix)
// so the model sees the policy reason, and no request may hit the wire.
// ---------------------------------------------------------------------------

test('web_fetch surfaces a policy denial unwrapped — FetchTargetBlockedError, zero fetches', async () => {
  const calls = stubFetch(() => new Response('x'));
  vi.mocked(assertFetchTargetAllowed).mockRejectedValueOnce(
    new FetchTargetBlockedError(
      'Blocked by webFetch.allowlist: 8.8.8.8:80 is not an allowed destination',
    ),
  );
  const err: unknown = await exec({ url: 'http://8.8.8.8/' }, makeCtx()).catch(
    (e: unknown) => e,
  );
  assert.ok(
    err instanceof FetchTargetBlockedError,
    'denial must propagate unwrapped — the model sees the policy reason',
  );
  assert.equal(
    (err as Error).message,
    'Blocked by webFetch.allowlist: 8.8.8.8:80 is not an allowed destination',
  );
  assert.equal(calls.length, 0);
});
