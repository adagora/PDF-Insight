import { LIMITS } from "@pdf-insight/shared";
import { InspectionError } from "./inspection-model";

export type InspectionLimits = {
  readonly maxFileBytes: number;
  readonly maxAttachmentDepth: number;
  readonly maxAttachments: number;
  readonly maxAttachmentBytes: number;
  readonly maxInspectionPages: number;
  readonly maxInspectedImages: number;
  readonly maxDecodedBytes: number;
};

export type Admission = {
  readonly pages: number;
  readonly images: number;
  readonly decodedBytes: number;
  readonly attachmentSizes: readonly number[];
};

export function createInspectionBudget(limits: InspectionLimits = LIMITS) {
  let pages = 0;
  let images = 0;
  let attachments = 0;
  let attachmentBytes = 0;
  let decodedBytes = 0;
  return {
    input(size: number, depth: number) {
      if (size < 1 || size > limits.maxFileBytes || depth > limits.maxAttachmentDepth)
        throw new InspectionError("INSPECTION_LIMIT");
    },
    capacity: () => ({
      pages: limits.maxInspectionPages - pages,
      images: limits.maxInspectedImages - images,
      attachments: limits.maxAttachments - attachments,
      attachmentBytes: limits.maxAttachmentBytes - attachmentBytes,
      decodedBytes: limits.maxDecodedBytes - decodedBytes,
    }),
    reserve(input: Admission) {
      const sizes = input.attachmentSizes;
      const bytes = sizes.reduce((sum, size) => sum + size, 0);
      if (
        [input.pages, input.images, input.decodedBytes, ...sizes].some(
          (value) => !Number.isSafeInteger(value) || value < 0,
        ) ||
        sizes.some((size) => size === 0 || size > limits.maxFileBytes) ||
        pages + input.pages > limits.maxInspectionPages ||
        images + input.images > limits.maxInspectedImages ||
        attachments + sizes.length > limits.maxAttachments ||
        attachmentBytes + bytes > limits.maxAttachmentBytes ||
        decodedBytes + input.decodedBytes > limits.maxDecodedBytes
      )
        throw new InspectionError("INSPECTION_LIMIT");
      pages += input.pages;
      images += input.images;
      attachments += sizes.length;
      attachmentBytes += bytes;
      decodedBytes += input.decodedBytes;
    },
  };
}

export type InspectionCapacity = ReturnType<ReturnType<typeof createInspectionBudget>["capacity"]>;
