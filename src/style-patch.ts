export interface StylePatch {
  font?: string;
  fontSize?: number;
  leading?: {
    mode: "auto" | "explicit";
    value?: number;
  };
  fillColor?: [number, number, number];
}

export interface StyleFieldInput {
  font?: { dirty: boolean; value: string };
  fontSize?: { dirty: boolean; value: number };
  leading?: { dirty: boolean; mode: "auto" | "explicit"; value?: number };
  fillColor?: { dirty: boolean; value: [number, number, number] };
}

export function describeMixed<T extends string | number>(values: T[]): T | "多种值" {
  if (!values.length) return "多种值";
  const first = values[0];
  for (const value of values) {
    if (value !== first) return "多种值";
  }
  return first;
}

export function stylePatchFromDirty(input: StyleFieldInput): StylePatch {
  const patch: StylePatch = {};
  if (input.font?.dirty) {
    if (!input.font.value || input.font.value === "多种值") throw new Error("字体还没有确定的值");
    patch.font = input.font.value;
  }
  if (input.fontSize?.dirty) {
    if (!(input.fontSize.value > 0)) throw new Error("字号必须大于 0");
    patch.fontSize = input.fontSize.value;
  }
  if (input.leading?.dirty) {
    if (input.leading.mode === "explicit" && !(input.leading.value !== undefined && input.leading.value > 0)) {
      throw new Error("显式行距必须大于 0");
    }
    patch.leading = { mode: input.leading.mode, value: input.leading.mode === "explicit" ? input.leading.value : undefined };
  }
  if (input.fillColor?.dirty) {
    patch.fillColor = input.fillColor.value;
  }
  return patch;
}

export function patchTouches(patch: StylePatch, field: keyof StylePatch): boolean {
  return patch[field] !== undefined;
}
