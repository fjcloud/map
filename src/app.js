import { DEFAULT_RADIUS_METERS, MAX_RADIUS_METERS } from './config.js';
import { fetchNominatimData, fetchOverpassData } from './api.js';

// OpenLayers imports
import Map from 'ol/Map.js';
import View from 'ol/View.js';
import TileLayer from 'ol/layer/Tile.js';
import VectorLayer from 'ol/layer/Vector.js';
import OSM from 'ol/source/OSM.js';
import VectorSource from 'ol/source/Vector.js';
import Feature from 'ol/Feature.js';
import Point from 'ol/geom/Point.js';
import LineString from 'ol/geom/LineString.js';
import { fromLonLat, transform } from 'ol/proj.js';
import {
    defaults as defaultInteractions,
    MouseWheelZoom,
} from 'ol/interaction.js';
import { Circle as CircleStyle, Fill, Stroke, Style } from 'ol/style.js';

// Import base OpenLayers CSS
import 'ol/ol.css';

let map;
let poiVectorLayer;
let searchCenterLayer;
let selectedFeature = null; // Keep track of the selected feature
const sidebar = document.getElementById('sidebar');
const poiList = document.getElementById('poi-list');
const searchInput = document.getElementById('search-input');
const searchButton = document.getElementById('search-button');
const radiusInput = document.getElementById('radius-input');
const searchPanel = document.getElementById('search-panel'); // Get search panel
const poiPanel = document.getElementById('poi-panel'); // Get POI panel
const closePoiPanelButton = document.getElementById('close-poi-panel'); // Get close button
const statusDisplay = document.getElementById('status-display') || createStatusDisplay();

// --- Configuration Constants ---
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const OVERPASS_TIMEOUT_SECONDS = 25;
// -----------------------------

// --- Utilities ---
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func.apply(this, args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}
// ---------------

// --- Styles ---
const poiDefaultStyle = new Style({
    image: new CircleStyle({
        radius: 6,
        fill: new Fill({ color: 'red' }),
        stroke: new Stroke({ color: 'white', width: 2 }),
    }),
});

const poiSelectedStyle = new Style({
    image: new CircleStyle({
        radius: 9, // Larger radius
        fill: new Fill({ color: 'blue' }), // Different color
        stroke: new Stroke({ color: 'white', width: 3 }),
    }),
});

// Style for the searched location marker
const searchCenterStyle = new Style({
    image: new CircleStyle({
        radius: 8,
        fill: new Fill({ color: 'rgba(0, 128, 255, 0.7)' }), // Blue, slightly transparent
        stroke: new Stroke({ color: 'white', width: 3 }),
    }),
});
// ------------

function createStatusDisplay() {
    const display = document.createElement('div');
    display.id = 'status-display';

    // Insert into the search panel
    if (searchPanel) {
        searchPanel.appendChild(display);
    } else {
        console.error('Search panel not found, cannot append status display.');
        // Fallback: append to body, but layout will be wrong
        document.body.appendChild(display);
    }
    return display;
}

function updateStatusMessage(message, type = 'info') {
    statusDisplay.textContent = message;
    statusDisplay.style.display = message ? 'block' : 'none'; // Keep controlling visibility

    // Remove previous type classes
    statusDisplay.classList.remove(
        'status-info',
        'status-success',
        'status-error'
    );

    // Add class based on type for styling via CSS
    if (message) {
        // Only add class if there is a message
        switch (type) {
            case 'error':
                statusDisplay.classList.add('status-error');
                break;
            case 'success':
                statusDisplay.classList.add('status-success');
                break;
            default: // 'info' or loading
                statusDisplay.classList.add('status-info');
        }
    }

    // Automatically hide success messages after a delay
    if (type === 'success') {
        setTimeout(() => {
            // Check if the message is still the same one we set
            if (
                statusDisplay.classList.contains('status-success') &&
                statusDisplay.textContent === message
            ) {
                updateStatusMessage(''); // Clear the message
            }
        }, 5000); // Hide after 5 seconds
    }
}

function showPoiPanel() {
    poiPanel.classList.add('visible');
}

function hidePoiPanel() {
    poiPanel.classList.remove('visible');
    // Also deselect any feature when panel is hidden
    if (selectedFeature) {
        selectedFeature.setStyle(poiDefaultStyle);
        selectedFeature = null;
    }
    // Remove flip from cards
     const flippedCard = poiList.querySelector('.poi-card.flipped');
     if (flippedCard) {
         flippedCard.classList.remove('flipped');
     }
}

// --- API Service Functions ---
// -------------------------

function initMap() {
    console.log('Initializing map...');
    map = new Map({
        target: 'map',
        layers: [
            new TileLayer({
                source: new OSM(),
            }),
        ],
        view: new View({
            center: fromLonLat([0, 0]),
            zoom: 2,
        }),
        interactions: defaultInteractions({ mouseWheelZoom: false }).extend([
            new MouseWheelZoom({
                constrainResolution: true,
            }),
        ]),
    });

    // Layer for POIs
    poiVectorLayer = new VectorLayer({
        source: new VectorSource(),
        style: poiDefaultStyle,
    });

    // Layer for the search center marker
    searchCenterLayer = new VectorLayer({
        source: new VectorSource(),
        style: searchCenterStyle,
    });

    map.addLayer(poiVectorLayer);
    map.addLayer(searchCenterLayer);

    map.on('click', function (evt) {
        searchCenterLayer.getSource().clear();
        hidePoiPanel(); // Hide POI panel on map click away from feature

        const feature = map.forEachFeatureAtPixel(
            evt.pixel,
            function (feature) {
                return feature;
            },
            { layerFilter: (layer) => layer === poiVectorLayer }
        );

        if (feature) {
            const poiId = feature.get('poi').id;
            selectPoi(poiId, true);
        } else {
            // Deselection already handled by hidePoiPanel()
            const coords = transform(evt.coordinate, 'EPSG:3857', 'EPSG:4326');
            findNearbyPOIs(coords); // Find POIs around clicked point
        }
    });
}

async function searchPlace() {
    const query = searchInput.value;
    if (!query) {
        updateStatusMessage('Please enter a location to search.', 'error');
        return;
    }
    updateStatusMessage('Searching for location...', 'info');
    searchCenterLayer.getSource().clear();
    hidePoiPanel(); // Hide POI panel when starting a new search

    try {
        const data = await fetchNominatimData(query);
        if (data.length > 0) {
            const result = data[0];
            const coords = [parseFloat(result.lon), parseFloat(result.lat)];
            const mapCoords = fromLonLat(coords);

            // Add a marker for the searched location
            const centerMarker = new Feature({
                geometry: new Point(mapCoords),
            });
            searchCenterLayer.getSource().addFeature(centerMarker);

            map.getView().animate({ center: mapCoords, zoom: 15 });
            await findNearbyPOIs(coords);
        } else {
            updateStatusMessage('Location not found.', 'error');
        }
    } catch (error) {
        console.error('Search error:', error);
        updateStatusMessage(
            `Error searching: ${error.message}. Please try again.`,
            'error'
        );
    }
}

async function findNearbyPOIs(coords, currentRadius = null) {
    // Validate and clamp radius input *before* using it
    let requestedRadius = parseInt(radiusInput.value);
    if (isNaN(requestedRadius) || requestedRadius <= 0) {
        requestedRadius = DEFAULT_RADIUS_METERS;
        radiusInput.value = requestedRadius;
    } else if (requestedRadius > MAX_RADIUS_METERS) {
        requestedRadius = MAX_RADIUS_METERS;
        radiusInput.value = requestedRadius;
    }

    const radius = currentRadius !== null ? currentRadius : requestedRadius;
    const effectiveRadius = Math.min(radius, MAX_RADIUS_METERS);

    if (isNaN(effectiveRadius) || effectiveRadius <= 0) {
        updateStatusMessage('Invalid radius specified.', 'error');
        return;
    }

    const [lon, lat] = coords;
    const delta = effectiveRadius / 111000;
    const bbox = `${lat - delta},${lon - delta},${lat + delta},${lon + delta}`;

    updateStatusMessage(
        `Searching for POIs within ${effectiveRadius}m...`,
        'info'
    );

    try {
        const data = await fetchOverpassData(bbox);
        if (data.elements && Array.isArray(data.elements)) {
            if (
                data.elements.length === 0 &&
                effectiveRadius < MAX_RADIUS_METERS
            ) {
                const nextRadius = Math.min(
                    effectiveRadius * 2,
                    MAX_RADIUS_METERS
                );
                radiusInput.value = nextRadius;
                updateStatusMessage(
                    `No POIs found within ${effectiveRadius}m, expanding search to ${nextRadius}m...`,
                    'info'
                );
                await findNearbyPOIs(coords, nextRadius);
            } else {
                displayPOIs(data.elements, coords, effectiveRadius);
            }
        } else {
            console.error('Unexpected Overpass API data structure:', data);
            updateStatusMessage(
                'Received unexpected data from POI service.',
                'error'
            );
        }
    } catch (error) {
        console.error('Overpass API error:', error);
        updateStatusMessage(
            `Error fetching POIs: ${error.message}. Please try again.`,
            'error'
        );
    }
}

function displayPOIs(pois, center, radius) {
    poiVectorLayer.getSource().clear();
    poiList.innerHTML = '';
    if (selectedFeature) {
        selectedFeature = null;
    }

    const centerPoint = fromLonLat(center);
    map.getView().setCenter(centerPoint);

    let featuresAdded = 0;
    pois.forEach((poi, index) => {
        let poiLon, poiLat;
        if (poi.type === 'node') {
            poiLon = poi.lon;
            poiLat = poi.lat;
        } else if (poi.center) {
            poiLon = poi.center.lon;
            poiLat = poi.center.lat;
        } else {
            return; // Skip POIs without valid coordinates
        }

        const poiCoords = fromLonLat([poiLon, poiLat]);
        const distance = new LineString([centerPoint, poiCoords]).getLength();

        if (distance <= radius) {
            const feature = new Feature({
                geometry: new Point(poiCoords),
            });
            const uniquePoiId = `${poi.type}-${poi.id || index}`;
            feature.setId(uniquePoiId);
            feature.set('poi', { ...poi, id: uniquePoiId });
            poiVectorLayer.getSource().addFeature(feature);

            const poiName =
                poi.tags.name ||
                (poi.tags.historic
                    ? `${capitalizeFirstLetter(poi.tags.historic)} Site`
                    : 'Unknown Historic Site');
            const poiType = poi.tags.historic || 'Unknown';

            const poiElement = document.createElement('div');
            poiElement.className = 'poi-card';
            poiElement.dataset.poiId = uniquePoiId;
            poiElement.innerHTML = `
                <div class="poi-brief">
                    <h3>${poiName}</h3>
                    <p>Type: ${poiType}</p>
                    <p>Distance: ${Math.round(distance)} m</p>
                </div>
                <div class="poi-details">
                    <h3>${poiName}</h3>
                    <pre>${formatMetadata(poi.tags)}</pre>
                </div>
            `;
            poiElement.addEventListener('click', () => selectPoi(uniquePoiId));
            poiList.appendChild(poiElement);
            featuresAdded++;
        }
    });

    if (featuresAdded === 0) {
        poiList.innerHTML = '<p>No historic points of interest found within the specified radius.</p>';
        updateStatusMessage(`No historic POIs found within ${radius}m.`, 'success');
        hidePoiPanel(); // Hide panel if no results
    } else {
        updateStatusMessage(`Found ${featuresAdded} POI(s) within ${radius}m.`, 'success');
        showPoiPanel(); // Show panel with results
    }
}

function formatMetadata(tags) {
    let formattedMetadata = '';
    for (const [key, value] of Object.entries(tags)) {
        let formattedValue = value;
        // Simple link detection
        if (
            key === 'website' ||
            key === 'url' ||
            (typeof value === 'string' && value.startsWith('http'))
        ) {
            try {
                const url = new URL(value);
                formattedValue = `<a href="${url.href}" target="_blank" rel="noopener noreferrer">${value}</a>`;
            } catch (_) {
                // Not a valid URL, display as text
                formattedValue = value;
            }
        } else if (key === 'wikidata') {
            formattedValue = `<a href="https://www.wikidata.org/wiki/${value}" target="_blank" rel="noopener noreferrer">${value}</a>`;
        }
        // Basic escaping for HTML display within <pre>
        const escapedKey = key.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        // Value might already contain HTML (links), so don't double-escape it
        const displayValue =
            formattedValue === value
                ? value.replace(/</g, '&lt;').replace(/>/g, '&gt;')
                : formattedValue;
        formattedMetadata += `${escapedKey}: ${displayValue}\n`;
    }
    return formattedMetadata;
}

// Renamed from togglePoiDetails to reflect new functionality
function selectPoi(poiId, fromMapClick = false) {
    const targetFeature = poiVectorLayer.getSource().getFeatureById(poiId);
    const targetCard = poiList.querySelector(`[data-poi-id="${poiId}"]`);

    if (!targetFeature || !targetCard) {
        console.warn('Could not find feature or card for poiId:', poiId);
        return;
    }

    // Ensure POI panel is visible when selecting
    showPoiPanel();

    if (selectedFeature && selectedFeature !== targetFeature) {
        selectedFeature.setStyle(poiDefaultStyle);
        const previousCard = poiList.querySelector(`[data-poi-id="${selectedFeature.getId()}"]`);
        if (previousCard) {
            previousCard.classList.remove('flipped');
        }
    }

    targetFeature.setStyle(poiSelectedStyle);
    selectedFeature = targetFeature;

    if (fromMapClick) {
        targetCard.classList.add('flipped');
    } else {
        // Toggle only if clicking the card itself
        targetCard.classList.toggle('flipped');
    }

    // Scroll card into view within the poi-panel
    targetCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    const coordinates = targetFeature.getGeometry().getCoordinates();
    map.getView().animate({
        center: coordinates,
        duration: 500,
        zoom: Math.max(map.getView().getZoom(), 16)
    });

    if (targetCard.classList.contains('flipped')) {
        const allCards = poiList.querySelectorAll('.poi-card');
        allCards.forEach((card) => {
            if (card !== targetCard && card.classList.contains('flipped')) {
                card.classList.remove('flipped');
            }
        });
    }
    // If the click was on the card and it resulted in closing the flip, don't hide the whole panel
    // Panel hiding is handled by map click or close button
}

function capitalizeFirstLetter(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

// --- Initialization ---
initMap();
radiusInput.value = DEFAULT_RADIUS_METERS;

const debouncedSearchPlace = debounce(searchPlace, 300);

searchButton.addEventListener('click', searchPlace);
searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        debouncedSearchPlace();
    }
});

// Add listener for the POI panel close button
closePoiPanelButton.addEventListener('click', hidePoiPanel);

// Add input validation for radius
radiusInput.addEventListener('input', () => {
    let value = parseInt(radiusInput.value);
    if (radiusInput.value !== '' && (isNaN(value) || value <= 0)) {
        updateStatusMessage(
            `Radius must be a positive number (max ${MAX_RADIUS_METERS}m).`,
            'error'
        );
    } else if (value > MAX_RADIUS_METERS) {
        updateStatusMessage(
            `Radius cannot exceed ${MAX_RADIUS_METERS}m.`,
            'error'
        );
    } else {
        if (statusDisplay.textContent.includes('Radius')) {
            updateStatusMessage('');
        }
    }
});

// Ensure radius is validated when focus is lost (e.g., user types invalid chars and clicks away)
radiusInput.addEventListener('change', () => {
    let value = parseInt(radiusInput.value);
    if (isNaN(value) || value <= 0) {
        radiusInput.value = DEFAULT_RADIUS_METERS;
        updateStatusMessage(
            `Invalid radius reset to ${DEFAULT_RADIUS_METERS}m.`,
            'info'
        );
    } else if (value > MAX_RADIUS_METERS) {
        radiusInput.value = MAX_RADIUS_METERS;
        updateStatusMessage(
            `Radius clamped to max ${MAX_RADIUS_METERS}m.`,
            'info'
        );
    }
});

// Adjust map size when orientation changes
window.addEventListener('resize', function () {
    map.updateSize();
});
