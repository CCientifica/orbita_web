import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { 
    getFirestore, collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, 
    query, where, orderBy, onSnapshot, serverTimestamp, limit 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// CONFIGURACIÓN OFICIAL - INSTITUCIONAL
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

// EXPOSICIÓN GLOBAL (Shim compatible con módulos antiguos y modular)
window.firebaseInstance = { app, auth, db };

// Wrappers "inteligentas" para Firestore (inyectan db automáticamente pero no lo duplican)
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
    collection: _smartColl,
    doc: _smartDoc,
    getDoc, getDocs, setDoc, updateDoc, deleteDoc,
    query, where, orderBy, onSnapshot, serverTimestamp, limit, writeBatch
};


// Compatibilidad específica para user-management.js
window.firebaseCloudDb = {
    db, auth, collection: _smartColl, doc: _smartDoc, 
    getDocs, getDoc, setDoc, deleteDoc, updateDoc,
    isReady: false
};

window.firebaseAuth = {
    onAuthStateChanged,
    signOut: async () => {
        try { await signOut(auth); } catch(e) {}
        const form = document.createElement('form');
        form.method = 'POST'; form.action = '/logout';
        document.body.appendChild(form); form.submit();
    }
};

// SINCRONIZACIÓN DE USUARIO (Firebase -> Universal ready)
onAuthStateChanged(auth, (user) => {
    if (user) {
        window.firebaseCloudDb.isReady = true;
        window.dispatchEvent(new CustomEvent('firebase-ready', { detail: user }));
    } else {
        window.firebaseCloudDb.isReady = false;
        // Si el usuario está logueado en Spring (orbitaUser) pero no en Firebase, 
        // no intentaremos asignar a currentUser (es de solo lectura).
        // El login.html se encarga de establecer ambas sesiones.
    }
});

console.log("🚀 [FIREBASE-SHIM] SDK v10.8.0 (Universal) Inicializado - cood-tc");



