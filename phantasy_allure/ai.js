// POST /api/ai
// Body: { type: 'enhance' | 'continue', text: '...' }
// Requires header: x-admin-pin
//
// This is the server-side proxy for generative AI writing tools (Enhance and
// Continue). The Anthropic API key never reaches the browser — it lives only
// here, as the ANTHROPIC_API_KEY env var.
//
// Note: "Fix Grammar" was moved to a direct browser call to LanguageTool's
// free public API (no key required). See admin.html for that implementation.

import { isAdmin, getConfig } from '../lib/storage.js';

const MAX_INPUT_CHARS = 12000; // keep individual requests reasonably sized/affordable

const PROMPTS = {
  enhance: (text) =>
    `You are a creative writing coach specializing in fantasy and romance fiction. Enhance the following story passage — improve the prose flow, add more vivid sensory details, and make it more immersive and atmospheric. Keep all the story events and meaning the same. Return ONLY the enhanced text:\n\n${text}`,
  continue: (text) =>
    `You are a fantasy/romance author continuing a story. Continue the following story naturally, matching the author's established voice and style. Write 2-3 additional paragraphs that flow naturally from where the text ends. Return ONLY the new continuation text (not the original):\n\n${text}`,
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { missing } = getConfig();
  const apiKeyMissing = !process.env.ANTHROPIC_API_KEY;
  if (missing.length || apiKeyMissing) {
    const allMissing = [...missing, ...(apiKeyMissing ? ['ANTHROPIC_API_KEY'] : [])];
    return res.status(500).json({
      error: `Server not configured. Missing environment variables: ${allMissing.join(', ')}`,
    });
  }

  if (!isAdmin(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { type, text } = req.body || {};
  if (!type || !PROMPTS[type]) {
    return res.status(400).json({ error: 'type must be one of: enhance, continue' });
  }
  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'text is required' });
  }
  if (text.length > MAX_INPUT_CHARS) {
    return res.status(400).json({
      error: `Text is too long for one AI request (${text.length} chars, max ${MAX_INPUT_CHARS}). Try running this on a smaller section.`,
    });
  }

  try {
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        messages: [{ role: 'user', content: PROMPTS[type](text) }],
      }),
    });

    if (!aiRes.ok) {
      const detail = await aiRes.text();
      return res.status(502).json({ error: 'Anthropic API error', detail });
    }

    const data = await aiRes.json();
    const result = (data.content || []).map((b) => b.text || '').join('');
    return res.status(200).json({ result });
  } catch (err) {
    return res.status(500).json({ error: 'AI request failed', detail: err.message });
  }
}
