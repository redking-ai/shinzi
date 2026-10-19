
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

function getFirebaseAdminApp() {
  const existingApps = getApps();

  if (existingApps.length > 0) {
    return existingApps[0];
  }

  const rawCredentials = process.env.FIREBASE_SERVICE_ACCOUNT;

  if (!rawCredentials) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT is missing");
  }

  const serviceAccount = JSON.parse(rawCredentials);

  return initializeApp({
    credential: cert(serviceAccount),
  });
}

const adminApp = getFirebaseAdminApp();

export const adminDb = getFirestore(adminApp);
export const adminAuth = getAuth(adminApp);
