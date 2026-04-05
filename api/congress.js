export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { name } = req.query;
  if (!name) return res.status(400).json({ error: 'Name required' });

  try {
    // Try Capitol Trades API
    const response = await fetch(
      `https://api.capitoltrades.com/trades?politician=${encodeURIComponent(name)}&pageSize=30`,
      { headers: { 'Accept': 'application/json', 'User-Agent': 'StockPulse/1.0' } }
    );

    if (response.ok) {
      const data = await response.json();
      const trades = data.data || data.trades || data || [];
      if (trades.length > 0) {
        return res.status(200).json({ trades, source: 'capitoltrades' });
      }
    }

    // Fallback: use Claude AI with web search to find congressional trades
    const prompt = `Search for recent stock trades disclosed by ${name} under the STOCK Act congressional trading disclosure requirements.

Return ONLY valid JSON — no markdown, no backticks:
{
  "politician": "Full name of the politician",
  "chamber": "Senate or House",
  "party": "Democrat or Republican or Independent",
  "trades": [
    {
      "ticker": "AAPL",
      "company": "Apple Inc.",
      "type": "Purchase or Sale",
      "amount": "$15,001 - $50,000",
      "date": "2025-03-15"
    }
  ],
  "summary": "2 sentence summary of this politician's recent trading activity and any notable patterns."
}

Find at least 5-10 recent trades if available. Use real disclosed data only.`;

    const aiResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const aiData = await aiResponse.json();
    if (aiData.error) throw new Error(aiData.error.message);

    const textBlock = aiData.content?.find(b => b.type === 'text');
    if (!textBlock) throw new Error('No response from AI');

    const jsonMatch = textBlock.text.trim().replace(/```json|```/g, '').trim().match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Could not parse AI response');

    const parsed = JSON.parse(jsonMatch[0]);

    // Normalize trades format
    const trades = (parsed.trades || []).map(t => ({
      politician: parsed.politician || name,
      chamber: parsed.chamber || '',
      party: parsed.party || '',
      ticker: t.ticker || '—',
      asset: t.company || t.ticker || '',
      transactionType: t.type || 'Unknown',
      amount: t.amount || '—',
      transactionDate: t.date || ''
    }));

    return res.status(200).json({
      trades,
      politician: parsed.politician,
      chamber: parsed.chamber,
      party: parsed.party,
      summary: parsed.summary,
      source: 'ai'
    });

  } catch (err) {
    console.error('Congress error:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch congressional trades' });
  }
}
