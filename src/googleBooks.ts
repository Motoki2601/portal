export interface BookSuggestion {
  title: string;
  authors: string[];
}

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

export async function searchBooks(query: string): Promise<BookSuggestion[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  try {
    const res = await fetch(
      `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(trimmed)}&maxResults=5`
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
