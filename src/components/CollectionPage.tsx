import type { ReactNode } from 'react';
import { Plus, ArrowLeft, AlertTriangle } from 'lucide-react';

interface Props {
  title: string;
  onBack: () => void;
  emptyIcon: string;
  itemCount: number;
  totalCount: number;
  onAdd: () => void;
  filterBar?: ReactNode;
  footerExtra?: ReactNode;
  modal?: ReactNode;
  saveError?: boolean;
  children: ReactNode;
}

export default function CollectionPage({
  title, onBack, emptyIcon, itemCount, totalCount, onAdd,
  filterBar, footerExtra, modal, saveError, children,
}: Props) {
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
          <h1 className="text-lg font-bold tracking-tight text-indigo-900">{title}</h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 pt-5 pb-28 space-y-4">
        {/* フィルタバー */}
        {totalCount > 0 && filterBar}

        {/* アイテム一覧 */}
        {itemCount === 0 ? (
          <div className="text-center py-24 text-slate-400">
            {totalCount === 0 ? (
              <>
                <p className="text-5xl mb-4">{emptyIcon}</p>
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
          children
        )}
      </main>

      {/* 保存失敗トースト */}
      {saveError && (
        <div className="fixed bottom-24 left-0 right-0 z-50 flex justify-center px-4">
          <div className="flex items-center gap-2 bg-rose-600 text-white text-sm font-medium px-4 py-2.5 rounded-xl shadow-lg">
            <AlertTriangle size={16} />
            保存に失敗しました。通信状況を確認してください
          </div>
        </div>
      )}

      {/* ボトムバー */}
      <div className="fixed bottom-0 left-0 right-0 z-40">
        <div className="max-w-2xl mx-auto">
          <div className="bg-white/90 backdrop-blur-md border-t border-indigo-100/60 shadow-[0_-4px_24px_rgba(67,56,202,0.10)] px-5 py-3 flex items-center justify-between gap-4">
            {/* 件数 */}
            <div>
              <p className="text-xs text-slate-400 leading-none mb-0.5">リスト</p>
              <p className="text-sm font-semibold text-slate-700">
                {itemCount}件
                {footerExtra}
              </p>
            </div>

            {/* 追加ボタン */}
            <button
              onClick={onAdd}
              className="flex items-center gap-2 bg-indigo-700 hover:bg-indigo-800 active:scale-95 text-white px-6 py-2.5 rounded-2xl text-sm font-semibold shadow-md shadow-indigo-200 transition-all"
            >
              <Plus size={17} strokeWidth={2.5} />
              追加
            </button>
          </div>
        </div>
      </div>

      {/* モーダル */}
      {modal}
    </div>
  );
}
