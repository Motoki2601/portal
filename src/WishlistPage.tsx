import { useState, useEffect, useMemo } from 'react';
import type { User } from 'firebase/auth';
import { Plus, ArrowLeft } from 'lucide-react';
import { subscribeItems, saveItems } from './storage';
import type { WishItem, SortKey } from './types';
import ItemCard from './components/ItemCard';
import ItemModal from './components/ItemModal';
import FilterBar from './components/FilterBar';

const nextId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

interface Props {
  user: User;
  onBack: () => void;
}

export default function WishlistPage({ user, onBack }: Props) {
  const [items, setItems] = useState<WishItem[]>([]);
  const [editItem, setEditItem] = useState<WishItem | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [selectedTag, setSelectedTag] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('rank');
  const [showPurchased, setShowPurchased] = useState(false);

  useEffect(() => subscribeItems(user.uid, setItems), [user]);

  const persist = (next: WishItem[]) => {
    setItems(next);
    saveItems(user.uid, next);
  };

  const tags = useMemo(() => [...new Set(items.flatMap(i => i.tags))].sort(), [items]);

  const filtered = useMemo(() => {
    let list = items;
    if (!showPurchased) list = list.filter(i => !i.purchased);
    if (selectedTag) list = list.filter(i => i.tags.includes(selectedTag));
    return [...list].sort((a, b) => {
      if (sortKey === 'rank') return b.rank - a.rank;
      if (sortKey === 'price_asc') return a.price - b.price;
      if (sortKey === 'price_desc') return b.price - a.price;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [items, selectedTag, sortKey, showPurchased]);

  const openAdd = () => { setEditItem(null); setShowModal(true); };
  const openEdit = (item: WishItem) => { setEditItem(item); setShowModal(true); };
  const closeModal = () => { setShowModal(false); setEditItem(null); };

  const handleSave = (data: Omit<WishItem, 'id' | 'createdAt' | 'updatedAt'>) => {
    const now = new Date().toISOString();
    const next = editItem
      ? items.map(i => (i.id === editItem.id ? { ...i, ...data, updatedAt: now } : i))
      : [...items, { ...data, id: nextId(), createdAt: now, updatedAt: now }];
    persist(next);
    closeModal();
  };

  const handleDelete = (id: string) => {
    if (confirm('削除しますか？')) {
      persist(items.filter(i => i.id !== id));
    }
  };

  const handleTogglePurchased = (id: string) => {
    const now = new Date().toISOString();
    persist(items.map(i => (i.id === id ? { ...i, purchased: !i.purchased, updatedAt: now } : i)));
  };

  const totalPrice = filtered
    .filter(i => !i.purchased && i.price > 0)
    .reduce((sum, i) => sum + i.price, 0);

  return (
    <div className="min-h-screen bg-gradient-to-b from-white via-white to-slate-50">
      {/* ヘッダー */}
      <header className="bg-white/80 backdrop-blur-sm border-b border-indigo-100/60 sticky top-0 z-40">
        <div className="max-w-2xl mx-auto px-5 py-4 flex items-center gap-3">
          <button
            onClick={onBack}
            className="text-slate-400 hover:text-indigo-700 transition-colors"
            aria-label="ポータルへ戻る"
          >
            <ArrowLeft size={18} />
          </button>
          <h1 className="text-lg font-bold tracking-tight text-indigo-900">✦ 欲しいものリスト</h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 pt-5 pb-28 space-y-4">
        {/* フィルタバー */}
        {items.length > 0 && (
          <FilterBar
            tags={tags}
            selectedTag={selectedTag}
            sortKey={sortKey}
            showPurchased={showPurchased}
            onTagChange={setSelectedTag}
            onSortChange={setSortKey}
            onShowPurchasedChange={setShowPurchased}
          />
        )}

        {/* アイテム一覧 */}
        {filtered.length === 0 ? (
          <div className="text-center py-24 text-slate-400">
            {items.length === 0 ? (
              <>
                <p className="text-5xl mb-4">🛍️</p>
                <p className="font-medium text-slate-500">まだ何もありません</p>
                <p className="text-sm mt-1 text-indigo-400">下の「追加」ボタンで登録しましょう</p>
              </>
            ) : (
              <>
                <p className="text-4xl mb-4">🔍</p>
                <p className="font-medium text-slate-500">条件に一致するアイテムがありません</p>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(item => (
              <ItemCard
                key={item.id}
                item={item}
                onEdit={openEdit}
                onDelete={handleDelete}
                onTogglePurchased={handleTogglePurchased}
              />
            ))}
          </div>
        )}
      </main>

      {/* ボトムバー */}
      <div className="fixed bottom-0 left-0 right-0 z-40">
        <div className="max-w-2xl mx-auto">
          <div className="bg-white/90 backdrop-blur-md border-t border-indigo-100/60 shadow-[0_-4px_24px_rgba(67,56,202,0.10)] px-5 py-3 flex items-center justify-between gap-4">
            {/* 件数・合計 */}
            <div>
              <p className="text-xs text-slate-400 leading-none mb-0.5">リスト</p>
              <p className="text-sm font-semibold text-slate-700">
                {filtered.length}件
                {totalPrice > 0 && (
                  <span className="text-indigo-700 ml-2">¥{totalPrice.toLocaleString()}</span>
                )}
              </p>
            </div>

            {/* 追加ボタン */}
            <button
              onClick={openAdd}
              className="flex items-center gap-2 bg-indigo-700 hover:bg-indigo-800 active:scale-95 text-white px-6 py-2.5 rounded-2xl text-sm font-semibold shadow-md shadow-indigo-200 transition-all"
            >
              <Plus size={17} strokeWidth={2.5} />
              追加
            </button>
          </div>
        </div>
      </div>

      {/* モーダル */}
      {showModal && (
        <ItemModal
          item={editItem}
          onSave={handleSave}
          onClose={closeModal}
        />
      )}
    </div>
  );
}
