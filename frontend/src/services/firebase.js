import { initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification
} from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

let auth = null;
let googleProvider = null;
export let isFirebaseConfigured = false;

if (
  firebaseConfig.apiKey &&
  firebaseConfig.authDomain &&
  firebaseConfig.projectId
) {
  try {
    const app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    googleProvider = new GoogleAuthProvider();
    isFirebaseConfigured = true;
    console.log("Firebase initialized successfully! 🔥");
  } catch (error) {
    console.error("Firebase init error:", error);
  }
} else {
  console.log("Firebase config missing or incomplete. Authentication will run in simulated mode.");
}

const requireFirebase = () => {
  if (!isFirebaseConfigured || !auth) {
    throw new Error("Authentication is not configured. Please set the VITE_FIREBASE_* environment variables.");
  }
};

export const signInWithGoogle = async () => {
  if (isFirebaseConfigured && auth && googleProvider) {
    const result = await signInWithPopup(auth, googleProvider);
    const idToken = await result.user.getIdToken();
    return {
      idToken,
      name: result.user.displayName,
      email: result.user.email,
      profileImage: result.user.photoURL
    };
  }
  // Simulated Mode: Return mock google response
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        idToken: "MOCK_GOOGLE_ID_TOKEN",
        name: "Google Explorer",
        email: `test_google_${Math.floor(1000 + Math.random() * 9000)}@gmail.com`,
        profileImage: "https://lh3.googleusercontent.com/a/default-user"
      });
    }, 800);
  });
};

// EMAIL/PASSWORD SIGNUP — creates the Firebase account and sends a real verification
// email. The account exists immediately, but emailVerified stays false until the user
// clicks the link Firebase sends — our backend reads that flag from the token, not
// from anything the client claims.
export const signUpWithEmail = async (email, password) => {
  requireFirebase();
  const result = await createUserWithEmailAndPassword(auth, email, password);
  await sendEmailVerification(result.user);
  const idToken = await result.user.getIdToken();
  return { idToken, emailVerified: result.user.emailVerified };
};

export const signInWithEmail = async (email, password) => {
  requireFirebase();
  const result = await signInWithEmailAndPassword(auth, email, password);
  const idToken = await result.user.getIdToken();
  return { idToken, emailVerified: result.user.emailVerified };
};



export const getCurrentIdToken = async (forceRefresh = false) => {
  if (!auth?.currentUser) return null;
  return auth.currentUser.getIdToken(forceRefresh);
};
