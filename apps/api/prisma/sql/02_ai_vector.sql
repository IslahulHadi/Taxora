-- Optional: enable pgvector and add embedding column on ai_documents.
-- Run only on environments where the `vector` extension is available.
-- Idempotent.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') THEN
    CREATE EXTENSION IF NOT EXISTS vector;

    -- Add column if missing
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'ai_documents' AND column_name = 'embedding'
    ) THEN
      ALTER TABLE ai_documents ADD COLUMN embedding vector(1536);
    END IF;

    -- Add ANN index if missing
    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes WHERE indexname = 'ix_ai_documents_embedding'
    ) THEN
      CREATE INDEX ix_ai_documents_embedding ON ai_documents
        USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
    END IF;
  ELSE
    RAISE NOTICE 'pgvector not available; skipping AI embedding column setup.';
  END IF;
END $$;
