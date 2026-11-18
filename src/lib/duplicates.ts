import type { DuplicateDismissal, Ledger } from '../types';

/**
 * 台帳の重複候補（要件6.2）。サーバーの ledger_names_similar（supabase/migrations の step4）と同じ判定にすること。
 * 工事名称を正規化（全角半角・大文字小文字・空白・記号）して、
 * 一方が他方を含む（短い方が2文字以上）、または文字の違いが少ない（短い方が3〜4文字なら1文字、5文字以上なら2文字まで）
 */
export function normalizeLedgerName(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}・「」『』（）【】〔〕［］｛｝〈〉《》、。，．：；！？ー－―‐~～]/gu, '');
}

function levenshtein(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  let prev = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[y.length];
}

export function ledgerNamesSimilar(a: string, b: string): boolean {
  const x = normalizeLedgerName(a);
  const y = normalizeLedgerName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const shortest = Math.min([...x].length, [...y].length);
  if (shortest >= 2 && (x.includes(y) || y.includes(x))) return true;
  if (shortest < 3) return false;
  return levenshtein(x, y) <= (shortest <= 4 ? 1 : 2);
}

export const pairKey = (a: string, b: string) => (a < b ? `${a}:${b}` : `${b}:${a}`);

/** 重複候補のペア（同じ顧客・削除も統合もされていない・「重複ではない」にしていない） */
export function findDuplicatePairs(ledgers: Ledger[], dismissals: DuplicateDismissal[]): [Ledger, Ledger][] {
  const dismissed = new Set(dismissals.map((d) => d.key));
  const active = ledgers.filter((l) => !l.deletedAt && !l.mergedInto);
  const byCustomer = new Map<string, Ledger[]>();
  for (const l of active) byCustomer.set(l.customerId, [...(byCustomer.get(l.customerId) ?? []), l]);
  const pairs: [Ledger, Ledger][] = [];
  for (const list of byCustomer.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const [a, b] = list[i].id < list[j].id ? [list[i], list[j]] : [list[j], list[i]];
        if (dismissed.has(pairKey(a.id, b.id))) continue;
        if (ledgerNamesSimilar(a.name, b.name)) pairs.push([a, b]);
      }
    }
  }
  return pairs;
}
