import { useEffect, useState } from 'react';
import {
  doc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from './firebase';
export const defaultFeatures = {
  attendanceEnabled: false,
  broadcastsEnabled: true,
  dispatchEnabled: true,
};
export type SystemFeatures = typeof defaultFeatures;
export const closedFeatures: SystemFeatures = {
  attendanceEnabled: false,
  broadcastsEnabled: false,
  dispatchEnabled: false,
};
export function useSystemFeatures(enabled = true) {
  const [state, setState] = useState({
    features: closedFeatures,
    loading: true,
    error: '',
  });
  useEffect(() => {
    setState({ features: closedFeatures, loading: true, error: '' });
    if (!enabled) return;
    return onSnapshot(
      doc(db, 'systemSettings', 'features'),
      (snapshot) => {
        const data = snapshot.data() || {};
        setState({
          features: Object.fromEntries(
            Object.entries(defaultFeatures).map(([key, value]) => [
              key,
              typeof data[key] === 'boolean' ? data[key] : value,
            ]),
          ) as SystemFeatures,
          loading: false,
          error: '',
        });
      },
      (error) => {
        console.error('[systemSettings] load failed', error);
        setState({
          features: closedFeatures,
          loading: false,
          error: '系統設定載入失敗，請重新整理後再試。',
        });
      },
    );
  }, [enabled]);
  return state;
}
export async function saveSystemFeature(
  key: keyof SystemFeatures,
  value: boolean,
  employeeId: string,
  database = db,
) {
  const ref = doc(database, 'systemSettings', 'features');
  await runTransaction(database, async (transaction) => {
    const snapshot = await transaction.get(ref);
    const patch = {
      [key]: value,
      updatedBy: employeeId,
      updatedAt: serverTimestamp(),
    };
    if (snapshot.exists()) transaction.update(ref, patch);
    else transaction.set(ref, { ...defaultFeatures, ...patch });
  });
}
