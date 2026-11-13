/** Distinct, print-friendly palette for election winners (avoid purple glow AI cliché). */
const CANDIDATE_PALETTE = [
  "#0B3D5C", // deep lake blue
  "#C45C26", // burnt orange
  "#2F6B4F", // park green
  "#8B1E3F", // brick
  "#B08900", // brass
  "#3D5A80", // steel
  "#6B4F3A", // brownstone
  "#1F7A8C", // teal
  "#A63D40", // clay
  "#4A6741", // olive
  "#7A5C45", // taupe
  "#245B7A", // navy mid
];

export function colorForCandidate(name: string, all: string[]): string {
  const idx = Math.max(0, all.indexOf(name));
  return CANDIDATE_PALETTE[idx % CANDIDATE_PALETTE.length]!;
}

export function legendForCandidates(names: string[]): { name: string; color: string }[] {
  return names.map((name) => ({ name, color: colorForCandidate(name, names) }));
}

/** Sequential lake→brass ramp for demographic choropleths. */
export function demographicColor(t: number): string {
  const stops: [number, [number, number, number]][] = [
    [0, [232, 236, 239]],
    [0.25, [168, 198, 212]],
    [0.5, [70, 130, 156]],
    [0.75, [28, 74, 104]],
    [1, [176, 137, 0]],
  ];
  const x = Math.min(1, Math.max(0, t));
  let i = 0;
  while (i < stops.length - 2 && x > stops[i + 1]![0]) i += 1;
  const [aT, aC] = stops[i]!;
  const [bT, bC] = stops[i + 1]!;
  const u = (x - aT) / (bT - aT || 1);
  const rgb = aC.map((c, j) => Math.round(c + (bC[j]! - c) * u));
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}
