export const schema = [
  `CREATE TABLE IF NOT EXISTS agents (
    id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    context_format TINYINT UNSIGNED NOT NULL DEFAULT 1,
    context_length BIGINT UNSIGNED NOT NULL DEFAULT 0, context_revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
    history_position BIGINT UNSIGNED NOT NULL DEFAULT 0,
    active_run_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    latest_run_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS agent_context_entries (
    agent_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    position BIGINT UNSIGNED NOT NULL,
    id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    entry JSON NOT NULL, PRIMARY KEY(agent_id, position), UNIQUE KEY(agent_id, id),
    FOREIGN KEY (agent_id) REFERENCES agents(id)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS agent_assistant_response_handler_state (
    agent_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    handler_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
    data JSON NOT NULL,
    PRIMARY KEY(agent_id, handler_id),
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS runs (
    id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    agent_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    state JSON NOT NULL, FOREIGN KEY (agent_id) REFERENCES agents(id)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS messages (
    agent_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    position BIGINT UNSIGNED NOT NULL,
    id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    run_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    entry JSON NOT NULL, PRIMARY KEY(agent_id, position), UNIQUE KEY(agent_id, id),
    FOREIGN KEY (agent_id) REFERENCES agents(id), FOREIGN KEY (run_id) REFERENCES runs(id)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS context_compactions (
    id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    agent_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    run_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    active_agent_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL UNIQUE,
    history_after BIGINT UNSIGNED NOT NULL, state JSON NOT NULL,
    FOREIGN KEY(agent_id) REFERENCES agents(id), FOREIGN KEY(run_id) REFERENCES runs(id)
  ) ENGINE=InnoDB`,
];

export const tables = ["agents", "agent_context_entries", "agent_assistant_response_handler_state", "runs", "messages", "context_compactions"] as const;
