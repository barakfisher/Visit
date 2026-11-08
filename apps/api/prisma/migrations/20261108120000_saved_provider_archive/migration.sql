-- A customer's removal now archives the saved provider instead of deleting it, so it can be restored.
ALTER TABLE "SavedProvider" ADD COLUMN "archivedAt" TIMESTAMPTZ(3);
