import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import type { User } from 'firebase/auth';
import { commerceRequest } from './commerce-api';
import type { Estimate, Estimates, History, StockState } from './commerce-api';

const states: Record<StockState, string> = { unknown: '不明', likely_available: 'まだ残っている', running_low: '残り少ない', spare_available: '予備がある', out_of_stock: '使い切った' };
const reasons: Record<string, string> = {
  not_replenishment_target: '補充対象として未指定', not_current: '現在使っていない', newer_category_product: '同じカテゴリで新しい商品を購入',
  user_suppressed: '残り・予備の申告により7日間保留', insufficient_history: '購入履歴が不足', not_due: 'まだ補充時期ではない',
  user_out_of_stock: '本人が使い切ったと申告', cycle_due: '購入周期から補充時期に到達', past_available_observation: '以前の残り・予備の申告あり',
};
const days = (value: number | null) => value === null ? '算出できません' : `${Math.round(value * 10) / 10}日`;

function ProductCard({ item, user, onSaved }: { item: Estimate; user: User; onSaved: () => void }) {
  const [value, setValue] = useState<StockState>(item.state.state);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef<{ clientMutationId: string; productId: string; kind: string; value: StockState } | null>(null);
  const inFlight = useRef(false);
  async function save() {
    if (inFlight.current) return;
    inFlight.current = true;
    pending.current ??= { clientMutationId: crypto.randomUUID(), productId: item.product.id, kind: 'state', value };
    setSaving(true); setError('');
    try {
      await commerceRequest(user, '/user-observations', undefined, pending.current);
      pending.current = null; onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : '保存できませんでした。'); }
    finally { inFlight.current = false; setSaving(false); }
  }
  return <article className="rounded-2xl border border-indigo-100 bg-white p-5 space-y-3">
    <div className="flex items-start justify-between gap-3">
      <h2 className="font-semibold text-slate-800">{item.product.canonicalName}</h2>
      <span className={`shrink-0 rounded-full px-2 py-1 text-xs ${item.candidate.eligible ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-600'}`}>{item.candidate.eligible ? '補充候補' : '様子を見る'}</span>
    </div>
    <dl className="grid grid-cols-2 gap-2 text-sm">
      <dt className="text-slate-500">{item.calculation.basis === 'category' ? '同カテゴリの最終購入' : '最終購入'}</dt><dd>{item.calculation.lastPurchasedOn ?? '不明'}</dd>
      <dt className="text-slate-500">購入間隔の平均 / 中央値</dt><dd>{days(item.calculation.averageIntervalDays)} / {days(item.calculation.medianIntervalDays)}</dd>
      <dt className="text-slate-500">次回購入の目安（推定）</dt><dd>{item.prediction.estimatedNextPurchaseOn ?? '履歴不足'}</dd>
      <dt className="text-slate-500">推定の確かさ</dt><dd>{({ medium: '中', low: '低', insufficient: '履歴不足' } as Record<string, string>)[item.prediction.confidence] ?? '不明'}</dd>
    </dl>
    <p className="text-xs text-slate-500">{item.calculation.basis === 'category' ? '同カテゴリ' : '同商品'}の購入日{item.calculation.purchaseCount}回を参照。{item.candidate.reasonCodes.map(code => reasons[code] ?? '判定理由を確認中').join('。')}</p>
    <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
      <label className="text-sm" htmlFor={`state-${item.product.id}`}>今の状態</label>
      <select id={`state-${item.product.id}`} value={value} disabled={saving || !!pending.current} onChange={e => setValue(e.target.value as StockState)} className="rounded-lg border border-slate-200 p-2 text-sm">
        {Object.entries(states).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select>
      <button type="button" onClick={save} disabled={saving} className="rounded-xl bg-indigo-700 px-4 py-2 text-sm text-white disabled:opacity-50">{saving ? '保存中…' : error ? '同じ内容で再試行' : 'この状態を保存'}</button>
    </div>
    {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
  </article>;
}

export default function CommercePage({ user, onBack }: { user: User; onBack: () => void }) {
  const [history, setHistory] = useState<History | null>(null);
  const [estimates, setEstimates] = useState<Estimates | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [moreLoading, setMoreLoading] = useState(false);
  const [moreError, setMoreError] = useState('');
  const [tab, setTab] = useState<'products' | 'history'>('products');
  const [candidatesOnly, setCandidatesOnly] = useState(true);
  const generation = useRef(0);
  useEffect(() => {
    const controller = new AbortController(); const current = ++generation.current;
    Promise.all([
      commerceRequest<History>(user, '/purchase-history?limit=20', controller.signal),
      commerceRequest<Estimates>(user, '/replenishment-estimates', controller.signal),
    ]).then(([h, e]) => {
      if (controller.signal.aborted) return;
      setHistory(h); setEstimates(e); setError(''); setMoreError('');
    }).catch(e => {
      if (!controller.signal.aborted) { setHistory(null); setEstimates(null); setError(e instanceof Error ? e.message : '取得できませんでした。'); }
    }).finally(() => { if (!controller.signal.aborted && current === generation.current) setLoading(false); });
    return () => { controller.abort(); generation.current = current + 1; };
  }, [user, refresh]);
  const reload = () => { setLoading(true); setRefresh(n => n + 1); };
  async function more() {
    if (!history?.nextCursor || moreLoading) return;
    const current = generation.current; setMoreLoading(true); setMoreError('');
    try {
      const page = await commerceRequest<History>(user, `/purchase-history?limit=20&cursor=${encodeURIComponent(history.nextCursor)}`);
      if (current === generation.current) setHistory(previous => previous ? { items: [...previous.items, ...page.items.filter(item => !previous.items.some(old => old.line.id === item.line.id))], nextCursor: page.nextCursor } : previous);
    } catch (e) { if (current === generation.current) setMoreError(e instanceof Error ? e.message : '取得できませんでした。'); }
    finally { setMoreLoading(false); }
  }
  const items = estimates?.items.filter(item => !candidatesOnly || item.candidate.eligible) ?? [];
  return <div className="min-h-screen bg-gradient-to-b from-white to-slate-50 text-slate-700">
    <header className="sticky top-0 z-40 border-b border-indigo-100 bg-white/90 backdrop-blur-sm">
      <div className="mx-auto flex max-w-2xl items-center gap-3 px-5 py-4">
        <button onClick={onBack} aria-label="ポータルへ戻る"><ArrowLeft size={18} /></button>
        <h1 className="flex-1 font-bold text-indigo-900">購入履歴・補充候補</h1>
        <button onClick={reload} disabled={loading || moreLoading} aria-label="最新情報を取得" className="disabled:opacity-40"><RefreshCw size={18} /></button>
      </div>
    </header>
    <main className="mx-auto max-w-2xl space-y-4 px-4 py-6">
      <p className="text-sm text-slate-500">購入周期から次の買い時を確認できます。補充時期は目安です。</p>
      {notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}
      <div className="flex gap-2" aria-label="表示する情報">
        {(['products', 'history'] as const).map(key => <button key={key} aria-pressed={tab === key} onClick={() => setTab(key)} className={`rounded-xl px-4 py-2 text-sm ${tab === key ? 'bg-indigo-700 text-white' : 'bg-white border border-indigo-100'}`}>{key === 'products' ? '補充・今の状態' : '購入履歴'}</button>)}
      </div>
      {loading && <p role="status">読み込み中…</p>}
      {!loading && error && <div role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-700"><p>{error}</p><button onClick={reload} className="mt-2 underline">再試行</button></div>}
      {!loading && !error && tab === 'products' && <>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={candidatesOnly} onChange={e => setCandidatesOnly(e.target.checked)} />補充候補だけ表示</label>
        <p className="text-xs text-slate-500">{estimates?.asOf}時点・{items.length}件</p>
        {items.length === 0 && <p className="rounded-2xl bg-white p-6 text-sm">{estimates?.items.length ? '今の補充候補はありません。チェックを外すと、他の商品や今の状態を確認できます。' : '購入履歴から照合された商品はまだありません。履歴の取込・商品照合後に表示されます。'}</p>}
        {items.map(item => <ProductCard key={item.product.id} item={item} user={user} onSaved={() => { setNotice('状態を保存しました。補充候補を再計算します。'); reload(); }} />)}
      </>}
      {!loading && !error && tab === 'history' && <>
        {!history?.items.length && <p className="rounded-2xl bg-white p-6 text-sm">購入履歴はまだありません。</p>}
        {history?.items.map(item => <article key={item.line.id} className="space-y-2 rounded-2xl border border-indigo-100 bg-white p-5">
          <h2 className="font-semibold">{item.product?.canonicalName ?? item.line.rawProductName}</h2>
          <p className="text-sm">{item.order.orderedOn ?? '購入日不明'} · {item.order.merchant === 'amazon' ? 'Amazon' : item.order.merchant === 'yodobashi' ? 'ヨドバシ' : 'その他'} · 数量 {item.line.quantity ?? '不明'}</p>
          <p className="text-xs text-slate-500">{item.order.status === 'cancelled' || item.line.status === 'cancelled' ? '取消済み' : item.order.status === 'ordered' && item.line.status === 'ordered' ? '注文済み' : '状態確認待ち'}</p>
        </article>)}
        {moreError && <p role="alert" className="text-sm text-rose-700">{moreError}</p>}
        {history?.nextCursor && <button onClick={more} disabled={moreLoading} className="w-full rounded-xl border border-indigo-200 bg-white py-3 text-sm">{moreLoading ? '読み込み中…' : '続きを表示'}</button>}
      </>}
    </main>
  </div>;
}
