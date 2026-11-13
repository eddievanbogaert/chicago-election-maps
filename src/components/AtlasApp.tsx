"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { ElectionMap } from "./ElectionMap";
import type {
  AtlasMode,
  ContestSummary,
  DemographicMetric,
  DemographicsPayload,
  ElectionSummary,
  MapPayload,
} from "@/lib/types";

const DEMO_METRICS: { id: DemographicMetric; label: string }[] = [
  { id: "medianIncome", label: "Median household income" },
  { id: "medianAge", label: "Median age" },
  { id: "pctBachelorPlus", label: "Bachelor's or higher" },
  { id: "pctHispanic", label: "Hispanic or Latino" },
  { id: "pctBlack", label: "Black" },
  { id: "pctWhite", label: "White" },
  { id: "pctAsian", label: "Asian" },
  { id: "totalPop", label: "Population" },
];

export function AtlasApp() {
  const [elections, setElections] = useState<ElectionSummary[]>([]);
  const [electionId, setElectionId] = useState<string>("2023-runoff");
  const [mode, setMode] = useState<AtlasMode>("mayor");
  /** null = citywide council view until a ward is chosen */
  const [ward, setWard] = useState<number | null>(null);
  const [contests, setContests] = useState<ContestSummary[]>([]);
  const [contestId, setContestId] = useState<string>("");
  const [mapData, setMapData] = useState<MapPayload | null>(null);
  const [demoData, setDemoData] = useState<DemographicsPayload | null>(null);
  const [metric, setMetric] = useState<DemographicMetric>("medianIncome");
  const [backend, setBackend] = useState<string>("sample");
  const [error, setError] = useState<string | null>(null);
  const [entered, setEntered] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    void (async () => {
      try {
        const [el, health] = await Promise.all([
          fetch("/api/elections").then((r) => r.json()),
          fetch("/api/health").then((r) => r.json()),
        ]);
        setElections(el.elections ?? []);
        setBackend(health.backend ?? "sample");
        if (el.elections?.length) {
          const preferred =
            el.elections.find((e: ElectionSummary) => e.id === "2023-runoff") ??
            el.elections[0];
          setElectionId(preferred.id);
        }
      } catch {
        setError("Could not load elections catalog.");
      }
    })();
  }, []);

  useEffect(() => {
    if (!electionId || mode === "demographics") return;

    // Council citywide: synthetic contest id, no ward filter.
    if (mode === "council" && ward == null) {
      setContests([]);
      setContestId(`${electionId}:alderman`);
      return;
    }

    startTransition(() => {
      void (async () => {
        const qs = new URLSearchParams({
          electionId,
          mode: mode === "council" ? "council" : "mayor",
        });
        if (mode === "council" && ward != null) qs.set("ward", String(ward));
        const res = await fetch(`/api/contests?${qs}`);
        const data = await res.json();
        const list: ContestSummary[] = data.contests ?? [];
        setContests(list);
        setContestId(list[0]?.id ?? "");
      })();
    });
  }, [electionId, mode, ward]);

  useEffect(() => {
    if (mode === "demographics") {
      startTransition(() => {
        void (async () => {
          const res = await fetch(`/api/demographics?metric=${metric}`);
          if (!res.ok) {
            setError("Demographics query failed.");
            return;
          }
          setDemoData(await res.json());
          setError(null);
        })();
      });
      return;
    }
    if (!contestId) return;
    const requested = contestId;
    setMapData(null);
    startTransition(() => {
      void (async () => {
        const res = await fetch(
          `/api/map?contestId=${encodeURIComponent(requested)}`,
        );
        if (!res.ok) {
          setError("Map query failed.");
          return;
        }
        const payload = (await res.json()) as MapPayload;
        if (payload.contestId !== requested) return;
        setMapData(payload);
        setError(null);
      })();
    });
  }, [contestId, mode, metric]);

  const features =
    mode === "demographics" ? (demoData?.features ?? null) : (mapData?.features ?? null);
  const wardBoundaries =
    mode === "demographics" ? null : (mapData?.wardBoundaries ?? null);
  const legend = mode === "demographics" ? null : (mapData?.legend ?? null);
  const geographyLabel =
    mode === "demographics"
      ? "census tracts"
      : mapData?.geography === "precinct"
        ? "precincts"
        : "wards";
  const councilCitywide = mode === "council" && ward == null;

  const election = useMemo(
    () => elections.find((e) => e.id === electionId) ?? null,
    [elections, electionId],
  );

  const wardOptions = useMemo(() => {
    if (!election) return [];
    return Object.keys(election.councilWards)
      .map(Number)
      .sort((a, b) => a - b);
  }, [election]);

  // Drop a stale ward if it isn't on this election's council slate.
  useEffect(() => {
    if (ward == null || !wardOptions.length) return;
    if (!wardOptions.includes(ward)) setWard(null);
  }, [wardOptions, ward]);

  const enter = () => {
    setEntered(true);
    setPanelOpen(true);
  };

  const selectMode = (next: AtlasMode) => {
    setMode(next);
    if (next === "council") setWard(null);
  };

  useEffect(() => {
    if (entered || !features?.features?.length) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") enter();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [entered, features]);

  return (
    <div
      className={`atlas-shell ${entered ? "is-entered" : ""} ${panelOpen ? "is-panel-open" : "is-panel-collapsed"}`}
    >
      <div
        className="atlas-map-plane"
        onPointerDownCapture={!entered ? enter : undefined}
      >
        <ElectionMap
          features={features}
          wardBoundaries={wardBoundaries}
          mode={mode === "demographics" ? "demographics" : "election"}
        />
        {entered && pending && (
          <div className="atlas-map-loading" role="status" aria-live="polite">
            <span className="atlas-loading-spinner" aria-hidden />
            <span>Updating map…</span>
          </div>
        )}
      </div>

      <header className="atlas-hero-overlay">
        <div className="atlas-hero-copy">
          <p className="atlas-brand">Chicago Election Atlas</p>
          <h1>Precinct-level results for mayor and council.</h1>
          <p className="atlas-lede">
            2015, 2019, and 2023 municipal generals and runoffs — plus ACS
            demographics on a dark, mobile-ready map.
          </p>
          <div className="atlas-cta-row">
            <button
              type="button"
              className="atlas-cta"
              onClick={enter}
              onPointerUp={(e) => {
                e.stopPropagation();
                enter();
              }}
            >
              Explore the map
            </button>
            <span className="atlas-source-chip">
              {backend === "sample" ? "Sample preview data" : "Precinct returns · live"}
            </span>
          </div>
        </div>
      </header>

      {entered && (
        <button
          type="button"
          className="atlas-panel-toggle"
          aria-expanded={panelOpen}
          onClick={() => setPanelOpen((v) => !v)}
        >
          {panelOpen ? "Hide controls" : "Show controls"}
        </button>
      )}

      <aside className="atlas-panel" aria-hidden={!entered || !panelOpen}>
        <div className="atlas-panel-handle" aria-hidden />
        <header className="atlas-panel-head">
          <h2>Explore</h2>
          <p>
            Tap a precinct for the winner. Council starts citywide — choose a
            ward to zoom into that race.
          </p>
        </header>

        <div className="atlas-segment" role="tablist" aria-label="Atlas mode">
          {(
            [
              ["mayor", "Mayor"],
              ["council", "Council"],
              ["demographics", "Demographics"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={mode === id}
              className={mode === id ? "is-active" : ""}
              onClick={() => selectMode(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {mode !== "demographics" ? (
          <>
            <label className="atlas-field">
              <span>Election</span>
              <select
                value={electionId}
                onChange={(e) => setElectionId(e.target.value)}
              >
                {elections.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.label}
                  </option>
                ))}
              </select>
            </label>

            {mode === "council" && (
              <label className="atlas-field">
                <span>Ward</span>
                <select
                  value={ward == null ? "" : String(ward)}
                  onChange={(e) =>
                    setWard(e.target.value === "" ? null : Number(e.target.value))
                  }
                >
                  <option value="">All wards</option>
                  {wardOptions.map((w) => (
                    <option key={w} value={w}>
                      Ward {w}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {contests.length > 1 && (
              <label className="atlas-field">
                <span>Contest</span>
                <select
                  value={contestId}
                  onChange={(e) => setContestId(e.target.value)}
                >
                  {contests.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </>
        ) : (
          <label className="atlas-field">
            <span>ACS metric</span>
            <select
              value={metric}
              onChange={(e) => setMetric(e.target.value as DemographicMetric)}
            >
              {DEMO_METRICS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
        )}

        {error && <p className="atlas-error">{error}</p>}

        {(pending || (mode !== "demographics" && !mapData && !error) || (mode === "demographics" && !demoData && !error)) && (
          <div className="atlas-loading" role="status" aria-live="polite">
            <span className="atlas-loading-spinner" aria-hidden />
            <p>Loading {geographyLabel}…</p>
          </div>
        )}

        {mode !== "demographics" && mapData && !pending && (
          <div className="atlas-summary">
            <h3>
              {mode === "council"
                ? councilCitywide
                  ? "Citywide council"
                  : `Ward ${ward}`
                : "Citywide"}
            </h3>
            <p className="atlas-muted">
              {mapData.summary.totalBallots.toLocaleString()} ballots
              {mapData.summary.totalRegistered
                ? ` · ${((mapData.summary.totalBallots / mapData.summary.totalRegistered) * 100).toFixed(1)}% turnout`
                : ""}
              {` · ${mapData.features.features.length.toLocaleString()} ${geographyLabel}`}
            </p>
            {councilCitywide && (
              <p className="atlas-note">
                Colored by each ward’s race winner. Choose a ward for the full
                ballot.
              </p>
            )}
            <ol className="atlas-results">
              {mapData.summary.citywide.slice(0, councilCitywide ? 12 : 8).map((c) => (
                <li key={c.name}>
                  <span>{c.name}</span>
                  <strong>{(c.share * 100).toFixed(1)}%</strong>
                </li>
              ))}
            </ol>
          </div>
        )}

        {mode === "demographics" && demoData && (
          <div className="atlas-summary">
            <h3>Range</h3>
            <p className="atlas-muted">
              {formatRange(metric, demoData.range.min)} –{" "}
              {formatRange(metric, demoData.range.max)}
            </p>
            {demoData.source === "sample" && (
              <p className="atlas-note">
                Showing sample ward proxies until live ACS tracts are available.
              </p>
            )}
          </div>
        )}

        {legend && !councilCitywide && (
          <div className="atlas-legend">
            <h3>Winner</h3>
            <ul>
              {legend.map((item) => (
                <li key={item.name}>
                  <i style={{ background: item.color }} />
                  <span>{item.name}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <footer className="atlas-foot">
          <p>
            {mode === "demographics"
              ? "U.S. Census ACS 5-year estimates · Chicago tracts"
              : `Chicago Board of Elections · ${geographyLabel} with ward boundaries`}
          </p>
        </footer>
      </aside>
    </div>
  );
}

function formatRange(metric: DemographicMetric, value: number): string {
  if (metric.startsWith("pct")) return `${(value * 100).toFixed(1)}%`;
  if (metric === "medianIncome") return `$${Math.round(value).toLocaleString()}`;
  if (metric === "medianAge") return value.toFixed(1);
  return Math.round(value).toLocaleString();
}
