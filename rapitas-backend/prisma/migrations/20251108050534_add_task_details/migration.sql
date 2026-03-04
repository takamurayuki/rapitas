-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "description" TEXT,
ADD COLUMN     "estimatedHours" DOUBLE PRECISION,
ADD COLUMN     "labels" TEXT[] DEFAULT ARRAY[]::TEXT[];
