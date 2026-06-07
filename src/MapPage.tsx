import { useEffect, useRef, useState } from "react";
import { MapPin, X } from "lucide-react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { getGalleryData } from "./lib/supabase";
import { useSeo } from "./lib/seo";
import { Header } from "./components/Header";
import { SmartImage } from "./components/SmartImage";
import type { Photo } from "./types";

// Free, keyless vector basemap (OpenStreetMap data). Positron is light + minimal,
// the closest fit to the site's editorial style; we warm a couple of its colours
// after load to harmonise with the paper palette.
const STYLE_URL = "https://tiles.openfreemap.org/styles/positron";

// Locations where no photo carried GPS get a hand-set fallback so they still pin.
const LOCATION_FALLBACK_COORDS: Record<string, [number, number]> = {
  "North Head": [151.296, -33.824], // [lon, lat]
};

const TEAL = "#496d70"; // --sea
const INK = "#201d19"; // --ink
const FOAM = "#f8f6f0"; // --foam
const PAPER = "#f3eee5"; // --paper

// Interaction tuning.
const EASE_MS = 550; // snappier than MapLibre's ~1s default
const LABEL_MINZOOM = 10; // basemap settlement labels only appear when zoomed in near a photo area
const CLUSTER_RADIUS = 55; // px; photo-proximity clustering
const CLUSTER_MAXZOOM = 14; // beyond this, every photo shows individually

type LocationProps = { location: string; count: number; imageUrl: string };
type PhotoProps = { location: string; title: string; imageUrl: string };
type SelectedPhoto = { location: string; title: string; imageUrl: string };

// One GeoJSON point per location (centroid of its photos), for the clustered
// overview bubbles + labels.
function buildLocationFeatures(photos: Photo[]): GeoJSON.Feature<GeoJSON.Point, LocationProps>[] {
  const groups = new Map<string, Photo[]>();
  for (const photo of photos) {
    if (!photo.location || photo.location === "Unsorted") continue;
    const list = groups.get(photo.location);
    if (list) list.push(photo);
    else groups.set(photo.location, [photo]);
  }
  const features: GeoJSON.Feature<GeoJSON.Point, LocationProps>[] = [];
  for (const [location, list] of groups) {
    const located = list.filter((p) => p.latitude != null && p.longitude != null);
    let lat: number;
    let lon: number;
    if (located.length) {
      lat = located.reduce((s, p) => s + (p.latitude as number), 0) / located.length;
      lon = located.reduce((s, p) => s + (p.longitude as number), 0) / located.length;
    } else if (LOCATION_FALLBACK_COORDS[location]) {
      [lon, lat] = LOCATION_FALLBACK_COORDS[location];
    } else {
      continue;
    }
    const sample = located[0] ?? list[0];
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lon, lat] },
      properties: { location, count: list.length, imageUrl: sample.imageUrl },
    });
  }
  return features;
}

// One GeoJSON point per photo (exact coords), for the close-up pins.
function buildPhotoFeatures(photos: Photo[]): GeoJSON.Feature<GeoJSON.Point, PhotoProps>[] {
  const features: GeoJSON.Feature<GeoJSON.Point, PhotoProps>[] = [];
  for (const p of photos) {
    if (!p.location || p.location === "Unsorted") continue;
    if (p.latitude == null || p.longitude == null) continue;
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [p.longitude, p.latitude] },
      properties: { location: p.location, title: p.title, imageUrl: p.imageUrl },
    });
  }
  return features;
}

export default function MapPage({ onNavigate }: { onNavigate: (route: string) => void }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const [stats, setStats] = useState({ places: 0, photos: 0 });
  const [selected, setSelected] = useState<SelectedPhoto | null>(null);

  useSeo("Photo Map — Sam Duckworth Photography", {
    description: "Explore where Sam Duckworth's aerial and landscape photographs were captured across Australia and beyond.",
    path: "/map",
  });

  function openLocation(name: string) {
    window.history.pushState({}, "", `/?location=${encodeURIComponent(name)}`);
    onNavigate("/");
  }
  const openRef = useRef(openLocation);
  openRef.current = openLocation;

  // Esc closes the photo lightbox.
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSelected(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  useEffect(() => {
    let cancelled = false;
    let map: maplibregl.Map | undefined;

    getGalleryData().then((data) => {
      if (cancelled || !containerRef.current) return;
      const locationFeatures = buildLocationFeatures(data.photos);
      const photoFeatures = buildPhotoFeatures(data.photos);
      setStats({
        places: locationFeatures.length,
        photos: locationFeatures.reduce((s, f) => s + f.properties.count, 0),
      });

      map = new maplibregl.Map({
        container: containerRef.current,
        style: STYLE_URL,
        center: [80, 5],
        zoom: 1.4,
        attributionControl: { compact: true },
        dragRotate: false,
        pitchWithRotate: false,
        renderWorldCopies: false, // no wrapped/repeated globe on first load
      });
      mapRef.current = map;
      map.touchZoomRotate.disableRotation();
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");

      map.on("load", () => {
        if (!map) return;

        // Warm the basemap toward the paper palette (best-effort).
        try { map.setPaintProperty("background", "background-color", PAPER); } catch { /* ignore */ }
        try { map.setPaintProperty("water", "fill-color", "#dde6e5"); } catch { /* ignore */ }

        // Declutter: hide the basemap's settlement (city/town/suburb) labels until
        // you're zoomed in near a photo area. Country/region labels stay for context.
        for (const layer of map.getStyle().layers ?? []) {
          if (layer.type === "symbol" && /place/.test(layer.id) && !/country|continent|state/.test(layer.id)) {
            try { map.setLayerZoomRange(layer.id, LABEL_MINZOOM, 24); } catch { /* ignore */ }
          }
        }

        // Faint location-name labels for context at low zoom only (no interaction).
        map.addSource("locations", {
          type: "geojson",
          data: { type: "FeatureCollection", features: locationFeatures },
        });
        map.addLayer({
          id: "location-label",
          type: "symbol",
          source: "locations",
          maxzoom: 6.5,
          layout: {
            "text-field": ["get", "location"],
            "text-font": ["Noto Sans Regular"],
            "text-size": 11,
            "text-transform": "uppercase",
            "text-letter-spacing": 0.08,
          },
          paint: { "text-color": INK, "text-halo-color": PAPER, "text-halo-width": 1.4, "text-opacity": 0.8 },
        });

        // ---- Photos clustered BY PROXIMITY (not by location centroid) ----
        // This is the key to a consistent drill everywhere: a spread country like
        // Italy becomes several real clusters (Amalfi, Rome, Venice…), each centred
        // on actual photos — so zooming in never lands on an empty centroid.
        map.addSource("photos", {
          type: "geojson",
          data: { type: "FeatureCollection", features: photoFeatures },
          cluster: true,
          clusterRadius: CLUSTER_RADIUS,
          clusterMaxZoom: CLUSTER_MAXZOOM,
        });
        map.addLayer({
          id: "clusters",
          type: "circle",
          source: "photos",
          filter: ["has", "point_count"],
          paint: {
            "circle-color": PAPER,
            "circle-opacity": 0.92,
            "circle-stroke-color": TEAL,
            "circle-stroke-width": 2,
            "circle-radius": ["interpolate", ["linear"], ["get", "point_count"], 2, 12, 25, 18, 120, 26],
          },
        });
        map.addLayer({
          id: "cluster-count",
          type: "symbol",
          source: "photos",
          filter: ["has", "point_count"],
          layout: { "text-field": ["get", "point_count_abbreviated"], "text-font": ["Noto Sans Regular"], "text-size": 12 },
          paint: { "text-color": INK },
        });
        map.addLayer({
          id: "photo",
          type: "circle",
          source: "photos",
          filter: ["!", ["has", "point_count"]],
          paint: {
            "circle-color": TEAL,
            "circle-opacity": 0.9,
            "circle-stroke-color": FOAM,
            "circle-stroke-width": 1.2,
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 4, 14, 7],
          },
        });

        // Initial view. Priority: a specific photo's coords (?lat&lng, from the
        // gallery "View on map") -> a focused location (?focus) -> the whole extent.
        let focus: string | null = null;
        let lat = NaN;
        let lng = NaN;
        try {
          const sp = new URLSearchParams(window.location.search);
          focus = sp.get("focus");
          lat = Number.parseFloat(sp.get("lat") ?? "");
          lng = Number.parseFloat(sp.get("lng") ?? "");
        } catch { /* ignore */ }

        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          map.jumpTo({ center: [lng, lat], zoom: 15 });
        } else {
          const framePts = focus ? photoFeatures.filter((f) => f.properties.location === focus) : photoFeatures;
          const bounds = new maplibregl.LngLatBounds();
          for (const f of (framePts.length ? framePts : photoFeatures)) {
            bounds.extend(f.geometry.coordinates as [number, number]);
          }
          if (!bounds.isEmpty()) {
            map.fitBounds(bounds, { padding: { top: 66, bottom: 30, left: 26, right: 26 }, maxZoom: focus ? 13 : 6.5, duration: 0 });
          }
        }
        setReady(true);

        // Click a cluster: zoom to exactly where it splits, centred on its own
        // photos (proximity clustering guarantees the children stay in view).
        map.on("click", "clusters", (e) => {
          const feat = e.features?.[0];
          const clusterId = feat?.properties?.cluster_id;
          if (clusterId == null) return;
          const src = map!.getSource("photos") as maplibregl.GeoJSONSource;
          src.getClusterExpansionZoom(clusterId).then((zoom) => {
            map!.easeTo({
              center: (feat!.geometry as GeoJSON.Point).coordinates as [number, number],
              zoom: zoom + 0.5,
              duration: EASE_MS,
            });
          }).catch(() => { /* ignore */ });
        });

        // Click a photo: open it in a lightbox (with a button to its gallery).
        map.on("click", "photo", (e) => {
          const p = e.features?.[0]?.properties as PhotoProps | undefined;
          if (p) setSelected({ location: p.location, title: p.title, imageUrl: p.imageUrl });
        });

        // Hover preview on individual photos.
        const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 14, className: "map-pop-wrap" });
        const showPhotoPopup = (e: maplibregl.MapLayerMouseEvent) => {
          const f = e.features?.[0];
          if (!f) return;
          map!.getCanvas().style.cursor = "pointer";
          const p = f.properties as PhotoProps;
          popup
            .setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number])
            .setHTML(
              `<div class="map-pop"><span class="map-pop-thumb"><img src="${p.imageUrl}" alt=""/></span>` +
              `<span class="map-pop-meta"><strong>${p.title}</strong><small>${p.location}</small></span></div>`,
            )
            .addTo(map!);
        };
        const hidePopup = () => { map!.getCanvas().style.cursor = ""; popup.remove(); };

        map.on("mouseenter", "photo", showPhotoPopup);
        map.on("mousemove", "photo", showPhotoPopup);
        map.on("mouseleave", "photo", hidePopup);
        map.on("mouseenter", "clusters", () => { map!.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", "clusters", () => { map!.getCanvas().style.cursor = ""; });
      });
    });

    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  return (
    <main className="map-shell">
      <Header isScrolled onNavigate={onNavigate} />
      <section className="map-stage" aria-label="Map of photo locations">
        <div className="map-intro">
          <p className="eyebrow">Where I have shot</p>
          {stats.places ? (
            <h1>
              {stats.places} place{stats.places === 1 ? "" : "s"} · {stats.photos} photo
              {stats.photos === 1 ? "" : "s"}
            </h1>
          ) : null}
          <p className="map-hint">Scroll to zoom · drag to pan · zoom in to a place, then open any photo</p>
        </div>
        <div className={`map-gl${ready ? " is-ready" : ""}`} ref={containerRef} />
        {!ready ? (
          <div className="map-loading-screen">
            <span className="map-loading-pulse" aria-hidden="true" />
            <p>Mapping the archive</p>
          </div>
        ) : null}
      </section>

      {selected ? (
        <div className="lightbox" role="dialog" aria-modal="true" aria-label={selected.title}>
          <button className="lightbox-backdrop" onClick={() => setSelected(null)} type="button" aria-label="Close" />
          <section className="lightbox-panel is-map">
            <button className="icon-button close-button" onClick={() => setSelected(null)} type="button" aria-label="Close">
              <X size={18} aria-hidden="true" />
            </button>
            <div className="lightbox-image">
              <SmartImage src={selected.imageUrl} alt={`${selected.title}, ${selected.location}`} />
            </div>
            <aside className="lightbox-copy">
              <span className="lightbox-location">
                <MapPin size={13} aria-hidden="true" />
                {selected.location}
              </span>
              <h2>{selected.title}</h2>
              <button className="solid-button" onClick={() => openLocation(selected.location)} type="button">
                View {selected.location} gallery
              </button>
            </aside>
          </section>
        </div>
      ) : null}
    </main>
  );
}
