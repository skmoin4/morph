-- AlterTable
ALTER TABLE `attendance_records` ADD COLUMN `isFinal` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `offices` ADD COLUMN `geofenceMode` ENUM('FLAG', 'REJECT') NOT NULL DEFAULT 'FLAG';
