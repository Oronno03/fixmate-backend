import z from "zod";

export const servicesSchema = z.object({
    title: z.string(),
    category: z.string(),
    description: z.string(),
    image: z.string(),
    basePrice: z.string(),
    estimatedDuration: z.string(),
    serviceMode: z.string(),
    serviceArea: z.string(),
    isAvailable: z.boolean().optional(),
})