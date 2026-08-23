import { useState, useEffect, useRef } from 'react';
import { X, Star } from 'lucide-react';
import type { BookItem, BookStatus } from '../types';
import { searchBooks, type BookSuggestion } from '../googleBooks';

interface Props {
  item?: BookItem | null;
  onSave: (data: Omit<BookItem, 'id' | 'createdAt' | 'updatedAt'>) => void;
  onClose: () => void;
}

const STATUSES: { value: BookStatus; label: string }[] = [
  { value: 'want', label: '読みたい' },
  { value: 'reading', label: '読んでる' },
  { value: 'done', label: '読んだ' },
];

export default function BookModal({ item, onSave, onClose }: Props) {
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [status, setStatus] = useState<BookStatus>('want');
  const [rating, setRating] = useState(0);
  const [memo, setMemo] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<BookSuggestion[]>([]);
  const skipNextSearch = useRef(false);

  useEffect(() => {
    if (item) {
      skipNextSearch.current = true;
      setTitle(item.title);
      setAuthor(item.author);
      setStatus(item.status);
      setRating(item.rating);
      setMemo(item.memo);
      setTags(item.tags);
    }
  }, [item]);

  useEffect(() => {
    if (skipNextSearch.current) {
      skipNextSearch.current = false;
      setSuggestions([]);
      return;
    }
    if (!title.trim()) {
      setSuggestions([]);
      return;
    }
    const handle = setTimeout(() => {
      searchBooks(title).then(setSuggestions);
    }, 400);
    return () => clearTimeout(handle);
  }, [title]);

  const selectSuggestion = (s: BookSuggestion) => {
    skipNextSearch.current = true;
    setTitle(s.title);
    setAuthor(s.authors.join(', '));
    setSuggestions([]);
  };

  const addTag = () => {
    const t = tagInput.trim();
    if (t && !tags.includes(t)) setTags([...tags, t]);
    setTagInput('');
  };

  const removeTag = (t: string) => setTags(tags.filter(x => x !== t));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onSave({
      title: title.trim(),
      author: author.trim(),
      status,
      rating,
      memo: memo.trim(),
      tags,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[90vh] overflow-y-auto shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b sticky top-0 bg-white">
          <h2 className="text-lg font-semibold text-indigo-900">
            {item ? '本を編集' : '本を追加'}
          </h2>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-gray-100" aria-label="閉じる">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* 書名 */}
          <div className="relative">
            <label htmlFor="book-title" className="block text-sm font-medium text-slate-700 mb-1">
              書名 <span className="text-red-500">*</span>
            </label>
            <input
              id="book-title"
              required
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="例: 銀河鉄道の夜"
              autoComplete="off"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
            {suggestions.length > 0 && (
              <ul className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
                {suggestions.map((s, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => selectSuggestion(s)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50"
                    >
                      <p className="text-gray-800 truncate">{s.title}</p>
                      {s.authors.length > 0 && (
                        <p className="text-xs text-slate-400 truncate">{s.authors.join(', ')}</p>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* 著者 */}
          <div>
            <label htmlFor="book-author" className="block text-sm font-medium text-slate-700 mb-1">
              著者
            </label>
            <input
              id="book-author"
              value={author}
              onChange={e => setAuthor(e.target.value)}
              placeholder="書名の候補から選ぶと自動入力されます"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>

          {/* タグ */}
          <div>
            <label htmlFor="book-tag-input" className="block text-sm font-medium text-slate-700 mb-1">
              タグ
            </label>
            <div className="flex gap-2">
              <input
                id="book-tag-input"
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addTag())}
                placeholder="タグを入力してEnter"
                className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
              <button
                type="button"
                onClick={addTag}
                className="px-3 py-2 bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100 text-sm"
                aria-label="タグを追加"
              >
                +
              </button>
            </div>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {tags.map(t => (
                  <span key={t} className="flex items-center gap-1 bg-indigo-100 text-indigo-700 text-xs px-2 py-1 rounded-full">
                    {t}
                    <button type="button" onClick={() => removeTag(t)} className="hover:text-red-500" aria-label={`タグ ${t} を削除`}>
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* ステータス */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">ステータス</label>
            <div className="flex gap-2">
              {STATUSES.map(s => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => setStatus(s.value)}
                  aria-pressed={status === s.value}
                  className={`flex-1 py-2 rounded-xl text-sm font-medium border-2 transition-all ${
                    status === s.value
                      ? 'bg-indigo-700 border-indigo-700 text-white'
                      : 'border-slate-200 text-slate-500 hover:border-indigo-300'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* 評価 */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">評価</label>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map(n => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setRating(rating === n ? 0 : n)}
                  aria-label={`評価 ${n}`}
                  aria-pressed={rating === n}
                  className="p-1"
                >
                  <Star
                    size={24}
                    className={n <= rating ? 'fill-indigo-500 text-indigo-500' : 'text-slate-200'}
                  />
                </button>
              ))}
            </div>
          </div>

          {/* 感想 */}
          <div>
            <label htmlFor="book-memo" className="block text-sm font-medium text-slate-700 mb-1">
              感想
            </label>
            <textarea
              id="book-memo"
              value={memo}
              onChange={e => setMemo(e.target.value)}
              rows={3}
              placeholder="読んだ感想など..."
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none"
            />
          </div>

          {/* ボタン */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 border rounded-xl text-sm text-gray-600 hover:bg-gray-50"
            >
              キャンセル
            </button>
            <button
              type="submit"
              className="flex-1 py-2.5 bg-indigo-700 text-white rounded-xl text-sm font-medium hover:bg-indigo-800"
            >
              {item ? '保存' : '追加'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
