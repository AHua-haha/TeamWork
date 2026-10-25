export const schema = [
  `CREATE TABLE IF NOT EXISTS config_records (
    scope VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
    data JSON NOT NULL,
    PRIMARY KEY(scope, id)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS members (
    id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    workspace_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    is_lead TINYINT NULL,
    name_key VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NULL,
    ordinal BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
    data JSON NOT NULL,
    UNIQUE KEY members_order (ordinal),
    UNIQUE KEY members_lead (workspace_id, is_lead),
    UNIQUE KEY members_name (workspace_id, name_key),
    FOREIGN KEY (id) REFERENCES agents(id),
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS member_activation (
    workspace_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    revision VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    time BIGINT UNSIGNED NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS chat_images (
    workspace_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    metadata JSON NOT NULL, content MEDIUMBLOB NOT NULL,
    PRIMARY KEY(workspace_id, id), FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS chat_settings (
    workspace_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    position BIGINT UNSIGNED NOT NULL DEFAULT 0, mention_limit INT UNSIGNED NOT NULL DEFAULT 32,
    reset_cursor BIGINT UNSIGNED NOT NULL DEFAULT 0, reset_position BIGINT UNSIGNED NOT NULL DEFAULT 0,
    context_format TINYINT UNSIGNED NOT NULL DEFAULT 1, context_length BIGINT UNSIGNED NOT NULL DEFAULT 0,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS chat_exchanges (
    id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    workspace_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    mention_limit INT UNSIGNED NOT NULL, used INT UNSIGNED NOT NULL DEFAULT 0,
    stopped TINYINT NOT NULL DEFAULT 0,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS chat_messages (
    workspace_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    position BIGINT UNSIGNED NOT NULL, entry JSON NOT NULL,
    PRIMARY KEY (workspace_id, position),
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS chat_context_entries (
    workspace_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    position BIGINT UNSIGNED NOT NULL,
    id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    entry JSON NOT NULL, PRIMARY KEY(workspace_id, position), UNIQUE KEY(workspace_id, id),
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS chat_runs (
    run_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    exchange_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    FOREIGN KEY (run_id) REFERENCES runs(id), FOREIGN KEY (exchange_id) REFERENCES chat_exchanges(id)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS chat_clock (
    workspace_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    position BIGINT UNSIGNED NOT NULL DEFAULT 0, seq BIGINT UNSIGNED NOT NULL DEFAULT 0,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS chat_entries (
    workspace_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    position BIGINT UNSIGNED NOT NULL, run_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    data JSON NOT NULL, PRIMARY KEY(workspace_id, id), UNIQUE KEY(workspace_id, position), UNIQUE KEY(run_id),
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id), FOREIGN KEY (run_id) REFERENCES runs(id)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS chat_changes (
    workspace_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    seq BIGINT UNSIGNED NOT NULL, data JSON NOT NULL, PRIMARY KEY(workspace_id, seq),
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
  ) ENGINE=InnoDB`,
];

export const tables = ["config_records", "members", "member_activation", "chat_images", "chat_settings", "chat_exchanges", "chat_messages", "chat_context_entries", "chat_runs", "chat_clock", "chat_entries", "chat_changes"] as const;
