-- Add attivita column to turni table
ALTER TABLE public.turni 
ADD COLUMN IF NOT EXISTS attivita TEXT;

-- Add comment for documentation
COMMENT ON COLUMN public.turni.attivita IS 'Activity or task description for the shift';
