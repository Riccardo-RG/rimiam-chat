/** The same page coordinates survive rotation and resizing until the user attaches a PNG. */
export const sketchPage = { width: 640, height: 440 } as const;
export const sketchInks = {
  Grafite: "#252823",
  Blu: "#245987",
  Rosso: "#a43248",
} as const;
export type SketchPoint = { x: number; y: number };
export type SketchStroke = { ink: string; points: SketchPoint[] };
export function sketchPoint(
  x: number,
  y: number,
  width: number,
  height: number,
): SketchPoint {
  const scale = (n: number, length: number, max: number) =>
    Math.max(0, Math.min(max, Math.round((n * max) / length)));
  return {
    x: scale(x, width, sketchPage.width),
    y: scale(y, height, sketchPage.height),
  };
}
export function strokePath(points: SketchPoint[]) {
  if (!points.length) return "";
  const [first, ...rest] = points;
  const line = rest.length ? rest : [{ x: first.x + 0.01, y: first.y }];
  return (
    "M" +
    first.x +
    " " +
    first.y +
    line.map((p) => "L" + p.x + " " + p.y).join("")
  );
}
