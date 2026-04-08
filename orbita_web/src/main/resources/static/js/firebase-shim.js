import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signInAnonymously, signOut } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { 
    getFirestore, collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
    query, where, orderBy, onSnapshot, serverTimestamp, limit, writeBatch
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyD-kkAwT7iGI8jJc1wosV--TA4BjOaoH-Q",
    authDomain: "cood-tc.firebaseapp.com",
    projectId: "cood-tc",
    storageBucket: "cood-tc.firebasestorage.app",
    messagingSenderId: "767906346584",
    appId: "1:767906346584:web:59439d16292d3b0ea8bc2d"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

window.firebaseInstance = { app, auth, db };

const _smartColl = (...args) => {
    if (args[0] === db) return collection(...args);
    if (typeof args[0] === 'string') return collection(db, ...args);
    if (!args[0]) return collection(db, ...args.slice(1));
    return collection(...args);
};

const _smartDoc = (...args) => {
    if (args[0] === db) return doc(...args);
    if (typeof args[0] === 'string') return doc(db, ...args);
    if (!args[0]) return doc(db, ...args.slice(1));
    return doc(...args);
};

window.firebaseFirestore = {
    db,
    collection: _smartColl,
    doc: _smartDoc,
    getDoc,
    getDocs,
    setDoc,
    updateDoc,
    deleteDoc,
    query,
    where,
    orderBy,
    onSnapshot,
    serverTimestamp,
    limit,
    writeBatch
};

window.firebaseCloudDb = {
    db,
    auth,
    collection: _smartColl,
    doc: _smartDoc,
    getDocs,
    getDoc,
    setDoc,
    deleteDoc,
    updateDoc,
    isReady: false,
    authResolved: false,
    currentUser: null
};

window.firebaseAuth = {
    auth,
    onAuthStateChanged,
    signInAnonymously: () => signInAnonymously(auth),
    getCurrentUser: () => auth.currentUser,
    signOut: async () => {
        try {
            console.log("🔐 [FIREBASE-SHIM] Clearing Firebase session...");
            await signOut(auth);
            return true;
        } catch (e) {
            console.error("📛 [FIREBASE-SHIM] Logout failed:", e);
            return false;
        }
    }
};

onAuthStateChanged(auth, (user) => {
    window.firebaseCloudDb.authResolved = true;
    window.firebaseCloudDb.currentUser = user || null;
    window.firebaseCloudDb.isReady = !!user;

    window.dispatchEvent(new CustomEvent('firebase-auth-resolved', {
        detail: { user: user || null }
    }));

    if (user) {
        window.dispatchEvent(new CustomEvent('firebase-ready', { detail: user }));
        window.dispatchEvent(new CustomEvent('firebase-user-ready', { detail: user }));
    } else {
        // 🛰️ SOPORTE LAN / BULLETPROOF: Si no hay usuario, iniciamos sesión anónima
        // para habilitar el acceso a la base de datos de notificaciones.
        signInAnonymously(auth).then(() => {
            console.log("🛰️ [FIREBASE-SHIM] Acceso anónimo habilitado para red local.");
        }).catch(err => {
            // Si incluso el anónimo falla, forzamos que el sistema esté "listo"
            // para que los listeners no se queden colgados.
            window.dispatchEvent(new CustomEvent('firebase-ready', { detail: { email: 'anon@clinica.com' } }));
            console.warn("⚠️ [FIREBASE-SHIM] Error en login anónimo, forzando modo ready:", err);
        });
    }
});

console.log("🚀 [FIREBASE-SHIM] SDK v10.13.2 Inicializado - cood-tc");
