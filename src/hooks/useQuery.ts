import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useApp } from '../context/AppContext';
import type { Db } from '../db/types';

export interface QueryState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * Charge des données depuis la base et les recharge : à chaque retour sur l'écran,
 * à chaque modification (revision) et quand `deps` change.
 */
export function useQuery<T>(fn: (db: Db) => Promise<T>, deps: ReadonlyArray<unknown> = []): QueryState<T> {
  const { db, revision } = useApp();
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null }>({
    data: null,
    loading: true,
    error: null,
  });
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const requestId = useRef(0);
  const [tick, setTick] = useState(0);

  useFocusEffect(
    useCallback(() => {
      const id = ++requestId.current;
      fnRef.current(db).then(
        (data) => {
          if (id === requestId.current) setState({ data, loading: false, error: null });
        },
        (e) => {
          if (id === requestId.current) setState((s) => ({ data: s.data, loading: false, error: e instanceof Error ? e.message : String(e) }));
        },
      );
      return () => {
        requestId.current++;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [db, revision, tick, ...deps]),
  );

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}
