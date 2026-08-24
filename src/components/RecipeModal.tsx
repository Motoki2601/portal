import { useState, useEffect } from 'react';
import { X, Plus } from 'lucide-react';
import type { RecipeItem } from '../types';

interface Props {
  item?: RecipeItem | null;
  onSave: (data: Omit<RecipeItem, 'id' | 'createdAt' | 'updatedAt'>) => void;
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

export default function RecipeModal({ item, onSave, onClose }: Props) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [rank, setRank] = useState(3);
  const [ingredients, setIngredients] = useState('');
  const [memo, setMemo] = useState('');
  const [cooked, setCooked] = useState(false);

  useEffect(() => {
    if (item) {
      setName(item.name);
      setUrl(item.url);
      setTags(item.tags);
      setRank(item.rank);
      setIngredients(item.ingredients);
      setMemo(item.memo);
      setCooked(item.cooked);
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
      url: url.trim(),
      tags,
      rank,
      ingredients: ingredients.trim(),
      memo: memo.trim(),
      cooked,
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
            {item ? '料理を編集' : '料理を追加'}
          </h2>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-gray-100" aria-label="閉じる">
            <X size={20} />
          </button>
        </div>

        <form
          onSubmit={handleSubmit}
          className="p-5 space-y-4"
          style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }}
        >
          {/* 名前 */}
          <div>
            <label htmlFor="recipe-name" className="block text-sm font-medium text-slate-700 mb-1">
              料理名 <span className="text-red-500">*</span>
            </label>
            <input
              id="recipe-name"
              required
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="例: 麻婆豆腐"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>

          {/* レシピURL */}
          <div>
            <label htmlFor="recipe-url" className="block text-sm font-medium text-slate-700 mb-1">
              レシピURL
            </label>
            <input
              id="recipe-url"
              type="url"
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="https://..."
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>

          {/* タグ */}
          <div>
            <label htmlFor="recipe-tag-input" className="block text-sm font-medium text-slate-700 mb-1">
              タグ
            </label>
            <div className="flex gap-2">
              <input
                id="recipe-tag-input"
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
                <Plus size={16} />
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

          {/* 作りたい度 */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              作りたい度 <span className="text-xs font-normal text-slate-400 ml-1">★5が最高</span>
            </label>
            <div className="flex gap-2">
              {RANKS.map(r => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRank(r)}
                  aria-label={`作りたい度 ${r}`}
                  aria-pressed={rank === r}
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

          {/* 材料メモ */}
          <div>
            <label htmlFor="recipe-ingredients" className="block text-sm font-medium text-slate-700 mb-1">
              材料メモ
            </label>
            <textarea
              id="recipe-ingredients"
              value={ingredients}
              onChange={e => setIngredients(e.target.value)}
              rows={3}
              placeholder="必要な材料など..."
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none"
            />
          </div>

          {/* メモ */}
          <div>
            <label htmlFor="recipe-memo" className="block text-sm font-medium text-slate-700 mb-1">
              メモ
            </label>
            <textarea
              id="recipe-memo"
              value={memo}
              onChange={e => setMemo(e.target.value)}
              rows={3}
              placeholder="気になる点、アレンジメモなど..."
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none"
            />
          </div>

          {/* 作った */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={cooked}
              onChange={e => setCooked(e.target.checked)}
              className="w-4 h-4 rounded accent-indigo-600"
            />
            <span className="text-sm text-gray-700">作った済みにする</span>
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
