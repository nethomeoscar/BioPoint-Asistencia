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
  UserPlus
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import * as XLSX from 'xlsx';
import { format, isWithinInterval, parseISO, startOfDay, endOfDay } from 'date-fns';
import { cn } from './lib/utils';

// Firebase Imports
import { initializeApp } from 'firebase/app';
import { 
  getFirestore, 
  collection, 
  addDoc, 
  deleteDoc,
  getDocs, 
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
  signOut 
} from 'firebase/auth';
import firebaseConfig from '../firebase-applet-config.json';

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
  type: 'Entrada' | 'Salida';
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
  const [view, setView] = useState<'kiosk' | 'login' | 'dashboard' | 'camera' | 'data' | 'register' | 'employees'>('kiosk');
  const [user, setUser] = useState<any>(null);
  const [companyId, setCompanyId] = useState<string | null>(localStorage.getItem('biopoint_companyId'));
  const [records, setRecords] = useState<Record[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [isModelsLoaded, setIsModelsLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

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
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      if (u) {
        setUser(u);
        const derivedCompanyId = `comp_${u.uid}`;
        setCompanyId(derivedCompanyId);
        // If we are in login view, go to dashboard
        if (view === 'login') setView('dashboard');
      } else {
        setUser(null);
        // If we are not in kiosk mode, go to login
        if (view !== 'kiosk') setView('login');
      }
    });
    return unsubscribe;
  }, [view]);

  // Sync Records based on companyId
  useEffect(() => {
    if (!companyId) return;

    const qRecords = query(
      collection(db, 'attendance'), 
      where('companyId', '==', companyId),
      orderBy('timestamp', 'desc')
    );
    const unsubRecords = onSnapshot(qRecords, (snap) => {
      setRecords(snap.docs.map(d => ({ id: d.id, ...d.data() } as Record)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'attendance'));

    const qEmployees = query(
      collection(db, 'employees'),
      where('companyId', '==', companyId)
    );
    const unsubEmployees = onSnapshot(qEmployees, (snap) => {
      setEmployees(snap.docs.map(d => ({ id: d.id, ...d.data() } as Employee)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'employees'));

    return () => {
      unsubRecords();
      unsubEmployees();
    };
  }, [companyId]);

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
    setCompanyId(localStorage.getItem('biopoint_companyId')); // Fallback to kiosk company if exists
    setView('kiosk');
  };

  const pairDevice = () => {
    if (companyId) {
      localStorage.setItem('biopoint_companyId', companyId);
      alert("Dispositivo vinculado exitosamente a esta empresa.");
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <AnimatePresence mode="wait">
        {view === 'kiosk' && (
          <CameraView 
            key="kiosk"
            employees={employees}
            records={records}
            companyId={companyId}
            onBack={() => setView('login')}
            isKiosk
          />
        )}

        {view === 'login' && (
          <LoginView 
            key="login"
            onLogin={handleGoogleLogin} 
            isLoading={isLoading}
            onCancel={() => setView('kiosk')}
          />
        )}

        {view === 'dashboard' && (
          <DashboardView 
            key="dashboard"
            user={user} 
            onNavigate={setView} 
            onLogout={handleLogout}
            onPair={pairDevice}
            isModelsLoaded={isModelsLoaded}
          />
        )}

        {view === 'camera' && (
          <CameraView 
            key="camera"
            employees={employees}
            records={records}
            companyId={companyId}
            onBack={() => setView('dashboard')} 
          />
        )}

        {view === 'register' && (
          <RegisterView 
            key="register"
            companyId={companyId}
            onBack={() => setView('dashboard')}
            onSuccess={() => setView('dashboard')}
          />
        )}

        {view === 'data' && (
          <DataTableView 
            key="data"
            records={records}
            onBack={() => setView('dashboard')}
          />
        )}

        {view === 'employees' && (
          <EmployeesListView 
            key="employees"
            employees={employees}
            onBack={() => setView('dashboard')}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// --- Views ---

function LoginView({ onLogin, isLoading, onCancel }: any) {
  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="flex flex-col items-center justify-center p-4 min-h-screen bg-slate-50"
    >
      <button 
        onClick={onCancel}
        className="mb-8 flex items-center gap-2 text-slate-400 hover:text-indigo-600 font-bold text-[10px] uppercase tracking-widest transition-all"
      >
        <ChevronLeft className="w-4 h-4" /> Regresar al Modo Kiosco
      </button>

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

function DashboardView({ user, onNavigate, onLogout, onPair, isModelsLoaded }: any) {
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
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden md:block text-right mr-2">
             <p className="text-sm font-bold text-slate-800 leading-none">{user?.displayName || 'Admin'}</p>
             <p className="text-[10px] font-bold text-indigo-600 uppercase tracking-widest mt-1 tracking-tighter">ACCESO ADMINISTRATIVO</p>
          </div>
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
            className="bg-white"
            iconClass="bg-indigo-600"
          />
        </div>

        <div className="md:col-span-4">
          <div className="indigo-card h-full p-8 flex flex-col">
            <h3 className="text-white/70 text-xs font-bold uppercase tracking-wider mb-2">Estado del Sistema</h3>
            <div className="flex items-end gap-2 mb-6">
              <span className="text-4xl font-bold">Cloud</span>
              <span className="text-indigo-200 text-sm font-bold mb-1 uppercase tracking-widest">Active</span>
            </div>
            <div className="mt-auto space-y-3">
              <div className="bg-white/10 backdrop-blur-md rounded-2xl p-4 border border-white/10 flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                <span className="text-xs font-bold uppercase tracking-widest">Biometría OK</span>
              </div>
              <div className="bg-white/10 backdrop-blur-md rounded-2xl p-4 border border-white/10 flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                <span className="text-xs font-bold uppercase tracking-widest">Sync Firebase</span>
              </div>
            </div>
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

function CameraView({ onBack, employees, records, companyId, isKiosk }: { onBack: () => void; employees: Employee[]; records: Record[]; companyId: string | null; isKiosk?: boolean; key?: string }) {
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
    if (!videoRef.current || status !== 'scanning') return;

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
        handleFirestoreError(err, OperationType.CREATE, 'attendance');
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
      type: 'Entrada',
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
        <button 
          onClick={onBack}
          className="flex items-center gap-2 px-6 py-3 bg-white border border-slate-200 text-slate-700 font-bold rounded-2xl transition-all shadow-sm hover:shadow-md active:scale-95 text-xs uppercase tracking-widest"
        >
          <ChevronLeft className="w-5 h-5 text-indigo-600" /> {isKiosk ? "Acceso Admin" : "Regresar al Menú"}
        </button>
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
          className="w-full h-full object-cover rounded-[2rem]"
        />
        
        <div className="absolute inset-0 pointer-events-none">
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

function RegisterView({ onBack, onSuccess, companyId }: { onBack: () => void; onSuccess: () => void; companyId: string | null; key?: string }) {
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
      if (!companyId) return;
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
  }, [companyId]);

  const handleCapture = async () => {
    if (!videoRef.current) return;
    setIsCapturing(true);
    try {
      const detection = await faceapi.detectSingleFace(videoRef.current, new faceapi.TinyFaceDetectorOptions())
        .withFaceLandmarks()
        .withFaceDescriptor();
      
      if (detection) {
        setCapturedDescriptor(Array.from(detection.descriptor));
      } else {
        alert("No se detectó rostro. Intenta de nuevo.");
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsCapturing(false);
    }
  };

  const handleSave = async () => {
    if (!name || !dept || !capturedDescriptor || !companyId) return;
    setIsCapturing(true);
    try {
      await addDoc(collection(db, 'employees'), {
        name,
        department: dept,
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
                 <button onClick={handleSave} disabled={isCapturing} className="flex-1 py-4 bg-emerald-600 text-white rounded-2xl font-bold shadow-xl shadow-emerald-100 hover:bg-emerald-700 active:scale-95 transition-all text-xs uppercase tracking-widest">Guardar Empleado</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function EmployeesListView({ employees, onBack }: { employees: Employee[]; onBack: () => void; key?: string }) {
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
                        {emp.name.charAt(0)}
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
                  <td colSpan={3} className="px-8 py-24 text-center">
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

function DataTableView({ records, onBack }: { records: Record[]; onBack: () => void; key?: string }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [typeFilter, setTypeFilter] = useState<'All' | 'Entrada' | 'Salida'>('All');
  const [hideDuplicates, setHideDuplicates] = useState(true);

  const handleDelete = async (id: string) => {
    if (confirm('¿Estás seguro de eliminar este registro?')) {
      try {
        await deleteDoc(doc(db, 'attendance', id));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, 'attendance');
      }
    }
  };

  const processRecords = (data: Record[]) => {
    if (!hideDuplicates) return data;

    // Filter duplicates: keep only one record if same name, type, and date within 10 mins
    const filtered: Record[] = [];
    const sorted = [...data].sort((a, b) => b.timestamp - a.timestamp);

    sorted.forEach(record => {
      const isDuplicate = filtered.some(r => 
        r.name === record.name && 
        r.type === record.type && 
        r.date === record.date &&
        Math.abs(r.timestamp - record.timestamp) < (10 * 60 * 1000)
      );
      if (!isDuplicate) filtered.push(record);
    });

    return filtered;
  };

  const filteredRecords = processRecords(records).filter(record => {
    const matchesSearch = record.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         record.department.toLowerCase().includes(searchTerm.toLowerCase());
    
    let matchesDate = true;
    if (startDate && endDate) {
      const recordDate = parseISO(record.date);
      matchesDate = isWithinInterval(recordDate, { 
        start: startOfDay(parseISO(startDate)), 
        end: endOfDay(parseISO(endDate)) 
      });
    }

    const matchesType = typeFilter === 'All' || record.type === typeFilter;

    return matchesSearch && matchesDate && matchesType;
  });

  const exportToExcel = () => {
    const dataToExport = filteredRecords.map(r => ({
      ID: r.id,
      Nombre: r.name,
      Departamento: r.department,
      Fecha: r.date,
      Hora: r.time,
      Tipo: r.type,
      Estado: r.status
    }));

    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Asistencia");
    XLSX.writeFile(wb, `Reporte_Asistencia_${format(new Date(), "yyyyMMdd")}.xlsx`);
  };

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
            <h1 className="text-3xl font-bold tracking-tight text-slate-800">Historial BioPoint</h1>
            <p className="text-slate-400 font-bold uppercase tracking-widest text-[10px] mt-1">Gestión administrativa de registros</p>
          </div>
        </div>
        <button 
          onClick={exportToExcel}
          className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-4 rounded-2xl font-bold shadow-xl shadow-emerald-100 transition-all active:scale-95 text-xs uppercase tracking-widest"
        >
          <FileSpreadsheet className="w-5 h-5" /> Exportar a Excel
        </button>
      </header>

      <div className="bento-card overflow-hidden mb-12">
        <div className="p-8 border-b border-slate-50 flex flex-wrap gap-6 items-center bg-slate-50/30">
          <div className="relative flex-1 min-w-[300px]">
            <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-300 w-5 h-5" />
            <input 
              type="text" 
              placeholder="Buscar empleado..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-14 pr-6 py-4 rounded-2xl bg-white border border-slate-200 outline-none focus:ring-2 focus:ring-indigo-500 transition-all font-medium text-sm"
            />
          </div>
          
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-3 bg-white p-2 rounded-2xl border border-slate-200 shadow-sm">
               <Calendar className="w-4 h-4 text-indigo-400 ml-2" />
               <div className="flex items-center gap-2 pr-2">
                <input 
                  type="date" 
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="outline-none text-xs font-bold text-slate-600 bg-transparent cursor-pointer"
                />
                <span className="text-slate-200 font-bold">/</span>
                <input 
                  type="date" 
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="outline-none text-xs font-bold text-slate-600 bg-transparent cursor-pointer"
                />
               </div>
            </div>
            
            <select 
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as any)}
              className="bg-white border border-slate-200 px-6 py-4 rounded-2xl outline-none focus:ring-2 focus:ring-indigo-500 text-xs font-bold text-slate-600 cursor-pointer shadow-sm uppercase tracking-widest"
            >
              <option value="All">Todos</option>
              <option value="Entrada">Entradas</option>
              <option value="Salida">Salidas</option>
            </select>

            <button 
              onClick={() => setHideDuplicates(!hideDuplicates)}
              className={cn(
                "flex items-center gap-2 px-6 py-4 rounded-2xl font-bold transition-all active:scale-95 text-[10px] uppercase tracking-widest",
                hideDuplicates ? "bg-indigo-50 text-indigo-600 border border-indigo-100" : "bg-white text-slate-400 border border-slate-200"
              )}
            >
              {hideDuplicates ? "Duplicados Ocultos" : "Mostrar Todo"}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50/50 text-slate-400 font-bold border-b border-slate-100">
              <tr>
                <th className="px-8 py-6 uppercase tracking-widest text-[10px]">Empleado</th>
                <th className="px-8 py-6 uppercase tracking-widest text-[10px]">Dep.</th>
                <th className="px-8 py-6 uppercase tracking-widest text-[10px]">Fecha</th>
                <th className="px-8 py-6 uppercase tracking-widest text-[10px]">Hora</th>
                <th className="px-8 py-6 uppercase tracking-widest text-[10px]">Tipo</th>
                <th className="px-8 py-6 uppercase tracking-widest text-[10px]">Puntualidad</th>
                <th className="px-8 py-6 uppercase tracking-widest text-[10px] text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filteredRecords.length > 0 ? filteredRecords.map((record) => (
                <tr key={record.id} className="hover:bg-slate-50/50 transition-colors group">
                  <td className="px-8 py-5">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 font-bold text-xs uppercase">
                        {record.name.charAt(0)}
                      </div>
                      <span className="font-bold text-slate-800 group-hover:text-indigo-600 transition-colors">{record.name}</span>
                    </div>
                  </td>
                  <td className="px-8 py-5 text-slate-400 font-bold text-xs">{record.department}</td>
                  <td className="px-8 py-5 text-slate-500 font-medium text-xs">
                    {record.date}
                  </td>
                  <td className="px-8 py-5 font-mono text-slate-600 font-bold text-xs">{record.time}</td>
                  <td className="px-8 py-5">
                    <span className={cn(
                      "px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest inline-block",
                      record.type === 'Entrada' ? "text-emerald-600 bg-emerald-50" : "text-orange-600 bg-orange-50"
                    )}>
                      {record.type}
                    </span>
                  </td>
                  <td className="px-8 py-5">
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        "text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-md",
                        record.punctuality === 'Retraso' || record.punctuality === 'Temprano' ? "bg-rose-50 text-rose-600" : "bg-emerald-50 text-emerald-600"
                      )}>
                        {record.punctuality || 'Normal'}
                      </span>
                    </div>
                  </td>
                  <td className="px-8 py-5 text-right">
                    <button 
                      onClick={() => record.id && handleDelete(record.id)}
                      className="p-2 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-all"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={6} className="px-8 py-24 text-center">
                    <div className="flex flex-col items-center gap-3">
                       <Filter className="w-10 h-10 text-slate-200" />
                       <p className="text-slate-400 font-bold uppercase tracking-widest text-xs">Sin coincidencias en la búsqueda</p>
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
