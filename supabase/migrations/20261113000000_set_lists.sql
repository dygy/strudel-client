-- Spec 022 (set playlist): one row per set, items as a JSONB array.
-- Idempotent: safe to run more than once. Apply to prod only as an approved step, BEFORE the deploy
-- that ships /api/sets/* (the Set tab calls it as soon as it opens).

CREATE TABLE IF NOT EXISTS public.set_lists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,
    items JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT set_lists_name_length CHECK (char_length(btrim(name)) BETWEEN 1 AND 100),
    CONSTRAINT set_lists_items_array CHECK (jsonb_typeof(items) = 'array'),
    -- "A set with this name already exists"
    CONSTRAINT unique_set_name_per_user UNIQUE (user_id, name)
);

CREATE INDEX IF NOT EXISTS set_lists_user_updated_idx ON public.set_lists(user_id, updated_at DESC);

ALTER TABLE public.set_lists ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own set lists" ON public.set_lists;
CREATE POLICY "Users can view own set lists" ON public.set_lists
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own set lists" ON public.set_lists;
CREATE POLICY "Users can insert own set lists" ON public.set_lists
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- WITH CHECK as well: a row can't be handed to another user.
DROP POLICY IF EXISTS "Users can update own set lists" ON public.set_lists;
CREATE POLICY "Users can update own set lists" ON public.set_lists
    FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own set lists" ON public.set_lists;
CREATE POLICY "Users can delete own set lists" ON public.set_lists
    FOR DELETE USING (auth.uid() = user_id);

-- updated_at is the compare-and-swap version used by PUT /api/sets/update.
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_set_lists_updated_at ON public.set_lists;
CREATE TRIGGER update_set_lists_updated_at
    BEFORE UPDATE ON public.set_lists
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

GRANT ALL ON public.set_lists TO authenticated;
