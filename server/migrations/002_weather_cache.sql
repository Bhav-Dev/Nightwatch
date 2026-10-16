-- Forecasts from MET Norway, cached per weather area (a position rounded to 0.1 degrees), so
-- everyone in an area shares one upstream request until the forecast expires. Holds no user,
-- device or exact position. `body` is the simplified forecast served to the app.
CREATE TABLE weather_cache (
  area text PRIMARY KEY,
  body text NOT NULL,
  expires_at timestamptz NOT NULL,
  last_modified text,
  fetched_at timestamptz NOT NULL
);

ALTER TABLE weather_cache ENABLE ROW LEVEL SECURITY;
