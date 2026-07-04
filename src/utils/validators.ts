import { z } from "zod";

// Ethiopian phone numbers: +2519XXXXXXXX or +2517XXXXXXXX
export const phoneSchema = z
  .string()
  .regex(/^\+251[97]\d{8}$/, "Phone must be a valid Ethiopian number, e.g. +251911234567");

export const registerSchema = z.object({
  phone: phoneSchema,
  name: z.string().min(2).max(100),
  vehicle_number: z.string().max(20).optional(),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

export const loginSchema = z.object({
  phone: phoneSchema,
  password: z.string().min(1),
});

export const paymentSchema = z.object({
  phone: phoneSchema,
  transaction_id: z.string().min(3),
  amount: z.number().positive(),
  status: z.enum(["completed", "pending", "failed"]).default("completed"),
});
