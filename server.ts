import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import Stripe from "stripe";
import admin from "firebase-admin";

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault()
  });
}
const db = admin.firestore();

let stripeClient: Stripe | null = null;

function getStripe(): Stripe {
  if (!stripeClient) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error("STRIPE_SECRET_KEY environment variable is required");
    }
    if (!key.startsWith('sk_')) {
      console.warn("Warning: STRIPE_SECRET_KEY doesn't start with 'sk_'. It might be invalid.");
    }
    stripeClient = new Stripe(key);
  }
  return stripeClient;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Use JSON parsing for all routes EXCEPT the webhook
  app.use((req, res, next) => {
    if (req.originalUrl === '/api/webhook') {
      next();
    } else {
      express.json()(req, res, next);
    }
  });

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", time: new Date().toISOString() });
  });

  // Stripe Checkout Endpoint
  app.post("/api/create-checkout-session", async (req, res) => {
    try {
      const { planId, companyId, successUrl, cancelUrl } = req.body;
      
      if (!planId || !companyId) {
        return res.status(400).json({ error: "Missing required parameters" });
      }

      // Map plans to prices (these should correspond to your Stripe Product Prices)
      const prices: Record<string, string | number> = {
        'basic': 5900,    // $59.00 in cents
        'standard': 9900, // $99.00 in cents
        'premium': 11900  // $119.00 in cents
      };

      const amount = prices[planId];
      if (!amount) {
        return res.status(400).json({ error: "Invalid plan ID" });
      }

      const stripe = getStripe();
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product_data: {
                name: `BioPoint ${planId.charAt(0).toUpperCase() + planId.slice(1)} Plan`,
              },
              unit_amount: amount as number,
              recurring: {
                interval: 'month',
              },
            },
            quantity: 1,
          },
        ],
        mode: 'subscription',
        success_url: successUrl || `${process.env.APP_URL}?session_id={CHECKOUT_SESSION_ID}&view=dashboard`,
        cancel_url: cancelUrl || `${process.env.APP_URL}?view=pricing`,
        metadata: {
          companyId,
          planId
        }
      });

      res.json({ url: session.url });
    } catch (err: any) {
      console.error("Stripe Error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Stripe Webhook Endpoint
  app.post("/api/webhook", express.raw({type: 'application/json'}), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
    const stripe = getStripe();

    let event;

    try {
      if (endpointSecret && sig) {
        event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
      } else {
        // Fallback for testing/dev environments
        event = JSON.parse(req.body);
      }
    } catch (err: any) {
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const { companyId, planId } = session.metadata || {};

      if (companyId && planId) {
        console.log(`Updating company ${companyId} to plan ${planId}`);
        try {
          await db.collection('companies').doc(companyId).set({
            plan: planId,
            subscriptionStatus: 'active',
            stripeSubscriptionId: session.subscription as string,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
        } catch (error) {
          console.error("Firestore Update Error:", error);
        }
      }
    }

    res.json({ received: true });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
