-- 页后 · After the Page
-- 数据库结构（WorkBuddy 云服务 · 托管 PostgreSQL）
-- 说明：这些语句用于记录/重建表结构，实际建表由云服务控制台或 SDK 执行。

-- 阅读记录：每「读一遍」产生一条
CREATE TABLE readings (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id TEXT NOT NULL DEFAULT auth.uid(),
  owner_name TEXT,
  title TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'article',   -- book / article / note / other
  source_name TEXT,
  raw_text TEXT,                                  -- 原始正文
  summary TEXT,                                   -- 摘要
  key_points JSONB DEFAULT '[]'::jsonb,           -- 核心论点（字符串数组）
  concepts JSONB DEFAULT '[]'::jsonb,             -- 关键概念（[{term, gloss}]）
  quotes JSONB DEFAULT '[]'::jsonb,               -- 原话（字符串数组）
  questions JSONB DEFAULT '[]'::jsonb,            -- 待解疑问（字符串数组）
  tag TEXT,
  read_on DATE NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Shanghai')::date,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 简报：每天「收束今天」产生一份（每用户每天唯一）
CREATE TABLE briefings (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id TEXT NOT NULL DEFAULT auth.uid(),
  owner_name TEXT,
  brief_date DATE NOT NULL,
  headline TEXT,
  digest TEXT,
  threads JSONB DEFAULT '[]'::jsonb,              -- 线索（[{title, body}]）
  residues JSONB DEFAULT '[]'::jsonb,             -- 带回明天的问题（字符串数组）
  next_seed TEXT,                                 -- 明天的入口
  reading_count INT DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, brief_date)
);

-- 行级权限：每张表只允许本人读写
ALTER TABLE readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE briefings ENABLE ROW LEVEL SECURITY;

CREATE POLICY readings_select_own ON readings
  FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY readings_insert_own ON readings
  FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY readings_update_own ON readings
  FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY readings_delete_own ON readings
  FOR DELETE TO authenticated USING (owner_id = auth.uid());

CREATE POLICY briefings_select_own ON briefings
  FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY briefings_insert_own ON briefings
  FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY briefings_update_own ON briefings
  FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY briefings_delete_own ON briefings
  FOR DELETE TO authenticated USING (owner_id = auth.uid());
