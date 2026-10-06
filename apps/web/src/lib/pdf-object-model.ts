import { LIMITS } from "@pdf-insight/shared";
import { z } from "zod";

export const PdfObjectCapacitySchema = z.object({
  images: z.number().int().min(0).max(LIMITS.maxInspectedImages),
  attachments: z.number().int().min(0).max(LIMITS.maxAttachments),
  attachmentBytes: z.number().int().min(0).max(LIMITS.maxAttachmentBytes),
  decodedBytes: z.number().int().min(0).max(LIMITS.maxDecodedBytes),
});
export type PdfObjectCapacity = z.infer<typeof PdfObjectCapacitySchema>;
export const PDF_OBJECT_CAPACITY: PdfObjectCapacity = {
  images: LIMITS.maxInspectedImages,
  attachments: LIMITS.maxAttachments,
  attachmentBytes: LIMITS.maxAttachmentBytes,
  decodedBytes: LIMITS.maxDecodedBytes,
};

const PixelImageSchema = z.object({
  kind: z.literal("pixels"),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  pixels: z.instanceof(Uint8ClampedArray),
});
const JpegImageSchema = z.object({ kind: z.literal("jpeg"), bytes: z.instanceof(Uint8Array) });

export const PdfObjectsSchema = z.object({
  strings: z.number().int().nonnegative(),
  decodedBytes: z.number().int().nonnegative().max(LIMITS.maxDecodedBytes),
  attachments: z
    .array(z.object({ name: z.string().min(1).max(255), bytes: z.instanceof(Uint8Array) }))
    .max(LIMITS.maxAttachments),
  findings: z.array(z.object({ kind: z.string(), count: z.number().int().positive() })),
  images: z.array(z.discriminatedUnion("kind", [PixelImageSchema, JpegImageSchema])).max(LIMITS.maxInspectedImages),
});

export type PdfObjects = z.infer<typeof PdfObjectsSchema>;
