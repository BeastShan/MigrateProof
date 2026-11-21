ALTER TABLE customers ADD COLUMN full_name text GENERATED ALWAYS AS (display_name) STORED;
