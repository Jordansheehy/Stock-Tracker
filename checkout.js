import Stripe from 'stripe';
import { clerkClient } from '@clerk/clerk-sdk-node';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

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
    let userId, userEmail;
    try {
      const payload = await clerkClient.verifyToken(token);
      userId = payload.sub;
      const user = await clerkClient.users.getUser(userId);
      userEmail = user.emailAddresses?.[0]?.emailAddress;
    } catch {
      return res.status(401).json({ error: 'Invalid token' });
    }

    // Get or create Stripe customer
    let customerId;
    const user = await clerkClient.users.getUser(userId);
    if (user.privateMetadata?.stripeCustomerId) {
      customerId = user.privateMetadata.stripeCustomerId;
    } else {
      const customer = await stripe.customers.create({
        email: userEmail,
        metadata: { clerkUserId: userId }
      });
      customerId = customer.id;
      await clerkClient.users.updateUserMetadata(userId, {
        privateMetadata: { ...user.privateMetadata, stripeCustomerId: customerId }
      });
    }

    const origin = req.headers.origin || 'https://your-domain.vercel.app';

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'StockPulse Pro',
            description: '50 AI stock analyses per month + Congressional trading tracker'
          },
          unit_amount: 999,
          recurring: { interval: 'month' }
        },
        quantity: 1
      }],
      subscription_data: {
        trial_period_days: 3
      },
      success_url: `${origin}?success=true`,
      cancel_url: `${origin}?canceled=true`
    });

    res.status(200).json({ url: session.url });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
}
