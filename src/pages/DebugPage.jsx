import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import {
  createClaimInvite,
  getFirebaseDbInstance,
  isModerator,
  observeAuth,
  startEmailClaimProof,
  startWebsiteClaimProof,
} from '../firebase';
import { debugAllowed } from '../utils/debugAccess';

const logDebug = (...args) => console.log('[DEBUG PAGE]', ...args);

const statusStyles = {
  OK: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  FAIL: 'border-rose-200 bg-rose-50 text-rose-700',
  SKIP: 'border-slate-200 bg-slate-50 text-slate-600',
  PENDING: 'border-slate-200 bg-white text-slate-500',
};

const resolveFunctionsBase = () => {
  const explicitBase = import.meta.env.VITE_FUNCTIONS_BASE;
  if (explicitBase) return explicitBase;
  const moderationUrl = import.meta.env.VITE_MODERATION_FUNCTION_URL;
  if (moderationUrl && moderationUrl.includes('/moderateImage')) {
    return moderationUrl.replace('/moderateImage', '');
  }
  return moderationUrl || '';
};

const formatUserDetails = (user) => {
  if (!user) return 'niet ingelogd';
  return [
    `uid: ${user.uid}`,
    `email: ${user.email ?? 'onbekend'}`,
    `emailVerified: ${user.emailVerified ?? false}`,
  ].join(' | ');
};

const buildErrorPayload = (error, fallbackCode = 'error') => ({
  errorCode: error?.code || fallbackCode,
  errorMessage: error?.message || String(error),
});

const getErrorMessage = (data, fallback) => data?.error || data?.message || fallback;

export default function DebugPage() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [moderatorAccess, setModeratorAccess] = useState(false);
  const [results, setResults] = useState({});
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!debugAllowed()) {
      navigate('/', { replace: true });
    }
  }, [navigate]);

  useEffect(() => {
    const unsubscribe = observeAuth((nextUser) => {
      setUser(nextUser || null);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    let mounted = true;
    const updateModerator = async () => {
      if (!user) {
        setModeratorAccess(false);
        return;
      }
      const allowed = await isModerator(user);
      if (mounted) setModeratorAccess(allowed);
    };
    updateModerator();
    return () => {
      mounted = false;
    };
  }, [user]);

  const uid = user?.uid || 'uid';

  const testDefinitions = useMemo(
    () => [
      { id: 'auth-status', label: 'Auth status', details: 'Firebase auth user' },
      { id: 'read-users', label: 'Read users/{uid}', details: `users/${uid}` },
      { id: 'read-public-users', label: 'Read publicUsers/{uid}', details: `publicUsers/${uid}` },
      { id: 'read-config-moderation', label: 'Read config/moderation', details: 'config/moderation' },
      { id: 'read-posts', label: 'Read posts (latest)', details: 'posts orderBy(createdAt) limit 1' },
      { id: 'read-contributors', label: 'Read contributors (sample)', details: 'contributors limit 1' },
      { id: 'read-claim-requests', label: 'Read claimRequests (sample)', details: 'claimRequests limit 1' },
      { id: 'write-user-ping', label: 'Write users/{uid} debug ping', details: `users/${uid}` },
      { id: 'write-user-debug-ping', label: 'Write users/{uid}/debug/ping', details: `users/${uid}/debug/ping` },
      { id: 'fn-get-claim-invite-preview', label: 'Function getClaimInvitePreview', details: 'getClaimInvitePreview?token=debug-invalid-token' },
      { id: 'fn-create-claim-invite', label: 'Function createClaimInvite', details: 'createClaimInvite (missing contributorId)' },
      { id: 'fn-start-email-claim-proof', label: 'Function startEmailClaimProof', details: 'startEmailClaimProof (invalid requestId)' },
      { id: 'fn-start-website-claim-proof', label: 'Function startWebsiteClaimProof', details: 'startWebsiteClaimProof (invalid requestId)' },
    ],
    [uid],
  );

  const updateResult = useCallback((id, next) => {
    setResults((prev) => ({
      ...prev,
      [id]: {
        id,
        ...prev[id],
        ...next,
      },
    }));
  }, []);

  const runAuthTests = useCallback(async () => {
    logDebug('Running auth tests');
    if (!user) {
      const payload = {
        status: 'FAIL',
        details: formatUserDetails(null),
        errorCode: 'no-auth',
        errorMessage: 'Niet ingelogd.',
      };
      updateResult('auth-status', payload);
      logDebug('Auth test result', payload);
      return;
    }
    const payload = {
      status: 'OK',
      details: formatUserDetails(user),
    };
    updateResult('auth-status', payload);
    logDebug('Auth test result', payload);
  }, [updateResult, user]);

  const runReadTests = useCallback(async () => {
    logDebug('Running read tests');
    const db = getFirebaseDbInstance();
    const tests = [];

    const run = async (id, label, details, fn) => {
      try {
        const result = await fn();
        const payload = {
          status: 'OK',
          label,
          details: result || details,
        };
        updateResult(id, payload);
        logDebug('Read test OK', id, payload);
      } catch (error) {
        const payload = {
          status: 'FAIL',
          label,
          details,
          ...buildErrorPayload(error),
        };
        updateResult(id, payload);
        logDebug('Read test FAIL', id, payload);
      }
    };

    if (!user?.uid) {
      const payload = {
        status: 'FAIL',
        details: 'Geen gebruiker gevonden',
        errorCode: 'no-auth',
        errorMessage: 'Log eerst in om user-reads te testen.',
      };
      updateResult('read-users', payload);
      updateResult('read-public-users', payload);
    } else {
      tests.push(run(
        'read-users',
        'Read users/{uid}',
        `users/${user.uid}`,
        async () => {
          const snap = await getDoc(doc(db, 'users', user.uid));
          return `users/${user.uid} (exists: ${snap.exists()})`;
        },
      ));
      tests.push(run(
        'read-public-users',
        'Read publicUsers/{uid}',
        `publicUsers/${user.uid}`,
        async () => {
          const snap = await getDoc(doc(db, 'publicUsers', user.uid));
          return `publicUsers/${user.uid} (exists: ${snap.exists()})`;
        },
      ));
    }

    tests.push(run(
      'read-config-moderation',
      'Read config/moderation',
      'config/moderation',
      async () => {
        const snap = await getDoc(doc(db, 'config', 'moderation'));
        return `config/moderation (exists: ${snap.exists()})`;
      },
    ));

    tests.push(run(
      'read-posts',
      'Read posts (latest)',
      'posts orderBy(createdAt) limit 1',
      async () => {
        try {
          const postsQuery = query(
            collection(db, 'posts'),
            orderBy('createdAt', 'desc'),
            limit(1),
          );
          const snaps = await getDocs(postsQuery);
          return `posts orderBy(createdAt) limit 1 (docs: ${snaps.size})`;
        } catch (error) {
          const fallbackQuery = query(collection(db, 'posts'), limit(1));
          const snaps = await getDocs(fallbackQuery);
          return `posts limit 1 (fallback, docs: ${snaps.size})`;
        }
      },
    ));

    tests.push(run(
      'read-contributors',
      'Read contributors (sample)',
      'contributors limit 1',
      async () => {
        const snaps = await getDocs(query(collection(db, 'contributors'), limit(1)));
        return `contributors limit 1 (docs: ${snaps.size})`;
      },
    ));

    if (!moderatorAccess) {
      const payload = {
        status: 'SKIP',
        details: 'Alleen voor moderators.',
      };
      updateResult('read-claim-requests', payload);
      logDebug('Read test SKIP', payload);
    } else {
      tests.push(run(
        'read-claim-requests',
        'Read claimRequests (sample)',
        'claimRequests limit 1',
        async () => {
          const snaps = await getDocs(query(collection(db, 'claimRequests'), limit(1)));
          return `claimRequests limit 1 (docs: ${snaps.size})`;
        },
      ));
    }

    await Promise.all(tests);
  }, [moderatorAccess, updateResult, user]);

  const runWriteTests = useCallback(async () => {
    logDebug('Running write tests');
    const db = getFirebaseDbInstance();

    const run = async (id, label, details, fn) => {
      try {
        await fn();
        const payload = { status: 'OK', label, details };
        updateResult(id, payload);
        logDebug('Write test OK', id, payload);
      } catch (error) {
        const payload = {
          status: 'FAIL',
          label,
          details,
          ...buildErrorPayload(error),
        };
        updateResult(id, payload);
        logDebug('Write test FAIL', id, payload);
      }
    };

    if (!user?.uid) {
      const payload = {
        status: 'FAIL',
        details: 'Geen gebruiker gevonden',
        errorCode: 'no-auth',
        errorMessage: 'Log eerst in om writes te testen.',
      };
      updateResult('write-user-ping', payload);
      updateResult('write-user-debug-ping', payload);
      return;
    }

    await run(
      'write-user-ping',
      'Write users/{uid} debug ping',
      `users/${user.uid}`,
      async () => {
        await setDoc(
          doc(db, 'users', user.uid),
          {
            debugPingAt: serverTimestamp(),
            debugPingClient: 'debugPage',
          },
          { merge: true },
        );
      },
    );

    await run(
      'write-user-debug-ping',
      'Write users/{uid}/debug/ping',
      `users/${user.uid}/debug/ping`,
      async () => {
        await setDoc(
          doc(db, 'users', user.uid, 'debug', 'ping'),
          { updatedAt: serverTimestamp(), source: 'debugPage' },
          { merge: true },
        );
      },
    );
  }, [updateResult, user]);

  const runFunctionTests = useCallback(async () => {
    logDebug('Running function tests');
    const functionsBase = resolveFunctionsBase();

    const runFetchTest = async (id, label, details, request) => {
      if (!functionsBase) {
        const payload = {
          status: 'FAIL',
          label,
          details,
          errorCode: 'missing-functions-base',
          errorMessage: 'Geen functions base URL ingesteld.',
        };
        updateResult(id, payload);
        logDebug('Function test FAIL', id, payload);
        return;
      }
      try {
        const response = await fetch(request);
        if (response.ok) {
          const payload = {
            status: 'OK',
            label,
            details,
          };
          updateResult(id, payload);
          logDebug('Function test OK', id, payload);
          return;
        }
        const data = await response.json().catch(() => null);
        const payload = {
          status: 'FAIL',
          label,
          details,
          errorCode: String(response.status),
          errorMessage: getErrorMessage(data, response.statusText),
        };
        updateResult(id, payload);
        logDebug('Function test FAIL', id, payload);
      } catch (error) {
        const payload = {
          status: 'FAIL',
          label,
          details,
          ...buildErrorPayload(error),
        };
        updateResult(id, payload);
        logDebug('Function test FAIL', id, payload);
      }
    };

    const runCallableTest = async (id, label, details, fn) => {
      try {
        await fn();
        const payload = { status: 'OK', label, details };
        updateResult(id, payload);
        logDebug('Function test OK', id, payload);
      } catch (error) {
        const payload = {
          status: 'FAIL',
          label,
          details,
          ...buildErrorPayload(error, 'callable-error'),
        };
        updateResult(id, payload);
        logDebug('Function test FAIL', id, payload);
      }
    };

    await Promise.all([
      runFetchTest(
        'fn-get-claim-invite-preview',
        'Function getClaimInvitePreview',
        'getClaimInvitePreview?token=debug-invalid-token',
        `${functionsBase}/getClaimInvitePreview?token=debug-invalid-token`,
      ),
      runCallableTest(
        'fn-create-claim-invite',
        'Function createClaimInvite',
        'createClaimInvite (missing contributorId)',
        () => createClaimInvite({}),
      ),
      runCallableTest(
        'fn-start-email-claim-proof',
        'Function startEmailClaimProof',
        'startEmailClaimProof (invalid requestId)',
        () => startEmailClaimProof({ requestId: 'debug-invalid-request' }),
      ),
      runCallableTest(
        'fn-start-website-claim-proof',
        'Function startWebsiteClaimProof',
        'startWebsiteClaimProof (invalid requestId)',
        () => startWebsiteClaimProof({ requestId: 'debug-invalid-request' }),
      ),
    ]);
  }, [updateResult]);

  const runAllTests = useCallback(async () => {
    setRunning(true);
    await runAuthTests();
    await runReadTests();
    await runWriteTests();
    await runFunctionTests();
    setRunning(false);
  }, [runAuthTests, runReadTests, runWriteTests, runFunctionTests]);

  const renderCard = (definition) => {
    const result = results[definition.id];
    const status = result?.status || 'PENDING';
    const styles = statusStyles[status] || statusStyles.PENDING;
    return (
      <div
        key={definition.id}
        className={`rounded-2xl border p-4 shadow-sm ${styles}`}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">{result?.label || definition.label}</h3>
          <span className="text-xs font-semibold uppercase">{status}</span>
        </div>
        <p className="text-xs mt-2">
          {result?.details || definition.details}
        </p>
        {status === 'FAIL' && (
          <div className="mt-3 text-xs">
            <p className="font-semibold">{result?.errorCode}</p>
            <p>{result?.errorMessage}</p>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Debug pagina</h1>
            <p className="text-sm text-slate-600 mt-1">
              Klik en zie groen of rood. Resultaten loggen ook in de console met <span className="font-semibold">[DEBUG PAGE]</span>.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={runAllTests}
              disabled={running}
              className="rounded-full bg-slate-900 text-white px-4 py-2 text-sm font-semibold hover:bg-slate-800 disabled:opacity-60"
            >
              Run all tests
            </button>
            <button
              type="button"
              onClick={runAuthTests}
              className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            >
              Run auth
            </button>
            <button
              type="button"
              onClick={runReadTests}
              className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            >
              Run reads
            </button>
            <button
              type="button"
              onClick={runWriteTests}
              className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            >
              Run writes
            </button>
            <button
              type="button"
              onClick={runFunctionTests}
              className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            >
              Run functions
            </button>
          </div>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {testDefinitions.map((definition) => renderCard(definition))}
        </div>
      </div>
    </div>
  );
}
