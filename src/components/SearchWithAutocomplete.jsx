import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Search, X } from 'lucide-react';
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { getFirebaseDbInstance } from '../firebase';
import { canAccessFirestore } from '../utils/firestoreGate';

const normalizeQuery = (value) => value.trim().toLowerCase();
const getUserVisibleName = (user) => user?.displayName || user?.username || 'Gebruiker';

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
  authReady,
  authUser,
  value,
  onChange,
  onSelect,
  placeholder = 'Zoek op naam of gebruikersnaam',
  selectedLabel = '',
  onClearSelection,
  selectedStateLabel = 'Geselecteerd',
}) {
  const containerRef = useRef(null);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [selectionLocked, setSelectionLocked] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  const normalizedQuery = useMemo(() => normalizeQuery(value), [value]);

  useEffect(() => {
    if (!canAccessFirestore({ authReady, user: authUser })) {
      setResults([]);
      return;
    }
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
  }, [normalizedQuery, authReady, authUser]);

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (!containerRef.current?.contains(event.target)) {
        setIsFocused(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  const hasSelectedState = Boolean(selectedLabel);
  const showDropdown = isFocused && !selectionLocked && normalizedQuery && (loading || results.length > 0);

  useEffect(() => {
    if (!showDropdown || loading || results.length === 0) {
      setHighlightedIndex(-1);
      return;
    }
    setHighlightedIndex(0);
  }, [showDropdown, loading, results]);

  const commitSelection = (user) => {
    onSelect?.(user);
    setSelectionLocked(true);
    setIsFocused(false);
    setHighlightedIndex(-1);
  };

  const handleInputKeyDown = (event) => {
    if (!showDropdown || loading || results.length === 0) {
      if (event.key === 'Escape') {
        setIsFocused(false);
      }
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlightedIndex((prev) => (prev < 0 ? 0 : Math.min(prev + 1, results.length - 1)));
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightedIndex((prev) => (prev <= 0 ? 0 : prev - 1));
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      const nextSelection = results[highlightedIndex] || results[0];
      if (nextSelection) commitSelection(nextSelection);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      setIsFocused(false);
      setHighlightedIndex(-1);
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      <Search className="absolute left-3 top-3.5 w-4 h-4 text-slate-400 dark:text-slate-500" />
      <input
        className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
        placeholder={placeholder}
        value={value}
        onChange={(event) => {
          setSelectionLocked(false);
          onChange?.(event.target.value);
        }}
        onFocus={() => {
          setIsFocused(true);
          setSelectionLocked(false);
        }}
        onKeyDown={handleInputKeyDown}
      />

      {showDropdown && (
        <div className="absolute z-20 mt-2 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg">
          {loading && (
            <div className="p-3 text-sm text-slate-500 dark:text-slate-300">Zoeken...</div>
          )}
          {!loading && results.length === 0 && (
            <div className="p-3 text-sm text-slate-500 dark:text-slate-300">Geen resultaten.</div>
          )}
          {!loading && results.length > 0 && (
            <div className="max-h-64 overflow-y-auto">
              {results.map((user, index) => (
                <button
                  key={user.uid}
                  type="button"
                  onClick={() => commitSelection(user)}
                  className={`w-full flex items-center gap-3 px-3 py-2 text-left ${highlightedIndex === index ? 'bg-slate-100 dark:bg-slate-800' : 'hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                >
                  <Avatar photoURL={user.photoURL} name={getUserVisibleName(user)} />
                  <div>
                    <p className="text-sm font-semibold dark:text-white">{getUserVisibleName(user)}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {hasSelectedState && (
        <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs text-emerald-700 dark:border-emerald-800/70 dark:bg-emerald-900/40 dark:text-emerald-200">
          <CheckCircle2 className="h-3.5 w-3.5" />
          <span className="font-semibold">{selectedStateLabel}:</span>
          <span>{selectedLabel}</span>
          {onClearSelection && (
            <button
              type="button"
              onClick={() => {
                setSelectionLocked(false);
                onClearSelection();
              }}
              className="inline-flex items-center rounded-full p-0.5 text-emerald-700 hover:bg-emerald-100 dark:text-emerald-200 dark:hover:bg-emerald-800/60"
              aria-label="Verwijder selectie"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
