import React, { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { getFirebaseDbInstance } from '../firebase';

const normalizeQuery = (value) => value.trim().toLowerCase();

const Avatar = ({ photoURL, name }) => {
  if (photoURL) {
    return <img src={photoURL} alt={name} className="h-8 w-8 rounded-full object-cover" />;
  }
  return (
    <div className="h-8 w-8 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center text-xs font-semibold">
      {name?.slice(0, 1)?.toUpperCase() || '?'}
    </div>
  );
};

export default function SearchWithAutocomplete({
  value,
  onChange,
  onSelect,
  placeholder = 'Zoek op naam of @username',
}) {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  const normalizedQuery = useMemo(() => normalizeQuery(value), [value]);

  useEffect(() => {
    if (!normalizedQuery) {
      setResults([]);
      return;
    }
    let active = true;
    const timer = setTimeout(async () => {
      setLoading(true);
      const db = getFirebaseDbInstance();
      const publicUsersRef = collection(db, 'publicUsers');
      const searchTerm = normalizedQuery.startsWith('@') ? normalizedQuery.slice(1) : normalizedQuery;
      if (!searchTerm) {
        setResults([]);
        setLoading(false);
        return;
      }

      const usernameQuery = query(
        publicUsersRef,
        where('username', '>=', searchTerm),
        where('username', '<', `${searchTerm}\uf8ff`),
        orderBy('username'),
        limit(10),
      );

      const displayNameQuery = query(
        publicUsersRef,
        where('displayNameLower', '>=', searchTerm),
        where('displayNameLower', '<', `${searchTerm}\uf8ff`),
        orderBy('displayNameLower'),
        limit(10),
      );

      try {
        const [usernameSnap, displayNameSnap] = await Promise.all([
          getDocs(usernameQuery),
          normalizedQuery.startsWith('@') ? Promise.resolve(null) : getDocs(displayNameQuery),
        ]);
        const merged = new Map();
        usernameSnap?.docs.forEach((docSnap) => {
          merged.set(docSnap.id, { uid: docSnap.id, matchType: 'username', ...docSnap.data() });
        });
        displayNameSnap?.docs.forEach((docSnap) => {
          if (merged.has(docSnap.id)) return;
          merged.set(docSnap.id, { uid: docSnap.id, matchType: 'display', ...docSnap.data() });
        });
        const sorted = Array.from(merged.values()).sort((a, b) => {
          if (a.matchType === b.matchType) return 0;
          return a.matchType === 'username' ? -1 : 1;
        });
        if (active) setResults(sorted);
      } catch (error) {
        if (active) setResults([]);
      } finally {
        if (active) setLoading(false);
      }
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [normalizedQuery]);

  return (
    <div className="relative">
      <Search className="absolute left-3 top-3.5 w-4 h-4 text-slate-400" />
      <input
        className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
      />

      {(loading || results.length > 0) && (
        <div className="absolute z-20 mt-2 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg">
          {loading && (
            <div className="p-3 text-sm text-slate-500">Zoeken...</div>
          )}
          {!loading && results.length === 0 && (
            <div className="p-3 text-sm text-slate-500">Geen resultaten.</div>
          )}
          {!loading && results.length > 0 && (
            <div className="max-h-64 overflow-y-auto">
              {results.map((user) => (
                <button
                  key={user.uid}
                  type="button"
                  onClick={() => onSelect?.(user)}
                  className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <Avatar photoURL={user.photoURL} name={user.displayName || user.username} />
                  <div>
                    <p className="text-sm font-semibold dark:text-white">{user.displayName || 'Onbekend'}</p>
                    <p className="text-xs text-slate-500">@{user.username || 'onbekend'}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
