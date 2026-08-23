import { useState, useEffect } from 'react';
import { onAuthStateChanged, signInWithPopup, type User } from 'firebase/auth';
import { auth, googleProvider } from './firebase';
import Portal from './Portal';
import WishlistPage from './WishlistPage';
import RecipePage from './RecipePage';

type View = 'portal' | 'wishlist' | 'recipes';

export default function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [view, setView] = useState<View>('portal');

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  if (user === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-white via-white to-slate-50">
        <p className="text-slate-400">読み込み中...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-6 bg-gradient-to-b from-white via-white to-slate-50">
        <h1 className="text-xl font-bold tracking-tight text-indigo-900">✦ マイポータル</h1>
        <button
          onClick={() => signInWithPopup(auth, googleProvider)}
          className="bg-indigo-700 hover:bg-indigo-800 active:scale-95 text-white px-6 py-2.5 rounded-2xl text-sm font-semibold shadow-md shadow-indigo-200 transition-all"
        >
          Googleでログイン
        </button>
      </div>
    );
  }

  if (view === 'wishlist') {
    return <WishlistPage user={user} onBack={() => setView('portal')} />;
  }

  if (view === 'recipes') {
    return <RecipePage user={user} onBack={() => setView('portal')} />;
  }

  return <Portal onOpenWishlist={() => setView('wishlist')} onOpenRecipes={() => setView('recipes')} />;
}
