import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import Stripe from "stripe";
import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import crypto from "crypto";
import { GoogleGenAI } from "@google/genai";
import fs from "fs";

// Cargar configuración de Firebase dinámicamente
let firebaseConfig: any = null;
try {
  const configPath = path.join(process.cwd(), "firebase-applet-config.json");
  if (fs.existsSync(configPath)) {
    firebaseConfig = JSON.parse(fs.readFileSync(configPath, \"utf8\"));
  }
} catch (err) {
  console.error("Error reading firebase-applet-config.json:", err);
}

const adminConfig: admin.AppOptions = {
  credential: admin.credential.applicationDefault()
};

if (firebaseConfig && firebaseConfig.projectId) {
  adminConfig.projectId = firebaseConfig.projectId;
}

// Inicializar Firebase Admin
const app = admin.apps.length ? admin.apps[0] : admin.initializeApp(adminConfig);

// Usar base de datos específica si está disponible
const db = firebaseConfig && firebaseConfig.firestoreDatabaseId
  ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
  : getFirestore(app);

// CORRECCIÓN CRUCIAL: Inicializar Stripe a nivel global para evitar el error "Cannot access 'K' before initialization"
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2023-10-16" as any,
});

// Middleware para parsear JSON convencional
app.use((req, res, next) => {
  if (req.originalUrl === "/api/webhook") {
    next();
  } else {
    express.json()(req, res, next);
  }
});

// --- ENDPOINTS DE STRIPE (PRODUCCIÓN REAL) ---

// Endpoint para crear la sesión de Stripe Checkout
app.post("/api/stripe/create-checkout-session", async (req, res) => {
  try {
    const { priceId, companyId, planId } = req.body;

    if (!priceId || !companyId || !planId) {
      return res.status(400).json({ error: "Faltan parámetros requeridos (priceId, companyId, planId)." });
    }

    // Creamos la sesión de Checkout enviando metadatos para recuperarlos en el Webhook
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      metadata: {
        companyId: companyId,
        planId: planId
      },
      success_url: `${req.headers.origin}/?view=dashboard&payment=success`,
      cancel_url: `${req.headers.origin}/?view=dashboard&payment=cancel`,
    });

    res.json({ url: session.url });
  } catch (error: any) {
    console.error("Error al crear sesión de Stripe Checkout:", error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint del Webhook de Stripe para recibir confirmaciones de pago en tiempo real
app.post('/api/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    if (process.env.STRIPE_WEBHOOK_SECRET && sig) {
      event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } else {
      // Fallback para desarrollo/testing local sin firma estricta
      event = JSON.parse(req.body);
    }
  } catch (err: any) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Cuando la suscripción impacta de forma exitosa en la pasarela de Stripe
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const { companyId, planId } = session.metadata || {};

    if (companyId && planId) {
      console.log(`[Stripe Webhook] Actualizando empresa ${companyId} al plan real: ${planId}`);
      try {
        await db.collection('companies').doc(companyId).set({
          plan: planId,
          subscriptionStatus: 'active',
          stripeSubscriptionId: session.subscription as string,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      } catch (error) {
        console.error("Error al actualizar Firestore desde Webhook:", error);
      }
    }
  }

  res.json({ received: true });
});

// --- MIDDLEWARES Y AMBIENTE DE PRODUCCIÓN / DESARROLLO ---

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor de BioPoint corriendo en http://localhost:${PORT}`);
});