import { Pencil, Trash2, ChevronDown, ChevronUp, Star } from 'lucide-react';
import { useState } from 'react';
import type { BookItem, BookStatus } from '../types';

interface Props {
  item: BookItem;
  onEdit: (item: BookItem) => void;
  onDelete: (id: string) => void;
}

const STATUS_LABELS: Record<BookStatus, string> = {
  want: '読みたい',
  reading: '読んでる',
  done: '読んだ',
};
const STATUS_COLORS: Record<BookStatus, string> = {
  want: 'bg-slate-200 text-slate-600',
  reading: 'bg-indigo-400 text-white',
  done: 'bg-indigo-900 text-white',
};

export default function BookCard({ item, onEdit, onDelete }: Props) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100">
      <div className="p-4">
        <div className="flex items-start gap-3">
          {/* ステータスバッジ */}
          <span
            className={`mt-0.5 shrink-0 px-2.5 py-1 flex items-center justify-center rounded-full text-xs font-bold whitespace-nowrap ${STATUS_COLORS[item.status]}`}
          >
            {STATUS_LABELS[item.status]}
          </span>

          {/* メイン情報 */}
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-gray-800 truncate">{item.title}</p>
            {item.author && <p className="text-sm text-slate-500 mt-0.5 truncate">{item.author}</p>}
            {item.rating > 0 && (
              <div className="flex items-center gap-0.5 mt-1" aria-label={`評価 ${item.rating}`}>
                {[1, 2, 3, 4, 5].map(n => (
                  <Star
                    key={n}
                    size={14}
                    className={n <= item.rating ? 'fill-indigo-500 text-indigo-500' : 'text-slate-200'}
                  />
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-1 mt-2">
              {item.tags.map(t => (
                <span key={t} className="text-xs bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full">
                  #{t}
                </span>
              ))}
            </div>
          </div>

          {/* アクション */}
          <div className="flex gap-1 shrink-0">
            <button
              onClick={() => onEdit(item)}
              className="p-1.5 text-slate-400 hover:text-indigo-700 hover:bg-indigo-50 rounded-lg"
              aria-label="編集"
            >
              <Pencil size={16} />
            </button>
            <button
              onClick={() => onDelete(item.id)}
              className="p-1.5 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg"
              aria-label="削除"
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>

        {/* 展開ボタン */}
        {item.memo && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="mt-3 flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 w-full justify-end"
            aria-expanded={expanded}
          >
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            {expanded ? '閉じる' : '感想を見る'}
          </button>
        )}

        {/* 展開パネル */}
        {expanded && item.memo && (
          <div className="mt-2 pt-3 border-t">
            <p className="text-xs text-gray-400 mb-0.5">感想</p>
            <p className="text-xs text-gray-700 whitespace-pre-wrap">{item.memo}</p>
          </div>
        )}
      </div>
    </div>
  );
}
