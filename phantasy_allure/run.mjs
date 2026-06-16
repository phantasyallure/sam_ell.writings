import authHandler from '../api/auth.js';
import storiesHandler from '../api/stories.js';
import aiHandler from '../api/ai.js';

process.env.GITHUB_TOKEN = 'fake-token';
process.env.GITHUB_REPO = 'someuser/somerepo';
process.env.GITHUB_BRANCH = 'main';
process.env.ADMIN_PIN = '654321';
process.env.ANTHROPIC_API_KEY = 'fake-anthropic-key';

// ── in-memory fake GitHub repo ──
let repoFile = null; // { content: base64, sha: string } | null

const realFetch = global.fetch;
global.fetch = async (url, opts = {}) => {
  if (url.startsWith('https://api.github.com')) {
    if (opts.method === undefined || opts.method === 'GET') {
      if (!repoFile) {
        return { ok: false, status: 404, json: async () => ({}), text: async () => 'Not Found' };
      }
      return { ok: true, status: 200, json: async () => ({ content: repoFile.content, sha: repoFile.sha, encoding: 'base64' }) };
    }
    if (opts.method === 'PUT') {
      const body = JSON.parse(opts.body);
      if (repoFile && body.sha !== repoFile.sha) {
        return { ok: false, status: 409, text: async () => 'sha mismatch' };
      }
      repoFile = { content: body.content, sha: 'sha-' + Math.random().toString(36).slice(2, 8) };
      return { ok: true, status: 200, json: async () => ({ content: { sha: repoFile.sha } }) };
    }
  }
  if (url.startsWith('https://api.anthropic.com')) {
    const body = JSON.parse(opts.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({ content: [{ type: 'text', text: '[AI RESPONSE for ' + body.messages[0].content.slice(0, 20) + '...]' }] }),
      text: async () => 'unused',
    };
  }
  throw new Error('Unexpected fetch to ' + url);
};

// ── tiny req/res mock ──
function mockReqRes({ method = 'GET', headers = {}, body = undefined, query = {} } = {}) {
  const req = { method, headers, body, query };
  const res = {
    statusCode: 200,
    _json: null,
    _headers: {},
    status(code) { this.statusCode = code; return this; },
    json(obj) { this._json = obj; return this; },
    setHeader(k, v) { this._headers[k] = v; },
  };
  return { req, res };
}

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log('PASS:', name); }
  else { failed++; console.log('FAIL:', name, extra !== undefined ? JSON.stringify(extra) : ''); }
}

// ── 1. /api/auth ──
{
  const { req, res } = mockReqRes({ method: 'POST', headers: { 'x-admin-pin': 'wrong' } });
  await authHandler(req, res);
  check('auth rejects wrong pin', res.statusCode === 401 && res._json.ok === false, res._json);
}
{
  const { req, res } = mockReqRes({ method: 'POST', headers: { 'x-admin-pin': '654321' } });
  await authHandler(req, res);
  check('auth accepts correct pin', res.statusCode === 200 && res._json.ok === true, res._json);
}

// ── 2. /api/stories GET on empty repo ──
{
  const { req, res } = mockReqRes({ method: 'GET', headers: { 'x-admin-pin': '654321' } });
  await storiesHandler(req, res);
  check('GET (admin) on empty repo returns []', res.statusCode === 200 && Array.isArray(res._json) && res._json.length === 0, res._json);
}

// ── 3. POST a new story (unauthenticated should fail) ──
{
  const story = { id: 'abc123', title: 'My First Tale', published: false, content: 'Once upon a time...' };
  const { req, res } = mockReqRes({ method: 'POST', headers: {}, body: { story } });
  await storiesHandler(req, res);
  check('POST without pin is rejected', res.statusCode === 401, res._json);
}

// ── 4. POST a new story (authenticated) ──
{
  const story = { id: 'abc123', title: 'My First Tale', published: false, content: 'Once upon a time...' };
  const { req, res } = mockReqRes({ method: 'POST', headers: { 'x-admin-pin': '654321' }, body: { story } });
  await storiesHandler(req, res);
  check('POST with pin saves story', res.statusCode === 200 && res._json.ok === true, res._json);
  check('repo file was written', repoFile !== null);
}

// ── 5. GET as admin sees the draft; GET as public does not ──
{
  const { req, res } = mockReqRes({ method: 'GET', headers: { 'x-admin-pin': '654321' } });
  await storiesHandler(req, res);
  check('admin GET sees draft story', res._json.length === 1 && res._json[0].title === 'My First Tale', res._json);
}
{
  const { req, res } = mockReqRes({ method: 'GET', headers: {} });
  await storiesHandler(req, res);
  check('public GET hides unpublished story', Array.isArray(res._json) && res._json.length === 0, res._json);
}

// ── 6. Publish it, then public GET should see it ──
{
  const story = { id: 'abc123', title: 'My First Tale', published: true, content: 'Once upon a time...' };
  const { req, res } = mockReqRes({ method: 'POST', headers: { 'x-admin-pin': '654321' }, body: { story } });
  await storiesHandler(req, res);
  check('publish update succeeds', res.statusCode === 200, res._json);
}
{
  const { req, res } = mockReqRes({ method: 'GET', headers: {} });
  await storiesHandler(req, res);
  check('public GET sees published story', res._json.length === 1 && res._json[0].published === true, res._json);
}

// ── 7. Add a second story, then delete the first ──
{
  const story2 = { id: 'xyz999', title: 'Second Tale', published: true, content: 'Another tale...' };
  const { req, res } = mockReqRes({ method: 'POST', headers: { 'x-admin-pin': '654321' }, body: { story: story2 } });
  await storiesHandler(req, res);
  check('second story saved', res.statusCode === 200);
}
{
  const { req, res } = mockReqRes({ method: 'DELETE', headers: { 'x-admin-pin': '654321' }, query: { id: 'abc123' } });
  await storiesHandler(req, res);
  check('delete succeeds', res.statusCode === 200 && res._json.ok === true, res._json);
}
{
  const { req, res } = mockReqRes({ method: 'GET', headers: { 'x-admin-pin': '654321' } });
  await storiesHandler(req, res);
  check('only second story remains', res._json.length === 1 && res._json[0].id === 'xyz999', res._json);
}

// ── 8. POST with bad payload ──
{
  const { req, res } = mockReqRes({ method: 'POST', headers: { 'x-admin-pin': '654321' }, body: { story: { title: 'no id' } } });
  await storiesHandler(req, res);
  check('POST without story id rejected', res.statusCode === 400, res._json);
}

// ── 9. /api/ai — enhance and continue (grammar now uses LanguageTool directly in browser) ──
{
  const { req, res } = mockReqRes({ method: 'POST', headers: {}, body: { type: 'enhance', text: 'Once there was a castle.' } });
  await aiHandler(req, res);
  check('ai rejects without pin', res.statusCode === 401, res._json);
}
{
  const { req, res } = mockReqRes({ method: 'POST', headers: { 'x-admin-pin': '654321' }, body: { type: 'enhance', text: 'Once there was a castle.' } });
  await aiHandler(req, res);
  check('ai enhance call succeeds', res.statusCode === 200 && res._json.result.startsWith('[AI RESPONSE'), res._json);
}
{
  const { req, res } = mockReqRes({ method: 'POST', headers: { 'x-admin-pin': '654321' }, body: { type: 'continue', text: 'The door creaked open.' } });
  await aiHandler(req, res);
  check('ai continue call succeeds', res.statusCode === 200 && res._json.result.startsWith('[AI RESPONSE'), res._json);
}
{
  // grammar type is no longer handled server-side — should return 400
  const { req, res } = mockReqRes({ method: 'POST', headers: { 'x-admin-pin': '654321' }, body: { type: 'grammar', text: 'helo wrold' } });
  await aiHandler(req, res);
  check('ai rejects grammar type (now browser-side)', res.statusCode === 400, res._json);
}
{
  const { req, res } = mockReqRes({ method: 'POST', headers: { 'x-admin-pin': '654321' }, body: { type: 'bogus', text: 'hi' } });
  await aiHandler(req, res);
  check('ai rejects unknown type', res.statusCode === 400, res._json);
}
{
  const { req, res } = mockReqRes({ method: 'POST', headers: { 'x-admin-pin': '654321' }, body: { type: 'enhance', text: '' } });
  await aiHandler(req, res);
  check('ai rejects empty text', res.statusCode === 400, res._json);
}
{
  const longText = 'a'.repeat(12001);
  const { req, res } = mockReqRes({ method: 'POST', headers: { 'x-admin-pin': '654321' }, body: { type: 'enhance', text: longText } });
  await aiHandler(req, res);
  check('ai rejects too-long text', res.statusCode === 400, res._json);
}

// ── 10. missing env vars ──
{
  const savedPin = process.env.ADMIN_PIN;
  delete process.env.ADMIN_PIN;
  const { req, res } = mockReqRes({ method: 'GET', headers: {} });
  await storiesHandler(req, res);
  check('missing env vars produce a clear 500', res.statusCode === 500 && /ADMIN_PIN/.test(res._json.error), res._json);
  process.env.ADMIN_PIN = savedPin;
}

console.log(`\n${passed} passed, ${failed} failed`);
global.fetch = realFetch;
process.exit(failed ? 1 : 0);
