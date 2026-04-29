-- Create turni (shifts) table
CREATE TABLE IF NOT EXISTS public.turni (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operatore TEXT NOT NULL,
  data DATE NOT NULL,
  da_ore TIME NOT NULL,
  a_ore TIME NOT NULL,
  cella TEXT,
  stato TEXT NOT NULL DEFAULT 'attivo',
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for faster queries by date
CREATE INDEX IF NOT EXISTS idx_turni_data ON public.turni(data);
CREATE INDEX IF NOT EXISTS idx_turni_operatore ON public.turni(operatore);

-- For now, allow public access (no authentication required)
-- If you want to add user authentication later, we can add RLS policies
ALTER TABLE public.turni ENABLE ROW LEVEL SECURITY;

-- Allow all operations for now (public access)
CREATE POLICY "Allow public read access" ON public.turni FOR SELECT USING (true);
CREATE POLICY "Allow public insert access" ON public.turni FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update access" ON public.turni FOR UPDATE USING (true);
CREATE POLICY "Allow public delete access" ON public.turni FOR DELETE USING (true);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_turni_updated_at
  BEFORE UPDATE ON public.turni
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
