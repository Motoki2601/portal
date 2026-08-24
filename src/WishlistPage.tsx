import { useState, useMemo } from 'react';
import type { User } from 'firebase/auth';
import { subscribeItems, saveItems } from './storage';
import type { WishItem, SortKey } from './types';
import { useCollection } from './hooks/useCollection';
import CollectionPage from './components/CollectionPage';
import ItemCard from './components/ItemCard';
import ItemModal from './components/ItemModal';
import FilterBar from './components/FilterBar';

interface Props {
  user: User;
  onBack: () => void;
}

export default function WishlistPage({ user, onBack }: Props) {
  const { items, upsert, remove, update, saveError } = useCollection<WishItem>(user.uid, subscribeItems, saveItems);
  const [editItem, setEditItem] = useState<WishItem | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [selectedTag, setSelectedTag] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('rank');
  const [showPurchased, setShowPurchased] = useState(false);

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
    upsert(data, editItem);
    closeModal();
  };

  const handleTogglePurchased = (id: string) => {
    const item = items.find(i => i.id === id);
    if (item) update(id, { purchased: !item.purchased });
  };

  const totalPrice = filtered
    .filter(i => !i.purchased && i.price > 0)
    .reduce((sum, i) => sum + i.price, 0);

  return (
    <CollectionPage
      title="✦ 欲しいものリスト"
      onBack={onBack}
      emptyIcon="🛍️"
      itemCount={filtered.length}
      totalCount={items.length}
      onAdd={openAdd}
      saveError={saveError}
      filterBar={
        <FilterBar
          tags={tags}
          selectedTag={selectedTag}
          sortKey={sortKey}
          showPurchased={showPurchased}
          onTagChange={setSelectedTag}
          onSortChange={setSortKey}
          onShowPurchasedChange={setShowPurchased}
        />
      }
      footerExtra={totalPrice > 0 && (
        <span className="text-indigo-700 ml-2">¥{totalPrice.toLocaleString()}</span>
      )}
      modal={showModal && (
        <ItemModal item={editItem} onSave={handleSave} onClose={closeModal} />
      )}
    >
      <div className="space-y-3">
        {filtered.map(item => (
          <ItemCard
            key={item.id}
            item={item}
            onEdit={openEdit}
            onDelete={remove}
            onTogglePurchased={handleTogglePurchased}
          />
        ))}
      </div>
    </CollectionPage>
  );
}
