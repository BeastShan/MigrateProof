WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY alias ORDER BY id) AS occurrence
  FROM aliases
)
UPDATE aliases SET alias = aliases.alias || '-demo-' || aliases.id
FROM ranked WHERE ranked.id = aliases.id AND ranked.occurrence > 1;
ALTER TABLE aliases ADD CONSTRAINT aliases_alias_key UNIQUE (alias);
