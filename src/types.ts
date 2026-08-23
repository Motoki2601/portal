export interface WishItem {
  id: string;
  name: string;
  price: number;
  url: string;
  tags: string[];
  rank: number; // 1〜5 (5が最高)
  memo: string;
  purchased: boolean;
  createdAt: string;
  updatedAt: string;
}

export type SortKey = 'rank' | 'price_asc' | 'price_desc' | 'createdAt';

export interface RecipeItem {
  id: string;
  name: string;
  url: string;
  tags: string[];
  rank: number; // 1〜5 (5が最高、作りたい度)
  ingredients: string;
  memo: string;
  cooked: boolean;
  createdAt: string;
  updatedAt: string;
}

export type RecipeSortKey = 'rank' | 'createdAt';
