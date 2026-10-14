import PocketBase from 'pocketbase';

const apiUrl =
  import.meta.env.VITE_API_URL ??
  (typeof window === 'undefined' ? 'http://127.0.0.1:8090' : window.location.origin);

export const pb = new PocketBase(apiUrl);
