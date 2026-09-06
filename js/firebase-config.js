/**
 * Firebase Configuration for Destrade Pro
 * Dual-Account Cloud Sharding Active (2x Free Tier = 20 GB/month Bandwidth, 2 GB Storage)
 * - DB 1: destrade (Indices + Symbols A-I)
 * - DB 2: destrade-2 (Symbols J-Z)
 */

const firebaseConfig1 = {
    apiKey: "AIzaSyDnPF-XXuI0kW5b9QcTPy1pV3c3dz0ZoIU",
    authDomain: "destrade.firebaseapp.com",
    databaseURL: "https://destrade-default-rtdb.firebaseio.com",
    projectId: "destrade",
    storageBucket: "destrade.firebasestorage.app",
    messagingSenderId: "774096602416",
    appId: "1:774096602416:web:36baa64922b203ba5a74f5"
};

const firebaseConfig2 = {
    apiKey: "AIzaSyAcztPg9WEQJ3sYrwyNZDQFU5-OiLd1QkY",
    authDomain: "destrade-2.firebaseapp.com",
    databaseURL: "https://destrade-2-default-rtdb.firebaseio.com",
    projectId: "destrade-2",
    storageBucket: "destrade-2.firebasestorage.app",
    messagingSenderId: "173001824359",
    appId: "1:173001824359:web:f6067707af26a50d0ddcc2"
};

// Global DB URLs for direct REST calls
window.FIREBASE_URL_1 = firebaseConfig1.databaseURL;
window.FIREBASE_URL_2 = firebaseConfig2.databaseURL;

// Symbol Sharding Helper:
// Indices + Symbols A-I -> DB 1 (destrade)
// Symbols J-Z -> DB 2 (destrade-2)
window.isSecondaryDbSymbol = function (sym) {
    if (!sym) return false;
    const clean = String(sym).toUpperCase().replace(/[^A-Z0-9]/g, '');
    const indices = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'NIFTYNXT50', 'SENSEX', 'BANKEX'];
    if (indices.includes(clean)) return false;
    const firstChar = clean[0];
    return firstChar >= 'J' && firstChar <= 'Z';
};

window.getFirebaseUrlForSymbol = function (sym) {
    return window.isSecondaryDbSymbol(sym) ? window.FIREBASE_URL_2 : window.FIREBASE_URL_1;
};

// Initialize Firebase SDK instances safely
try {
    if (typeof firebase !== 'undefined' && firebase && typeof firebase.initializeApp === 'function') {
        let app1 = null;
        let app2 = null;

        if (!firebase.apps.length) {
            app1 = firebase.initializeApp(firebaseConfig1);
            app2 = firebase.initializeApp(firebaseConfig2, "destrade2");
        } else {
            app1 = firebase.apps.find(a => a.name === '[DEFAULT]') || firebase.app();
            app2 = firebase.apps.find(a => a.name === 'destrade2') || firebase.initializeApp(firebaseConfig2, "destrade2");
        }

        window.db1 = app1 ? app1.database() : null;
        window.db2 = app2 ? app2.database() : null;
        window.db = window.db1; // Backwards compatible default

        window.getFirebaseDbForSymbol = function (sym) {
            return window.isSecondaryDbSymbol(sym) ? (window.db2 || window.db1) : window.db1;
        };

        console.log("🔥 Dual-Firebase Cloud Sync Active (DB1: destrade + DB2: destrade-2)");
    } else {
        console.warn("⚠️ Firebase SDK not active, running in standalone REST mode.");
        window.db1 = null;
        window.db2 = null;
        window.db = null;
    }
} catch (e) {
    console.warn("Firebase init warning:", e.message);
    window.db1 = null;
    window.db2 = null;
    window.db = null;
}
