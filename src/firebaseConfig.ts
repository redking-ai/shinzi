import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';


// ============================================================
// FIREBASE CONFIGURATION
// ============================================================

const firebaseConfig = {
  apiKey: 'AIzaSyCTYugucY0DX2uTwAmfX3sA_y_KSs5VGA',
  authDomain: 'shinzi-hub.firebaseapp.com',
  projectId: 'shinzi-hub',
  storageBucket: 'shinzi-hub.firebasestorage.app',
  messagingSenderId: '1063333455169',
  appId: '1:1063333455169:web:32e06fc13324cc9c98edc0',
};


// ============================================================
// INITIALIZE FIREBASE
// ============================================================

const app = initializeApp(firebaseConfig);


// ============================================================
// FIREBASE AUTH
// ============================================================

export const auth = getAuth(app);

export default app;
