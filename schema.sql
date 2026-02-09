-- Create the store_items table
create table public.store_items (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  name text not null,
  price numeric not null,
  sizes text[] not null, -- Array of strings e.g. ['S', 'M', 'L']
  images text[] not null, -- Array of URLs
  category text not null,
  is_new BOOLEAN DEFAULT FALSE,
  is_out_of_stock BOOLEAN DEFAULT FALSE,
  is_on_sale BOOLEAN DEFAULT FALSE
);

-- Enable Row Level Security (RLS)
alter table public.store_items enable row level security;

-- Create a policy to allow anyone to read items
create policy "Allow public read access"
  on public.store_items
  for select
  using (true);

-- Insert some sample data (Optional)
insert into public.store_items (name, price, sizes, category, images)
values
  ('Shorts com brilho lateral', 30.00, ARRAY['P', 'M'], 'Shorts', ARRAY['https://images.unsplash.com/photo-1591195853828-11db59a44f6b?auto=format&fit=crop&w=800&q=80']),
  ('Shorts jeans com seta', 30.00, ARRAY['36', '38', '40'], 'Shorts', ARRAY['https://images.unsplash.com/photo-1541099649105-f69ad21f3246?auto=format&fit=crop&w=800&q=80']),
  ('Saia MIDI sem laycra', 40.00, ARRAY['M', 'G'], 'Saias', ARRAY['https://images.unsplash.com/photo-1583496661160-fb5886a0aaaa?auto=format&fit=crop&w=800&q=80']),
  ('Cropped preto sem brilho', 30.00, ARRAY['U'], 'Blusas', ARRAY['https://images.unsplash.com/photo-1503342394128-c104d54dba01?auto=format&fit=crop&w=800&q=80']),
  ('Jaqueta Jeans Cargo', 99.90, ARRAY['P', 'M', 'G', 'GG'], 'Conjuntos', ARRAY['https://images.unsplash.com/photo-1544642899-f0d6e5f6ed6f?auto=format&fit=crop&w=800&q=80', 'https://images.unsplash.com/photo-1516257984-b1b4d8c9230c?auto=format&fit=crop&w=800&q=80']);

-- =====================================================
-- ORDERS TABLE (for online shopping cart orders)
-- =====================================================
create table public.orders (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  nome_completo text not null,
  telefone text not null,
  cidade_estado text not null,
  excursao_transportadora text not null,
  observacoes text,
  cores_nao_desejadas text,
  forma_pagamento text not null default 'PIX',
  items jsonb not null, -- Array of {product_id, product_name, size, quantity, price}
  total_items integer not null,
  total_price numeric not null,
  status text default 'pending'
);

-- Enable Row Level Security
alter table public.orders enable row level security;

-- Allow anyone to insert orders (customers placing orders)
create policy "Allow public insert"
  on public.orders
  for insert
  with check (true);

-- Allow reading orders (for admin purposes)
create policy "Allow public read"
  on public.orders
  for select
  using (true);
