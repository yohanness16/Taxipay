// types/index.ts

export type SmsStatus = 'pending' | 'processed' | 'failed';
export type SubscriptionStatus = 'trial' | 'active' | 'expired';
export type PaymentStatus = 'pending' | 'completed' | 'failed';

export interface DriverRow {
  id: number;
  phone: string;
  name: string;
  vehicle_number: string | null;
  password_hash: string;
  created_at: Date;
}

export interface SmsMessageRow {
  id: number;
  message: string;
  status: SmsStatus;
  processed_by: number | null;
  processed_at: Date | null;
  created_at: Date;
}

export interface SubscriptionRow {
  id: number;
  driver_id: number;
  start_date: Date;
  end_date: Date;
  amount: number;
  payment_method: string | null;
  transaction_id: string | null;
  status: SubscriptionStatus;
  created_at: Date;
}