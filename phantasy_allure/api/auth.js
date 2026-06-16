import { getConfig, isAdmin } from '../lib/storage.js';

export default function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { missing } = getConfig();
  if (missing.length) {
    return res.status(500).json({
      error: `Server not configured. Missing environment variables: ${missing.join(', ')}`,
    });
  }

  if (!isAdmin(req)) {
    return res.status(401).json({ ok: false, error: 'Incorrect PIN' });
  }

  return res.status(200).json({ ok: true });
}

