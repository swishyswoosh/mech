import { test } from "node:test";
import assert from "node:assert/strict";
import { darkPalette, lightPalette } from "../../../app/theme/palettes.ts";
const luminance = (hex: string) => {
  const c = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
};
const contrast = (a: string, b: string) => {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
test("both R2 palettes keep normal text and selected controls readable", () => {
  for (const palette of [darkPalette, lightPalette]) {
    for (const text of [
      palette.text,
      palette.textMuted,
      palette.primary,
      palette.caution,
      palette.ok,
    ])
      for (const surface of [palette.bg, palette.panel, palette.panelRaised])
        assert.ok(contrast(text, surface) >= 4.5, `${text} on ${surface}`);
    assert.ok(contrast(palette.onPrimary, palette.primary) >= 4.5);
  }
});
