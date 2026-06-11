import { createClient } from '@supabase/supabase-js'

// Единственная точка создания клиента. Компоненты не импортируют supabase
// напрямую — только через features/*/api.ts (см. план, DIP-лайт).
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
)
