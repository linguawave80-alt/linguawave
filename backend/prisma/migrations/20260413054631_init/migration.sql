/*
  Warnings:

  - You are about to drop the column `avatar` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `emailVerified` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `emailVerifyExpires` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `emailVerifyToken` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `googleId` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `passwordResetExpires` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `passwordResetToken` on the `users` table. All the data in the column will be lost.
  - Made the column `passwordHash` on table `users` required. This step will fail if there are existing NULL values in that column.

*/
-- DropIndex
DROP INDEX "users_googleId_key";

-- AlterTable
ALTER TABLE "users" DROP COLUMN "avatar",
DROP COLUMN "emailVerified",
DROP COLUMN "emailVerifyExpires",
DROP COLUMN "emailVerifyToken",
DROP COLUMN "googleId",
DROP COLUMN "passwordResetExpires",
DROP COLUMN "passwordResetToken",
ALTER COLUMN "passwordHash" SET NOT NULL;
