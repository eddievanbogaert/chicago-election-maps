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
  mode: "election" | "demographics";
};

const CHICAGO: [number, number] = [-87.65, 41.84];
const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

function fillColorExpr(mode: "election" | "demographics"): unknown {
  return [
    "case",
    ["==", ["get", "inactive"], true],
    "#cfd6db",
    mode === "demographics"
      ? ["coalesce", ["get", "fill"], "#9aa8b2"]
      : ["coalesce", ["get", "winnerColor"], "#9aa8b2"],
  ];
}

export function ElectionMap({ features, mode }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const popupRef = useRef<Popup | null>(null);
  const featuresRef = useRef(features);
  const modeRef = useRef(mode);
  featuresRef.current = features;
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
              "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
            ],
            tileSize: 256,
            attribution: "Tiles © Esri",
          },
        },
        layers: [
          {
            id: "background",
            type: "background",
            paint: { "background-color": "#d5e0e7" },
          },
          {
            id: "basemap",
            type: "raster",
            source: "basemap",
            paint: { "raster-opacity": 0.55 },
          },
        ],
      },
      center: CHICAGO,
      zoom: 9.6,
      minZoom: 8.5,
      maxZoom: 14,
      attributionControl: {},
    });

    map.addControl(new NavigationControl({ visualizePitch: false }), "bottom-right");
    popupRef.current = new Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 12,
      className: "atlas-popup",
    });

    const syncLayers = () => {
      if (!map.getSource("atlas")) {
        map.addSource("atlas", {
          type: "geojson",
          data: featuresRef.current ?? EMPTY,
        });
        map.addLayer({
          id: "atlas-fill",
          type: "fill",
          source: "atlas",
          paint: {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            "fill-color": fillColorExpr(modeRef.current) as any,
            "fill-opacity": 0.88,
          },
        });
        map.addLayer({
          id: "atlas-line",
          type: "line",
          source: "atlas",
          paint: {
            "line-color": "#0b2a3a",
            "line-width": [
              "interpolate",
              ["linear"],
              ["zoom"],
              9,
              0.6,
              13,
              1.6,
            ],
            "line-opacity": 0.75,
          },
        });
      } else {
        const source = map.getSource("atlas") as GeoJSONSource;
        source.setData(featuresRef.current ?? EMPTY);
        map.setPaintProperty(
          "atlas-fill",
          "fill-color",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          fillColorExpr(modeRef.current) as any,
        );
      }
    };

    map.on("load", syncLayers);

    map.on("mousemove", "atlas-fill", (e) => {
      map.getCanvas().style.cursor = "pointer";
      const f = e.features?.[0];
      if (!f || !popupRef.current) return;
      const p = f.properties ?? {};
      if (p.inactive === true || p.inactive === "true") {
        popupRef.current.remove();
        return;
      }
      let html = "";
      if (modeRef.current === "demographics") {
        html = `<strong>${p.name ?? `Ward ${p.ward}`}</strong><br/>${formatMetric(p)}`;
      } else {
        const share = Number(p.winnerShare || 0);
        html = `<strong>Ward ${p.ward}</strong><br/>${
          p.winner
            ? `${p.winner}<br/>${(share * 100).toFixed(1)}% · ${Number(p.ballots).toLocaleString()} ballots`
            : "No votes"
        }`;
      }
      popupRef.current.setLngLat(e.lngLat).setHTML(html).addTo(map);
    });
    map.on("mouseleave", "atlas-fill", () => {
      map.getCanvas().style.cursor = "";
      popupRef.current?.remove();
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
      if (map.getLayer("atlas-fill")) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        map.setPaintProperty("atlas-fill", "fill-color", fillColorExpr(mode) as any);
      }
    };
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [features, mode]);

  return <div ref={containerRef} className="atlas-map" aria-label="Chicago election map" />;
}

function formatMetric(p: Record<string, unknown>): string {
  const metric = String(p.metric ?? "");
  const value = Number(p.value ?? 0);
  if (metric.startsWith("pct")) return `${(value * 100).toFixed(1)}%`;
  if (metric === "medianIncome") return `$${Math.round(value).toLocaleString()}`;
  if (metric === "medianAge") return `${value.toFixed(1)} years`;
  return Math.round(value).toLocaleString();
}
