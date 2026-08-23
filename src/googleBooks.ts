export interface BookSuggestion {
  title: string;
  authors: string[];
}

export type SearchField = 'title' | 'author';

interface GoogleBooksVolumeInfo {
  title?: string;
  authors?: string[];
}

interface GoogleBooksItem {
  volumeInfo?: GoogleBooksVolumeInfo;
}

interface GoogleBooksResponse {
  items?: GoogleBooksItem[];
}

export async function searchBooks(query: string, field: SearchField): Promise<BookSuggestion[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const qualifier = field === 'author' ? 'inauthor' : 'intitle';
  const apiKey = import.meta.env.VITE_GOOGLE_BOOKS_API_KEY as string | undefined;
  const keyParam = apiKey ? `&key=${apiKey}` : '';

  try {
    const res = await fetch(
      `https://www.googleapis.com/books/v1/volumes?q=${qualifier}:${encodeURIComponent(trimmed)}&maxResults=8${keyParam}`
    );
    if (!res.ok) return [];
    const data = (await res.json()) as GoogleBooksResponse;
    return (data.items ?? [])
      .map(item => ({
        title: item.volumeInfo?.title ?? '',
        authors: item.volumeInfo?.authors ?? [],
      }))
      .filter(b => b.title);
  } catch {
    return [];
  }
}
