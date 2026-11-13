"use client";

import { useEffect, useRef } from "react";
import {
  Map,
  NavigationControl,
  Popup,
  setWorkerUrl,
  type GeoJSONSource,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

// Next.js bundles break MapLibre's default worker URL resolution.
setWorkerUrl("/maplibre-gl-worker.js");

type Props = {
  features: GeoJSON.FeatureCollection | null;
  wardBoundaries?: GeoJSON.FeatureCollection | null;
  mode: "election" | "demographics";
};

const CHICAGO: [number, number] = [-87.65, 41.84];
const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

function fillColorExpr(mode: "election" | "demographics"): unknown {
  return [
    "case",
    ["==", ["get", "inactive"], true],
    "#1a222e",
    mode === "demographics"
      ? ["coalesce", ["get", "fill"], "#334155"]
      : ["coalesce", ["get", "winnerColor"], "#334155"],
  ];
}

export function ElectionMap({ features, wardBoundaries, mode }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const popupRef = useRef<Popup | null>(null);
  const featuresRef = useRef(features);
  const wardsRef = useRef(wardBoundaries);
  const modeRef = useRef(mode);
  featuresRef.current = features;
  wardsRef.current = wardBoundaries;
  modeRef.current = mode;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          basemap: {
            type: "raster",
            tiles: [
              "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
            ],
            tileSize: 256,
            attribution: "Tiles © Esri",
          },
        },
        layers: [
          {
            id: "background",
            type: "background",
            paint: { "background-color": "#0b0f14" },
          },
          {
            id: "basemap",
            type: "raster",
            source: "basemap",
            paint: { "raster-opacity": 0.72 },
          },
        ],
      },
      center: CHICAGO,
      zoom: 9.55,
      minZoom: 8.2,
      maxZoom: 15,
      attributionControl: {},
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
    });

    map.addControl(
      new NavigationControl({ visualizePitch: false, showCompass: false }),
      "bottom-right",
    );
    popupRef.current = new Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 12,
      className: "atlas-popup",
      maxWidth: "240px",
    });

    const syncLayers = () => {
      if (!map.getSource("atlas")) {
        map.addSource("atlas", {
          type: "geojson",
          data: featuresRef.current ?? EMPTY,
        });
        map.addSource("wards", {
          type: "geojson",
          data: wardsRef.current ?? EMPTY,
        });
        map.addLayer({
          id: "atlas-fill",
          type: "fill",
          source: "atlas",
          paint: {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            "fill-color": fillColorExpr(modeRef.current) as any,
            "fill-opacity": 0.82,
          },
        });
        map.addLayer({
          id: "atlas-line",
          type: "line",
          source: "atlas",
          paint: {
            "line-color": "rgba(226, 232, 240, 0.22)",
            "line-width": [
              "interpolate",
              ["linear"],
              ["zoom"],
              9,
              0.2,
              12,
              0.55,
              14,
              0.9,
            ],
            "line-opacity": 0.85,
          },
        });
        // Ward boundaries sit above precinct fills/lines for clear structure.
        map.addLayer({
          id: "ward-boundaries",
          type: "line",
          source: "wards",
          paint: {
            "line-color": "rgba(248, 250, 252, 0.88)",
            "line-width": [
              "interpolate",
              ["linear"],
              ["zoom"],
              9,
              1.1,
              11,
              1.7,
              13,
              2.4,
            ],
            "line-opacity": 0.95,
          },
        });
        map.addLayer({
          id: "atlas-highlight",
          type: "line",
          source: "atlas",
          paint: {
            "line-color": "#f8fafc",
            "line-width": 2,
            "line-opacity": 0.95,
          },
          filter: ["==", ["get", "id"], ""],
        });
      } else {
        const source = map.getSource("atlas") as GeoJSONSource;
        source.setData(featuresRef.current ?? EMPTY);
        const wards = map.getSource("wards") as GeoJSONSource | undefined;
        wards?.setData(wardsRef.current ?? EMPTY);
        map.setPaintProperty(
          "atlas-fill",
          "fill-color",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          fillColorExpr(modeRef.current) as any,
        );
      }
    };

    const showFeaturePopup = (
      lngLat: { lng: number; lat: number },
      f: GeoJSON.Feature,
    ) => {
      if (!popupRef.current) return;
      const p = (f.properties ?? {}) as Record<string, unknown>;
      if (p.inactive === true || p.inactive === "true") {
        popupRef.current.remove();
        return;
      }
      let html = "";
      if (modeRef.current === "demographics") {
        html = `<strong>${p.name ?? `Ward ${p.ward}`}</strong><br/>${formatMetric(p)}`;
      } else {
        const share = Number(p.winnerShare || 0);
        const pctLabel =
          p.precinct != null && p.precinct !== ""
            ? `Ward ${p.ward} · Pct ${p.precinct}`
            : `Ward ${p.ward}`;
        html = `<strong>${pctLabel}</strong><br/>${
          p.winner
            ? `${p.winner}<br/>${(share * 100).toFixed(1)}% · ${Number(p.ballots).toLocaleString()} ballots`
            : "No votes"
        }`;
      }
      popupRef.current.setLngLat(lngLat).setHTML(html).addTo(map);
      if (map.getLayer("atlas-highlight") && p.id != null) {
        map.setFilter("atlas-highlight", ["==", ["get", "id"], String(p.id)]);
      }
    };

    map.on("load", syncLayers);

    map.on("mousemove", "atlas-fill", (e) => {
      map.getCanvas().style.cursor = "pointer";
      const f = e.features?.[0];
      if (!f) return;
      showFeaturePopup(e.lngLat, f as unknown as GeoJSON.Feature);
    });
    map.on("mouseleave", "atlas-fill", () => {
      map.getCanvas().style.cursor = "";
      popupRef.current?.remove();
      if (map.getLayer("atlas-highlight")) {
        map.setFilter("atlas-highlight", ["==", ["get", "id"], ""]);
      }
    });
    map.on("click", "atlas-fill", (e) => {
      const f = e.features?.[0];
      if (!f) return;
      showFeaturePopup(e.lngLat, f as unknown as GeoJSON.Feature);
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      if (!map.getSource("atlas")) return;
      const source = map.getSource("atlas") as GeoJSONSource;
      source.setData(features ?? EMPTY);
      const wards = map.getSource("wards") as GeoJSONSource | undefined;
      wards?.setData(wardBoundaries ?? EMPTY);
      if (map.getLayer("atlas-fill")) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        map.setPaintProperty("atlas-fill", "fill-color", fillColorExpr(mode) as any);
      }
      // Hide ward outlines on demographics (tracts); show for election maps.
      if (map.getLayer("ward-boundaries")) {
        map.setLayoutProperty(
          "ward-boundaries",
          "visibility",
          mode === "demographics" ? "none" : "visible",
        );
      }
      if (features?.features?.length) {
        const bounds = bboxOf(features);
        if (bounds) {
          map.fitBounds(bounds, {
            padding: { top: 48, bottom: 120, left: 24, right: 24 },
            maxZoom: features.features.length < 80 ? 12.5 : 11.2,
            duration: 650,
          });
        }
      }
    };
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [features, wardBoundaries, mode]);

  return <div ref={containerRef} className="atlas-map" aria-label="Chicago election map" />;
}

function bboxOf(
  fc: GeoJSON.FeatureCollection,
): [[number, number], [number, number]] | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const visit = (coords: unknown): void => {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === "number" && typeof coords[1] === "number") {
      const x = coords[0] as number;
      const y = coords[1] as number;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      return;
    }
    for (const c of coords) visit(c);
  };
  for (const f of fc.features) {
    if (f.geometry) visit((f.geometry as GeoJSON.Geometry & { coordinates?: unknown }).coordinates);
  }
  if (!Number.isFinite(minX)) return null;
  return [
    [minX, minY],
    [maxX, maxY],
  ];
}

function formatMetric(p: Record<string, unknown>): string {
  const metric = String(p.metric ?? "");
  const value = Number(p.value ?? 0);
  if (metric.startsWith("pct")) return `${(value * 100).toFixed(1)}%`;
  if (metric === "medianIncome") return `$${Math.round(value).toLocaleString()}`;
  if (metric === "medianAge") return `${value.toFixed(1)} years`;
  return Math.round(value).toLocaleString();
}
