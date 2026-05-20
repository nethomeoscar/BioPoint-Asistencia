import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import Stripe from "stripe";
import admin from "firebase-admin";
import crypto from "crypto";
import { GoogleGenAI } from "@google/genai";

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

  // Helper to query company by API key
  async function getCompanyByApiKey(apiKey: string): Promise<any> {
    if (!apiKey) return null;
    const snap = await db.collection('companies').where('apiKey', '==', apiKey).limit(1).get();
    if (snap.empty) return null;
    return { id: snap.docs[0].id, ...snap.docs[0].data() };
  }

  // Helper to verify user is admin/owner of company
  async function verifyUserCompany(userId: string, companyId: string) {
    if (!userId || !companyId) return false;
    const userSnap = await db.collection('users').doc(userId).get();
    if (!userSnap.exists) return false;
    const userData = userSnap.data();
    return userData && userData.companyId === companyId;
  }

  // Endpoint: Generate API Key
  app.post("/api/generate-api-key", async (req, res) => {
    try {
      const { companyId, userId } = req.body;
      if (!companyId || !userId) {
        return res.status(400).json({ error: "Faltan parámetros requeridos" });
      }
      const hasAccess = await verifyUserCompany(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ error: "No autorizado" });
      }

      // Generate a nice API key prefixing 'biopoint_'
      const apiKey = `biopoint_${crypto.randomBytes(24).toString('hex')}`;
      await db.collection('companies').doc(companyId).update({
        apiKey,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      res.json({ apiKey });
    } catch (err: any) {
      console.error("Error generating API key:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Endpoint: Gemini Report Chat (AI Custom Reports)
  app.post("/api/gemini/report-chat", async (req, res) => {
    try {
      const { companyId, userId, message, history } = req.body;
      if (!companyId || !userId || !message) {
        return res.status(400).json({ error: "Faltan parámetros requeridos" });
      }
      const hasAccess = await verifyUserCompany(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ error: "No autorizado" });
      }

      // Fetch company details to verify premium plan
      const compDoc = await db.collection('companies').doc(companyId).get();
      const plan = compDoc.data()?.plan;
      if (plan !== 'premium' && plan !== 'Completo') {
        return res.status(403).json({ error: "Se requiere adquirir el Plan Completo (Premium) para usar los Reportes Personalizados AI." });
      }

      // Check for Gemini API Key availability
      const geminiKey = process.env.GEMINI_API_KEY;
      if (!geminiKey) {
        return res.status(500).json({ error: "El backend de Inteligencia Artificial no está configurado (falta GEMINI_API_KEY)" });
      }

      // Fetch data context: Employees and Attendance logs (last 150 records)
      const empSnap = await db.collection('employees').where('companyId', '==', companyId).get();
      const emps = empSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      const attSnap = await db.collection('attendance').where('companyId', '==', companyId).orderBy('timestamp', 'desc').limit(150).get();
      const atts = attSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      // Format data snapshot for Gemini context
      const formattedEmps = emps.map((e: any) => `- ${e.name} (Depto: ${e.department || 'N/A'})`).join('\n') || 'Ninguno registrado';
      const formattedAtts = atts.map((a: any) => `- ${a.name} [Fecha: ${a.date}, Hora: ${a.time}, Tipo: ${a.type}, Puntualidad: ${a.punctuality || 'Normal'}, Registro: ${a.status}]`).join('\n') || 'Ninguno registrado';

      const systemInstruction = `Eres un Analista Experto en Recursos Humanos e Inteligencia de Negocios para la plataforma de asistencia BioPoint.
Tienes acceso a la base de datos de empleados y registros de entradas/salidas de la empresa actual.

CONTESTA PRINCIPALMENTE EN ESPAÑOL, con tono analítico, profesional, constructivo y amigable.
Utiliza formatos Markdown (listas, negritas, tablas simples) para que tus reportes y análisis sean muy legibles y atractivos.

INFORMACIÓN REGISTRADA DE LA EMPRESA ACTUAL:
---
EMPLEADOS REGISTRADOS:
${formattedEmps}

ÚLTIMOS 150 REGISTROS DE ASISTENCIA (Más recientes primero):
${formattedAtts}
---

Instrucciones de análisis:
1. Responde a preguntas específicas del usuario sobre puntualidad, quién llegó o no llegó, retrasos, estadísticas por departamento, etc.
2. Si piden reportes de cierto día o período, búscalo en la lista proporcionada.
3. Si detectas fallas o patrones recurrentes (como un empleado con múltiples retrasos), ofrécelo como un hallazgo de valor ("insight").
4. Mantén tus respuestas claras y procesables. Si no puedes responder por falta de datos, indícalo de manera amable.`;

      // Initialize Gemini AI SDK
      const ai = new GoogleGenAI({
        apiKey: geminiKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
      });

      // Prepare chat history if provided
      const chatHistory = (history || []).map((h: any) => ({
        role: h.role,
        parts: [{ text: h.text }]
      }));

      // Generate the AI response
      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: [
          ...chatHistory,
          { role: 'user', parts: [{ text: message }] }
        ],
        config: {
          systemInstruction,
          temperature: 0.7
        }
      });

      res.json({ text: response.text });
    } catch (err: any) {
      console.error("Error in AI report chat:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // REST API v1 for third-party integrations (API para integraciones)
  
  // 1. GET /api/v1/employees - Get list of active employees
  app.get("/api/v1/employees", async (req, res) => {
    try {
      const apiKey = req.headers['x-api-key'] as string;
      if (!apiKey) {
        return res.status(401).json({ error: "Falta x-api-key en las cabeceras" });
      }
      const company = await getCompanyByApiKey(apiKey);
      if (!company) {
        return res.status(401).json({ error: "x-api-key inválida o inactiva" });
      }

      // Check plan (enforce Completo/Premium limit)
      if (company.plan !== 'premium' && company.plan !== 'Completo') {
        return res.status(403).json({ error: "Se requiere adquirir el Plan Completo (Premium) para usar las herramientas API." });
      }

      const snap = await db.collection('employees').where('companyId', '==', company.id).get();
      const employees = snap.docs.map(doc => {
        const d = doc.data();
        return {
          id: doc.id,
          name: d.name,
          department: d.department,
          shiftStart: d.shiftStart || null,
          shiftEnd: d.shiftEnd || null,
          faceRegistered: !!d.faceDescriptor
        };
      });

      res.json({ company: company.name, employees });
    } catch (err: any) {
      console.error("API Employees error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // 2. GET /api/v1/attendance - Get list of attendance logs
  app.get("/api/v1/attendance", async (req, res) => {
    try {
      const apiKey = req.headers['x-api-key'] as string;
      if (!apiKey) {
        return res.status(401).json({ error: "Falta x-api-key en las cabeceras" });
      }
      const company = await getCompanyByApiKey(apiKey);
      if (!company) {
        return res.status(401).json({ error: "x-api-key inválida o inactiva" });
      }

      if (company.plan !== 'premium' && company.plan !== 'Completo') {
        return res.status(403).json({ error: "Se requiere adquirir el Plan Completo (Premium) para usar las herramientas API." });
      }

      const snap = await db.collection('attendance').where('companyId', '==', company.id).orderBy('timestamp', 'desc').get();
      const logs = snap.docs.map(doc => {
        const d = doc.data();
        return {
          id: doc.id,
          name: d.name,
          department: d.department || null,
          date: d.date,
          time: d.time,
          type: d.type,
          punctuality: d.punctuality || 'Normal',
          status: d.status || 'Reconocido',
          timestamp: d.timestamp
        };
      });

      res.json({ company: company.name, count: logs.length, attendance: logs });
    } catch (err: any) {
      console.error("API Attendance error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // 3. POST /api/v1/attendance - Log a new attendance event via external system
  app.post("/api/v1/attendance", async (req, res) => {
    try {
      const apiKey = req.headers['x-api-key'] as string;
      if (!apiKey) {
        return res.status(401).json({ error: "Falta x-api-key en las cabeceras" });
      }
      const company = await getCompanyByApiKey(apiKey);
      if (!company) {
        return res.status(401).json({ error: "x-api-key inválida o inactiva" });
      }

      if (company.plan !== 'premium' && company.plan !== 'Completo') {
        return res.status(403).json({ error: "Se requiere adquirir el Plan Completo (Premium) para usar las herramientas API." });
      }

      const { name, department, type, punctuality, status } = req.body;
      if (!name || !type) {
        return res.status(400).json({ error: "Faltan parámetros requeridos ('name' y 'type')" });
      }

      // Construct a valid entry
      const now = new Date();
      // Format as YYYY-MM-DD
      const dateStr = now.toISOString().split('T')[0];
      // Format as HH:MM:SS
      const timeStr = now.toTimeString().split(' ')[0];

      const newRecord = {
        name,
        department: department || 'Sistemas / Exterior',
        date: dateStr,
        time: timeStr,
        type: type === 'Salida' ? 'Salida' : 'Entrada',
        punctuality: punctuality || 'A tiempo',
        status: status || 'API Externo',
        timestamp: Date.now(),
        companyId: company.id
      };

      const docRef = await db.collection('attendance').add(newRecord);
      res.status(201).json({ success: true, id: docRef.id, record: newRecord });
    } catch (err: any) {
      console.error("API Create attendance error:", err);
      res.status(500).json({ error: err.message });
    }
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
              currency: 'mxn',
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
