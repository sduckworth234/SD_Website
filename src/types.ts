export type PhotoKind = "Drone" | "Landscape" | "Travel";

export type LocationBucket = string;

export type GalleryLocation = {
  id: string;
  slug: string;
  name: string;
  region: string;
  description?: string | null;
  sortOrder: number;
};

export type Photo = {
  id: string;
  title: string;
  slug: string;
  description?: string | null;
  location: LocationBucket;
  locationId?: string | null;
  kind: PhotoKind;
  year: string;
  aspect: "portrait" | "landscape" | "square" | "wide";
  featured?: boolean;
  published?: boolean;
  imageUrl: string;
  storagePath?: string;
  sortOrder?: number;
  // Drone flight height in metres above the takeoff point (DJI RelativeAltitude).
  // Null/absent for non-drone photos.
  relativeAltitude?: number | null;
};
