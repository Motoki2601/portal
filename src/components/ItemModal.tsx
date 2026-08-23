import { useState, useEffect } from 'react';
import { X, Plus } from 'lucide-react';
import type { WishItem } from '../types';

interface Props {
  item?: WishItem | null;
  onSave: (data: Omit<WishItem, 'id' | 'createdAt' | 'updatedAt'>) => void;
  onClose: () => void;
}

const RANKS = [1, 2, 3, 4, 5];
const RANK_ACTIVE_COLORS = [
  '',
  'bg-slate-300 border-slate-300 text-white',
  'bg-indigo-300 border-indigo-300 text-white',
  'bg-indigo-500 border-indigo-500 text-white',
  'bg-indigo-700 border-indigo-700 text-white',
  'bg-indigo-900 border-indigo-900 text-white',
];
const RANK_IDLE_COLORS = [
  '',
  'border-slate-300 text-slate-400 hover:border-slate-400',
  'border-indigo-200 text-indigo-400 hover:border-indigo-400',
  'border-indigo-300 text-indigo-500 hover:border-indigo-500',
  'border-indigo-400 text-indigo-600 hover:border-indigo-600',
  'border-indigo-500 text-indigo-700 hover:border-indigo-700',
];

export default function ItemModal({ item, onSave, onClose }: Props) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [url, setUrl] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [rank, setRank] = useState(3);
  const [memo, setMemo] = useState('');
  const [purchased, setPurchased] = useState(false);

  useEffect(() => {
    if (item) {
      setName(item.name);
      setPrice(String(item.price));
      setUrl(item.url);
      setTags(item.tags);
      setRank(item.rank);
      setMemo(item.memo);
      setPurchased(item.purchased);
    }
  }, [item]);

  const addTag = () => {
    const t = tagInput.trim();
    if (t && !tags.includes(t)) setTags([...tags, t]);
    setTagInput('');
  };

  const removeTag = (t: string) => setTags(tags.filter(x => x !== t));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSave({
      name: name.trim(),
      price: parseFloat(price) || 0,
      url: url.trim(),
      tags,
      rank,
      memo: memo.trim(),
      purchased,
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
            {item ? 'アイテムを編集' : 'アイテムを追加'}
          </h2>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-gray-100">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* 名前 */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              名前 <span className="text-red-500">*</span>
            </label>
            <input
              required
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="例: Sony WH-1000XM5"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>

          {/* 値段 */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">値段（円）</label>
            <input
              type="number"
              min="0"
              value={price}
              onChange={e => setPrice(e.target.value)}
              placeholder="例: 39800"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>

          {/* URL */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">URL</label>
            <input
              type="url"
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="https://..."
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>

          {/* タグ */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">タグ</label>
            <div className="flex gap-2">
              <input
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
              >
                <Plus size={16} />
              </button>
            </div>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {tags.map(t => (
                  <span key={t} className="flex items-center gap-1 bg-indigo-100 text-indigo-700 text-xs px-2 py-1 rounded-full">
                    {t}
                    <button type="button" onClick={() => removeTag(t)} className="hover:text-red-500">
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* ランキング */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              優先度 <span className="text-xs font-normal text-slate-400 ml-1">★5が最高優先</span>
            </label>
            <div className="flex gap-2">
              {RANKS.map(r => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRank(r)}
                  className={`w-10 h-10 rounded-full text-sm font-bold border-2 transition-all ${
                    rank === r
                      ? RANK_ACTIVE_COLORS[r]
                      : RANK_IDLE_COLORS[r]
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          {/* メモ */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">メモ</label>
            <textarea
              value={memo}
              onChange={e => setMemo(e.target.value)}
              rows={3}
              placeholder="気になる点、比較メモなど..."
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none"
            />
          </div>

          {/* 購入済み */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={purchased}
              onChange={e => setPurchased(e.target.checked)}
              className="w-4 h-4 rounded accent-indigo-600"
            />
            <span className="text-sm text-gray-700">購入済みにする</span>
          </label>

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
