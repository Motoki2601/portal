import { db } from './firebase';
import type { WishItem, RecipeItem, BookItem } from './types';
import { createCollectionStorage } from './collectionStorage';

const wishlist = createCollectionStorage<WishItem>(db, 'wishlist');
const recipes = createCollectionStorage<RecipeItem>(db, 'recipes');
const books = createCollectionStorage<BookItem>(db, 'books');

export const subscribeItems = wishlist.subscribe;
export const saveItems = wishlist.save;
export const subscribeRecipes = recipes.subscribe;
export const saveRecipes = recipes.save;
export const subscribeBooks = books.subscribe;
export const saveBooks = books.save;
