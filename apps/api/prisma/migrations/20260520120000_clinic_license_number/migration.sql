-- Clinic license number — printed in the letterhead of every clinical
-- document (visit report, history, vërtetim). Required by KS regulators
-- (MSH license) but per CLAUDE.md the value must not be hardcoded in
-- the template; each clinic carries its own.

ALTER TABLE "clinics"
  ADD COLUMN "license_number" TEXT;

-- Populate DonetaMED's license per CLAUDE.md §14 / approved print
-- design. Other clinics (none in v1) will set their own on creation.
UPDATE "clinics"
  SET "license_number" = 'Lic. MSH-Nr. 1487-AM/24'
  WHERE "subdomain" = 'donetamed';
