import Anthropic from '@anthropic-ai/sdk';
import { clerkClient } from '@clerk/clerk-sdk-node';
import Stripe from 'stripe';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const MONTHLY_LIMIT = 50;

async function getUserUsage(userId) {
  const now = new Date();
  const key = `usage_${userId}_${now.getFullYear()}_${now.getMonth()}`;
  try {
    const user = await clerkClient.users.getUser(userId);
    return parseInt(user.privateMetadata?.[key] || '0', 10);
  } catch { return 0; }
}

async function incrementUsage(userId) {
  const now = new Date();
  const key = `usage_${userId}_${now.getFullYear()}_${now.getMonth()}`;
  try {
    const user = await clerkClient.users.getUser(userId);
    const current = parseInt(user.privateMetadata?.[key] || '0', 10);
    await clerkClient.users.updateUserMetadata(userId, {
      privateMetadata: { ...user.privateMetadata, [key]: String(current + 1) }
    });
    return current + 1;
  } catch { return 0; }
}

async function hasActiveSubscription(userId) {
  try {
    const user = await clerkClient.users.getUser(userId);
    const customerId = user.privateMetadata?.stripeCustomerId;
    if (!customerId) return false;
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId, status: 'active', limit: 1
    });
    if (subscriptions.data.length > 0) return true;
    // check trial
    const trialing = await stripe.subscriptions.list({
      customer: customerId, status: 'trialing', limit: 1
    });
    return trialing.data.length > 0;
  } catch { return false; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Not authenticated' });

    const token = authHeader.replace('Bearer ', '');
    let userId;
    try {
      const payload = await clerkClient.verifyToken(token);
      userId = payload.sub;
    } catch {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const active = await hasActiveSubscription(userId);
    if (!active) return res.status(403).json({ error: 'no_subscription' });

    const usage = await getUserUsage(userId);
    if (usage >= MONTHLY_LIMIT) {
      return res.status(403).json({ error: 'limit_reached', usage, limit: MONTHLY_LIMIT });
    }

    const { ticker, type } = req.body;
    if (!ticker) return res.status(400).json({ error: 'Ticker required' });

    const prompt = type === 'congress'
      ? `You are a financial analyst. Research recent congressional stock trades related to ${ticker} or by searching for congressional trading data. Return ONLY valid JSON: {"trades":[{"politician":"Name","party":"R or D","chamber":"Senate or House","type":"Purchase or Sale","amount":"$15,001 - $50,000","date":"Apr 3, 2025","ticker":"${ticker}"}],"summary":"2 sentence summary of congressional trading activity in this stock."}`
      : `You are an equity research analyst with access to web search. Research the stock ticker: ${ticker}. Search for recent news (last 7 days), analyst ratings, and market data. Return ONLY valid JSON — no markdown, no backticks: {"ticker":"${ticker}","companyName":"Full company name","signal":"Bullish or Bearish or Neutral","sentiment":"Positive or Negative or Mixed","momentum":"Strong or Moderate or Weak","risk":"High or Medium or Low","summary":"3-4 sentence overview based on recent news.","ratings":{"strongBuy":0,"buy":0,"hold":0,"underperform":0,"sell":0,"consensus":"Buy"},"catalysts":["catalyst 1","catalyst 2","catalyst 3"],"risks":["risk 1","risk 2","risk 3"],"news":[{"source":"Reuters","date":"Apr 3","headline":"Headline here","summary":"1-2 sentence summary.","url":""}],"analystTake":"2-3 sentence analyst synthesis."}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{ role: 'user', content: prompt }]
    });

    const textBlock = response.content?.find(b => b.type === 'text');
    if (!textBlock) throw new Error('No response from model');

    const jsonMatch = textBlock.text.trim().replace(/```json|```/g, '').trim().match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Could not parse response');
    const data = JSON.parse(jsonMatch[0]);

    const newUsage = await incrementUsage(userId);
    res.status(200).json({ data, usage: newUsage, limit: MONTHLY_LIMIT });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
}
