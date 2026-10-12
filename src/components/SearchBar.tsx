import { useState, useEffect, useRef } from 'react';
import { Search, MapPin, Loader2, Navigation } from 'lucide-react';
import type { LocationResult } from '../api/openmeteo';
import { getBrowserCoordinates, reverseGeocodeCoordinates } from '../utils/geolocation';
import {
  searchLocationsWithFallback,
  resolveLocationCoordinates,
  type SearchResultItem,
} from '../utils/locationSearch';

interface SearchBarProps {
  onSelect: (location: LocationResult) => void;
  onLocateStart?: () => void;
  onLocateEnd?: () => void;
  onLocateError?: (error: string) => void;
  isExternalLocating?: boolean;
}

export function SearchBar({
  onSelect,
  onLocateStart,
  onLocateEnd,
  onLocateError,
  isExternalLocating = false,
}: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [internalLocating, setInternalLocating] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const isLocating = isExternalLocating || internalLocating;

  const handleUseMyLocation = async () => {
    setInternalLocating(true);
    onLocateStart?.();
    setShowDropdown(false);
    try {
      const coords = await getBrowserCoordinates();
      const loc = await reverseGeocodeCoordinates(coords.latitude, coords.longitude);
      setQuery(loc.name);
      onSelect(loc);
    } catch (err: any) {
      const msg = err?.message || 'Unable to determine your location. Please search manually.';
      onLocateError?.(msg);
    } finally {
      setInternalLocating(false);
      onLocateEnd?.();
    }
  };

  const handleSelectResult = async (item: SearchResultItem) => {
    setShowDropdown(false);
    setQuery(item.name);
    if (item.placeId && (item.latitude === 0 || item.longitude === 0)) {
      setLoading(true);
      try {
        const resolved = await resolveLocationCoordinates(item);
        onSelect(resolved);
      } catch (e) {
        console.error('Error resolving place coordinates:', e);
        onSelect(item);
      } finally {
        setLoading(false);
      }
    } else {
      onSelect(item);
    }
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const t = setTimeout(async () => {
      if (query.length > 2) {
        setLoading(true);
        try {
          const res = await searchLocationsWithFallback(query);
          setResults(res);
          setShowDropdown(true);
        } catch (e) {
          console.error(e);
        } finally {
          setLoading(false);
        }
      } else {
        setResults([]);
        setShowDropdown(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [query]);

  return (
    <div className="search-wrap" ref={wrapperRef}>
      <span className="search-icon">
        <Search size={18} />
      </span>
      <input
        type="text"
        className="search-input"
        placeholder="Search for a city (e.g. London, Tokyo)…"
        value={query}
        onChange={e => setQuery(e.target.value)}
        onFocus={() => { if (results.length > 0) setShowDropdown(true); }}
        aria-label="Search city"
        aria-autocomplete="list"
        aria-expanded={showDropdown}
      />
      <div className="search-controls-right">
        {loading && (
          <span className="search-spinner" aria-hidden="true">
            <Loader2 size={16} className="spin" />
          </span>
        )}
        <button
          type="button"
          className={`btn-locate ${isLocating ? 'locating' : ''}`}
          onClick={handleUseMyLocation}
          disabled={isLocating}
          title="Use my current location"
          aria-label="Use my current location"
        >
          {isLocating ? (
            <Loader2 size={16} className="spin" />
          ) : (
            <Navigation size={16} />
          )}
        </button>
      </div>

      {showDropdown && (
        <div className="dropdown" role="listbox">
          {results.length > 0 ? (
            <ul>
              {results.map(loc => (
                <li
                  key={loc.id}
                  role="option"
                  onClick={() => handleSelectResult(loc)}
                >
                  <span className="dropdown-pin"><MapPin size={15} /></span>
                  <div>
                    <div className="dropdown-city">{loc.name}</div>
                    <div className="dropdown-sub">
                      {[loc.admin1, loc.country].filter(Boolean).join(', ')}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : query.length > 2 && !loading ? (
            <div className="dropdown-empty">No cities found for "{query}"</div>
          ) : null}
        </div>
      )}
    </div>
  );
}
