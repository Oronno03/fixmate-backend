import z from "zod";

export const approvalStatusSchema = z.enum(["pending", "approved", "rejected"]);

export const bookingStatus = z.enum([
  "requested",
  "accepted",
  "rejected",
  "in-progress",
  "completed",
  "cancelled",
]);

export const paymentStatus = z.enum(["paid", "unpaid"]);

export const roleSchema = z.enum(["customer", "technician", "admin"]);

export const categorySchema = z.enum([
  "Smartphone",
  "Laptop & PC",
  "AC",
  "Refrigerator",
  "TV",
  "Washing Machine",
  "Electrical",
]);

export const serviceModeSchema = z.enum(["Home Visit", "Shop Drop-off"]);

const objectIdString = z
  .string()
  .regex(/^[a-f\d]{24}$/i, "Invalid id.");

export const serviceCreateSchema = z.object({
  title: z.string().trim().min(3).max(120),
  category: categorySchema,
  description: z.string().trim().min(20).max(2000),
  image: z.url(),
  basePrice: z.coerce.number().positive(),
  estimatedDuration: z.string().trim().min(1).max(50),
  serviceMode: serviceModeSchema,
  serviceArea: z.string().trim().min(2).max(120),
});

export const serviceUpdateSchema = serviceCreateSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required.",
  });

export const serviceQuerySchema = z
  .object({
    search: z.string().trim().max(100).optional(),
    category: categorySchema.optional(),
    serviceMode: serviceModeSchema.optional(),
    minPrice: z.coerce.number().nonnegative().optional(),
    maxPrice: z.coerce.number().nonnegative().optional(),
    sort: z.enum(["price_asc", "price_desc", "newest"]).optional().default("newest"),
    limit: z.coerce.number().int().positive().max(50).optional(),
  })
  .refine(
    (data) =>
      data.minPrice === undefined ||
      data.maxPrice === undefined ||
      data.minPrice <= data.maxPrice,
    {
      message: "minPrice cannot be greater than maxPrice.",
      path: ["minPrice"],
    },
  );

const preferredDateSchema = z.coerce
  .date()
  .refine((date) => !Number.isNaN(date.getTime()), "Invalid date.")
  .refine((date) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return date >= today;
  }, "Preferred date must be today or later.");

export const bookingCreateSchema = z.object({
  serviceId: objectIdString,
  customerPhone: z.string().trim().min(6).max(20),
  address: z.string().trim().min(5).max(300),
  preferredDate: preferredDateSchema,
  problemDescription: z.string().trim().min(20).max(2000),
});

export const bookingStatusUpdateSchema = z
  .object({
    status: bookingStatus,
    finalAmount: z.coerce.number().positive().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.status === "completed" && data.finalAmount === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["finalAmount"],
        message: "A positive final amount is required to complete a job.",
      });
    }
  });

export const profileUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    phone: z.string().trim().min(6).max(20).optional(),
    area: z.string().trim().min(2).max(120).optional(),
    bio: z.string().trim().max(500).optional(),
    image: z.union([z.url(), z.null()]).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required.",
  });

export const roleUpdateSchema = z.object({
  role: roleSchema,
});

export const approvalUpdateSchema = z.object({
  approvalStatus: approvalStatusSchema,
});

export const availabilityUpdateSchema = z.object({
  isAvailable: z.boolean(),
});

export const paymentCreateSchema = z.object({
  bookingId: objectIdString,
});

export const uploadSchema = z.object({
  image: z.string().min(100, "Image data is required."),
  name: z.string().trim().max(100).optional(),
});
