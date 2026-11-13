/** High-contrast palette tuned for dark basemaps. */
const CANDIDATE_PALETTE = [
  "#3DA9FC", // bright lake blue
  "#F97316", // ember orange
  "#34D399", // mint
  "#FB7185", // rose
  "#FBBF24", // amber
  "#2DD4BF", // teal
  "#F472B6", // pink
  "#86EFAC", // soft green
  "#38BDF8", // sky
  "#FCA5A5", // soft red
  "#67E8F9", // ice
  "#FDBA74", // peach
];

export function colorForCandidate(name: string, all: string[]): string {
  const idx = Math.max(0, all.indexOf(name));
  return CANDIDATE_PALETTE[idx % CANDIDATE_PALETTE.length]!;
}

export function legendForCandidates(names: string[]): { name: string; color: string }[] {
  return names.map((name) => ({ name, color: colorForCandidate(name, names) }));
}

/** Sequential cyan→amber ramp for demographic choropleths on dark maps. */
export function demographicColor(t: number): string {
  const stops: [number, [number, number, number]][] = [
    [0, [30, 41, 59]],
    [0.25, [30, 91, 122]],
    [0.5, [45, 160, 190]],
    [0.75, [120, 200, 170]],
    [1, [251, 191, 36]],
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
