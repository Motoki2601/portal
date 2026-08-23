import { useState, useEffect } from 'react';
import { onAuthStateChanged, signInWithPopup, type User } from 'firebase/auth';
import { auth, googleProvider } from './firebase';
import Portal from './Portal';
import WishlistPage from './WishlistPage';
import RecipePage from './RecipePage';
import BooksPage from './BooksPage';

type View = 'portal' | 'wishlist' | 'recipes' | 'books';

export default function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [view, setView] = useState<View>('portal');

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  // Push a history entry per sub-view so the mobile swipe-back gesture
  // (and the Android back button) returns to the portal instead of
  // leaving the site entirely.
  useEffect(() => {
    history.replaceState({ view: 'portal' }, '');
    const onPopState = (e: PopStateEvent) => {
      setView((e.state?.view as View) ?? 'portal');
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const openView = (next: 'wishlist' | 'recipes' | 'books') => {
    history.pushState({ view: next }, '');
    setView(next);
  };

  const goBack = () => history.back();

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
    return <WishlistPage user={user} onBack={goBack} />;
  }

  if (view === 'recipes') {
    return <RecipePage user={user} onBack={goBack} />;
  }

  if (view === 'books') {
    return <BooksPage user={user} onBack={goBack} />;
  }

  return (
    <Portal
      onOpenWishlist={() => openView('wishlist')}
      onOpenRecipes={() => openView('recipes')}
      onOpenBooks={() => openView('books')}
    />
  );
}
