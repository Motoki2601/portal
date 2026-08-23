import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyCGFqbetUsuO0EbQZt9xDvZUFW3Yv27774',
  authDomain: 'wishlist-app-dcd2e.firebaseapp.com',
  projectId: 'wishlist-app-dcd2e',
  storageBucket: 'wishlist-app-dcd2e.firebasestorage.app',
  messagingSenderId: '961025790712',
  appId: '1:961025790712:web:92a2bb0d88606a531c610d',
  measurementId: 'G-HJQP0K5VE5',
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();
