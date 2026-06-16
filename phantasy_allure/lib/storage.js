export function getConfig() {
  const required = ['GITHUB_TOKEN', 'GITHUB_REPO', 'GITHUB_BRANCH', 'ADMIN_PIN'];
  const missing = required.filter((k) => !process.env[k]);
  const [owner, repo] = (process.env.GITHUB_REPO || '').split('/');
  return {
    missing,
    owner,
    repo,
    branch: process.env.GITHUB_BRANCH,
    token: process.env.GITHUB_TOKEN,
    pin: process.env.ADMIN_PIN,
  };
}

export function isAdmin(req) {
  const { pin } = getConfig();
  return req.headers['x-admin-pin'] === pin;
}

const DATA_PATH = 'phantasy_allure/data/stories.json';

export async function readStories() {
  const { owner, repo, branch, token } = getConfig();
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${DATA_PATH}?ref=${branch}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
    },
  });
  if (res.status === 404) return { stories: [], sha: null };
  if (!res.ok) throw new Error(`GitHub read failed: ${res.status}`);
  const data = await res.json();
  const stories = JSON.parse(Buffer.from(data.content, 'base64').toString('utf8'));
  return { stories, sha: data.sha };
}

export async function writeStories(stories, sha) {
  const { owner, repo, branch, token } = getConfig();
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${DATA_PATH}`;
  const body = {
    message: 'Update stories',
    content: Buffer.from(JSON.stringify(stories, null, 2)).toString('base64'),
    branch,
    ...(sha ? { sha } : {}),
  };
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub write failed: ${res.status} ${text}`);
  }
  return res.json();
}
