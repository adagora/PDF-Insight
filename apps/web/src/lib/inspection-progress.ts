import type { InspectionProgress } from "./inspection-model";

export function createInspectionProgress(
  totalPages: number,
  totalImages: number,
  emit: (progress: InspectionProgress) => void,
) {
  const total = totalPages + totalImages;
  let completed = 0;
  const report = (stage: InspectionProgress["stage"], page: number | null = null) =>
    emit({
      completed,
      total,
      percent: Math.floor((completed * 100) / total),
      page,
      totalPages,
      stage,
    });
  return {
    report,
    advance(count: number, stage: InspectionProgress["stage"], page: number | null = null) {
      completed = Math.min(total, completed + count);
      report(stage, page);
    },
  };
}

export function discovering(stage: "decoding" | "attachment"): InspectionProgress {
  return { completed: 0, total: null, percent: null, page: null, totalPages: null, stage };
}
