import React, { useState, useEffect } from 'react';
import { 
  CreditCard, Crown, ShieldCheck, Zap, Clock, Loader2, CheckCircle2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// Mapeo de IDs de Precios Reales generados en tu Dashboard de Stripe
const STRIPE_PRICES: Record<string, string> = {
  basic: "price_1QxExampleBasicXXXXXX",      // TODO: Reemplaza con tus IDs reales de Stripe
  standard: "price_1QxExampleStandardXXXX",
  complete: "price_1QxExampleCompleteXXXX",
};

// --- COMPONENTE PRINCIPAL DE LA VISTA DE PRECIOS ---
export function PricingView({ companyId, currentPlan }: { companyId: string, currentPlan?: string }) {
  const [isProcessing, setIsProcessing] = useState(false);

  const handleRealPayment = async (planId: string) => {
    setIsProcessing(true);
    
    try {
      const priceId = STRIPE_PRICES[planId];
      if (!priceId) {
        alert("ID de plan no válido.");
        return;
      }

      // Consumimos el endpoint real de nuestro servidor
      const response = await fetch("/api/stripe/create-checkout-session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          priceId,
          companyId: companyId, 
          planId: planId,       
        }),
      });

      const data = await response.json();

      if (data.url) {
        // Redirección inmediata y segura hacia el portal de cobro certificado de Stripe
        window.location.href = data.url;
      } else {
        throw new Error(data.error || "No se pudo generar la sesión de Stripe.");
      }
    } catch (error: any) {
      console.error("Error al iniciar el pago:", error);
      alert(`Error de conexión con la pasarela: ${error.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const plans = [
    {
      id: 'basic',
      name: 'Plan Básico',
      price: '$499',
      icon: Clock,
      color: 'border-slate-200 bg-white text-slate-800',
      btnColor: 'bg-slate-800 hover:bg-slate-900 text-white',
      features: ['Hasta 50 empleados', 'Soporte por correo electrónico', 'Reportes básicos en Excel', 'Dashboard en tiempo real']
    },
    {
      id: 'standard',
      name: 'Plan Estándar',
      price: '$999',
      icon: Zap,
      color: 'border-indigo-500 bg-gradient-to-b from-indigo-50/50 to-white text-slate-800 ring-2 ring-indigo-500 ring-offset-2',
      btnColor: 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-100',
      features: ['Hasta 300 empleados', 'Analista AI integrado', 'Soporte prioritario 24/7', 'Reportes avanzados y exportación automatizada', 'Alertas tempranas de incidencias'],
      popular: true
    },
    {
      id: 'complete',
      name: 'Plan Completo',
      price: '$1,999',
      icon: Crown,
      color: 'border-slate-800 bg-slate-900 text-white',
      btnColor: 'bg-white hover:bg-slate-100 text-slate-900',
      features: ['Empleados ilimitados', 'Módulo Analista AI Premium', 'Implementación guiada personalizada', 'API de acceso completa para desarrollo', 'Garantía de SLA del 99.9%']
    }
  ];

  return (
    <div className="py-10 px-4 max-w-6xl mx-auto">
      <div className="text-center mb-12">
        <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight sm:text-4xl">
          Planes de Suscripción BioPoint
        </h2>
        <p className="mt-4 text-lg text-slate-600 max-w-2xl mx-auto">
          Lleva el control de asistencia e incidencias biométricas de tu empresa al siguiente nivel sin límites.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-start">
        {plans.map((plan) => {
          const Icon = plan.icon;
          const isCurrent = currentPlan === plan.id;

          return (
            <div 
              key={plan.id}
              className={`relative border rounded-3xl p-8 flex flex-col justify-between transition-all duration-300 ${plan.color}`}
            >
              {plan.popular && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-indigo-600 text-white font-bold text-xs px-4 py-1 rounded-full uppercase tracking-wider">
                  Más Popular
                </span>
              )}

              <div>
                <div className="flex items-center gap-3 mb-4">
                  <div className={`p-2 rounded-xl ${plan.id === 'complete' ? 'bg-slate-800 text-amber-400' : 'bg-indigo-50 text-indigo-600'}`}>
                    <Icon className="w-6 h-6" />
                  </div>
                  <h3 className="font-bold text-xl">{plan.name}</h3>
                </div>

                <div className="flex items-baseline gap-1 my-6">
                  <span className="text-4xl font-extrabold tracking-tight">{plan.price}</span>
                  <span className={`text-xs ${plan.id === 'complete' ? 'text-slate-400' : 'text-slate-500'}`}>/ mes (MXN)</span>
                </div>

                <ul className="space-y-4 mb-8">
                  {plan.features.map((feature, idx) => (
                    <li key={idx} className="flex items-start gap-3 text-sm">
                      <CheckCircle2 className={`w-5 h-5 shrink-0 ${plan.id === 'complete' ? 'text-amber-400' : 'text-indigo-500'}`} />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <button
                onClick={() => handleRealPayment(plan.id)}
                disabled={isProcessing || isCurrent}
                className={`w-full py-3 px-4 font-bold rounded-xl text-xs uppercase tracking-widest transition-all duration-200 disabled:opacity-50 cursor-pointer ${plan.btnColor}`}
              >
                {isProcessing ? (
                  <div className="flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Conectando...</span>
                  </div>
                ) : isCurrent ? (
                  "Plan Activo Actual"
                ) : (
                  "Elegir Plan"
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --- INTEGRA ESTO DENTRO DE TU COMPONENTE APP() GENERAL ---
export default function App() {
  // ... mantiene tus estados de autenticación, cámara y vistas actuales de BioPoint
  const [currentView, setCurrentView] = useState('dashboard');
  const [companyId, setCompanyId] = useState('ID_EMPRESA_DE_PRUEBA_123'); // Proveniente de tu autenticación activa
  const [companyPlan, setCompanyPlan] = useState('basic'); // Campo guardado en Firebase

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Tu Navbar o Sidebar */}
      {currentView === 'pricing' && (
        <PricingView companyId={companyId} currentPlan={companyPlan} />
      )}
      {/* ... El resto de tus vistas como Dashboard, Empleados, etc. */}
    </div>
  );
}