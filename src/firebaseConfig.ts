
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyCTYugucY0DXU2tTwAmfX3sA_y_KSs5VGA',
  authDomain: 'shinzi-hub.firebaseapp.com',
  projectId: 'shinzi-hub',
  storageBucket: 'shinzi-hub.firebasestorage.app',
  messagingSenderId: '1063333455169',
  appId: '1:1063333455169:web:32e06fc13324cc9c98edc0',
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);

export default app;