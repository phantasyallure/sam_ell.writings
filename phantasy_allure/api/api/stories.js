import { getConfig, isAdmin, readStories, writeStories } from '../lib/storage.js';

export default async function handler(req, res) {
  const { missing } = getConfig();
  if (missing.length) {
    return res.status(500).json({
      error: `Server not configured. Missing environment variables: ${missing.join(', ')}`,
    });
  }

  const admin = isAdmin(req);

  // GET — list stories
  if (req.method === 'GET') {
    try {
      const { stories } = await readStories();
      const result = admin ? stories : stories.filter((s) => s.published);
      return res.status(200).json(result);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // All write operations require admin
  if (!admin) return res.status(401).json({ error: 'Unauthorized' });

  // POST — create or update a story
  if (req.method === 'POST') {
    const { story } = req.body || {};
    if (!story || !story.id) {
      return res.status(400).json({ error: 'story.id is required' });
    }
    try {
      let { stories, sha } = await readStories();
      const idx = stories.findIndex((s) => s.id === story.id);
      if (idx >= 0) stories[idx] = story;
      else stories.push(story);
      await writeStories(stories, sha);
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // DELETE — remove a story
  if (req.method === 'DELETE') {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'id is required' });
    try {
      let { stories, sha } = await readStories();
      stories = stories.filter((s) => s.id !== id);
      await writeStories(stories, sha);
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.setHeader('Allow', 'GET, POST, DELETE');
  return res.status(405).json({ error: 'Method not allowed' });
}
