import type { RecipeSortKey } from '../types';

interface Props {
  tags: string[];
  selectedTag: string;
  sortKey: RecipeSortKey;
  showCooked: boolean;
  onTagChange: (t: string) => void;
  onSortChange: (s: RecipeSortKey) => void;
  onShowCookedChange: (v: boolean) => void;
}

export default function RecipeFilterBar({
  tags, selectedTag, sortKey, showCooked,
  onTagChange, onSortChange, onShowCookedChange,
}: Props) {
  return (
    <div className="bg-white/70 backdrop-blur-sm rounded-2xl border border-slate-100 shadow-sm p-3.5">
      <div className="flex flex-wrap gap-2">
        {/* タグフィルタ */}
        <label className="sr-only" htmlFor="recipe-tag-filter">タグで絞り込み</label>
        <select
          id="recipe-tag-filter"
          value={selectedTag}
          onChange={e => onTagChange(e.target.value)}
          className="border border-slate-200 rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white text-slate-700"
        >
          <option value="">すべてのタグ</option>
          {tags.map(t => (
            <option key={t} value={t}>#{t}</option>
          ))}
        </select>

        {/* ソート */}
        <label className="sr-only" htmlFor="recipe-sort">並び替え</label>
        <select
          id="recipe-sort"
          value={sortKey}
          onChange={e => onSortChange(e.target.value as RecipeSortKey)}
          className="border border-slate-200 rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white text-slate-700"
        >
          <option value="rank">作りたい度順</option>
          <option value="createdAt">追加順</option>
        </select>

        {/* 作った済み表示切替 */}
        <label className="flex items-center gap-1.5 cursor-pointer text-sm text-slate-600 border border-slate-200 rounded-xl px-3 py-1.5 bg-white">
          <input
            type="checkbox"
            checked={showCooked}
            onChange={e => onShowCookedChange(e.target.checked)}
            className="w-3.5 h-3.5 accent-indigo-600"
          />
          作った済みも表示
        </label>
      </div>
    </div>
  );
}
