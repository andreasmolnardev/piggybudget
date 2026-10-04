import type { RecordModel } from 'pocketbase';

export type UserProfile = {
  name: string;
  email: string;
  initials: string;
};

const defaultProfile: UserProfile = {
  name: 'Alex Morgan',
  email: 'alex@example.com',
  initials: 'AM',
};

function initialsFor(name: string, email: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length > 1) return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase();
  if (words[0]) return words[0].slice(0, 2).toUpperCase();
  return email.slice(0, 2).toUpperCase() || 'PB';
}

export function profileFromRecord(record: RecordModel | null | undefined): UserProfile {
  if (import.meta.env.DEV && import.meta.env.VITE_USE_DEFAULT_PROFILE === 'true') {
    return defaultProfile;
  }

  const email = String(record?.email ?? '').trim();
  const name =
    String(record?.display_name ?? record?.name ?? '').trim() ||
    email.split('@')[0] ||
    'Your profile';
  return { name, email, initials: initialsFor(name, email) };
}
