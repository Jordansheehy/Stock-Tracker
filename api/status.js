import { clerkClient } from '@clerk/clerk-sdk-node';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

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

    const user = await clerkClient.users.getUser(userId);
    const customerId = user.privateMetadata?.stripeCustomerId;

    let subscriptionStatus = 'none';
    let trialEnd = null;
    let periodEnd = null;

    if (customerId) {
      const [active, trialing] = await Promise.all([
        stripe.subscriptions.list({ customer: customerId, status: 'active', limit: 1 }),
        stripe.subscriptions.list({ customer: customerId, status: 'trialing', limit: 1 })
      ]);
      if (active.data.length > 0) {
        subscriptionStatus = 'active';
        periodEnd = active.data[0].current_period_end;
      } else if (trialing.data.length > 0) {
        subscriptionStatus = 'trialing';
        trialEnd = trialing.data[0].trial_end;
        periodEnd = trialing.data[0].current_period_end;
      }
    }

    const now = new Date();
    const usageKey = `usage_${userId}_${now.getFullYear()}_${now.getMonth()}`;
    const usage = parseInt(user.privateMetadata?.[usageKey] || '0', 10);

    res.status(200).json({
      subscriptionStatus,
      trialEnd,
      periodEnd,
      usage,
      limit: 50,
      email: user.emailAddresses?.[0]?.emailAddress,
      name: user.firstName
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
}
