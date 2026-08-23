import { LogOut, ShoppingBag, BookOpen, ChefHat, NotebookPen } from 'lucide-react';
import { signOut } from 'firebase/auth';
import { auth } from './firebase';

interface Props {
  onOpenWishlist: () => void;
  onOpenRecipes: () => void;
}

export default function Portal({ onOpenWishlist, onOpenRecipes }: Props) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-white via-white to-slate-50">
      <header className="bg-white/80 backdrop-blur-sm border-b border-indigo-100/60 sticky top-0 z-40">
        <div className="max-w-2xl mx-auto px-5 py-4 flex items-center justify-between">
          <h1 className="text-lg font-bold tracking-tight text-indigo-900">✦ マイポータル</h1>
          <button
            onClick={() => signOut(auth)}
            className="text-slate-400 hover:text-indigo-700 transition-colors"
            aria-label="ログアウト"
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 pt-6 pb-10 space-y-3">
        <button
          onClick={onOpenWishlist}
          className="w-full flex items-center gap-4 bg-white/90 hover:bg-indigo-50 active:scale-[0.99] rounded-2xl px-5 py-4 shadow-sm border border-indigo-100/60 transition-all text-left"
        >
          <span className="flex items-center justify-center w-11 h-11 rounded-xl bg-indigo-100 text-indigo-700">
            <ShoppingBag size={20} />
          </span>
          <span>
            <p className="font-semibold text-slate-700">欲しいものリスト</p>
            <p className="text-xs text-slate-400 mt-0.5">買いたいものを管理</p>
          </span>
        </button>

        <button
          onClick={onOpenRecipes}
          className="w-full flex items-center gap-4 bg-white/90 hover:bg-indigo-50 active:scale-[0.99] rounded-2xl px-5 py-4 shadow-sm border border-indigo-100/60 transition-all text-left"
        >
          <span className="flex items-center justify-center w-11 h-11 rounded-xl bg-indigo-100 text-indigo-700">
            <ChefHat size={20} />
          </span>
          <span>
            <p className="font-semibold text-slate-700">作ってみたい料理</p>
            <p className="text-xs text-slate-400 mt-0.5">レシピをストック</p>
          </span>
        </button>

        <div className="w-full flex items-center gap-4 bg-white/50 rounded-2xl px-5 py-4 border border-indigo-100/40 opacity-60">
          <span className="flex items-center justify-center w-11 h-11 rounded-xl bg-slate-100 text-slate-400">
            <BookOpen size={20} />
          </span>
          <span>
            <p className="font-semibold text-slate-500">読んだ本</p>
            <p className="text-xs text-slate-400 mt-0.5">近日公開</p>
          </span>
        </div>

        <div className="w-full flex items-center gap-4 bg-white/50 rounded-2xl px-5 py-4 border border-indigo-100/40 opacity-60">
          <span className="flex items-center justify-center w-11 h-11 rounded-xl bg-slate-100 text-slate-400">
            <NotebookPen size={20} />
          </span>
          <span>
            <p className="font-semibold text-slate-500">つぶやきメモ</p>
            <p className="text-xs text-slate-400 mt-0.5">近日公開</p>
          </span>
        </div>
      </main>
    </div>
  );
}
