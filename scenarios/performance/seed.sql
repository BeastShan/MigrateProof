INSERT INTO events
SELECT i, i, repeat('synthetic-', 15) FROM generate_series(1, 75000) AS i;
ANALYZE events;
