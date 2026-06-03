export type PhotoKind = "Drone" | "Landscape" | "Travel";

export type LocationBucket =
  | "Palm Beach"
  | "Avalon"
  | "Whale Beach"
  | "Narrabeen"
  | "Manly"
  | "Travels";

export type Photo = {
  id: string;
  title: string;
  location: LocationBucket;
  kind: PhotoKind;
  year: string;
  aspect: "portrait" | "landscape" | "square" | "wide";
  featured?: boolean;
  imageUrl: string;
  storagePath?: string;
};
