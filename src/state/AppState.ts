import { StorageService } from '../services/StorageService';

export type DatePreset = 'all' | 'today' | 'yesterday' | 'week' | 'month' | 'year' | 'custom';

export interface ActiveCheckboxes {
  museums: boolean;
  cathedrals: boolean;
  parks: boolean;
  food: boolean;
  general: boolean;
  timelineVisits: boolean;
  timelinePaths: boolean;
  myMaps: boolean;
}

export interface DataStatus {
  hasTimeline: boolean;
  hasSavedPlaces: boolean;
  hasReviews: boolean;
  hasMyMaps: boolean;
  counts: {
    timelineFiles: number;
    placesFiles: number;
    myMapsFiles: number;
  };
}

export interface VisitItem {
  type: 'visit';
  name: string;
  address: string;
  placeId: string;
  coordinates: [number, number]; // [lng, lat]
  startTime: string;
  endTime: string;
  probability: number;
}

export interface ActivityItem {
  type: 'activity';
  activityType: string;
  distanceMeters: number;
  startTime: string;
  endTime: string;
  startCoords: [number, number] | null;
  endCoords: [number, number] | null;
}

export interface PathItem {
  type: 'path';
  startTime: string;
  endTime: string;
  bbox?: [number, number, number, number]; // [minLng, minLat, maxLng, maxLat]
  lods?: {
    low: [number, number][];
    med: [number, number][];
  };
  coordinates: [number, number][]; // [[lng, lat], ...]
}

export interface TimelineDataset {
  visits: VisitItem[];
  activities: ActivityItem[];
  paths: PathItem[];
}

export interface PlaceItem {
  name: string;
  address: string;
  countryCode: string;
  coordinates: [number, number];
  date: string | null;
  url: string | null;
  rating: number | null;
  reviewText: string | null;
}

export interface PlacesDataset {
  savedPlaces: PlaceItem[];
  reviews: PlaceItem[];
}

export interface MyMapsItem {
  mapName: string;
  features: any[];
}

// Aggressive yielding helper with 20ms pause between chunks to keep browser 100% responsive
export function yieldToMainThread(ms: number = 20): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class AppStateStore extends EventTarget {
  public dataStatus: DataStatus = {
    hasTimeline: false,
    hasSavedPlaces: false,
    hasReviews: false,
    hasMyMaps: false,
    counts: { timelineFiles: 0, placesFiles: 0, myMapsFiles: 0 }
  };

  public timeline: TimelineDataset = { visits: [], activities: [], paths: [] };
  public places: PlacesDataset = { savedPlaces: [], reviews: [] };
  public myMaps: MyMapsItem[] = [];

  public datePreset: DatePreset = 'year';
  public customStart: string | null = null;
  public customEnd: string | null = null;

  public categoryCheckboxes: ActiveCheckboxes = {
    museums: false,
    cathedrals: false,
    parks: false,
    food: false,
    general: false,
    timelineVisits: false,
    timelinePaths: false,
    myMaps: false,
  };

  public isUploadModalOpen: boolean = false;
  public isPlacesModalOpen: boolean = false;
  public placesModalCategoryFilter: string = 'all';
  public focusedPlace: { coordinates: [number, number]; name: string } | null = null;
  public pathResolutionMode: 'auto' | 'low' | 'med' | 'high' = 'auto';
  public pathViewportOnly: boolean = true;
  public isLoading: boolean = true;
  public loadingProgress: number = 0;
  public loadingStatusMessage: string = 'Connecting to server...';

  public async fetchResourcesData() {
    this.isLoading = true;
    this.loadingProgress = 10;
    this.loadingStatusMessage = 'Checking local browser storage...';
    this.notify();

    // 1. Try to load from browser's local IndexedDB
    try {
      const localData = await StorageService.loadDataset();
      if (localData && (
        (localData.timeline?.visits?.length > 0) ||
        (localData.places?.savedPlaces?.length > 0) ||
        (localData.myMaps?.length > 0)
      )) {
        this.loadingProgress = 60;
        this.loadingStatusMessage = 'Loading saved datasets from browser database...';
        this.notify();

        await this.applyParsedDataset(localData);
        this.loadingProgress = 100;
        this.loadingStatusMessage = 'Datasets ready (from local storage)!';
        this.isLoading = false;
        this.notify();
        return;
      }
    } catch (storageErr) {
      console.warn('Could not read from IndexedDB, falling back to network:', storageErr);
    }

    // 2. Fallback to local server API (if running with Express backend locally)
    try {
      this.loadingProgress = 30;
      this.loadingStatusMessage = 'Connecting to server datasets...';
      this.notify();

      const res = await fetch('/api/resources/data');
      if (res.ok) {
        const data = await res.json();
        
        // Cache in browser IndexedDB for future instant offline / static loads
        try {
          await StorageService.saveDataset(data);
        } catch (e) {}

        await this.applyParsedDataset(data);
        this.loadingProgress = 100;
        this.loadingStatusMessage = 'Datasets ready!';
        return;
      }
    } catch (err) {
      // Running statically on GitHub Pages with no data yet in IndexedDB
      console.log('Running in static mode or server unavailable. Awaiting user upload.');
      this.loadingStatusMessage = 'Ready! Click "Upload Google Takeout Data" to get started.';
    } finally {
      this.isLoading = false;
      this.notify();
    }
  }

  public async applyParsedDataset(data: any) {
    this.dataStatus = data.status || {
      hasTimeline: (data.timeline?.visits?.length || 0) > 0,
      hasSavedPlaces: (data.places?.savedPlaces?.length || 0) > 0,
      hasReviews: (data.places?.reviews?.length || 0) > 0,
      hasMyMaps: (data.myMaps?.length || 0) > 0,
      counts: {
        timelineFiles: (data.timeline?.visits?.length || 0) > 0 ? 1 : 0,
        placesFiles: (data.places?.savedPlaces?.length || 0) > 0 ? 1 : 0,
        myMapsFiles: data.myMaps?.length || 0,
      }
    };
    this.places = data.places || { savedPlaces: [], reviews: [] };
    this.myMaps = data.myMaps || [];

    const rawVisits = data.timeline?.visits || [];
    const rawActivities = data.timeline?.activities || [];
    const rawPaths = data.timeline?.paths || [];

    // Micro-chunk processing for smooth UI responsiveness
    const processedVisits: VisitItem[] = [];
    const chunkSize = 500;
    for (let i = 0; i < rawVisits.length; i += chunkSize) {
      const chunk = rawVisits.slice(i, i + chunkSize);
      processedVisits.push(...chunk);
      if (rawVisits.length > 1000 && i % 2000 === 0) {
        await yieldToMainThread(10);
      }
    }

    this.timeline = {
      visits: processedVisits,
      activities: rawActivities,
      paths: rawPaths,
    };

    this.notify();
  }

  public async clearStoredData() {
    await StorageService.clearDataset();
    this.dataStatus = {
      hasTimeline: false,
      hasSavedPlaces: false,
      hasReviews: false,
      hasMyMaps: false,
      counts: { timelineFiles: 0, placesFiles: 0, myMapsFiles: 0 }
    };
    this.places = { savedPlaces: [], reviews: [] };
    this.myMaps = [];
    this.timeline = { visits: [], activities: [], paths: [] };
    this.notify();
  }

  public setDatePreset(preset: DatePreset, start: string | null = null, end: string | null = null) {
    this.datePreset = preset;
    this.customStart = start;
    this.customEnd = end;
    this.notify();
  }

  public toggleCategoryCheckbox(key: keyof ActiveCheckboxes, checked?: boolean) {
    this.categoryCheckboxes[key] = checked !== undefined ? checked : !this.categoryCheckboxes[key];
    this.notify();
  }

  public setAllCategoryCheckboxes(value: boolean) {
    Object.keys(this.categoryCheckboxes).forEach(k => {
      this.categoryCheckboxes[k as keyof ActiveCheckboxes] = value;
    });
    this.notify();
  }

  public toggleUploadModal(open?: boolean) {
    this.isUploadModalOpen = open !== undefined ? open : !this.isUploadModalOpen;
    this.notify();
  }

  public togglePlacesModal(open?: boolean, category: string = 'all') {
    this.isPlacesModalOpen = open !== undefined ? open : !this.isPlacesModalOpen;
    this.placesModalCategoryFilter = category;
    this.notify();
  }

  public focusPlaceOnMap(coordinates: [number, number], name: string) {
    this.focusedPlace = { coordinates, name };
    this.isPlacesModalOpen = false;
    this.notify();
  }

  public setPathResolutionMode(mode: 'auto' | 'low' | 'med' | 'high') {
    this.pathResolutionMode = mode;
    this.notify();
  }

  public setPathViewportOnly(enabled: boolean) {
    this.pathViewportOnly = enabled;
    this.notify();
  }

  public notify() {
    this.dispatchEvent(new CustomEvent('app-state-changed', { detail: this }));
  }

  // Filter helper for items within current Master Time Selector date range
  public isDateInRange(dateStr: string | null | undefined): boolean {
    if (this.datePreset === 'all' || !dateStr) return true;

    const itemDate = new Date(dateStr);
    if (isNaN(itemDate.getTime())) return true;

    const now = new Date();

    if (this.datePreset === 'today') {
      return itemDate.toDateString() === now.toDateString();
    }

    if (this.datePreset === 'yesterday') {
      const yest = new Date(now);
      yest.setDate(now.getDate() - 1);
      return itemDate.toDateString() === yest.toDateString();
    }

    if (this.datePreset === 'week') {
      const weekAgo = new Date(now);
      weekAgo.setDate(now.getDate() - 7);
      return itemDate >= weekAgo;
    }

    if (this.datePreset === 'month') {
      const monthAgo = new Date(now);
      monthAgo.setMonth(now.getMonth() - 1);
      return itemDate >= monthAgo;
    }

    if (this.datePreset === 'year') {
      const yearAgo = new Date(now);
      yearAgo.setFullYear(now.getFullYear() - 1);
      return itemDate >= yearAgo;
    }

    if (this.datePreset === 'custom') {
      if (this.customStart && new Date(this.customStart) > itemDate) return false;
      if (this.customEnd && new Date(this.customEnd) < itemDate) return false;
      return true;
    }

    return true;
  }
}

export const AppState = new AppStateStore();
