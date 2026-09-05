import JSZip from 'jszip';
import { kml } from '@tmcw/togeojson';
import {
  VisitItem,
  ActivityItem,
  PathItem,
  PlaceItem,
  MyMapsItem,
  DataStatus,
} from '../state/AppState';

export interface ParsedPayload {
  status: DataStatus;
  timeline: {
    visits: VisitItem[];
    activities: ActivityItem[];
    paths: PathItem[];
  };
  places: {
    savedPlaces: PlaceItem[];
    reviews: PlaceItem[];
  };
  myMaps: MyMapsItem[];
}

export type ProgressCallback = (message: string, percent: number) => void;

// Helper to round coordinate to 4 decimal places (~11.1 meter precision)
function roundCoord(val: number): number {
  if (typeof val !== 'number' || isNaN(val)) return 0;
  return Math.round(val * 10000) / 10000;
}

function parseLatLngString(str: any): [number, number] | null {
  if (!str || typeof str !== 'string') return null;
  const parts = str.split(',').map((s: string) => s.replace('°', '').trim());
  if (parts.length === 2) {
    const lat = parseFloat(parts[0]);
    const lng = parseFloat(parts[1]);
    if (!isNaN(lat) && !isNaN(lng)) {
      return [roundCoord(lng), roundCoord(lat)]; // [lng, lat]
    }
  }
  return null;
}

// Distance square helper for RDP simplification
function sqSegDist(p: [number, number], p1: [number, number], p2: [number, number]): number {
  let x = p1[0], y = p1[1];
  let dx = p2[0] - x, dy = p2[1] - y;
  if (dx !== 0 || dy !== 0) {
    let t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) { x = p2[0]; y = p2[1]; }
    else if (t > 0) { x += dx * t; y += dy * t; }
  }
  dx = p[0] - x; dy = p[1] - y;
  return dx * dx + dy * dy;
}

// Ramer-Douglas-Peucker Polyline Simplification
export function simplifyPolyline(points: [number, number][], tolerance = 0.00015): [number, number][] {
  if (!points || points.length <= 2) return points;
  const sqTolerance = tolerance * tolerance;
  let maxSqDist = 0;
  let index = 0;

  for (let i = 1; i < points.length - 1; i++) {
    const sqD = sqSegDist(points[i], points[0], points[points.length - 1]);
    if (sqD > maxSqDist) {
      maxSqDist = sqD;
      index = i;
    }
  }

  if (maxSqDist > sqTolerance) {
    const rec1 = simplifyPolyline(points.slice(0, index + 1), tolerance);
    const rec2 = simplifyPolyline(points.slice(index), tolerance);
    return rec1.slice(0, rec1.length - 1).concat(rec2);
  } else {
    return [points[0], points[points.length - 1]];
  }
}

// Compute Axis-Aligned Bounding Box [minLng, minLat, maxLng, maxLat]
export function computeBBox(points: [number, number][]): [number, number, number, number] | undefined {
  if (!points || points.length === 0) return undefined;
  let minLng = points[0][0], maxLng = points[0][0];
  let minLat = points[0][1], maxLat = points[0][1];
  for (let i = 1; i < points.length; i++) {
    const pt = points[i];
    if (!pt) continue;
    const lng = pt[0];
    const lat = pt[1];
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return [minLng, minLat, maxLng, maxLat];
}

// Parse Timeline JSON object
export function parseTimelineJSON(data: any): { visits: VisitItem[]; activities: ActivityItem[]; paths: PathItem[] } {
  const visits: VisitItem[] = [];
  const activities: ActivityItem[] = [];
  const paths: PathItem[] = [];

  if (data.semanticSegments && Array.isArray(data.semanticSegments)) {
    for (const seg of data.semanticSegments) {
      const startTime = seg.startTime || '';
      const endTime = seg.endTime || '';

      if (seg.visit) {
        const v = seg.visit;
        const top = v.topCandidate || {};
        const loc = top.placeLocation || {};
        let coords: [number, number] | null = null;

        if (loc.latLng) {
          coords = parseLatLngString(loc.latLng);
        } else if (loc.latitudeE7 && loc.longitudeE7) {
          coords = [roundCoord(loc.longitudeE7 / 1e7), roundCoord(loc.latitudeE7 / 1e7)];
        }

        if (coords && (top.probability === undefined || top.probability >= 0.1)) {
          visits.push({
            type: 'visit',
            name: top.location?.name || top.semanticType || 'Visited Location',
            address: top.location?.address || '',
            placeId: top.placeId || '',
            coordinates: coords,
            startTime,
            endTime,
            probability: top.probability || 1.0,
          });
        }
      }

      if (seg.activity) {
        const act = seg.activity;
        const top = act.topCandidate || {};
        const dist = act.distanceMeters || 0;
        const activityType = top.type || 'UNKNOWN';

        const startCoords = act.start?.latLng ? parseLatLngString(act.start.latLng) : null;
        const endCoords = act.end?.latLng ? parseLatLngString(act.end.latLng) : null;

        activities.push({
          type: 'activity',
          activityType,
          distanceMeters: Math.round(dist),
          startTime,
          endTime,
          startCoords,
          endCoords,
        });
      }

      if (seg.timelinePath && Array.isArray(seg.timelinePath)) {
        const rawLine: [number, number][] = [];
        for (let i = 0; i < seg.timelinePath.length; i++) {
          const pt = parseLatLngString(seg.timelinePath[i].point);
          if (pt) rawLine.push(pt);
        }

        const simplifiedLine = simplifyPolyline(rawLine, 0.00015);

        if (simplifiedLine && simplifiedLine.length > 1) {
          const bbox = computeBBox(simplifiedLine);
          const pathItem: PathItem = {
            type: 'path',
            startTime,
            endTime,
            bbox,
            coordinates: simplifiedLine,
          };

          if (simplifiedLine.length > 2) {
            const low = simplifyPolyline(simplifiedLine, 0.02);
            const med = simplifyPolyline(simplifiedLine, 0.002);
            pathItem.lods = {
              low: low && low.length > 1 ? low : simplifiedLine,
              med: med && med.length > 1 ? med : simplifiedLine,
            };
          }

          paths.push(pathItem);
        }
      }
    }
  }

  if (data.locations && Array.isArray(data.locations)) {
    const rawPoints: [number, number][] = [];
    for (let i = 0; i < data.locations.length; i += 3) {
      const loc = data.locations[i];
      rawPoints.push([roundCoord(loc.longitudeE7 / 1e7), roundCoord(loc.latitudeE7 / 1e7)]);
    }

    const simplified = simplifyPolyline(rawPoints, 0.00015);

    if (simplified && simplified.length > 1) {
      const bbox = computeBBox(simplified);
      const pathItem: PathItem = {
        type: 'path',
        startTime: data.locations[0].timestamp || '',
        endTime: data.locations[data.locations.length - 1].timestamp || '',
        bbox,
        coordinates: simplified,
      };

      if (simplified.length > 2) {
        const low = simplifyPolyline(simplified, 0.02);
        const med = simplifyPolyline(simplified, 0.002);
        pathItem.lods = {
          low: low && low.length > 1 ? low : simplified,
          med: med && med.length > 1 ? med : simplified,
        };
      }

      paths.push(pathItem);
    }
  }

  return { visits, activities, paths };
}

// Parse Saved Places & Reviews JSON
export function parsePlacesJSON(data: any, isReviews: boolean = false): { savedPlaces: PlaceItem[]; reviews: PlaceItem[] } {
  const savedPlaces: PlaceItem[] = [];
  const reviews: PlaceItem[] = [];

  if (data.type === 'FeatureCollection' && Array.isArray(data.features)) {
    for (const feat of data.features) {
      const coords = feat.geometry?.coordinates;
      const props = feat.properties || {};

      if (coords && Array.isArray(coords) && coords.length >= 2) {
        const [lng, lat] = coords;
        const placeLocation = props.location || {};

        if (isReviews || props.review || props.rating) {
          reviews.push({
            name: placeLocation.name || props.name || 'Reviewed Place',
            address: placeLocation.address || props.address || '',
            countryCode: placeLocation.country_code || '',
            coordinates: [roundCoord(lng), roundCoord(lat)],
            date: props.date || props.published || null,
            url: props.google_maps_url || props.url || null,
            rating: typeof props.rating === 'number' ? props.rating : 5,
            reviewText: props.review || props.comment || null,
          });
        } else {
          savedPlaces.push({
            name: placeLocation.name || props.title || props.name || 'Saved Place',
            address: placeLocation.address || props.address || '',
            countryCode: placeLocation.country_code || '',
            coordinates: [roundCoord(lng), roundCoord(lat)],
            date: props.date || null,
            url: props.google_maps_url || props.url || null,
            rating: null,
            reviewText: null,
          });
        }
      }
    }
  }

  return { savedPlaces, reviews };
}

// Parse KML text using native browser DOMParser
export function parseKMLString(kmlText: string, mapName: string): MyMapsItem | null {
  try {
    const dom = new window.DOMParser().parseFromString(kmlText, 'text/xml');
    const geojson = kml(dom);

    if (geojson && geojson.features) {
      const roundedFeatures = geojson.features.map((f: any) => {
        if (f.geometry?.type === 'Point' && f.geometry.coordinates) {
          f.geometry.coordinates = [roundCoord(f.geometry.coordinates[0]), roundCoord(f.geometry.coordinates[1])];
        } else if (f.geometry?.type === 'LineString' && f.geometry.coordinates) {
          const rawLine = f.geometry.coordinates.map((c: any) => [roundCoord(c[0]), roundCoord(c[1])]);
          const simplified = simplifyPolyline(rawLine, 0.00015);
          f.geometry.coordinates = simplified;
          f.bbox = computeBBox(simplified);
        }
        return f;
      });

      return {
        mapName: mapName.replace(/\.(kmz|kml)$/i, ''),
        features: roundedFeatures,
      };
    }
  } catch (err) {
    console.error(`Failed to parse KML ${mapName}:`, err);
  }
  return null;
}

// Master File Parser & Ingestion Router
export async function parseUploadedFile(
  file: File,
  existingData: ParsedPayload,
  onProgress?: ProgressCallback
): Promise<ParsedPayload> {
  const result: ParsedPayload = {
    status: { ...existingData.status, counts: { ...existingData.status.counts } },
    timeline: {
      visits: [...existingData.timeline.visits],
      activities: [...existingData.timeline.activities],
      paths: [...existingData.timeline.paths],
    },
    places: {
      savedPlaces: [...existingData.places.savedPlaces],
      reviews: [...existingData.places.reviews],
    },
    myMaps: [...existingData.myMaps],
  };

  const filename = file.name.toLowerCase();

  // 1. Handle ZIP Archives (Google Takeout)
  if (filename.endsWith('.zip')) {
    onProgress?.('Decompressing Google Takeout archive...', 15);
    const zip = await JSZip.loadAsync(file);
    const entries = Object.keys(zip.files);
    const totalEntries = entries.length;
    let processed = 0;

    for (const entryName of entries) {
      processed++;
      const fileEntry = zip.files[entryName];
      if (fileEntry.dir) continue;

      const lowerName = entryName.toLowerCase();

      if (lowerName.endsWith('.json')) {
        try {
          const content = await fileEntry.async('string');
          const json = JSON.parse(content);

          if (json.semanticSegments || json.locations || lowerName.includes('timeline') || lowerName.includes('location history')) {
            onProgress?.(`Ingesting Timeline data (${entryName})...`, 30 + Math.floor((processed / totalEntries) * 50));
            const tData = parseTimelineJSON(json);
            result.timeline.visits.push(...tData.visits);
            result.timeline.activities.push(...tData.activities);
            result.timeline.paths.push(...tData.paths);
            result.status.hasTimeline = true;
            result.status.counts.timelineFiles++;
          } else if (json.type === 'FeatureCollection' || lowerName.includes('saved places') || lowerName.includes('reviews')) {
            onProgress?.(`Ingesting Places (${entryName})...`, 30 + Math.floor((processed / totalEntries) * 50));
            const isReviews = lowerName.includes('reviews');
            const pData = parsePlacesJSON(json, isReviews);
            result.places.savedPlaces.push(...pData.savedPlaces);
            result.places.reviews.push(...pData.reviews);
            if (pData.savedPlaces.length > 0) result.status.hasSavedPlaces = true;
            if (pData.reviews.length > 0) result.status.hasReviews = true;
            result.status.counts.placesFiles++;
          }
        } catch (e) {}
      } else if (lowerName.endsWith('.kmz')) {
        try {
          const kmzData = await fileEntry.async('arraybuffer');
          const innerZip = await JSZip.loadAsync(kmzData);
          const kmlFile = Object.values(innerZip.files).find(f => f.name.toLowerCase().endsWith('.kml'));
          if (kmlFile) {
            const kmlText = await kmlFile.async('string');
            const mapObj = parseKMLString(kmlText, entryName.split('/').pop() || 'My Map');
            if (mapObj) {
              result.myMaps.push(mapObj);
              result.status.hasMyMaps = true;
              result.status.counts.myMapsFiles++;
            }
          }
        } catch (e) {}
      } else if (lowerName.endsWith('.kml')) {
        try {
          const kmlText = await fileEntry.async('string');
          const mapObj = parseKMLString(kmlText, entryName.split('/').pop() || 'My Map');
          if (mapObj) {
            result.myMaps.push(mapObj);
            result.status.hasMyMaps = true;
            result.status.counts.myMapsFiles++;
          }
        } catch (e) {}
      }
    }
  }

  // 2. Handle Standalone KMZ
  else if (filename.endsWith('.kmz')) {
    onProgress?.('Extracting KMZ archive...', 30);
    const kmzZip = await JSZip.loadAsync(file);
    const kmlFile = Object.values(kmzZip.files).find(f => f.name.toLowerCase().endsWith('.kml'));
    if (kmlFile) {
      const kmlText = await kmlFile.async('string');
      onProgress?.('Parsing KML vector features...', 70);
      const mapObj = parseKMLString(kmlText, file.name);
      if (mapObj) {
        result.myMaps.push(mapObj);
        result.status.hasMyMaps = true;
        result.status.counts.myMapsFiles++;
      }
    }
  }

  // 3. Handle Standalone KML
  else if (filename.endsWith('.kml')) {
    onProgress?.('Reading KML file...', 40);
    const kmlText = await file.text();
    onProgress?.('Parsing KML vector features...', 70);
    const mapObj = parseKMLString(kmlText, file.name);
    if (mapObj) {
      result.myMaps.push(mapObj);
      result.status.hasMyMaps = true;
      result.status.counts.myMapsFiles++;
    }
  }

  // 4. Handle Standalone JSON
  else if (filename.endsWith('.json')) {
    onProgress?.('Parsing JSON dataset...', 40);
    const text = await file.text();
    const json = JSON.parse(text);

    if (json.semanticSegments || json.locations || filename.includes('timeline')) {
      onProgress?.('Calculating LOD pyramids and bounding boxes...', 70);
      const tData = parseTimelineJSON(json);
      result.timeline.visits.push(...tData.visits);
      result.timeline.activities.push(...tData.activities);
      result.timeline.paths.push(...tData.paths);
      result.status.hasTimeline = true;
      result.status.counts.timelineFiles++;
    } else if (json.type === 'FeatureCollection' || filename.includes('places') || filename.includes('saved') || filename.includes('reviews')) {
      onProgress?.('Extracting Saved Places...', 70);
      const isReviews = filename.includes('reviews');
      const pData = parsePlacesJSON(json, isReviews);
      result.places.savedPlaces.push(...pData.savedPlaces);
      result.places.reviews.push(...pData.reviews);
      if (pData.savedPlaces.length > 0) result.status.hasSavedPlaces = true;
      if (pData.reviews.length > 0) result.status.hasReviews = true;
      result.status.counts.placesFiles++;
    }
  }

  onProgress?.('Finalizing and saving dataset...', 95);
  return result;
}
