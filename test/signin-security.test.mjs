import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createSignIn, exchangeCode } from "../src/signin.mjs";

const CODE = "c".repeat(43);
const VERIFIER = "v".repeat(43);
const KEY = `sk-cail-p_${"a".repeat(32)}_${"b".repeat(40)}`;
const EXPIRES = Date.UTC(2030, 0, 1);
const credentialResponse = () => Response.json({ key: KEY, credential: { expiresAt: EXPIRES } });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

async function localServer(t, handler) {
  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return `http://127.0.0.1:${server.address().port}`;
}

function profile(t) {
  const dir = mkdtempSync(join(tmpdir(), "cail-signin-security-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { PI_CODING_AGENT_DIR: dir };
}

function interaction(t) {
  const controller = new AbortController();
  const url = deferred();
  const paste = deferred();
  t.after(() => controller.abort());
  return {
    controller, url: url.promise, paste: paste.resolve,
    signal: controller.signal,
    notify(event) { if (event.type === "auth_url") url.resolve(new URL(event.url)); },
    prompt({ signal }) {
      if (signal?.aborted) return Promise.reject(new Error("prompt closed"));
      signal?.addEventListener("abort", () => paste.reject(new Error("prompt closed")), { once: true });
      return paste.promise;
    },
  };
}

function callbackURL(connect) {
  const url = new URL(connect.searchParams.get("redirect_uri"));
  url.searchParams.set("state", connect.searchParams.get("state"));
  url.searchParams.set("code", CODE);
  return url;
}

for (const status of [301, 302, 303, 307, 308]) {
  test(`token exchange rejects HTTP ${status} without contacting the redirect destination`, { timeout: 5000 }, async (t) => {
    let redirectedRequests = 0;
    const destination = await localServer(t, (_req, res) => {
      redirectedRequests++;
      res.end(JSON.stringify({ key: KEY, credential: { expiresAt: EXPIRES } }));
    });
    let originalRequests = 0;
    const origin = await localServer(t, (req, res) => {
      originalRequests++;
      req.resume();
      res.writeHead(status, { location: `${destination}/collect` });
      res.end();
    });
    await assert.rejects(exchangeCode({ code: CODE, verifier: VERIFIER, tokenUrl: `${origin}/token` }));
    assert.equal(originalRequests, 1);
    assert.equal(redirectedRequests, 0, "neither a redirect GET nor a replayed POST is permitted");
  });
}

test("sign-in errors never reflect remote secrets or terminal controls", async () => {
  const injected = `${KEY} ${VERIFIER} \x1b]52;c;c2VjcmV0\x07`;
  for (const body of [
    { error: "invalid_grant", message: injected },
    { error: { code: "admission_required", message: injected } },
    { message: injected },
  ]) {
    await assert.rejects(exchangeCode({ code: CODE, verifier: VERIFIER, fetch: async () => Response.json(body, { status: 400 }) }), (error) => {
      assert.ok(error.message.length < 300, "error is a concise local message");
      assert.ok(!error.message.includes(KEY));
      assert.ok(!error.message.includes(VERIFIER));
      assert.doesNotMatch(error.message, /[\x00-\x1f\x7f]/);
      return true;
    });
  }
});

test("oversized chunked token responses are rejected before accepting a credential", { timeout: 5000 }, async (t) => {
  const origin = await localServer(t, (_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.write('{"padding":"');
    // Deliberately omit Content-Length; the stream reader must count decoded bytes.
    for (let i = 0; i < 9; i++) res.write("x".repeat(8192));
    res.end(`","key":${JSON.stringify(KEY)},"credential":{"expiresAt":${EXPIRES}}}`);
  });
  await assert.rejects(exchangeCode({ code: CODE, verifier: VERIFIER, tokenUrl: `${origin}/token` }));
});

test("malformed callback URLs do not terminate Pi or prevent a subsequent valid callback", { timeout: 10000 }, async (t) => {
  const env = profile(t);
  const moduleUrl = new URL("../src/signin.mjs", import.meta.url).href;
  // Isolate this regression: the vulnerable code throws out of the HTTP handler.
  const child = `
    import net from 'node:net';
    import assert from 'node:assert/strict';
    import { createSignIn } from ${JSON.stringify(moduleUrl)};
    let seen;
    const ready = new Promise(r => seen = r);
    const controller = new AbortController();
    const login = createSignIn({env:${JSON.stringify(env)},fetch:async()=>Response.json({key:${JSON.stringify(KEY)},credential:{expiresAt:${EXPIRES}}})}).login({
      signal:controller.signal,
      notify(e){if(e.type==='auth_url')seen(new URL(e.url));},
      prompt({signal}){return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new Error('closed')),{once:true}));}
    });
    const connect=await ready;
    const callback=new URL(connect.searchParams.get('redirect_uri'));
    const raw=await new Promise((resolve,reject)=>{
      let text='';
      const socket=net.connect(Number(callback.port),'127.0.0.1',()=>socket.write('GET //[ HTTP/1.1\\r\\nHost: localhost\\r\\nConnection: close\\r\\n\\r\\n'));
      socket.setTimeout(2000,()=>socket.destroy(new Error('malformed request hung')));
      socket.on('data',chunk=>text+=chunk.toString());socket.on('error',reject);socket.on('end',()=>resolve(text));
    });
    assert.match(raw,/HTTP\\/1.1 400/);
    callback.searchParams.set('state',connect.searchParams.get('state'));callback.searchParams.set('code',${JSON.stringify(CODE)});
    const browser=await fetch(callback);
    assert.equal(browser.status,200);await browser.text();assert.equal((await login).access,${JSON.stringify(KEY)});
    console.log('survived');
  `;
  const { stdout } = await promisify(execFile)(process.execPath, ["--input-type=module", "--eval", child], { timeout: 8000 });
  assert.match(stdout, /survived/);
});

for (const first of ["browser", "paste"]) {
  test(`${first} first: overlapping callback and paste share one successful exchange`, { timeout: 5000 }, async (t) => {
    const started = deferred();
    const release = deferred();
    let calls = 0;
    const ui = interaction(t);
    const login = createSignIn({ env: profile(t), fetch: async () => {
      calls++;
      started.resolve();
      await release.promise;
      return credentialResponse();
    } }).login(ui);
    login.catch(() => {});
    t.after(() => release.resolve());
    const callback = callbackURL(await ui.url);
    let browser;
    if (first === "browser") {
      browser = fetch(callback);
      await started.promise;
      ui.paste(CODE);
    } else {
      ui.paste(CODE);
      await started.promise;
      browser = fetch(callback);
    }
    browser.catch(() => {});
    // Allow the second local input to reach the shared claim before completing it.
    await new Promise((resolve) => setTimeout(resolve, 50));
    release.resolve();
    const [credential, response] = await Promise.all([login, browser]);
    assert.equal(calls, 1);
    assert.equal(credential.access, KEY);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Sign-in approved/i);
  });
}

test("cancelling an in-flight callback rejects login and aborts the token request", { timeout: 5000 }, async (t) => {
  const started = deferred();
  const aborted = deferred();
  const ui = interaction(t);
  let calls = 0;
  const login = createSignIn({ env: profile(t), fetch: async (_url, init) => {
    calls++;
    started.resolve();
    return new Promise((_resolve, reject) => {
      const cancel = () => { aborted.resolve(); reject(new DOMException("aborted", "AbortError")); };
      if (init.signal.aborted) cancel();
      else init.signal.addEventListener("abort", cancel, { once: true });
    });
  } }).login(ui);
  const rejected = assert.rejects(login, /cancel/i);
  const callback = callbackURL(await ui.url);
  const browser = fetch(callback).then(async (r) => { const text = await r.text(); assert.doesNotMatch(text, /Sign-in approved|Pi is connected/); }, () => {});
  await started.promise;
  ui.controller.abort();
  await Promise.all([aborted.promise, rejected, browser]);
  assert.equal(calls, 1);
  await assert.rejects(fetch(callback), "the cancelled callback listener closes");
});


test("invalid pasted input leaves browser sign-in available and allows a corrected paste", { timeout: 5000 }, async (t) => {
  const ui = interaction(t);
  const messages = [];
  const notify = ui.notify.bind(ui);
  ui.notify = (event) => { messages.push(event); notify(event); };
  let prompts = 0;
  ui.prompt = async () => ++prompts === 1 ? "not a valid code" : CODE;
  let exchanges = 0;
  const credential = await createSignIn({ env: profile(t), fetch: async () => {
    exchanges++;
    return credentialResponse();
  } }).login(ui);
  assert.equal(prompts, 2);
  assert.equal(exchanges, 1, "invalid paste must not consume a one-time exchange");
  assert.equal(credential.access, KEY);
  assert.ok(messages.some((event) => /not a .*sign-in code/i.test(event.message ?? "")));
});

for (const first of ["browser", "paste"]) {
  test(`${first} first: duplicate pending inputs share one failed exchange`, { timeout: 5000 }, async (t) => {
    const started = deferred();
    const release = deferred();
    const ui = interaction(t);
    let calls = 0;
    const login = createSignIn({ env: profile(t), fetch: async () => {
      calls++;
      started.resolve();
      await release.promise;
      return Response.json({ message: KEY }, { status: 400 });
    } }).login(ui);
    let loginError;
    const rejected = assert.rejects(login, (error) => { loginError = error; return true; });
    t.after(() => release.resolve());
    const callback = callbackURL(await ui.url);
    let browser;
    if (first === "browser") {
      browser = fetch(callback);
      await started.promise;
      ui.paste(CODE);
    } else {
      ui.paste(CODE);
      await started.promise;
      browser = fetch(callback);
    }
    browser.catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 50));
    release.resolve();
    const [, response] = await Promise.all([rejected, browser]);
    const page = await response.text();
    assert.equal(calls, 1);
    assert.equal(response.status, 502);
    assert.match(page, /Sign-in not completed/);
    assert.ok(page.includes(loginError.message), "browser and Pi describe the same failure");
    assert.ok(!page.includes(KEY));
    assert.ok(!loginError.message.includes(KEY));
  });
}
