export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { ticker } = req.body;
  if (!ticker) return res.status(400).json({ error: 'Ticker required' });

  const prompt = `You are an equity research analyst with access to web search. Research the stock ticker: ${ticker}.

Search for:
1. Recent news articles about ${ticker} from the last 7 days (aim for 5-8 stories from different sources like Reuters, Bloomberg, WSJ, CNBC, MarketWatch, Barron's, Financial Times, etc.)
2. Current analyst ratings/recommendations (Strong Buy, Buy, Hold, Underperform, Sell counts from major investment banks and analyst firms)
3. Overall market sentiment, catalysts, and risks

Return ONLY a valid JSON object — no markdown, no backticks, no preamble:
{
  "ticker": "${ticker}",
  "companyName": "Full company name",
  "signal": "Bullish or Bearish or Neutral",
  "sentiment": "Positive or Negative or Mixed",
  "momentum": "Strong or Moderate or Weak",
  "risk": "High or Medium or Low",
  "summary": "3-4 sentence AI overview of the company and current market position based on recent news.",
  "ratings": {
    "strongBuy": 0,
    "buy": 0,
    "hold": 0,
    "underperform": 0,
    "sell": 0,
    "consensus": "Buy"
  },
  "catalysts": ["catalyst 1", "catalyst 2", "catalyst 3"],
  "risks": ["risk 1", "risk 2", "risk 3"],
  "news": [
    {
      "source": "Reuters",
      "date": "Apr 5",
      "headline": "Headline here",
      "summary": "1-2 sentence summary.",
      "url": ""
    }
  ],
  "analystTake": "2-3 sentence synthesis of analyst views."
}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error.message || 'Anthropic error');

    const textBlock = data.content?.find(b => b.type === 'text');
    if (!textBlock) throw new Error('No text response from model');

    const jsonMatch = textBlock.text.trim().replace(/```json|```/g, '').trim().match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Could not parse JSON from response');

    const parsed = JSON.parse(jsonMatch[0]);
    res.status(200).json({ data: parsed });

  } catch (err) {
    console.error('Analyze error:', err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
}
