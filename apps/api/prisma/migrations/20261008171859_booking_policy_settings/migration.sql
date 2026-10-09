-- AlterTable
ALTER TABLE `bookings` ADD COLUMN `approvalNote` VARCHAR(1000) NULL,
    ADD COLUMN `approvalStatus` ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED') NULL,
    ADD COLUMN `approvedAt` DATETIME(3) NULL,
    ADD COLUMN `approvedById` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `companies` ADD COLUMN `bookingConfirmRoleIds` JSON NOT NULL,
    ADD COLUMN `bookingCreateRoleIds` JSON NOT NULL,
    ADD COLUMN `bookingRequiresApproval` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `verbalEmailGraceDays` INTEGER NOT NULL DEFAULT 7;
