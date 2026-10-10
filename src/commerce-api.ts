import type { User } from 'firebase/auth';
import { auth } from './firebase';

export type StockState = 'unknown' | 'likely_available' | 'running_low' | 'spare_available' | 'out_of_stock';
export interface PurchaseItem {
  order: { id: string; orderedOn: string | null; merchant: string; status: string };
  line: { id: string; rawProductName: string; quantity: number | null; status: string };
  product: { id: string; canonicalName: string } | null;
}
export interface Estimate {
  product: { id: string; canonicalName: string };
  state: { state: StockState };
  calculation: { basis: string; lastPurchasedOn: string | null; purchaseCount: number; averageIntervalDays: number | null; medianIntervalDays: number | null };
  prediction: { estimatedNextPurchaseOn: string | null; confidence: string };
  candidate: { eligible: boolean; reasonCodes: string[] };
}
export interface History { items: PurchaseItem[]; nextCursor: string | null }
export interface Estimates { asOf: string; items: Estimate[] }

const baseUrl = import.meta.env.VITE_COMMERCE_API_URL || 'https://portal-commerce-api-3pcdbakkqa-an.a.run.app';
export async function commerceRequest<T>(user: User, path: string, signal?: AbortSignal, body?: object): Promise<T> {
  const url = new URL(baseUrl);
  if (url.protocol !== 'https:' || url.origin !== baseUrl) throw Error('購入サービスの接続設定を確認してください。');
  if (auth.currentUser?.uid !== user.uid) throw Error('ログインし直してください。');
  let token: string;
  try { token = await user.getIdToken(); }
  catch { throw Error('ログインし直してください。'); }
  if (auth.currentUser?.uid !== user.uid) throw Error('ログインし直してください。');
  let response: Response;
  try {
    response = await fetch(baseUrl + path, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
      redirect: 'error', cache: 'no-store', credentials: 'omit',
    });
  } catch {
    throw Error(body ? '保存結果を確認できません。同じ内容で再試行してください。' : '取得できませんでした。通信状況を確認して再試行してください。');
  }
  if (response.status === 401) throw Error('ログインし直してください。');
  if (response.status === 403) throw Error('このアカウントでは購入サービスをまだ利用できません。');
  if (!response.ok) throw Error(body ? '保存できませんでした。同じ内容で再試行してください。' : '購入情報を取得できませんでした。再試行してください。');
  if (auth.currentUser?.uid !== user.uid) throw Error('ログインし直してください。');
  let result: T;
  try { result = await response.json() as T; }
  catch { throw Error(body ? '保存結果を確認できません。同じ内容で再試行してください。' : '購入サービスの応答を確認できませんでした。'); }
  if (auth.currentUser?.uid !== user.uid) throw Error('ログインし直してください。');
  return result;
}
