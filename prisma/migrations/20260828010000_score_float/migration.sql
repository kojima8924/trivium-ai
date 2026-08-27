-- AlterTable: 能力スコアを小数 1 桁で保存する（到達レベル×10 + 進捗）
ALTER TABLE "DomainProfile" ALTER COLUMN "score" TYPE DOUBLE PRECISION;

-- AlterTable: 能力の時系列も同じ精度で
ALTER TABLE "ProfileSnapshot" ALTER COLUMN "read" TYPE DOUBLE PRECISION,
ALTER COLUMN "write" TYPE DOUBLE PRECISION,
ALTER COLUMN "code" TYPE DOUBLE PRECISION;
