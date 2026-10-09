import { useState, useEffect, useRef } from 'react';
import { Search, MapPin, Loader2 } from 'lucide-react';
import { searchLocations } from '../api/openmeteo';
import type { LocationResult } from '../api/openmeteo';

interface SearchBarProps {
  onSelect: (location: LocationResult) => void;
}

export function SearchBar({ onSelect }: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<LocationResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

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
          const res = await searchLocations(query);
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
    }, 400);
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
      {loading && (
        <span className="search-spinner">
          <Loader2 size={18} className="spin" />
        </span>
      )}

      {showDropdown && (
        <div className="dropdown" role="listbox">
          {results.length > 0 ? (
            <ul>
              {results.map(loc => (
                <li
                  key={loc.id}
                  role="option"
                  onClick={() => {
                    onSelect(loc);
                    setShowDropdown(false);
                    setQuery(loc.name);
                  }}
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
