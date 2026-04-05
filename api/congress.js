export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { name } = req.query;
  if (!name) return res.status(400).json({ error: 'Name required' });

  try {
    const prompt = `Search for recent stock trades disclosed by US politician "${name}" under the STOCK Act congressional trading disclosure requirements. Search sites like capitoltrades.com, quiverquant.com, and official congressional disclosure databases.

Return ONLY valid JSON with no markdown or backticks:
{
  "politician": "Full official name",
  "chamber": "Senate or House",
  "party": "Democrat or Republican or Independent",
  "summary": "2 sentence summary of their recent trading activity and any notable patterns.",
  "trades": [
    {
      "ticker": "AAPL",
      "company": "Apple Inc.",
      "type": "Purchase or Sale",
      "amount": "$15,001 - $50,000",
      "date": "2025-03-15"
    }
  ]
}

Find as many recent trades as possible (aim for 10-20). Only include real disclosed trades.`;

    const aiResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 3000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const aiData = await aiResponse.json();
    if (aiData.error) throw new Error(aiData.error.message);

    const textBlock = aiData.content?.find(b => b.type === 'text');
    if (!textBlock) throw new Error('No response from AI');

    const jsonMatch = textBlock.text.trim().replace(/```json|```/g, '').trim().match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Could not parse response');

    const parsed = JSON.parse(jsonMatch[0]);

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
      summary: parsed.summary
    });

  } catch (err) {
    console.error('Congress error:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch congressional trades' });
  }
}
