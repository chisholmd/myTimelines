import fs from 'fs';
import path from 'path';
import admZip from 'adm-zip';
import { DOMParser } from '@xmldom/xmldom';
import { kml } from '@tmcw/togeojson';

const BASE_RESOURCES_DIR = path.resolve('resources');
const CACHE_DIR = path.join(BASE_RESOURCES_DIR, '.cache');
const CACHE_FILE = path.join(CACHE_DIR, 'parsed_data_v2.json');

// Fast Axis-Aligned Bounding Box [minLng, minLat, maxLng, maxLat]
export function computeBBox(points) {
  if (!points || points.length === 0) return null;
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

// Compute fingerprint of source files to guarantee once-per-file calculations
export function computeSourceFingerprint() {
  const dirs = [
    path.join(BASE_RESOURCES_DIR, 'Timeline'),
    path.join(BASE_RESOURCES_DIR, 'Maps (your places)'),
    path.join(BASE_RESOURCES_DIR, 'My Maps')
  ];

  const fingerprint = {};
  for (const dir of dirs) {
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir);
      for (const f of files) {
        const fullPath = path.join(dir, f);
        try {
          const stat = fs.statSync(fullPath);
          if (stat.isFile()) {
            fingerprint[`${path.basename(dir)}/${f}`] = `${stat.size}_${stat.mtimeMs}`;
          }
        } catch (e) {}
      }
    }
  }
  return JSON.stringify(fingerprint);
}

export function ensureDirectoryStructure() {
  const dirs = [
    BASE_RESOURCES_DIR,
    CACHE_DIR,
    path.join(BASE_RESOURCES_DIR, 'Timeline'),
    path.join(BASE_RESOURCES_DIR, 'Maps (your places)'),
    path.join(BASE_RESOURCES_DIR, 'My Maps'),
  ];
  dirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
}

export function checkResourcesStatus() {
  ensureDirectoryStructure();
  
  const timelineDir = path.join(BASE_RESOURCES_DIR, 'Timeline');
  const placesDir = path.join(BASE_RESOURCES_DIR, 'Maps (your places)');
  const myMapsDir = path.join(BASE_RESOURCES_DIR, 'My Maps');

  const timelineFiles = fs.existsSync(timelineDir) ? fs.readdirSync(timelineDir).filter(f => f.endsWith('.json')) : [];
  const placesFiles = fs.existsSync(placesDir) ? fs.readdirSync(placesDir).filter(f => f.endsWith('.json')) : [];
  const myMapsFiles = fs.existsSync(myMapsDir) ? fs.readdirSync(myMapsDir).filter(f => f.endsWith('.kmz') || f.endsWith('.kml')) : [];

  const hasTimeline = timelineFiles.length > 0;
  const hasSavedPlaces = placesFiles.some(f => f.toLowerCase().includes('saved places'));
  const hasReviews = placesFiles.some(f => f.toLowerCase().includes('reviews'));
  const hasMyMaps = myMapsFiles.length > 0;

  return {
    hasTimeline,
    hasSavedPlaces,
    hasReviews,
    hasMyMaps,
    counts: {
      timelineFiles: timelineFiles.length,
      placesFiles: placesFiles.length,
      myMapsFiles: myMapsFiles.length,
    }
  };
}

// Helper to round coordinate to 4 decimal places (~11.1 meter precision) for maximum performance
function roundCoord(val) {
  if (typeof val !== 'number' || isNaN(val)) return 0;
  return Math.round(val * 10000) / 10000;
}

function parseLatLngString(str) {
  if (!str || typeof str !== 'string') return null;
  const parts = str.split(',').map(s => s.replace('°', '').trim());
  if (parts.length === 2) {
    const lat = parseFloat(parts[0]);
    const lng = parseFloat(parts[1]);
    if (!isNaN(lat) && !isNaN(lng)) {
      return [roundCoord(lng), roundCoord(lat)]; // [lng, lat]
    }
  }
  return null;
}

// Ramer-Douglas-Peucker Polyline Simplification for fast lightweight paths
function sqSegDist(p, p1, p2) {
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

function simplifyPolyline(points, tolerance = 0.00015) {
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

export function parseTimelineData() {
  const timelineDir = path.join(BASE_RESOURCES_DIR, 'Timeline');
  if (!fs.existsSync(timelineDir)) return { visits: [], activities: [], paths: [] };

  const files = fs.readdirSync(timelineDir).filter(f => f.endsWith('.json'));
  let visits = [];
  let activities = [];
  let paths = [];

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(timelineDir, file), 'utf-8');
      const data = JSON.parse(content);

      if (data.semanticSegments && Array.isArray(data.semanticSegments)) {
        for (const seg of data.semanticSegments) {
          const startTime = seg.startTime;
          const endTime = seg.endTime;

          if (seg.visit) {
            const v = seg.visit;
            const top = v.topCandidate || {};
            const loc = top.placeLocation || {};
            let coords = null;

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

            let startCoords = act.start?.latLng ? parseLatLngString(act.start.latLng) : null;
            let endCoords = act.end?.latLng ? parseLatLngString(act.end.latLng) : null;

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
            const rawLine = [];
            for (let i = 0; i < seg.timelinePath.length; i++) {
              const pt = parseLatLngString(seg.timelinePath[i].point);
              if (pt) rawLine.push(pt);
            }

            const simplifiedLine = simplifyPolyline(rawLine, 0.00015);

            if (simplifiedLine && simplifiedLine.length > 1) {
              const bbox = computeBBox(simplifiedLine);
              const pathItem = {
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
        const rawPoints = [];
        for (let i = 0; i < data.locations.length; i += 3) {
          const loc = data.locations[i];
          rawPoints.push([roundCoord(loc.longitudeE7 / 1e7), roundCoord(loc.latitudeE7 / 1e7)]);
        }

        const simplified = simplifyPolyline(rawPoints, 0.00015);

        if (simplified && simplified.length > 1) {
          const bbox = computeBBox(simplified);
          const pathItem = {
            type: 'path',
            startTime: data.locations[0].timestamp,
            endTime: data.locations[data.locations.length - 1].timestamp,
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
    } catch (err) {
      console.error(`Error parsing timeline file ${file}:`, err);
    }
  }

  return { visits, activities, paths };
}

export function parsePlacesData() {
  const placesDir = path.join(BASE_RESOURCES_DIR, 'Maps (your places)');
  if (!fs.existsSync(placesDir)) return { savedPlaces: [], reviews: [] };

  let savedPlaces = [];
  let reviews = [];

  const files = fs.readdirSync(placesDir).filter(f => f.endsWith('.json'));

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(placesDir, file), 'utf-8');
      const data = JSON.parse(content);

      if (data.type === 'FeatureCollection' && Array.isArray(data.features)) {
        for (const feat of data.features) {
          const coords = feat.geometry?.coordinates;
          const props = feat.properties || {};

          if (coords && coords.length >= 2) {
            const roundedCoords = [roundCoord(coords[0]), roundCoord(coords[1])];
            const item = {
              name: props.location?.name || props.Title || 'Saved Place',
              address: props.location?.address || '',
              countryCode: props.location?.country_code || '',
              coordinates: roundedCoords,
              date: props.date || null,
              url: props.google_maps_url || null,
              rating: props.five_star_rating_published || null,
              reviewText: props.review_text_published || null,
            };

            if (file.toLowerCase().includes('reviews') || props.review_text_published) {
              reviews.push(item);
            } else {
              savedPlaces.push(item);
            }
          }
        }
      }
    } catch (err) {
      console.error(`Error parsing places file ${file}:`, err);
    }
  }

  return { savedPlaces, reviews };
}

export function parseMyMapsData() {
  const myMapsDir = path.join(BASE_RESOURCES_DIR, 'My Maps');
  if (!fs.existsSync(myMapsDir)) return [];

  const files = fs.readdirSync(myMapsDir).filter(f => f.endsWith('.kmz') || f.endsWith('.kml'));
  let myMapsFeatures = [];

  for (const file of files) {
    try {
      const filePath = path.join(myMapsDir, file);
      let kmlText = '';

      if (file.endsWith('.kmz')) {
        const zip = new admZip(filePath);
        const zipEntries = zip.getEntries();
        const kmlEntry = zipEntries.find(e => e.entryName.endsWith('.kml'));
        if (kmlEntry) {
          kmlText = kmlEntry.getData().toString('utf8');
        }
      } else if (file.endsWith('.kml')) {
        kmlText = fs.readFileSync(filePath, 'utf-8');
      }

      if (kmlText) {
        const dom = new DOMParser().parseFromString(kmlText, 'text/xml');
        const geojson = kml(dom);
        if (geojson && geojson.features) {
          const roundedFeatures = geojson.features.map(f => {
            if (f.geometry?.type === 'Point' && f.geometry.coordinates) {
              f.geometry.coordinates = [roundCoord(f.geometry.coordinates[0]), roundCoord(f.geometry.coordinates[1])];
            } else if (f.geometry?.type === 'LineString' && f.geometry.coordinates) {
              const rawLine = f.geometry.coordinates.map(c => [roundCoord(c[0]), roundCoord(c[1])]);
              const simplified = simplifyPolyline(rawLine, 0.00015);
              f.geometry.coordinates = simplified;
              f.bbox = computeBBox(simplified);
            }
            return f;
          });

          myMapsFeatures.push({
            mapName: file.replace(/\.(kmz|kml)$/i, ''),
            features: roundedFeatures,
          });
        }
      }
    } catch (err) {
      console.error(`Error parsing My Maps file ${file}:`, err);
    }
  }

  return myMapsFeatures;
}

// Fast Disk & In-Memory Cache Wrapper
export function getCachedAllData() {
  ensureDirectoryStructure();
  const currentFingerprint = computeSourceFingerprint();

  try {
    if (fs.existsSync(CACHE_FILE)) {
      const cacheContent = fs.readFileSync(CACHE_FILE, 'utf-8');
      const cached = JSON.parse(cacheContent);
      if (cached && cached.fingerprint === currentFingerprint && cached.data) {
        console.log('[MyTimeline] Valid cache hit (source files unchanged). Serving pre-calculated datasets & LODs in <50ms.');
        return cached.data;
      } else {
        console.log('[MyTimeline] Source files changed or fingerprint mismatched. Recalculating LODs and bounding boxes once...');
      }
    }
  } catch (e) {
    console.warn('[MyTimeline] Cache read miss/invalid, regenerating...', e);
  }

  console.log('[MyTimeline] Computing LOD pyramids, bounding boxes, and pre-transforming datasets once...');
  const startTime = Date.now();
  const status = checkResourcesStatus();
  const timeline = status.hasTimeline ? parseTimelineData() : { visits: [], activities: [], paths: [] };
  const places = (status.hasSavedPlaces || status.hasReviews) ? parsePlacesData() : { savedPlaces: [], reviews: [] };
  const myMaps = status.hasMyMaps ? parseMyMapsData() : [];

  const fullData = { status, timeline, places, myMaps };
  const cacheWrapper = {
    fingerprint: currentFingerprint,
    timestamp: new Date().toISOString(),
    data: fullData,
  };

  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cacheWrapper));
    console.log(`[MyTimeline] Calculated and cached to disk in ${Date.now() - startTime}ms.`);
  } catch (e) {
    console.error('Failed to write cache file:', e);
  }

  return fullData;
}

export function invalidateCache() {
  const filesToDelete = [CACHE_FILE, path.join(CACHE_DIR, 'parsed_data_v1.json')];
  for (const f of filesToDelete) {
    if (fs.existsSync(f)) {
      try {
        fs.unlinkSync(f);
        console.log(`[MyTimeline] Cache invalidated: ${path.basename(f)}`);
      } catch (e) {}
    }
  }
}

// Ingestion File Auto-Detection and Storage Router
export function handleUploadedFile(fileBuffer, originalFilename) {
  ensureDirectoryStructure();
  invalidateCache();

  const ext = path.extname(originalFilename).toLowerCase();

  if (ext === '.zip') {
    const zip = new admZip(fileBuffer);
    const zipEntries = zip.getEntries();
    let detectedCount = 0;

    for (const entry of zipEntries) {
      if (entry.isDirectory) continue;
      const entryName = entry.entryName;
      const entryBuffer = entry.getData();

      if (entryName.endsWith('.json')) {
        try {
          const str = entryBuffer.toString('utf8');
          const json = JSON.parse(str);

          if (json.semanticSegments || json.locations || entryName.toLowerCase().includes('location history')) {
            const targetDir = path.join(BASE_RESOURCES_DIR, 'Timeline');
            fs.mkdirSync(targetDir, { recursive: true });
            fs.writeFileSync(path.join(targetDir, 'Timeline.json'), entryBuffer);
            detectedCount++;
          } else if (json.type === 'FeatureCollection' || entryName.toLowerCase().includes('saved places')) {
            const targetDir = path.join(BASE_RESOURCES_DIR, 'Maps (your places)');
            fs.mkdirSync(targetDir, { recursive: true });
            const destName = entryName.toLowerCase().includes('reviews') ? 'Reviews.json' : 'Saved Places.json';
            fs.writeFileSync(path.join(targetDir, destName), entryBuffer);
            detectedCount++;
          }
        } catch (e) {}
      } else if (entryName.endsWith('.kmz') || entryName.endsWith('.kml')) {
        const targetDir = path.join(BASE_RESOURCES_DIR, 'My Maps');
        fs.mkdirSync(targetDir, { recursive: true });
        const destName = path.basename(entryName);
        fs.writeFileSync(path.join(targetDir, destName), entryBuffer);
        detectedCount++;
      }
    }
    return { type: 'zip', extractedFiles: detectedCount };
  }

  if (ext === '.json') {
    const str = fileBuffer.toString('utf8');
    const json = JSON.parse(str);

    if (json.semanticSegments || json.locations || originalFilename.toLowerCase().includes('timeline')) {
      const targetDir = path.join(BASE_RESOURCES_DIR, 'Timeline');
      fs.mkdirSync(targetDir, { recursive: true });
      fs.writeFileSync(path.join(targetDir, 'Timeline.json'), fileBuffer);
      return { type: 'timeline', destination: 'Timeline/Timeline.json' };
    }

    if (json.type === 'FeatureCollection' || originalFilename.toLowerCase().includes('places') || originalFilename.toLowerCase().includes('saved')) {
      const targetDir = path.join(BASE_RESOURCES_DIR, 'Maps (your places)');
      fs.mkdirSync(targetDir, { recursive: true });
      const destName = originalFilename.toLowerCase().includes('reviews') ? 'Reviews.json' : 'Saved Places.json';
      fs.writeFileSync(path.join(targetDir, destName), fileBuffer);
      return { type: 'places', destination: `Maps (your places)/${destName}` };
    }
  }

  if (ext === '.kmz' || ext === '.kml') {
    const targetDir = path.join(BASE_RESOURCES_DIR, 'My Maps');
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, originalFilename), fileBuffer);
    return { type: 'mymaps', destination: `My Maps/${originalFilename}` };
  }

  return { type: 'unknown' };
}
