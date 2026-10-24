-- AddForeignKey
ALTER TABLE "ProviderApplication" ADD CONSTRAINT "ProviderApplication_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "Identity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
