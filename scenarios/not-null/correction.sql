UPDATE deliveries SET state = 'pending' WHERE state IS NULL;
ALTER TABLE deliveries ALTER COLUMN state SET NOT NULL;
