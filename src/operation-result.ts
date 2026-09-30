export type ItemStatus = "updated" | "skipped" | "failed";
export type OperationStatus = "updated" | "partial" | "skipped" | "failed";
export type OperationName = "style" | "effect" | "speed" | "rebuild";

export interface ItemResult {
  status: ItemStatus;
  reason: string | null;
  instanceId: string;
  eventId?: string;
  layerName?: string;
  message: string;
}

export interface OperationResult {
  status: OperationStatus;
  operation: OperationName;
  items: ItemResult[];
  appliedSpeed?: number;
  durationFrames?: number;
  message: string;
}

export function summarizeOperation(
  operation: OperationName,
  items: ItemResult[],
  extra?: { appliedSpeed?: number; durationFrames?: number; defaultEffectLabel?: string },
): OperationResult {
  const updated = items.filter((item) => item.status === "updated").length;
  const skipped = items.filter((item) => item.status === "skipped").length;
  const failed = items.filter((item) => item.status === "failed").length;
  let status: OperationStatus = "failed";
  if (updated > 0 && failed === 0 && skipped === 0) status = "updated";
  else if (updated > 0) status = "partial";
  else if (failed === 0 && skipped > 0) status = "skipped";
  return {
    status,
    operation,
    items,
    appliedSpeed: status === "updated" || status === "partial" ? extra?.appliedSpeed : undefined,
    durationFrames: status === "updated" || status === "partial" ? extra?.durationFrames : undefined,
    message: messageFor(operation, status, updated, skipped, failed, items, extra),
  };
}

function messageFor(
  operation: OperationName,
  status: OperationStatus,
  updated: number,
  skipped: number,
  failed: number,
  items: ItemResult[],
  extra?: { appliedSpeed?: number; durationFrames?: number; defaultEffectLabel?: string },
): string {
  if (operation === "speed") {
    if (status === "failed" || status === "skipped") return items[0]?.message || "未调整速度：片段保持原样。";
    return speedMessage(extra);
  }
  if (operation === "effect") {
    if (updated === 0) return items.find((item) => item.status !== "updated")?.message || "效果没有改变。";
    if (skipped === 0 && failed === 0) return `效果已应用到 ${updated} 段。`;
    return `效果已应用到 ${updated} 段；${skipped + failed} 段保留原效果。`;
  }
  if (operation === "rebuild") {
    if (updated === 0 && failed === 0 && skipped > 0) return items[0]?.message || "未更新。";
    if (updated > 0 && skipped === 0 && failed === 0) return `已更新 ${updated} 段文字。`;
    if (updated > 0 && skipped > 0 && failed === 0) {
      const manual = items.filter((item) => item.status === "skipped" && item.reason === "manual_edit").length;
      if (manual === skipped) return `已更新 ${updated} 段，跳过 ${manual} 段手动动画。`;
      return `已更新 ${updated} 段，跳过 ${skipped} 段。`;
    }
    if (updated > 0) return `已更新 ${updated} 段，${failed} 段失败。`;
    return items[0]?.message || "未更新。";
  }
  if (status === "updated") return "样式已更新。";
  if (status === "partial") return `样式已更新 ${updated} 处，${skipped + failed} 处未写入。`;
  return items[0]?.message || "样式没有写入。";
}

function speedMessage(extra?: { appliedSpeed?: number; durationFrames?: number }): string {
  if (!extra?.appliedSpeed || extra.durationFrames === undefined) return "速度已调整。";
  return `速度已调整为 ${trimSpeed(extra.appliedSpeed)} 倍。`;
}

function trimSpeed(speed: number): string {
  const rounded = Math.round(speed * 100) / 100;
  return String(rounded);
}
