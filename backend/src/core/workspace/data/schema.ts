export const schema = [
  `CREATE TABLE IF NOT EXISTS workspace_git_baselines (workspace_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY, data JSON NOT NULL) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS workspaces (
    id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    directory VARCHAR(1024) NOT NULL,
    directory_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
    seq BIGINT UNSIGNED NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS workspace_models (
    workspace_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
    data JSON NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS context_blobs (
    workspace_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    content MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    size INT UNSIGNED NOT NULL,
    PRIMARY KEY(workspace_id, hash),
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS context_versions (
    workspace_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    file_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    seq BIGINT UNSIGNED NOT NULL,
    revision CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
    action VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    path VARCHAR(512) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    path_key VARCHAR(512) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    from_path VARCHAR(512) CHARACTER SET ascii COLLATE ascii_bin NULL,
    hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    size INT UNSIGNED NULL,
    time BIGINT NOT NULL,
    author JSON NOT NULL,
    reason TEXT NULL,
    PRIMARY KEY(workspace_id, file_id, seq),
    UNIQUE KEY(workspace_id, revision),
    KEY(workspace_id, path_key, seq),
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS context_files (
    workspace_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    path_key VARCHAR(512) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    path VARCHAR(512) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    file_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    revision CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    size INT UNSIGNED NOT NULL,
    mtime_ms DOUBLE NOT NULL,
    PRIMARY KEY(workspace_id, path_key),
    UNIQUE KEY(workspace_id, file_id),
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS context_records (
    workspace_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    seq BIGINT UNSIGNED NOT NULL,
    data JSON NOT NULL,
    PRIMARY KEY(workspace_id, seq),
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
  ) ENGINE=InnoDB`,
];

export const tables = ["workspace_git_baselines", "workspaces", "workspace_models", "context_blobs", "context_versions", "context_files", "context_records"] as const;
