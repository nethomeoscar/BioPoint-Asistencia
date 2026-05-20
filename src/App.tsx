import React, { useState, useEffect, useRef } from 'react';
import { 
  Camera, 
  Table, 
  Trash2,
  LogOut, 
  Search, 
  FileSpreadsheet, 
  UserCircle2, 
  CheckCircle2, 
  XCircle, 
  Calendar,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Filter,
  RefreshCcw,
  ArrowRight,
  UserPlus,
  PlayCircle,
  CreditCard,
  Crown,
  ShieldCheck,
  Zap,
  Clock,
  ExternalLink,
  Download,
  Code,
  Sparkles,
  Send,
  Key,
  Copy,
  Check
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import * as XLSX from 'xlsx';
import { format, isWithinInterval, parseISO, startOfDay, endOfDay, addDays, isPast } from 'date-fns';
import { cn } from './lib/utils';

// Firebase Imports
import { initializeApp } from 'firebase/app';
import { 
  getFirestore, 
  collection, 
  addDoc, 
  setDoc,
  deleteDoc,
  getDocs, 
  getDoc,
  query, 
  where,
  orderBy, 
  doc, 
  getDocFromServer,
  onSnapshot 
} from 'firebase/firestore';
import { 
  getAuth, 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged,
  signInAnonymously,
  signOut 
} from 'firebase/auth';
//import firebaseConfig from '../firebase-applet-config.json';
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  firestoreDatabaseId: import.meta.env.VITE_FIRESTORE_DATABASE_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

// Face API Imports
import * as faceapi from 'face-api.js';

// --- Initialization ---
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
const auth = getAuth(app);

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: any;
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// --- Types ---
interface Record {
  id?: string;
  name: string;
  department: string;
  date: string;
  time: string;
  type: 'Entrada' | 'Salida' | 'N/A';
  status: 'Reconocido' | 'No reconocido';
  punctuality?: 'A Tiempo' | 'Retraso' | 'Temprano' | 'Normal';
  timestamp: number;
  companyId: string;
}

interface Employee {
  id?: string;
  name: string;
  department: string;
  faceDescriptor?: number[];
  shiftStart?: string;
  shiftEnd?: string;
  companyId: string;
}

export default function App() {
  const [view, setView] = useState<'kiosk' | 'login' | 'dashboard' | 'camera' | 'data' | 'register' | 'employees' | 'pricing' | 'tutorials'>('kiosk');
  const [user, setUser] = useState<any>(null);
  const [companyId, setCompanyId] = useState<string | null>(localStorage.getItem('biopoint_companyId'));
  const [companyData, setCompanyData] = useState<any>(null);
  const [records, setRecords] = useState<Record[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [isModelsLoaded, setIsModelsLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Load Models
  useEffect(() => {
    const loadModels = async () => {
      try {
        // Use official weights from the author
        const MODEL_URL = 'https://justadudewhohacks.github.io/face-api.js/models';
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
          faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
          faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
        ]);
        console.log("FaceAPI Models Loaded successfully from official source");
        setIsModelsLoaded(true);
      } catch (err) {
        console.error("Error loading models", err);
        // Fallback or retry?
      }
    };
    loadModels();
  }, []);

  // Connection Test
  useEffect(() => {
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if(error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
        }
      }
    }
    testConnection();
  }, []);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      if (u) {
        setIsLoading(true);
        const userRef = doc(db, 'users', u.uid);
        const userSnap = await getDoc(userRef);
        const pairedCid = localStorage.getItem('biopoint_companyId');
        
        let targetCompanyId = '';

        if (u.isAnonymous) {
          // Anonymous Kiosk Logic
          if (pairedCid) {
            targetCompanyId = pairedCid;
            if (!userSnap.exists() || userSnap.data().companyId !== pairedCid) {
              await setDoc(userRef, {
                uid: u.uid,
                companyId: pairedCid,
                role: 'kiosk',
                createdAt: new Date().toISOString()
              }, { merge: true });
              // Force server sync check
              await getDocFromServer(userRef);
            }
          } else if (view === 'kiosk') {
             // Should not happen if kiosk mode is requested but no CID
             console.warn("Kiosk mode without paired company ID");
          }
        } else {
          // Regular Authenticated User (Google/Email)
          if (!userSnap.exists()) {
            targetCompanyId = `comp_${u.uid}`;
            const trialEnds = addDays(new Date(), 15).toISOString();
            
            await setDoc(doc(db, 'companies', targetCompanyId), {
              name: `Empresa de ${u.displayName || 'Usuario'}`,
              plan: 'free',
              trialEndsAt: trialEnds,
              ownerUid: u.uid,
              createdAt: new Date().toISOString()
            });

            await setDoc(userRef, {
              uid: u.uid,
              email: u.email || '',
              companyId: targetCompanyId,
              role: 'owner',
              createdAt: new Date().toISOString()
            });
            // Force server sync check
            await getDocFromServer(userRef);
          } else {
            targetCompanyId = userSnap.data().companyId;
          }
        }

        if (targetCompanyId) {
          setCompanyId(targetCompanyId);
          if (view === 'login') setView('dashboard');
        }
        setUser(u);
        setIsLoading(false);
      } else {
        setUser(null);
        const pairedCid = localStorage.getItem('biopoint_companyId');
        if (pairedCid && view === 'kiosk') {
           try {
             await signInAnonymously(auth);
           } catch (e: any) {
             console.error("Kiosk Auth Error", e);
             if (e.code === 'auth/admin-restricted-operation') {
               setAuthError("Modo Kiosco requiere 'Autenticación Anónima'. Actívala en Firebase Console.");
             }
           }
        } else {
          if (view !== 'kiosk' && view !== 'tutorials') setView('login');
        }
      }
    });
    return unsubscribe;
  }, [view]);

  // Sync Company Data
  useEffect(() => {
    if (!companyId || !user) return;
    const unsub = onSnapshot(doc(db, 'companies', companyId), (snap) => {
      if (snap.exists()) setCompanyData(snap.data());
    });
    return unsub;
  }, [companyId, user]);

  // Sync Records based on companyId
  useEffect(() => {
    if (!companyId || !user) return;

    console.log(`Syncing records for company: ${companyId} as user: ${user.uid}`);

    const qRecords = query(
      collection(db, 'attendance'), 
      where('companyId', '==', companyId),
      orderBy('timestamp', 'desc')
    );
    const unsubRecords = onSnapshot(qRecords, (snap) => {
      setRecords(snap.docs.map(d => ({ id: d.id, ...d.data() } as Record)));
    }, (error) => {
      console.warn("Retrying records sync due to potential rules latency...");
      setTimeout(() => {
        if (companyId && user) {
          onSnapshot(qRecords, (s) => setRecords(s.docs.map(d => ({ id: d.id, ...d.data() } as Record))), (err) => handleFirestoreError(err, OperationType.LIST, `attendance`));
        }
      }, 2000);
    });

    const qEmployees = query(
      collection(db, 'employees'),
      where('companyId', '==', companyId)
    );
    const unsubEmployees = onSnapshot(qEmployees, (snap) => {
      const emps = snap.docs.map(d => ({ id: d.id, ...d.data() } as Employee));
      setEmployees(emps.sort((a, b) => a.name.localeCompare(b.name)));
    }, (error) => {
       console.warn("Retrying employees sync due to potential rules latency...");
       setTimeout(() => {
         if (companyId && user) {
           onSnapshot(qEmployees, (s) => {
             const emps = s.docs.map(d => ({ id: d.id, ...d.data() } as Employee));
             setEmployees(emps.sort((a, b) => a.name.localeCompare(b.name)));
           }, (err) => handleFirestoreError(err, OperationType.LIST, `employees`));
         }
       }, 2000);
    });

    return () => {
      unsubRecords();
      unsubEmployees();
    };
  }, [companyId, user]);

  const handleGoogleLogin = async () => {
    setIsLoading(true);
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    const pairedCid = localStorage.getItem('biopoint_companyId');
    setCompanyId(pairedCid); 
    setCompanyData(null);
    setView(pairedCid ? 'kiosk' : 'login');
  };

  const pairDevice = async () => {
    if (companyId) {
      localStorage.setItem('biopoint_companyId', companyId);
      if (auth.currentUser) {
        // Only update role to kiosk if it's not owner/admin
        const userRef = doc(db, 'users', auth.currentUser.uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists() && userSnap.data().role !== 'owner' && userSnap.data().role !== 'admin') {
          await setDoc(userRef, {
            companyId: companyId,
            role: 'kiosk',
            pairedAt: new Date().toISOString()
          }, { merge: true });
        }
      }
      alert("Dispositivo vinculado exitosamente a esta empresa como Kiosco.");
    }
  };

  const isTrialActive = companyData?.plan !== 'free' || (companyData?.trialEndsAt && !isPast(parseISO(companyData.trialEndsAt)));

  return (
    <div className="min-h-screen bg-gray-50">
      {authError && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] w-[90%] max-w-md">
          <div className="bg-rose-50 border border-rose-100 p-6 rounded-2xl shadow-xl flex items-start gap-4">
            <div className="w-10 h-10 bg-rose-100 rounded-xl flex items-center justify-center shrink-0">
               <ShieldCheck className="w-5 h-5 text-rose-600" />
            </div>
            <div className="flex-1">
              <h4 className="text-sm font-bold text-rose-900 mb-1">Configuración Requerida</h4>
              <p className="text-xs text-rose-700 leading-relaxed font-medium">
                {authError.includes('Anonymous Auth') 
                  ? "El Modo Kiosco requiere 'Autenticación Anónima'. Actívalo en Firebase Console > Authentication > Sign-in method."
                  : authError}
              </p>
              <button onClick={() => setAuthError(null)} className="mt-3 text-[10px] font-black uppercase text-rose-600">Cerrar</button>
            </div>
          </div>
        </div>
      )}
      <AnimatePresence mode="wait">
        {view === 'kiosk' && (
          <CameraView 
            key="kiosk"
            employees={employees}
            records={records}
            companyId={companyId}
            onBack={() => setView('login')}
            onTutorials={() => setView('tutorials')}
            isKiosk
            isModelsLoaded={isModelsLoaded}
            isTrialActive={isTrialActive}
          />
        )}

        {view === 'login' && (
          <LoginView 
            key="login"
            onLogin={handleGoogleLogin} 
            isLoading={isLoading}
            onCancel={() => setView('kiosk')}
            onTutorials={() => setView('tutorials')}
          />
        )}

        {view === 'dashboard' && (
          <DashboardView 
            key="dashboard"
            user={user} 
            companyData={companyData}
            onNavigate={setView} 
            onLogout={handleLogout}
            onPair={pairDevice}
            isModelsLoaded={isModelsLoaded}
            isTrialActive={isTrialActive}
          />
        )}

        {view === 'pricing' && (
          <PricingView 
            key="pricing"
            companyData={companyData}
            companyId={companyId}
            onBack={() => setView('dashboard')}
          />
        )}

        {view === 'tutorials' && (
          <TutorialView 
            key="tutorials"
            onBack={() => user ? setView('dashboard') : setView('kiosk')}
          />
        )}

        {view === 'camera' && (
          <CameraView 
            key="camera"
            employees={employees}
            records={records}
            companyId={companyId}
            onBack={() => setView('dashboard')} 
            isModelsLoaded={isModelsLoaded}
            isTrialActive={isTrialActive}
          />
        )}

        {view === 'register' && (
          <RegisterView 
            key="register"
            companyId={companyId}
            onBack={() => setView('dashboard')}
            onSuccess={() => setView('dashboard')}
            isModelsLoaded={isModelsLoaded}
            isLocked={!isTrialActive}
          />
        )}

        {view === 'data' && (
          <DataTableView 
            key="data"
            records={records}
            companyId={companyId!}
            companyData={companyData}
            onBack={() => setView('dashboard')}
            onNavigate={(v) => setView(v)}
            onDelete={(id) => setRecords(prev => prev.filter(r => r.id !== id))}
          />
        )}

        {view === 'api' && (
          <ApiIntegrationView 
            key="api"
            companyId={companyId}
            companyData={companyData}
            userId={user?.uid || ""}
            onBack={() => setView('dashboard')}
            onNavigate={(v) => setView(v)}
          />
        )}

        {view === 'employees' && (
          <EmployeesListView 
            key="employees"
            employees={employees}
            companyId={companyId!}
            onBack={() => setView('dashboard')}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// --- Views ---

function LoginView({ onLogin, isLoading, onCancel, onTutorials }: any) {
  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="flex flex-col items-center justify-center p-4 min-h-screen bg-slate-50"
    >
      <div className="mb-8 flex flex-col items-center gap-4">
        <button 
          onClick={onCancel}
          className="flex items-center gap-2 text-slate-400 hover:text-indigo-600 font-bold text-[10px] uppercase tracking-widest transition-all"
        >
          <ChevronLeft className="w-4 h-4" /> Regresar al Modo Kiosco
        </button>
        <button 
          onClick={onTutorials}
          className="flex items-center gap-2 text-indigo-600 font-bold text-[10px] uppercase tracking-widest bg-white px-6 py-3 rounded-2xl shadow-sm border border-indigo-100 hover:shadow-md transition-all"
        >
          <PlayCircle className="w-4 h-4" /> Ver Tutoriales
        </button>
      </div>

      <div className="w-full max-w-md bg-white rounded-[2.5rem] shadow-2xl border border-slate-100 p-8 md:p-12">
        <div className="flex justify-center mb-10">
          <div className="w-20 h-20 bg-indigo-600 rounded-[2rem] flex items-center justify-center shadow-lg shadow-indigo-100 rotate-3">
            <Camera className="w-10 h-10 text-white" />
          </div>
        </div>
        
        <h1 className="text-3xl font-bold text-center text-slate-800 mb-2 tracking-tight">BioPoint</h1>
        <p className="text-center text-indigo-600 font-bold mb-8 text-sm uppercase tracking-widest">Asistencia</p>

        <p className="text-slate-500 text-sm text-center mb-8 font-medium px-4">
          Accede con tu cuenta autorizada para gestionar el control de asistencia.
        </p>

        <button 
          onClick={onLogin}
          disabled={isLoading}
          className="w-full py-4 bg-slate-800 hover:bg-slate-900 text-white rounded-2xl font-bold text-sm transition-all flex items-center justify-center gap-3 shadow-xl active:scale-[0.98]"
        >
          {isLoading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <>
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="currentColor" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84z"/>
                <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
              </svg>
              Ingresar con Google
            </>
          )}
        </button>

        <div className="mt-10 text-center text-[10px] font-bold text-slate-300 uppercase tracking-widest">
           Powered by BioPoint Technology
        </div>
      </div>
    </motion.div>
  );
}

function DashboardView({ user, companyData, onNavigate, onLogout, onPair, isModelsLoaded, isTrialActive }: any) {
  const trialDaysLeft = companyData?.trialEndsAt ? Math.max(0, Math.ceil((parseISO(companyData.trialEndsAt).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))) : 0;

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="p-6 md:p-10 max-w-6xl mx-auto"
    >
      <header className="flex justify-between items-center mb-10">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-100">
             <Camera className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-800">BioPoint <span className="text-indigo-600">Asistencia</span></h1>
            {companyData?.plan === 'free' && (
              <div className="flex items-center gap-2 mt-1">
                <span className={cn(
                  "text-[9px] font-black uppercase tracking-[0.2em] px-2 py-0.5 rounded-full",
                  isTrialActive ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"
                )}>
                  {isTrialActive ? `Trial: ${trialDaysLeft} Días` : 'Trial Expirado'}
                </span>
                {!isTrialActive && (
                  <button onClick={() => onNavigate('pricing')} className="text-[9px] font-bold text-indigo-600 underline">Elegir Plan</button>
                )}
              </div>
            )}
            {companyData?.plan !== 'free' && (
              <span className="text-[9px] font-black uppercase tracking-[0.2em] px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 flex items-center gap-1">
                <Crown className="w-2 h-2" /> Plan {companyData?.plan}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden md:block text-right mr-2">
             <p className="text-sm font-bold text-slate-800 leading-none">{user?.displayName || 'Admin'}</p>
             <p className="text-[10px] font-bold text-indigo-600 uppercase tracking-widest mt-1 tracking-tighter">{companyData?.name || 'EMPRESA'}</p>
          </div>
          <button 
            onClick={() => onNavigate('tutorials')}
            title="Tutoriales"
            className="p-3 bg-white border border-slate-200 rounded-2xl text-slate-400 hover:text-indigo-600 hover:border-indigo-100 hover:bg-indigo-50 transition-all shadow-sm"
          >
            <PlayCircle className="w-5 h-5" />
          </button>
          <button 
            onClick={onPair}
            title="Vincular este dispositivo como Kiosco"
            className="p-3 bg-white border border-slate-200 rounded-2xl text-slate-400 hover:text-indigo-600 hover:border-indigo-100 hover:bg-indigo-50 transition-all shadow-sm"
          >
            <RefreshCcw className="w-5 h-5" />
          </button>
          <button 
            onClick={onLogout}
            className="p-3 bg-white border border-slate-200 rounded-2xl text-slate-400 hover:text-red-600 hover:border-red-100 hover:bg-red-50 transition-all shadow-sm"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-6 mb-12">
        <div className="md:col-span-8 grid grid-cols-1 sm:grid-cols-2 gap-6">
          <DashboardCard 
            title="Toma de Asistencia"
            description="Reconocimiento facial biométrico en tiempo real."
            icon={<Camera className="w-6 h-6" />}
            onClick={() => onNavigate('camera')}
            className="bg-white"
            iconClass="bg-indigo-600"
          />
          <DashboardCard 
            title="Ingresar a Información"
            description="Base de datos completa con filtros y reportes."
            icon={<Table className="w-6 h-6" />}
            onClick={() => onNavigate('data')}
            className="bg-white"
            iconClass="bg-indigo-600"
          />
          <DashboardCard 
            title="Gestionar Empleados"
            description="Lista de personal registrado y estado biométrico."
            icon={<UserCircle2 className="w-6 h-6" />}
            onClick={() => onNavigate('employees')}
            className="bg-white"
            iconClass="bg-indigo-600"
          />
          <DashboardCard 
            title="Registrar Empleado"
            description="Agrega nuevos rostros a la base de datos biométrica."
            icon={<UserPlus className="w-6 h-6" />}
            onClick={() => onNavigate('register')}
            className={cn("bg-white", !isTrialActive && "opacity-50 grayscale cursor-not-allowed")}
            iconClass="bg-indigo-600"
          />
          <DashboardCard 
            title="API & Integraciones"
            description="Gestiona llaves de acceso y conecta sistemas externos o ERPs."
            icon={<Code className="w-6 h-6" />}
            onClick={() => onNavigate('api')}
            className="bg-white"
            iconClass={cn("bg-indigo-600", companyData?.plan !== 'premium' && companyData?.plan !== 'Completo' && "bg-amber-600")}
          />
        </div>

        <div className="md:col-span-4">
          <div className="indigo-card h-full p-8 flex flex-col">
            <h3 className="text-white/70 text-xs font-bold uppercase tracking-wider mb-2">Suscripción</h3>
            <div className="flex items-end gap-2 mb-6">
              <span className="text-4xl font-bold uppercase">{companyData?.plan === 'free' ? 'Trial' : companyData?.plan}</span>
              <span className="text-indigo-200 text-sm font-bold mb-1 uppercase tracking-widest">{isTrialActive ? 'Active' : 'Expired'}</span>
            </div>
            
            <p className="text-indigo-100 text-xs font-medium mb-8 leading-relaxed">
              {isTrialActive 
                ? (companyData?.plan === 'free' ? `Tu periodo de prueba de 15 días expira en ${trialDaysLeft} días. ¡Asegura tu suscripción hoy!` : `Gracias por usar el plan ${companyData?.plan}.`)
                : 'Tu periodo de prueba ha terminado. Por favor, selecciona un plan para continuar registrando personal.'
              }
            </p>

            <button 
              onClick={() => onNavigate('pricing')}
              className="bg-white text-indigo-600 py-3 rounded-2xl font-bold text-xs uppercase tracking-widest shadow-xl shadow-indigo-900/20 hover:scale-[1.02] transition-all flex items-center justify-center gap-2"
            >
              <CreditCard className="w-4 h-4" /> {companyData?.plan === 'free' ? 'Ver Planes' : 'Cambiar Plan'}
            </button>

            <div className="absolute -right-6 -bottom-6 opacity-10">
              <UserCircle2 className="w-40 h-40" />
            </div>
          </div>
        </div>
      </div>

      <footer className="flex justify-between items-center text-slate-400 text-[10px] font-bold uppercase tracking-widest border-t border-slate-100 pt-8">
        <p>© 2024 BioPoint Tech - v3.0.0</p>
        <div className="flex gap-6">
          <span className="flex items-center gap-1.5">MODELS: <strong className={cn(isModelsLoaded ? "text-green-500" : "text-amber-500")}>{isModelsLoaded ? 'READY' : 'LOADING'}</strong></span>
          <span className="flex items-center gap-1.5">DATABASE: <strong className="text-green-500">FIREBASE</strong></span>
        </div>
      </footer>
    </motion.div>
  );
}

function DashboardCard({ title, description, icon, onClick, className, iconClass }: any) {
  return (
    <button 
      onClick={onClick}
      className={cn("bento-card p-8 group text-left h-full flex flex-col", className)}
    >
      <div className={cn("w-14 h-14 rounded-2xl flex items-center justify-center mb-6 transition-transform group-hover:scale-110 shadow-lg text-white", iconClass)}>
        {icon}
      </div>
      <h3 className="text-xl font-bold text-slate-800 mb-2 group-hover:text-indigo-600 transition-colors flex items-center gap-2">
        {title} <ArrowRight className="w-5 h-5 opacity-0 group-hover:opacity-100 -translate-x-2 group-hover:translate-x-0 transition-all font-bold" />
      </h3>
      <p className="text-slate-400 text-sm font-medium leading-relaxed">{description}</p>
    </button>
  );
}

function CameraView({ onBack, onTutorials, employees, records, companyId, isKiosk, isModelsLoaded, isTrialActive }: { onBack: () => void; onTutorials?: () => void; employees: Employee[]; records: Record[]; companyId: string | null; isKiosk?: boolean; isModelsLoaded: boolean; isTrialActive: boolean; key?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<'idle' | 'scanning' | 'success' | 'failed'>('idle');
  const [result, setResult] = useState<Record | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);

  const startCamera = async () => {
    if (!companyId && isKiosk) {
      alert("Este dispositivo no ha sido vinculado a ninguna empresa. Por favor, inicie sesión como administrador.");
      onBack();
      return;
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'user' } 
      });
      setStream(s);
      if (videoRef.current) {
        videoRef.current.srcObject = s;
        setStatus('scanning');
      }
    } catch (err) {
      alert("No se pudo acceder a la cámara.");
      onBack();
    }
  };

  useEffect(() => {
    startCamera();
    return () => {
      if (stream) stream.getTracks().forEach(t => t.stop());
    };
  }, []);

  const handleRecognition = async () => {
    if (!videoRef.current || status !== 'scanning' || !isModelsLoaded) return;

    if (!isTrialActive && isKiosk) {
      alert("Periodo de prueba terminado. Por favor contacte al administrador.");
      return;
    }

    // Use TinyFaceDetector for performance
    const detection = await faceapi.detectSingleFace(videoRef.current, new faceapi.TinyFaceDetectorOptions())
      .withFaceLandmarks()
      .withFaceDescriptor();

    if (!detection) return;

    let bestMatch = null;
    let minDistance = 0.55; // Common threshold for face-api

    employees.forEach(emp => {
      if (emp.faceDescriptor) {
        const distance = faceapi.euclideanDistance(detection.descriptor, new Float32Array(emp.faceDescriptor));
        if (distance < minDistance) {
          minDistance = distance;
          bestMatch = emp;
        }
      }
    });

    if (bestMatch) {
      const now = new Date();
      const currentTimeStr = format(now, "HH:mm");
      let entryType: 'Entrada' | 'Salida' = now.getHours() < 13 ? 'Entrada' : 'Salida';
      
      // PREVENCIÓN DE DUPLICADOS: 
      // Verificar si ya existe un registro para este empleado, del mismo tipo, en la última hora
      const oneHourAgo = Date.now() - (60 * 60 * 1000);
      const isDuplicate = records.some(r => 
        r.name === bestMatch.name && 
        r.type === entryType && 
        r.timestamp > oneHourAgo
      );

      if (isDuplicate) {
        setResult({
          name: bestMatch.name,
          department: bestMatch.department,
          date: format(now, "yyyy-MM-dd"),
          time: format(now, "HH:mm:ss"),
          type: entryType,
          status: 'Reconocido',
          timestamp: Date.now(),
          companyId: companyId!
        } as Record);
        setStatus('success'); // Mostramos éxito pero no guardamos en DB
        
        // Detener cámara momentáneamente
        if (stream) stream.getTracks().forEach(t => t.stop());

        setTimeout(() => {
          setStatus('idle');
          startCamera();
          setResult(null);
        }, 3000);
        return;
      }

      let punctuality: 'A Tiempo' | 'Retraso' | 'Temprano' | 'Normal' = 'A Tiempo';

      if (entryType === 'Entrada' && bestMatch.shiftStart) {
        punctuality = currentTimeStr > bestMatch.shiftStart ? 'Retraso' : 'A Tiempo';
      } else if (entryType === 'Salida' && bestMatch.shiftEnd) {
        punctuality = currentTimeStr < bestMatch.shiftEnd ? 'Temprano' : 'Normal';
      }

      const newRecord: Record = {
        name: bestMatch.name,
        department: bestMatch.department,
        date: format(now, "yyyy-MM-dd"),
        time: format(now, "HH:mm:ss"),
        type: entryType, 
        status: 'Reconocido',
        punctuality,
        timestamp: Date.now(),
        companyId: companyId!
      };

      try {
        console.log("Saving attendance record:", newRecord);
        await addDoc(collection(db, 'attendance'), newRecord);
        setResult(newRecord);
        setStatus('success');
        if (stream) stream.getTracks().forEach(t => t.stop());

        // Auto-reset after 3 seconds to allow the next person
        setTimeout(() => {
          setStatus('idle');
          startCamera();
          setResult(null);
        }, 3000);
      } catch (err) {
        console.error("Attendance creation failed, retrying once...");
        // Wait a bit and retry if it's a permission error (could be rules latency)
        setTimeout(async () => {
          try {
             await addDoc(collection(db, 'attendance'), newRecord);
             setResult(newRecord);
             setStatus('success');
             if (stream) if (videoRef.current?.srcObject instanceof MediaStream) (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
          } catch (retryErr) {
             handleFirestoreError(retryErr, OperationType.CREATE, 'attendance');
          }
        }, 1500);
      }
    } else {
      // After some time if no match, we can mark as failed
      // For the demo, we fail immediately if no match found in this specific Frame check
      // but usually we'd wait for N frames.
    }
  };

  useEffect(() => {
    let interval: any;
    if (status === 'scanning') {
      interval = setInterval(() => {
        handleRecognition();
      }, 1200);
    }
    return () => clearInterval(interval);
  }, [status, employees]);

  const markAsUnknown = async () => {
    if (status !== 'scanning') return;
    const now = new Date();
    const failRecord: Record = {
      name: 'Desconocido',
      department: '—',
      date: format(now, "yyyy-MM-dd"),
      time: format(now, "HH:mm:ss"),
      type: 'N/A',
      status: 'No reconocido',
      timestamp: Date.now(),
      companyId: companyId!
    };
    try {
      await addDoc(collection(db, 'attendance'), failRecord);
      setStatus('failed');
      if (stream) stream.getTracks().forEach(t => t.stop());

      // Auto-reset after a short delay for unknown persons
      setTimeout(() => {
        if (status === 'failed') {
          setStatus('idle');
          startCamera();
        }
      }, 3000);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-slate-50 flex flex-col p-6 md:p-10"
    >
      <div className="w-full max-w-6xl mx-auto flex justify-between items-center mb-8 relative z-50">
        <div className="flex gap-4">
          <button 
            onClick={onBack}
            className="flex items-center gap-2 px-6 py-3 bg-white border border-slate-200 text-slate-700 font-bold rounded-2xl transition-all shadow-sm hover:shadow-md active:scale-95 text-xs uppercase tracking-widest"
          >
            <ChevronLeft className="w-5 h-5 text-indigo-600" /> {isKiosk ? "Acceso Admin" : "Regresar al Menú"}
          </button>
          {isKiosk && onTutorials && (
            <button 
              onClick={onTutorials}
              className="flex items-center gap-2 px-6 py-3 bg-white border border-slate-200 text-indigo-600 font-bold rounded-2xl transition-all shadow-sm hover:shadow-md active:scale-95 text-xs uppercase tracking-widest"
            >
              <PlayCircle className="w-5 h-5" /> Tutoriales
            </button>
          )}
        </div>
        <div className="flex items-center gap-3 px-6 py-3 bg-white border border-slate-200 rounded-2xl shadow-sm">
          <div className={cn(
            "w-3 h-3 rounded-full animate-pulse",
            status === 'scanning' ? "bg-indigo-500" : status === 'success' ? "bg-emerald-500" : "bg-rose-500"
          )} />
          <span className="text-slate-800 font-bold uppercase tracking-widest text-[10px]">
            {status === 'scanning' ? "Analizando Rostro..." : status === 'success' ? "Escaneo Biométrico" : "Error de Detección"}
          </span>
        </div>
      </div>

      <div className="flex-1 w-full max-w-4xl mx-auto bento-card overflow-hidden shadow-2xl flex flex-col relative bg-black border-none">
        <video 
          ref={videoRef} 
          autoPlay 
          playsInline 
          muted 
          className="w-full h-full object-cover rounded-[2rem] contrast-125 brightness-110"
        />
        
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent"></div>
          {status === 'scanning' && (
            <>
              <div className="scanner-line h-1 shadow-[0_0_20px_rgba(99,102,241,1)]" />
              <div className="scanner-frame border-2 border-indigo-400 border-dashed" />
              <div className="absolute top-8 left-8 flex items-center gap-2">
                <div className="w-2.5 h-2.5 bg-rose-500 rounded-full animate-pulse"></div>
                <span className="text-white/60 text-[10px] font-bold uppercase tracking-[0.2em]">LIVE BIOMETRIC 01</span>
              </div>
            </>
          )}

          <AnimatePresence>
            {status === 'success' && (
              <motion.div 
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="absolute inset-x-0 bottom-12 flex justify-center px-6"
              >
                <div className="bg-emerald-500 text-white px-10 py-5 rounded-full flex items-center gap-4 shadow-2xl shadow-emerald-500/30">
                  <CheckCircle2 className="w-8 h-8" />
                  <span className="font-bold text-xl tracking-tight">REGISTRO EXITOSO</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="mt-8 w-full max-w-sm mx-auto">
        <AnimatePresence>
          {status === 'success' && (
            <motion.div 
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              className="bg-white rounded-3xl p-8 text-center shadow-xl border border-slate-100"
            >
              <div className="text-left bg-slate-50 rounded-2xl p-5 space-y-4 mb-6">
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Empleado Reconocido</p>
                  <p className="text-xl font-bold text-slate-800">{result?.name}</p>
                </div>
                <div className="flex justify-between border-t border-slate-100 pt-4">
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Acción / Estado</p>
                    <p className={cn("font-bold text-sm flex items-center gap-2", result?.type === 'Entrada' ? "text-emerald-600" : "text-orange-600")}>
                      {result?.type} 
                      {result?.punctuality && (
                        <span className={cn(
                          "px-1.5 py-0.5 rounded text-[8px] uppercase",
                          result.punctuality === 'Retraso' || result.punctuality === 'Temprano' ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"
                        )}>
                          • {result.punctuality}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Hora Local</p>
                    <p className="text-slate-800 font-mono font-bold text-sm">{result?.time}</p>
                  </div>
                </div>
              </div>

              <button 
                onClick={onBack}
                className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold shadow-lg shadow-indigo-100 active:scale-95 transition-all text-sm uppercase tracking-widest"
              >
                Finalizar Sesión
              </button>
            </motion.div>
          )}

          {status === 'failed' && (
            <motion.div 
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              className="bg-white rounded-3xl p-8 text-center shadow-xl border border-slate-100"
            >
              <div className="w-16 h-16 bg-rose-50 rounded-[1.5rem] flex items-center justify-center mx-auto mb-6 shadow-lg rotate-6">
                <XCircle className="w-10 h-10 text-rose-500" />
              </div>
              <h3 className="text-2xl font-bold text-slate-800 mb-2">Persona no reconocida</h3>
              <p className="text-slate-400 text-sm mb-8 font-medium">No se encontró coincidencia biométrica.</p>
              
              <div className="flex flex-col gap-3">
                <button 
                  onClick={() => { setStatus('idle'); startCamera(); }}
                  className="w-full py-4 bg-slate-50 text-slate-700 rounded-2xl font-bold flex items-center justify-center gap-2 border border-slate-200 active:scale-95 transition-all text-sm uppercase tracking-widest"
                >
                  <RefreshCcw className="w-4 h-4 text-indigo-600" /> Reintentar Escaneo
                </button>
                <button 
                  onClick={onBack}
                  className="w-full py-4 bg-slate-800 text-white rounded-2xl font-bold active:scale-95 transition-all text-sm uppercase tracking-widest"
                >
                  Regresar
                </button>
              </div>
            </motion.div>
          )}
          
          {status === 'scanning' && (
             <button 
                onClick={markAsUnknown}
                className="w-full py-4 bg-white/10 hover:bg-white/20 text-slate-400 rounded-2xl font-bold border border-slate-200 text-xs uppercase tracking-widest transition-all mt-4"
              >
                Forzar No Reconocido (Demo)
              </button>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

function RegisterView({ onBack, onSuccess, companyId, isModelsLoaded, isLocked }: { onBack: () => void; onSuccess: () => void; companyId: string | null; isModelsLoaded: boolean; isLocked?: boolean; key?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [name, setName] = useState('');
  const [dept, setDept] = useState('');
  const [shiftStart, setShiftStart] = useState('08:00');
  const [shiftEnd, setShiftEnd] = useState('17:00');
  const [isCapturing, setIsCapturing] = useState(false);
  const [capturedDescriptor, setCapturedDescriptor] = useState<number[] | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);

  useEffect(() => {
    async function start() {
      if (!companyId || isLocked) return;
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: true });
        setStream(s);
        if (videoRef.current) videoRef.current.srcObject = s;
      } catch (err) {
        console.error(err);
      }
    }
    start();
    return () => stream?.getTracks().forEach(t => t.stop());
  }, [companyId, isLocked]);

  useEffect(() => {
    if (stream && videoRef.current && !videoRef.current.srcObject) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  const handleCapture = async () => {
    if (!videoRef.current || !isModelsLoaded || isLocked) {
      if (!isModelsLoaded) alert("Espera a que los modelos carguen...");
      return;
    }
    setIsCapturing(true);
    try {
      console.log("Detecting face...");
      const detection = await faceapi.detectSingleFace(videoRef.current, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }))
        .withFaceLandmarks()
        .withFaceDescriptor();
      
      if (detection) {
        console.log("Face detected!");
        setCapturedDescriptor(Array.from(detection.descriptor));
      } else {
        alert("No se detectó rostro. Asegúrate de estar frente a la cámara y con buena iluminación.");
      }
    } catch (err) {
      console.error("Capture Error:", err);
      alert("Error al capturar rostro: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsCapturing(false);
    }
  };

  const handleSave = async () => {
    if (!name || !dept || !capturedDescriptor || !companyId) {
      alert("Por favor completa todos los campos y captura el rostro.");
      return;
    }
    if (isLocked) return;
    
    setIsCapturing(true);
    try {
      await addDoc(collection(db, 'employees'), {
        name: name.trim(),
        department: dept.trim(),
        shiftStart,
        shiftEnd,
        faceDescriptor: capturedDescriptor,
        companyId,
        createdAt: new Date().toISOString()
      });
      onSuccess();
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'employees');
    } finally {
      setIsCapturing(false);
    }
  };

  const isFormValid = name.trim() !== '' && dept.trim() !== '' && capturedDescriptor !== null;

  return (
    <motion.div 
      initial={{ opacity: 0, x: 20 }} 
      animate={{ opacity: 1, x: 0 }} 
      className="p-6 md:p-10 max-w-5xl mx-auto w-full"
    >
      <header className="flex items-center gap-4 mb-10">
        <button onClick={onBack} className="p-3 bg-white border border-slate-200 rounded-2xl shadow-sm hover:bg-slate-50 transition-all">
          <ChevronLeft className="w-5 h-5 text-indigo-600" />
        </button>
        <div>
          <h2 className="text-3xl font-bold text-slate-800 tracking-tight">Registro Biométrico</h2>
          <p className="text-slate-400 font-bold uppercase tracking-widest text-[10px] mt-1">Alta de nuevos empleados</p>
        </div>
      </header>

      {isLocked ? (
        <div className="bg-rose-50 border border-rose-100 p-12 rounded-[2.5rem] text-center max-w-2xl mx-auto">
          <div className="w-20 h-20 bg-rose-100 rounded-[2rem] flex items-center justify-center mx-auto mb-6 shadow-xl shadow-rose-200/20 rotate-6">
            <ShieldCheck className="w-10 h-10 text-rose-600" />
          </div>
          <h3 className="text-2xl font-bold text-slate-800 mb-3">Periodo de Prueba Agotado</h3>
          <p className="text-slate-500 font-medium mb-8 leading-relaxed">
            Has alcanzado el límite de tu periodo de prueba o este ha expirado. 
            Para continuar registrando personal y usando las funciones avanzadas, por favor adquiere un plan.
          </p>
          <button 
            className="px-10 py-4 bg-indigo-600 text-white rounded-2xl font-bold text-sm uppercase tracking-widest shadow-xl shadow-indigo-100 hover:scale-[1.02] active:scale-95 transition-all"
            onClick={onBack}
          >
            Actualizar Mi Plan
          </button>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-8">
        <div className="bento-card overflow-hidden bg-slate-900 border-none aspect-video flex items-center justify-center relative shadow-2xl">
          <video ref={videoRef} autoPlay muted playsInline className={cn("w-full h-full object-cover", capturedDescriptor && "opacity-50")} />
          <AnimatePresence>
            {capturedDescriptor && (
              <motion.div 
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="absolute inset-0 flex flex-col items-center justify-center bg-emerald-500/20 backdrop-blur-sm"
              >
                 <CheckCircle2 className="w-16 h-16 text-emerald-500 mb-2" />
                 <span className="text-white font-bold uppercase tracking-widest text-[10px]">Patrón Capturado</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="space-y-6 flex flex-col justify-center">
          <div className="space-y-4">
            <div className="space-y-1.5">
               <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Nombre Completo</label>
               <input 
                type="text" placeholder="Ej: Valentina Serna" value={name} onChange={e => setName(e.target.value)}
                className="w-full px-6 py-4 rounded-2xl bg-white border border-slate-200 outline-none focus:ring-2 focus:ring-indigo-500 transition-all font-medium text-sm"
              />
            </div>
            <div className="space-y-1.5">
               <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Departamento</label>
               <input 
                type="text" placeholder="Ej: Operaciones" value={dept} onChange={e => setDept(e.target.value)}
                className="w-full px-6 py-4 rounded-2xl bg-white border border-slate-200 outline-none focus:ring-2 focus:ring-indigo-500 transition-all font-medium text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                 <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Horario Entrada</label>
                 <input 
                  type="time" value={shiftStart} onChange={e => setShiftStart(e.target.value)}
                  className="w-full px-6 py-4 rounded-2xl bg-white border border-slate-200 outline-none focus:ring-2 focus:ring-indigo-500 transition-all font-medium text-sm"
                />
              </div>
              <div className="space-y-1.5">
                 <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Horario Salida</label>
                 <input 
                  type="time" value={shiftEnd} onChange={e => setShiftEnd(e.target.value)}
                  className="w-full px-6 py-4 rounded-2xl bg-white border border-slate-200 outline-none focus:ring-2 focus:ring-indigo-500 transition-all font-medium text-sm"
                />
              </div>
            </div>
          </div>

          <div className="pt-4">
            {!capturedDescriptor ? (
              <button 
                onClick={handleCapture} disabled={isCapturing}
                className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold flex items-center justify-center gap-3 shadow-xl shadow-indigo-100 hover:bg-indigo-700 transition-all active:scale-95 text-xs uppercase tracking-widest"
              >
                {isCapturing ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Camera size={18}/> Capturar Rostro</>}
              </button>
            ) : (
              <div className="flex gap-4">
                 <button onClick={() => setCapturedDescriptor(null)} className="flex-1 py-4 bg-slate-50 text-slate-700 border border-slate-200 rounded-2xl font-bold active:scale-95 transition-all text-xs uppercase tracking-widest">Reiniciar</button>
                 <button 
                  onClick={handleSave} 
                  disabled={!isFormValid || isCapturing} 
                  className={cn(
                    "flex-1 py-4 rounded-2xl font-bold transition-all text-xs uppercase tracking-widest",
                    isFormValid && !isCapturing 
                      ? "bg-emerald-600 text-white shadow-xl shadow-emerald-100 hover:bg-emerald-700 active:scale-95" 
                      : "bg-slate-100 text-slate-400 cursor-not-allowed"
                  )}
                >
                  Guardar Empleado
                </button>
              </div>
            )}
          </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}

function EmployeesListView({ employees, onBack, companyId }: { employees: Employee[]; onBack: () => void; companyId: string | null; key?: string }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [deptFilter, setDeptFilter] = useState('All');

  const departments = ['All', ...new Set(employees.map(e => e.department))];

  const handleDelete = async (id: string) => {
    if (confirm('¿Estás seguro de eliminar a este empleado? Se perderán sus datos biométricos.')) {
      try {
        await deleteDoc(doc(db, 'employees', id));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, 'employees');
      }
    }
  };

  const filteredEmployees = employees.filter(emp => {
    const matchesSearch = emp.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesDept = deptFilter === 'All' || emp.department === deptFilter;
    return matchesSearch && matchesDept;
  });

  return (
    <motion.div 
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="p-6 md:p-10 flex flex-col min-h-screen max-w-6xl mx-auto w-full"
    >
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-10">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-3 bg-white border border-slate-200 rounded-2xl shadow-sm hover:bg-slate-50 transition-all active:scale-95">
            <ChevronLeft className="w-5 h-5 text-indigo-600" />
          </button>
          <div className="flex flex-col">
            <h1 className="text-3xl font-bold tracking-tight text-slate-800">Gestión de Empleados</h1>
            <p className="text-slate-400 font-bold uppercase tracking-widest text-[10px] mt-1">Personal registrado en la base biométrica</p>
          </div>
        </div>
      </header>

      <div className="bento-card overflow-hidden mb-12">
        <div className="p-8 border-b border-slate-50 flex flex-wrap gap-6 items-center bg-slate-50/30">
          <div className="relative flex-1 min-w-[300px]">
            <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-300 w-5 h-5" />
            <input 
              type="text" 
              placeholder="Buscar por nombre..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-14 pr-6 py-4 rounded-2xl bg-white border border-slate-200 outline-none focus:ring-2 focus:ring-indigo-500 transition-all font-medium text-sm"
            />
          </div>
          
          <div className="flex items-center gap-4">
            <select 
              value={deptFilter}
              onChange={(e) => setDeptFilter(e.target.value)}
              className="bg-white border border-slate-200 px-6 py-4 rounded-2xl outline-none focus:ring-2 focus:ring-indigo-500 text-xs font-bold text-slate-600 cursor-pointer shadow-sm uppercase tracking-widest"
            >
              {departments.map(dept => (
                <option key={dept} value={dept}>{dept === 'All' ? 'Todos los Deptos.' : dept}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50/50 text-slate-400 font-bold border-b border-slate-100">
              <tr>
                <th className="px-8 py-6 uppercase tracking-widest text-[10px]">Empleado</th>
                <th className="px-8 py-6 uppercase tracking-widest text-[10px]">Departamento</th>
                <th className="px-8 py-6 uppercase tracking-widest text-[10px]">Horario (E/S)</th>
                <th className="px-8 py-6 uppercase tracking-widest text-[10px]">Estado Biométrico</th>
                <th className="px-8 py-6 uppercase tracking-widest text-[10px] text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filteredEmployees.length > 0 ? filteredEmployees.map((emp) => (
                <tr key={emp.id} className="hover:bg-slate-50/50 transition-colors group">
                  <td className="px-8 py-5">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 font-bold text-xs uppercase">
                        {emp.name ? emp.name.charAt(0) : '?'}
                      </div>
                      <span className="font-bold text-slate-800 group-hover:text-indigo-600 transition-colors">{emp.name}</span>
                    </div>
                  </td>
                  <td className="px-8 py-5 text-slate-400 font-bold text-xs">{emp.department}</td>
                  <td className="px-8 py-5 text-slate-500 font-mono font-bold text-xs">
                    {emp.shiftStart || '--:--'} - {emp.shiftEnd || '--:--'}
                  </td>
                  <td className="px-8 py-5">
                    <div className="flex items-center gap-2">
                       {emp.faceDescriptor ? (
                         <>
                           <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                           <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest">Enrolado</span>
                         </>
                       ) : (
                         <>
                           <XCircle className="w-4 h-4 text-rose-500" />
                           <span className="text-[10px] font-bold text-rose-600 uppercase tracking-widest">Pendiente</span>
                         </>
                       )}
                    </div>
                  </td>
                  <td className="px-8 py-5 text-right">
                    <button 
                      onClick={() => emp.id && handleDelete(emp.id)}
                      className="p-2 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-all"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={5} className="px-8 py-24 text-center">
                    <div className="flex flex-col items-center gap-3">
                       <Filter className="w-10 h-10 text-slate-200" />
                       <p className="text-slate-400 font-bold uppercase tracking-widest text-xs">No se encontraron empleados</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </motion.div>
  );
}

function DataTableView({ records, onBack, onDelete, companyId, companyData, onNavigate }: { records: Record[]; onBack: () => void; onDelete: (id: string) => void; companyId: string | null; companyData: any; onNavigate: (v: string) => void; key?: string }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [dateRange, setDateRange] = useState({ start: '', end: '' });

  // AI Assistant States
  const [aiInput, setAiInput] = useState('');
  const [aiMessages, setAiMessages] = useState<{ role: 'user' | 'model'; text: string }[]>([
    { role: 'model', text: '👋 ¡Hola! Soy tu analista de asistencia BioPoint AI. Hazme preguntas sobre puntualidad, registros o tendencias de tus empleados.' }
  ]);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [showPromoLock, setShowPromoLock] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const isPremium = companyData?.plan === 'premium' || companyData?.plan === 'Completo';

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [aiMessages, isAiLoading]);

  const filteredRecords = records.filter(r => {
    const matchesSearch = r.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         r.department.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesDate = (!dateRange.start || r.date >= dateRange.start) && 
                       (!dateRange.end || r.date <= dateRange.end);
    return matchesSearch && matchesDate;
  });

  const handleExport = () => {
    const headers = ['Nombre', 'Departamento', 'Fecha', 'Hora', 'Tipo', 'Puntualidad'];
    const csv = [
      headers.join(','),
      ...filteredRecords.map(r => [r.name, r.department, r.date, r.time, r.type, r.punctuality].join(','))
    ].join('\n');
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Reporte_${format(new Date(), "yyyy-MM")}.csv`;
    a.click();
  };

  const handleDelete = async (id: string) => {
    if (confirm('¿Estás seguro de eliminar este registro?')) {
      try {
        await deleteDoc(doc(db, 'attendance', id));
        onDelete(id);
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, 'attendance');
      }
    }
  };

  const handleAiQuestion = async (questionText: string) => {
    if (isAiLoading) return;
    
    if (!isPremium) {
      // Demo response simulation for non-premium users
      setIsAiLoading(true);
      setAiMessages(prev => [...prev, { role: 'user', text: questionText }]);
      
      setTimeout(() => {
        setIsAiLoading(false);
        const demoResponses: { [key: string]: string } = {
          "¿Quién ha tenido más retrasos esta semana?": `✨ **Demostración de Reportes AI (Plan Completo)**:

Basado en tus registros de asistencia actuales:
- El empleado **Sofía Rodríguez** (Ventas) registra **2 retrasos** esta semana con un promedio de 14 minutos tarde.
- El empleado **Alex Gómez** (Sistemas) registra **1 retraso** el día Lunes.

*Adquiere el **Plan Completo** para realizar consultas libres sobre cualquier fecha y persona.*`,
          "Resume las estadísticas por departamento": `✨ **Demostración de Reportes AI (Plan Completo)**:

Tu reporte resumido de puntualidad por departamentos muestra:
1. **Sistemas**: 98% de puntualidad, sin retrasos o ausencias recurrentes.
2. **Ventas**: 74% de puntualidad, con concentración de llegadas tarde los Lunes por la mañana.
3. **Administración**: 90% de puntualidad.

*Conecta tus registros reales con el poder analítico libre de Gemini.*`,
          "¿Cuáles son los días con mejor asistencia?": `✨ **Demostración de Reportes AI (Plan Completo)**:

El análisis semanal de ausentismo destaca:
- Los **Martes y Jueves** presentan el **100% de cumplimiento** en hora de ingreso.
- Los **Lunes** tienen un pico de retrasos promedio de 12 minutos.

*Usa estos reportes de tendencias para optimizar tus horarios corporativos.*`
        };

        const replyText = demoResponses[questionText] || `✨ **Función Exclusiva del Plan Completo**:

Esta herramienta te permite hacer cualquier consulta en lenguaje natural sobre la asistencia de tu equipo, entregándote análisis predictivo y resúmenes estructurados al instante.

¡Actualiza hoy tu suscripción para desbloquear el poder de Gemini analizando tus recursos humanos!`;

        setAiMessages(prev => [...prev, { role: 'model', text: replyText }]);
      }, 1500);
      return;
    }

    // Active Premium AI Query!
    setIsAiLoading(true);
    setAiMessages(prev => [...prev, { role: 'user', text: questionText }]);

    try {
      const response = await fetch('/api/gemini/report-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          userId: auth.currentUser?.uid,
          message: questionText,
          history: aiMessages.slice(-6).map(m => ({ role: m.role, text: m.text }))
        })
      });

      const data = await response.json();
      if (data.text) {
        setAiMessages(prev => [...prev, { role: 'model', text: data.text }]);
      } else {
        setAiMessages(prev => [...prev, { role: 'model', text: `⚠️ Error del Analista AI: ${data.error || "No se pudo obtener respuesta."}` }]);
      }
    } catch (err: any) {
      setAiMessages(prev => [...prev, { role: 'model', text: '⚠️ Error de conexión al consultar el analista AI.' }]);
    } finally {
      setIsAiLoading(false);
    }
  };

  const handleAiSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiInput.trim() || isAiLoading) return;
    
    if (!isPremium) {
      setShowPromoLock(true);
      return;
    }

    const question = aiInput;
    setAiInput('');
    handleAiQuestion(question);
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-6 md:p-10 max-w-7xl mx-auto w-full"
    >
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-12">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-3 bg-white border border-slate-200 rounded-2xl shadow-sm hover:bg-slate-50 transition-all">
            <ChevronLeft className="w-5 h-5 text-indigo-600" />
          </button>
          <div>
            <h2 className="text-3xl font-bold text-slate-800 tracking-tight">Reportes de Asistencia</h2>
            <p className="text-slate-400 font-bold uppercase tracking-widest text-[10px] mt-1">Registros Históricos & Analista AI</p>
          </div>
        </div>

        <button 
          onClick={handleExport}
          className="flex items-center justify-center gap-2 px-8 py-4 bg-slate-800 text-white rounded-2xl font-bold text-xs uppercase tracking-widest shadow-xl shadow-slate-200 hover:bg-slate-700 transition-all active:scale-95"
        >
          <Download className="w-4 h-4" /> Exportar a Excel
        </button>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Tabla tradicional */}
        <div className="lg:col-span-8 flex flex-col">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="md:col-span-1 border border-slate-100 bg-white p-2 rounded-2xl shadow-sm flex items-center px-4">
              <Search className="w-4 h-4 text-slate-300 mr-2 shrink-0" />
              <input 
                type="text" 
                placeholder="Buscar por nombre o depto..." 
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full py-2 text-sm font-medium outline-none bg-transparent"
              />
            </div>
            <div className="md:col-span-2 grid grid-cols-2 gap-2">
              <input 
                type="date" 
                value={dateRange.start}
                onChange={e => setDateRange({...dateRange, start: e.target.value})}
                className="w-full px-4 py-2 rounded-xl bg-white border border-slate-100 font-bold text-[11px] text-slate-500 uppercase tracking-widest outline-none"
              />
              <input 
                type="date" 
                value={dateRange.end}
                onChange={e => setDateRange({...dateRange, end: e.target.value})}
                className="w-full px-4 py-2 rounded-xl bg-white border border-slate-100 font-bold text-[11px] text-slate-500 uppercase tracking-widest outline-none"
              />
            </div>
          </div>

          <div className="bg-white rounded-[2rem] shadow-xl shadow-slate-200/40 border border-slate-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-slate-50/50 text-slate-400 font-bold border-b border-slate-100">
                  <tr>
                    <th className="px-6 py-4 uppercase tracking-widest text-[9px]">Empleado</th>
                    <th className="px-6 py-4 uppercase tracking-widest text-[9px]">Dep.</th>
                    <th className="px-6 py-4 uppercase tracking-widest text-[9px]">Fecha</th>
                    <th className="px-6 py-4 uppercase tracking-widest text-[9px]">Hora</th>
                    <th className="px-6 py-4 uppercase tracking-widest text-[9px]">Tipo</th>
                    <th className="px-6 py-4 uppercase tracking-widest text-[9px]">Puntualidad</th>
                    <th className="px-6 py-4 uppercase tracking-widest text-[9px] text-right">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {filteredRecords.length > 0 ? filteredRecords.map((record) => (
                    <tr key={record.id} className="hover:bg-slate-50/50 transition-colors group">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600 font-bold text-xs uppercase shrink-0">
                            {record.name.charAt(0)}
                          </div>
                          <span className="font-bold text-slate-800 group-hover:text-indigo-600 transition-colors text-xs">{record.name}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-slate-400 font-bold text-[10px]">{record.department}</td>
                      <td className="px-6 py-4 text-slate-500 font-medium text-xs">
                        {record.date}
                      </td>
                      <td className="px-6 py-4 font-mono text-slate-600 font-bold text-[11px]">{record.time}</td>
                      <td className="px-6 py-4">
                        <span className={cn(
                          "px-2 py-1 rounded-md text-[9px] font-bold uppercase tracking-widest inline-block",
                          record.type === 'Entrada' ? "text-emerald-600 bg-emerald-50" : "text-orange-600 bg-orange-50"
                        )}>
                          {record.type}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <span className={cn(
                            "text-[9px] font-bold uppercase tracking-widest px-2 py-1 rounded-md",
                            record.punctuality === 'Retraso' || record.punctuality === 'Temprano' ? "bg-rose-50 text-rose-600" : "bg-emerald-50 text-emerald-600"
                          )}>
                            {record.punctuality || 'Normal'}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button 
                          onClick={() => record.id && handleDelete(record.id)}
                          className="p-1.5 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={7} className="px-6 py-16 text-center">
                        <div className="flex flex-col items-center gap-2">
                           <Filter className="w-8 h-8 text-slate-200" />
                           <p className="text-slate-400 font-bold uppercase tracking-widest text-[10px]">Sin asistencias encontradas</p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Panel AI (Análisis inteligente) */}
        <div className="lg:col-span-4 flex flex-col">
          <div className="bg-gradient-to-br from-indigo-950 to-slate-900 rounded-[2.5rem] p-6 text-white shadow-xl flex flex-col h-[520px] relative overflow-hidden">
            <div className="flex items-center justify-between mb-4 pb-4 border-b border-white/10 shrink-0">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-indigo-500/20 rounded-xl">
                  <Sparkles className="w-5 h-5 text-indigo-400" />
                </div>
                <div>
                  <h3 className="font-bold text-sm tracking-tight text-white">Analista de Reportes AI</h3>
                  <p className="text-[9px] font-bold text-indigo-300 uppercase tracking-wider">Desarrollado con Gemini</p>
                </div>
              </div>
              <span className={cn(
                "px-2.5 py-1 rounded-full text-[8px] font-black uppercase tracking-widest",
                isPremium ? "bg-indigo-500 text-white" : "bg-amber-500 text-slate-950"
              )}>
                {isPremium ? 'Premium' : 'Demo'}
              </span>
            </div>

            {/* Chat Body */}
            <div className="flex-1 overflow-y-auto mb-4 space-y-3 pr-1 text-xs">
              {aiMessages.map((msg, idx) => (
                <div key={idx} className={cn(
                  "p-3 rounded-2xl max-w-[85%] leading-relaxed",
                  msg.role === 'user' 
                    ? "bg-indigo-600/50 text-white ml-auto rounded-tr-none border border-indigo-500/25" 
                    : "bg-white/5 text-slate-200 mr-auto rounded-tl-none border border-white/5 whitespace-pre-wrap font-medium"
                )}>
                  {msg.text}
                </div>
              ))}
              {isAiLoading && (
                <div className="flex items-center gap-2 text-indigo-300 font-semibold p-2 animate-pulse text-[10px]">
                  <Loader2 className="w-4 h-4 animate-spin text-indigo-400 shrink-0" />
                  <span>Gemini está analizando los registros actuales...</span>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Quick Suggestions */}
            {aiMessages.length <= 1 && (
              <div className="mb-4 space-y-1.5 shrink-0">
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1 px-1">Consultas rápidas:</p>
                <div className="flex flex-col gap-1.5">
                  <button 
                    disabled={isAiLoading}
                    onClick={() => handleAiQuestion("¿Quién ha tenido más retrasos esta semana?")}
                    className="px-3 py-2 bg-white/5 hover:bg-white/10 rounded-xl text-[10px] font-bold text-slate-300 border border-white/5 transition-all text-left"
                  >
                    🔍 Registrar retrasos de la semana
                  </button>
                  <button 
                    disabled={isAiLoading}
                    onClick={() => handleAiQuestion("Resume las estadísticas por departamento")}
                    className="px-3 py-2 bg-white/5 hover:bg-white/10 rounded-xl text-[10px] font-bold text-slate-300 border border-white/5 transition-all text-left"
                  >
                    📊 Reporte de puntualidad por depto.
                  </button>
                  <button 
                    disabled={isAiLoading}
                    onClick={() => handleAiQuestion("¿Cuáles son los días con mejor asistencia?")}
                    className="px-3 py-2 bg-white/5 hover:bg-white/10 rounded-xl text-[10px] font-bold text-slate-300 border border-white/5 transition-all text-left"
                  >
                    📈 Tendencias clave de asistencia
                  </button>
                </div>
              </div>
            )}

            {/* Input & Form */}
            <form onSubmit={handleAiSubmit} className="flex gap-2 items-center pt-2 border-t border-white/5 shrink-0">
              <input 
                type="text"
                disabled={isAiLoading}
                placeholder={isPremium ? "Pregunta al Analista AI..." : "Disponible en Plan Completo..."}
                value={aiInput}
                onChange={e => setAiInput(e.target.value)}
                className="flex-1 bg-white/5 text-xs text-white placeholder-slate-500 rounded-xl px-4 py-3 outline-none border border-white/5 focus:border-indigo-500 transition-all font-medium"
              />
              <button 
                type="submit"
                disabled={isAiLoading || !aiInput.trim()}
                className="p-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:hover:bg-indigo-600 text-white rounded-xl transition-all shadow-lg"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>

            {/* Demo Non-Premium Lock overlay */}
            {showPromoLock && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="absolute inset-0 bg-slate-950/95 backdrop-blur-sm p-6 flex flex-col justify-center items-center text-center z-10"
              >
                <div className="w-14 h-14 rounded-full bg-amber-500/20 flex items-center justify-center mb-4 text-amber-400 animate-bounce">
                  <ShieldCheck className="w-8 h-8" />
                </div>
                <h4 className="font-bold text-lg text-white mb-2">Asistente AI Premium</h4>
                <p className="text-slate-300 text-xs px-2 mb-6 leading-relaxed">
                  El <strong>Asistente AI</strong> con consultas personalizadas en lenguaje natural está disponible únicamente para clientes del <strong>Plan Completo (Premium)</strong>. 
                </p>
                <div className="flex gap-3 w-full">
                  <button 
                    onClick={() => setShowPromoLock(false)}
                    className="flex-1 py-3 bg-white/10 hover:bg-white/15 rounded-xl font-bold text-[10px] uppercase tracking-widest text-slate-300 transition-all"
                  >
                    Volver
                  </button>
                  <button 
                    onClick={() => onNavigate('pricing')}
                    className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-500 rounded-xl font-bold text-[10px] uppercase tracking-widest text-white transition-all shadow-lg"
                  >
                    Actualizar
                  </button>
                </div>
              </motion.div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function ApiIntegrationView({ companyId, companyData, userId, onBack, onNavigate }: { companyId: string | null; companyData: any; userId: string; onBack: () => void; onNavigate: (v: string) => void; key?: string }) {
  const [apiKey, setApiKey] = useState<string>(companyData?.apiKey || '');
  const [copied, setCopied] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedTab, setSelectedTab] = useState<'curl' | 'js' | 'python'>('curl');

  const isPremium = companyData?.plan === 'premium' || companyData?.plan === 'Completo';

  const handleGenerateKey = async () => {
    if (!companyId || !userId) return;
    setIsGenerating(true);
    try {
      const response = await fetch('/api/generate-api-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, userId }),
      });
      const data = await response.json();
      if (data.apiKey) {
        setApiKey(data.apiKey);
        if (companyData) companyData.apiKey = data.apiKey;
      } else {
        alert(data.error || "Error al generar la llave API");
      }
    } catch (err: any) {
      alert("Error de conexión al generar la clave");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopy = () => {
    if (!apiKey) return;
    navigator.clipboard.writeText(apiKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const codeSnippets = {
    curl: `# 1. Obtener empleados activos en la nómina
curl -X GET "${window.location.origin}/api/v1/employees" \\
  -H "x-api-key: ${apiKey || 'TU_API_KEY'}"

# 2. Registrar check-in / asistencia remota
curl -X POST "${window.location.origin}/api/v1/attendance" \\
  -H "x-api-key: ${apiKey || 'TU_API_KEY'}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "Alex Gómez",
    "department": "Producción",
    "type": "Entrada",
    "punctuality": "A tiempo"
  }'`,

    js: `// Un ejemplo de integración en NodeJS
const axios = require('axios');

async function registrarAsistencia() {
  const url = '${window.location.origin}/api/v1/attendance';
  const headers = {
    'x-api-key': '${apiKey || 'TU_API_KEY'}',
    'Content-Type': 'application/json'
  };
  const body = {
    name: 'Alex Gómez',
    department: 'Producción',
    type: 'Entrada',
    punctuality: 'A tiempo'
  };

  try {
    const res = await axios.post(url, body, { headers });
    console.log('Registro exitoso:', res.data);
  } catch (err) {
    console.error('Error:', err.response?.data || err.message);
  }
}

registrarAsistencia();`,

    python: `# Un ejemplo de integración en Python
import requests

url = "${window.location.origin}/api/v1/attendance"
headers = {
    "x-api-key": "${apiKey || 'TU_API_KEY'}",
    "Content-Type": "application/json"
}
payload = {
    "name": "Alex Gómez",
    "department": "Producción",
    "type": "Entrada",
    "punctuality": "A tiempo"
}

try:
    response = requests.post(url, json=payload, headers=headers)
    print("Respuesta API:", response.json())
except Exception as e:
    print("Error de conexión:", e)`
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="min-h-screen bg-slate-50 p-6 md:p-10"
    >
      <div className="max-w-4xl mx-auto">
        <header className="flex items-center gap-4 mb-12">
          <button onClick={onBack} className="p-3 bg-white border border-slate-200 rounded-2xl shadow-sm hover:bg-slate-50 transition-all">
            <ChevronLeft className="w-5 h-5 text-indigo-600" />
          </button>
          <div>
            <h1 className="text-3xl font-bold text-slate-800">Conectores de API</h1>
            <p className="text-indigo-600 font-bold uppercase tracking-widest text-[10px] mt-1 font-sans">Herramientas para Desarrolladores & ERP</p>
          </div>
        </header>

        {!isPremium ? (
          <div className="bg-white rounded-[3.5rem] p-10 md:p-16 shadow-xl border border-slate-100 text-center max-w-2xl mx-auto">
            <div className="w-16 h-16 bg-amber-50 rounded-2xl flex items-center justify-center text-amber-500 mb-6 mx-auto">
              <ShieldCheck className="w-8 h-8 font-bold" />
            </div>
            <h3 className="text-2xl font-black text-slate-800 mb-2">Conectividad API (Premium)</h3>
            <p className="text-slate-500 font-semibold text-sm leading-relaxed mb-8">
              La API REST de BioPoint te permite sincronizar y reportar entradas/salidas desde tótems de hardware externos, ERPs (SAP, Dynamics, Odoo) o sistemas de liquidación de sueldos utilizando una firma de clave única segura.
            </p>

            <div className="bg-slate-50 rounded-[2rem] p-6 text-left max-w-md mx-auto mb-10 space-y-3 border border-slate-100">
              <div className="flex gap-3">
                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                <span className="text-slate-600 text-xs font-bold leading-tight">Acceso programático a listados de empleados</span>
              </div>
              <div className="flex gap-3">
                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                <span className="text-slate-600 text-xs font-bold leading-tight">Registro de asistencia en tiempo real desde tótems de terceros</span>
              </div>
              <div className="flex gap-3">
                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                <span className="text-slate-600 text-xs font-bold leading-tight">Consulta histórica automatizada para automatización de nóminas</span>
              </div>
            </div>

            <button 
              onClick={() => onNavigate('pricing')}
              className="px-8 py-4 bg-indigo-600 text-white rounded-2xl font-bold text-xs uppercase tracking-widest hover:scale-[1.02] active:scale-95 transition-all shadow-xl shadow-indigo-100"
            >
              Adquirir el Plan Completo (Premium)
            </button>
          </div>
        ) : (
          <div className="space-y-8">
            <div className="bg-white rounded-[2.5rem] p-8 md:p-10 shadow-xl border border-slate-100">
              <h3 className="text-2xl font-bold text-slate-800 mb-2 flex items-center gap-2">
                <Key className="w-6 h-6 text-indigo-600" /> Clave de Acceso API Activa
              </h3>
              <p className="text-slate-400 font-medium text-sm leading-relaxed mb-6">
                Utiliza esta clave única en la cabecera HTTP **`x-api-key`** para firmar tus peticiones de integración. **Nunca compartas tu llave API en repositorios públicos**.
              </p>

              <div className="flex flex-col sm:flex-row gap-4 items-stretch mb-6">
                <div className="flex-grow bg-slate-50 rounded-2xl border border-slate-100 px-6 py-4 flex items-center justify-between font-mono text-[11px] select-all text-slate-700 font-bold overflow-x-auto">
                  {apiKey ? apiKey : 'No se ha generado ninguna clave API activa.'}
                </div>
                <div className="flex gap-2">
                  {apiKey && (
                    <button 
                      onClick={handleCopy}
                      className="p-4 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-2xl transition-all"
                      title="Copiar llave"
                    >
                      {copied ? <Check className="w-5 h-5 text-emerald-600 font-bold" /> : <Copy className="w-5 h-5" />}
                    </button>
                  )}
                  <button 
                    onClick={handleGenerateKey}
                    disabled={isGenerating}
                    className="px-6 py-4 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-400 text-white font-black text-xs uppercase tracking-widest rounded-2xl transition-all shadow-lg flex items-center gap-2"
                  >
                    {isGenerating ? 'Generando...' : (apiKey ? 'Rotar Clave' : 'Generar Clave')}
                  </button>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-[2.5rem] p-8 md:p-10 shadow-xl border border-slate-100">
              <h3 className="text-xl font-bold text-slate-800 mb-2 flex items-center gap-2">
                <Code className="w-5 h-5 text-indigo-600" /> Guía Rápida de Implementación
              </h3>
              <p className="text-slate-400 font-medium text-xs mb-6">
                Todas las llamadas HTTP requieren la cabecera **`x-api-key`**.
              </p>

              {/* Tabs */}
              <div className="flex border-b border-slate-100 mb-6 gap-6">
                {(['curl', 'js', 'python'] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setSelectedTab(tab)}
                    className={cn(
                      "pb-4 text-xs font-bold uppercase tracking-widest border-b-2 transition-all",
                      selectedTab === tab ? "border-indigo-600 text-indigo-600" : "border-transparent text-slate-400 hover:text-slate-600"
                    )}
                  >
                    {tab === 'curl' ? 'cURL' : tab === 'js' ? 'NodeJS' : 'Python'}
                  </button>
                ))}
              </div>

              {/* Snippet Viewer */}
              <div className="bg-slate-900 rounded-2xl p-6 text-white text-[11px] font-mono whitespace-pre-wrap overflow-x-auto shadow-inner leading-relaxed">
                {codeSnippets[selectedTab]}
              </div>
            </div>

            <div className="bg-slate-800 text-white rounded-[2.5rem] p-8 md:p-10 shadow-xl">
              <h3 className="text-lg font-bold mb-2">
                📚 Especificación técnica de Endpoints
              </h3>
              <div className="divide-y divide-white/10 mt-6 space-y-4">
                <div className="pt-4 first:pt-0">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="px-2 py-1 rounded bg-green-500/20 text-green-400 font-bold text-[9px] uppercase tracking-wider">GET</span>
                    <strong className="text-xs font-mono">/api/v1/employees</strong>
                  </div>
                  <p className="text-[11px] text-slate-300">Obtiene la nómina de empleados activos de tu empresa. Devuelve un objeto JSON con ID, Nombre, Departamento y si tiene firma facial biométrica registrada.</p>
                </div>

                <div className="pt-4">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="px-2 py-1 rounded bg-green-500/20 text-green-400 font-bold text-[9px] uppercase tracking-wider">GET</span>
                    <strong className="text-xs font-mono">/api/v1/attendance</strong>
                  </div>
                  <p className="text-[11px] text-slate-300">Consulta todos los reportes históricos de asistencia de tu empresa, ordenados cronológicamente.</p>
                </div>

                <div className="pt-4">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="px-2 py-1 rounded bg-indigo-500/20 text-indigo-400 font-bold text-[9px] uppercase tracking-wider">POST</span>
                    <strong className="text-xs font-mono">/api/v1/attendance</strong>
                  </div>
                  <p className="text-[11px] text-slate-300">Sincroniza un check-in o check-out desde un hardware externo o software de terceros enviando el nombre, departamento opcional, tipo ("Entrada" o "Salida") y puntualidad.</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}

function TutorialView({ onBack }: { onBack: () => void; key?: string }) {
  const tutorials = [
    {
      title: "Configuración Inicial",
      description: "Aprende cómo vincular tus dispositivos y configurar tu empresa.",
      steps: [
        "Inicia sesión con tu cuenta de Google.",
        "Ve al panel de control y haz clic en el icono de vinculación (refrescar).",
        "El dispositivo actual quedará vinculado como terminal de asistencia.",
        "Usa el botón 'Regresar al Modo Kiosco' para activar la cámara."
      ]
    },
    {
      title: "Registro de Empleados",
      description: "Cómo dar de alta al personal usando biometría facial.",
      steps: [
        "Ingresa a 'Registrar Empleado' desde el Dashboard.",
        "Captura los datos (Nombre, Depto, Horario).",
        "Pide al empleado que mire a la cámara y presiona 'Capturar Rostro'.",
        "Si el indicador es verde, presiona 'Guardar' para finalizar."
      ]
    },
    {
      title: "Reportes y Exportación",
      description: "Gestiona la nube de datos y exporta a Excel.",
      steps: [
        "Ve a 'Ingresar a Información'.",
        "Usa el buscador o filtros de fecha para localizar registros.",
        "Haz clic en 'Exportar a Excel' para descargar el reporte mensual."
      ]
    }
  ];

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="min-h-screen bg-slate-50 p-6 md:p-10"
    >
      <div className="max-w-4xl mx-auto">
        <header className="flex items-center gap-4 mb-12">
          <button onClick={onBack} className="p-3 bg-white border border-slate-200 rounded-2xl shadow-sm hover:bg-slate-50 transition-all">
            <ChevronLeft className="w-5 h-5 text-indigo-600" />
          </button>
          <div>
            <h1 className="text-3xl font-bold text-slate-800">Centro de Tutoriales</h1>
            <p className="text-indigo-600 font-bold uppercase tracking-widest text-[10px] mt-1">Guía paso a paso</p>
          </div>
        </header>

        <div className="space-y-8">
          {tutorials.map((t, i) => (
            <motion.div 
              key={i}
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: i * 0.1 }}
              className="bg-white rounded-[2.5rem] p-8 md:p-12 shadow-xl shadow-slate-200/30 border border-slate-100"
            >
              <div className="flex items-start gap-6 mb-8">
                <div className="w-16 h-16 bg-indigo-50 rounded-[1.5rem] flex items-center justify-center text-indigo-600 shrink-0">
                   <PlayCircle className="w-8 h-8" />
                </div>
                <div>
                   <h3 className="text-2xl font-bold text-slate-800 mb-2">{t.title}</h3>
                   <p className="text-slate-400 font-medium">{t.description}</p>
                </div>
              </div>

              <div className="space-y-4">
                {t.steps.map((s, si) => (
                  <div key={si} className="flex gap-4 items-start">
                    <div className="w-6 h-6 rounded-full bg-slate-800 text-white text-[10px] font-bold flex items-center justify-center shrink-0 mt-1">
                      {si + 1}
                    </div>
                    <p className="text-slate-600 font-medium leading-relaxed">{s}</p>
                  </div>
                ))}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

function PricingView({ companyData, companyId, onBack }: { companyData: any; companyId: string | null; onBack: () => void; key?: string }) {
  const [isProcessing, setIsProcessing] = useState(false);
  const plans = [
    {
      id: 'basic',
      name: 'Básico',
      price: '59',
      color: 'bg-indigo-600',
      features: ['Registro de hasta 50 empleados', 'Sincronización en la nube', 'Tutoriales paso a paso', 'Soporte vía email'],
      icon: <Zap className="w-5 h-5" />
    },
    {
      id: 'standard',
      name: 'Estándar',
      price: '99',
      color: 'bg-slate-800',
      popular: true,
      features: ['Registro ilimitado de empleados', 'Exportación a Excel', 'Múltiples kioscos', 'Soporte prioritario 24/7'],
      icon: <Crown className="w-5 h-5" />
    },
    {
      id: 'premium',
      name: 'Completo',
      price: '119',
      color: 'bg-indigo-900',
      features: ['Todo lo de Estándar', 'API para integraciones', 'Reportes personalizados AI', 'Gerente de cuenta dedicado'],
      icon: <ShieldCheck className="w-5 h-5" />
    }
  ];

  const handleUpdatePlan = async (planId: string) => {
    if (!auth.currentUser || !companyId) return;
    setIsProcessing(true);
    try {
      const response = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          planId, 
          companyId,
          successUrl: window.location.origin + '?status=success&view=dashboard',
          cancelUrl: window.location.origin + '?status=cancelled&view=pricing'
        }),
      });
      
      const { url, error } = await response.json();
      if (url) {
        window.location.href = url;
      } else {
        alert(error || "Error al iniciar sesión de pago");
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="min-h-screen bg-slate-50 p-6 md:p-10"
    >
      <div className="max-w-6xl mx-auto">
        <header className="flex items-center gap-4 mb-12">
          <button onClick={onBack} className="p-3 bg-white border border-slate-200 rounded-2xl shadow-sm hover:bg-slate-50 transition-all">
            <ChevronLeft className="w-5 h-5 text-indigo-600" />
          </button>
          <div>
            <h1 className="text-3xl font-bold text-slate-800">Planes y Suscripción</h1>
            <p className="text-indigo-600 font-bold uppercase tracking-widest text-[10px] mt-1">Sube de nivel tu gestión</p>
          </div>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {plans.map((p, i) => (
            <motion.div 
              key={p.id}
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: i * 0.1 }}
              className={cn(
                "bg-white rounded-[3rem] p-10 flex flex-col items-center text-center relative",
                p.popular ? "shadow-2xl shadow-indigo-200 border-2 border-indigo-100 ring-8 ring-indigo-50/50" : "shadow-xl border border-slate-100"
              )}
            >
              {p.popular && (
                <div className="absolute -top-4 bg-indigo-600 text-white px-6 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest shadow-xl">
                   Más popular
                </div>
              )}
              
              <div className={cn("w-16 h-16 rounded-[1.5rem] flex items-center justify-center text-white mb-6", p.color)}>
                {p.icon}
              </div>

              <h3 className="text-2xl font-bold text-slate-800 mb-1">{p.name}</h3>
              <div className="flex items-baseline gap-1 mb-8">
                <span className="text-sm font-bold text-slate-400">$</span>
                <span className="text-5xl font-black text-slate-800">{p.price}</span>
                <span className="text-sm font-bold text-slate-400">/mes</span>
              </div>

              <div className="w-full space-y-4 mb-10 text-left">
                {p.features.map((f, fi) => (
                  <div key={fi} className="flex gap-3 items-center">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                    <span className="text-slate-500 text-xs font-bold leading-tight">{f}</span>
                  </div>
                ))}
              </div>

              <button 
                onClick={() => handleUpdatePlan(p.id)}
                disabled={isProcessing}
                className={cn(
                  "w-full py-4 rounded-2xl font-bold text-xs uppercase tracking-widest transition-all hover:scale-[1.02] active:scale-95 shadow-xl",
                  companyData?.plan === p.id 
                    ? "bg-slate-100 text-slate-400 cursor-default" 
                    : p.color + " text-white shadow-indigo-100",
                  isProcessing && "opacity-50 cursor-not-allowed"
                )}
              >
                {isProcessing ? 'Procesando...' : (companyData?.plan === p.id ? 'Plan Actual' : 'Suscribirse Ahora')}
              </button>
            </motion.div>
          ))}
        </div>

        <div className="mt-16 bg-slate-900 rounded-[3rem] p-12 text-center relative overflow-hidden">
           <div className="relative z-10">
              <h3 className="text-white text-3xl font-bold mb-4 italic">¿Necesitas una solución personalizada?</h3>
              <p className="text-indigo-200 font-medium mb-8 max-w-lg mx-auto">Si tu empresa tiene necesidades específicas o más de 1000 empleados, contacta a nuestro equipo de ventas.</p>
              <button className="px-8 py-4 bg-indigo-600 text-white rounded-2xl font-bold text-xs uppercase tracking-widest hover:bg-indigo-500 transition-all">
                Contactar Ventas
              </button>
           </div>
           <Zap className="absolute -right-10 -bottom-10 w-64 h-64 text-white/5 -rotate-12" />
        </div>
      </div>
    </motion.div>
  );
}
