CREATE TABLE events (id integer PRIMARY KEY, customer_id integer NOT NULL, payload text NOT NULL);
CREATE INDEX events_customer_idx ON events (customer_id);
