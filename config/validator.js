import z from "zod";

export const approvalStatusSchema = z.enum(["pending", "approved", "rejected"]);

export const servicesSchema = z.object({
  title: z.string(),
  category: z.string(),
  description: z.string(),
  image: z.string(),
  basePrice: z.number(),
  estimatedDuration: z.string(),
  serviceMode: z.string(),
  serviceArea: z.string(),
  isAvailable: z.boolean().optional(),
});

export const bookingStatus = z.enum([
  "requested",
  "accepted",
  "rejected",
  "in-progress",
  "completed",
  "cancelled",
]);
export const paymentStatus = z.enum(["paid", "unpaid"]);

export const bookingSchema = z.object({
  serviceId: z.string(),
  serviceTitle: z.string(),
  serviceImage: z.string(),
  category: z.string(),
  basePrice: z.number(),

  technicianName: z.string(),
  technicianEmail: z.email(),

  customerName: z.string(),
  customerEmail: z.email(),

  customerPhone: z.string(),
  address: z.string(),
  preferredDate: z.coerce.date(),
  problemDescription: z.string(),
  status: bookingStatus.default("requested"),
  finalAmount: z.number(),
  paymentStatus: paymentStatus.default("unpaid"),
});
