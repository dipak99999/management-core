-- KeyResult.targetValue + currentValue: Float -> Decimal(18,4). Float
-- is inappropriate for money / aggregated progress tracking (unit="MRR $"
-- or "deals" summed from Decimal(18,4) sources). Postgres can cast
-- double-precision to numeric in place; the USING clauses make the
-- intent explicit.
ALTER TABLE "key_results"
  ALTER COLUMN "targetValue" TYPE DECIMAL(18, 4) USING "targetValue"::DECIMAL(18, 4),
  ALTER COLUMN "currentValue" TYPE DECIMAL(18, 4) USING "currentValue"::DECIMAL(18, 4),
  ALTER COLUMN "currentValue" SET DEFAULT 0;
