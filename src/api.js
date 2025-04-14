import {
    NOMINATIM_URL,
    OVERPASS_URL,
    OVERPASS_TIMEOUT_SECONDS,
} from './config.js';

/**
 * Fetches geocoding data from Nominatim API.
 * @param {string} query The search query (location name).
 * @returns {Promise<Array<object>>} A promise that resolves to an array of results.
 * @throws {Error} If the API request fails.
 */
export async function fetchNominatimData(query) {
    const url = `${NOMINATIM_URL}?format=json&q=${encodeURIComponent(query)}`;
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Nominatim API error! status: ${response.status}`);
    }
    return await response.json();
}

/**
 * Fetches POI data from Overpass API based on a bounding box.
 * @param {string} bbox The bounding box string (minLat,minLon,maxLat,maxLon).
 * @returns {Promise<object>} A promise that resolves to the Overpass API JSON response.
 * @throws {Error} If the API request fails.
 */
export async function fetchOverpassData(bbox) {
    const query = `
    [out:json][timeout:${OVERPASS_TIMEOUT_SECONDS}];
    (
      node["historic"](${bbox});
      way["historic"](${bbox});
      relation["historic"](${bbox});
    );
    out center;`;

    const response = await fetch(OVERPASS_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'data=' + encodeURIComponent(query),
    });

    if (!response.ok) {
        throw new Error(`Overpass API error! status: ${response.status}`);
    }
    return await response.json();
}
