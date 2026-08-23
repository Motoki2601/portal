import type { BookSortKey, BookStatus } from '../types';

interface Props {
  tags: string[];
  selectedTag: string;
  statusFilter: BookStatus | '';
  sortKey: BookSortKey;
  onTagChange: (t: string) => void;
  onStatusFilterChange: (s: BookStatus | '') => void;
  onSortChange: (s: BookSortKey) => void;
}

export default function BookFilterBar({
  tags, selectedTag, statusFilter, sortKey,
  onTagChange, onStatusFilterChange, onSortChange,
}: Props) {
  return (
    <div className="bg-white/70 backdrop-blur-sm rounded-2xl border border-slate-100 shadow-sm p-3.5">
      <div className="flex flex-wrap gap-2">
        {/* タグフィルタ */}
        <label className="sr-only" htmlFor="book-tag-filter">タグで絞り込み</label>
        <select
          id="book-tag-filter"
          value={selectedTag}
          onChange={e => onTagChange(e.target.value)}
          className="border border-slate-200 rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white text-slate-700"
        >
          <option value="">すべてのタグ</option>
          {tags.map(t => (
            <option key={t} value={t}>#{t}</option>
          ))}
        </select>

        {/* ステータスフィルタ */}
        <label className="sr-only" htmlFor="book-status-filter">ステータスで絞り込み</label>
        <select
          id="book-status-filter"
          value={statusFilter}
          onChange={e => onStatusFilterChange(e.target.value as BookStatus | '')}
          className="border border-slate-200 rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white text-slate-700"
        >
          <option value="">すべての状態</option>
          <option value="want">読みたい</option>
          <option value="reading">読んでる</option>
          <option value="done">読んだ</option>
        </select>

        {/* ソート */}
        <label className="sr-only" htmlFor="book-sort">並び替え</label>
        <select
          id="book-sort"
          value={sortKey}
          onChange={e => onSortChange(e.target.value as BookSortKey)}
          className="border border-slate-200 rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white text-slate-700"
        >
          <option value="rating">評価順</option>
          <option value="createdAt">追加順</option>
        </select>
      </div>
    </div>
  );
}
