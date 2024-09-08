let map;
let vectorLayer;
const sidebar = document.getElementById('sidebar');
const poiList = document.getElementById('poi-list');
const searchInput = document.getElementById('search-input');
const searchButton = document.getElementById('search-button');
const radiusInput = document.getElementById('radius-input');

function initMap() {
    map = new ol.Map({
        target: 'map',
        layers: [
            new ol.layer.Tile({
                source: new ol.source.OSM()
            })
        ],
        view: new ol.View({
            center: ol.proj.fromLonLat([0, 0]),
            zoom: 2
        })
    });

    vectorLayer = new ol.layer.Vector({
        source: new ol.source.Vector(),
        style: new ol.style.Style({
            image: new ol.style.Circle({
                radius: 6,
                fill: new ol.style.Fill({color: 'red'}),
                stroke: new ol.style.Stroke({color: 'white', width: 2})
            })
        })
    });

    map.addLayer(vectorLayer);

    map.on('click', function(evt) {
        const feature = map.forEachFeatureAtPixel(evt.pixel, function(feature) {
            return feature;
        });
        if (feature) {
            const poi = feature.get('poi');
            if (poi) {
                togglePoiDetails(poi.id);
            }
        } else {
            const coords = ol.proj.transform(evt.coordinate, 'EPSG:3857', 'EPSG:4326');
            findNearbyPOIs(coords);
        }
    });
}

function searchPlace() {
    const query = searchInput.value;
    fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`)
        .then(response => {
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            return response.json();
        })
        .then(data => {
            if (data.length > 0) {
                const result = data[0];
                const coords = [parseFloat(result.lon), parseFloat(result.lat)];
                map.getView().animate({center: ol.proj.fromLonLat(coords), zoom: 15});
                findNearbyPOIs(coords);
            } else {
                alert('Location not found');
            }
        })
        .catch(error => {
            alert('An error occurred while searching. Please try again.');
        });
}

function findNearbyPOIs(coords) {
    const radius = Math.min(parseInt(radiusInput.value), 5000);
    const [lon, lat] = coords;
    const delta = radius / 111000;
    const bbox = `${lat - delta},${lon - delta},${lat + delta},${lon + delta}`;
    
    const query = `
    [out:json][timeout:25];
    (
      node["historic"](${bbox});
      way["historic"](${bbox});
      relation["historic"](${bbox});
    );
    out center;`;

    fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'data=' + encodeURIComponent(query)
    })
        .then(response => {
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            return response.json();
        })
        .then(data => {
            if (data.elements && Array.isArray(data.elements)) {
                if (data.elements.length === 0 && radius < 5000) {
                    radiusInput.value = Math.min(radius * 2, 5000);
                    findNearbyPOIs(coords);
                } else {
                    displayPOIs(data.elements, coords, radius);
                }
            } else {
                alert('Received unexpected data structure from Overpass API');
            }
        })
        .catch(error => {
            alert('An error occurred while fetching POIs. Please try again.');
        });
}

function displayPOIs(pois, center, radius) {
    vectorLayer.getSource().clear();
    poiList.innerHTML = '';

    const centerPoint = ol.proj.fromLonLat(center);
    map.getView().setCenter(centerPoint);

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

        const poiCoords = ol.proj.fromLonLat([poiLon, poiLat]);
        const distance = new ol.geom.LineString([centerPoint, poiCoords]).getLength();

        if (distance <= radius) {
            const feature = new ol.Feature({
                geometry: new ol.geom.Point(poiCoords)
            });
            feature.set('poi', { ...poi, id: poi.id || index });
            vectorLayer.getSource().addFeature(feature);

            const poiName = poi.tags.name || (poi.tags.historic ? `${capitalizeFirstLetter(poi.tags.historic)} Site` : 'Unknown Historic Site');
            const poiType = poi.tags.historic || 'Unknown';

            const poiElement = document.createElement('div');
            poiElement.className = 'poi-card';
            poiElement.dataset.poiId = poi.id || index;
            poiElement.innerHTML = `
                <div class="poi-brief">
                    <h3>${poiName}</h3>
                    <p>Type: ${poiType}</p>
                    <p>Distance: ${Math.round(distance)} m</p>
                </div>
                <div class="poi-details">
                    <h3>${poiName}</h3>
                    <pre>${JSON.stringify(poi.tags, null, 2)}</pre>
                </div>
            `;
            poiElement.addEventListener('click', () => togglePoiDetails(poi.id || index));
            poiList.appendChild(poiElement);
        }
    });

    if (poiList.children.length === 0) {
        poiList.innerHTML = '<p>No historic points of interest found within the specified radius.</p>';
    }
}

function togglePoiDetails(poiId) {
    const poiCard = poiList.querySelector(`[data-poi-id="${poiId}"]`);
    if (poiCard) {
        poiCard.classList.toggle('flipped');
    }
}

function capitalizeFirstLetter(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

initMap();
searchButton.addEventListener('click', searchPlace);
searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') searchPlace();
});
