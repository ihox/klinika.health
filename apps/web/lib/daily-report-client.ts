import { apiFetch } from './api';

export type DailyReportStatus =
  | 'scheduled'
  | 'arrived'
  | 'in_progress'
  | 'completed'
  | 'no_show';

export interface DailyReportVisit {
  id: string;
  time: string;
  patient: {
    id: string;
    firstName: string;
    lastName: string;
    dateOfBirth: string | null;
  };
  status: DailyReportStatus;
  isWalkIn: boolean;
  paymentCode: 'A' | 'B' | 'C' | 'D' | 'E' | null;
  paymentAmountCents: number | null;
  isFirstVisit: boolean;
}

export interface DailyReportPaymentCodeBreakdown {
  code: string;
  label: string;
  amountCents: number;
  count: number;
  totalCents: number;
}

export interface DailyReportPaymentCode {
  code: string;
  label: string;
  amountCents: number;
}

export interface DailyReportResponse {
  date: string;
  totalRevenueCents: number;
  visitCount: number;
  statusBreakdown: Record<DailyReportStatus, number>;
  paidCount: number;
  paymentCodeBreakdown: DailyReportPaymentCodeBreakdown[];
  paymentCodes: DailyReportPaymentCode[];
  visits: DailyReportVisit[];
}

export const dailyReportClient = {
  get(date: string): Promise<DailyReportResponse> {
    return apiFetch<DailyReportResponse>(
      `/api/visits/daily-summary?date=${encodeURIComponent(date)}`,
    );
  },
};
