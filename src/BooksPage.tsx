import { useState, useMemo } from 'react';
import type { User } from 'firebase/auth';
import { subscribeBooks, saveBooks } from './storage';
import type { BookItem, BookSortKey, BookStatus } from './types';
import { useCollection } from './hooks/useCollection';
import CollectionPage from './components/CollectionPage';
import BookCard from './components/BookCard';
import BookModal from './components/BookModal';
import BookFilterBar from './components/BookFilterBar';

interface Props {
  user: User;
  onBack: () => void;
}

export default function BooksPage({ user, onBack }: Props) {
  const { items, upsert, remove } = useCollection<BookItem>(user.uid, subscribeBooks, saveBooks);
  const [editItem, setEditItem] = useState<BookItem | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [selectedTag, setSelectedTag] = useState('');
  const [statusFilter, setStatusFilter] = useState<BookStatus | ''>('');
  const [sortKey, setSortKey] = useState<BookSortKey>('createdAt');

  const tags = useMemo(() => [...new Set(items.flatMap(i => i.tags))].sort(), [items]);

  const filtered = useMemo(() => {
    let list = items;
    if (statusFilter) list = list.filter(i => i.status === statusFilter);
    if (selectedTag) list = list.filter(i => i.tags.includes(selectedTag));
    return [...list].sort((a, b) => {
      if (sortKey === 'rating') return b.rating - a.rating;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [items, selectedTag, statusFilter, sortKey]);

  const openAdd = () => { setEditItem(null); setShowModal(true); };
  const openEdit = (item: BookItem) => { setEditItem(item); setShowModal(true); };
  const closeModal = () => { setShowModal(false); setEditItem(null); };

  const handleSave = (data: Omit<BookItem, 'id' | 'createdAt' | 'updatedAt'>) => {
    upsert(data, editItem);
    closeModal();
  };

  return (
    <CollectionPage
      title="✦ 読んだ本"
      onBack={onBack}
      emptyIcon="📚"
      itemCount={filtered.length}
      totalCount={items.length}
      onAdd={openAdd}
      filterBar={
        <BookFilterBar
          tags={tags}
          selectedTag={selectedTag}
          statusFilter={statusFilter}
          sortKey={sortKey}
          onTagChange={setSelectedTag}
          onStatusFilterChange={setStatusFilter}
          onSortChange={setSortKey}
        />
      }
      modal={showModal && (
        <BookModal item={editItem} onSave={handleSave} onClose={closeModal} />
      )}
    >
      <div className="space-y-3">
        {filtered.map(item => (
          <BookCard
            key={item.id}
            item={item}
            onEdit={openEdit}
            onDelete={remove}
          />
        ))}
      </div>
    </CollectionPage>
  );
}
