export interface TimedEdge {
  id: string;
  startFrame: number;
  endFrame: number;
}

export interface SpeedPlan {
  speed: number;
  frames: Map<number, number>;
  durationFrames: number;
}

export function mapBaselineFrame(frame: number, speed: number): number {
  if (!(speed > 0)) throw new Error("速度倍率必须大于 0");
  return frame / speed;
}

export function planSpeed(baselineFrames: number[], masterDurationFrames: number, speed: number): SpeedPlan {
  if (!(speed > 0)) throw new Error("速度倍率必须大于 0");
  const unique = [...new Set(baselineFrames.concat([0, masterDurationFrames]))];
  const frames = new Map<number, number>();
  for (const frame of unique) frames.set(frame, Math.round(mapBaselineFrame(frame, speed)));
  return {
    speed,
    frames,
    durationFrames: frames.get(masterDurationFrames) ?? Math.round(masterDurationFrames / speed),
  };
}

export function mapEdges(edges: TimedEdge[], speed: number): TimedEdge[] {
  const frames = edges.flatMap((edge) => [edge.startFrame, edge.endFrame]);
  const planned = planSpeed(frames, Math.max(...frames, 0), speed);
  return edges.map((edge) => ({
    id: edge.id,
    startFrame: planned.frames.get(edge.startFrame) ?? Math.round(edge.startFrame / speed),
    endFrame: planned.frames.get(edge.endFrame) ?? Math.round(edge.endFrame / speed),
  }));
}

export function edgesStayJoined(edges: TimedEdge[], speed: number): boolean {
  const mapped = mapEdges(edges, speed);
  for (let index = 1; index < edges.length; index += 1) {
    if (edges[index].startFrame !== edges[index - 1].endFrame) continue;
    if (mapped[index].startFrame !== mapped[index - 1].endFrame) return false;
  }
  return true;
}

export function roundTripFromBaseline(frames: number[], masterDurationFrames: number, speeds: number[]): number[] {
  const restored = planSpeed(frames, masterDurationFrames, 1);
  for (const speed of speeds) planSpeed(frames, masterDurationFrames, speed);
  return frames.map((frame) => restored.frames.get(frame) ?? frame);
}

export interface SpeedDependency {
  id: string;
  sync: "managed" | "nonsync-music" | "sync" | "video" | "unclassified";
  manual: boolean;
  timeRemap: boolean;
  sharedOutside: boolean;
  classified: boolean;
  sourceFrames?: number;
  loop: boolean;
  coverageFrames?: number;
}

export interface SpeedPreflight {
  ok: boolean;
  reason: string | null;
  message: string;
}

export function preflightInstanceSpeed(speed: number, currentSpeed: number, dependencies: SpeedDependency[]): SpeedPreflight {
  if (!(speed >= 0.5 && speed <= 2)) {
    return { ok: false, reason: "invalid_input", message: "速度需要在 0.5 到 2 之间。" };
  }
  if (Math.abs(speed - currentSpeed) < 0.001) {
    return { ok: false, reason: "no_change", message: "速度没有变化。" };
  }
  for (const dependency of dependencies) {
    if (dependency.sharedOutside && dependency.sync !== "managed") {
      return {
        ok: false,
        reason: "unsupported_dependency",
        message: `未调整速度：${dependency.id} 被片段外的合成复用。`,
      };
    }
    if (dependency.sharedOutside && dependency.id !== "master") {
      return {
        ok: false,
        reason: "unsupported_dependency",
        message: `未调整速度：${dependency.id} 被片段外的合成复用。`,
      };
    }
    if (!dependency.classified || dependency.sync === "unclassified") {
      return {
        ok: false,
        reason: "unsupported_dependency",
        message: `未调整速度：无法确认 ${dependency.id} 能否安全变速。`,
      };
    }
    if (dependency.manual) {
      return { ok: false, reason: "manual_edit", message: "未调整速度：发现手动调整的事件，片段保持原样。" };
    }
    if (dependency.timeRemap) {
      return { ok: false, reason: "unreliable_time", message: "未调整速度：时间结构无法可靠换算，片段保持原样。" };
    }
    if (dependency.sync === "sync" && Math.abs(speed - 1) > 0.001) {
      return { ok: false, reason: "unsupported_dependency", message: "未调整速度：此片段包含同步配音，当前版本不支持同步变速。" };
    }
    if (dependency.sync === "video") {
      return { ok: false, reason: "unsupported_dependency", message: `未调整速度：${dependency.id} 是视频，当前版本不能伸缩时间。` };
    }
    if (
      dependency.sync === "nonsync-music" &&
      dependency.coverageFrames !== undefined &&
      dependency.sourceFrames !== undefined &&
      dependency.coverageFrames > dependency.sourceFrames &&
      !dependency.loop
    ) {
      return {
        ok: false,
        reason: "unsupported_dependency",
        message: `未调整速度：${dependency.id} 延长后会超出素材长度，且没有循环。`,
      };
    }
  }
  return { ok: true, reason: null, message: "" };
}
