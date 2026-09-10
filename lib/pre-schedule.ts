import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';
import { useEffect, useState } from 'react';
export {
  PRE_CHOICES,
  monthDays,
  assessDays,
  reviewedDays,
  assessArrangement,
  effectiveMonthStatus,
  mayEmployeeEdit,
  mayReview,
} from '../functions/pre-schedule-domain.mjs';
export type PreMonth = {
  monthKey: string;
  status: 'open' | 'locked' | 'reviewing' | 'published';
  openAt: number | null;
  closeAt: number | null;
  publishJob?: string | null;
  publishedAt?: number | null;
  publishedBy?: string;
};
export type PrePerson = {
  employeeId: string;
  name: string;
  title: string;
  group: 'day' | 'night';
};
export type PreEntry = {
  employeeId: string;
  employeeName: string;
  jobTitle: string;
  group: 'day' | 'night';
  days: string[];
  arrangedDays?: (string | null)[];
  note: string;
  submitted: boolean;
  submittedAt: number | null;
  revision: number;
  updatedAt: number | null;
  modifiedBy?: string;
  modifiedAt?: number | null;
};
export type PreContext = {
  month: PreMonth | null;
  ownerId?: string;
  entry?: PreEntry | null;
  settings?: {
    startAt: number | null;
    endAt: number | null;
    status: string;
  } | null;
};
export type PreGroup = PreContext & {
  roster: PrePerson[];
  entries: PreEntry[];
  formalCodes?: string[];
  formalCodeSourceMonth?: string | null;
};
export type PreSummary = {
  monthKey: string;
  fingerprint: string;
  expected: number;
  day: number;
  night: number;
  submitted: number;
  unsubmitted: number;
  incomplete: number;
  abnormal: number;
  blocking: number;
  genericWorkDays: number;
  unarrangedWorkDays: number;
  unarrangedGroups: { day: number; night: number };
  existingCount: number;
};
export type PreProgress = {
  jobId: string;
  next: number;
  total: number;
  records: number;
  done?: boolean;
  ready?: boolean;
};
// Re-render at period boundaries, not every second across thousands of matrix cells.
export function usePreScheduleClock(month: PreMonth | null | undefined) {
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      const current = Date.now();
      setClock(current);
      const next = [month?.openAt, month?.closeAt]
        .filter((t): t is number => typeof t === 'number' && t > current)
        .sort((a, b) => a - b)[0];
      if (next)
        timer = setTimeout(update, Math.min(next - current + 1, 2147483647));
    };
    update();
    return () => clearTimeout(timer);
  }, [month?.openAt, month?.closeAt]);
  return clock;
}
export async function preCall<T>(
  action: string,
  monthKey: string,
  values: Record<string, unknown> = {},
) {
  return (
    await httpsCallable<Record<string, unknown>, T>(
      functions,
      'preSchedule',
    )({ action, monthKey, ...values })
  ).data;
}
export const preMonthLabel = (key: string) =>
  `${key.slice(0, 4)} 年 ${Number(key.slice(5))} 月`;
export const preTime = (value: number | null | undefined) =>
  value
    ? new Date(value).toLocaleString('zh-TW', {
        timeZone: 'Asia/Taipei',
        hour12: false,
      })
    : '尚未設定';
export function nextPreMonth() {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
  }).format(new Date());
  const [year, month] = today.split('-').map(Number);
  return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 7);
}
export const preError = (error: unknown) =>
  error instanceof Error ? error.message : '預排操作失敗，請稍後重試';
