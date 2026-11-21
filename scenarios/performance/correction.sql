CREATE INDEX events_customer_lookup_idx ON events (customer_id) INCLUDE (id);
DROP INDEX events_customer_idx;
