// Firebase client SDK — used ONLY for Google sign-in.
// The app's own session (JWT cookies) is still issued by the backend after it verifies the ID token.
//
// Everything is initialised lazily inside getGoogleIdToken(). Initialising at import time made the
// whole landing page crash (and `next build` fail) whenever VITE_FIREBASE_* was missing,
// even for people who only use email/password.
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
};
/** Opens the Google popup and returns a Firebase ID token for the backend to verify. */
export async function getGoogleIdToken() {
    if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
        throw new Error('Google sign-in is not configured. Set the VITE_FIREBASE_* variables.');
    }
    const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
    const auth = getAuth(app);
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    const cred = await signInWithPopup(auth, provider);
    const idToken = await cred.user.getIdToken();
    // We use our own backend session, so don't keep a second (Firebase) session in the browser.
    await signOut(auth).catch(() => { });
    return idToken;
}
