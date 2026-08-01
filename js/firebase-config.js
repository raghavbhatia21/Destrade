/**
 * Firebase Configuration for Destrade Pro
 */

const firebaseConfig = {
    apiKey: "AIzaSyDnPF-XXuI0kW5b9QcTPy1pV3c3dz0ZoIU",
    authDomain: "destrade.firebaseapp.com",
    databaseURL: "https://destrade-default-rtdb.firebaseio.com",
    projectId: "destrade",
    storageBucket: "destrade.firebasestorage.app",
    messagingSenderId: "774096602416",
    appId: "1:774096602416:web:36baa64922b203ba5a74f5"
};

// Initialize Firebase safely without ever throwing or blocking app startup
try {
    if (typeof firebase !== 'undefined' && firebase && typeof firebase.initializeApp === 'function') {
        if (!firebase.apps.length) {
            firebase.initializeApp(firebaseConfig);
        }
        window.db = firebase.database();
        console.log("🔥 Firebase Realtime Cloud Sync Active (project: destrade)");
    } else {
        console.warn("⚠️ Firebase SDK not active, running in standalone mode.");
        window.db = null;
    }
} catch (e) {
    console.warn("Firebase init warning:", e.message);
    window.db = null;
}
