import './index.css';
import './components/RetroPosterBackground';
import './components/RetroNavbar';
import './components/MasterTimeSelector';
import './components/AnalyticsDashboard';
import './components/RetroMapView';
import './components/UploadModal';
import './components/PlacesModal';
import { AppState } from './state/AppState';

// Initialize application state on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  AppState.fetchResourcesData();
});
