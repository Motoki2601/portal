import { useState, useMemo } from 'react';
import type { User } from 'firebase/auth';
import { subscribeRecipes, saveRecipes } from './storage';
import type { RecipeItem, RecipeSortKey } from './types';
import { useCollection } from './hooks/useCollection';
import CollectionPage from './components/CollectionPage';
import RecipeCard from './components/RecipeCard';
import RecipeModal from './components/RecipeModal';
import RecipeFilterBar from './components/RecipeFilterBar';

interface Props {
  user: User;
  onBack: () => void;
}

export default function RecipePage({ user, onBack }: Props) {
  const { items, upsert, remove, update } = useCollection<RecipeItem>(user.uid, subscribeRecipes, saveRecipes);
  const [editItem, setEditItem] = useState<RecipeItem | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [selectedTag, setSelectedTag] = useState('');
  const [sortKey, setSortKey] = useState<RecipeSortKey>('rank');
  const [showCooked, setShowCooked] = useState(false);

  const tags = useMemo(() => [...new Set(items.flatMap(i => i.tags))].sort(), [items]);

  const filtered = useMemo(() => {
    let list = items;
    if (!showCooked) list = list.filter(i => !i.cooked);
    if (selectedTag) list = list.filter(i => i.tags.includes(selectedTag));
    return [...list].sort((a, b) => {
      if (sortKey === 'rank') return b.rank - a.rank;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [items, selectedTag, sortKey, showCooked]);

  const openAdd = () => { setEditItem(null); setShowModal(true); };
  const openEdit = (item: RecipeItem) => { setEditItem(item); setShowModal(true); };
  const closeModal = () => { setShowModal(false); setEditItem(null); };

  const handleSave = (data: Omit<RecipeItem, 'id' | 'createdAt' | 'updatedAt'>) => {
    upsert(data, editItem);
    closeModal();
  };

  const handleToggleCooked = (id: string) => {
    const item = items.find(i => i.id === id);
    if (item) update(id, { cooked: !item.cooked });
  };

  return (
    <CollectionPage
      title="✦ 作ってみたい料理"
      onBack={onBack}
      emptyIcon="🍳"
      itemCount={filtered.length}
      totalCount={items.length}
      onAdd={openAdd}
      filterBar={
        <RecipeFilterBar
          tags={tags}
          selectedTag={selectedTag}
          sortKey={sortKey}
          showCooked={showCooked}
          onTagChange={setSelectedTag}
          onSortChange={setSortKey}
          onShowCookedChange={setShowCooked}
        />
      }
      modal={showModal && (
        <RecipeModal item={editItem} onSave={handleSave} onClose={closeModal} />
      )}
    >
      <div className="space-y-3">
        {filtered.map(item => (
          <RecipeCard
            key={item.id}
            item={item}
            onEdit={openEdit}
            onDelete={remove}
            onToggleCooked={handleToggleCooked}
          />
        ))}
      </div>
    </CollectionPage>
  );
}
